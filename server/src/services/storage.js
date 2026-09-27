/**
 * server/src/services/storage.js
 * Vercel Blob helpers.
 *
 * Why uploads go to Blob at all: Vercel caps a function's request and response
 * body at 4.5 MB, but this app is built around ZIP uploads that can be far
 * larger.  The documented way around the cap is to have the browser PUT the file
 * straight to Blob, so the bytes never pass through a function.  The function
 * only ever sees the resulting blob URL.
 *
 * Blobs are private: an uploaded archive is somebody's source code, and a
 * public blob URL would be a permanent leak.  Reading one back therefore goes
 * through the SDK rather than a plain fetch.
 *
 * When no Blob credentials are present (plain `npm run dev`) the routes fall
 * back to the old multipart upload and these helpers report themselves disabled.
 */

const fs = require('fs');
const { Readable } = require('stream');

/** True when this deployment can talk to Vercel Blob. */
function blobEnabled() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
    (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)
  );
}

/**
 * Build the JSON body a client POSTs to the upload-token route.
 *
 * `handleUpload` multiplexes on the request body's `action` field, so this route
 * serves both the "give me a token" and the "an upload finished" callbacks.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ status: number, body: any }>}
 */
async function handleClientUpload(req) {
  const { handleUpload } = require('@vercel/blob/client');

  const jsonResponse = await handleUpload({
    body: req.body,
    request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // This is the authorisation hook.  Without a check here the store would
      // accept anonymous uploads, so the pathname is constrained to a zip under
      // our own prefix and the size is capped.
      let size = null;
      let filename = null;
      if (clientPayload) {
        try {
          const parsed = JSON.parse(clientPayload);
          size = Number.isFinite(parsed.size) ? parsed.size : null;
          filename = typeof parsed.name === 'string' ? parsed.name : null;
        } catch {
          throw Object.assign(new Error('Malformed clientPayload.'), { status: 400 });
        }
      }

      if (filename && !filename.toLowerCase().endsWith('.zip')) {
        throw Object.assign(new Error('Only .zip files are accepted.'), { status: 400 });
      }

      const maxBytes = maxUploadBytes();
      if (size != null && size > maxBytes) {
        throw Object.assign(
          new Error(`Upload exceeds the ${(maxBytes / 1024 ** 3).toFixed(2)} GB limit.`),
          { status: 413 }
        );
      }

      return {
        allowedContentTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
        maximumSizeInBytes: maxBytes,
        addRandomSuffix: true,
        // Echoed back to onUploadCompleted so the client can be told what landed.
        ...(filename ? { metadata: { filename } } : {}),
      };
    },

    // Runs in a separate webhook invocation after the browser finishes its PUT.
    // The job is deliberately NOT created here: webhook delivery is not
    // instantaneous, so the client instead calls /api/upload/commit once its own
    // upload() promise resolves, which is deterministic.
    onUploadCompleted: async () => {},
  });

  return jsonResponse;
}

/** Upload ceiling, shared by the token route and the commit route. */
function maxUploadBytes() {
  return parseInt(process.env.MAX_UPLOAD_BYTES || String(500 * 1024 * 1024), 10);
}

/**
 * Confirm a blob exists and read its metadata.
 * @param {string} pathnameOrUrl
 * @returns {Promise<{ pathname: string, url: string, size: number }>}
 */
async function statBlob(pathnameOrUrl) {
  const { head } = require('@vercel/blob');
  const info = await head(pathnameOrUrl);
  return { pathname: info.pathname, url: info.url, size: info.size };
}

/**
 * Stream a blob down to a local file.
 *
 * Streamed rather than buffered: a 500 MB ZIP does not belong on the function's
 * heap, and the analysis stage re-reads it from disk anyway.
 *
 * @param {string} pathnameOrUrl
 * @param {string} destPath
 * @returns {Promise<{ pathname: string, url: string, size: number }>}
 */
async function downloadBlobToFile(pathnameOrUrl, destPath) {
  const { get } = require('@vercel/blob');

  const result = await get(pathnameOrUrl, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw Object.assign(new Error('Uploaded archive could not be read back from storage.'), { status: 410 });
  }

  const { pipeline } = require('stream/promises');
  await pipeline(Readable.fromWeb(result.stream), fs.createWriteStream(destPath));

  return { pathname: result.blob.pathname, url: result.blob.url, size: result.blob.size };
}

/**
 * Delete a blob.  Never throws — a failed cleanup must not fail the analysis
 * that already succeeded.
 * @param {string} pathnameOrUrl
 */
async function removeBlob(pathnameOrUrl) {
  if (!pathnameOrUrl) return;
  try {
    const { del } = require('@vercel/blob');
    await del(pathnameOrUrl);
  } catch (err) {
    console.warn(`[storage] Could not delete blob ${pathnameOrUrl}: ${err.message}`);
  }
}

module.exports = {
  blobEnabled,
  handleClientUpload,
  maxUploadBytes,
  statBlob,
  downloadBlobToFile,
  removeBlob,
};
