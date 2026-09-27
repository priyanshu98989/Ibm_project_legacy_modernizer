/**
 * server/src/store/jobs.js
 * In-memory job store.  Keyed by jobId (UUID).
 * Each job holds: { status, workDir, files, dependencyGraph, risks, suggestions, report }
 *
 * For an MVP this is perfectly fine — no DB required.
 * For production, swap this out for Redis or a database.
 */

const jobs = new Map();

/**
 * Create a new job entry.
 * @param {string} id - UUID
 * @returns {object} the new job record
 */
function createJob(id) {
  const job = {
    id,
    status: 'pending',   // pending | parsing | analyzing | done | error
    workDir: null,       // path on disk to extracted codebase
    files: [],           // [{ path, language, content }]
    dependencyGraph: { nodes: [], edges: [] },
    risks: [],           // [{ file, severity, issues: [] }]
    suggestions: [],     // [{ file, suggestion, diff }]
    report: null,        // compiled report object
    error: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

/** Retrieve a job by id. Returns undefined if not found. */
function getJob(id) {
  return jobs.get(id);
}

/** Partially update a job. */
function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) throw new Error(`Job ${id} not found`);
  Object.assign(job, patch);
  return job;
}

module.exports = { createJob, getJob, updateJob };
