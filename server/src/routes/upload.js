/**
 * server/src/routes/upload.js
 *
 * Creates the job record.  Three ways in, because the right one depends on how
 * the app is deployed:
 *
 *   Blob deployments (Vercel)
 *     POST /api/upload/token    — issues a short-lived client-upload token
 *     POST /api/upload/commit   — the browser has PUT the bytes to Blob already;
 *                                 register that blob as a job
 *     The file never passes through a function, which is the only way past
 *     Vercel's 4.5 MB request body cap.
 *
 *   No Blob (plain `npm run dev`, or a self-hosted box)
 *     POST /api/upload          — ordinary multipart upload, spooled to disk
 *
 *   Either way
 *     POST /api/upload          — { repoUrl } records a GitHub clone job
 *
 * All three return { jobId }.  Nothing is analysed here: the clone and the
 * extraction both happen inside the analyse invocation, because background work
 * started in one serverless invocation does not survive into the next.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createJob } = require('../store/jobs');
const { blobEnabled, handleClientUpload, statBlob, maxUploadBytes, removeBlob } = require('../services/storage');

const router = express.Router();

// ── Multipart fallback (no Blob configured) ────────────────────────────────────

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: maxUploadBytes(), files: 1 },
  fileFilter(_req, file, cb) {
    if (!file.originalname.endsWith('.zip')) {
      return cb(Object.assign(
        new Error('Only .zip files are accepted for file upload.'),
        { status: 400 }
      ));
    }
    cb(null, true);
  },
});

/** Accept a repo URL and record the job. */
function acceptRepoUrl(repoUrl) {
  if (!/^https?:\/\//.test(repoUrl)) {
    throw Object.assign(new Error('repoUrl must be an http/https URL.'), { status: 400 });
  }
  return { type: 'repo', repoUrl };
}

// ── POST /api/upload/token ─────────────────────────────────────────────────────
// Multiplexed by @vercel/blob: the same route issues tokens and receives the
// upload-complete callback.
router.post('/token', async (req, res, next) => {
  if (!blobEnabled()) {
    return next(Object.assign(
      new Error('Blob storage is not configured; use the multipart upload endpoint.'),
      { status: 501 }
    ));
  }
  try {
    const jsonResponse = await handleClientUpload(req);
    res.status(jsonResponse.status || 200).json(jsonResponse.body);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload/commit ────────────────────────────────────────────────────
// Runs after the browser's upload() resolves, so it is the client's own
// confirmation that the bytes landed — no webhook race.
router.post('/commit', async (req, res, next) => {
  try {
    if (!blobEnabled()) {
      return res.status(501).json({ error: 'Blob storage is not configured.' });
    }

    const { pathname, filename, size } = req.body || {};
    if (typeof pathname !== 'string' || !pathname) {
      return res.status(400).json({ error: 'Send the uploaded blob `pathname`.' });
    }
    if (filename && !filename.toLowerCase().endsWith('.zip')) {
      return res.status(400).json({ error: 'Only .zip files are accepted for file upload.' });
    }

    // Confirm the blob really exists and is within the ceiling before creating a
    // job for it.  Without this, anyone could point a job at an arbitrary blob
    // in the store and have the analysis invocation fetch it.
    let info;
    try {
      info = await statBlob(pathname);
    } catch {
      return res.status(410).json({ error: 'Uploaded archive not found. Please upload again.' });
    }
    if (info.size > maxUploadBytes()) {
      await removeBlob(info.pathname);
      return res.status(413).json({
        error: `Upload is ${(info.size / 1024 ** 2).toFixed(0)} MB, over the ` +
               `${(maxUploadBytes() / 1024 ** 2).toFixed(0)} MB limit.`,
      });
    }

    const jobId = uuidv4();
    await createJob({
      id: jobId,
      source: { type: 'blob', pathname: info.pathname, filename: filename || null, size: info.size },
    });

    return res.json({ jobId });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload ───────────────────────────────────────────────────────────
router.post('/', upload.single('zipfile'), async (req, res, next) => {
  try {
    // ── Multipart ZIP (no Blob configured) ────────────────────────────────────
    if (req.file) {
      const jobId = uuidv4();
      const dir = path.join(process.env.TEMP_DIR || os.tmpdir(), `lcm-${jobId}`);
      fs.mkdirSync(dir, { recursive: true });
      const parked = path.join(dir, 'upload.zip');
      fs.renameSync(req.file.path, parked);

      await createJob({ id: jobId, source: { type: 'zipfile', zipPath: parked } });
      return res.json({ jobId });
    }

    // ── Repository URL ─────────────────────────────────────────────────────────
    const { repoUrl } = req.body || {};
    if (repoUrl) {
      const source = acceptRepoUrl(repoUrl);
      const jobId = uuidv4();
      await createJob({ id: jobId, source });
      return res.json({ jobId });
    }

    return res.status(400).json({ error: 'Provide a zipfile upload or a repoUrl in the request body.' });
  } catch (err) {
    // Do not leave a partially-received upload behind.
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* already gone */ }
    }
    next(err);
  }
});

// Multer signals its own limit breaches here, before the handler runs, so
// without this middleware an oversized upload surfaces as an opaque 500.
router.use((err, req, res, next) => {
  if (req.file?.path) {
    try { fs.unlinkSync(req.file.path); } catch { /* already removed */ }
  }

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Upload exceeds the ${(maxUploadBytes() / 1024 ** 2).toFixed(0)} MB limit.`,
    });
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE' || err?.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Send exactly one .zip file in the "zipfile" field.' });
  }
  if (err) return next(err);
  next();
});

module.exports = router;
