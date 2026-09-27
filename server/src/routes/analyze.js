/**
 * server/src/routes/analyze.js
 * POST /api/analyze/:jobId
 *
 * Materialises the job's source, runs the whole pipeline, stores the report, and
 * returns it — all inside a single invocation.
 *
 * This is the core of the Vercel migration.  The original route replied
 * `{ status: 'analyzing' }` immediately and ran the work in a floating async
 * IIFE that the client then polled every two seconds.  That depends on a process
 * staying alive between requests, which is exactly what a serverless function
 * does not do: it is frozen the instant the response is sent, and the next
 * request may not even land in the same container.  With jobs in Redis the
 * polling is no longer needed for correctness, so the work is simply awaited and
 * the report comes back in the same response.
 *
 * GET /:jobId/status is kept purely as a debugging aid.
 */

const express = require('express');
const { getJob, updateJob, saveReport, getReport } = require('../store/jobs');
const { runPipeline } = require('../services/pipeline');
const { prepareWorkspace, cleanupWorkspace, removeBlob } = require('../services/workspace');

const router = express.Router();

/**
 * A job stuck in `analyzing` is usually an invocation that was killed by the
 * platform's duration limit rather than one still running.  After this long it
 * is safe for a new request to take the job over.
 */
const STALE_ANALYSIS_MS = parseInt(process.env.STALE_ANALYSIS_MS || '300000', 10); // 5 min

/**
 * Vercel rejects a response body over 4.5 MB with an opaque 413.  The report is
 * the only large thing we return, so it is measured before sending and reported
 * as a normal error the client can display.
 */
const MAX_REPORT_BYTES = parseInt(process.env.MAX_REPORT_BYTES || String(4 * 1024 * 1024), 10);

/** True when `analyzing` is stale enough to reclaim. */
function isStale(job) {
  if (job.status !== 'analyzing') return false;
  const startedAt = new Date(job.startedAt || job.createdAt).getTime();
  return Date.now() - startedAt > STALE_ANALYSIS_MS;
}

/** Is this invocation the one that should do the work? */
function shouldRun(job) {
  if (job.status !== 'analyzing') return true;
  return isStale(job);
}

// ── POST /api/analyze/:jobId ──────────────────────────────────────────────────
router.post('/:jobId', async (req, res, next) => {
  let job;
  try {
    job = await getJob(req.params.jobId);
  } catch (err) {
    return next(err);
  }
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });

  // Already finished — serve the stored report.  Makes a retried request cheap
  // and idempotent.
  if (job.status === 'done') {
    const report = await getReport(job.id);
    if (report) return res.json({ status: 'done', jobId: job.id, report });
    return res.status(410).json({ error: 'Report is no longer available for this job.' });
  }

  if (job.status === 'error') {
    return res.status(422).json({ error: job.error || 'Analysis previously failed.', jobId: job.id });
  }

  // Another invocation holds this job.  Let it finish rather than duplicating
  // the work; the client is still awaiting the original response.
  if (!shouldRun(job)) {
    return res.status(409).json({
      status: 'analyzing',
      jobId: job.id,
      error: 'This analysis is already running. Retry shortly to collect the report.',
    });
  }

  const startedAt = new Date().toISOString();

  try {
    await updateJob(job.id, { status: 'analyzing', startedAt, error: null });

    const { workDir, cleanupBlob } = await prepareWorkspace(job);

    const report = await runPipeline({ jobId: job.id, workDir });

    const reportBytes = Buffer.byteLength(JSON.stringify(report), 'utf8');
    if (reportBytes > MAX_REPORT_BYTES) {
      throw Object.assign(
        new Error(
          `The report for this codebase is ${(reportBytes / 1024 ** 2).toFixed(1)} MB, over the ` +
          `${(MAX_REPORT_BYTES / 1024 ** 2).toFixed(1)} MB response limit. ` +
          `Analyse a smaller subset — a lower MAX_FILES will keep reports within the limit.`
        ),
        { status: 413 }
      );
    }

    await saveReport(job.id, report);
    await updateJob(job.id, { status: 'done', reportBytes, finishedAt: new Date().toISOString() });

    // The archive has served its purpose.  Not awaiting is fine — removeBlob
    // never throws, and holding the response open for a cleanup round trip
    // would eat into the duration budget.
    removeBlob(cleanupBlob);

    console.log(`[analyze] Job ${job.id} completed in one invocation. Health score: ${report.healthScore}`);
    return res.json({ status: 'done', jobId: job.id, report });
  } catch (err) {
    try {
      await updateJob(job.id, { status: 'error', error: err.message });
    } catch (storeErr) {
      console.error('[analyze] Could not record failure:', storeErr.message);
    }
    return next(err);
  } finally {
    // Runs on both paths.  The scratch directory is dead weight once the
    // response is written, and on Vercel /tmp is wiped anyway.
    cleanupWorkspace(job.id);
  }
});

// ── GET /api/analyze/:jobId/status ────────────────────────────────────────────
// Debugging aid: on a deployed function the invocation logs are not always
// reachable, so this is the quickest way to see where a job got to.
router.get('/:jobId/status', async (req, res, next) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
    res.json({
      status: job.status,
      error: job.error || null,
      sourceType: job.source?.type || null,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      reportBytes: job.reportBytes || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
