/**
 * server/src/services/dependencyMapper.js
 * Builds a dependency graph from parsed file metadata.
 *
 * Graph format (compatible with React Flow):
 * {
 *   nodes: [{ id, label, language, path }],
 *   edges: [{ id, source, target, label }]
 * }
 *
 * Java: import edges map from importer → imported (by matching short class name to file).
 * COBOL: CALL and COPY edges map program → called/copied name.
 */

const path = require('path');
const { detect } = require('../parsers');
const javaParser  = require('../parsers/java');
const cobolParser = require('../parsers/cobol');
const jsParser    = require('../parsers/javascript');

/**
 * Build a node label from a relative file path.
 * e.g.  "src/main/java/com/Foo.java" → "Foo.java"
 */
function fileLabel(filePath) {
  return path.basename(filePath);
}

/**
 * Build the dependency graph for a list of files.
 *
 * @param {{ path: string, language: string, content: string }[]} files
 * @returns {{ nodes: object[], edges: object[] }}
 */
function buildDependencyGraph(files) {
  const nodes = [];
  const edges = [];
  const edgeSet = new Set(); // prevent duplicate edges
  let edgeCounter = 0;

  // ── Build node index ──────────────────────────────────────────────────────
  // For Java: key = simple class name (filename without .java)
  // For COBOL: key = uppercase filename without extension
  const nodeIndex = new Map(); // key → node id

  for (const file of files) {
    const nodeId = file.path;
    nodes.push({
      id: nodeId,
      label: fileLabel(file.path),
      language: file.language,
      path: file.path,
    });

    const baseName = path.basename(file.path, path.extname(file.path));
    nodeIndex.set(baseName.toUpperCase(), nodeId);
    // Also index by last dotted segment for Java FQN resolution
    nodeIndex.set(baseName, nodeId);
  }

  // ── Build edges ───────────────────────────────────────────────────────────
  for (const file of files) {
    const sourceId = file.path;

    if (file.language === 'java') {
      const { imports } = javaParser.extractDependencies(file);
      for (const imp of imports) {
        // Try to resolve: last segment of FQN → node
        const parts = imp.split('.');
        const className = parts[parts.length - 1].replace('*', '');
        const targetId = nodeIndex.get(className);
        if (targetId && targetId !== sourceId) {
          const edgeKey = `${sourceId}→${targetId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({
              id: `e${++edgeCounter}`,
              source: sourceId,
              target: targetId,
              label: 'imports',
            });
          }
        }
      }
    }

    if (file.language === 'javascript') {
      const { imports } = jsParser.extractDependencies(file);
      for (const imp of imports) {
        // Only link to files we actually found in the repo (skip npm packages)
        const targetId = nodeIndex.get(imp) || nodeIndex.get(imp.toUpperCase());
        if (targetId && targetId !== sourceId) {
          const edgeKey = `${sourceId}→${targetId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ id: `e${++edgeCounter}`, source: sourceId, target: targetId, label: 'import' });
          }
        }
      }
    }

    if (file.language === 'cobol') {
      const { calls, copies } = cobolParser.extractDependencies(file);

      for (const called of calls) {
        const targetId = nodeIndex.get(called);
        if (targetId && targetId !== sourceId) {
          const edgeKey = `${sourceId}→${targetId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ id: `e${++edgeCounter}`, source: sourceId, target: targetId, label: 'CALL' });
          }
        }
      }

      for (const copied of copies) {
        const targetId = nodeIndex.get(copied);
        if (targetId && targetId !== sourceId) {
          const edgeKey = `${sourceId}→${targetId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ id: `e${++edgeCounter}`, source: sourceId, target: targetId, label: 'COPY' });
          }
        }
      }
    }
  }

  return { nodes, edges };
}

module.exports = { buildDependencyGraph };
