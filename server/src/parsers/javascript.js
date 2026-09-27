/**
 * server/src/parsers/javascript.js
 * Heuristic static parser for JavaScript/Node.js source files.
 *
 * Extracts:
 *   - ES6 import statements  → dependency edges
 *   - require() calls        → dependency edges
 *   - Nesting depth          → complexity proxy
 *   - console.log/error      → debug code left in production
 *   - eval() usage           → security risk
 *   - TODO/FIXME comments    → unfinished code
 *   - Callbacks / callback hell (nested function depth)
 *   - var declarations       → old-style JS flag
 *   - Hardcoded secrets pattern (password=, apikey=, secret=)
 */

const path = require('path');
const { stripComments, stripCommentsAndStrings, blockNestingDepth } = require('./sanitize');

// ES6: import X from 'y'  or  import { X } from 'y'
const IMPORT_RE = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;

// CommonJS: require('x') or require("x")
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// var declarations (legacy JS)
const VAR_RE = /\bvar\s+\w+/g;

// eval usage — security risk
const EVAL_RE = /\beval\s*\(/g;

// console.log/warn/error left in code
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug)\s*\(/g;

// Hardcoded secret patterns
const SECRET_RE = /(?:password|passwd|apikey|api_key|secret|token)\s*[:=]\s*['"][^'"]{4,}['"]/gi;

// TODO/FIXME comments
const TODO_RE = /\/\/.*\b(TODO|FIXME|HACK|XXX)\b/gi;

// Callback hell proxy: count "function(" or "=>" inside callbacks
const CALLBACK_RE = /\bfunction\s*\(|=>\s*\{/g;

/**
 * Count max *block* nesting depth.
 *
 * Uses the shared block-aware counter so that object literals, JSX expression
 * containers and destructuring patterns are not mistaken for nested logic.
 */
function maxNestingDepth(code) {
  return blockNestingDepth(code);
}

/**
 * Check if this file contains test code (Jest, Mocha, etc.)
 */
function hasTestCode(content) {
  return /\b(describe|it|test)\s*\(/.test(content) ||
         /\bexpect\s*\(/.test(content) ||
         /\.spec\.|\.test\./.test(content);
}

/**
 * Resolve a JS import path to a simple module name for graph edges.
 * Relative imports like './utils' → 'utils'
 * Package imports like 'express' → 'express'
 */
function resolveImportName(importPath) {
  if (importPath.startsWith('.')) {
    // Relative import — take the last segment without extension
    return path.basename(importPath, path.extname(importPath));
  }
  // Package import — take the root package name (before any /)
  return importPath.split('/')[0];
}

/**
 * Parse a JS/TS file and return metadata.
 *
 * @param {{ path: string, content: string }} file
 * @returns {{
 *   imports: string[],
 *   maxNesting: number,
 *   evalCount: number,
 *   consoleCount: number,
 *   varCount: number,
 *   secrets: string[],
 *   todos: string[],
 *   callbackDepth: number,
 *   hasTests: boolean,
 * }}
 */
function extractDependencies(file) {
  const { content } = file;
  const imports = new Set();
  let m;

  // Imports and TODOs must be read from the raw source: module specifiers live
  // inside string literals and TODOs live inside comments, both of which the
  // sanitiser blanks out.
  while ((m = IMPORT_RE.exec(content)) !== null)  imports.add(resolveImportName(m[1]));
  while ((m = REQUIRE_RE.exec(content)) !== null) imports.add(resolveImportName(m[1]));

  // Secrets need the string literal to still be readable, but not the comments.
  const forSecrets = stripComments(content);
  // Everything else matches against executable code only.
  const code = stripCommentsAndStrings(content);

  const evalCount     = (code.match(EVAL_RE)    || []).length;
  const consoleCount  = (code.match(CONSOLE_RE) || []).length;
  const varCount      = (code.match(VAR_RE)     || []).length;
  const callbackDepth = Math.floor(((code.match(CALLBACK_RE) || []).length) / 3);

  const secrets = [];
  SECRET_RE.lastIndex = 0;
  while ((m = SECRET_RE.exec(forSecrets)) !== null) secrets.push(m[0].slice(0, 40));

  const todos = [];
  TODO_RE.lastIndex = 0;
  while ((m = TODO_RE.exec(content)) !== null) todos.push(m[0].trim());

  return {
    imports: [...imports],
    maxNesting: maxNestingDepth(code),
    evalCount,
    consoleCount,
    varCount,
    secrets: secrets.slice(0, 5),
    todos,
    callbackDepth,
    hasTests: hasTestCode(content),
  };
}

module.exports = { extractDependencies, hasTestCode };
