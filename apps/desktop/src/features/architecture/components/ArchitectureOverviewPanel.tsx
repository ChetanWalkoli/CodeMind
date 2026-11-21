import { useEffect } from "react";
import { Network, RefreshCw } from "lucide-react";
import { useArchitectureStore } from "../../../stores/architecture.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import styles from "./ArchitectureOverviewPanel.module.scss";

export function ArchitectureOverviewPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const isIndexing = useWorkspaceStore((s) => s.isIndexing);
  const indexSummary = useWorkspaceStore((s) => s.indexSummary);
  const centerView = useWorkspaceStore((s) => s.centerView);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const refreshIndex = useWorkspaceStore((s) => s.refreshIndex);

  const overview = useArchitectureStore((s) => s.overview);
  const isLoadingGraph = useArchitectureStore((s) => s.isLoadingGraph);
  const moduleFilter = useArchitectureStore((s) => s.moduleFilter);
  const loadArchitecture = useArchitectureStore((s) => s.loadArchitecture);
  const setModuleFilter = useArchitectureStore((s) => s.setModuleFilter);

  useEffect(() => {
    if (workspace && !isIndexing) {
      void loadArchitecture(workspace.rootPath);
    }
  }, [workspace, isIndexing, indexSummary?.indexedAt, loadArchitecture]);

  if (!workspace) {
    return (
      <div className={styles.emptyCard} data-testid="architecture-overview-empty">
        Open a project folder to inspect its architecture, modules, and dependency graph.
      </div>
    );
  }

  const handleReindex = async () => {
    await refreshIndex(false);
    await loadArchitecture(workspace.rootPath);
  };

  return (
    <div className={styles.panel} data-testid="architecture-overview-panel">
      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => setCenterView(centerView === "architecture" ? "editor" : "architecture")}
        >
          <Network size={13} aria-hidden="true" />
          <span>{centerView === "architecture" ? "Back to Editor" : "Open Graph View"}</span>
        </button>

        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void handleReindex()}
          disabled={isIndexing || isLoadingGraph}
          aria-label="Re-index workspace architecture"
          title="Re-index workspace"
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>

      {isIndexing || (isLoadingGraph && !overview) ? (
        <div className={styles.emptyCard}>Indexing workspace architecture...</div>
      ) : !overview ? (
        <div className={styles.emptyCard}>
          Workspace has not been indexed yet. Click refresh to analyze project files.
        </div>
      ) : (
        <>
          <div className={styles.statGrid}>
            <div className={styles.statCard}>
              <span className={styles.statValue} data-testid="overview-total-files">
                {overview.totalFiles}
              </span>
              <span className={styles.statLabel}>Indexed Files</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue} data-testid="overview-total-symbols">
                {overview.totalSymbols}
              </span>
              <span className={styles.statLabel}>Symbols</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue} data-testid="overview-total-edges">
                {overview.totalInternalEdges}
              </span>
              <span className={styles.statLabel}>Internal Links</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{overview.externalPackages.length}</span>
              <span className={styles.statLabel}>External Pkgs</span>
            </div>
          </div>

          {overview.modules.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Modules / Top Folders</h3>
              <div className={styles.list}>
                {overview.modules.slice(0, 12).map((mod) => {
                  const isActive = moduleFilter === mod.name;
                  return (
                    <button
                      key={mod.name}
                      type="button"
                      className={`${styles.listRow} ${styles.listRowInteractive} ${
                        isActive ? styles.listRowActive : ""
                      }`}
                      onClick={() => {
                        setModuleFilter(isActive ? "all" : mod.name);
                        setCenterView("architecture");
                      }}
                    >
                      <span>{mod.name}</span>
                      <span className={styles.count}>
                        {mod.fileCount}f · {mod.symbolCount}s
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {overview.languages.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Detected File Types</h3>
              <div className={styles.list}>
                {overview.languages.map((lang) => (
                  <div key={lang.language} className={styles.listRow}>
                    <span>{lang.language}</span>
                    <span className={styles.count}>{lang.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {overview.externalPackages.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>External Dependencies</h3>
              <div className={styles.list}>
                {overview.externalPackages.slice(0, 10).map((pkg) => (
                  <div key={pkg.name} className={styles.listRow}>
                    <span>{pkg.name}</span>
                    <span className={styles.count}>{pkg.importCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(overview.unresolvedImportCount > 0 || overview.diagnosticCount > 0) && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Index Notes</h3>
              <div className={styles.emptyCard}>
                {overview.unresolvedImportCount > 0 && (
                  <div>Unresolved local imports: {overview.unresolvedImportCount}</div>
                )}
                {overview.diagnosticCount > 0 && (
                  <div>Parse diagnostics: {overview.diagnosticCount}</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
