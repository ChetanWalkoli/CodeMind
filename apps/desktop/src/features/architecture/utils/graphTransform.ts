import type { Edge, Node } from "@xyflow/react";
import type { DependencyGraphSnapshot, FileNode, SupportedLanguage } from "@codemind/shared";

export interface ArchitectureNodeData extends Record<string, unknown> {
  filePath: string;
  fileName: string;
  folder: string;
  language: SupportedLanguage;
  incomingCount: number;
  outgoingCount: number;
  isSelected: boolean;
  isConnected: boolean;
  isDimmed: boolean;
}

export type ArchitectureFlowNode = Node<ArchitectureNodeData, "architectureNode">;
export type ArchitectureFlowEdge = Edge<{
  relation: string;
  confidence: string;
  isHighlighted: boolean;
}>;

export interface GraphTransformOptions {
  searchQuery?: string;
  languageFilter?: SupportedLanguage | "all";
  moduleFilter?: string | "all";
  selectedNodeId?: string | null;
  focusNeighborhood?: boolean;
  maxVisibleNodes?: number;
}

export interface TransformedGraph {
  nodes: ArchitectureFlowNode[];
  edges: ArchitectureFlowEdge[];
  totalNodeCount: number;
  totalMatchingCount: number;
  truncatedCount: number;
  availableModules: string[];
  availableLanguages: SupportedLanguage[];
}

export function getModuleName(filePath: string): string {
  const segments = filePath.split("/");
  return segments.length > 1 ? segments[0]! : "(root)";
}

export function getFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

export function getParentFolder(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx > 0 ? filePath.slice(0, idx) : "(root)";
}

/**
 * Pure, deterministic transformation from Phase 3 DependencyGraphSnapshot
 * to React Flow nodes & edges with filtering, progressive node caps,
 * connected-node highlighting, and module-grouped column layout.
 */
export function transformDependencyGraph(
  snapshot: DependencyGraphSnapshot,
  options: GraphTransformOptions = {}
): TransformedGraph {
  const searchLower = (options.searchQuery ?? "").trim().toLowerCase();
  const languageFilter = options.languageFilter ?? "all";
  const moduleFilter = options.moduleFilter ?? "all";
  const selectedNodeId = options.selectedNodeId ?? null;
  const focusNeighborhood = Boolean(options.focusNeighborhood && selectedNodeId);
  const maxVisibleNodes = options.maxVisibleNodes ?? 60;

  // Build adjacency maps from the full snapshot for accurate counts & neighborhood lookup
  const outgoingMap = new Map<string, Set<string>>();
  const incomingMap = new Map<string, Set<string>>();
  const moduleSet = new Set<string>();
  const languageSet = new Set<SupportedLanguage>();

  for (const node of snapshot.nodes) {
    outgoingMap.set(node.id, new Set());
    incomingMap.set(node.id, new Set());
    moduleSet.add(getModuleName(node.path));
    languageSet.add(node.language);
  }

  for (const edge of snapshot.edges) {
    outgoingMap.get(edge.sourceId)?.add(edge.targetId);
    incomingMap.get(edge.targetId)?.add(edge.sourceId);
  }

  // Compute direct neighbors of selectedNodeId for highlighting & focus mode
  const connectedIds = new Set<string>();
  if (selectedNodeId) {
    connectedIds.add(selectedNodeId);
    for (const target of outgoingMap.get(selectedNodeId) ?? []) {
      connectedIds.add(target);
    }
    for (const source of incomingMap.get(selectedNodeId) ?? []) {
      connectedIds.add(source);
    }
  }

  // Filter nodes before layout/rendering
  const filtered: FileNode[] = snapshot.nodes.filter((node) => {
    if (focusNeighborhood && !connectedIds.has(node.id)) {
      return false;
    }
    if (languageFilter !== "all" && node.language !== languageFilter) {
      return false;
    }
    if (moduleFilter !== "all" && getModuleName(node.path) !== moduleFilter) {
      return false;
    }
    if (searchLower && !node.path.toLowerCase().includes(searchLower)) {
      return false;
    }
    return true;
  });

  // Prioritize selected node, connected neighbors, then highest degree (most central files)
  const prioritized = [...filtered].sort((a, b) => {
    if (a.id === selectedNodeId) return -1;
    if (b.id === selectedNodeId) return 1;
    const aConn = connectedIds.has(a.id) ? 1 : 0;
    const bConn = connectedIds.has(b.id) ? 1 : 0;
    if (aConn !== bConn) return bConn - aConn;

    const aDegree = (incomingMap.get(a.id)?.size ?? 0) + (outgoingMap.get(a.id)?.size ?? 0);
    const bDegree = (incomingMap.get(b.id)?.size ?? 0) + (outgoingMap.get(b.id)?.size ?? 0);
    if (aDegree !== bDegree) return bDegree - aDegree;
    return a.path.localeCompare(b.path);
  });

  const visibleFiles = prioritized.slice(0, maxVisibleNodes);
  const visibleIds = new Set(visibleFiles.map((f) => f.id));
  const truncatedCount = Math.max(0, filtered.length - visibleFiles.length);

  // Deterministic folder/module-grouped column layout
  const groups = new Map<string, FileNode[]>();
  for (const file of visibleFiles) {
    const folderKey = getParentFolder(file.path);
    const list = groups.get(folderKey) ?? [];
    list.push(file);
    groups.set(folderKey, list);
  }

  const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const COLUMN_WIDTH = 280;
  const ROW_HEIGHT = 96;
  const MAX_ROWS_PER_COLUMN = 8;

  const flowNodes: ArchitectureFlowNode[] = [];
  let colIndex = 0;

  for (const groupKey of sortedGroupKeys) {
    const groupFiles = (groups.get(groupKey) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    let rowIndex = 0;

    for (const file of groupFiles) {
      if (rowIndex >= MAX_ROWS_PER_COLUMN) {
        rowIndex = 0;
        colIndex += 1;
      }

      const isSelected = file.id === selectedNodeId;
      const isConnected = selectedNodeId !== null && connectedIds.has(file.id);
      const isDimmed = selectedNodeId !== null && !isConnected;

      flowNodes.push({
        id: file.id,
        type: "architectureNode",
        position: {
          x: colIndex * COLUMN_WIDTH,
          y: rowIndex * ROW_HEIGHT
        },
        data: {
          filePath: file.path,
          fileName: getFileName(file.path),
          folder: getParentFolder(file.path),
          language: file.language,
          incomingCount: incomingMap.get(file.id)?.size ?? 0,
          outgoingCount: outgoingMap.get(file.id)?.size ?? 0,
          isSelected,
          isConnected,
          isDimmed
        }
      });

      rowIndex += 1;
    }

    colIndex += 1;
  }

  // Only include edges whose endpoints are both visible
  const flowEdges: ArchitectureFlowEdge[] = snapshot.edges
    .filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId))
    .map((edge) => {
      const isHighlighted =
        selectedNodeId !== null &&
        (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId);
      const isDimmed = selectedNodeId !== null && !isHighlighted;

      return {
        id: `${edge.sourceId}->${edge.targetId}`,
        source: edge.sourceId,
        target: edge.targetId,
        animated: isHighlighted,
        style: {
          stroke: isHighlighted
            ? "var(--accent)"
            : edge.confidence === "inferred"
              ? "var(--text-muted)"
              : "var(--border-strong)",
          strokeWidth: isHighlighted ? 2 : 1.2,
          strokeDasharray: edge.confidence === "inferred" ? "4 3" : undefined,
          opacity: isDimmed ? 0.2 : 1
        },
        data: {
          relation: edge.relation,
          confidence: edge.confidence,
          isHighlighted
        }
      };
    });

  return {
    nodes: flowNodes,
    edges: flowEdges,
    totalNodeCount: snapshot.nodes.length,
    totalMatchingCount: filtered.length,
    truncatedCount,
    availableModules: Array.from(moduleSet).sort(),
    availableLanguages: Array.from(languageSet).sort()
  };
}
