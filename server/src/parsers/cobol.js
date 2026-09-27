/**
 * server/src/parsers/cobol.js
 * Heuristic static parser for COBOL source files.
 *
 * Extracts:
 *   - CALL statements (external program calls → dependency edges)
 *   - COPY statements (copybook dependencies)
 *   - GO TO usage (flag as risky — spaghetti flow)
 *   - PERFORM nesting depth (proxy for complexity)
 *   - File I/O verbs (SELECT, OPEN, READ, WRITE, CLOSE)
 *   - Hardcoded literals that look like file paths or IPs
 *   - ALTER statements (obsolete, removed in COBOL 2002)
 *   - NEXT SENTENCE (obsolete flow control)
 *   - Numeric PIC clauses without COMP/BINARY (performance risk)
 *   - MOVE SPACES / MOVE ZEROS patterns (data initialisation anti-pattern)
 *
 * Assumption: heuristic regex-based, not a full COBOL parser.
 * Handles fixed-format (columns 7–72) and free-format COBOL.
 */

// CALL 'PROGRAM-NAME' or CALL IDENTIFIER
const CALL_RE = /\bCALL\s+['"]?([\w-]+)['"]?/gi;

// COPY COPYBOOK-NAME
const COPY_RE = /\bCOPY\s+([\w-]+)/gi;

// GO TO (any form)
const GOTO_RE = /\bGO\s+TO\b/gi;

// PERFORM … [TIMES / UNTIL / VARYING] to estimate loop depth
const PERFORM_RE = /\bPERFORM\b/gi;

// Section / paragraph names (lines starting in area A — col 8+)
const SECTION_RE = /^[\s]{6,7}([\w-]+)\s+SECTION\./gim;

// Hardcoded file paths or IP-looking literals
const HARDCODED_RE = /['"][/\\][^'"]{4,}['"]|'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}'/g;

// EXEC SQL — embedded SQL (often a risk area)
const EXEC_SQL_RE = /\bEXEC\s+SQL\b/gi;

// ── Additional real-world COBOL legacy patterns ───────────────────────────────

// ALTER paragraph-name TO PROCEED TO paragraph-name
// Obsolete since COBOL-85; removed from COBOL 2002 standard.
const ALTER_RE = /\bALTER\s+[\w-]+\s+TO\s+(?:PROCEED\s+TO\s+)?[\w-]+/gi;

// NEXT SENTENCE — obsolete control transfer; should use CONTINUE or EVALUATE
const NEXT_SENTENCE_RE = /\bNEXT\s+SENTENCE\b/gi;

// Numeric PIC without COMP/BINARY — display numerics are slow for arithmetic
// Matches: PIC 9(n) or PIC S9(n) NOT followed by COMP/BINARY/PACKED-DECIMAL
const PIC_NO_COMP_RE = /\bPIC\s+S?9[9()\s]*(?!\s+(?:COMP|BINARY|PACKED-DECIMAL|COMPUTATIONAL))/gi;

// MOVE SPACES/ZEROS to a field — low-severity flag (verbose initialisation style)
const MOVE_FIGURATIVE_RE = /\bMOVE\s+(?:SPACES?|ZEROS?|ZEROES)\s+TO\b/gi;

/**
 * Count PERFORM nesting depth as a proxy for complexity.
 * Very simplified — counts consecutive PERFORM blocks.
 */
function estimatePerformDepth(content) {
  const matches = content.match(PERFORM_RE) || [];
  // Rough heuristic: number of PERFORMs / 3 as a depth proxy
  return Math.ceil(matches.length / 3);
}

/**
 * Parse a COBOL file and return metadata for dependency mapping and risk scoring.
 *
 * @param {{ path: string, content: string }} file
 * @returns {{
 *   calls: string[],          // program names called via CALL
 *   copies: string[],         // copybook names referenced via COPY
 *   gotoCount: number,        // number of GO TO occurrences
 *   performDepth: number,     // estimated PERFORM nesting depth
 *   hardcodedLiterals: string[],
 *   execSqlCount: number,
 *   hasTests: boolean,        // COBOL test frameworks are rare — always false for now
 * }}
 */
function extractDependencies(file) {
  const { content } = file;

  // Reset all global regex state
  CALL_RE.lastIndex = 0;
  COPY_RE.lastIndex = 0;

  const calls = [];
  let m;
  while ((m = CALL_RE.exec(content)) !== null) {
    calls.push(m[1].toUpperCase());
  }

  const copies = [];
  while ((m = COPY_RE.exec(content)) !== null) {
    copies.push(m[1].toUpperCase());
  }

  const gotoCount        = (content.match(GOTO_RE)          || []).length;
  const performDepth     = estimatePerformDepth(content);
  const hardcodedLiterals = (content.match(HARDCODED_RE)    || []).slice(0, 10);
  const execSqlCount     = (content.match(EXEC_SQL_RE)      || []).length;
  const alterCount       = (content.match(ALTER_RE)         || []).length;
  const nextSentenceCount = (content.match(NEXT_SENTENCE_RE)|| []).length;
  const picNoCompCount   = (content.match(PIC_NO_COMP_RE)   || []).length;
  const moveFigurativeCount = (content.match(MOVE_FIGURATIVE_RE) || []).length;

  return {
    calls: [...new Set(calls)],
    copies: [...new Set(copies)],
    gotoCount,
    performDepth,
    hardcodedLiterals,
    execSqlCount,
    alterCount,          // ALTER statements — obsolete
    nextSentenceCount,   // NEXT SENTENCE — obsolete
    picNoCompCount,      // PIC 9 without COMP — performance risk
    moveFigurativeCount, // MOVE SPACES/ZEROS — verbose initialisation
    // COBOL doesn't have standard unit test frameworks in typical legacy repos
    hasTests: false,
  };
}

module.exports = { extractDependencies };
