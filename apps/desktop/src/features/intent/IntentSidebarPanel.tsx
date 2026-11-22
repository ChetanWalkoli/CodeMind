import { useEffect, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { useIntentStore } from "../../stores/intent.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./IntentMode.module.scss";

export function IntentSidebarPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);

  const sessions = useIntentStore((s) => s.sessions);
  const activeSession = useIntentStore((s) => s.activeSession);
  const busy = useIntentStore((s) => s.busy);
  const loadSessions = useIntentStore((s) => s.loadSessions);
  const createIntent = useIntentStore((s) => s.createIntent);
  const selectSession = useIntentStore((s) => s.selectSession);
  const deleteIntent = useIntentStore((s) => s.deleteIntent);
  const resetForWorkspace = useIntentStore((s) => s.resetForWorkspace);

  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!workspace) {
      resetForWorkspace();
      return;
    }
    void loadSessions(workspace.rootPath);
  }, [workspace?.rootPath, loadSessions, resetForWorkspace]);

  if (!workspace) {
    return (
      <div className={styles.emptyState} data-testid="intent-sidebar-empty">
        <Sparkles size={18} aria-hidden="true" />
        <p className={styles.muted}>Open a project folder to use Intent Mode.</p>
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const ok = await createIntent(workspace.rootPath, trimmed);
    if (ok) {
      setPrompt("");
      setCenterView("intent");
    }
  };

  return (
    <div className={styles.sidebarContainer} data-testid="intent-sidebar">
      <form className={styles.form} onSubmit={(e) => void handleCreate(e)}>
        <label htmlFor="intent-prompt-input" className={styles.sectionTitle}>
          New Engineering Intent
        </label>
        <textarea
          id="intent-prompt-input"
          aria-label="Engineering intent prompt"
          className={styles.textarea}
          rows={3}
          placeholder="e.g., Fix the login error when a user enters an incorrect password."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={busy || prompt.trim().length < 3}
        >
          <Sparkles size={12} aria-hidden="true" />
          <span>{busy ? "Working..." : "Start Intent"}</span>
        </button>
      </form>

      <div className={styles.sectionTitle}>Intent Sessions ({sessions.length})</div>

      {sessions.length === 0 ? (
        <p className={styles.muted}>
          No intent sessions yet. Enter an engineering goal above to investigate, review diffs, and
          safely apply verified changes.
        </p>
      ) : (
        <ul className={styles.sessionList} data-testid="intent-session-list">
          {sessions.map((item) => {
            const isActive = activeSession?.intent.intentId === item.intentId;
            return (
              <li
                key={item.intentId}
                className={`${styles.sessionItem} ${isActive ? styles.sessionItemActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.sessionBtn}
                  onClick={() => {
                    void selectSession(workspace.rootPath, item.intentId);
                    setCenterView("intent");
                  }}
                >
                  <span className={styles.sessionGoal}>{item.normalizedGoal}</span>
                  <div className={styles.sessionMeta}>
                    <span className={styles.badge}>{item.intentType}</span>
                    <span className={styles.badge}>{item.status}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  aria-label={`Delete intent ${item.intentId}`}
                  title="Delete intent session"
                  onClick={() => void deleteIntent(workspace.rootPath, item.intentId)}
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
