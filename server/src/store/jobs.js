/**
 * server/src/store/jobs.js
 * Job store with two interchangeable backends.
 *
 * On Vercel the in-process Map used previously cannot work: every request may be
 * served by a fresh function isolate, so a job created by one invocation is
 * invisible to the next.  Jobs therefore live in Upstash Redis (which is what
 * Vercel KV hands you) whenever KV_REST_API_URL / REDIS_URL is present.
 *
 * Locally there is no Redis, so the store falls back to an in-process Map and
 * `npm run dev` keeps working with zero configuration.  The Map backend is
 * explicitly NOT safe across multiple processes — only the Redis backend is.
 *
 * Everything here is async, including the Map-backed path, so callers never
 * have to care which backend is live.
 *
 * Two keys per job, deliberately kept apart:
 *   lcm:job:<id>    small mutable record  (status, source, timestamps)
 *   lcm:report:<id> the compiled report    (written once, read by /api/report)
 *
 * The uploaded source never goes in Redis.  It lives in Vercel Blob until the
 * analysis invocation consumes it — a 256 MB codebase has no business inside a
 * Redis value, and Redis values have a hard per-value size cap anyway.
 */

const { createClient: createMemoryClient } = require('./memoryStore');
const { createClient: createRedisClient } = require('./redisStore');

/** How long a finished job and its report stay readable. */
const JOB_TTL_SECONDS = parseInt(process.env.JOB_TTL_SECONDS || '86400', 10); // 24 h

/**
 * Pick a backend.  Redis is used whenever its connection details are present.
 * @returns {{ createJob: Function, getJob: Function, updateJob: Function,
 *             saveReport: Function, getReport: Function, deleteJob: Function,
 *             backend: string }}
 */
function createStore() {
  const hasRedis = Boolean(
    process.env.KV_REST_API_URL ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_URL
  );
  return hasRedis ? createRedisClient(JOB_TTL_SECONDS) : createMemoryClient(JOB_TTL_SECONDS);
}

let store = createStore();

/**
 * Re-read backend configuration from the environment.  Needed because
 * `dotenv.config()` runs before this module is first required in local dev, but
 * a serverless cold start can load env later via the platform.
 */
function refresh() {
  store = createStore();
  return store.backend;
}

const createJob     = (...a) => store.createJob(...a);
const getJob        = (...a) => store.getJob(...a);
const updateJob     = (...a) => store.updateJob(...a);
const saveReport    = (...a) => store.saveReport(...a);
const getReport     = (...a) => store.getReport(...a);
const deleteJob     = (...a) => store.deleteJob(...a);
const backendName   = () => store.backend;

module.exports = {
  createJob,
  getJob,
  updateJob,
  saveReport,
  getReport,
  deleteJob,
  refresh,
  backendName,
  JOB_TTL_SECONDS,
};
