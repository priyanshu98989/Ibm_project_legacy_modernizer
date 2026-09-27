/**
 * server/src/index.js
 * Local development entry point — starts the HTTP server.
 *
 * Deployed, api/[...path].js requires app.js directly and the platform calls it
 * per request; nothing here is involved.  The split exists because a serverless
 * function must never call listen().
 */

require('dotenv').config();

// A missing Bob endpoint is a warning, not a fatal error.
//
// It used to be fatal, which was reasonable when the server was a long-lived
// local process.  It is wrong now for two reasons: the deployment may legitimately
// run without AI suggestions (the static risk analysis and dependency graph do
// not need Bob), and Bob's address is frequently only knowable at request time.
// services/bobClient.js has a circuit breaker so an unreachable Bob degrades the
// report instead of stalling the job.
if (!process.env.BOB_API_URL) {
  console.warn(
    '[server] WARNING: BOB_API_URL is not set. Analysis will run, but AI ' +
    'modernization suggestions and the executive summary will be unavailable.'
  );
}

const app = require('./app');
const { backendName } = require('./store/jobs');
const { blobEnabled } = require('./services/storage');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[server] Legacy Code Modernizer API listening on http://localhost:${PORT}`);
  console.log(`[server] job store: ${backendName()} · blob storage: ${blobEnabled() ? 'enabled' : 'disabled'}`);
  if (!blobEnabled()) {
    console.log('[server] No BLOB_READ_WRITE_TOKEN — large uploads use the multipart path.');
  }
});
