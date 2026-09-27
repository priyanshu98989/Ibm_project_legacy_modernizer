/**
 * server/src/app.js
 * Express application, with no listener attached.
 *
 * The app is exported rather than started so the same routes can be mounted two
 * ways: index.js calls app.listen() for local development, and the Vercel
 * function in api/[...path].js hands this exact app to the platform's Node
 * runtime, which invokes it per request instead of holding a socket open.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const uploadRoutes = require('./routes/upload');
const analyzeRoutes = require('./routes/analyze');
const reportRoutes = require('./routes/report');
const demoRoutes = require('./routes/demo');
const { backendName } = require('./store/jobs');
const { blobEnabled } = require('./services/storage');

const app = express();

// Behind Vercel (or any reverse proxy) req.ip and secure-cookie checks need the
// proxy hop to be trusted.
app.set('trust proxy', true);
app.disable('x-powered-by');

// ── Middleware ──────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Routes ─────────────────────────────────────────────────────────────────────
// POST   /api/upload/token         — client-upload token for Vercel Blob
// POST   /api/upload/commit        — register an uploaded blob as a job
// POST   /api/upload               — multipart upload (no Blob) or repo URL
app.use('/api/upload', uploadRoutes);

// POST /api/analyze/:jobId         — runs the whole pipeline, returns the report
app.use('/api/analyze', analyzeRoutes);

// GET  /api/report/:jobId          — returns compiled report JSON
// GET  /api/report/:jobId/markdown — returns Markdown export
app.use('/api/report', reportRoutes);

// GET  /api/demo                   — list demo fixtures
// POST /api/demo/:name/analyze     — analyse a fixture in one invocation
app.use('/api/demo', demoRoutes);

// ── Health / diagnostics ───────────────────────────────────────────────────────
// Reports which optional backends came up, which is the first thing to check
// when a deployed job misbehaves.
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    jobStore: backendName(),
    blob: blobEnabled() ? 'enabled' : 'disabled',
  });
});

// ── Static client ──────────────────────────────────────────────────────────────
//
// On Vercel the client is served by the static build (outputDirectory
// client/dist) and this block never runs, because client/dist is not part of the
// function bundle.  vercel.json rewrites /api/:path* to this single function, so
// the API is unaffected by the static build serving index.html for unmatched
// paths.
//
// This block exists for local production preview only: `npm run build --prefix
// client` followed by `npm start` serves the built client from the same Express
// app.  During `npm run dev` Vite serves the client on :5173 and this directory
// is absent, so the block is skipped entirely.
const CLIENT_DIST = process.env.CLIENT_DIST
  || path.join(__dirname, '..', '..', 'client', 'dist');

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));

  // Single-page app fallback.  Unknown /api/* paths must still 404 as JSON
  // rather than quietly returning the HTML shell, so they fall through.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ── Error handler ──────────────────────────────────────────────────────────────
// Last line of defence: anything a route threw that had no `status` of its own
// becomes a 500 with a readable message rather than an HTML stack trace.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[app]', err);
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

module.exports = app;
