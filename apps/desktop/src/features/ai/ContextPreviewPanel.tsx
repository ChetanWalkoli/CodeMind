import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileCode2,
  FolderPlus,
  MessageSquarePlus,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X
} from "lucide-react";
import type {
  AIContextApprovalRecord,
  AIContextSnapshot,
  AITaskType,
  ContextSearchCandidate,
  ConversationMessage,
  ConversationSummary,
  ResolvedMissingFile,
  VerifiedSourceReferenceItem
} from "@codemind/shared";
import { desktopApi } from "../../services/desktopApi";
import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./ContextPreviewPanel.module.scss";

function extractSuggestedPathsFromResponse(content: string): string[] {
  const candidates = new Set<string>();

  // 1. Check structured JSON missingFiles if present
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as { missingFiles?: Array<{ filePath?: string }> };
      if (Array.isArray(parsed.missingFiles)) {
        for (const entry of parsed.missingFiles) {
          if (typeof entry?.filePath === "string" && entry.filePath.trim()) {
            candidates.add(entry.filePath.trim());
          }
        }
      }
    } catch {
      // Ignore non-JSON content
    }
  }

  // 2. Extract backticked file/directory paths from markdown prose
  const backtickRe =
    /`([A-Za-z0-9_./-]+\/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|json|yaml|yml))`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(content)) !== null) {
    const token = (match[1] ?? "").trim();
    if (!token || token.startsWith("http://") || token.startsWith("https://")) continue;
    if (token.startsWith("/api/")) continue;
    candidates.add(token);
  }

  return Array.from(candidates).slice(0, 20);
}

const TASK_OPTIONS: { value: AITaskType; label: string }[] = [
  { value: "code-qa", label: "Codebase Q&A" },
  { value: "explain-codebase", label: "Explain My Codebase" },
  { value: "explain-file", label: "Explain File" },
  { value: "architecture-overview", label: "Architecture Overview" },
  { value: "impact-analysis", label: "Impact Analysis" }
];

export function ContextPreviewPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const [taskType, setTaskType] = useState<AITaskType>("code-qa");
  const [query, setQuery] = useState("");
  const [includeDependencies, setIncludeDependencies] = useState(true);
  const [structuredMode, setStructuredMode] = useState(false);
  const [userExcludedPaths, setUserExcludedPaths] = useState<string[]>([]);
  const [manualAddedPaths, setManualAddedPaths] = useState<string[]>([]);
  const [showAddFiles, setShowAddFiles] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<ContextSearchCandidate[]>([]);
  const [searchingFiles, setSearchingFiles] = useState(false);
  const [missingSuggestions, setMissingSuggestions] = useState<ResolvedMissingFile[]>([]);
  const [selectedMissingPaths, setSelectedMissingPaths] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<AIContextSnapshot | null>(null);
  const [approval, setApproval] = useState<AIContextApprovalRecord | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Streaming state (Milestone 5.6)
  const [streamState, setStreamState] = useState<
    "idle" | "waiting" | "streaming" | "completed" | "failed" | "cancelled"
  >("idle");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streamProgress, setStreamProgress] = useState<string | null>(null);
  const [verifiedRefs, setVerifiedRefs] = useState<VerifiedSourceReferenceItem[]>([]);
  const streamUnsubRef = useRef<(() => void) | null>(null);

  // Conversation state (Milestone 5.7)
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ConversationMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [nextHistoryCursor, setNextHistoryCursor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cleanupStreamSubscription = () => {
    if (streamUnsubRef.current) {
      streamUnsubRef.current();
      streamUnsubRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupStreamSubscription();
    };
  }, []);

  // Reset state and load workspace conversations when workspace changes
  useEffect(() => {
    cleanupStreamSubscription();
    setSnapshot(null);
    setApproval(null);
    setUserExcludedPaths([]);
    setManualAddedPaths([]);
    setShowAddFiles(false);
    setFileSearchQuery("");
    setFileSearchResults([]);
    setMissingSuggestions([]);
    setSelectedMissingPaths([]);
    setExpandedItems({});
    setError(null);
    setStreamState("idle");
    setActiveRequestId(null);
    setStreamText("");
    setStreamProgress(null);
    setVerifiedRefs([]);
    setActiveConversationId(null);
    setHistoryMessages([]);
    setHasMoreHistory(false);
    setNextHistoryCursor(null);
    setConfirmDelete(false);

    if (!workspace) {
      setConversations([]);
      return;
    }

    let mounted = true;
    void desktopApi.listAIConversations({ workspaceRoot: workspace.rootPath }).then((res) => {
      if (!mounted) return;
      if (res.ok) {
        setConversations(res.data);
      }
    });

    return () => {
      mounted = false;
    };
  }, [workspace?.rootPath]);

  const loadConversationPage = async (conversationId: string, cursor?: number) => {
    if (!workspace) return;
    const res = await desktopApi.getAIConversation({
      workspaceRoot: workspace.rootPath,
      conversationId,
      limit: 20,
      cursor
    });
    if (res.ok) {
      setHistoryMessages((prev) =>
        cursor !== undefined ? [...res.data.messages, ...prev] : res.data.messages
      );
      setHasMoreHistory(res.data.hasMore);
      setNextHistoryCursor(res.data.nextCursor);
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    setConfirmDelete(false);
    if (!conversationId) {
      setActiveConversationId(null);
      setHistoryMessages([]);
      setHasMoreHistory(false);
      setNextHistoryCursor(null);
      return;
    }
    setActiveConversationId(conversationId);
    void loadConversationPage(conversationId);
  };

  const handleNewConversation = async () => {
    if (!workspace) return;
    setConfirmDelete(false);
    const res = await desktopApi.createAIConversation({
      workspaceRoot: workspace.rootPath,
      taskType
    });
    if (res.ok) {
      setConversations((prev) => [res.data, ...prev]);
      setActiveConversationId(res.data.id);
      setHistoryMessages([]);
      setHasMoreHistory(false);
      setNextHistoryCursor(null);
    }
  };

  const handleDeleteConversation = async () => {
    if (!workspace || !activeConversationId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await desktopApi.deleteAIConversation({
      workspaceRoot: workspace.rootPath,
      conversationId: activeConversationId
    });
    if (res.ok && res.data.deleted) {
      setConversations((prev) => prev.filter((c) => c.id !== activeConversationId));
      setActiveConversationId(null);
      setHistoryMessages([]);
      setHasMoreHistory(false);
      setNextHistoryCursor(null);
      setConfirmDelete(false);
    }
  };

  const handleStartStream = async () => {
    if (!workspace || !snapshot || !isApproved) return;
    cleanupStreamSubscription();
    setError(null);
    setStreamText("");
    setStreamProgress("Verifying approved snapshot...");
    setVerifiedRefs([]);
    setStreamState("waiting");

    const clientRequestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `req-${Date.now()}`;

    setActiveRequestId(clientRequestId);

    streamUnsubRef.current = desktopApi.onAIStreamEvent(clientRequestId, (evt) => {
      if (evt.type === "stream:start") {
        setStreamState("streaming");
        setStreamProgress(evt.structured ? "Streaming structured output..." : null);
      } else if (evt.type === "stream:progress") {
        setStreamProgress(evt.message);
      } else if (evt.type === "stream:delta") {
        setStreamState("streaming");
        setStreamText((prev) => prev + evt.text);
      } else if (evt.type === "stream:complete") {
        setStreamState("completed");
        setStreamProgress(null);
        setActiveRequestId(null);
        setStreamText(evt.content);
        setVerifiedRefs(evt.verifiedReferences ?? []);
        cleanupStreamSubscription();
        if (activeConversationId) {
          void loadConversationPage(activeConversationId);
        }
        const suggested = extractSuggestedPathsFromResponse(evt.content);
        if (suggested.length > 0 && workspace && snapshot) {
          void desktopApi
            .resolveAIMissingFiles({
              workspaceRoot: workspace.rootPath,
              suggestedPaths: suggested,
              includedFilePaths: snapshot.items.map((item) => item.filePath)
            })
            .then((res) => {
              if (!res.ok) return;
              const actionable = res.data.filter(
                (entry) =>
                  (entry.status === "exact-match" || entry.status === "similar-match") &&
                  entry.resolvedPath !== null
              );
              setMissingSuggestions(actionable);
              setSelectedMissingPaths(
                actionable.map((entry) => entry.resolvedPath).filter((p): p is string => Boolean(p))
              );
            });
        }
      } else if (evt.type === "stream:error") {
        setStreamState("failed");
        setStreamProgress(
          evt.partialContentReceived
            ? "Partial response preserved before stream interruption. Click Retry to try again."
            : null
        );
        setActiveRequestId(null);
        setError(evt.message);
        cleanupStreamSubscription();
      } else if (evt.type === "stream:cancelled") {
        setStreamState("cancelled");
        setStreamProgress(evt.reason);
        setActiveRequestId(null);
        cleanupStreamSubscription();
      }
    });

    const startRes = await desktopApi.startAIStream({
      requestId: clientRequestId,
      workspaceRoot: workspace.rootPath,
      snapshotId: snapshot.snapshotId,
      structured: structuredMode,
      conversationId: activeConversationId ?? undefined
    });

    if (!startRes.ok) {
      cleanupStreamSubscription();
      setStreamState("failed");
      setStreamProgress(null);
      setActiveRequestId(null);
      setError(startRes.error.message);
    }
  };

  const handleCancelStream = async () => {
    if (!activeRequestId) return;
    await desktopApi.cancelAIStream({ requestId: activeRequestId });
  };

  const invalidateLocalSnapshot = () => {
    setApproval(null);
  };

  const buildPreview = async (overrides?: {
    excludedPaths?: string[];
    explicitPaths?: string[];
  }) => {
    if (!workspace) return;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Enter a question or prompt before building a context preview.");
      return;
    }

    const nextExcluded = overrides?.excludedPaths ?? userExcludedPaths;
    const nextExplicit = overrides?.explicitPaths ?? manualAddedPaths;
    setBusy(true);
    setError(null);
    setApproval(null);

    try {
      const res = await desktopApi.buildAIContext({
        workspaceRoot: workspace.rootPath,
        taskType,
        query: trimmedQuery,
        activeFilePath: activeTab?.relativePath,
        explicitFilePaths: nextExplicit.length > 0 ? nextExplicit : undefined,
        excludedFilePaths: nextExcluded,
        includeDependencies
      });

      if (res.ok) {
        setSnapshot(res.data);
        setApproval({
          snapshotId: res.data.snapshotId,
          approved: false,
          approvedAt: null,
          expiresAt: null
        });
      } else {
        setError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBuildSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void buildPreview();
  };

  const handleExcludeFile = (filePath: string) => {
    const nextExcluded = Array.from(new Set([...userExcludedPaths, filePath]));
    const nextExplicit = manualAddedPaths.filter((p) => p !== filePath);
    setUserExcludedPaths(nextExcluded);
    setManualAddedPaths(nextExplicit);
    invalidateLocalSnapshot();
    void buildPreview({ excludedPaths: nextExcluded, explicitPaths: nextExplicit });
  };

  const handleRestoreFile = (filePath: string) => {
    const nextExcluded = userExcludedPaths.filter((p) => p !== filePath);
    setUserExcludedPaths(nextExcluded);
    invalidateLocalSnapshot();
    void buildPreview({ excludedPaths: nextExcluded });
  };

  const handleSearchContextFiles = async (nextQuery: string) => {
    setFileSearchQuery(nextQuery);
    if (!workspace) return;
    setSearchingFiles(true);
    try {
      const res = await desktopApi.searchAIContextFiles({
        workspaceRoot: workspace.rootPath,
        query: nextQuery,
        limit: 15
      });
      if (res.ok) {
        setFileSearchResults(res.data);
      }
    } finally {
      setSearchingFiles(false);
    }
  };

  const handleToggleAddFiles = () => {
    const nextOpen = !showAddFiles;
    setShowAddFiles(nextOpen);
    if (nextOpen && workspace) {
      void handleSearchContextFiles(fileSearchQuery);
    }
  };

  const handleAddManualFile = (filePath: string) => {
    const nextExplicit = Array.from(new Set([...manualAddedPaths, filePath]));
    const nextExcluded = userExcludedPaths.filter((p) => p !== filePath);
    setManualAddedPaths(nextExplicit);
    setUserExcludedPaths(nextExcluded);
    invalidateLocalSnapshot();
    void buildPreview({ explicitPaths: nextExplicit, excludedPaths: nextExcluded });
  };

  const handleToggleMissingPath = (filePath: string) => {
    setSelectedMissingPaths((prev) =>
      prev.includes(filePath) ? prev.filter((p) => p !== filePath) : [...prev, filePath]
    );
  };

  const handleIncludeMissingFiles = () => {
    if (selectedMissingPaths.length === 0) return;
    const nextExplicit = Array.from(new Set([...manualAddedPaths, ...selectedMissingPaths]));
    const nextExcluded = userExcludedPaths.filter((p) => !selectedMissingPaths.includes(p));
    setManualAddedPaths(nextExplicit);
    setUserExcludedPaths(nextExcluded);
    setMissingSuggestions([]);
    setSelectedMissingPaths([]);
    invalidateLocalSnapshot();
    void buildPreview({ explicitPaths: nextExplicit, excludedPaths: nextExcluded });
  };

  const handleToggleApproval = async (approved: boolean) => {
    if (!workspace || !snapshot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await desktopApi.approveAIContext({
        workspaceRoot: workspace.rootPath,
        snapshotId: snapshot.snapshotId,
        approved
      });
      if (res.ok) {
        setApproval(res.data);
      } else {
        setError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!workspace) {
    return (
      <div className={styles.emptyState} data-testid="ai-context-empty">
        <span className={styles.iconBadge} aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <h3 className={styles.heading}>Codebase-Aware Context</h3>
        <p className={styles.description}>
          Open a local project folder to assemble, inspect, and approve source context before any AI
          request.
        </p>
      </div>
    );
  }

  const isApproved = Boolean(
    approval && snapshot && approval.snapshotId === snapshot.snapshotId && approval.approved
  );
  const isStreaming = streamState === "waiting" || streamState === "streaming";

  return (
    <div className={styles.container} data-testid="ai-context-panel">
      <div className={styles.convBar} data-testid="ai-conversation-bar">
        <select
          aria-label="Conversation"
          className={styles.convSelect}
          value={activeConversationId ?? ""}
          onChange={(e) => handleSelectConversation(e.target.value)}
        >
          <option value="">Transient session</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.messageCount})
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void handleNewConversation()}
          title="New conversation"
          aria-label="New conversation"
        >
          <MessageSquarePlus size={13} aria-hidden="true" />
        </button>
        {activeConversationId && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => void handleDeleteConversation()}
            title={confirmDelete ? "Click again to confirm delete" : "Delete conversation"}
            aria-label={confirmDelete ? "Confirm delete conversation" : "Delete conversation"}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {activeConversationId && historyMessages.length > 0 && (
        <div className={styles.historyList} data-testid="ai-conversation-history">
          {hasMoreHistory && nextHistoryCursor !== null && (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void loadConversationPage(activeConversationId, nextHistoryCursor)}
            >
              Load Older Messages
            </button>
          )}
          {historyMessages.map((msg) => (
            <div key={msg.id} className={styles.historyMsg}>
              <div className={styles.historyRole}>
                {msg.role}
                {msg.model ? ` · ${msg.model}` : ""}
              </div>
              <div>{msg.content}</div>
              {msg.references.length > 0 && (
                <div className={styles.refList}>
                  {msg.references.map((r, i) => (
                    <span key={`${r.filePath}-${i}`} className={styles.refBadge}>
                      {r.filePath}
                      {r.startLine ? `:${r.startLine}-${r.endLine ?? r.startLine}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <form className={styles.form} onSubmit={handleBuildSubmit}>
        <div className={styles.fieldRow}>
          <label htmlFor="codemind-ai-task" className={styles.label}>
            Task Template
          </label>
          <select
            id="codemind-ai-task"
            aria-label="AI Task Template"
            className={styles.select}
            value={taskType}
            onChange={(e) => {
              setTaskType(e.target.value as AITaskType);
              setSnapshot(null);
              invalidateLocalSnapshot();
            }}
          >
            {TASK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <textarea
          className={styles.textarea}
          rows={3}
          placeholder="Ask about this codebase (e.g., How does authentication work?)"
          aria-label="Context query"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (snapshot) {
              setSnapshot(null);
              invalidateLocalSnapshot();
            }
          }}
        />

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={includeDependencies}
            onChange={(e) => {
              setIncludeDependencies(e.target.checked);
              if (snapshot) {
                setSnapshot(null);
                invalidateLocalSnapshot();
              }
            }}
          />
          <span>Include direct dependencies &amp; dependents</span>
        </label>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={structuredMode}
            onChange={(e) => setStructuredMode(e.target.checked)}
          />
          <span>Structured JSON validation mode</span>
        </label>

        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={busy || query.trim().length === 0}
        >
          <Eye size={13} aria-hidden="true" />
          <span>{busy ? "Building..." : "Build Context Preview"}</span>
        </button>

        <p className={styles.safetyNote}>
          Local preview only — never sends code to Google Gemini until you explicitly approve this
          exact snapshot.
        </p>
      </form>

      {error && (
        <div className={styles.errorBox} role="alert" data-testid="ai-context-error">
          {error}
        </div>
      )}

      {snapshot && (
        <div className={styles.previewSection} data-testid="ai-context-snapshot">
          <div className={styles.metaCard} data-testid="ai-budget-summary">
            <div className={styles.metaRow}>
              <span>Snapshot</span>
              <code data-testid="ai-snapshot-id">{snapshot.snapshotId.slice(0, 12)}</code>
            </div>
            <div className={styles.metaRow}>
              <span>Template</span>
              <span>
                {snapshot.templateId}@{snapshot.templateVersion}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span>Payload</span>
              <span>
                {snapshot.items.length} files · {(snapshot.totalBytes / 1024).toFixed(1)} KB /{" "}
                {(snapshot.budgetBytes / 1024).toFixed(0)} KB
              </span>
            </div>
            {snapshot.coverage && (
              <div className={styles.metaRow}>
                <span>Coverage</span>
                <span data-testid="ai-coverage-summary">
                  {snapshot.coverage.includedFiles}/{snapshot.coverage.totalCandidates} candidates ·{" "}
                  {snapshot.coverage.queryIntent}
                  {snapshot.coverage.truncatedFiles > 0
                    ? ` · ${snapshot.coverage.truncatedFiles} sliced`
                    : ""}
                </span>
              </div>
            )}
            {snapshot.budget && (
              <>
                <div className={styles.metaRow}>
                  <span>Model Window</span>
                  <span data-testid="ai-budget-model">
                    {snapshot.budget.modelId} ·{" "}
                    {snapshot.budget.contextWindowTokens.toLocaleString()} tokens
                  </span>
                </div>
                <div className={styles.metaRow}>
                  <span>Input Budget</span>
                  <span data-testid="ai-budget-input">
                    ~{snapshot.budget.totalEstimatedInputTokens.toLocaleString()} /{" "}
                    {snapshot.budget.maxInputTokens.toLocaleString()} tokens (
                    {snapshot.budget.estimatorId},{" "}
                    {snapshot.budget.isExactEstimate ? "exact" : "estimated"})
                  </span>
                </div>
                <div className={styles.metaRow}>
                  <span>Reserved / Margin</span>
                  <span data-testid="ai-budget-reservations">
                    {snapshot.budget.reservedOutputTokens.toLocaleString()} output ·{" "}
                    {snapshot.budget.safetyMarginTokens.toLocaleString()} safety margin
                  </span>
                </div>
              </>
            )}
          </div>

          <div className={styles.approvalBar}>
            <div
              className={`${styles.approvalStatus} ${isApproved ? styles.approvedBadge : ""}`}
              data-testid="ai-approval-status"
            >
              {isApproved ? (
                <>
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>Approved for Snapshot {snapshot.snapshotId.slice(0, 8)}</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={14} aria-hidden="true" />
                  <span>Not Approved (Local Preview Only)</span>
                </>
              )}
            </div>

            {isApproved ? (
              <>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void handleStartStream()}
                  disabled={busy || isStreaming}
                >
                  <Play size={12} aria-hidden="true" />
                  <span>Send Approved Context</span>
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void handleToggleApproval(false)}
                  disabled={busy || isStreaming}
                >
                  Revoke Approval
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.approveBtn}
                onClick={() => void handleToggleApproval(true)}
                disabled={busy || snapshot.items.length === 0}
              >
                <CheckCircle2 size={13} aria-hidden="true" />
                <span>Approve Context Snapshot</span>
              </button>
            )}
          </div>

          {streamState !== "idle" && (
            <div className={styles.streamSection} data-testid="ai-stream-panel">
              <div className={styles.streamHeader}>
                <span data-testid="ai-stream-status">Status: {streamState}</span>
                {isStreaming && (
                  <button
                    type="button"
                    className={styles.stopBtn}
                    onClick={() => void handleCancelStream()}
                  >
                    <Square size={11} aria-hidden="true" />
                    <span>Stop Generation</span>
                  </button>
                )}
                {streamState === "failed" && isApproved && (
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void handleStartStream()}
                  >
                    <RotateCcw size={11} aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
              {streamProgress && <div className={styles.mutedText}>{streamProgress}</div>}
              {streamText && (
                <pre className={styles.streamOutput} data-testid="ai-stream-output">
                  {streamText}
                </pre>
              )}
              {verifiedRefs.length > 0 && (
                <div className={styles.refList} data-testid="ai-verified-refs">
                  {verifiedRefs.map((ref, idx) => (
                    <span key={`${ref.filePath}-${idx}`} className={styles.refBadge}>
                      ✓ {ref.filePath}
                      {ref.startLine ? `:${ref.startLine}-${ref.endLine ?? ref.startLine}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {missingSuggestions.length > 0 && (
            <div className={styles.missingCard} data-testid="ai-missing-context-card">
              <div className={styles.missingTitle}>
                Missing Context Detected ({missingSuggestions.length})
              </div>
              <p className={styles.mutedText}>
                Verified workspace files mentioned in the response. Selecting files rebuilds the
                snapshot and requires fresh approval.
              </p>
              <ul className={styles.missingList}>
                {missingSuggestions.map((entry) => {
                  const filePath = entry.resolvedPath ?? entry.requestedPath;
                  const checked = selectedMissingPaths.includes(filePath);
                  return (
                    <li key={filePath}>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleMissingPath(filePath)}
                        />
                        <span>{filePath}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.missingActions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleIncludeMissingFiles}
                  disabled={busy || selectedMissingPaths.length === 0}
                >
                  <Plus size={12} aria-hidden="true" />
                  <span>Include Selected Files</span>
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    setMissingSuggestions([]);
                    setSelectedMissingPaths([]);
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className={styles.listHeaderRow}>
            <div className={styles.listHeader}>Included Files ({snapshot.items.length})</div>
            <button
              type="button"
              className={styles.compactBtn}
              onClick={handleToggleAddFiles}
              disabled={busy}
              data-testid="ai-add-files-toggle"
            >
              <FolderPlus size={11} aria-hidden="true" />
              <span>{showAddFiles ? "Close Picker" : "Add Files"}</span>
            </button>
          </div>

          {showAddFiles && (
            <div className={styles.addFilesBox} data-testid="ai-add-files-picker">
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search indexed files (e.g. quizService, routes, api.js)"
                aria-label="Search files to add to context"
                value={fileSearchQuery}
                onChange={(e) => void handleSearchContextFiles(e.target.value)}
              />
              {searchingFiles ? (
                <p className={styles.mutedText}>Searching workspace...</p>
              ) : fileSearchResults.length === 0 ? (
                <p className={styles.mutedText}>No matching indexed files.</p>
              ) : (
                <ul className={styles.pickerList}>
                  {fileSearchResults.map((candidate) => {
                    const alreadyIncluded = snapshot.items.some(
                      (item) => item.filePath === candidate.filePath
                    );
                    return (
                      <li key={candidate.filePath} className={styles.pickerRow}>
                        <div className={styles.pickerInfo}>
                          <span className={styles.pickerPath}>{candidate.filePath}</span>
                          <span className={styles.pickerMeta}>
                            {candidate.role} · {candidate.language}
                          </span>
                        </div>
                        {candidate.blockedReason ? (
                          <span className={styles.blockedTag} title={candidate.blockedReason}>
                            Blocked
                          </span>
                        ) : alreadyIncluded ? (
                          <span className={styles.pickerMeta}>Included</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.compactBtn}
                            onClick={() => handleAddManualFile(candidate.filePath)}
                            disabled={busy}
                            aria-label={`Add ${candidate.filePath}`}
                          >
                            <Plus size={10} aria-hidden="true" />
                            <span>Add</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {snapshot.items.length === 0 ? (
            <p className={styles.mutedText}>
              No matching non-secret files found for this query in the indexed workspace.
            </p>
          ) : (
            <ul className={styles.itemList}>
              {snapshot.items.map((item) => {
                const expanded = Boolean(expandedItems[item.id]);
                return (
                  <li key={item.id} className={styles.itemCard} data-testid="ai-context-item">
                    <div className={styles.itemHeader}>
                      <button
                        type="button"
                        className={styles.itemTitleBtn}
                        onClick={() => toggleExpand(item.id)}
                        aria-expanded={expanded}
                      >
                        <FileCode2 size={12} aria-hidden="true" />
                        <span className={styles.itemPath}>{item.filePath}</span>
                        <span className={styles.itemRange}>
                          L{item.startLine}-{item.endLine}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.excludeBtn}
                        onClick={() => handleExcludeFile(item.filePath)}
                        aria-label={`Exclude ${item.filePath}`}
                        title="Exclude file from context"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </div>
                    <div className={styles.itemMeta}>
                      <span>{item.reasons.join(", ")}</span>
                      <span>
                        score {item.relevanceScore}
                        {item.truncated ? " · truncated" : ""}
                      </span>
                    </div>
                    {expanded && <pre className={styles.codePreview}>{item.content}</pre>}
                  </li>
                );
              })}
            </ul>
          )}

          {snapshot.excluded.length > 0 && (
            <>
              <div className={styles.listHeader}>
                Excluded / Blocked ({snapshot.excluded.length})
              </div>
              <ul className={styles.excludedList} data-testid="ai-excluded-list">
                {snapshot.excluded.map((ex) => (
                  <li key={`${ex.filePath}-${ex.reason}`} className={styles.excludedItem}>
                    <span className={styles.excludedPath}>{ex.filePath}</span>
                    <span className={styles.excludedReason}>{ex.reason}</span>
                    {ex.reason === "user-excluded" && (
                      <button
                        type="button"
                        className={styles.restoreBtn}
                        onClick={() => handleRestoreFile(ex.filePath)}
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
