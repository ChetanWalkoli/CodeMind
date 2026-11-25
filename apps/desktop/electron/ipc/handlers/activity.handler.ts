import path from "node:path";
import { redactSecrets } from "@codemind/ai-core";
import {
  ActivityClearRequestSchema,
  ActivityListRequestSchema,
  AppPreferencesPatchSchema,
  DiagnosticsGetRequestSchema,
  DiagnosticsSnapshotSchema,
  type ActivityEvent,
  type AppPreferences,
  type DiagnosticsSnapshot,
  type IpcResponse
} from "@codemind/shared";
import type { ActivityStore } from "../../activity/activityStore.js";
import type { CredentialStore } from "../../ai/credentialStore.js";
import type { DecisionStore } from "../../decisions/decisionStore.js";
import type { ImpactStore } from "../../impact/impactStore.js";
import type { PreferencesStore } from "../../utils/preferences.js";
import { WorkspaceSecurityError, type WorkspaceAuthority } from "../../workspace/pathSecurity.js";
import type { AppRuntimeMetadata } from "./app.handler.js";
import type { CodeEngineManager } from "./engine.handler.js";

export interface ActivityAndDiagnosticsDeps {
  authority: WorkspaceAuthority;
  activityStore: ActivityStore;
  preferences: PreferencesStore;
  metadata: AppRuntimeMetadata;
  engineManager: CodeEngineManager;
  credentials: CredentialStore;
  decisionStore: DecisionStore;
  impactStore: ImpactStore;
}

function safeError<T>(err: unknown, code: string): IpcResponse<T> {
  if (err instanceof WorkspaceSecurityError) {
    return {
      ok: false,
      error: { code: err.code, message: redactSecrets(err.message) }
    };
  }
  return {
    ok: false,
    error: {
      code,
      message: redactSecrets(err instanceof Error ? err.message : "Operation failed.")
    }
  };
}

export function createActivityAndDiagnosticsHandlers(deps: ActivityAndDiagnosticsDeps) {
  const recentErrorCategories: string[] = [];

  const recordErrorCategory = (category: string) => {
    const clean = redactSecrets(category).slice(0, 120);
    if (!clean) return;
    recentErrorCategories.unshift(clean);
    if (recentErrorCategories.length > 20) {
      recentErrorCategories.length = 20;
    }
  };

  return {
    recordErrorCategory,

    listActivity: async (payload: unknown): Promise<IpcResponse<ActivityEvent[]>> => {
      const parsed = ActivityListRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }
      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        const events = deps.activityStore.list(realRoot, {
          feature: parsed.data.feature,
          query: parsed.data.query,
          limit: parsed.data.limit
        });
        return { ok: true, data: events };
      } catch (err) {
        return safeError(err, "ACTIVITY_LIST_ERROR");
      }
    },

    clearActivity: async (payload: unknown): Promise<IpcResponse<{ cleared: boolean }>> => {
      const parsed = ActivityClearRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }
      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        const cleared = deps.activityStore.clear(realRoot);
        return { ok: true, data: { cleared } };
      } catch (err) {
        return safeError(err, "ACTIVITY_CLEAR_ERROR");
      }
    },

    getAppPreferences: async (): Promise<IpcResponse<AppPreferences>> => {
      try {
        return { ok: true, data: deps.preferences.getAppPreferences() };
      } catch (err) {
        return safeError(err, "PREFERENCES_GET_ERROR");
      }
    },

    updateAppPreferences: async (payload: unknown): Promise<IpcResponse<AppPreferences>> => {
      const parsed = AppPreferencesPatchSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }
      try {
        return { ok: true, data: deps.preferences.updateAppPreferences(parsed.data) };
      } catch (err) {
        return safeError(err, "PREFERENCES_UPDATE_ERROR");
      }
    },

    getDiagnostics: async (payload?: unknown): Promise<IpcResponse<DiagnosticsSnapshot>> => {
      const parsed = DiagnosticsGetRequestSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        let workspaceAuthorized = false;
        let workspaceName: string | null = null;
        let indexedFiles = 0;
        let indexedSymbols = 0;
        let decisionsCount = 0;
        let impactAnalysesCount = 0;
        let activityEventsCount = 0;

        if (parsed.data.workspaceRoot && deps.authority.isAuthorized(parsed.data.workspaceRoot)) {
          const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
          workspaceAuthorized = true;
          workspaceName = path.basename(realRoot);
          const indexer = deps.engineManager.get(realRoot);
          if (indexer) {
            const summary = indexer.getSummary();
            indexedFiles = summary.indexedFiles;
            indexedSymbols = summary.totalSymbols;
          }
          decisionsCount = deps.decisionStore.loadDecisions(realRoot).length;
          impactAnalysesCount = deps.impactStore.loadAll(realRoot).length;
          activityEventsCount = deps.activityStore.count(realRoot);
        }

        const aiSettings = deps.preferences.getAISettings();
        const credStatus = deps.credentials.getStatus(aiSettings.provider);

        let preferencesHealthy = true;
        try {
          deps.preferences.getAppPreferences();
        } catch {
          preferencesHealthy = false;
        }

        const snapshot: DiagnosticsSnapshot = DiagnosticsSnapshotSchema.parse({
          generatedAt: new Date().toISOString(),
          appName: deps.metadata.name,
          appVersion: deps.metadata.version,
          platform: deps.metadata.platform,
          arch: deps.metadata.arch,
          electronVersion: deps.metadata.electronVersion,
          nodeVersion: deps.metadata.nodeVersion,
          chromeVersion: deps.metadata.chromeVersion,
          workspace: {
            authorized: workspaceAuthorized,
            name: workspaceName,
            indexedFiles,
            indexedSymbols
          },
          ai: {
            provider: aiSettings.provider,
            configured: credStatus.hasApiKey,
            model: aiSettings.model,
            credentialCorrupt: credStatus.credentialCorrupt
          },
          persistence: {
            localFirst: true,
            cloudSyncEnabled: false,
            preferencesHealthy,
            decisionsCount,
            impactAnalysesCount,
            activityEventsCount
          },
          security: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            explicitPatchApprovalRequired: true,
            explicitCommandApprovalRequired: true
          },
          recentErrorCategories: [...recentErrorCategories]
        });

        return { ok: true, data: snapshot };
      } catch (err) {
        return safeError(err, "DIAGNOSTICS_GET_ERROR");
      }
    }
  };
}
