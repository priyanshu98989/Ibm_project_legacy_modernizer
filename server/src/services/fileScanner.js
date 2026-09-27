/**
 * server/src/services/fileScanner.js
 * Recursively walks a directory and reads all supported source files.
 *
 * Returns an array of file objects:
 *   [{ path: string (relative), language: string, content: string, hasTests: boolean }]
 *
 * Files larger than MAX_FILE_BYTES are skipped (noted in console).
 * Binary files and common non-source directories are ignored.
 */

const fs = require('fs');
const path = require('path');
const { detect } = require('../parsers');

// Directories to skip unconditionally
const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', 'target', 'build', 'dist', '__pycache__']);

// Max individual file size to read (2 MB)
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Walk `dir` recursively and collect all supported source files.
 * @param {string} dir - absolute path to walk
 * @param {string} rootDir - the job's root dir (for computing relative paths)
 * @returns {{ path: string, language: string, content: string, hasTests: boolean }[]}
 */
function scanDirectory(dir, rootDir) {
  const results = [];

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // permission denied or broken symlink — skip silently
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const detected = detect(fullPath);
      if (!detected) continue; // unsupported extension

      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_BYTES) {
        console.warn(`[scanner] Skipping large file (${stat.size} bytes): ${fullPath}`);
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue; // binary or unreadable
      }

      results.push({
        path: path.relative(rootDir, fullPath).replace(/\\/g, '/'), // normalise to forward-slash
        language: detected.language,
        content,
        hasTests: detected.parser.hasTestCode(content),
      });
    }
  }

  walk(dir);
  return results;
}

module.exports = { scanDirectory };
