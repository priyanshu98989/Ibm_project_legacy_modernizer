/**
 * server/src/index.js
 * Express entry point — mounts all routes and starts the HTTP server.
 */

require('dotenv').config();

// ── Required env var validation ───────────────────────────────────────────────
// Fail fast with a clear message rather than a cryptic runtime error later.
const REQUIRED_ENV = ['BOB_API_URL'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `[server] FATAL: Missing required environment variable(s): ${missing.join(', ')}\n` +
    `        Copy server/.env.example to server/.env and fill in the values.`
  );
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const uploadRoutes = require('./routes/upload');
const analyzeRoutes = require('./routes/analyze');
const reportRoutes = require('./routes/report');
const demoRoutes   = require('./routes/demo');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
// POST /api/upload        — accepts ZIP file or GitHub URL, returns jobId
app.use('/api/upload', uploadRoutes);

// POST /api/analyze/:jobId — runs parsing + Bob analysis, returns full result
app.use('/api/analyze', analyzeRoutes);

// GET  /api/report/:jobId  — returns compiled report JSON
// GET  /api/report/:jobId/markdown — returns Markdown export
app.use('/api/report', reportRoutes);

// GET  /api/demo            — list available demo fixtures
// GET  /api/demo/:name      — load a fixture as a job, returns { jobId }
app.use('/api/demo', demoRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Legacy Code Modernizer API listening on http://localhost:${PORT}`);
});
