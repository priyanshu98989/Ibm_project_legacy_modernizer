/**
 * api/index.js
 * Vercel serverless entry point.
 *
 * Vercel treats every file in /api as a function and calls it per request, so
 * this exports the Express app itself rather than starting a listener — a
 * function must never call app.listen(), it has no socket to hold.
 *
 * vercel.json rewrites /api/:path* here, so every /api/* request reaches this
 * one function with its original path intact.  Express then routes
 * /api/upload/commit, /api/analyze/<id> and so on normally.
 *
 * Everything under /api is mounted in app.js, so there is one set of routes and
 * the local `npm run dev` server and this function behave identically.
 */

const app = require('../server/src/app');

module.exports = app;
