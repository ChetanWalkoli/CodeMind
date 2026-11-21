import {
  ThemePreferenceSchema,
  WorkspaceSessionSchema,
  type AIClearKeyRequest,
  type AIConfigStatus,
  type AIContextApprovalRecord,
  type AIContextApprovalRequest,
  type AIContextBuildRequest,
  type AIContextGetApprovalRequest,
  type AIContextSnapshot,
  type AIConversationCreateRequest,
  type AIConversationDeleteRequest,
  type AIConversationGetRequest,
  type AIConversationListRequest,
  type AIConversationRenameRequest,
  type AIExecuteApprovedRequest,
  type AIExecuteApprovedResult,
  type AIStreamCancelRequest,
  type AIStreamCancelResponse,
  type AIStreamIpcEvent,
  type AIStreamStartRequest,
  type AIStreamStartResponse,
  type AISetKeyRequest,
  type AISetModelRequest,
  type AIUsageSummary,
  type AIValidateKeyRequest,
  type AIValidateKeyResult,
  type AppInfo,
  type ArchitectureOverview,
  type CodeMindDesktopAPI,
  type ConversationPage,
  type ConversationSummary,
  type DependencyGraphSnapshot,
  type EngineFileIntelRequest,
  type EngineGraphRequest,
  type EngineIndexRequest,
  type EngineSearchSymbolsRequest,
  type FileIntelligence,
  type FileReadRequest,
  type FileReadResult,
  type FileSearchMatch,
  type FileStatRequest,
  type FileStatResult,
  type FileTreeNode,
  type FileWriteRequest,
  type FileWriteResult,
  type GitStatus,
  type GitStatusRequest,
  type HealthCheckResponse,
  type IndexSummary,
  type IpcResponse,
  type PlatformInfo,
  type SymbolSearchResult,
  type ThemePreference,
  type WorkspaceInfo,
  type WorkspaceOpenRequest,
  type WorkspaceSearchRequest,
  type WorkspaceSession,
  type WorkspaceTreeRequest
} from "@codemind/shared";

const BROWSER_THEME_STORAGE_KEY = "codemind.theme.preference";
const BROWSER_SESSION_STORAGE_KEY = "codemind.workspace.session";

function getBridge(): CodeMindDesktopAPI | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.codemindDesktop;
}

export function isElectronEnvironment(): boolean {
  return Boolean(getBridge());
}

function readBrowserTheme(): ThemePreference {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return "dark";
    }
    const raw = window.localStorage.getItem(BROWSER_THEME_STORAGE_KEY);
    const parsed = ThemePreferenceSchema.safeParse(raw);
    return parsed.success ? parsed.data : "dark";
  } catch {
    return "dark";
  }
}

function writeBrowserTheme(theme: ThemePreference): ThemePreference {
  const validated = ThemePreferenceSchema.parse(theme);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(BROWSER_THEME_STORAGE_KEY, validated);
    }
  } catch {
    // Ignore storage quota or restricted storage errors in browser preview.
  }
  return validated;
}

function readBrowserSession(): WorkspaceSession {
  const fallback: WorkspaceSession = {
    lastWorkspacePath: null,
    openTabPaths: [],
    activeTabPath: null,
    customExcludes: []
  };
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return fallback;
    }
    const raw = window.localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = WorkspaceSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function writeBrowserSession(session: WorkspaceSession): WorkspaceSession {
  const validated = WorkspaceSessionSchema.parse(session);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(BROWSER_SESSION_STORAGE_KEY, JSON.stringify(validated));
    }
  } catch {
    // Ignore storage errors in browser preview.
  }
  return validated;
}

async function safeInvoke<T>(
  operation: () => Promise<IpcResponse<T>>,
  fallbackErrorCode: string
): Promise<IpcResponse<T>> {
  try {
    return await operation();
  } catch (err) {
    return {
      ok: false,
      error: {
        code: fallbackErrorCode,
        message: err instanceof Error ? err.message : "Desktop bridge invocation failed."
      }
    };
  }
}

export const desktopApi = {
  isElectron(): boolean {
    return isElectronEnvironment();
  },

  async getAppInfo(): Promise<IpcResponse<AppInfo>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.getAppInfo(), "BRIDGE_APP_INFO_FAILED");
    }

    return {
      ok: true,
      data: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "browser"
      }
    };
  },

  async getPlatformInfo(): Promise<IpcResponse<PlatformInfo>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.getPlatformInfo(), "BRIDGE_PLATFORM_INFO_FAILED");
    }

    return {
      ok: true,
      data: {
        platform: "browser",
        arch: "web",
        electronVersion: "n/a",
        nodeVersion: "n/a",
        chromeVersion: typeof navigator !== "undefined" ? navigator.userAgent : "unknown"
      }
    };
  },

  async healthCheck(): Promise<IpcResponse<HealthCheckResponse>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.healthCheck(), "BRIDGE_HEALTH_CHECK_FAILED");
    }

    return {
      ok: true,
      data: {
        status: "ready",
        timestamp: new Date().toISOString()
      }
    };
  },

  async getTheme(): Promise<IpcResponse<ThemePreference>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.getTheme(), "BRIDGE_THEME_GET_FAILED");
    }

    return {
      ok: true,
      data: readBrowserTheme()
    };
  },

  async setTheme(theme: ThemePreference): Promise<IpcResponse<ThemePreference>> {
    const validated = ThemePreferenceSchema.safeParse(theme);
    if (!validated.success) {
      return {
        ok: false,
        error: {
          code: "INVALID_THEME",
          message: "Theme must be 'dark' or 'light'."
        }
      };
    }

    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(
        () => bridge.setTheme({ theme: validated.data }),
        "BRIDGE_THEME_SET_FAILED"
      );
    }

    return {
      ok: true,
      data: writeBrowserTheme(validated.data)
    };
  },

  async selectWorkspaceFolder(): Promise<IpcResponse<WorkspaceInfo | null>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Opening a local project folder requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.selectWorkspaceFolder(), "BRIDGE_WORKSPACE_SELECT_FAILED");
  },

  async openWorkspace(request: WorkspaceOpenRequest): Promise<IpcResponse<WorkspaceInfo>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Opening a local workspace requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.openWorkspace(request), "BRIDGE_WORKSPACE_OPEN_FAILED");
  },

  async getWorkspaceSession(): Promise<IpcResponse<WorkspaceSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: readBrowserSession() };
    }
    return safeInvoke(() => bridge.getWorkspaceSession(), "BRIDGE_WORKSPACE_SESSION_GET_FAILED");
  },

  async saveWorkspaceSession(session: WorkspaceSession): Promise<IpcResponse<WorkspaceSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: writeBrowserSession(session) };
    }
    return safeInvoke(
      () => bridge.saveWorkspaceSession(session),
      "BRIDGE_WORKSPACE_SESSION_SAVE_FAILED"
    );
  },

  async getWorkspaceTree(request: WorkspaceTreeRequest): Promise<IpcResponse<FileTreeNode[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(() => bridge.getWorkspaceTree(request), "BRIDGE_WORKSPACE_TREE_FAILED");
  },

  async searchWorkspaceFiles(
    request: WorkspaceSearchRequest
  ): Promise<IpcResponse<FileSearchMatch[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(() => bridge.searchWorkspaceFiles(request), "BRIDGE_WORKSPACE_SEARCH_FAILED");
  },

  async getGitStatus(request: GitStatusRequest): Promise<IpcResponse<GitStatus>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: { isGitRepo: false, branch: null, isDirty: false, modifiedCount: 0 }
      };
    }
    return safeInvoke(() => bridge.getGitStatus(request), "BRIDGE_GIT_STATUS_FAILED");
  },

  async indexWorkspace(request: EngineIndexRequest): Promise<IpcResponse<IndexSummary>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          workspaceRoot: request.workspaceRoot,
          totalFiles: 0,
          indexedFiles: 0,
          totalSymbols: 0,
          totalEdges: 0,
          diagnosticCount: 0,
          durationMs: 0,
          indexedAt: new Date().toISOString()
        }
      };
    }
    return safeInvoke(() => bridge.indexWorkspace(request), "BRIDGE_ENGINE_INDEX_FAILED");
  },

  async searchSymbols(
    request: EngineSearchSymbolsRequest
  ): Promise<IpcResponse<SymbolSearchResult[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(() => bridge.searchSymbols(request), "BRIDGE_ENGINE_SEARCH_SYMBOLS_FAILED");
  },

  async getDependencyGraph(
    request: EngineGraphRequest
  ): Promise<IpcResponse<DependencyGraphSnapshot>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: { nodes: [], edges: [] } };
    }
    return safeInvoke(() => bridge.getDependencyGraph(request), "BRIDGE_ENGINE_GRAPH_FAILED");
  },

  async getFileIntelligence(
    request: EngineFileIntelRequest
  ): Promise<IpcResponse<FileIntelligence>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          filePath: request.relativePath,
          symbols: [],
          imports: [],
          exports: [],
          dependencies: [],
          dependents: [],
          diagnostics: []
        }
      };
    }
    return safeInvoke(() => bridge.getFileIntelligence(request), "BRIDGE_ENGINE_FILE_INTEL_FAILED");
  },

  async getArchitectureOverview(
    request: EngineGraphRequest
  ): Promise<IpcResponse<ArchitectureOverview>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          workspaceRoot: request.workspaceRoot,
          totalFiles: 0,
          totalSymbols: 0,
          totalInternalEdges: 0,
          unresolvedImportCount: 0,
          diagnosticCount: 0,
          languages: [],
          modules: [],
          externalPackages: [],
          indexedAt: new Date().toISOString()
        }
      };
    }
    return safeInvoke(
      () => bridge.getArchitectureOverview(request),
      "BRIDGE_ENGINE_OVERVIEW_FAILED"
    );
  },

  async readFile(request: FileReadRequest): Promise<IpcResponse<FileReadResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Reading local files requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.readFile(request), "BRIDGE_FILE_READ_FAILED");
  },

  async writeFile(request: FileWriteRequest): Promise<IpcResponse<FileWriteResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Saving local files requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.writeFile(request), "BRIDGE_FILE_WRITE_FAILED");
  },

  async statFile(request: FileStatRequest): Promise<IpcResponse<FileStatResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: { exists: false } };
    }
    return safeInvoke(() => bridge.statFile(request), "BRIDGE_FILE_STAT_FAILED");
  },

  async getAIConfig(): Promise<IpcResponse<AIConfigStatus>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          provider: "gemini",
          model: "gemini-3.8-flash",
          availableModels: [
            {
              id: "gemini-3.8-flash",
              displayName: "Gemini 3.8 Flash",
              contextWindowTokens: 1_048_576,
              maxOutputTokens: 65_536,
              freeTierAvailable: true,
              lifecycleStatus: "active"
            },
            {
              id: "gemini-3.6-flash",
              displayName: "Gemini 3.6 Flash",
              contextWindowTokens: 1_048_576,
              maxOutputTokens: 65_536,
              freeTierAvailable: true,
              lifecycleStatus: "active"
            },
            {
              id: "gemini-3.1-flash-lite",
              displayName: "Gemini 3.1 Flash-Lite",
              contextWindowTokens: 1_048_576,
              maxOutputTokens: 65_536,
              freeTierAvailable: true,
              lifecycleStatus: "active"
            }
          ],
          hasApiKey: false,
          maskedKeyHint: null,
          encryptionAvailable: false,
          credentialCorrupt: false,
          statusError: null
        }
      };
    }
    return safeInvoke(() => bridge.getAIConfig(), "BRIDGE_AI_CONFIG_GET_FAILED");
  },

  async setAIApiKey(request: AISetKeyRequest): Promise<IpcResponse<AIConfigStatus>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Secure API key storage requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.setAIApiKey(request), "BRIDGE_AI_KEY_SET_FAILED");
  },

  async clearAIApiKey(request?: AIClearKeyRequest): Promise<IpcResponse<AIConfigStatus>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Managing stored API keys requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.clearAIApiKey(request), "BRIDGE_AI_KEY_CLEAR_FAILED");
  },

  async setAIModel(request: AISetModelRequest): Promise<IpcResponse<AIConfigStatus>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Updating AI model settings requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.setAIModel(request), "BRIDGE_AI_MODEL_SET_FAILED");
  },

  async validateAIApiKey(
    request?: AIValidateKeyRequest
  ): Promise<IpcResponse<AIValidateKeyResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Validating API keys requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.validateAIApiKey(request), "BRIDGE_AI_KEY_VALIDATE_FAILED");
  },

  async buildAIContext(request: AIContextBuildRequest): Promise<IpcResponse<AIContextSnapshot>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Building local codebase context requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.buildAIContext(request), "BRIDGE_AI_CONTEXT_BUILD_FAILED");
  },

  async approveAIContext(
    request: AIContextApprovalRequest
  ): Promise<IpcResponse<AIContextApprovalRecord>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Approving codebase context requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.approveAIContext(request), "BRIDGE_AI_CONTEXT_APPROVE_FAILED");
  },

  async getAIContextApproval(
    request: AIContextGetApprovalRequest
  ): Promise<IpcResponse<AIContextApprovalRecord>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          snapshotId: request.snapshotId,
          approved: false,
          approvedAt: null,
          expiresAt: null
        }
      };
    }
    return safeInvoke(
      () => bridge.getAIContextApproval(request),
      "BRIDGE_AI_CONTEXT_APPROVAL_GET_FAILED"
    );
  },

  async executeApprovedAIContext(
    request: AIExecuteApprovedRequest
  ): Promise<IpcResponse<AIExecuteApprovedResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Transmitting approved AI context requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(
      () => bridge.executeApprovedAIContext(request),
      "BRIDGE_AI_EXECUTE_APPROVED_FAILED"
    );
  },

  async startAIStream(request: AIStreamStartRequest): Promise<IpcResponse<AIStreamStartResponse>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Streaming AI responses requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.startAIStream(request), "BRIDGE_AI_STREAM_START_FAILED");
  },

  async cancelAIStream(
    request: AIStreamCancelRequest
  ): Promise<IpcResponse<AIStreamCancelResponse>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: { requestId: request.requestId, cancelled: false } };
    }
    return safeInvoke(() => bridge.cancelAIStream(request), "BRIDGE_AI_STREAM_CANCEL_FAILED");
  },

  onAIStreamEvent(requestId: string, listener: (event: AIStreamIpcEvent) => void): () => void {
    const bridge = getBridge();
    if (!bridge) {
      return () => undefined;
    }
    return bridge.onAIStreamEvent(requestId, listener);
  },

  async createAIConversation(
    request: AIConversationCreateRequest
  ): Promise<IpcResponse<ConversationSummary>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Managing conversations requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(
      () => bridge.createAIConversation(request),
      "BRIDGE_AI_CONVERSATION_CREATE_FAILED"
    );
  },

  async listAIConversations(
    request: AIConversationListRequest
  ): Promise<IpcResponse<ConversationSummary[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(
      () => bridge.listAIConversations(request),
      "BRIDGE_AI_CONVERSATION_LIST_FAILED"
    );
  },

  async getAIConversation(
    request: AIConversationGetRequest
  ): Promise<IpcResponse<ConversationPage>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Loading conversation history requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.getAIConversation(request), "BRIDGE_AI_CONVERSATION_GET_FAILED");
  },

  async renameAIConversation(
    request: AIConversationRenameRequest
  ): Promise<IpcResponse<ConversationSummary>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Renaming conversations requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(
      () => bridge.renameAIConversation(request),
      "BRIDGE_AI_CONVERSATION_RENAME_FAILED"
    );
  },

  async deleteAIConversation(
    request: AIConversationDeleteRequest
  ): Promise<IpcResponse<{ deleted: boolean }>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Deleting conversations requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(
      () => bridge.deleteAIConversation(request),
      "BRIDGE_AI_CONVERSATION_DELETE_FAILED"
    );
  },

  async getAIUsageSummary(): Promise<IpcResponse<AIUsageSummary>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          totalRequests: 0,
          succeededRequests: 0,
          failedRequests: 0,
          cancelledRequests: 0,
          providerReportedInputTokens: 0,
          providerReportedOutputTokens: 0,
          estimatedInputTokens: 0,
          averageDurationMs: 0,
          estimatedCostUsd: null,
          recentRequests: []
        }
      };
    }
    return safeInvoke(() => bridge.getAIUsageSummary(), "BRIDGE_AI_USAGE_GET_FAILED");
  }
};
