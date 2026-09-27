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
 *   repo  — a shallow clone of a public GitHub repository
 *   demo  — a fixture directory bundled with the app
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const simpleGit = require('simple-git');
const { downloadBlobToFile, removeBlob } = require('./storage');

// Zip-bomb guard: the total uncompressed size we are willing to write to disk.
const MAX_EXTRACT_BYTES = parseInt(process.env.MAX_EXTRACT_BYTES || String(4 * 1024 ** 3), 10);
const MAX_EXTRACT_ENTRIES = parseInt(process.env.MAX_EXTRACT_ENTRIES || '200000', 10);

/** How long a git clone may run before the job is abandoned. */
const CLONE_TIMEOUT_MS = parseInt(process.env.CLONE_TIMEOUT_MS || '120000', 10);

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

/** Shallow-clone a public repository. */
async function materialiseRepo(source, jobId) {
  const workDir = jobDir(jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const git = simpleGit();
  await Promise.race([
    git.clone(source.repoUrl, workDir, ['--depth', '1']),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(
          `Repository clone timed out after ${CLONE_TIMEOUT_MS / 1000}s. ` +
          `Try a smaller repo, or upload a ZIP instead.`
        )),
        CLONE_TIMEOUT_MS
      )
    ),
  ]);

  return { workDir, cleanupBlob: null };
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
  // The downloaded archive, if a clone or extraction was interrupted.
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
  removeBlob,
};
