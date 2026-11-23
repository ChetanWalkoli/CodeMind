import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ImpactGraphEdge, ImpactGraphNode, ImpactGraphNodeKind } from "@codemind/shared";
import styles from "./Impact.module.scss";

const KIND_COLORS: Record<ImpactGraphNodeKind, { border: string; bg: string; label: string }> = {
  target_file: { border: "#ef4444", bg: "rgba(239,68,68,0.16)", label: "Target File" },
  direct_dependent: { border: "#f97316", bg: "rgba(249,115,22,0.16)", label: "Direct Dependent" },
  transitive_dependent: {
    border: "#eab308",
    bg: "rgba(234,179,8,0.14)",
    label: "Transitive Dependent"
  },
  potential_dependent: {
    border: "#94a3b8",
    bg: "rgba(148,163,184,0.14)",
    label: "Potential Dependent"
  },
  api_route: { border: "#3b82f6", bg: "rgba(59,130,246,0.16)", label: "API Route" },
  frontend_consumer: {
    border: "#06b6d4",
    bg: "rgba(6,182,212,0.16)",
    label: "Frontend Consumer"
  },
  database_model: { border: "#a855f7", bg: "rgba(168,85,247,0.16)", label: "Database Model" },
  test_file: { border: "#22c55e", bg: "rgba(34,197,94,0.16)", label: "Test File" },
  decision: { border: "#ec4899", bg: "rgba(236,72,153,0.16)", label: "Decision Memory" }
};

interface ImpactGraphProps {
  graphNodes: ImpactGraphNode[];
  graphEdges: ImpactGraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onOpenFile: (filePath: string) => void;
}

export function ImpactGraph({
  graphNodes,
  graphEdges,
  selectedNodeId,
  onSelectNode,
  onOpenFile
}: ImpactGraphProps) {
  const { rfNodes, rfEdges } = useMemo(() => {
    // Group nodes by depth column for deterministic readable left-to-right layout
    const byCol = new Map<number, ImpactGraphNode[]>();
    for (const n of graphNodes) {
      const col = n.depth;
      const list = byCol.get(col) ?? [];
      list.push(n);
      byCol.set(col, list);
    }

    const rfNodesList: Node[] = [];
    const sortedCols = [...byCol.keys()].sort((a, b) => a - b);
    for (const col of sortedCols) {
      const colNodes = byCol.get(col) ?? [];
      colNodes.forEach((n, idx) => {
        const theme = KIND_COLORS[n.kind];
        const isSelected = selectedNodeId === n.id;
        rfNodesList.push({
          id: n.id,
          position: { x: col * 240 + 24, y: idx * 78 + 24 },
          data: {
            label: `${n.badge ? `[${n.badge}] ` : ""}${n.label}`
          },
          style: {
            border: `2px solid ${theme.border}`,
            background: theme.bg,
            color: "var(--cm-text-primary, #f8fafc)",
            borderRadius: 6,
            fontSize: 11,
            padding: "6px 10px",
            width: 205,
            boxShadow: isSelected ? `0 0 0 2px ${theme.border}` : undefined
          }
        });
      });
    }

    const rfEdgesList: Edge[] = graphEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: e.confidence === "confirmed" && e.relationshipType === "consumes_api",
      style: {
        stroke: e.confidence === "confirmed" ? "#94a3b8" : "#64748b",
        strokeDasharray: e.confidence === "confirmed" ? undefined : "4 3"
      },
      labelStyle: { fontSize: 10, fill: "#94a3b8" }
    }));

    return { rfNodes: rfNodesList, rfEdges: rfEdgesList };
  }, [graphNodes, graphEdges, selectedNodeId]);

  const selectedNode = useMemo(
    () => graphNodes.find((n) => n.id === selectedNodeId) ?? null,
    [graphNodes, selectedNodeId]
  );

  const presentKinds = useMemo(() => [...new Set(graphNodes.map((n) => n.kind))], [graphNodes]);

  if (graphNodes.length === 0) {
    return <p className={styles.muted}>No graph nodes available for this impact analysis.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className={styles.legendRow} data-testid="impact-graph-legend">
        {presentKinds.map((kind) => (
          <span key={kind} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: KIND_COLORS[kind].border }} />
            {KIND_COLORS[kind].label}
          </span>
        ))}
      </div>

      <div className={styles.graphWrapper} data-testid="impact-graph-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          fitView
          onNodeClick={(_ev, node) => onSelectNode(node.id)}
          onPaneClick={() => onSelectNode(null)}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      {selectedNode && (
        <div className={styles.card} data-testid="impact-node-inspector">
          <div className={styles.cardTitle}>
            <span>
              Selected Node: <strong>{selectedNode.label}</strong>
            </span>
            <span className={`${styles.badge} ${styles.neutralBadge}`}>
              {KIND_COLORS[selectedNode.kind].label} · Depth {selectedNode.depth}
            </span>
          </div>
          {selectedNode.filePath && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className={styles.codePill}>{selectedNode.filePath}</span>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => onOpenFile(selectedNode.filePath!)}
              >
                Open in Editor
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
