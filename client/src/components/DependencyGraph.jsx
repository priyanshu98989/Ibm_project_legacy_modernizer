/**
 * client/src/components/DependencyGraph.jsx
 * Renders the dependency graph using React Flow.
 *
 * Nodes are coloured by language (blue = Java, amber = COBOL).
 * Hovering a node highlights its direct edges.
 *
 * For large graphs (> 50 nodes) we enable minimap + controls.
 */

import { useMemo, useCallback } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

// ── Layout helper ─────────────────────────────────────────────────────────────
/**
 * Simple force-directed approximation using a grid layout.
 * For a hackathon this is fine; swap in dagre for a proper layout.
 */
function layoutNodes(rawNodes) {
  const cols = Math.ceil(Math.sqrt(rawNodes.length));
  return rawNodes.map((node, i) => ({
    ...node,
    position: {
      x: (i % cols) * 220,
      y: Math.floor(i / cols) * 120,
    },
    style: {
      background: node.language === 'cobol' ? '#92400e' : node.language === 'javascript' ? '#14532d' : '#1e3a5f',
      color: '#f8fafc',
      border: `1px solid ${node.language === 'cobol' ? '#b45309' : node.language === 'javascript' ? '#22c55e' : '#3b82f6'}`,
      borderRadius: 8,
      padding: '6px 12px',
      fontSize: 12,
      maxWidth: 180,
      wordBreak: 'break-all',
    },
  }));
}

/**
 * @param {{ graph: { nodes: object[], edges: object[] } }} props
 */
export default function DependencyGraph({ graph }) {
  const rfNodes = useMemo(() => layoutNodes(graph.nodes || []), [graph.nodes]);
  const rfEdges = useMemo(() =>
    (graph.edges || []).map(e => ({
      ...e,
      animated: false,
      style: { stroke: '#475569', strokeWidth: 1.5 },
      labelStyle: { fill: '#94a3b8', fontSize: 10 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#475569' },
    })),
  [graph.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync nodes/edges when graph prop changes (e.g. navigating between reports)
  useMemo(() => { setNodes(rfNodes); }, [rfNodes]);
  useMemo(() => { setEdges(rfEdges); }, [rfEdges]);

  const isLarge = nodes.length > 50;

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        No dependency edges detected.
      </div>
    );
  }

  return (
    <div className="w-full h-96 rounded-xl overflow-hidden border border-gray-800 bg-gray-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#334155" gap={20} size={1} />
        {isLarge && <MiniMap nodeColor={n => n.style?.background || '#334155'} />}
        <Controls />
      </ReactFlow>
    </div>
  );
}
