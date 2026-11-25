import { useEffect } from "react";
import type { ActivityEvent, ActivityFeature } from "@codemind/shared";
import {
  navigateToDecisionRecord,
  navigateToEvidence,
  navigateToImpactRecord,
  navigateToIntentRecord
} from "../../services/evidenceNavigation";
import { useActivityStore } from "../../stores/activity.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./Activity.module.scss";

export function ActivitySidebarPanel() {
  const workspaceRoot = useWorkspaceStore((s) => s.workspace?.rootPath ?? null);
  const { featureFilter, setFeatureFilter, loadActivity, events } = useActivityStore();

  useEffect(() => {
    if (workspaceRoot) {
      void loadActivity(workspaceRoot);
    }
  }, [workspaceRoot, featureFilter, loadActivity]);

  if (!workspaceRoot) {
    return (
      <div className={styles.sidebar}>
        <p className={styles.muted}>Open a workspace to view engineering activity history.</p>
      </div>
    );
  }

  return (
    <div className={styles.sidebar} data-testid="activity-sidebar-panel">
      <p className={styles.muted}>
        Chronological, workspace-isolated history across Understand, Improve, Remember, and Predict.
      </p>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className={styles.meta}>Filter by Pillar</span>
        <select
          className={styles.select}
          value={featureFilter}
          onChange={(e) => setFeatureFilter(e.target.value as "all" | ActivityFeature)}
          aria-label="Filter activity by feature"
        >
          <option value="all">All Features</option>
          <option value="workspace">Workspace</option>
          <option value="understand">Understand</option>
          <option value="improve">Improve (Intent)</option>
          <option value="remember">Remember (Decisions)</option>
          <option value="predict">Predict (Impact)</option>
        </select>
      </label>
      <span className={styles.meta}>{events.length} event(s) loaded</span>
    </div>
  );
}

export function ActivityWorkspace() {
  const workspaceRoot = useWorkspaceStore((s) => s.workspace?.rootPath ?? null);
  const {
    events,
    featureFilter,
    searchQuery,
    isLoading,
    error,
    setFeatureFilter,
    setSearchQuery,
    loadActivity,
    clearActivity
  } = useActivityStore();

  useEffect(() => {
    if (workspaceRoot) {
      void loadActivity(workspaceRoot);
    }
  }, [workspaceRoot, featureFilter, loadActivity]);

  if (!workspaceRoot) {
    return (
      <div className={styles.container} data-testid="activity-workspace-empty">
        <div className={styles.header}>
          <h2 className={styles.title}>Activity &amp; Engineering History</h2>
        </div>
        <div className={styles.feed}>
          <p className={styles.muted}>Open a workspace folder to browse engineering activity.</p>
        </div>
      </div>
    );
  }

  const handleOpenRecord = (ev: ActivityEvent) => {
    if (!ev.relatedRecordId) return;
    if (ev.feature === "remember") {
      void navigateToDecisionRecord(workspaceRoot, ev.relatedRecordId);
    } else if (ev.feature === "predict") {
      void navigateToImpactRecord(workspaceRoot, ev.relatedRecordId);
    } else if (ev.feature === "improve") {
      void navigateToIntentRecord(workspaceRoot, ev.relatedRecordId);
    }
  };

  return (
    <div className={styles.container} data-testid="activity-workspace">
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Activity &amp; Engineering History</h2>
          <span className={styles.meta}>
            Authoritative records live in their respective pillars; activity is a local audit feed.
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void loadActivity(workspaceRoot)}
          >
            Refresh
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void clearActivity(workspaceRoot)}
          >
            Clear History
          </button>
        </div>
      </div>

      <div className={styles.controls}>
        <input
          type="search"
          className={styles.input}
          placeholder="Search activity summary or file..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadActivity(workspaceRoot);
          }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          className={styles.select}
          value={featureFilter}
          onChange={(e) => setFeatureFilter(e.target.value as "all" | ActivityFeature)}
        >
          <option value="all">All Features</option>
          <option value="workspace">Workspace</option>
          <option value="understand">Understand</option>
          <option value="improve">Improve</option>
          <option value="remember">Remember</option>
          <option value="predict">Predict</option>
        </select>
        <button
          type="button"
          className={styles.btn}
          onClick={() => void loadActivity(workspaceRoot)}
        >
          Search
        </button>
      </div>

      <div className={styles.feed}>
        {error && <p className={styles.muted}>{error}</p>}
        {isLoading ? (
          <p className={styles.muted}>Loading workspace activity...</p>
        ) : events.length === 0 ? (
          <p className={styles.muted}>
            No activity events match the current filter. Open files, index the workspace, create
            decisions, or run Change Impact analyses to build your local history.
          </p>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.badge}>
                  {ev.feature} · {ev.eventType.replace(/_/g, " ")}
                </span>
                <span className={styles.meta}>{new Date(ev.timestamp).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 13 }}>{ev.summary}</div>
              <div className={styles.fileLinks}>
                {ev.relatedRecordId && (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => handleOpenRecord(ev)}
                  >
                    Open Record ({ev.relatedRecordId})
                  </button>
                )}
                {ev.relatedFiles.map((fp) => (
                  <button
                    key={fp}
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => void navigateToEvidence({ workspaceRoot, filePath: fp })}
                  >
                    {fp}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
