/**
 * client/src/api.js
 * Centralised API helper functions.  All calls go through Vite's dev proxy → localhost:3001.
 */

import axios from 'axios';

const BASE = '/api';

/**
 * Upload a ZIP file.
 * @param {File} file
 * @param {(progress: number) => void} onProgress
 * @returns {Promise<{ jobId: string }>}
 */
export async function uploadZip(file, onProgress) {
  const form = new FormData();
  form.append('zipfile', file);
  const { data } = await axios.post(`${BASE}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded / e.total) * 100)),
  });
  return data;
}

/**
 * Submit a GitHub repo URL for cloning.
 * @param {string} repoUrl
 * @returns {Promise<{ jobId: string }>}
 */
export async function submitRepoUrl(repoUrl) {
  const { data } = await axios.post(`${BASE}/upload`, { repoUrl });
  return data;
}

/**
 * Kick off analysis for a job.
 * @param {string} jobId
 * @returns {Promise<{ status: string, jobId: string }>}
 */
export async function startAnalysis(jobId) {
  const { data } = await axios.post(`${BASE}/analyze/${jobId}`);
  return data;
}

/**
 * Poll the job status.
 * @param {string} jobId
 * @returns {Promise<{ status: string, error: string|null }>}
 */
export async function getJobStatus(jobId) {
  const { data } = await axios.get(`${BASE}/analyze/${jobId}/status`);
  return data;
}

/**
 * Fetch the completed report.
 * @param {string} jobId
 * @returns {Promise<object>}
 */
export async function fetchReport(jobId) {
  const { data } = await axios.get(`${BASE}/report/${jobId}`);
  return data;
}

/**
 * Get the Markdown export URL (triggers browser download).
 * @param {string} jobId
 * @returns {string}
 */
export function markdownExportUrl(jobId) {
  return `${BASE}/report/${jobId}/markdown`;
}

/**
 * List available demo fixtures.
 * @returns {Promise<{ fixtures: { name: string, label: string, languages: string[], files: number }[] }>}
 */
export async function listDemoFixtures() {
  const { data } = await axios.get(`${BASE}/demo`);
  return data;
}

/**
 * Load a demo fixture as a job (no upload required).
 * @param {string} fixtureName
 * @returns {Promise<{ jobId: string }>}
 */
export async function loadDemoFixture(fixtureName) {
  const { data } = await axios.get(`${BASE}/demo/${fixtureName}`);
  return data;
}
