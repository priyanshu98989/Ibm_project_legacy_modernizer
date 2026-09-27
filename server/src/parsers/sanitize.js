/**
 * server/src/parsers/sanitize.js
 * Shared source-sanitisation helpers used by every heuristic parser.
 *
 * Why this exists
 * ---------------
 * The risk rules (eval(, console.log, var, braces, ...) used to be matched
 * against the raw file text.  Regex happily matches inside comments and
 * string literals, so a file that merely *mentions* a pattern got flagged for
 * it.  Concretely, riskScorer.js was reported as "eval() used 3 times"
 * because its own result-message string reads `eval() used N time(s)`.
 *
 * Two helpers, because two different jobs need different visibility:
 *
 *   stripComments()        - blanks comment bodies, KEEPS string literals.
 *                            Used by secret detection: a secret lives inside
 *                            a string, so the string must stay readable.
 *
 *   stripCommentsAndStrings() - blanks comments AND string bodies.
 *                            Used by everything else, so that only executable
 *                            code is left to match.
 *
 * Both preserve string length and newline positions, so offset-based and
 * line-based rules keep working exactly as before.
 */

/** Parser modes. */
const CODE  = 'code';
const LINE  = 'line';   // // ... to end of line
const BLOCK = 'block';  // /* ... */
const SQ    = 'sq';     // '...'
const DQ    = 'dq';     // "..."
const TMPL  = 'tmpl';   // `...`
const EXPR  = 'expr';   // ${ ... } inside a template literal
const TDQ   = 'tdq';    // """..."""  (Python docstring / Java text block)
const TSQ   = 'tsq';    // '''...'''  (Python docstring)

/**
 * Blank out comment bodies, leaving string literals intact.
 *
 * @param {string} content
 * @param {{ hashComments?: boolean }} [opts]  hashComments: treat `#` as a
 *        line comment (Python).  Off by default because `#` is the private-field
 *        prefix in JavaScript and would break code like `#count = 0`.
 * @returns {string} same-length string with comment characters replaced by spaces
 */
function stripComments(content, opts = {}) {
  const hashComments = opts.hashComments === true;
  const n = content.length;
  const out = new Array(n);
  const modes = [CODE];
  let exprBrace = 0;
  let emit;

  for (let i = 0; i < n; i++) {
    const mode = modes[modes.length - 1];
    const ch = content[i];
    const next = content[i + 1];
    emit = null;

    switch (mode) {
      case CODE:
        // `#` introduces a comment in Python. In JavaScript it is the
        // private-field prefix, so it is only honoured when the caller opts in.
        // A leading `#!` shebang is always a comment.
        if (ch === '#' && (hashComments || (i === 0 && next === '!'))) {
          modes.push(LINE); emit = ' ';
        }
        else if (ch === '/' && next === '/')      { modes.push(LINE);  emit = ' '; }
        else if (ch === '/' && next === '*') { modes.push(BLOCK); emit = ' '; }
        // Triple quotes must be tested before single quotes, otherwise """ is
        // read as an empty string followed by an unterminated one — which leaks
        // the whole docstring body back out as if it were code.
        else if (ch === '"' && next === '"' && content[i + 2] === '"') {
          modes.push(TDQ);
          out[i] = ch; if (i + 1 < n) out[i + 1] = next; if (i + 2 < n) out[i + 2] = next;
          i += 2; emit = null;
        } else if (ch === "'" && next === "'" && content[i + 2] === "'") {
          modes.push(TSQ);
          out[i] = ch; if (i + 1 < n) out[i + 1] = next; if (i + 2 < n) out[i + 2] = next;
          i += 2; emit = null;
        } else if (ch === "'")             { modes.push(SQ);    emit = ch; }
        else if (ch === '"')             { modes.push(DQ);    emit = ch; }
        else if (ch === '`')             { modes.push(TMPL);  emit = ch; }
        else                                 { emit = ch; }
        break;

      case TDQ:
      case TSQ: {
        const q = mode === TDQ ? '"' : "'";
        if (ch === q && next === q && content[i + 2] === q) {
          modes.pop();
          out[i] = ch; if (i + 1 < n) out[i + 1] = next; if (i + 2 < n) out[i + 2] = next;
          i += 2; emit = null;
        } else {
          emit = ch;
        }
        break;
      }

      case LINE:
        if (ch === '\n') { modes.pop(); emit = '\n'; } else { emit = ' '; }
        break;

      case BLOCK:
        if (ch === '*' && next === '/') {
          modes.pop();
          out[i] = ' '; out[i + 1] = ' '; i++; emit = null;
        } else {
          emit = ch === '\n' ? '\n' : ' ';
        }
        break;

      case SQ:
      case DQ: {
        const quote = mode === SQ ? "'" : '"';
        if (ch === '\\') {
          out[i] = ' '; if (i + 1 < n) out[i + 1] = content[i + 1] === '\n' ? '\n' : ' '; i++;
          emit = null;
        } else if (ch === quote)     { modes.pop(); emit = ch; }
        else if (ch === '\n')        { modes.pop(); emit = '\n'; } // unterminated — bail out
        else                         { emit = ch; }
        break;
      }

      case TMPL:
        if (ch === '\\') {
          out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i++; emit = null;
        } else if (ch === '`') {
          modes.pop(); emit = ch;
        } else if (ch === '$' && next === '{') {
          modes.push(EXPR); exprBrace = 1;
          out[i] = ' '; out[i + 1] = ' '; i++; emit = null;
        } else {
          emit = ch;
        }
        break;

      case EXPR:
        if (ch === '{') {
          exprBrace++; emit = ch;
        } else if (ch === '}') {
          exprBrace--; emit = ch;
          if (exprBrace === 0) modes.pop();
        } else if (ch === '"' || ch === "'" || ch === '`') {
          modes.push(ch === '"' ? DQ : ch === "'" ? SQ : TMPL); emit = ch;
        } else if (ch === '/' && next === '/')      { modes.push(LINE);  emit = ' '; }
        else if (ch === '/' && next === '*')        { modes.push(BLOCK); emit = ' '; }
        else                                        { emit = ch; }
        break;
    }

    if (emit !== null) out[i] = emit;
  }

  return out.join('');
}

/**
 * Blank out both comment bodies and string-literal bodies, so that only
 * executable code remains to be matched.
 *
 * Template-literal interpolations (${ ... }) are preserved because they are
 * real code.
 *
 * @param {string} content
 * @param {{ hashComments?: boolean }} [opts]  see stripComments
 * @returns {string} same-length string, non-code replaced by spaces
 */
function stripCommentsAndStrings(content, opts = {}) {
  const hashComments = opts.hashComments === true;
  const n = content.length;
  const out = new Array(n);
  const modes = [CODE];
  let exprBrace = 0;
  let emit;

  for (let i = 0; i < n; i++) {
    const mode = modes[modes.length - 1];
    const ch = content[i];
    const next = content[i + 1];
    emit = null;

    switch (mode) {
      case CODE:
        // `#` introduces a comment in Python. In JavaScript it is the
        // private-field prefix, so it is only honoured when the caller opts in.
        // A leading `#!` shebang is always a comment.
        if (ch === '#' && (hashComments || (i === 0 && next === '!'))) {
          modes.push(LINE); emit = ' ';
        }
        else if (ch === '/' && next === '/')      { modes.push(LINE);  emit = ' '; }
        else if (ch === '/' && next === '*') { modes.push(BLOCK); emit = ' '; }
        else if (ch === '"' && next === '"' && content[i + 2] === '"') {
          modes.push(TDQ);
          out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; if (i + 2 < n) out[i + 2] = ' ';
          i += 2; emit = null;
        } else if (ch === "'" && next === "'" && content[i + 2] === "'") {
          modes.push(TSQ);
          out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; if (i + 2 < n) out[i + 2] = ' ';
          i += 2; emit = null;
        } else if (ch === "'")             { modes.push(SQ);    emit = ' '; }
        else if (ch === '"')             { modes.push(DQ);    emit = ' '; }
        else if (ch === '`')             { modes.push(TMPL);  emit = ' '; }
        else                                 { emit = ch; }
        break;

      case TDQ:
      case TSQ: {
        const q = mode === TDQ ? '"' : "'";
        if (ch === q && next === q && content[i + 2] === q) {
          modes.pop();
          out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; if (i + 2 < n) out[i + 2] = ' ';
          i += 2; emit = null;
        } else {
          emit = ch === '\n' ? '\n' : ' ';
        }
        break;
      }

      case LINE:
        if (ch === '\n') { modes.pop(); emit = '\n'; } else { emit = ' '; }
        break;

      case BLOCK:
        if (ch === '*' && next === '/') {
          modes.pop();
          out[i] = ' '; out[i + 1] = ' '; i++; emit = null;
        } else {
          emit = ch === '\n' ? '\n' : ' ';
        }
        break;

      case SQ:
      case DQ: {
        const quote = mode === SQ ? "'" : '"';
        if (ch === '\\') {
          out[i] = ' '; if (i + 1 < n) out[i + 1] = content[i + 1] === '\n' ? '\n' : ' '; i++;
          emit = null;
        } else if (ch === quote)     { modes.pop(); emit = ' '; }
        else if (ch === '\n')        { modes.pop(); emit = '\n'; } // unterminated — bail out
        else                         { emit = ' '; }
        break;
      }

      case TMPL:
        if (ch === '\\') {
          out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i++; emit = null;
        } else if (ch === '`') {
          modes.pop(); emit = ' ';
        } else if (ch === '$' && next === '{') {
          modes.push(EXPR); exprBrace = 1;
          out[i] = ' '; out[i + 1] = ' '; i++; emit = null;
        } else {
          emit = ch === '\n' ? '\n' : ' ';
        }
        break;

      case EXPR:
        if (ch === '{') {
          exprBrace++; emit = ch;
        } else if (ch === '}') {
          exprBrace--; emit = ch;
          if (exprBrace === 0) modes.pop();
        } else if (ch === '"' || ch === "'" || ch === '`') {
          modes.push(ch === '"' ? DQ : ch === "'" ? SQ : TMPL); emit = ' ';
        } else if (ch === '/' && next === '/')      { modes.push(LINE);  emit = ' '; }
        else if (ch === '/' && next === '*')        { modes.push(BLOCK); emit = ' '; }
        else                                        { emit = ch; }
        break;
    }

    if (emit !== null) out[i] = emit;
  }

  return out.join('');
}

/**
 * Characters that can legally precede a block-opening brace.
 * ')'  → if (x) {  /  function foo() {
 * ';'  → for (;;) { after a statement
 * '{'  → nested block
 * '}'  → } else {
 * '>'  → arrow functions
 */
const BLOCK_PRECEDERS = new Set([')', ';', '{', '}', '>']);

/**
 * Count maximum *block* nesting depth.
 *
 * Counting every '{' is wrong.  Object literals, JSX expression containers and
 * destructuring patterns all use braces but add no control-flow depth, so a
 * file full of nested config objects was reported as "deeply nested logic".
 * We therefore count a brace only when it plausibly opens a block — i.e. when
 * the previous non-space character is a word character (covers `class X {`,
 * `else {`, `try {`, `do {`) or one of the block preceders above.
 *
 * @param {string} code  pre-sanitised source (use stripCommentsAndStrings first)
 * @returns {number} maximum block depth
 */
function blockNestingDepth(code) {
  const stack = [];
  let depth = 0;
  let max = 0;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];

    if (ch === '{') {
      let j = i - 1;
      while (j >= 0 && (code[j] === ' ' || code[j] === '\t' || code[j] === '\n' || code[j] === '\r')) j--;
      const prev = j >= 0 ? code[j] : '';

      const isBlock =
        prev !== '' &&
        (BLOCK_PRECEDERS.has(prev) || /[A-Za-z0-9_$]/.test(prev));

      stack.push(isBlock);
      if (isBlock) {
        depth++;
        if (depth > max) max = depth;
      }
    } else if (ch === '}') {
      if (stack.pop() === true) depth = Math.max(0, depth - 1);
    }
  }

  return max;
}

module.exports = {
  stripComments,
  stripCommentsAndStrings,
  blockNestingDepth,
};
