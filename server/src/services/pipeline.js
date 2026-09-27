/**
 * server/src/services/pipeline.js
 * The full analysis pipeline, written to complete inside ONE serverless
 * invocation.
 *
 * This is the piece that had to change most for Vercel.  Previously the route
 * responded immediately and ran the work in a floating async IIFE that the
 * client then polled.  A serverless function is frozen the moment it sends its
 * response, so that pattern cannot work: the work has to be awaited before the
 * response goes out.
 *
 * Consequence: everything must fit inside the function's max duration.  The Bob
 * calls used to run one after another, and with the default 90 s timeout and 5
 * files that is 450 s of wall clock — over the 300 s ceiling on Hobby.  They now
 * run concurrently, which makes the stage cost one timeout, not five, and the
 * per-file and executive-summary calls overlap as well.
 */

const { scanDirectory } = require('./fileScanner');
const { buildDependencyGraph } = require('./dependencyMapper');
const { scoreFiles } = require('./riskScorer');
const { generateSuggestion, generateExecutiveSummary } = require('./bobClient');
const { compileReport } = require('./reportCompiler');

/** How many risky files get AI suggestions. */
const MAX_BOB_SUGGESTIONS = parseInt(process.env.MAX_BOB_SUGGESTIONS || '5', 10);

/**
 * Hard cap on supported source files.  Generous for a long-lived server, but a
 * serverless function has a hard memory and duration ceiling, so deployments
 * normally lower this (see vercel.json).
 */
const MAX_FILES = parseInt(process.env.MAX_FILES || '5000', 10);

/**
 * Total source text held on the heap at once.  This is the real memory guard —
 * MAX_FILES alone does not bound it, since a handful of huge files can exhaust
 * the heap just as easily as thousands of small ones.
 */
const MAX_TOTAL_SOURCE_BYTES = parseInt(process.env.MAX_TOTAL_SOURCE_BYTES || '268435456', 10);

/** Per-call Bob timeout. */
const BOB_SUGGESTION_TIMEOUT_MS = parseInt(process.env.BOB_SUGGESTION_TIMEOUT_MS || '90000', 10);

/** Languages the scanner recognises. Kept in sync with fileScanner. */
const SUPPORTED_HINT =
  'expected .java, .cbl/.cob/.cobol, or .js/.jsx';

/**
 * Reject a promise that has not settled within `ms`.
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {string} label
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

/**
 * Run scan → dependency graph → risk scoring → Bob suggestions → report.
 *
 * Resolves with the compiled report.  Rejects with an Error carrying a
 * `status` property when the input is unusable (no files, too large, …) so the
 * route can turn it straight into an HTTP response.
 *
 * @param {{ jobId: string, workDir: string }} params
 * @returns {Promise<object>} the compiled report
 */
async function runPipeline({ jobId, workDir }) {
  // ── Step 1 — Scan files ──────────────────────────────────────────────────────
  const files = scanDirectory(workDir, workDir);

  if (files.length === 0) {
    throw Object.assign(
      new Error(`No supported source files found (${SUPPORTED_HINT}).`),
      { status: 422 }
    );
  }
  if (files.length > MAX_FILES) {
    throw Object.assign(
      new Error(
        `Repository is too large: ${files.length} supported files found (limit is ${MAX_FILES}). ` +
        `Upload a smaller subset or increase MAX_FILES in your environment.`
      ),
      { status: 413 }
    );
  }

  const totalBytes = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    throw Object.assign(
      new Error(
        `Repository is too large to analyse: ${(totalBytes / 1024 ** 2).toFixed(0)} MB of source ` +
        `across ${files.length} files (limit is ${(MAX_TOTAL_SOURCE_BYTES / 1024 ** 2).toFixed(0)} MB). ` +
        `Upload a smaller subset or raise MAX_TOTAL_SOURCE_BYTES.`
      ),
      { status: 413 }
    );
  }

  // ── Step 2 — Dependency graph (pure CPU) ─────────────────────────────────────
  const dependencyGraph = buildDependencyGraph(files);

  // ── Step 3 — Static risk scoring (pure CPU) ──────────────────────────────────
  const risks = scoreFiles(files);

  // ── Steps 4 & 5 — Bob, all calls concurrent ──────────────────────────────────
  const highCount   = risks.filter(r => r.severity === 'high').length;
  const mediumCount = risks.filter(r => r.severity === 'medium').length;
  const lowCount    = risks.filter(r => r.severity === 'low').length;
  const languages   = [...new Set(files.map(f => f.language))];

  const topRisks = risks.slice(0, MAX_BOB_SUGGESTIONS);

  const suggestionPromises = topRisks.map(async (risk) => {
    const fileObj = files.find(f => f.path === risk.file);
    if (!fileObj) return null;
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
      return { file: risk.file, suggestion, diff };
    } catch (err) {
      // One unreachable file must not sink the whole report.
      return {
        file: risk.file,
        suggestion: `AI suggestion unavailable: ${err.message}`,
        diff: '',
      };
    }
  });

  const summaryPromise = withTimeout(
    generateExecutiveSummary({
      fileCount: files.length,
      languages,
      highCount,
      mediumCount,
      lowCount,
      healthScore: 0, // filled in below once the report is compiled
    }),
    BOB_SUGGESTION_TIMEOUT_MS,
    'Bob executive summary'
  ).catch(err => {
    console.error('[pipeline] Executive summary failed:', err.message);
    return 'Executive summary unavailable — Bob API not reachable or timed out.';
  });

  // Both stages settle together, so the stage costs one Bob timeout overall.
  const [suggestionResults, executiveSummary] = await Promise.all([
    Promise.all(suggestionPromises),
    summaryPromise,
  ]);

  const suggestions = suggestionResults.filter(Boolean);

  // ── Step 6 — Compile report ──────────────────────────────────────────────────
  const report = compileReport({
    jobId,
    files,
    dependencyGraph,
    risks,
    suggestions,
    executiveSummary,
  });

  return report;
}

module.exports = {
  runPipeline,
  withTimeout,
  MAX_FILES,
  MAX_TOTAL_SOURCE_BYTES,
  MAX_BOB_SUGGESTIONS,
  BOB_SUGGESTION_TIMEOUT_MS,
};
