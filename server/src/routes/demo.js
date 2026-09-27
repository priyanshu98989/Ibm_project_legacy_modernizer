/**
 * server/src/routes/demo.js
 * GET /api/demo/:name
 *
 * Instantly loads one of the pre-built demo fixtures as a job, skipping the
 * upload step entirely.  Returns { jobId } — the client then calls
 * POST /api/analyze/:jobId as normal.
 *
 * Available fixtures (matches the names exposed to the client):
 *   java-legacy-bank      — multi-file Java legacy banking service
 *   cobol-legacy-payroll  — multi-file COBOL legacy payroll batch program
 *   cobol-java-demo       — original mixed demo (customer inquiry)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createJob, updateJob } = require('../store/jobs');

const router = express.Router();

// Resolve to demo-fixtures directory relative to this file
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', '..', 'demo-fixtures');

const ALLOWED_FIXTURES = new Set([
  'java-legacy-bank',
  'cobol-legacy-payroll',
  'cobol-java-demo',
]);

// ── GET /api/demo/:name ───────────────────────────────────────────────────────
router.get('/:name', (req, res) => {
  const { name } = req.params;

  if (!ALLOWED_FIXTURES.has(name)) {
    return res.status(404).json({
      error: `Demo fixture '${name}' not found. Available: ${[...ALLOWED_FIXTURES].join(', ')}`,
    });
  }

  const fixtureDir = path.join(FIXTURES_DIR, name);

  if (!fs.existsSync(fixtureDir)) {
    return res.status(500).json({
      error: `Fixture directory not found on server: ${fixtureDir}`,
    });
  }

  const jobId = uuidv4();
  createJob(jobId);
  // Point directly at the fixture directory — no ZIP extraction needed.
  updateJob(jobId, { workDir: fixtureDir, status: 'pending' });

  return res.json({ jobId });
});

// ── GET /api/demo — list available fixtures ───────────────────────────────────
router.get('/', (_req, res) => {
  res.json({
    fixtures: [
      { name: 'java-legacy-bank',     label: 'Java Legacy Bank',     languages: ['java'],         files: 4 },
      { name: 'cobol-legacy-payroll', label: 'COBOL Legacy Payroll', languages: ['cobol'],        files: 4 },
      { name: 'cobol-java-demo',      label: 'Java + COBOL Demo',    languages: ['java','cobol'], files: 4 },
    ],
  });
});

module.exports = router;
