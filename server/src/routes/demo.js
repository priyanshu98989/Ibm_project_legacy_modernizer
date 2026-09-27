/**
 * server/src/routes/demo.js
 *
 *   GET  /api/demo              — list the available fixtures
 *   POST /api/demo/:name/analyze — analyse one and return the report
 *
 * The demo path is deliberately a single request.  Previously it was two — load
 * the fixture for a jobId, then POST /api/analyze/:jobId — which only works
 * while something holds the job in memory between the two calls.  Collapsing it
 * into one invocation means the job never has to survive anywhere, so the demo
 * works unchanged on a platform that discards state after every request.
 *
 * It is also the cheapest way to try a deployment: no upload, no blob store, no
 * Redis, nothing but the fixtures bundled alongside the function.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { runPipeline } = require('../services/pipeline');
const { resolveFixtureDir } = require('../services/workspace');

const router = express.Router();

const ALLOWED_FIXTURES = new Set([
  'java-legacy-bank',
  'cobol-legacy-payroll',
  'cobol-java-demo',
]);

/** Fixture metadata, mirrored by the client's own list. */
const FIXTURES = [
  { name: 'java-legacy-bank',     label: 'Java Legacy Bank',     languages: ['java'],         files: 4 },
  { name: 'cobol-legacy-payroll', label: 'COBOL Legacy Payroll', languages: ['cobol'],        files: 4 },
  { name: 'cobol-java-demo',      label: 'Java + COBOL Demo',    languages: ['java', 'cobol'], files: 4 },
];

// ── GET /api/demo ──────────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({ fixtures: FIXTURES });
});

// ── POST /api/demo/:name/analyze ──────────────────────────────────────────────
router.post('/:name/analyze', async (req, res, next) => {
  const { name } = req.params;

  if (!ALLOWED_FIXTURES.has(name)) {
    return res.status(404).json({
      error: `Demo fixture '${name}' not found. Available: ${[...ALLOWED_FIXTURES].join(', ')}`,
    });
  }

  const jobId = uuidv4();

  try {
    // Points straight at the bundled fixture — nothing is copied or extracted.
    const workDir = resolveFixtureDir(name);
    const report = await runPipeline({ jobId, workDir });
    return res.json({ status: 'done', jobId, fixture: name, report });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
