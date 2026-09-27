/**
 * server/src/services/bobClient.js
 * Thin wrapper around the Bob (IBM Bob) REST API.
 *
 * Bob is used for:
 *   1. Generating natural-language modernization suggestions per flagged file.
 *   2. Producing a "before vs. after" code diff or pseudocode for the riskiest sections.
 *
 * Configuration (via .env):
 *   BOB_API_URL  — full URL to the Bob chat completions endpoint
 *                  e.g. http://localhost:11434/api/chat
 *   BOB_API_KEY  — API key / Bearer token (leave blank if not required locally)
 *
 * The prompt is designed to be model-agnostic — any instruction-following LLM
 * exposed via the Bob API will work.
 */

const axios = require('axios');

const BOB_API_URL = process.env.BOB_API_URL || 'http://localhost:11434/api/chat';
const BOB_API_KEY = process.env.BOB_API_KEY || '';

// Max characters of source code to include in the Bob prompt (avoid token limits)
const MAX_CODE_CHARS = parseInt(process.env.BOB_MAX_CODE_CHARS || '1500', 10);

// ── Circuit breaker ────────────────────────────────────────────────────────────
//
// On a serverless platform a misconfigured BOB_API_URL is the single most likely
// failure mode: `http://localhost:11434` resolves to the function's own empty
// container, and every call then sits there until it times out.  With five
// suggestion calls in flight that is the entire function budget burned for
// nothing, and the user gets a timeout instead of an explanation.
//
// So: count consecutive *reachability* failures and stop trying.  A refused
// connection, DNS miss, or timeout means Bob is not there at all.  An HTTP
// status from Bob means Bob is there and merely unhappy, which is a different
// problem and must not disable the breaker — a rate-limited Bob would
// otherwise be treated as a dead one.
const REACHABILITY_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT',
]);

const BREAKER_THRESHOLD = parseInt(process.env.BOB_BREAKER_THRESHOLD || '2', 10);
let consecutiveReachabilityFailures = 0;
let breakerOpen = false;

/**
 * Decide whether an error means "Bob is unreachable" versus "Bob replied with
 * an error status".
 * @param {Error & { code?: string }} err
 * @returns {boolean}
 */
function isReachabilityFailure(err) {
  if (err.response) return false;              // Bob answered — it is reachable
  if (REACHABILITY_CODES.has(err.code)) return true;
  return /timeout|timed out|ECONN/i.test(err.message || '');
}

/** Record the outcome of a call and report whether the breaker is now open. */
function recordOutcome(err) {
  if (!err) {
    consecutiveReachabilityFailures = 0;
    return breakerOpen;
  }
  if (isReachabilityFailure(err)) {
    consecutiveReachabilityFailures += 1;
    if (consecutiveReachabilityFailures >= BREAKER_THRESHOLD && !breakerOpen) {
      breakerOpen = true;
      console.error(
        `[bob] Circuit breaker opened after ${consecutiveReachabilityFailures} consecutive ` +
        `reachability failures. Bob is treated as unavailable for the rest of this invocation. ` +
        `Check BOB_API_URL — a localhost address does not work when deployed.`
      );
    }
  }
  return breakerOpen;
}

/** Test seam. */
function _resetBreaker() {
  consecutiveReachabilityFailures = 0;
  breakerOpen = false;
}

/**
 * Sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before retrying a rate-limited request.
 *
 * Groq's 429 body carries an explicit "try again in N seconds", which is far
 * more accurate than a fixed backoff. Fall back to exponential otherwise.
 *
 * @param {number} attempt 1-based retry number
 * @param {any} data Parsed error body, if any
 * @returns {number} milliseconds
 */
function retryDelayMs(attempt, data) {
  const hinted = /try again in ([\d.]+)s/i.exec(JSON.stringify(data || ''));
  if (hinted) {
    return Math.min(30_000, Math.ceil(parseFloat(hinted[1]) * 1000) + 500);
  }
  return Math.min(30_000, 2000 * 2 ** (attempt - 1));
}

/**
 * Send a chat message to Bob and return the assistant's reply as a string.
 *
 * Hosted inference endpoints meter tokens per minute, and the pipeline fires
 * several suggestions at once, so a 429 here is routine rather than fatal — it
 * just means "not right now". Backing off and retrying turns a partially failed
 * report into a complete one, which matters because a single 429 otherwise
 * leaves that file with no advice at all.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function askBob(systemPrompt, userMessage) {
  if (breakerOpen) {
    throw new Error('Bob is unreachable from this deployment (circuit breaker open). Check BOB_API_URL.');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (BOB_API_KEY) headers['Authorization'] = `Bearer ${BOB_API_KEY}`;

  const body = {
    model: process.env.BOB_MODEL || 'granite3.3',   // override via BOB_MODEL env var
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    stream: false,
  };

  const maxAttempts = parseInt(process.env.BOB_MAX_ATTEMPTS || '3', 10);

  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await axios.post(BOB_API_URL, body, { headers, timeout: 120_000 });
      // Handle both OpenAI-style and Ollama-style response shapes
      const data = response.data;
      if (data?.choices?.[0]?.message?.content) {
        recordOutcome(null);
        return data.choices[0].message.content.trim();
      }
      if (data?.message?.content) {
        recordOutcome(null);
        return data.message.content.trim();
      }
      throw new Error('Unexpected Bob API response shape: ' + JSON.stringify(data).slice(0, 200));
    } catch (err) {
      // Rate limited or server-side hiccup: back off and try again. These are
      // not reachability failures, so the breaker stays shut either way.
      const status = err.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (retryable && attempt < maxAttempts) {
        const wait = retryDelayMs(attempt, err.response?.data);
        console.warn(`[bob] ${status} on attempt ${attempt}/${maxAttempts}, retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }

      if (err.response) {
        // Bob answered with an error status. It is reachable, so the breaker stays shut.
        throw new Error(`Bob API error ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 300)}`);
      }
      recordOutcome(err);
      throw err;
    }
  }
}

/**
 * Generate a modernization suggestion for a single flagged file.
 *
 * @param {{
 *   file: string,
 *   language: string,
 *   severity: string,
 *   issues: string[],
 *   content: string,
 * }} riskFile
 * @returns {Promise<{ suggestion: string, diff: string }>}
 */
async function generateSuggestion(riskFile) {
  const { file, language, severity, issues, content } = riskFile;

  // Truncate source code if too long to stay within token limits
  const codeSnippet = content.length > MAX_CODE_CHARS
    ? content.slice(0, MAX_CODE_CHARS) + '\n... [truncated for brevity]'
    : content;

  const systemPrompt = `You are an expert software modernization consultant specialising in legacy ${language.toUpperCase()} codebases.
Your job is to analyse a flagged legacy source file, explain the risks clearly, and propose a concrete modernisation plan.
Always respond in two clearly labelled sections:
1. MODERNIZATION SUGGESTION — explain what to refactor and why, in 3-6 bullet points.
2. BEFORE / AFTER — provide a short code diff or pseudocode showing the most impactful change.
Keep your response concise and actionable. Assume the reader is a senior developer, not a beginner.`;

  const userMessage = `File: ${file}
Language: ${language.toUpperCase()}
Severity: ${severity.toUpperCase()}

Detected issues:
${issues.map(i => `- ${i}`).join('\n')}

Source code (excerpt):
\`\`\`${language}
${codeSnippet}
\`\`\`

Please provide your modernisation suggestion and a before/after diff for the most critical issue.`;

  const response = await askBob(systemPrompt, userMessage);

  // Split response into suggestion and diff sections
  const diffIdx = response.indexOf('BEFORE / AFTER');
  if (diffIdx !== -1) {
    return {
      suggestion: response.slice(0, diffIdx).replace(/^MODERNIZATION SUGGESTION[\s\S]*?\n/, '').trim(),
      diff: response.slice(diffIdx).trim(),
    };
  }

  // Fallback: return entire response as suggestion
  return { suggestion: response, diff: '' };
}

/**
 * Generate a high-level executive summary for the overall codebase.
 *
 * @param {{
 *   fileCount: number,
 *   languages: string[],
 *   highCount: number,
 *   mediumCount: number,
 *   lowCount: number,
 *   healthScore: number,
 * }} stats
 * @returns {Promise<string>}
 */
async function generateExecutiveSummary(stats) {
  const systemPrompt = `You are an expert software modernization consultant.
Write a concise executive summary (3-4 sentences) for a legacy codebase analysis report.
Focus on business risk and actionable next steps. Avoid jargon.`;

  const userMessage = `Codebase statistics:
- Total files analysed: ${stats.fileCount}
- Languages: ${stats.languages.join(', ')}
- High-risk files: ${stats.highCount}
- Medium-risk files: ${stats.mediumCount}
- Low-risk files: ${stats.lowCount}
- Overall health score: ${stats.healthScore}/100

Write the executive summary.`;

  return askBob(systemPrompt, userMessage);
}

module.exports = { generateSuggestion, generateExecutiveSummary, _resetBreaker };
