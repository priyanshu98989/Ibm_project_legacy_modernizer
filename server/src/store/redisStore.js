/**
 * server/src/store/redisStore.js
 * Upstash Redis job store — the backend that actually works when deployed.
 *
 * Connects to Vercel KV (KV_REST_API_URL / KV_REST_API_TOKEN) or any Upstash
 * Redis instance (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN), and also
 * accepts a classic REDIS_URL via the same REST client.
 *
 * Values are JSON-encoded explicitly with automaticDeserialization disabled, so
 * the wire format is exactly what we put there and a plain string stays a plain
 * string.
 */

/**
 * @param {number} ttlSeconds
 */
function createClient(ttlSeconds) {
  const { Redis } = require('@upstash/redis');

  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Redis store selected but connection details are missing. Set KV_REST_API_URL and ' +
      'KV_REST_API_TOKEN (Vercel KV) or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'
    );
  }

  const redis = new Redis({ url, token, automaticDeserialization: false });

  const jobKey    = id => `lcm:job:${id}`;
  const reportKey = id => `lcm:report:${id}`;

  /** Redis caps a single value; refuse to write something that can never come back. */
  const MAX_VALUE_BYTES = 1024 * 1024; // 1 MB

  async function setJson(key, value) {
    const payload = JSON.stringify(value);
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > MAX_VALUE_BYTES) {
      throw Object.assign(
        new Error(
          `Value for ${key} is ${(bytes / 1024 / 1024).toFixed(2)} MB, over the ` +
          `${MAX_VALUE_BYTES / 1024 / 1024} MB Redis value limit. Try a smaller repository.`
        ),
        { status: 413 }
      );
    }
    await redis.set(key, payload, { ex: ttlSeconds });
  }

  async function getJson(key) {
    const raw = await redis.get(key);
    if (raw == null) return null;
    // The client hands back a string when automaticDeserialization is off, but
    // normalise anyway in case a numeric-looking payload came back coerced.
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  return {
    backend: 'redis',

    async createJob({ id, source }) {
      const job = {
        id,
        status: 'pending',
        source,
        error: null,
        createdAt: new Date().toISOString(),
      };
      await setJson(jobKey(id), job);
      return job;
    },

    async getJob(id) {
      return getJson(jobKey(id));
    },

    async updateJob(id, patch) {
      // Read-modify-write.  Concurrent invocations on the same job are not
      // expected (the client drives one request at a time), and a WATCH/MULTI
      // transaction would cost a second round trip for no practical gain.
      const job = await getJson(jobKey(id));
      if (!job) throw new Error(`Job ${id} not found`);
      Object.assign(job, patch);
      await setJson(jobKey(id), job);
      return job;
    },

    async saveReport(id, report) {
      await setJson(reportKey(id), report);
    },

    async getReport(id) {
      return getJson(reportKey(id));
    },

    async deleteJob(id) {
      await redis.del(jobKey(id), reportKey(id));
    },
  };
}

module.exports = { createClient };
