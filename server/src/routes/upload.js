/**
 * server/src/routes/upload.js
 * POST /api/upload
 *
 * Accepts either:
 *   - multipart/form-data with field "zipfile" (a .zip archive)
 *   - JSON body { "repoUrl": "https://github.com/..." }
 *
 * Returns: { jobId }  — client then calls POST /api/analyze/:jobId to kick off analysis.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const simpleGit = require('simple-git');
const { createJob, updateJob } = require('../store/jobs');

const router = express.Router();

// ── Multer: store upload in OS temp dir ───────────────────────────────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || '52428800', 10) },
  fileFilter(_req, file, cb) {
    if (!file.originalname.endsWith('.zip')) {
      return cb(new Error('Only .zip files are accepted for file upload.'));
    }
    cb(null, true);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the base directory for job workspaces.
 * Uses TEMP_DIR env var if set, otherwise OS temp dir.
 */
function baseDir() {
  return process.env.TEMP_DIR || os.tmpdir();
}

/**
 * Extract a ZIP archive into a new job work directory.
 * @param {string} zipPath - path to the uploaded zip file
 * @param {string} jobId
 * @returns {string} workDir
 */
function extractZip(zipPath, jobId) {
  const workDir = path.join(baseDir(), `lcm-${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(workDir, true);
  fs.unlinkSync(zipPath); // remove the raw upload
  return workDir;
}

/**
 * Clone a public GitHub repo into a new job work directory.
 * @param {string} repoUrl
 * @param {string} jobId
 * @returns {Promise<string>} workDir
 */
async function cloneRepo(repoUrl, jobId) {
  const workDir = path.join(baseDir(), `lcm-${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });
  const git = simpleGit();
  await git.clone(repoUrl, workDir, ['--depth', '1']);
  return workDir;
}

// ── Route: ZIP upload ─────────────────────────────────────────────────────────
router.post('/', upload.single('zipfile'), async (req, res) => {
  try {
    if (req.file) {
      // ZIP path
      const jobId = uuidv4();
      const job = createJob(jobId);
      const workDir = extractZip(req.file.path, jobId);
      updateJob(jobId, { workDir, status: 'pending' });
      return res.json({ jobId });
    }

    // JSON body with repoUrl
    const { repoUrl } = req.body || {};
    if (repoUrl) {
      // Basic URL validation — must be http/https
      if (!/^https?:\/\//.test(repoUrl)) {
        return res.status(400).json({ error: 'repoUrl must be an http/https URL.' });
      }
      const jobId = uuidv4();
      createJob(jobId);
      // Clone asynchronously so we can return the jobId immediately;
      // the client polls /api/analyze/:jobId which will wait for workDir.
      // Hard timeout: if git clone takes more than 5 minutes, fail the job.
      const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
      const cloneTimer = setTimeout(() => {
        updateJob(jobId, {
          status: 'error',
          error: 'Repository clone timed out after 5 minutes. Try a smaller repo or use ZIP upload instead.',
        });
      }, CLONE_TIMEOUT_MS);

      (async () => {
        try {
          const workDir = await cloneRepo(repoUrl, jobId);
          clearTimeout(cloneTimer);
          updateJob(jobId, { workDir, status: 'pending' });
        } catch (err) {
          clearTimeout(cloneTimer);
          updateJob(jobId, { status: 'error', error: `Clone failed: ${err.message}` });
        }
      })();
      return res.json({ jobId });
    }

    return res.status(400).json({ error: 'Provide a zipfile upload or a repoUrl in the request body.' });
  } catch (err) {
    console.error('[upload]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
