/**
 * server/src/routes/analyze.js
 * POST /api/analyze/:jobId
 *
 * Orchestrates the full analysis pipeline:
 *   1. File scan
 *   2. Dependency graph
 *   3. Static risk scoring
 *   4. Bob AI suggestions (top N risky files to keep demo fast)
 *   5. Executive summary from Bob
 *   6. Report compilation
 *
 * The route responds immediately with { status: 'analyzing' } and runs
 * the heavy work asynchronously.  The client polls GET /api/analyze/:jobId/status.
 */

const express = require('express');
const { getJob, updateJob } = require('../store/jobs');
const { scanDirectory } = require('../services/fileScanner');
const { buildDependencyGraph } = require('../services/dependencyMapper');
const { scoreFiles } = require('../services/riskScorer');
const { generateSuggestion, generateExecutiveSummary } = require('../services/bobClient');
const { compileReport } = require('../services/reportCompiler');

const router = express.Router();

// How many risky files to send to Bob for AI suggestions.
const MAX_BOB_SUGGESTIONS = parseInt(process.env.MAX_BOB_SUGGESTIONS || '5', 10);

// Hard cap: if a repo has more files than this, refuse analysis with a clear error.
// Prevents OOM/timeout on accidental large monorepo uploads.
const MAX_FILES = parseInt(process.env.MAX_FILES || '500', 10);

// Per-file Bob suggestion timeout (ms) — prevents a single slow Bob call hanging the job.
const BOB_SUGGESTION_TIMEOUT_MS = parseInt(process.env.BOB_SUGGESTION_TIMEOUT_MS || '90000', 10);

/**
 * Wrap a promise with a timeout.  Rejects with a clear message if the
 * promise doesn't resolve within `ms` milliseconds.
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms / 1000}s waiting for ${label}`)),
      ms
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

// ── POST /api/analyze/:jobId ──────────────────────────────────────────────────
router.post('/:jobId', async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  // If the clone is still in progress, workDir may not be set yet
  if (!job.workDir) {
    return res.status(202).json({ status: 'pending', message: 'Repository is still being cloned. Try again shortly.' });
  }

  if (job.status === 'analyzing' || job.status === 'done') {
    return res.json({ status: job.status, jobId: job.id });
  }

  // Kick off analysis in the background
  updateJob(job.id, { status: 'analyzing' });
  res.json({ status: 'analyzing', jobId: job.id });

  // ── Background pipeline ──────────────────────────────────────────────────
  (async () => {
    try {
      // Step 1 — Scan files
      const files = scanDirectory(job.workDir, job.workDir);
      if (files.length === 0) {
        return updateJob(job.id, {
          status: 'error',
          error: 'No supported source files found (expected .java, .cbl/.cob/.cobol, or .js/.jsx).',
        });
      }
      if (files.length > MAX_FILES) {
        return updateJob(job.id, {
          status: 'error',
          error: `Repository is too large: ${files.length} supported files found (limit is ${MAX_FILES}). ` +
                 `Upload a smaller subset or increase MAX_FILES in your .env.`,
        });
      }
      updateJob(job.id, { files });

      // Step 2 — Dependency graph
      const dependencyGraph = buildDependencyGraph(files);
      updateJob(job.id, { dependencyGraph });

      // Step 3 — Static risk scoring
      const risks = scoreFiles(files);
      updateJob(job.id, { risks });

      // Step 4 — Bob AI suggestions for top risky files
      const topRisks = risks.slice(0, MAX_BOB_SUGGESTIONS);
      const suggestions = [];

      for (const risk of topRisks) {
        const fileObj = files.find(f => f.path === risk.file);
        if (!fileObj) continue;
        try {
          const { suggestion, diff } = await withTimeout(
            generateSuggestion({
              file:     risk.file,
              language: risk.language,
              severity: risk.severity,
              issues:   risk.issues,
              content:  fileObj.content,
            }),
            BOB_SUGGESTION_TIMEOUT_MS,
            `Bob suggestion for ${risk.file}`
          );
          suggestions.push({ file: risk.file, suggestion, diff });
        } catch (err) {
          // Don't fail the whole job if Bob is unavailable or slow for one file
          console.error(`[analyze] Bob suggestion failed for ${risk.file}:`, err.message);
          suggestions.push({
            file: risk.file,
            suggestion: `AI suggestion unavailable: ${err.message}`,
            diff: '',
          });
        }
      }
      updateJob(job.id, { suggestions });

      // Step 5 — Executive summary
      const highCount   = risks.filter(r => r.severity === 'high').length;
      const mediumCount = risks.filter(r => r.severity === 'medium').length;
      const lowCount    = risks.filter(r => r.severity === 'low').length;
      const languages   = [...new Set(files.map(f => f.language))];

      let executiveSummary = '';
      try {
        executiveSummary = await withTimeout(
          generateExecutiveSummary({
            fileCount: files.length,
            languages,
            highCount,
            mediumCount,
            lowCount,
            healthScore: 0,
          }),
          BOB_SUGGESTION_TIMEOUT_MS,
          'Bob executive summary'
        );
      } catch (err) {
        console.error('[analyze] Executive summary generation failed:', err.message);
        executiveSummary = 'Executive summary unavailable — Bob API not reachable or timed out.';
      }

      // Step 6 — Compile report
      const report = compileReport({
        jobId: job.id,
        files,
        dependencyGraph,
        risks,
        suggestions,
        executiveSummary,
      });

      updateJob(job.id, { report, status: 'done' });
      console.log(`[analyze] Job ${job.id} completed. Health score: ${report.healthScore}`);
    } catch (err) {
      console.error(`[analyze] Job ${job.id} failed:`, err);
      updateJob(job.id, { status: 'error', error: err.message });
    }
  })();
});

// ── GET /api/analyze/:jobId/status ────────────────────────────────────────────
router.get('/:jobId/status', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ status: job.status, error: job.error || null });
});

module.exports = router;
