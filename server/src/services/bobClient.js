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
const MAX_CODE_CHARS = 3000;

/**
 * Send a chat message to Bob and return the assistant's reply as a string.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function askBob(systemPrompt, userMessage) {
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

  try {
    const response = await axios.post(BOB_API_URL, body, { headers, timeout: 120_000 });
    // Handle both OpenAI-style and Ollama-style response shapes
    const data = response.data;
    if (data?.choices?.[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    if (data?.message?.content) {
      return data.message.content.trim();
    }
    throw new Error('Unexpected Bob API response shape: ' + JSON.stringify(data).slice(0, 200));
  } catch (err) {
    if (err.response) {
      throw new Error(`Bob API error ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 300)}`);
    }
    throw err;
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

module.exports = { generateSuggestion, generateExecutiveSummary };
