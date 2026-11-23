import { useState } from "react";
import type { ImpactCategory, ImpactRiskLevel, ImpactValidationStepStatus } from "@codemind/shared";
import { useEditorStore } from "../../stores/editor.store";
import { useImpactStore, type ImpactWorkspaceTab } from "../../stores/impact.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import { ImpactGraph } from "./ImpactGraph";
import styles from "./Impact.module.scss";

function riskClass(level: ImpactRiskLevel): string {
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

export function ImpactWorkspace() {
  const workspaceRoot = useWorkspaceStore((s) => s.workspace?.rootPath ?? null);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const openWorkspaceFile = useEditorStore((s) => s.openWorkspaceFile);

  const {
    activeAnalysis,
    activeTab,
    selectedNodeId,
    isLoading,
    isAnalyzing,
    error,
    setActiveTab,
    setSelectedNodeId,
    analyzeFiles,
    checkFreshness,
    updateValidationStep
  } = useImpactStore();

  const [categoryFilter, setCategoryFilter] = useState<"all" | ImpactCategory>("all");

  const handleOpenFile = (filePath: string, line?: number) => {
    if (!workspaceRoot) return;
    void openWorkspaceFile(workspaceRoot, filePath, line ? { line } : undefined);
    setCenterView("editor");
  };

  if (!activeAnalysis) {
    if (isLoading || isAnalyzing) {
      return (
        <div className={styles.workspace} data-testid="impact-workspace-loading">
          <div className={styles.emptyState}>
            <h3 style={{ margin: 0, color: "var(--cm-text-primary)" }}>
              {isAnalyzing ? "Analyzing Change Impact..." : "Loading Impact Analysis..."}
            </h3>
            <p className={styles.muted}>
              Evaluating static dependencies, API &amp; database contracts, tests, and Decision
              Memory.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.workspace} data-testid="impact-workspace-empty">
        <div className={styles.emptyState}>
          <h3 style={{ margin: 0, color: "var(--cm-text-primary)" }}>Change Impact Intelligence</h3>
          <p className={styles.muted} style={{ maxWidth: 460 }}>
            Predict downstream dependencies, API &amp; database contract exposure, affected tests,
            related engineering decisions, explainable risk scores, and validation plans before you
            merge. Select a target file or click <strong>Git Diff</strong> in the left sidebar.
          </p>
        </div>
      </div>
    );
  }

  const isStale = activeAnalysis.status === "stale" || activeAnalysis.staleFiles.length > 0;

  const filteredFiles =
    categoryFilter === "all"
      ? activeAnalysis.impactedFiles
      : activeAnalysis.impactedFiles.filter((f) => f.category === categoryFilter);

  const tabs: Array<{ id: ImpactWorkspaceTab; label: string }> = [
    { id: "overview", label: "Overview & Graph" },
    { id: "files", label: `Affected Files (${activeAnalysis.impactedFiles.length})` },
    {
      id: "contracts",
      label: `API & DB (${activeAnalysis.apiContracts.length + activeAnalysis.databaseContracts.length})`
    },
    { id: "tests", label: `Tests (${activeAnalysis.impactedTests.length})` },
    { id: "decisions", label: `Decisions (${activeAnalysis.relatedDecisions.length})` },
    { id: "validation", label: `Validation Plan (${activeAnalysis.validationPlan.length})` }
  ];

  const handleReanalyze = () => {
    if (!workspaceRoot) return;
    void analyzeFiles({
      workspaceRoot,
      filePaths: activeAnalysis.analyzedTargets.map((t) => t.filePath),
      symbolName: activeAnalysis.analyzedTargets[0]?.symbolName,
      changeType: activeAnalysis.changeType,
      maxDepth: activeAnalysis.coverage.maxDepthConfigured
    });
  };

  return (
    <div className={styles.workspace} data-testid="impact-workspace">
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>
              {activeAnalysis.analyzedTargets.map((t) => t.filePath).join(", ")}
            </h2>
            <span
              className={`${styles.badge} ${riskClass(activeAnalysis.risk.level)}`}
              data-testid="impact-risk-badge"
            >
              {activeAnalysis.risk.level.toUpperCase()} RISK · {activeAnalysis.risk.score}/100
            </span>
            <span className={`${styles.badge} ${styles.neutralBadge}`}>
              {activeAnalysis.completeness}
            </span>
            <span className={`${styles.badge} ${styles.neutralBadge}`}>
              {activeAnalysis.risk.calculationVersion}
            </span>
          </div>

          <div className={styles.buttonRow}>
            {workspaceRoot && (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void checkFreshness(workspaceRoot, activeAnalysis.analysisId)}
                >
                  Check Freshness
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={isAnalyzing}
                  onClick={handleReanalyze}
                >
                  {isAnalyzing ? "Reanalyzing..." : "Reanalyze"}
                </button>
              </>
            )}
          </div>
        </div>

        <p className={styles.muted}>{activeAnalysis.risk.explanation}</p>

        <div className={styles.summaryStats}>
          <span>Indexed files: {activeAnalysis.coverage.totalIndexedFiles}</span>
          <span>Traversed nodes: {activeAnalysis.coverage.traversedNodes}</span>
          <span>
            Depth: {activeAnalysis.coverage.maxDepthReached}/
            {activeAnalysis.coverage.maxDepthConfigured}
          </span>
          <span>Duration: {activeAnalysis.coverage.durationMs}ms</span>
        </div>

        {isStale && (
          <div className={styles.staleBanner} data-testid="impact-stale-banner" role="status">
            <span>
              Stale impact report: {activeAnalysis.staleFiles.length} analyzed file(s) changed on
              disk since this report was generated (
              {activeAnalysis.staleFiles.slice(0, 3).join(", ")}
              ).
            </span>
            <button type="button" className={styles.smallBtn} onClick={handleReanalyze}>
              Reanalyze Now
            </button>
          </div>
        )}

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}
      </div>

      <div className={styles.tabs} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {activeTab === "overview" && (
          <>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Impact Propagation Graph</h3>
              <ImpactGraph
                graphNodes={activeAnalysis.graphNodes}
                graphEdges={activeAnalysis.graphEdges}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onOpenFile={(fp) => handleOpenFile(fp)}
              />
            </div>

            <div className={styles.card} data-testid="impact-risk-factors">
              <h3 className={styles.cardTitle}>
                <span>Explainable Risk Breakdown ({activeAnalysis.risk.score}/100)</span>
                <span className={styles.codePill}>{activeAnalysis.risk.calculationVersion}</span>
              </h3>
              {activeAnalysis.risk.factors.map((factor) => {
                const pct = Math.min(
                  100,
                  Math.round((factor.contribution / factor.maxContribution) * 100)
                );
                return (
                  <div key={factor.factorId} className={styles.factorRow}>
                    <div className={styles.factorHeader}>
                      <strong>{factor.label}</strong>
                      <span>
                        +{factor.contribution} / {factor.maxContribution}
                      </span>
                    </div>
                    <div className={styles.factorBarTrack}>
                      <div className={styles.factorBarFill} style={{ width: `${pct}%` }} />
                    </div>
                    <p className={styles.muted}>{factor.explanation}</p>
                  </div>
                );
              })}
            </div>

            {(activeAnalysis.risk.uncertaintyNotes.length > 0 ||
              activeAnalysis.limitations.length > 0) && (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Analysis Completeness &amp; Limitations</h3>
                <p className={styles.muted}>{activeAnalysis.completenessReason}</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {[...activeAnalysis.risk.uncertaintyNotes, ...activeAnalysis.limitations].map(
                    (note, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {note}
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}
          </>
        )}

        {activeTab === "files" && (
          <>
            <div className={styles.filterBar}>
              {(["all", "direct", "transitive", "potential"] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={categoryFilter === cat ? styles.primaryBtn : styles.secondaryBtn}
                  style={{ flex: "none" }}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>

            {filteredFiles.length === 0 ? (
              <p className={styles.muted}>No impacted files match this filter.</p>
            ) : (
              filteredFiles.map((file) => (
                <div key={file.filePath} className={styles.card}>
                  <div className={styles.cardTitle}>
                    <button
                      type="button"
                      className={styles.fileLinkBtn}
                      onClick={() => handleOpenFile(file.filePath)}
                    >
                      {file.filePath}
                    </button>
                    <span className={`${styles.badge} ${styles.neutralBadge}`}>
                      {file.category} · depth {file.depth}
                    </span>
                  </div>
                  <p className={styles.muted}>{file.explanation}</p>
                  {file.referencedSymbols.length > 0 && (
                    <div className={styles.muted}>
                      Symbols:{" "}
                      {file.referencedSymbols.map((s) => (
                        <span key={s} className={styles.codePill} style={{ marginRight: 4 }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {file.pathsFromTarget.length > 0 && (
                    <div className={styles.pathChain}>
                      Path: {file.pathsFromTarget[0]?.join(" → ")}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "contracts" && (
          <>
            <h3 className={styles.sectionTitle}>
              API Contracts ({activeAnalysis.apiContracts.length})
            </h3>
            {activeAnalysis.apiContracts.length === 0 ? (
              <p className={styles.muted}>No affected API routes were discovered statically.</p>
            ) : (
              activeAnalysis.apiContracts.map((api) => (
                <div key={api.id} className={styles.card}>
                  <div className={styles.cardTitle}>
                    <span>
                      <span className={styles.codePill}>{api.method}</span> {api.endpoint}
                    </span>
                    <span className={`${styles.badge} ${styles.neutralBadge}`}>
                      {api.frontendConsumers.length} consumer(s)
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.fileLinkBtn}
                    onClick={() => handleOpenFile(api.routeFile, api.routeLine)}
                  >
                    Route: {api.routeFile}
                    {api.routeLine ? `:${api.routeLine}` : ""}
                  </button>
                  <p className={styles.muted}>{api.explanation}</p>
                  {api.frontendConsumers.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {api.frontendConsumers.map((fc, idx) => (
                        <button
                          key={`${fc.filePath}-${idx}`}
                          type="button"
                          className={styles.fileLinkBtn}
                          onClick={() => handleOpenFile(fc.filePath, fc.line)}
                        >
                          Consumer ({fc.confidence}): {fc.filePath}
                          {fc.line ? `:${fc.line}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            <h3 className={styles.sectionTitle}>
              Database &amp; Data Models ({activeAnalysis.databaseContracts.length})
            </h3>
            {activeAnalysis.databaseContracts.length === 0 ? (
              <p className={styles.muted}>
                No database schema or model contracts were detected in the target files.
              </p>
            ) : (
              activeAnalysis.databaseContracts.map((db) => (
                <div key={db.id} className={styles.card}>
                  <div className={styles.cardTitle}>
                    <span>
                      {db.modelName} ({db.technology})
                    </span>
                    <span className={`${styles.badge} ${styles.neutralBadge}`}>
                      {db.fields.length} field(s)
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.fileLinkBtn}
                    onClick={() => handleOpenFile(db.schemaFile)}
                  >
                    Schema: {db.schemaFile}
                  </button>
                  <p className={styles.muted}>{db.explanation}</p>
                  {db.changeDetails.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                      {db.changeDetails.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "tests" && (
          <>
            {activeAnalysis.impactedTests.length === 0 ? (
              <div className={styles.card}>
                <p className={styles.muted}>
                  No directly related test was discovered for the analyzed targets. CodeMind does
                  not auto-execute tests; consider adding targeted unit or integration tests.
                </p>
              </div>
            ) : (
              activeAnalysis.impactedTests.map((t) => (
                <div key={t.id} className={styles.card}>
                  <div className={styles.cardTitle}>
                    <button
                      type="button"
                      className={styles.fileLinkBtn}
                      onClick={() => handleOpenFile(t.testFile)}
                    >
                      {t.testFile}
                    </button>
                    <span className={`${styles.badge} ${styles.neutralBadge}`}>
                      {t.classification.replace(/_/g, " ")} · {t.priority}
                    </span>
                  </div>
                  <p className={styles.muted}>{t.reason}</p>
                  {t.dependencyPath.length > 0 && (
                    <div className={styles.pathChain}>Chain: {t.dependencyPath.join(" → ")}</div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "decisions" && (
          <>
            {activeAnalysis.relatedDecisions.length === 0 ? (
              <div className={styles.card}>
                <p className={styles.muted}>
                  No recorded Decision Memory entries reference the affected files.
                </p>
              </div>
            ) : (
              activeAnalysis.relatedDecisions.map((dec) => (
                <div key={dec.decisionId} className={styles.card}>
                  <div className={styles.cardTitle}>
                    <span>{dec.title}</span>
                    <span
                      className={`${styles.badge} ${
                        dec.relation === "possible_conflict" ? styles.riskHigh : styles.neutralBadge
                      }`}
                    >
                      {dec.relation.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className={styles.muted}>{dec.explanation}</p>
                  <div className={styles.summaryStats}>
                    <span>Category: {dec.category}</span>
                    <span>Status: {dec.status}</span>
                    <span>Verification: {dec.verificationStatus}</span>
                  </div>
                  {dec.matchedFiles.length > 0 && (
                    <div className={styles.buttonRow}>
                      {dec.matchedFiles.map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={styles.fileLinkBtn}
                          onClick={() => handleOpenFile(f)}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "validation" && (
          <>
            <p className={styles.muted}>
              Validation steps are recommendations based on real discovered workspace scripts.
              CodeMind never executes commands automatically — review and track each step below.
            </p>
            {activeAnalysis.validationPlan.map((step) => (
              <div
                key={step.stepId}
                className={styles.card}
                data-testid={`val-step-${step.stepId}`}
              >
                <div className={styles.cardTitle}>
                  <span>{step.title}</span>
                  <span
                    className={`${styles.badge} ${
                      step.priority === "critical"
                        ? styles.riskCritical
                        : step.priority === "high"
                          ? styles.riskHigh
                          : styles.neutralBadge
                    }`}
                  >
                    {step.priority} · {step.executionStatus}
                  </span>
                </div>
                <p className={styles.muted}>{step.description}</p>
                {step.recommendedCommand && (
                  <div>
                    Recommended command:{" "}
                    <span className={styles.codePill}>{step.recommendedCommand}</span>
                  </div>
                )}
                {workspaceRoot && (
                  <div className={styles.buttonRow}>
                    {(
                      ["pending", "completed", "skipped", "blocked"] as ImpactValidationStepStatus[]
                    ).map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={
                          step.executionStatus === st ? styles.primaryBtn : styles.smallBtn
                        }
                        style={{ flex: "none" }}
                        onClick={() =>
                          void updateValidationStep(
                            workspaceRoot,
                            activeAnalysis.analysisId,
                            step.stepId,
                            st
                          )
                        }
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
