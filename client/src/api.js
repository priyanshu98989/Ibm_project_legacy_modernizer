/**
 * client/src/api.js
 * Centralised API helper functions.
 *
 * BASE is same-origin by default, which is what the single-Vercel-project
 * deployment uses: the static client and the /api function are one origin, so
 * /api/... just works and there is no CORS in the way.  Set VITE_API_BASE when
 * the API lives somewhere else (a split deploy, or a different host during
 * development).
 */

import axios from 'axios';
import { upload as blobUpload } from '@vercel/blob/client';

const BASE = import.meta.env.VITE_API_BASE || '/api';

/** Turn an axios failure into the server's own error message where there is one. */
function toError(err) {
  return new Error(err.response?.data?.error || err.message || 'Request failed.');
}

// ── ZIP upload ─────────────────────────────────────────────────────────────────

/**
 * Upload a ZIP by streaming it from the browser to Vercel Blob.
 *
 * The file never passes through the API, which is what makes it possible to
 * accept archives larger than the 4.5 MB function body limit at all.  The server
 * only ever sees the resulting pathname, in a follow-up commit call.
 */
async function uploadZipViaBlob(file, onProgress) {
  const { pathname } = await blobUpload(`uploads/${file.name}`, file, {
    access: 'private',
    handleUploadUrl: `${BASE}/upload/token`,
    clientPayload: JSON.stringify({ name: file.name, size: file.size }),
    onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
  });

  const { data } = await axios.post(`${BASE}/upload/commit`, { pathname, filename: file.name });
  return data;
}

/** Upload a ZIP through the API itself.  Used when no blob store is configured. */
async function uploadZipViaMultipart(file, onProgress) {
  const form = new FormData();
  form.append('zipfile', file);
  const { data } = await axios.post(`${BASE}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round((e.loaded / e.total) * 100)),
  });
  return data;
}

/**
 * Upload a ZIP file and create a job for it.
 * @param {File} file
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<{ jobId: string }>}
 */
export async function uploadZip(file, onProgress) {
  try {
    return await uploadZipViaBlob(file, onProgress);
  } catch (err) {
    // 501 is the server saying it has no blob store.  Fall back to the
    // multipart route so the same client works against a plain local server.
    if (err.response?.status === 501) {
      return uploadZipViaMultipart(file, onProgress);
    }
    throw toError(err);
  }
}

// ── Repository URL ─────────────────────────────────────────────────────────────

/**
 * Register a GitHub repo URL for analysis.  The clone itself happens during the
 * analyse request, not here.
 * @param {string} repoUrl
 * @returns {Promise<{ jobId: string }>}
 */
export async function submitRepoUrl(repoUrl) {
  try {
    const { data } = await axios.post(`${BASE}/upload`, { repoUrl });
    return data;
  } catch (err) {
    throw toError(err);
  }
}

// ── Analysis ───────────────────────────────────────────────────────────────────

/**
 * Run the analysis and return the finished report.
 *
 * One request, not a poll loop: the analysis is a single server-side unit of
 * work, so it resolves when the report is ready.  A long analysis will hold the
 * connection open, which is why the server's function duration is the ceiling
 * here.
 *
 * @param {string} jobId
 * @returns {Promise<{ status: string, jobId: string, report: object }>}
 */
export async function runAnalysis(jobId) {
  try {
    const { data } = await axios.post(`${BASE}/analyze/${jobId}`, null, { timeout: 0 });
    return data;
  } catch (err) {
    // 409 means a previous attempt is still running or was reclaimed mid-flight.
    if (err.response?.status === 409) {
      const { data } = await axios.get(`${BASE}/analyze/${jobId}/status`);
      if (data.status === 'done') {
        const report = await fetchReport(jobId);
        return { status: 'done', jobId, report };
      }
    }
    throw toError(err);
  }
}

/** Fetch job status.  Debugging aid rather than part of the normal flow. */
export async function getJobStatus(jobId) {
  const { data } = await axios.get(`${BASE}/analyze/${jobId}/status`);
  return data;
}

// ── Report ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a completed report.
 * @param {string} jobId
 * @returns {Promise<object>}
 */
export async function fetchReport(jobId) {
  try {
    const { data } = await axios.get(`${BASE}/report/${jobId}`);
    return data;
  } catch (err) {
    throw toError(err);
  }
}

/**
 * Get the Markdown export URL (triggers browser download).
 * @param {string} jobId
 * @returns {string}
 */
export function markdownExportUrl(jobId) {
  return `${BASE}/report/${jobId}/markdown`;
}

// ── Demo ───────────────────────────────────────────────────────────────────────

/**
 * List available demo fixtures.
 * @returns {Promise<{ fixtures: { name: string, label: string, languages: string[], files: number }[] }>}
 */
export async function listDemoFixtures() {
  const { data } = await axios.get(`${BASE}/demo`);
  return data;
}

/**
 * Analyse a demo fixture and return the report in one request.
 * @param {string} fixtureName
 * @returns {Promise<{ jobId: string, report: object }>}
 */
export async function runDemo(fixtureName) {
  try {
    const { data } = await axios.post(`${BASE}/demo/${fixtureName}/analyze`, null, { timeout: 0 });
    return data;
  } catch (err) {
    throw toError(err);
  }
}
