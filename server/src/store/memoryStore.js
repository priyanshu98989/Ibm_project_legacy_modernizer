/**
 * server/src/store/memoryStore.js
 * In-process job store.  Used only when no Redis is configured, so that
 * `npm run dev` works with no external services.
 *
 * NOT safe across processes or across serverless invocations — on Vercel every
 * request can get a fresh isolate, and this store would be empty.  Use
 * redisStore.js for anything deployed.
 */

/**
 * @param {number} ttlSeconds - retained so both backends expire jobs alike
 */
function createClient(ttlSeconds) {
  const jobs = new Map();
  const reports = new Map();

  // Cheap TTL sweep. A full Map walk is fine at this scale; a real deployment
  // uses Redis, which expires keys itself.
  setInterval(() => {
    const cutoff = Date.now() - ttlSeconds * 1000;
    for (const [id, job] of jobs) {
      if (new Date(job.createdAt).getTime() < cutoff) {
        jobs.delete(id);
        reports.delete(id);
      }
    }
  }, 60_000).unref?.();

  return {
    backend: 'memory',

    async createJob({ id, source }) {
      const job = {
        id,
        status: 'pending',   // pending | analyzing | done | error
        source,              // { type: 'blob'|'repo'|'demo', ... }
        error: null,
        createdAt: new Date().toISOString(),
      };
      jobs.set(id, job);
      return job;
    },

    async getJob(id) {
      return jobs.get(id) ?? null;
    },

    async updateJob(id, patch) {
      const job = jobs.get(id);
      if (!job) throw new Error(`Job ${id} not found`);
      Object.assign(job, patch);
      return job;
    },

    async saveReport(id, report) {
      reports.set(id, report);
    },

    async getReport(id) {
      return reports.get(id) ?? null;
    },

    async deleteJob(id) {
      jobs.delete(id);
      reports.delete(id);
    },
  };
}

module.exports = { createClient };
