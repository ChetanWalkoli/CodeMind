import { useEffect, useState } from "react";
import type { ImpactChangeType, ImpactRiskLevel } from "@codemind/shared";
import { useEditorStore } from "../../stores/editor.store";
import { useImpactStore } from "../../stores/impact.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./Impact.module.scss";

function riskBadgeClass(level: ImpactRiskLevel): string {
  switch (level) {
    case "critical":
      return styles.riskCritical ?? "";
    case "high":
      return styles.riskHigh ?? "";
    case "medium":
      return styles.riskMedium ?? "";
    default:
      return styles.riskLow ?? "";
  }
}

export function ImpactSidebarPanel() {
  const workspaceRoot = useWorkspaceStore((s) => s.workspace?.rootPath ?? null);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeEditorFile = tabs.find((t) => t.id === activeTabId)?.relativePath ?? null;

  const {
    summaries,
    activeAnalysis,
    isAnalyzing,
    error,
    loadSummaries,
    selectAnalysis,
    analyzeFiles,
    analyzeGitDiff,
    deleteAnalysis
  } = useImpactStore();

  const [targetInput, setTargetInput] = useState("");
  const [symbolInput, setSymbolInput] = useState("");
  const [changeType, setChangeType] = useState<ImpactChangeType>("file_modified");
  const [maxDepth, setMaxDepth] = useState(3);

  useEffect(() => {
    if (workspaceRoot) {
      void loadSummaries(workspaceRoot);
    }
  }, [workspaceRoot, loadSummaries]);

  if (!workspaceRoot) {
    return (
      <div className={styles.sidebarPanel} data-testid="impact-sidebar-no-workspace">
        <p className={styles.muted}>Open a workspace folder to analyze Change Impact.</p>
      </div>
    );
  }

  const handleAnalyzeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paths = targetInput
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const res = await analyzeFiles({
      workspaceRoot,
      filePaths: paths,
      symbolName: symbolInput.trim() || undefined,
      changeType,
      maxDepth
    });
    if (res) {
      setCenterView("impact");
    }
  };

  const handleAnalyzeGitDiff = async () => {
    const res = await analyzeGitDiff(workspaceRoot, maxDepth);
    if (res) {
      setCenterView("impact");
    }
  };

  return (
    <div className={styles.sidebarPanel} data-testid="impact-sidebar-panel">
      <h4 className={styles.sectionTitle}>Predict Change Impact</h4>

      <form className={styles.formGroup} onSubmit={handleAnalyzeSubmit}>
        <input
          type="text"
          className={styles.input}
          placeholder="Relative file path(s), comma-separated"
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          aria-label="Target file path"
        />

        {activeEditorFile && (
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => setTargetInput(activeEditorFile)}
          >
            Use Active: {activeEditorFile.split("/").pop()}
          </button>
        )}

        <input
          type="text"
          className={styles.input}
          placeholder="Optional symbol name"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          aria-label="Optional symbol name"
        />

        <div className={styles.buttonRow}>
          <select
            className={styles.select}
            value={changeType}
            onChange={(e) => setChangeType(e.target.value as ImpactChangeType)}
            aria-label="Change type"
            style={{ flex: 2 }}
          >
            <option value="file_modified">File Modified</option>
            <option value="symbol_modified">Symbol Modified</option>
            <option value="api_contract_changed">API Contract Changed</option>
            <option value="database_contract_changed">Database Contract Changed</option>
            <option value="symbol_removed">Symbol Removed</option>
            <option value="file_deleted">File Deleted</option>
          </select>

          <select
            className={styles.select}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            aria-label="Max traversal depth"
            style={{ flex: 1 }}
          >
            <option value={1}>Depth 1</option>
            <option value={2}>Depth 2</option>
            <option value={3}>Depth 3</option>
            <option value={4}>Depth 4</option>
            <option value={5}>Depth 5</option>
          </select>
        </div>

        <div className={styles.buttonRow}>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={isAnalyzing || !targetInput.trim()}
          >
            {isAnalyzing ? "Analyzing..." : "Analyze Impact"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={isAnalyzing}
            onClick={handleAnalyzeGitDiff}
            title="Analyze uncommitted Git changes (read-only)"
          >
            Git Diff
          </button>
        </div>
      </form>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      <h4 className={styles.sectionTitle}>Recent Analyses ({summaries.length})</h4>

      <div className={styles.historyList}>
        {summaries.length === 0 ? (
          <p className={styles.muted}>No impact analyses yet. Analyze a file or Git diff above.</p>
        ) : (
          summaries.map((item) => {
            const isSelected = activeAnalysis?.analysisId === item.analysisId;
            return (
              <div
                key={item.analysisId}
                role="button"
                tabIndex={0}
                className={`${styles.historyCard} ${isSelected ? styles.historyCardActive : ""}`}
                onClick={() => {
                  void selectAnalysis(workspaceRoot, item.analysisId);
                  setCenterView("impact");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void selectAnalysis(workspaceRoot, item.analysisId);
                    setCenterView("impact");
                  }
                }}
              >
                <div className={styles.historyHeader}>
                  <span className={styles.historyTargets} title={item.targetFiles.join(", ")}>
                    {item.targetFiles[0]?.split("/").pop() ?? item.analysisId}
                    {item.targetFiles.length > 1 ? ` +${item.targetFiles.length - 1}` : ""}
                  </span>
                  <span className={`${styles.badge} ${riskBadgeClass(item.riskLevel)}`}>
                    {item.riskLevel} {item.riskScore}
                  </span>
                </div>
                <div className={styles.historyMeta}>
                  <span>
                    {item.impactedFileCount} files · {item.impactedTestCount} tests ·{" "}
                    {item.relatedDecisionCount} decisions
                  </span>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    aria-label={`Delete analysis ${item.analysisId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteAnalysis(workspaceRoot, item.analysisId);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
