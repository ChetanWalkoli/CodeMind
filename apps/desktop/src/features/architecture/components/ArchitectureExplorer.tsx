import { useEffect, useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Focus, Network, RotateCcw } from "lucide-react";
import type { SupportedLanguage } from "@codemind/shared";
import { useArchitectureStore } from "../../../stores/architecture.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { transformDependencyGraph } from "../utils/graphTransform";
import { ArchitectureInspector } from "./ArchitectureInspector";
import { ArchitectureNode } from "./ArchitectureNode";
import styles from "./ArchitectureExplorer.module.scss";

const NODE_TYPES = {
  architectureNode: ArchitectureNode
};

export function ArchitectureExplorer() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const isIndexing = useWorkspaceStore((s) => s.isIndexing);
  const indexSummary = useWorkspaceStore((s) => s.indexSummary);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);

  const graphSnapshot = useArchitectureStore((s) => s.graphSnapshot);
  const isLoadingGraph = useArchitectureStore((s) => s.isLoadingGraph);
  const error = useArchitectureStore((s) => s.error);
  const selectedNodeId = useArchitectureStore((s) => s.selectedNodeId);
  const searchQuery = useArchitectureStore((s) => s.searchQuery);
  const languageFilter = useArchitectureStore((s) => s.languageFilter);
  const moduleFilter = useArchitectureStore((s) => s.moduleFilter);
  const focusNeighborhood = useArchitectureStore((s) => s.focusNeighborhood);
  const maxVisibleNodes = useArchitectureStore((s) => s.maxVisibleNodes);

  const loadArchitecture = useArchitectureStore((s) => s.loadArchitecture);
  const selectNode = useArchitectureStore((s) => s.selectNode);
  const setSearchQuery = useArchitectureStore((s) => s.setSearchQuery);
  const setLanguageFilter = useArchitectureStore((s) => s.setLanguageFilter);
  const setModuleFilter = useArchitectureStore((s) => s.setModuleFilter);
  const toggleFocusNeighborhood = useArchitectureStore((s) => s.toggleFocusNeighborhood);
  const increaseVisibleLimit = useArchitectureStore((s) => s.increaseVisibleLimit);
  const resetFilters = useArchitectureStore((s) => s.resetFilters);

  useEffect(() => {
    if (workspace && !isIndexing) {
      void loadArchitecture(workspace.rootPath);
    }
  }, [workspace, isIndexing, indexSummary?.indexedAt, loadArchitecture]);

  const transformed = useMemo(() => {
    if (!graphSnapshot) return null;
    return transformDependencyGraph(graphSnapshot, {
      searchQuery,
      languageFilter,
      moduleFilter,
      selectedNodeId,
      focusNeighborhood,
      maxVisibleNodes
    });
  }, [
    graphSnapshot,
    searchQuery,
    languageFilter,
    moduleFilter,
    selectedNodeId,
    focusNeighborhood,
    maxVisibleNodes
  ]);

  if (!workspace) {
    return (
      <div className={styles.emptyState} data-testid="architecture-explorer-no-workspace">
        <Network size={28} aria-hidden="true" />
        <h2 className={styles.emptyHeading}>No workspace open</h2>
        <p className={styles.emptySubtext}>
          Open a local project folder to visualize its real file and dependency architecture.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="architecture-explorer">
      <div className={styles.controlsBar}>
        <div className={styles.filterGroup}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Filter graph nodes..."
            aria-label="Filter graph nodes"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className={styles.select}
            aria-label="Filter by module"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
          >
            <option value="all">All modules</option>
            {(transformed?.availableModules ?? []).map((mod) => (
              <option key={mod} value={mod}>
                {mod}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            aria-label="Filter by language"
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value as SupportedLanguage | "all")}
          >
            <option value="all">All languages</option>
            {(transformed?.availableLanguages ?? []).map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>

          {selectedNodeId && (
            <button
              type="button"
              className={`${styles.btn} ${focusNeighborhood ? styles.btnActive : ""}`}
              onClick={toggleFocusNeighborhood}
              aria-pressed={focusNeighborhood}
              title="Show only selected node and its direct connections"
            >
              <Focus size={12} aria-hidden="true" />
              <span>Focus Connected</span>
            </button>
          )}

          {(searchQuery ||
            languageFilter !== "all" ||
            moduleFilter !== "all" ||
            focusNeighborhood) && (
            <button type="button" className={styles.btn} onClick={resetFilters}>
              <RotateCcw size={12} aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
        </div>

        <button type="button" className={styles.btn} onClick={() => setCenterView("editor")}>
          <ArrowLeft size={12} aria-hidden="true" />
          <span>Editor</span>
        </button>
      </div>

      {transformed && transformed.truncatedCount > 0 && (
        <div className={styles.truncationBanner} data-testid="graph-truncation-banner">
          <span>
            Showing {transformed.nodes.length} of {transformed.totalMatchingCount} matching files
            (prioritizing most connected). Filter or focus a node for large repositories.
          </span>
          <button type="button" className={styles.btn} onClick={increaseVisibleLimit}>
            Show +60 More
          </button>
        </div>
      )}

      {error ? (
        <div className={styles.emptyState} role="alert">
          <h2 className={styles.emptyHeading}>Could not load architecture graph</h2>
          <p className={styles.emptySubtext}>{error}</p>
        </div>
      ) : isIndexing || (isLoadingGraph && !transformed) ? (
        <div className={styles.emptyState}>
          <p className={styles.emptySubtext}>Building project dependency graph...</p>
        </div>
      ) : !transformed || transformed.nodes.length === 0 ? (
        <div className={styles.emptyState} data-testid="architecture-explorer-empty">
          <Network size={24} aria-hidden="true" />
          <h2 className={styles.emptyHeading}>No matching files to display</h2>
          <p className={styles.emptySubtext}>
            {transformed && transformed.totalNodeCount > 0
              ? "Adjust your search or module/language filters to see indexed files."
              : "This workspace does not have any indexed source files yet."}
          </p>
        </div>
      ) : (
        <div className={styles.mainArea}>
          <div className={styles.canvasWrap}>
            <ReactFlow
              nodes={transformed.nodes}
              edges={transformed.edges}
              nodeTypes={NODE_TYPES}
              fitView
              minZoom={0.2}
              maxZoom={2}
              onNodeClick={(_event, node) => {
                void selectNode(workspace.rootPath, node.id);
              }}
              onPaneClick={() => {
                void selectNode(workspace.rootPath, null);
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>

          <ArchitectureInspector />
        </div>
      )}
    </div>
  );
}
