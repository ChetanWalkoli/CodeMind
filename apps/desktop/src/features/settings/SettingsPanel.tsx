import { useEffect, useState } from "react";
import { DEFAULT_IGNORE_DIRS } from "@codemind/config";
import type {
  AIConfigStatus,
  AIUsageSummary,
  AppPreferences,
  DiagnosticsSnapshot
} from "@codemind/shared";
import { desktopApi } from "../../services/desktopApi";
import { useEditorStore } from "../../stores/editor.store";
import { useThemeStore } from "../../stores/theme.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./SettingsPanel.module.scss";

export function SettingsPanel() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const settings = useEditorStore((s) => s.settings);
  const toggleMinimap = useEditorStore((s) => s.toggleMinimap);
  const toggleWordWrap = useEditorStore((s) => s.toggleWordWrap);
  const setTabSize = useEditorStore((s) => s.setTabSize);

  const appInfo = useWorkspaceStore((s) => s.appInfo);
  const platformInfo = useWorkspaceStore((s) => s.platformInfo);
  const isElectron = useWorkspaceStore((s) => s.isElectron);
  const workspaceRoot = useWorkspaceStore((s) => s.workspace?.rootPath ?? null);
  const customExcludes = useWorkspaceStore((s) => s.customExcludes);
  const setCustomExcludes = useWorkspaceStore((s) => s.setCustomExcludes);

  const [newPattern, setNewPattern] = useState("");
  const [aiConfig, setAiConfig] = useState<AIConfigStatus | null>(null);
  const [aiUsage, setAiUsage] = useState<AIUsageSummary | null>(null);
  const [appPrefs, setAppPrefs] = useState<AppPreferences | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{
    tone: "success" | "error" | "info";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void desktopApi.getAIConfig().then((res) => {
      if (!active) return;
      if (res.ok) {
        setAiConfig(res.data);
      } else {
        setAiFeedback({ tone: "error", message: res.error.message });
      }
    });
    void desktopApi.getAIUsageSummary().then((res) => {
      if (!active) return;
      if (res.ok) {
        setAiUsage(res.data);
      }
    });
    void desktopApi.getAppPreferences().then((res) => {
      if (!active) return;
      if (res.ok) {
        setAppPrefs(res.data);
      }
    });
    void desktopApi.getDiagnostics(workspaceRoot ? { workspaceRoot } : {}).then((res) => {
      if (!active) return;
      if (res.ok) {
        setDiagnostics(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [workspaceRoot]);

  const handleSaveApiKey = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = apiKeyInput.trim();
    if (!candidate || aiBusy) return;

    setAiBusy(true);
    setAiFeedback(null);
    setApiKeyInput("");

    try {
      const res = await desktopApi.setAIApiKey({
        provider: aiConfig?.provider ?? "gemini",
        apiKey: candidate
      });
      if (res.ok) {
        setAiConfig(res.data);
        setAiFeedback({
          tone: "success",
          message: "API key encrypted and saved using OS secure storage."
        });
      } else {
        setAiFeedback({ tone: "error", message: res.error.message });
      }
    } finally {
      setAiBusy(false);
    }
  };

  const handleValidateApiKey = async () => {
    if (aiBusy || !aiConfig?.hasApiKey) return;
    setAiBusy(true);
    setAiFeedback({ tone: "info", message: "Validating API key..." });
    try {
      const res = await desktopApi.validateAIApiKey({ provider: aiConfig.provider });
      if (res.ok) {
        setAiFeedback({
          tone: res.data.valid ? "success" : "error",
          message: res.data.message
        });
      } else {
        setAiFeedback({ tone: "error", message: res.error.message });
      }
    } finally {
      setAiBusy(false);
    }
  };

  const handleClearApiKey = async () => {
    const canClear = Boolean(
      aiConfig?.hasApiKey || aiConfig?.credentialCorrupt || aiConfig?.maskedKeyHint
    );
    if (aiBusy || !aiConfig || !canClear) return;
    setAiBusy(true);
    setAiFeedback(null);
    setApiKeyInput("");
    try {
      const res = await desktopApi.clearAIApiKey({ provider: aiConfig.provider });
      if (res.ok) {
        setAiConfig(res.data);
        setAiFeedback({ tone: "info", message: "Stored API key removed." });
      } else {
        setAiFeedback({ tone: "error", message: res.error.message });
      }
    } finally {
      setAiBusy(false);
    }
  };

  const handleModelChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!aiConfig || aiBusy) return;
    const nextModel = event.target.value;
    setAiBusy(true);
    setAiFeedback(null);
    try {
      const res = await desktopApi.setAIModel({
        provider: aiConfig.provider,
        model: nextModel
      });
      if (res.ok) {
        setAiConfig(res.data);
        setAiFeedback({ tone: "success", message: `Default model set to ${res.data.model}.` });
      } else {
        setAiFeedback({ tone: "error", message: res.error.message });
      }
    } finally {
      setAiBusy(false);
    }
  };

  const handleAddExclude = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newPattern.trim();
    if (!trimmed) return;
    void setCustomExcludes([...customExcludes, trimmed]);
    setNewPattern("");
  };

  const handleRemoveExclude = (pattern: string) => {
    void setCustomExcludes(customExcludes.filter((p) => p !== pattern));
  };

  return (
    <div className={styles.panel} data-testid="settings-panel">
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Appearance</h3>
        <div className={styles.row}>
          <span>Theme</span>
          <div className={styles.segmented} role="group" aria-label="Color theme">
            <button
              type="button"
              className={`${styles.segBtn} ${theme === "dark" ? styles.segBtnActive : ""}`}
              onClick={() => void setTheme("dark")}
              aria-pressed={theme === "dark"}
            >
              Dark
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${theme === "light" ? styles.segBtnActive : ""}`}
              onClick={() => void setTheme("light")}
              aria-pressed={theme === "light"}
            >
              Light
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Editor</h3>
        <div className={styles.row}>
          <span>Indentation</span>
          <div className={styles.segmented} role="group" aria-label="Tab size">
            <button
              type="button"
              className={`${styles.segBtn} ${settings.tabSize === 2 ? styles.segBtnActive : ""}`}
              onClick={() => setTabSize(2)}
              aria-pressed={settings.tabSize === 2}
            >
              2 Spaces
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.tabSize === 4 ? styles.segBtnActive : ""}`}
              onClick={() => setTabSize(4)}
              aria-pressed={settings.tabSize === 4}
            >
              4 Spaces
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <span>Minimap</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.minimap ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (!settings.minimap) toggleMinimap();
              }}
            >
              On
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${!settings.minimap ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (settings.minimap) toggleMinimap();
              }}
            >
              Off
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <span>Word Wrap</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.wordWrap === "on" ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (settings.wordWrap !== "on") toggleWordWrap();
              }}
            >
              On
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.wordWrap === "off" ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (settings.wordWrap !== "off") toggleWordWrap();
              }}
            >
              Off
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Workspace Exclusions</h3>
        <form className={styles.excludeForm} onSubmit={handleAddExclude}>
          <input
            type="text"
            className={styles.excludeInput}
            placeholder="e.g. *.log or tmp/"
            aria-label="Add exclusion pattern"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
          />
          <button type="submit" className={styles.addBtn}>
            Add
          </button>
        </form>

        {customExcludes.length > 0 && (
          <div className={styles.tagList} aria-label="Custom exclusion patterns">
            {customExcludes.map((pattern) => (
              <span key={pattern} className={styles.tag}>
                <span>{pattern}</span>
                <button
                  type="button"
                  className={styles.removeTagBtn}
                  onClick={() => handleRemoveExclude(pattern)}
                  aria-label={`Remove ${pattern}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className={styles.metaList}>
          <span>Default ignored: {DEFAULT_IGNORE_DIRS.slice(0, 6).join(", ")}...</span>
          <span>Secret files (.env, *.pem, *.key) are excluded from indexing.</span>
        </div>
      </div>

      <div className={styles.section} data-testid="ai-settings-section">
        <h3 className={styles.sectionTitle}>Google Gemini</h3>

        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span>Provider</span>
            <span>Google Gemini</span>
          </div>
          <div className={styles.metaItem}>
            <span>API Key</span>
            <span
              className={`${styles.aiStatusBadge} ${
                aiConfig?.hasApiKey ? styles.aiStatusConfigured : ""
              }`}
              data-testid="ai-key-status"
            >
              {aiConfig?.hasApiKey
                ? `Configured (${aiConfig.maskedKeyHint ?? "****"})`
                : "Not configured"}
            </span>
          </div>
          {(() => {
            const activeModel = aiConfig?.availableModels.find((m) => m.id === aiConfig.model);
            if (!activeModel?.contextWindowTokens) return null;
            return (
              <div className={styles.metaItem}>
                <span>Model Limits</span>
                <span>
                  {activeModel.contextWindowTokens.toLocaleString()} in /{" "}
                  {(activeModel.maxOutputTokens ?? 65_536).toLocaleString()} out
                  {activeModel.freeTierAvailable ? " · Free tier eligible" : ""}
                </span>
              </div>
            );
          })()}
        </div>

        {aiConfig && (!aiConfig.encryptionAvailable || aiConfig.statusError) && (
          <div
            className={`${styles.aiNotice} ${styles.aiNoticeError}`}
            role="alert"
            data-testid="ai-encryption-warning"
          >
            {aiConfig.statusError ??
              "OS-backed credential encryption is unavailable in this environment. Plaintext API key storage is disabled."}
          </div>
        )}

        <div className={styles.row}>
          <label htmlFor="codemind-ai-model">Model</label>
          <select
            id="codemind-ai-model"
            aria-label="AI Model"
            className={styles.select}
            value={aiConfig?.model ?? "gemini-3.8-flash"}
            onChange={(e) => void handleModelChange(e)}
            disabled={aiBusy || !aiConfig}
          >
            {(
              aiConfig?.availableModels ?? [
                { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash" }
              ]
            ).map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.id})
              </option>
            ))}
          </select>
        </div>

        <form className={styles.excludeForm} onSubmit={(e) => void handleSaveApiKey(e)}>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={styles.excludeInput}
            placeholder={
              aiConfig?.credentialCorrupt
                ? "Reset corrupted credentials first..."
                : aiConfig?.hasApiKey
                  ? "Enter new key to replace..."
                  : "Enter Gemini API key (AIza...)"
            }
            aria-label="Gemini API key"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            disabled={aiBusy || !aiConfig?.encryptionAvailable || aiConfig?.credentialCorrupt}
          />
          <button
            type="submit"
            className={styles.addBtn}
            disabled={
              aiBusy ||
              !aiConfig?.encryptionAvailable ||
              aiConfig?.credentialCorrupt ||
              apiKeyInput.trim().length === 0
            }
          >
            {aiConfig?.hasApiKey ? "Replace Key" : "Save Key"}
          </button>
        </form>

        <div className={styles.aiActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void handleValidateApiKey()}
            disabled={aiBusy || !aiConfig?.hasApiKey}
          >
            Validate Key
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => void handleClearApiKey()}
            disabled={
              aiBusy ||
              !(aiConfig?.hasApiKey || aiConfig?.credentialCorrupt || aiConfig?.maskedKeyHint)
            }
          >
            {aiConfig?.credentialCorrupt ? "Reset Credentials" : "Remove Key"}
          </button>
        </div>

        <div className={styles.aiNotice} data-testid="gemini-free-tier-notice">
          Free-tier notice: Requests sent via Google AI Studio&apos;s free tier may be used by
          Google to improve products. Use a paid Google AI tier for proprietary code.
        </div>

        {aiFeedback && (
          <div
            className={`${styles.aiNotice} ${
              aiFeedback.tone === "error"
                ? styles.aiNoticeError
                : aiFeedback.tone === "success"
                  ? styles.aiNoticeSuccess
                  : ""
            }`}
            role="status"
            data-testid="ai-settings-feedback"
          >
            {aiFeedback.message}
          </div>
        )}
      </div>

      {aiUsage && (
        <div className={styles.section} data-testid="ai-usage-section">
          <h3 className={styles.sectionTitle}>AI Usage (Local)</h3>
          <div className={styles.metaList}>
            <div className={styles.metaItem}>
              <span>Requests</span>
              <span data-testid="ai-usage-requests">
                {aiUsage.totalRequests} total ({aiUsage.succeededRequests} ok ·{" "}
                {aiUsage.failedRequests} failed · {aiUsage.cancelledRequests} cancelled)
              </span>
            </div>
            <div className={styles.metaItem}>
              <span>Provider Tokens</span>
              <span>
                {aiUsage.providerReportedInputTokens.toLocaleString()} in /{" "}
                {aiUsage.providerReportedOutputTokens.toLocaleString()} out
              </span>
            </div>
            {aiUsage.estimatedInputTokens > 0 && (
              <div className={styles.metaItem}>
                <span>Estimated Input</span>
                <span>~{aiUsage.estimatedInputTokens.toLocaleString()} tokens (estimated)</span>
              </div>
            )}
            <div className={styles.metaItem}>
              <span>Avg Duration</span>
              <span>{aiUsage.averageDurationMs} ms</span>
            </div>
            {aiUsage.estimatedCostUsd !== null && (
              <div className={styles.metaItem}>
                <span>Est. Cost</span>
                <span>${aiUsage.estimatedCostUsd.toFixed(4)} (estimated)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {appPrefs && (
        <div className={styles.section} data-testid="settings-app-preferences">
          <h3 className={styles.sectionTitle}>Application Preferences</h3>
          <div className={styles.metaList}>
            <div className={styles.metaItem}>
              <span>Reopen Last Workspace</span>
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={async () => {
                  const res = await desktopApi.updateAppPreferences({
                    reopenLastWorkspace: !appPrefs.reopenLastWorkspace
                  });
                  if (res.ok) setAppPrefs(res.data);
                }}
              >
                {appPrefs.reopenLastWorkspace ? "On" : "Off"}
              </button>
            </div>
            <div className={styles.metaItem}>
              <span>Editor Font Size</span>
              <select
                value={appPrefs.editorFontSize}
                aria-label="Editor font size"
                onChange={async (e) => {
                  const res = await desktopApi.updateAppPreferences({
                    editorFontSize: Number(e.target.value)
                  });
                  if (res.ok) setAppPrefs(res.data);
                }}
              >
                {[11, 12, 13, 14, 15, 16, 18].map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}px
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className={styles.section} data-testid="settings-security-section">
        <h3 className={styles.sectionTitle}>Security &amp; Privacy</h3>
        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span>Storage Mode</span>
            <span>Local-First (Cloud Sync Off)</span>
          </div>
          <div className={styles.metaItem}>
            <span>Patch Approval</span>
            <span>Explicit Approval Required</span>
          </div>
          <div className={styles.metaItem}>
            <span>Command Execution</span>
            <span>Explicit Approval Required</span>
          </div>
          <div className={styles.metaItem}>
            <span>Context Isolation</span>
            <span>Enabled (Sandbox On)</span>
          </div>
        </div>
      </div>

      <div className={styles.section} data-testid="settings-diagnostics-section">
        <h3 className={styles.sectionTitle}>Runtime &amp; Diagnostics</h3>
        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span>Mode</span>
            <span>{isElectron ? "Electron Desktop" : "Browser Preview"}</span>
          </div>
          <div className={styles.metaItem}>
            <span>Version</span>
            <span>{appInfo?.version ?? "0.1.0"}</span>
          </div>
          <div className={styles.metaItem}>
            <span>Platform</span>
            <span>{platformInfo ? `${platformInfo.platform} (${platformInfo.arch})` : "web"}</span>
          </div>
          {diagnostics && (
            <>
              <div className={styles.metaItem}>
                <span>Electron / Node</span>
                <span>
                  {diagnostics.electronVersion} / {diagnostics.nodeVersion}
                </span>
              </div>
              <div className={styles.metaItem}>
                <span>Indexed Scope</span>
                <span>
                  {diagnostics.workspace.indexedFiles} files ·{" "}
                  {diagnostics.workspace.indexedSymbols} symbols
                </span>
              </div>
              <div className={styles.metaItem}>
                <span>Local Stores</span>
                <span>
                  {diagnostics.persistence.decisionsCount} decisions ·{" "}
                  {diagnostics.persistence.impactAnalysesCount} impacts ·{" "}
                  {diagnostics.persistence.activityEventsCount} activity
                </span>
              </div>
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => {
                  const redactedJson = JSON.stringify(diagnostics, null, 2);
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(redactedJson);
                  }
                  setDiagCopied(true);
                }}
              >
                {diagCopied ? "Copied Redacted Diagnostics" : "Copy Redacted Diagnostics JSON"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
