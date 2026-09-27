/**
 * server/src/parsers/python.js
 * Heuristic static parser for Python source files.
 *
 * Extracts:
 *   - import statements (→ dependency edges)
 *   - bare `except:` (swallows all exceptions — anti-pattern)
 *   - `print(` calls (debug code / Python 2 style)
 *   - `eval(` / `exec(` usage (security risk)
 *   - Missing type hints on functions (def foo(x): without annotations)
 *   - Mutable default arguments: def foo(x=[]) or def foo(x={})
 *   - TODO/FIXME comments
 *   - Nesting depth (indentation-based proxy)
 *   - Hardcoded secrets
 */

// import foo  or  from foo import bar
const IMPORT_RE = /^(?:import|from)\s+([\w.]+)/gm;

// bare except:  (no exception type specified)
const BARE_EXCEPT_RE = /\bexcept\s*:/g;

// print(  — Python 2 style or debug leftover
const PRINT_RE = /\bprint\s*\(/g;

// eval( or exec(
const EVAL_RE = /\b(eval|exec)\s*\(/g;

// Mutable default argument: def func(arg=[], arg={}, arg=set())
const MUTABLE_DEFAULT_RE = /def\s+\w+\s*\([^)]*=\s*(?:\[|\{|set\s*\()/g;

// Function definition without type annotations
// Matches: def foo(  that does NOT have -> return type
const FUNC_DEF_RE = /^[ \t]*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*:/gm;
const FUNC_WITH_HINT_RE = /^[ \t]*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*->/gm;

// TODO/FIXME in comments
const TODO_RE = /#.*\b(TODO|FIXME|HACK|XXX)\b/gi;

// Hardcoded secrets
const SECRET_RE = /(?:password|passwd|api_key|apikey|secret|token)\s*=\s*['"][^'"]{4,}['"]/gi;

// Console/logging: using print instead of logging
const LOGGING_RE = /\blogging\.(debug|info|warning|error|critical)\s*\(/g;

/**
 * Estimate max indentation depth as proxy for nesting complexity.
 * Counts max leading spaces / 4 (standard Python indent).
 */
function maxIndentDepth(content) {
  let max = 0;
  for (const line of content.split('\n')) {
    const leading = line.match(/^(\s+)/)?.[1]?.length || 0;
    const depth = Math.floor(leading / 4);
    if (depth > max) max = depth;
  }
  return max;
}

function hasTestCode(content) {
  return /\bdef\s+test_\w+/.test(content) ||
         /\bimport\s+pytest\b/.test(content) ||
         /\bunittest\b/.test(content) ||
         /\bassert\s+/.test(content);
}

/**
 * Parse a Python file and return metadata.
 *
 * @param {{ path: string, content: string }} file
 * @returns {{
 *   imports: string[],
 *   bareExceptCount: number,
 *   printCount: number,
 *   evalCount: number,
 *   mutableDefaultCount: number,
 *   missingTypeHints: number,
 *   secrets: string[],
 *   todos: string[],
 *   maxNesting: number,
 *   hasTests: boolean,
 * }}
 */
function extractDependencies(file) {
  const { content } = file;
  let m;

  const imports = new Set();
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    // Take root package name only (e.g. "os.path" → "os")
    imports.add(m[1].split('.')[0]);
  }

  const bareExceptCount    = (content.match(BARE_EXCEPT_RE)    || []).length;
  const printCount         = (content.match(PRINT_RE)          || []).length;
  const evalCount          = (content.match(EVAL_RE)           || []).length;
  const mutableDefaultCount = (content.match(MUTABLE_DEFAULT_RE) || []).length;

  const totalFuncs   = (content.match(FUNC_DEF_RE)       || []).length;
  const typedFuncs   = (content.match(FUNC_WITH_HINT_RE) || []).length;
  const missingTypeHints = Math.max(0, totalFuncs - typedFuncs);

  const secrets = [];
  SECRET_RE.lastIndex = 0;
  while ((m = SECRET_RE.exec(content)) !== null) secrets.push(m[0].slice(0, 40));

  TODO_RE.lastIndex = 0;
  const todos = [];
  while ((m = TODO_RE.exec(content)) !== null) todos.push(m[0].trim());

  return {
    imports: [...imports],
    bareExceptCount,
    printCount,
    evalCount,
    mutableDefaultCount,
    missingTypeHints,
    secrets: secrets.slice(0, 5),
    todos,
    maxNesting: maxIndentDepth(content),
    hasTests: hasTestCode(content),
  };
}

module.exports = { extractDependencies };
