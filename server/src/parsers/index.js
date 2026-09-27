/**
 * server/src/parsers/index.js
 * Language-detection registry.
 *
 * To add a new language:
 *   1. Create server/src/parsers/<lang>.js  (must export { extractDependencies(file) })
 *   2. Add an entry to LANGUAGE_MAP below.
 */

const javaParser       = require('./java');
const cobolParser      = require('./cobol');
const javascriptParser = require('./javascript');
const typescriptParser = require('./typescript');
const pythonParser     = require('./python');

// Map file extension → { language, parser }
const LANGUAGE_MAP = {
  '.java':  { language: 'java',       parser: javaParser       },
  '.cbl':   { language: 'cobol',      parser: cobolParser      },
  '.cob':   { language: 'cobol',      parser: cobolParser      },
  '.cobol': { language: 'cobol',      parser: cobolParser      },
  '.js':    { language: 'javascript', parser: javascriptParser },
  '.mjs':   { language: 'javascript', parser: javascriptParser },
  '.cjs':   { language: 'javascript', parser: javascriptParser },
  '.jsx':   { language: 'javascript', parser: javascriptParser },
  '.ts':    { language: 'typescript', parser: typescriptParser },
  '.tsx':   { language: 'typescript', parser: typescriptParser },
  '.py':    { language: 'python',     parser: pythonParser     },
  '.pyw':   { language: 'python',     parser: pythonParser     },
};

/**
 * Detect the language for a given file path.
 * Returns null if the extension is not registered.
 * @param {string} filePath
 * @returns {{ language: string, parser: object } | null}
 */
function detect(filePath) {
  const ext = require('path').extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || null;
}

module.exports = { detect, LANGUAGE_MAP };
