/**
 * server/src/services/reportCompiler.js
 * Assembles the final modernization report from all analysis artefacts.
 *
 * Report structure:
 * {
 *   meta: { jobId, generatedAt, fileCount, languages },
 *   healthScore: number (0-100),
 *   executiveSummary: string,
 *   dependencyGraph: { nodes, edges },
 *   risks: [{ file, language, severity, score, issues }],
 *   suggestions: [{ file, suggestion, diff }],
 *   refactorOrder: string[],   // safest files to touch first (topological order)
 * }
 */

/**
 * Calculate an overall codebase health score (0 = worst, 100 = best).
 *
 * Formula:
 *   base = 100
 *   - each high-risk file:    -10 points (capped at -50)
 *   - each medium-risk file:  -4  points (capped at -30)
 *   - each low-risk file:     -1  point  (capped at -10)
 *   floor at 0
 *
 * @param {{ severity: string }[]} risks
 * @returns {number}
 */
function calculateHealthScore(risks) {
  const high   = risks.filter(r => r.severity === 'high').length;
  const medium = risks.filter(r => r.severity === 'medium').length;
  const low    = risks.filter(r => r.severity === 'low').length;

  const penalty =
    Math.min(high   * 10, 50) +
    Math.min(medium * 4,  30) +
    Math.min(low    * 1,  10);

  return Math.max(0, 100 - penalty);
}

/**
 * Compute a safe refactor order using a simplified topological sort.
 *
 * Strategy: files with no incoming edges (not depended on by others) are
 * safest to refactor first.  We output leaf-first order.
 *
 * @param {{ nodes: object[], edges: object[] }} graph
 * @param {{ file: string, severity: string }[]} risks
 * @returns {string[]} file paths in suggested refactor order
 */
function computeRefactorOrder(graph, risks) {
  // Count how many files depend on each node (in-degree in the dependency graph)
  const inDegree = new Map();
  for (const node of graph.nodes) inDegree.set(node.id, 0);
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Only include files that were flagged as risky
  const riskyFileSet = new Set(risks.map(r => r.file));

  // Sort risky files: lowest in-degree first (safest), then by severity
  const severityOrder = { low: 0, medium: 1, high: 2 };
  return risks
    .slice() // don't mutate
    .sort((a, b) => {
      const degA = inDegree.get(a.file) || 0;
      const degB = inDegree.get(b.file) || 0;
      if (degA !== degB) return degA - degB; // fewer dependents → safer to touch first
      // If same degree, tackle lower severity first (reduce risk of cascading failures)
      return severityOrder[a.severity] - severityOrder[b.severity];
    })
    .map(r => r.file);
}

/**
 * Compile the full report object.
 *
 * @param {{
 *   jobId: string,
 *   files: object[],
 *   dependencyGraph: object,
 *   risks: object[],
 *   suggestions: object[],
 *   executiveSummary: string,
 * }} params
 * @returns {object} report
 */
function compileReport({ jobId, files, dependencyGraph, risks, suggestions, executiveSummary }) {
  const languages = [...new Set(files.map(f => f.language))];
  const healthScore = calculateHealthScore(risks);
  const refactorOrder = computeRefactorOrder(dependencyGraph, risks);

  return {
    meta: {
      jobId,
      generatedAt: new Date().toISOString(),
      fileCount: files.length,
      languages,
    },
    healthScore,
    executiveSummary,
    dependencyGraph,
    risks,
    suggestions,
    refactorOrder,
  };
}

module.exports = { compileReport, calculateHealthScore };
