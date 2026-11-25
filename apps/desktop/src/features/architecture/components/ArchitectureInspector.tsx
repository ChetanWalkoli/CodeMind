import { ArrowUpRight, GitBranch, Sparkles, X } from "lucide-react";
import { launchIntentFromContext } from "../../../services/evidenceNavigation";
import { useImpactStore } from "../../../stores/impact.store";
import type { CodeSymbol } from "@codemind/shared";
import { useArchitectureStore } from "../../../stores/architecture.store";
import { useEditorStore } from "../../../stores/editor.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { getFileName } from "../utils/graphTransform";
import styles from "./ArchitectureInspector.module.scss";

function getContainingSymbol(symbol: CodeSymbol): string | null {
  const dotIdx = symbol.name.indexOf(".");
  return dotIdx > 0 ? symbol.name.slice(0, dotIdx) : null;
}

export function ArchitectureInspector() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const persistSession = useWorkspaceStore((s) => s.persistSession);
  const openWorkspaceFile = useEditorStore((s) => s.openWorkspaceFile);

  const selectedNodeId = useArchitectureStore((s) => s.selectedNodeId);
  const intel = useArchitectureStore((s) => s.selectedFileIntel);
  const selectedSymbol = useArchitectureStore((s) => s.selectedSymbol);
  const isLoading = useArchitectureStore((s) => s.isLoadingInspector);
  const selectNode = useArchitectureStore((s) => s.selectNode);
  const selectSymbol = useArchitectureStore((s) => s.selectSymbol);

  if (!workspace || !selectedNodeId) {
    return null;
  }

  const navigateToSource = async (relativePath: string, line?: number) => {
    const res = await openWorkspaceFile(
      workspace.rootPath,
      relativePath,
      line ? { line, column: 1 } : undefined
    );
    if (res.ok) {
      setCenterView("editor");
      void persistSession();
    }
  };

  const resolvedInternalImports =
    intel?.imports.filter((imp) => !imp.isExternal && imp.resolvedPath !== null) ?? [];
  const externalImports = intel?.imports.filter((imp) => imp.isExternal) ?? [];
  const unresolvedImports =
    intel?.imports.filter((imp) => !imp.isExternal && imp.resolvedPath === null) ?? [];

  return (
    <aside
      className={styles.inspector}
      aria-label="File and symbol inspector"
      data-testid="architecture-inspector"
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{getFileName(selectedNodeId)}</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => void selectNode(workspace.rootPath, null)}
          aria-label="Close inspector"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.pathText}>{selectedNodeId}</div>

        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => void navigateToSource(selectedNodeId)}
        >
          <ArrowUpRight size={13} aria-hidden="true" />
          <span>Open File in Editor</span>
        </button>

        <button
          type="button"
          className={styles.itemBtn}
          onClick={() =>
            void launchIntentFromContext({
              workspaceRoot: workspace.rootPath,
              goal: `Investigate and improve ${selectedNodeId}`
            })
          }
          data-testid="arch-improve-in-intent-btn"
        >
          <Sparkles size={13} aria-hidden="true" />
          <span>Improve in Intent Mode</span>
        </button>

        <button
          type="button"
          className={styles.itemBtn}
          onClick={() => {
            useWorkspaceStore.getState().setActiveNav("impact");
            void useImpactStore.getState().analyzeFiles({
              workspaceRoot: workspace.rootPath,
              filePaths: [selectedNodeId]
            });
          }}
          data-testid="arch-check-impact-btn"
        >
          <GitBranch size={13} aria-hidden="true" />
          <span>Check Change Impact</span>
        </button>

        {isLoading ? (
          <div className={styles.emptyNote}>Loading file intelligence...</div>
        ) : !intel ? (
          <div className={styles.emptyNote}>No indexed metadata available for this file.</div>
        ) : (
          <>
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Imported By ({intel.dependents.length})</h3>
              {intel.dependents.length === 0 ? (
                <span className={styles.emptyNote}>No indexed files import this file.</span>
              ) : (
                <div className={styles.list}>
                  {intel.dependents.map((edge) => (
                    <button
                      key={edge.sourceId}
                      type="button"
                      className={styles.itemBtn}
                      onClick={() => void navigateToSource(edge.sourceId)}
                      title={`Open ${edge.sourceId}`}
                    >
                      <span className={styles.itemText}>{edge.sourceId}</span>
                      <span className={styles.badge}>{edge.confidence}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                Internal Dependencies ({resolvedInternalImports.length})
              </h3>
              {resolvedInternalImports.length === 0 ? (
                <span className={styles.emptyNote}>No resolved internal imports.</span>
              ) : (
                <div className={styles.list}>
                  {resolvedInternalImports.map((imp, idx) => (
                    <button
                      key={`${imp.resolvedPath}-${imp.line}-${idx}`}
                      type="button"
                      className={styles.itemBtn}
                      onClick={() => void navigateToSource(imp.resolvedPath!)}
                      title={`Open ${imp.resolvedPath} (imported at line ${imp.line})`}
                    >
                      <span className={styles.itemText}>{imp.resolvedPath}</span>
                      <span className={styles.badge}>{imp.confidence}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {externalImports.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  External Packages ({externalImports.length})
                </h3>
                <div className={styles.list}>
                  {externalImports.map((imp, idx) => (
                    <div key={`${imp.specifier}-${idx}`} className={styles.staticRow}>
                      <span className={styles.itemText}>{imp.specifier}</span>
                      <span className={styles.badge}>L{imp.line}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {unresolvedImports.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Unresolved Local Imports ({unresolvedImports.length})
                </h3>
                <div className={styles.list}>
                  {unresolvedImports.map((imp, idx) => (
                    <div key={`${imp.specifier}-${idx}`} className={styles.staticRow}>
                      <span className={styles.itemText}>{imp.specifier}</span>
                      <span className={styles.badge}>unresolved · L{imp.line}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Symbols ({intel.symbols.length})</h3>
              {intel.symbols.length === 0 ? (
                <span className={styles.emptyNote}>No symbols extracted from this file.</span>
              ) : (
                <div className={styles.list}>
                  {intel.symbols.map((sym) => {
                    const isSelected = selectedSymbol?.id === sym.id;
                    return (
                      <button
                        key={sym.id}
                        type="button"
                        className={`${styles.itemBtn} ${isSelected ? styles.itemBtnActive : ""}`}
                        onClick={() => selectSymbol(isSelected ? null : sym)}
                      >
                        <span className={styles.itemText}>{sym.name}</span>
                        <span className={styles.badge}>{sym.kind}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedSymbol && (
              <div className={styles.symbolDetailCard} data-testid="symbol-detail-card">
                <strong>{selectedSymbol.name}</strong>
                <div className={styles.metaRow}>
                  <span>Kind</span>
                  <span>{selectedSymbol.kind}</span>
                </div>
                <div className={styles.metaRow}>
                  <span>Location</span>
                  <span>
                    Lines {selectedSymbol.startLine}–{selectedSymbol.endLine}
                  </span>
                </div>
                <div className={styles.metaRow}>
                  <span>Exported</span>
                  <span>{selectedSymbol.exported ? "Yes" : "Internal"}</span>
                </div>
                {getContainingSymbol(selectedSymbol) && (
                  <div className={styles.metaRow}>
                    <span>Parent</span>
                    <span>{getContainingSymbol(selectedSymbol)}</span>
                  </div>
                )}
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() =>
                    void navigateToSource(selectedSymbol.filePath, selectedSymbol.startLine)
                  }
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                  <span>Jump to Line {selectedSymbol.startLine}</span>
                </button>
                <p className={styles.limitationNote}>
                  Note: Cross-file symbol call/reference graphs are not yet indexed; file-level
                  importers are shown above.
                </p>
              </div>
            )}

            {intel.exports.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Exports ({intel.exports.length})</h3>
                <div className={styles.list}>
                  {intel.exports.map((exp, idx) => (
                    <button
                      key={`${exp.name}-${exp.line}-${idx}`}
                      type="button"
                      className={styles.itemBtn}
                      onClick={() => void navigateToSource(exp.filePath, exp.line)}
                    >
                      <span className={styles.itemText}>{exp.name}</span>
                      <span className={styles.badge}>
                        {exp.kind} · L{exp.line}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {intel.diagnostics.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Parse Diagnostics ({intel.diagnostics.length})
                </h3>
                <div className={styles.list}>
                  {intel.diagnostics.map((diag, idx) => (
                    <div key={idx} className={styles.diagItem}>
                      L{diag.line}:{diag.column} — {diag.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
