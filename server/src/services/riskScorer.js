/**
 * server/src/services/riskScorer.js
 * Computes a risk score and issue list for each file WITHOUT calling Bob.
 *
 * This provides instant static signal.  Bob is then used for the richer
 * natural-language explanation and code-diff suggestions (see bobClient.js).
 *
 * Severity levels: 'high' | 'medium' | 'low'
 *
 * Scoring:
 *   Java:
 *     - maxNesting >= 8        → high
 *     - maxNesting 5–7         → medium
 *     - deprecatedCount >= 3   → medium
 *     - antiPatterns present   → high (each unique one +1)
 *     - todos >= 5             → low (+1)
 *
 *   COBOL:
 *     - gotoCount >= 5         → high
 *     - gotoCount 1–4          → medium
 *     - performDepth >= 6      → medium
 *     - execSqlCount >= 1      → medium (embedded SQL)
 *     - hardcodedLiterals      → high (each +1)
 *
 * Note: test coverage is deliberately NOT a per-file rule — see scoreJava.
 */

const javaParser       = require('../parsers/java');
const cobolParser      = require('../parsers/cobol');
const jsParser         = require('../parsers/javascript');
const tsParser         = require('../parsers/typescript');
const pyParser         = require('../parsers/python');

/** Map a numeric risk score to a severity string. */
function scoreToSeverity(score) {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

/**
 * Score a single Java file.
 * @param {{ path, content }} file
 * @returns {{ severity: string, score: number, issues: string[] }}
 */
function scoreJava(file) {
  const meta = javaParser.extractDependencies(file);
  const issues = [];
  let score = 0;

  if (meta.maxNesting >= 8) {
    issues.push(`Deeply nested logic (brace depth ${meta.maxNesting}) — high cyclomatic complexity risk.`);
    score += 3;
  } else if (meta.maxNesting >= 5) {
    issues.push(`Moderately nested logic (brace depth ${meta.maxNesting}).`);
    score += 1;
  }

  if (meta.deprecatedCount >= 3) {
    issues.push(`${meta.deprecatedCount} @Deprecated annotation(s) found — likely uses obsolete APIs.`);
    score += 2;
  } else if (meta.deprecatedCount > 0) {
    issues.push(`${meta.deprecatedCount} @Deprecated annotation(s) found.`);
    score += 1;
  }

  for (const ap of meta.antiPatterns) {
    issues.push(`Security/quality anti-pattern detected: \`${ap}\`.`);
    score += 2;
  }

  // ── New: legacy collection checks ──────────────────────────────────────────
  if (meta.legacyCollections && meta.legacyCollections.length > 0) {
    const names = meta.legacyCollections.join(', ');
    issues.push(`Legacy pre-generics collection(s) used: ${names} — replace with ArrayList/HashMap/Deque equivalents.`);
    score += 2;
  }

  if (meta.rawTypeCount > 0) {
    issues.push(`${meta.rawTypeCount} raw (unparameterised) generic type declaration(s) — missing type safety, likely causes unchecked warnings.`);
    score += 1;
  }

  if (meta.uncheckedCastCount > 0) {
    issues.push(`${meta.uncheckedCastCount} explicit object cast(s) detected — indicates raw-type usage and runtime ClassCastException risk.`);
    score += 1;
  }

  if (meta.missingTryWithResources) {
    issues.push('Manual .close() calls detected without try-with-resources — resource leak risk if an exception is thrown.');
    score += 2;
  }

  // NOTE: test coverage is intentionally NOT scored per file.  Almost no file
  // contains its own tests, so the rule fired on 100% of files, added a
  // constant +1 everywhere and guaranteed that nothing could ever be clean.
  // It is now reported once at repo level (see reportCompiler meta.testedFiles).

  if (meta.todos.length >= 5) {
    issues.push(`${meta.todos.length} TODO/FIXME comments found — indicates unfinished or fragile code.`);
    score += 1;
  }

  return { severity: scoreToSeverity(score), score, issues };
}

/**
 * Score a single COBOL file.
 * @param {{ path, content }} file
 * @returns {{ severity: string, score: number, issues: string[] }}
 */
function scoreCobol(file) {
  const meta = cobolParser.extractDependencies(file);
  const issues = [];
  let score = 0;

  if (meta.gotoCount >= 5) {
    issues.push(`${meta.gotoCount} GO TO statement(s) — significant spaghetti-flow risk.`);
    score += 3;
  } else if (meta.gotoCount > 0) {
    issues.push(`${meta.gotoCount} GO TO statement(s) found — consider replacing with structured PERFORM.`);
    score += 2;
  }

  if (meta.performDepth >= 6) {
    issues.push(`Estimated PERFORM nesting depth ${meta.performDepth} — complex control flow.`);
    score += 2;
  }

  if (meta.execSqlCount > 0) {
    issues.push(`${meta.execSqlCount} EXEC SQL block(s) — embedded SQL requires DB2/CICS migration attention.`);
    score += 2;
  }

  if (meta.hardcodedLiterals.length > 0) {
    issues.push(`Hardcoded path/IP literal(s): ${meta.hardcodedLiterals.slice(0, 3).join(', ')}.`);
    score += 2;
  }

  // ── New: additional COBOL legacy checks ────────────────────────────────────
  if (meta.alterCount > 0) {
    issues.push(`${meta.alterCount} ALTER statement(s) found — obsolete since COBOL-85, removed in COBOL 2002; makes control flow untraceable.`);
    score += 3;
  }

  if (meta.nextSentenceCount > 0) {
    issues.push(`${meta.nextSentenceCount} NEXT SENTENCE usage(s) — obsolete flow control; replace with CONTINUE or restructure with EVALUATE.`);
    score += 1;
  }

  if (meta.picNoCompCount > 5) {
    issues.push(`${meta.picNoCompCount} display-numeric PIC clause(s) without COMP/BINARY — significant arithmetic performance risk on mainframe.`);
    score += 2;
  } else if (meta.picNoCompCount > 0) {
    issues.push(`${meta.picNoCompCount} display-numeric PIC clause(s) without COMP/BINARY — consider PACKED-DECIMAL or BINARY for arithmetic fields.`);
    score += 1;
  }

  // Test coverage is a repo-level concern — see the note in scoreJava.

  return { severity: scoreToSeverity(score), score, issues };
}

/**
 * Score a single JavaScript file.
 * @param {{ path, content }} file
 * @returns {{ severity: string, score: number, issues: string[] }}
 */
function scoreJavaScript(file) {
  const meta = jsParser.extractDependencies(file);
  const issues = [];
  let score = 0;

  if (meta.evalCount > 0) {
    issues.push(`eval() used ${meta.evalCount} time(s) — critical security risk, allows arbitrary code execution.`);
    score += 4;
  }

  if (meta.secrets.length > 0) {
    issues.push(`Possible hardcoded secret/credential detected: ${meta.secrets[0]}.`);
    score += 4;
  }

  if (meta.maxNesting >= 8) {
    issues.push(`Deeply nested logic (brace depth ${meta.maxNesting}) — high complexity, hard to maintain.`);
    score += 3;
  } else if (meta.maxNesting >= 5) {
    issues.push(`Moderately nested logic (brace depth ${meta.maxNesting}).`);
    score += 1;
  }

  if (meta.callbackDepth >= 4) {
    issues.push(`Callback hell detected (estimated depth ${meta.callbackDepth}) — refactor to async/await.`);
    score += 2;
  }

  if (meta.varCount >= 5) {
    issues.push(`${meta.varCount} var declaration(s) — use const/let for block-scoped, safer code.`);
    score += 1;
  }

  if (meta.consoleCount >= 5) {
    issues.push(`${meta.consoleCount} console.log/error calls — debug code left in production.`);
    score += 1;
  }

  // Test coverage is a repo-level concern — see the note in scoreJava.

  if (meta.todos.length >= 3) {
    issues.push(`${meta.todos.length} TODO/FIXME comments — indicates unfinished or fragile code.`);
    score += 1;
  }

  // Every JS file with no issues at all still gets a baseline low score
  if (issues.length === 0) {
    issues.push('No significant issues detected.');
  }

  return { severity: scoreToSeverity(score), score, issues };
}

/**
 * Score a single TypeScript file.
 * @param {{ path, content }} file
 * @returns {{ severity: string, score: number, issues: string[] }}
 */
function scoreTypeScript(file) {
  const meta = tsParser.extractDependencies(file);
  const issues = [];
  let score = 0;

  if (meta.evalCount > 0) {
    issues.push(`eval() used ${meta.evalCount} time(s) — critical security risk.`);
    score += 4;
  }

  if (meta.secrets.length > 0) {
    issues.push(`Possible hardcoded secret/credential detected: ${meta.secrets[0]}.`);
    score += 4;
  }

  if (meta.anyTypeCount > 5) {
    issues.push(`${meta.anyTypeCount} \`any\` type usage(s) — defeats TypeScript's type safety entirely.`);
    score += 3;
  } else if (meta.anyTypeCount > 0) {
    issues.push(`${meta.anyTypeCount} \`any\` type usage(s) — consider replacing with proper types or \`unknown\`.`);
    score += 1;
  }

  if (meta.asAnyCount > 0) {
    issues.push(`${meta.asAnyCount} \`as any\` unsafe type assertion(s) — bypasses type checking at runtime.`);
    score += 2;
  }

  if (meta.tsSuppressionCount > 0) {
    issues.push(`${meta.tsSuppressionCount} @ts-ignore/@ts-nocheck suppression(s) — silences type errors instead of fixing them.`);
    score += 2;
  }

  if (meta.nonNullCount > 3) {
    issues.push(`${meta.nonNullCount} non-null assertion(s) (!) — risk of runtime null/undefined errors.`);
    score += 1;
  }

  if (meta.missingReturnTypes > 3) {
    issues.push(`${meta.missingReturnTypes} function(s) without explicit return type annotation.`);
    score += 1;
  }

  if (meta.maxNesting >= 8) {
    issues.push(`Deeply nested logic (brace depth ${meta.maxNesting}) — high complexity.`);
    score += 3;
  } else if (meta.maxNesting >= 5) {
    issues.push(`Moderately nested logic (brace depth ${meta.maxNesting}).`);
    score += 1;
  }

  if (meta.consoleCount >= 5) {
    issues.push(`${meta.consoleCount} console.log/error calls — debug code left in production.`);
    score += 1;
  }

  // Test coverage is a repo-level concern — see the note in scoreJava.

  if (meta.todos.length >= 3) {
    issues.push(`${meta.todos.length} TODO/FIXME comments — indicates unfinished code.`);
    score += 1;
  }

  if (issues.length === 0) issues.push('No significant issues detected.');
  return { severity: scoreToSeverity(score), score, issues };
}

/**
 * Score a single Python file.
 * @param {{ path, content }} file
 * @returns {{ severity: string, score: number, issues: string[] }}
 */
function scorePython(file) {
  const meta = pyParser.extractDependencies(file);
  const issues = [];
  let score = 0;

  if (meta.evalCount > 0) {
    issues.push(`eval()/exec() used ${meta.evalCount} time(s) — critical security risk, allows arbitrary code execution.`);
    score += 4;
  }

  if (meta.secrets.length > 0) {
    issues.push(`Possible hardcoded secret/credential: ${meta.secrets[0]}.`);
    score += 4;
  }

  if (meta.bareExceptCount > 0) {
    issues.push(`${meta.bareExceptCount} bare \`except:\` clause(s) — catches ALL exceptions including KeyboardInterrupt; use \`except Exception\` at minimum.`);
    score += 3;
  }

  if (meta.mutableDefaultCount > 0) {
    issues.push(`${meta.mutableDefaultCount} mutable default argument(s) (list/dict/set) — shared state bug: mutations persist across calls.`);
    score += 2;
  }

  if (meta.printCount >= 5) {
    issues.push(`${meta.printCount} print() call(s) — use the \`logging\` module instead; print() is not suitable for production code.`);
    score += 1;
  } else if (meta.printCount > 0) {
    issues.push(`${meta.printCount} print() call(s) — consider replacing with \`logging\` for production.`);
    score += 1;
  }

  if (meta.missingTypeHints > 5) {
    issues.push(`${meta.missingTypeHints} function(s) without type hints — reduces IDE support and makes refactoring risky.`);
    score += 2;
  } else if (meta.missingTypeHints > 0) {
    issues.push(`${meta.missingTypeHints} function(s) missing type hints.`);
    score += 1;
  }

  if (meta.maxNesting >= 6) {
    issues.push(`Deep indentation (level ${meta.maxNesting}) — complex nested logic, consider refactoring.`);
    score += 2;
  } else if (meta.maxNesting >= 4) {
    issues.push(`Moderate indentation depth (level ${meta.maxNesting}).`);
    score += 1;
  }

  // Test coverage is a repo-level concern — see the note in scoreJava.

  if (meta.todos.length >= 3) {
    issues.push(`${meta.todos.length} TODO/FIXME comments — indicates unfinished or fragile code.`);
    score += 1;
  }

  if (issues.length === 0) issues.push('No significant issues detected.');
  return { severity: scoreToSeverity(score), score, issues };
}

/**
 * Score all files and return a sorted risk list.
 * Each file is scored in its own try/catch so a malformed or unparseable
 * file never crashes the entire analysis pipeline — it is instead flagged
 * as "needs manual review" with a low severity.
 *
 * @param {{ path: string, language: string, content: string }[]} files
 * @returns {{ file: string, language: string, severity: string, score: number, issues: string[] }[]}
 */
function scoreFiles(files) {
  const results = [];

  for (const file of files) {
    try {
      let result;
      if (file.language === 'java') {
        result = scoreJava(file);
      } else if (file.language === 'cobol') {
        result = scoreCobol(file);
      } else if (file.language === 'javascript') {
        result = scoreJavaScript(file);
      } else if (file.language === 'typescript') {
        result = scoreTypeScript(file);
      } else if (file.language === 'python') {
        result = scorePython(file);
      } else {
        continue;
      }
      results.push({ file: file.path, language: file.language, ...result });
    } catch (err) {
      // Parser threw on a malformed/unusual file — flag it for manual review
      // instead of letting it abort the entire analysis job.
      console.warn(`[riskScorer] Parser error on ${file.path}: ${err.message}`);
      results.push({
        file: file.path,
        language: file.language,
        severity: 'medium',
        score: 2,
        issues: [
          `Automated analysis could not fully parse this file (${err.message}) — manual review recommended.`,
        ],
      });
    }
  }

  // Sort: high → medium → low, then by score descending
  const order = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => order[a.severity] - order[b.severity] || b.score - a.score);

  return results;
}

module.exports = { scoreFiles };
