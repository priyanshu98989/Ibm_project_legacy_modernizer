/**
 * server/src/parsers/typescript.js
 * Heuristic static parser for TypeScript source files.
 *
 * Extracts:
 *   - import statements (→ dependency edges)
 *   - `any` / `unknown` type annotations (type-safety risk)
 *   - Missing return types on functions
 *   - `// @ts-ignore` and `// @ts-nocheck` suppressions
 *   - `as any` type assertions (unsafe cast)
 *   - `!` non-null assertions
 *   - console.log/warn/error (debug code)
 *   - eval() usage (security)
 *   - TODO/FIXME comments
 *   - No strict mode (no "strict": true inferred)
 *   - Nesting depth
 */

// ES6 imports
const IMPORT_RE = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;
// require()
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// : any  or  <any>  or  Array<any>
const ANY_TYPE_RE = /:\s*any\b|<any>|Array<any>|\bany\[\]/g;

// as any  — unsafe type assertion
const AS_ANY_RE = /\bas\s+any\b/g;

// Non-null assertion: foo!.bar  or  foo!
const NON_NULL_RE = /\w!\s*[.[(]/g;

// @ts-ignore or @ts-nocheck
const TS_SUPPRESS_RE = /\/\/\s*@ts-(ignore|nocheck|expect-error)/gi;

// Functions/methods without explicit return type annotation
// Matches:  function foo(  or  async function foo(  or  ) {  without ): Type
// Heuristic: arrow functions or regular functions without ): return_type
const MISSING_RETURN_TYPE_RE = /(?:^|\s)(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/gm;
const HAS_RETURN_TYPE_RE     = /(?:^|\s)(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*:\s*\w/gm;

// console.log/warn/error
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug)\s*\(/g;

// eval()
const EVAL_RE = /\beval\s*\(/g;

// TODO/FIXME
const TODO_RE = /\/\/.*\b(TODO|FIXME|HACK|XXX)\b/gi;

// Hardcoded secrets
const SECRET_RE = /(?:password|passwd|apikey|api_key|secret|token)\s*[:=]\s*['"][^'"]{4,}['"]/gi;

const path = require('path');

function maxNestingDepth(content) {
  let depth = 0, max = 0;
  for (const ch of content) {
    if (ch === '{') { depth++; if (depth > max) max = depth; }
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return max;
}

function hasTestCode(content) {
  return /\b(describe|it|test)\s*\(/.test(content) ||
         /\bexpect\s*\(/.test(content) ||
         /\.spec\.|\.test\./.test(content);
}

function resolveImportName(importPath) {
  if (importPath.startsWith('.')) {
    return path.basename(importPath, path.extname(importPath));
  }
  return importPath.split('/')[0];
}

/**
 * Parse a TypeScript file and return metadata.
 *
 * @param {{ path: string, content: string }} file
 * @returns {{
 *   imports: string[],
 *   anyTypeCount: number,        // : any / <any> / as any usages
 *   asAnyCount: number,          // explicit `as any` casts
 *   nonNullCount: number,        // ! non-null assertions
 *   tsSuppressionCount: number,  // @ts-ignore / @ts-nocheck
 *   missingReturnTypes: number,  // functions without return type annotation
 *   consoleCount: number,
 *   evalCount: number,
 *   secrets: string[],
 *   todos: string[],
 *   maxNesting: number,
 *   hasTests: boolean,
 * }}
 */
function extractDependencies(file) {
  const { content } = file;
  const imports = new Set();
  let m;

  IMPORT_RE.lastIndex = 0;
  REQUIRE_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null)  imports.add(resolveImportName(m[1]));
  while ((m = REQUIRE_RE.exec(content)) !== null) imports.add(resolveImportName(m[1]));

  const anyTypeCount        = (content.match(ANY_TYPE_RE)       || []).length;
  const asAnyCount          = (content.match(AS_ANY_RE)         || []).length;
  const nonNullCount        = (content.match(NON_NULL_RE)       || []).length;
  const tsSuppressionCount  = (content.match(TS_SUPPRESS_RE)    || []).length;
  const consoleCount        = (content.match(CONSOLE_RE)        || []).length;
  const evalCount           = (content.match(EVAL_RE)           || []).length;

  // Rough missing-return-type count: total function defs minus those with explicit return type
  const totalFns      = (content.match(MISSING_RETURN_TYPE_RE) || []).length;
  const typedFns      = (content.match(HAS_RETURN_TYPE_RE)     || []).length;
  const missingReturnTypes = Math.max(0, totalFns - typedFns);

  const secrets = [];
  SECRET_RE.lastIndex = 0;
  while ((m = SECRET_RE.exec(content)) !== null) secrets.push(m[0].slice(0, 40));

  TODO_RE.lastIndex = 0;
  const todos = [];
  while ((m = TODO_RE.exec(content)) !== null) todos.push(m[0].trim());

  return {
    imports: [...imports],
    anyTypeCount,
    asAnyCount,
    nonNullCount,
    tsSuppressionCount,
    missingReturnTypes,
    consoleCount,
    evalCount,
    secrets: secrets.slice(0, 5),
    todos,
    maxNesting: maxNestingDepth(content),
    hasTests: hasTestCode(content),
  };
}

module.exports = { extractDependencies };
