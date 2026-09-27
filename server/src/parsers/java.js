/**
 * server/src/parsers/java.js
 * Heuristic static parser for Java source files.
 *
 * Extracts:
 *   - import statements (→ dependency edges)
 *   - class/interface declarations
 *   - method signatures (for nesting depth calculation)
 *   - legacy collection usage (Vector, Hashtable, Stack, Enumeration)
 *   - raw types / unchecked casts
 *   - missing try-with-resources (manual close() patterns)
 *
 * Assumption: we use regex-based heuristics, NOT a full AST parser.
 * This is intentional for MVP speed; it handles the vast majority of
 * real-world Java patterns and is good enough for risk flagging.
 */

const path = require('path');

// Matches:  import com.example.Foo;   or  import static java.util.Arrays.*;
const IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;

// Matches method or constructor declarations to estimate nesting
const METHOD_RE = /(?:public|protected|private|static|final|synchronized|native|abstract)\s+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/g;

// Matches deprecated annotation
const DEPRECATED_RE = /@Deprecated/g;

// Matches Thread.sleep, System.exit, Runtime.getRuntime, finalize() — common anti-patterns
const ANTIPATTERN_RE = /\b(Thread\.sleep|System\.exit|Runtime\.getRuntime|\.finalize\s*\(|new\s+Thread\s*\(|catch\s*\(\s*Exception\s+|catch\s*\(\s*Throwable\s+)/g;

// Matches TODO/FIXME/HACK comments
const TODO_RE = /\/\/.*\b(TODO|FIXME|HACK|XXX)\b/gi;

// ── Legacy collection patterns ────────────────────────────────────────────────
// new Vector(), new Hashtable(), new Stack() — pre-Java-2 thread-safe collections
const LEGACY_COLLECTION_RE = /\bnew\s+(Vector|Hashtable|Stack)\s*[<(]/g;

// Variable declarations using legacy types (catches both raw and generic forms)
const LEGACY_TYPE_DECL_RE = /\b(Vector|Hashtable|Stack|Enumeration)\s*(?:<[^>]*>)?\s+\w+/g;

// Raw type usage: unparameterised List, Map, Set, Collection, Iterator, ArrayList, HashMap
// e.g. "List foo" or "ArrayList bar" without a <Type>
const RAW_TYPE_RE = /\b(List|Map|Set|Collection|Iterator|ArrayList|HashMap|LinkedList|HashSet|TreeMap|TreeSet)\s+\w+\s*[=;,)]/g;

// Unchecked cast: (TypeName) expression — very rough heuristic
// Matches patterns like: (String) e.nextElement()  or  (MyClass) obj
const UNCHECKED_CAST_RE = /\(\s*[A-Z][A-Za-z0-9_]*\s*\)\s*\w/g;

// Missing try-with-resources: .close() called in finally block or without try-with-resources
// Heuristic: detect explicit .close() calls (suggests manual resource management)
const MANUAL_CLOSE_RE = /\.\s*close\s*\(\s*\)/g;

// try-with-resources: try (Resource r = ...) — if present, .close() is managed properly
const TRY_WITH_RESOURCES_RE = /\btry\s*\(/g;

/**
 * Count the maximum brace-nesting depth in a source string.
 * This is a proxy for cyclomatic complexity / deeply nested logic.
 * @param {string} content
 * @returns {number}
 */
function maxNestingDepth(content) {
  let depth = 0;
  let max = 0;
  for (const ch of content) {
    if (ch === '{') { depth++; if (depth > max) max = depth; }
    else if (ch === '}') { depth = Math.max(0, depth - 1); }
  }
  return max;
}

/**
 * Rough estimate of whether there are unit tests for this file.
 * Looks for JUnit annotations or TestCase extends.
 * @param {string} content
 * @returns {boolean} true if the file itself contains test code
 */
function hasTestCode(content) {
  return /@Test\b/.test(content) || /extends\s+TestCase\b/.test(content);
}

/**
 * Detect legacy collection usage (Vector, Hashtable, Stack, Enumeration).
 * @param {string} content
 * @returns {string[]} unique legacy type names found
 */
function findLegacyCollections(content) {
  const found = new Set();
  let m;
  // Reset regex state before use (global regexes retain lastIndex)
  LEGACY_COLLECTION_RE.lastIndex = 0;
  LEGACY_TYPE_DECL_RE.lastIndex  = 0;
  while ((m = LEGACY_COLLECTION_RE.exec(content)) !== null) found.add(m[1]);
  while ((m = LEGACY_TYPE_DECL_RE.exec(content))  !== null) found.add(m[1]);
  return [...found];
}

/**
 * Detect raw type usage (collections used without generic type parameters).
 * @param {string} content
 * @param {string[]} imports - already-extracted imports (to avoid false positives)
 * @returns {number} count of raw-type variable declarations
 */
function countRawTypes(content) {
  RAW_TYPE_RE.lastIndex = 0;
  const matches = content.match(RAW_TYPE_RE) || [];
  // Filter out lines that already have a generic parameter in the same declaration context
  // by checking if the match position is preceded by "<something>" — simple heuristic
  return matches.filter(m => !/</.test(m)).length;
}

/**
 * Detect unchecked casts (e.g. (String) e.nextElement()).
 * Returns the count of likely unchecked casts.
 * @param {string} content
 * @returns {number}
 */
function countUncheckedCasts(content) {
  UNCHECKED_CAST_RE.lastIndex = 0;
  // Exclude common false positives: (this), (null), (int), (long), primitive casts
  const primitives = new Set(['int','long','short','byte','char','float','double','boolean','void','this','null','new']);
  const matches = content.match(UNCHECKED_CAST_RE) || [];
  return matches.filter(m => {
    const typeName = m.match(/\(\s*([A-Za-z0-9_]+)/)?.[1] || '';
    return !primitives.has(typeName.toLowerCase());
  }).length;
}

/**
 * Detect missing try-with-resources: files that call .close() manually
 * but don't appear to use try-with-resources for every closeable.
 * @param {string} content
 * @returns {boolean} true if manual close() found without matching try-with-resources
 */
function hasMissingTryWithResources(content) {
  const closeCount = (content.match(MANUAL_CLOSE_RE) || []).length;
  const tryWithCount = (content.match(TRY_WITH_RESOURCES_RE) || []).length;
  // If there are more manual closes than try-with-resource blocks, flag it
  return closeCount > 0 && closeCount > tryWithCount;
}

/**
 * Parse a Java file and return metadata used by the dependency mapper and risk engine.
 *
 * @param {{ path: string, content: string }} file
 * @returns {{
 *   imports: string[],           // fully-qualified class names this file imports
 *   maxNesting: number,          // max brace depth
 *   deprecatedCount: number,     // number of @Deprecated usages
 *   antiPatterns: string[],      // matched anti-pattern snippets
 *   todos: string[],             // TODO/FIXME comment lines
 *   hasTests: boolean,
 *   legacyCollections: string[], // Vector/Hashtable/Stack/Enumeration usage
 *   rawTypeCount: number,        // raw (unparameterised) generic type declarations
 *   uncheckedCastCount: number,  // explicit object casts that bypass generics
 *   missingTryWithResources: boolean,
 * }}
 */
function extractDependencies(file) {
  const { content } = file;

  const imports = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    imports.push(m[1]);
  }

  ANTIPATTERN_RE.lastIndex = 0;
  const antiPatterns = [];
  while ((m = ANTIPATTERN_RE.exec(content)) !== null) {
    antiPatterns.push(m[1]);
  }

  TODO_RE.lastIndex = 0;
  const todos = [];
  while ((m = TODO_RE.exec(content)) !== null) {
    todos.push(m[0].trim());
  }

  const deprecatedCount = (content.match(DEPRECATED_RE) || []).length;

  return {
    imports,
    maxNesting: maxNestingDepth(content),
    deprecatedCount,
    antiPatterns: [...new Set(antiPatterns)],
    todos,
    hasTests: hasTestCode(content),
    legacyCollections: findLegacyCollections(content),
    rawTypeCount: countRawTypes(content),
    uncheckedCastCount: countUncheckedCasts(content),
    missingTryWithResources: hasMissingTryWithResources(content),
  };
}

module.exports = { extractDependencies };
