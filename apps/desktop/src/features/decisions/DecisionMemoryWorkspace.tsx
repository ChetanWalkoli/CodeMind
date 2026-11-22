import { useState } from "react";
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  FileCode2,
  GitCommitHorizontal,
  HelpCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import type {
  DecisionAlternative,
  DecisionCategory,
  DecisionLifecycleStatus,
  DecisionTradeoff
} from "@codemind/shared";
import { useDecisionStore, type DecisionWorkspaceTab } from "../../stores/decision.store";
import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./DecisionMemory.module.scss";

const CATEGORIES: DecisionCategory[] = [
  "architecture",
  "authentication",
  "database",
  "api_design",
  "security",
  "performance",
  "frontend",
  "backend",
  "infrastructure",
  "testing",
  "dependencies",
  "other"
];

const STATUSES: DecisionLifecycleStatus[] = [
  "proposed",
  "accepted",
  "superseded",
  "rejected",
  "deprecated"
];

const WORKSPACE_TABS: Array<{ id: DecisionWorkspaceTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "all", label: "All Decisions" },
  { id: "suggestions", label: "Suggested" },
  { id: "ask_why", label: "Ask Why" },
  { id: "create", label: "+ New Decision" }
];

export function DecisionMemoryWorkspace() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const openWorkspaceFile = useEditorStore((s) => s.openWorkspaceFile);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const editorTabs = useEditorStore((s) => s.tabs);
  const activeEditorTab = editorTabs.find((t) => t.id === activeTabId) ?? null;

  const decisions = useDecisionStore((s) => s.decisions);
  const selectedDecisionId = useDecisionStore((s) => s.selectedDecisionId);
  const activeTab = useDecisionStore((s) => s.activeTab);
  const timeline = useDecisionStore((s) => s.timeline);
  const suggestions = useDecisionStore((s) => s.suggestions);
  const conflicts = useDecisionStore((s) => s.conflicts);
  const searchResults = useDecisionStore((s) => s.searchResults);
  const askWhyAnswer = useDecisionStore((s) => s.askWhyAnswer);
  const gitCommits = useDecisionStore((s) => s.gitCommits);
  const busy = useDecisionStore((s) => s.busy);
  const error = useDecisionStore((s) => s.error);

  const setActiveTab = useDecisionStore((s) => s.setActiveTab);
  const selectDecision = useDecisionStore((s) => s.selectDecision);
  const clearError = useDecisionStore((s) => s.clearError);
  const createDecision = useDecisionStore((s) => s.createDecision);
  const deleteDecision = useDecisionStore((s) => s.deleteDecision);
  const transitionStatus = useDecisionStore((s) => s.transitionStatus);
  const linkEvidence = useDecisionStore((s) => s.linkEvidence);
  const linkCommit = useDecisionStore((s) => s.linkCommit);
  const loadTimeline = useDecisionStore((s) => s.loadTimeline);
  const search = useDecisionStore((s) => s.search);
  const askWhy = useDecisionStore((s) => s.askWhy);
  const verifyAll = useDecisionStore((s) => s.verifyAll);
  const revalidate = useDecisionStore((s) => s.revalidate);
  const dismissSuggestion = useDecisionStore((s) => s.dismissSuggestion);

  // Create form state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DecisionCategory>("architecture");
  const [problem, setProblem] = useState("");
  const [chosenDecision, setChosenDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [evidenceFile, setEvidenceFile] = useState("");
  const [commitShaInput, setCommitShaInput] = useState("");
  const [alternatives, setAlternatives] = useState<DecisionAlternative[]>([]);
  const [altName, setAltName] = useState("");
  const [altPros, setAltPros] = useState("");
  const [altCons, setAltCons] = useState("");
  const [altReject, setAltReject] = useState("");
  const [tradeoffs, setTradeoffs] = useState<DecisionTradeoff[]>([]);
  const [trBenefit, setTrBenefit] = useState("");
  const [trCost, setTrCost] = useState("");
  const [trRisk, setTrRisk] = useState("");

  // Timeline & Search filters
  const [tlOrder, setTlOrder] = useState<"newest" | "oldest">("newest");
  const [tlCategory, setTlCategory] = useState<string>("");
  const [tlStatus, setTlStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);

  // Ask Why state
  const [askQuestion, setAskQuestion] = useState("");
  const [scopeToActiveFile, setScopeToActiveFile] = useState(false);

  // Detail quick-link state
  const [newEvidencePath, setNewEvidencePath] = useState("");
  const [newCommitSha, setNewCommitSha] = useState("");

  if (!workspace) {
    return (
      <div className={styles.workspace} data-testid="decision-workspace-empty">
        <div className={styles.emptyState}>
          <BookMarked size={22} aria-hidden="true" />
          <h3 className={styles.cardTitle}>CodeMind Decision Memory</h3>
          <p className={styles.muted}>
            Open a local project folder to record, search, verify, and trace engineering decisions.
          </p>
        </div>
      </div>
    );
  }

  const root = workspace.rootPath;
  const selectedDecision = decisions.find((d) => d.id === selectedDecisionId) ?? null;
  const staleCount = decisions.filter(
    (d) => d.verificationStatus === "stale" || d.verificationStatus === "partially_stale"
  ).length;
  const acceptedCount = decisions.filter((d) => d.status === "accepted").length;

  const handleOpenEvidenceInEditor = async (filePath: string, line = 1) => {
    await openWorkspaceFile(root, filePath, { line });
    setCenterView("editor");
  };

  const handleAddAlternative = () => {
    if (!altName.trim()) return;
    setAlternatives((prev) => [
      ...prev,
      {
        id: `alt-${prev.length + 1}-${Date.now()}`,
        name: altName.trim(),
        description: "",
        advantages: altPros
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        disadvantages: altCons
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        rejectionReason: altReject.trim(),
        evaluationStatus: altReject.trim() ? "rejected" : "considered"
      }
    ]);
    setAltName("");
    setAltPros("");
    setAltCons("");
    setAltReject("");
  };

  const handleAddTradeoff = () => {
    if (!trBenefit.trim()) return;
    setTradeoffs((prev) => [
      ...prev,
      {
        id: `tr-${prev.length + 1}-${Date.now()}`,
        benefit: trBenefit.trim(),
        cost: trCost.trim(),
        risk: trRisk.trim(),
        acceptedCompromise: "",
        longTermImplications: "",
        reconsiderConditions: ""
      }
    ]);
    setTrBenefit("");
    setTrCost("");
    setTrRisk("");
  };

  const handleCreateSubmit = async (status: "proposed" | "accepted") => {
    if (title.trim().length < 2) return;
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const created = await createDecision({
      workspaceRoot: root,
      title: title.trim(),
      summary: chosenDecision.trim().slice(0, 200) || title.trim(),
      problem: problem.trim(),
      decision: chosenDecision.trim(),
      rationale: rationale.trim(),
      status,
      category,
      source: "manual",
      tags,
      alternatives,
      tradeoffs,
      evidence: evidenceFile.trim()
        ? [
            {
              type: "source_file",
              filePath: evidenceFile.trim(),
              description: `Linked source file for ${title.trim()}`
            }
          ]
        : [],
      commitShas: commitShaInput.trim() ? [commitShaInput.trim()] : []
    });
    if (created) {
      setTitle("");
      setProblem("");
      setChosenDecision("");
      setRationale("");
      setTagsText("");
      setEvidenceFile("");
      setCommitShaInput("");
      setAlternatives([]);
      setTradeoffs([]);
    }
  };

  const displayedDecisions = searchResults ? searchResults.map((r) => r.decision) : decisions;

  return (
    <div className={styles.workspace} data-testid="decision-workspace">
      <div className={styles.headerBar}>
        <div className={styles.row}>
          <BookMarked size={15} aria-hidden="true" />
          <h2>Decision Memory</h2>
          <span className={styles.badge}>{decisions.length} recorded</span>
          {staleCount > 0 && (
            <span className={`${styles.badge} ${styles.badgeWarn}`}>{staleCount} stale</span>
          )}
        </div>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy}
            onClick={() => void verifyAll(root)}
          >
            <RefreshCw size={12} aria-hidden="true" />
            <span>Verify Freshness</span>
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => setCenterView("editor")}
          >
            Back to Editor
          </button>
        </div>
      </div>

      <div className={styles.tabBar} role="tablist" aria-label="Decision Memory sections">
        {WORKSPACE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`${styles.tabBtn} ${activeTab === t.id ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {selectedDecision && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "detail"}
            className={`${styles.tabBtn} ${activeTab === "detail" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("detail")}
          >
            Detail: {selectedDecision.title.slice(0, 24)}
          </button>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert" data-testid="decision-error-banner">
          <span>{error}</span>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={clearError}
            aria-label="Dismiss error"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.content}>
        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <span className={styles.muted}>Total Decisions</span>
                <span className={styles.statValue}>{decisions.length}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.muted}>Accepted</span>
                <span className={styles.statValue}>{acceptedCount}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.muted}>Stale / Needs Review</span>
                <span className={styles.statValue}>{staleCount}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.muted}>Conflicts</span>
                <span className={styles.statValue}>{conflicts.length}</span>
              </div>
            </div>

            {conflicts.length > 0 && (
              <div className={styles.card} data-testid="decision-conflicts-panel">
                <h3 className={styles.cardTitle}>
                  Detected Decision Conflicts ({conflicts.length})
                </h3>
                {conflicts.map((c) => (
                  <div key={c.conflictId} className={styles.row}>
                    <AlertTriangle size={13} aria-hidden="true" />
                    <span className={styles.muted}>{c.description}</span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Recent Decisions</h3>
              {decisions.length === 0 ? (
                <p className={styles.muted}>
                  No engineering decisions recorded yet. Document why your architecture, auth, or
                  dependency choices were made so CodeMind can answer &ldquo;Ask Why&rdquo;
                  accurately.
                </p>
              ) : (
                decisions.slice(0, 6).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={styles.listItem}
                    onClick={() => selectDecision(d.id)}
                  >
                    <div className={styles.cardHeader}>
                      <strong>{d.title}</strong>
                      <div className={styles.row}>
                        <span className={styles.badge}>{d.category}</span>
                        <span className={styles.badge}>{d.status}</span>
                        <span className={styles.badge}>{d.verificationStatus}</span>
                      </div>
                    </div>
                    <p className={styles.muted}>{d.summary || d.rationale}</p>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {/* TIMELINE */}
        {activeTab === "timeline" && (
          <div className={styles.card} data-testid="decision-timeline-panel">
            <div className={styles.row}>
              <select
                aria-label="Timeline sort order"
                className={styles.select}
                value={tlOrder}
                onChange={(e) => {
                  const order = e.target.value as "newest" | "oldest";
                  setTlOrder(order);
                  void loadTimeline(root, {
                    order,
                    category: (tlCategory || undefined) as DecisionCategory | undefined,
                    status: (tlStatus || undefined) as DecisionLifecycleStatus | undefined
                  });
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <select
                aria-label="Timeline category filter"
                className={styles.select}
                value={tlCategory}
                onChange={(e) => {
                  setTlCategory(e.target.value);
                  void loadTimeline(root, {
                    order: tlOrder,
                    category: (e.target.value || undefined) as DecisionCategory | undefined,
                    status: (tlStatus || undefined) as DecisionLifecycleStatus | undefined
                  });
                }}
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                aria-label="Timeline status filter"
                className={styles.select}
                value={tlStatus}
                onChange={(e) => {
                  setTlStatus(e.target.value);
                  void loadTimeline(root, {
                    order: tlOrder,
                    category: (tlCategory || undefined) as DecisionCategory | undefined,
                    status: (e.target.value || undefined) as DecisionLifecycleStatus | undefined
                  });
                }}
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {timeline.length === 0 ? (
              <p className={styles.muted}>No timeline events match the current filters.</p>
            ) : (
              timeline.map((evt) => (
                <button
                  key={evt.eventId}
                  type="button"
                  className={styles.listItem}
                  onClick={() => selectDecision(evt.decisionId)}
                >
                  <div className={styles.cardHeader}>
                    <strong>{evt.decisionTitle}</strong>
                    <div className={styles.row}>
                      <span className={styles.badge}>{evt.eventType}</span>
                      <span className={styles.badge}>{evt.category}</span>
                      <span className={styles.badge}>{evt.verificationStatus}</span>
                      {evt.commitShortSha && (
                        <span className={styles.badge}>{evt.commitShortSha}</span>
                      )}
                    </div>
                  </div>
                  <p className={styles.muted}>
                    {evt.summary} · {evt.evidenceCount} evidence ·{" "}
                    {new Date(evt.timestamp).toLocaleDateString()}
                  </p>
                </button>
              ))
            )}
          </div>
        )}

        {/* ALL DECISIONS & SEARCH */}
        {activeTab === "all" && (
          <div className={styles.card} data-testid="decision-search-panel">
            <div className={styles.row}>
              <input
                type="text"
                aria-label="Search decisions"
                className={styles.input}
                placeholder="Search decisions (e.g., JWT authentication, PostgreSQL)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <label className={styles.row}>
                <input
                  type="checkbox"
                  checked={onlyStale}
                  onChange={(e) => setOnlyStale(e.target.checked)}
                />
                <span className={styles.muted}>Stale only</span>
              </label>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy}
                onClick={() => void search(root, { query: searchQuery, onlyStale })}
              >
                <Search size={12} aria-hidden="true" />
                <span>Search</span>
              </button>
            </div>

            {displayedDecisions.length === 0 ? (
              <p className={styles.muted}>No decisions matched your search.</p>
            ) : (
              displayedDecisions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.listItem}
                  onClick={() => selectDecision(d.id)}
                >
                  <div className={styles.cardHeader}>
                    <strong>{d.title}</strong>
                    <div className={styles.row}>
                      <span className={styles.badge}>{d.category}</span>
                      <span className={styles.badge}>{d.status}</span>
                      <span className={styles.badge}>{d.confidence}</span>
                      <span className={styles.badge}>{d.verificationStatus}</span>
                    </div>
                  </div>
                  <p className={styles.muted}>{d.decision || d.summary}</p>
                </button>
              ))
            )}
          </div>
        )}

        {/* SUGGESTED DECISIONS */}
        {activeTab === "suggestions" && (
          <div className={styles.card} data-testid="decision-suggestions-panel">
            <h3 className={styles.cardTitle}>Suggested Decisions ({suggestions.length})</h3>
            <p className={styles.muted}>
              Suggestions are detected locally from workspace signals and never auto-confirmed.
            </p>
            {suggestions.length === 0 ? (
              <p className={styles.muted}>No pending decision suggestions.</p>
            ) : (
              suggestions.map((sug) => (
                <div key={sug.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <strong>{sug.title}</strong>
                    <span className={styles.badge}>{sug.signalType}</span>
                  </div>
                  <p className={styles.muted}>{sug.reason}</p>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => {
                        setTitle(sug.title);
                        setCategory(sug.category);
                        setProblem(sug.reason);
                        setEvidenceFile(sug.relatedFiles[0] ?? "");
                        setActiveTab("create");
                      }}
                    >
                      Draft Decision
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => void dismissSuggestion(root, sug.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ASK WHY */}
        {activeTab === "ask_why" && (
          <div className={styles.card} data-testid="decision-ask-why-panel">
            <h3 className={styles.cardTitle}>Ask Why — Grounded Decision Q&amp;A</h3>
            <div className={styles.row}>
              <input
                type="text"
                aria-label="Ask why question"
                className={styles.input}
                style={{ flex: 1 }}
                placeholder="e.g., Why does this project use JWT authentication?"
                value={askQuestion}
                onChange={(e) => setAskQuestion(e.target.value)}
              />
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || askQuestion.trim().length < 3}
                onClick={() =>
                  void askWhy(root, askQuestion.trim(), {
                    filePath: scopeToActiveFile ? activeEditorTab?.relativePath : undefined
                  })
                }
              >
                <HelpCircle size={12} aria-hidden="true" />
                <span>Ask Why</span>
              </button>
            </div>
            {activeEditorTab && (
              <label className={styles.row}>
                <input
                  type="checkbox"
                  checked={scopeToActiveFile}
                  onChange={(e) => setScopeToActiveFile(e.target.checked)}
                />
                <span className={styles.muted}>
                  Scope to active file ({activeEditorTab.relativePath})
                </span>
              </label>
            )}

            {askWhyAnswer && (
              <div className={styles.card} data-testid="ask-why-result">
                <div className={styles.row}>
                  <span className={styles.badge}>confidence: {askWhyAnswer.confidence}</span>
                  <span className={styles.badge}>status: {askWhyAnswer.currentStatus}</span>
                  <span className={styles.badge}>
                    verification: {askWhyAnswer.verificationStatus}
                  </span>
                </div>
                {askWhyAnswer.honestNotice && (
                  <p className={styles.muted}>{askWhyAnswer.honestNotice}</p>
                )}
                <p>
                  <strong>Recorded decision:</strong> {askWhyAnswer.recordedDecision}
                </p>
                <p>
                  <strong>Reason:</strong> {askWhyAnswer.reason}
                </p>
                {askWhyAnswer.evidence.length > 0 && (
                  <div className={styles.row}>
                    <strong>Evidence:</strong>
                    {askWhyAnswer.evidence.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={!ev.filePath}
                        onClick={() =>
                          ev.filePath && void handleOpenEvidenceInEditor(ev.filePath, ev.startLine)
                        }
                      >
                        <FileCode2 size={11} aria-hidden="true" />
                        <span>
                          {ev.filePath ?? ev.description}
                          {ev.startLine ? `:${ev.startLine}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* CREATE DECISION FORM */}
        {activeTab === "create" && (
          <div className={styles.card} data-testid="decision-create-form">
            <h3 className={styles.cardTitle}>Create Engineering Decision Record</h3>
            <div className={styles.row}>
              <input
                type="text"
                aria-label="Decision title"
                className={styles.input}
                style={{ flex: 1 }}
                placeholder="Decision title (e.g., Use JWT authentication)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <select
                aria-label="Decision category"
                className={styles.select}
                value={category}
                onChange={(e) => setCategory(e.target.value as DecisionCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              aria-label="Problem and context"
              className={styles.textarea}
              rows={2}
              placeholder="Problem / context..."
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
            />
            <textarea
              aria-label="Chosen approach"
              className={styles.textarea}
              rows={2}
              placeholder="Chosen approach / decision..."
              value={chosenDecision}
              onChange={(e) => setChosenDecision(e.target.value)}
            />
            <textarea
              aria-label="Decision rationale"
              className={styles.textarea}
              rows={2}
              placeholder="Why was this approach chosen?"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <div className={styles.row}>
              <input
                type="text"
                aria-label="Decision tags"
                className={styles.input}
                placeholder="Tags (comma-separated, e.g., jwt, auth)"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
              />
              <input
                type="text"
                aria-label="Evidence file path"
                className={styles.input}
                placeholder="Workspace file path (optional)"
                value={evidenceFile}
                onChange={(e) => setEvidenceFile(e.target.value)}
              />
              <input
                type="text"
                aria-label="Git commit SHA"
                className={styles.input}
                placeholder="Git commit SHA (optional)"
                value={commitShaInput}
                onChange={(e) => setCommitShaInput(e.target.value)}
              />
            </div>

            {/* Alternatives Builder */}
            <div className={styles.card}>
              <strong className={styles.cardTitle}>Alternatives ({alternatives.length})</strong>
              <div className={styles.row}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Alternative name"
                  value={altName}
                  onChange={(e) => setAltName(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Advantages (comma-separated)"
                  value={altPros}
                  onChange={(e) => setAltPros(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Disadvantages (comma-separated)"
                  value={altCons}
                  onChange={(e) => setAltCons(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Rejection reason"
                  value={altReject}
                  onChange={(e) => setAltReject(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleAddAlternative}
                >
                  <Plus size={11} aria-hidden="true" /> Add Alternative
                </button>
              </div>
            </div>

            {/* Tradeoffs Builder */}
            <div className={styles.card}>
              <strong className={styles.cardTitle}>Tradeoffs ({tradeoffs.length})</strong>
              <div className={styles.row}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Benefit"
                  value={trBenefit}
                  onChange={(e) => setTrBenefit(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Cost"
                  value={trCost}
                  onChange={(e) => setTrCost(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Risk"
                  value={trRisk}
                  onChange={(e) => setTrRisk(e.target.value)}
                />
                <button type="button" className={styles.secondaryBtn} onClick={handleAddTradeoff}>
                  <Plus size={11} aria-hidden="true" /> Add Tradeoff
                </button>
              </div>
            </div>

            <div className={styles.row}>
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={busy || title.trim().length < 2}
                onClick={() => void handleCreateSubmit("proposed")}
              >
                Save as Draft (Proposed)
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || title.trim().length < 2}
                onClick={() => void handleCreateSubmit("accepted")}
              >
                <CheckCircle2 size={12} aria-hidden="true" />
                <span>Confirm &amp; Accept Decision</span>
              </button>
            </div>
          </div>
        )}

        {/* DECISION DETAIL VIEW */}
        {activeTab === "detail" && selectedDecision && (
          <div className={styles.card} data-testid="decision-detail-view">
            <div className={styles.cardHeader}>
              <div>
                <h3 className={styles.cardTitle}>{selectedDecision.title}</h3>
                <div className={styles.row}>
                  <span className={styles.badge}>{selectedDecision.category}</span>
                  <span className={styles.badge}>{selectedDecision.status}</span>
                  <span className={styles.badge}>confidence: {selectedDecision.confidence}</span>
                  <span
                    className={`${styles.badge} ${
                      selectedDecision.verificationStatus === "current"
                        ? styles.badgeSuccess
                        : selectedDecision.verificationStatus === "stale" ||
                            selectedDecision.verificationStatus === "partially_stale"
                          ? styles.badgeWarn
                          : ""
                    }`}
                  >
                    {selectedDecision.verificationStatus}
                  </span>
                </div>
              </div>
              <div className={styles.row}>
                {selectedDecision.status === "proposed" && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void transitionStatus(root, selectedDecision.id, "accepted")}
                  >
                    Accept Decision
                  </button>
                )}
                {selectedDecision.status === "accepted" && (
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void transitionStatus(root, selectedDecision.id, "superseded")}
                  >
                    Mark Superseded
                  </button>
                )}
                {(selectedDecision.verificationStatus === "stale" ||
                  selectedDecision.verificationStatus === "partially_stale") && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void revalidate(root, selectedDecision.id)}
                  >
                    Revalidate Evidence
                  </button>
                )}
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => void deleteDecision(root, selectedDecision.id)}
                >
                  <Trash2 size={11} aria-hidden="true" /> Delete
                </button>
              </div>
            </div>

            {selectedDecision.problem && (
              <p className={styles.muted}>
                <strong>Problem:</strong> {selectedDecision.problem}
              </p>
            )}
            {selectedDecision.decision && (
              <p>
                <strong>Chosen Approach:</strong> {selectedDecision.decision}
              </p>
            )}
            {selectedDecision.rationale && (
              <p>
                <strong>Rationale:</strong> {selectedDecision.rationale}
              </p>
            )}

            {/* Alternatives Comparison Table */}
            {selectedDecision.alternatives.length > 0 && (
              <div>
                <h4 className={styles.cardTitle}>Alternatives Comparison</h4>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Option</th>
                      <th>Status</th>
                      <th>Advantages</th>
                      <th>Disadvantages</th>
                      <th>Rejection Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDecision.alternatives.map((alt) => (
                      <tr key={alt.id}>
                        <td>{alt.name}</td>
                        <td>{alt.evaluationStatus}</td>
                        <td>{alt.advantages.join("; ") || "—"}</td>
                        <td>{alt.disadvantages.join("; ") || "—"}</td>
                        <td>{alt.rejectionReason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Evidence List with Monaco Navigation */}
            <div className={styles.card}>
              <h4 className={styles.cardTitle}>
                Linked Evidence ({selectedDecision.evidence.length})
              </h4>
              {selectedDecision.evidence.map((ev) => (
                <div key={ev.id} className={styles.cardHeader}>
                  <div className={styles.row}>
                    <span className={styles.badge}>{ev.type}</span>
                    <span className={styles.badge}>{ev.provenance}</span>
                    <span className={styles.badge}>{ev.verificationStatus}</span>
                    {ev.isHistorical && <span className={styles.badge}>historical</span>}
                    <span className={styles.muted}>
                      {ev.filePath
                        ? `${ev.filePath}${ev.startLine ? `:${ev.startLine}` : ""}`
                        : ev.description}
                    </span>
                    {ev.staleReason && (
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>
                        {ev.staleReason}
                      </span>
                    )}
                  </div>
                  {ev.filePath && (
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => void handleOpenEvidenceInEditor(ev.filePath!, ev.startLine)}
                    >
                      <FileCode2 size={11} aria-hidden="true" /> Open in Editor
                    </button>
                  )}
                </div>
              ))}
              <div className={styles.row}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Link workspace file path..."
                  value={newEvidencePath}
                  onChange={(e) => setNewEvidencePath(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={!newEvidencePath.trim()}
                  onClick={() => {
                    void linkEvidence(root, selectedDecision.id, {
                      type: "source_file",
                      filePath: newEvidencePath.trim(),
                      description: `Linked source file ${newEvidencePath.trim()}`
                    });
                    setNewEvidencePath("");
                  }}
                >
                  Link File
                </button>
              </div>
            </div>

            {/* Git Commit References */}
            <div className={styles.card}>
              <h4 className={styles.cardTitle}>
                Git Commits ({selectedDecision.gitReferences.length})
              </h4>
              {selectedDecision.gitReferences.map((g) => (
                <div key={g.commitSha} className={styles.row}>
                  <GitCommitHorizontal size={12} aria-hidden="true" />
                  <code>{g.shortSha}</code>
                  <span className={styles.muted}>
                    {g.message} ({g.author})
                  </span>
                </div>
              ))}
              <div className={styles.row}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Commit SHA (7-40 hex)..."
                  value={newCommitSha}
                  onChange={(e) => setNewCommitSha(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={newCommitSha.trim().length < 7}
                  onClick={() => {
                    void linkCommit(root, selectedDecision.id, newCommitSha.trim());
                    setNewCommitSha("");
                  }}
                >
                  Link Commit
                </button>
                {gitCommits.length > 0 && (
                  <select
                    aria-label="Recent Git commits"
                    className={styles.select}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        void linkCommit(root, selectedDecision.id, e.target.value);
                      }
                    }}
                  >
                    <option value="">Pick recent commit...</option>
                    {gitCommits.map((c) => (
                      <option key={c.commitSha} value={c.commitSha}>
                        {c.shortSha} — {c.message.slice(0, 48)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
