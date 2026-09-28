/**
 * server/src/services/workspace.js
 * Materialises a job's source code onto the local filesystem and cleans it up
 * afterwards.
 *
 * On Vercel the only writable location is /tmp and it is wiped when the
 * invocation ends, which is why the whole analysis has to happen inside one
 * invocation — see services/pipeline.js.  The upshot is that every invocation
 * pays for its own download and extraction, and must clean up before it
 * responds.
 *
 * Three sources, all ending at "a directory of source files on disk":
 *   blob  — a ZIP the browser uploaded straight to Vercel Blob
 *   repo  — a ZIP archive downloaded from a public GitHub repository
 *   demo  — a fixture directory bundled with the app
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const AdmZip = require('adm-zip');
const axios = require('axios');
const { downloadBlobToFile, removeBlob } = require('./storage');

// Zip-bomb guard: the total uncompressed size we are willing to write to disk.
const MAX_EXTRACT_BYTES = parseInt(process.env.MAX_EXTRACT_BYTES || String(4 * 1024 ** 3), 10);
const MAX_EXTRACT_ENTRIES = parseInt(process.env.MAX_EXTRACT_ENTRIES || '200000', 10);

/**
 * How long fetching a repository may take before the job is abandoned.
 * Named for the clone this replaced; it now bounds an HTTP download.
 */
const CLONE_TIMEOUT_MS = parseInt(process.env.CLONE_TIMEOUT_MS || '120000', 10);

/**
 * Ceiling on a downloaded repository archive, in bytes.
 *
 * The archive is only the transport — the uncompressed total is bounded
 * separately by MAX_EXTRACT_BYTES — but a repository with a huge commit
 * history or a committed binary blob should not be able to fill the disk
 * either.  100 MB of ZIP is already a very large codebase.
 */
const MAX_REPO_BYTES = parseInt(process.env.MAX_REPO_BYTES || String(100 * 1024 * 1024), 10);

/**
 * Root under which per-job scratch directories are created.
 * The name is prefixed with `lcm-` so cleanupWorkDir can recognise its own
 * directories and never delete anything else.
 */
function baseDir() {
  return process.env.TEMP_DIR || os.tmpdir();
}

/** The exact scratch path this job is allowed to own and delete. */
function jobDir(jobId) {
  return path.join(baseDir(), `lcm-${jobId}`);
}

/**
 * Reject archives that would expand to an unreasonable size on disk.
 *
 * AdmZip reports each entry's uncompressed size in its header, so the total can
 * be checked before a single byte is written.  This is what stops a small,
 * highly compressible "zip bomb" from filling the disk.
 *
 * @param {AdmZip} zip
 * @throws {Error} with `status` 413 when the archive is too large
 */
function assertExtractableSize(zip) {
  const entries = zip.getEntries();
  if (entries.length > MAX_EXTRACT_ENTRIES) {
    throw Object.assign(
      new Error(
        `Archive contains ${entries.length.toLocaleString()} entries, which is over the ` +
        `${MAX_EXTRACT_ENTRIES.toLocaleString()} limit.`
      ),
      { status: 413 }
    );
  }

  const total = entries.reduce((sum, e) => sum + (e.header?.size || 0), 0);
  if (total > MAX_EXTRACT_BYTES) {
    throw Object.assign(
      new Error(
        `Archive expands to ${(total / 1024 ** 3).toFixed(2)} GB, which is over the ` +
        `${(MAX_EXTRACT_BYTES / 1024 ** 3).toFixed(0)} GB extraction limit.`
      ),
      { status: 413 }
    );
  }
}

/**
 * Locate the bundled demo fixtures.
 *
 * The obvious relative path works in the repo but not in a serverless bundle,
 * where the function's files sit at a different depth and extra files are copied
 * in by `includeFiles`.  So candidates are tried in turn, with DEMO_FIXTURES_DIR
 * as the escape hatch.
 *
 * @returns {string|null} an existing fixtures directory, or null
 */
function resolveFixturesDir() {
  const candidates = [
    process.env.DEMO_FIXTURES_DIR,
    path.resolve(__dirname, '..', '..', '..', 'demo-fixtures'),
    path.resolve(__dirname, '..', '..', 'demo-fixtures'),
    path.resolve(process.cwd(), 'demo-fixtures'),
    path.resolve(process.cwd(), '..', 'demo-fixtures'),
    path.resolve(process.cwd(), '..', '..', 'demo-fixtures'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

/**
 * Build the workDir for a demo job without copying anything.
 * @param {string} name
 * @returns {string}
 */
function resolveFixtureDir(name) {
  const fixturesDir = resolveFixturesDir();
  if (!fixturesDir) {
    throw Object.assign(
      new Error('Demo fixtures are not available in this deployment.'),
      { status: 404 }
    );
  }
  const dir = path.join(fixturesDir, name);
  if (!fs.existsSync(dir)) {
    throw Object.assign(new Error(`Demo fixture '${name}' not found.`), { status: 404 });
  }
  return dir;
}

/** Download a ZIP from Blob and extract it. */
async function materialiseBlob(source, jobId) {
  const zipPath = path.join(baseDir(), `lcm-${jobId}.zip`);
  const workDir = jobDir(jobId);

  await downloadBlobToFile(source.pathname, zipPath);

  const zip = new AdmZip(zipPath);
  assertExtractableSize(zip);

  fs.mkdirSync(workDir, { recursive: true });
  zip.extractAllTo(workDir, true);
  fs.unlinkSync(zipPath); // the archive itself is no longer needed

  return { workDir, cleanupBlob: source.pathname };
}

/** Extract a ZIP that multer already spooled to local disk. */
async function materialiseZipfile(source, jobId) {
  const workDir = jobDir(jobId);
  const zip = new AdmZip(source.zipPath);
  assertExtractableSize(zip);

  fs.mkdirSync(workDir, { recursive: true });
  zip.extractAllTo(workDir, true);
  fs.rmSync(source.zipPath, { force: true }); // the archive itself is no longer needed

  return { workDir, cleanupBlob: null };
}

/**
 * Pull a repository's source code apart into `{ owner, repo, ref }`.
 *
 * Accepts the shapes people actually paste:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/some-branch
 * Anything else is rejected here rather than becoming a confusing 404 from
 * GitHub halfway through the download.
 *
 * @param {string} repoUrl
 * @returns {{ owner: string, repo: string, ref: string }}
 * @throws {Error} with `status` 400 when the URL is not a repository root
 */
function parseRepoUrl(repoUrl) {
  let url;
  try {
    url = new URL(repoUrl);
  } catch {
    throw Object.assign(new Error(`'${repoUrl}' is not a valid URL.`), { status: 400 });
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw Object.assign(
      new Error('Only public github.com repository URLs are supported.'),
      { status: 400 }
    );
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw Object.assign(
      new Error('Point at a repository root, for example https://github.com/owner/repo'),
      { status: 400 }
    );
  }

  // `.../tree/<ref>` and `.../tree/<ref>/<subdir>` both mean "that ref"; a
  // subdirectory is ignored because the analysis wants the whole repository.
  const ref = segments[2] === 'tree' && segments[3] ? decodeURIComponent(segments[3]) : 'HEAD';

  return {
    owner: segments[0],
    repo: segments[1].replace(/\.git$/i, ''),
    ref,
  };
}

/**
 * Archive endpoints to try, best guess first.
 *
 * codeload serves the zip of a branch directly; the API zipball is the fallback
 * that also resolves tags and commit SHAs, and is rate limited per IP, so it is
 * only reached when the cheap route 404s.
 *
 * @param {{ owner: string, repo: string, ref: string }} target
 * @returns {string[]}
 */
function archiveUrls({ owner, repo, ref }) {
  const urls = [];
  if (ref !== 'HEAD') urls.push(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(ref)}`);
  urls.push(`https://codeload.github.com/${owner}/${repo}/zip/HEAD`);
  urls.push(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`);
  return urls;
}

/**
 * Stream one archive URL to disk, refusing anything over MAX_REPO_BYTES.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {AbortSignal} [signal] cancels the request when the overall deadline passes
 * @returns {Promise<number>} the HTTP status, so the caller can try the next URL
 */
async function downloadArchive(url, destPath, signal) {
  const response = await axios.get(url, {
    responseType: 'stream',
    // GitHub rejects API requests without a User-Agent outright.
    headers: { 'User-Agent': 'legacy-code-modernizer', Accept: 'application/vnd.github+json' },
    maxRedirects: 5,
    validateStatus: () => true, // inspect it ourselves rather than throwing
    signal,
  });

  if (response.status !== 200) {
    response.data.resume(); // drain, or the socket is held open
    return response.status;
  }

  const declared = Number(response.headers['content-length'] || 0);
  if (declared > MAX_REPO_BYTES) {
    response.data.resume();
    throw Object.assign(
      new Error(
        `Repository archive is ${(declared / 1024 ** 2).toFixed(0)} MB, over the ` +
        `${(MAX_REPO_BYTES / 1024 ** 2).toFixed(0)} MB limit. Upload a ZIP of a subset instead.`
      ),
      { status: 413 }
    );
  }

  // The header is a hint, not a promise, so the running total is enforced too.
  let received = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > MAX_REPO_BYTES) {
        cb(Object.assign(new Error('Repository archive is over the download limit.'), { status: 413 }));
        return;
      }
      cb(null, chunk);
    },
  });

  // An abort mid-stream surfaces as a stream error, which is one more reason the
  // socket must be torn down rather than left draining in the background.
  try {
    await pipeline(response.data, meter, fs.createWriteStream(destPath));
  } catch (err) {
    response.data.destroy();
    throw err;
  }
  return 200;
}

/**
 * Unpack a repository archive, dropping the wrapper directory GitHub puts at the
 * root of every archive (`repo-branch/`) so report paths read `src/app.js` rather
 * than `repo-main/src/app.js`.
 */
function extractRepoArchive(zipPath, workDir) {
  const zip = new AdmZip(zipPath);
  assertExtractableSize(zip);

  const root = path.resolve(workDir);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const relative = entry.entryName.replace(/\\/g, '/').split('/').slice(1).join('/');
    if (!relative) continue;

    // A crafted archive could try to climb out of the work dir; anything that
    // does not land underneath it is not ours to write.
    const dest = path.resolve(root, relative);
    if (!dest.startsWith(root + path.sep)) continue;

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
}

/**
 * Download a public repository and unpack it.
 *
 * This deliberately does not shell out to `git`.  A serverless function has no
 * git binary — `spawn git ENOENT` — and a zip archive of the default branch is
 * all the analysis ever needed anyway.
 */
async function materialiseRepo(source, jobId) {
  const target = parseRepoUrl(source.repoUrl);
  const workDir = jobDir(jobId);
  const zipPath = path.join(baseDir(), `lcm-${jobId}.zip`); // same name cleanupWorkspace already knows

  fs.mkdirSync(workDir, { recursive: true });

  // The deadline is one budget across all candidate URLs, not a per-attempt
  // one, and the controller lets it interrupt an in-flight request rather than
  // merely stop waiting for it — otherwise the socket keeps streaming into a
  // work directory nothing is reading any more.
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(
        new Error(
          `Repository download timed out after ${CLONE_TIMEOUT_MS / 1000}s. ` +
          `Try a smaller repo, or upload a ZIP instead.`
        ),
        { status: 504 }
      ));
    }, CLONE_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      (async () => {
        let lastStatus = 0;
        for (const url of archiveUrls(target)) {
          lastStatus = await downloadArchive(url, zipPath, controller.signal);
          if (lastStatus === 200) {
            extractRepoArchive(zipPath, workDir);
            return;
          }
        }
        if (lastStatus === 403 || lastStatus === 429) {
          throw Object.assign(
            new Error('GitHub is rate-limiting this deployment. Try again in a few minutes, or upload a ZIP.'),
            { status: 429 }
          );
        }
        throw Object.assign(
          new Error(
            `Could not download ${target.owner}/${target.repo} from GitHub. ` +
            `Check that the repository exists and is public.`
          ),
          { status: 404 }
        );
      })(),
      deadline,
    ]);

    return { workDir, cleanupBlob: null };
  } catch (err) {
    // An abort is how the deadline stops a slow download; report it as the
    // timeout it is rather than as axios's opaque cancellation message.
    if (controller.signal.aborted && err.name === 'CanceledError') {
      throw Object.assign(
        new Error(
          `Repository download timed out after ${CLONE_TIMEOUT_MS / 1000}s. ` +
          `Try a smaller repo, or upload a ZIP instead.`
        ),
        { status: 504 }
      );
    }
    throw err;
  } finally {
    // Unconditionally: a cleared timer releases the event loop, so a 1-second
    // download does not keep a serverless invocation open for the full
    // CLONE_TIMEOUT_MS. The archive itself is no longer needed either way.
    clearTimeout(timer);
    fs.rmSync(zipPath, { force: true });
  }
}

/**
 * Resolve a job's source onto disk.
 *
 * @param {{ id: string, source: { type: string } }} job
 * @returns {Promise<{ workDir: string, cleanupBlob: string|null }>}
 */
async function prepareWorkspace(job) {
  const { source } = job;
  if (!source) {
    throw Object.assign(new Error('Job has no source recorded.'), { status: 409 });
  }

  if (source.type === 'blob')    return materialiseBlob(source, job.id);
  if (source.type === 'zipfile') return materialiseZipfile(source, job.id);
  if (source.type === 'repo')    return materialiseRepo(source, job.id);
  if (source.type === 'demo')    return { workDir: resolveFixtureDir(source.fixture), cleanupBlob: null };

  throw Object.assign(new Error(`Unknown job source type '${source.type}'.`), { status: 409 });
}

/**
 * Remove this job's scratch directory — but only the exact `lcm-<jobId>`
 * directory we created under the configured base.  Demo jobs point straight at
 * the bundled fixtures, and an unconditional delete would wipe the project's
 * own fixture files.
 *
 * @param {string} jobId
 */
function cleanupWorkspace(jobId) {
  const target = path.resolve(jobDir(jobId));
  const base = path.resolve(baseDir());
  if (target !== path.join(base, `lcm-${jobId}`)) return; // not ours — leave it alone
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[workspace] Could not remove ${target}: ${err.message}`);
  }
  // The downloaded archive, if a download or extraction was interrupted.
  try {
    fs.rmSync(path.join(base, `lcm-${jobId}.zip`), { force: true });
  } catch { /* already gone */ }
}

module.exports = {
  prepareWorkspace,
  cleanupWorkspace,
  resolveFixtureDir,
  resolveFixturesDir,
  maxExtractBytes: MAX_EXTRACT_BYTES,
  maxExtractEntries: MAX_EXTRACT_ENTRIES,
  maxRepoBytes: MAX_REPO_BYTES,
  removeBlob,
};
