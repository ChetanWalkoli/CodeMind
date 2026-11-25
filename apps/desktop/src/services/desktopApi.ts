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
  type AIResolveMissingFilesRequest,
  type AISearchContextFilesRequest,
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
  type ContextSearchCandidate,
  type ConversationPage,
  type ConversationSummary,
  type AskWhyAnswer,
  type DecisionAskWhyRequest,
  type DecisionConflict,
  type DecisionCreateFromIntentRequest,
  type DecisionCreateRequest,
  type DecisionDismissSuggestionRequest,
  type DecisionGetRequest,
  type DecisionGitReference,
  type DecisionLinkCommitRequest,
  type DecisionLinkEvidenceRequest,
  type DecisionListGitCommitsRequest,
  type DecisionRevalidateRequest,
  type DecisionSearchRequest,
  type DecisionSearchResult,
  type DecisionSuggestion,
  type DecisionTimelineEntry,
  type DecisionTimelineRequest,
  type DecisionTransitionStatusRequest,
  type DecisionUpdateRequest,
  type DecisionWorkspaceRequest,
  type DependencyGraphSnapshot,
  type EngineeringDecision,
  type ResolvedMissingFile,
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
  type IntentAnalyzeRequest,
  type IntentApplyPatchTxRequest,
  type IntentApprovePatchTxRequest,
  type IntentCancelVerificationRequest,
  type IntentCheckRollbackRequest,
  type IntentClarifyRequest,
  type IntentCreateRequest,
  type IntentDecideRecommendationRequest,
  type IntentDiscoverVerificationRequest,
  type IntentExecuteRollbackRequest,
  type IntentGeneratePatchRequest,
  type IntentGetRequest,
  type IntentInvestigateRequest,
  type IntentListRequest,
  type ActivityClearRequest,
  type ActivityEvent,
  type ActivityListRequest,
  type AppPreferences,
  type AppPreferencesPatch,
  type DiagnosticsGetRequest,
  type DiagnosticsSnapshot,
  type ImpactAnalysisRequest,
  type ImpactAnalysisResult,
  type ImpactAnalysisSummary,
  type ImpactAnalyzeGitDiffRequest,
  type ImpactGetRequest,
  type ImpactListRequest,
  type ImpactUpdateValidationRequest,
  type IntentRecommendRequest,
  type IntentReviewPatchRequest,
  type IntentRunVerificationRequest,
  type IntentSession,
  type IntentSessionSummary,
  type PatchApprovalRecord,
  type PatchTransactionRecord,
  type RollbackCheckResult,
  type RollbackRecord,
  type VerificationCandidateCommand,
  type VerificationRunRecord,
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

  async searchAIContextFiles(
    request: AISearchContextFilesRequest
  ): Promise<IpcResponse<ContextSearchCandidate[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(
      () => bridge.searchAIContextFiles(request),
      "BRIDGE_AI_CONTEXT_SEARCH_FAILED"
    );
  },

  async resolveAIMissingFiles(
    request: AIResolveMissingFilesRequest
  ): Promise<IpcResponse<ResolvedMissingFile[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(
      () => bridge.resolveAIMissingFiles(request),
      "BRIDGE_AI_MISSING_FILES_RESOLVE_FAILED"
    );
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
  },

  async createIntent(request: IntentCreateRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Intent Mode requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.createIntent(request), "BRIDGE_INTENT_CREATE_FAILED");
  },

  async listIntents(request: IntentListRequest): Promise<IpcResponse<IntentSessionSummary[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.listIntents(request), "BRIDGE_INTENT_LIST_FAILED");
  },

  async getIntent(request: IntentGetRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.getIntent(request), "BRIDGE_INTENT_GET_FAILED");
  },

  async clarifyIntent(request: IntentClarifyRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.clarifyIntent(request), "BRIDGE_INTENT_CLARIFY_FAILED");
  },

  async cancelIntent(request: IntentGetRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.cancelIntent(request), "BRIDGE_INTENT_CANCEL_FAILED");
  },

  async deleteIntent(request: IntentGetRequest): Promise<IpcResponse<{ deleted: boolean }>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.deleteIntent(request), "BRIDGE_INTENT_DELETE_FAILED");
  },

  async investigateIntent(request: IntentInvestigateRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.investigateIntent(request), "BRIDGE_INTENT_INVESTIGATE_FAILED");
  },

  async analyzeIntent(request: IntentAnalyzeRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.analyzeIntent(request), "BRIDGE_INTENT_ANALYZE_FAILED");
  },

  async recommendIntent(request: IntentRecommendRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.recommendIntent(request), "BRIDGE_INTENT_RECOMMEND_FAILED");
  },

  async decideRecommendation(
    request: IntentDecideRecommendationRequest
  ): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.decideRecommendation(request),
      "BRIDGE_INTENT_DECIDE_RECOMMENDATION_FAILED"
    );
  },

  async generateIntentPatch(
    request: IntentGeneratePatchRequest
  ): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.generateIntentPatch(request),
      "BRIDGE_INTENT_GENERATE_PATCH_FAILED"
    );
  },

  async reviewIntentPatch(request: IntentReviewPatchRequest): Promise<IpcResponse<IntentSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.reviewIntentPatch(request), "BRIDGE_INTENT_REVIEW_PATCH_FAILED");
  },

  async approvePatchTransaction(
    request: IntentApprovePatchTxRequest
  ): Promise<IpcResponse<PatchApprovalRecord>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.approvePatchTransaction(request),
      "BRIDGE_INTENT_APPROVE_PATCH_TX_FAILED"
    );
  },

  async applyPatchTransaction(
    request: IntentApplyPatchTxRequest
  ): Promise<IpcResponse<PatchTransactionRecord>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.applyPatchTransaction(request),
      "BRIDGE_INTENT_APPLY_PATCH_TX_FAILED"
    );
  },

  async discoverVerificationCommands(
    request: IntentDiscoverVerificationRequest
  ): Promise<IpcResponse<VerificationCandidateCommand[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(
      () => bridge.discoverVerificationCommands(request),
      "BRIDGE_INTENT_DISCOVER_VERIFICATION_FAILED"
    );
  },

  async runVerificationCommand(
    request: IntentRunVerificationRequest
  ): Promise<IpcResponse<VerificationRunRecord>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.runVerificationCommand(request),
      "BRIDGE_INTENT_RUN_VERIFICATION_FAILED"
    );
  },

  async cancelVerificationCommand(
    request: IntentCancelVerificationRequest
  ): Promise<IpcResponse<{ cancelled: boolean }>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: { cancelled: false } };
    return safeInvoke(
      () => bridge.cancelVerificationCommand(request),
      "BRIDGE_INTENT_CANCEL_VERIFICATION_FAILED"
    );
  },

  async checkTransactionRollback(
    request: IntentCheckRollbackRequest
  ): Promise<IpcResponse<RollbackCheckResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.checkTransactionRollback(request),
      "BRIDGE_INTENT_CHECK_ROLLBACK_FAILED"
    );
  },

  async executeTransactionRollback(
    request: IntentExecuteRollbackRequest
  ): Promise<IpcResponse<RollbackRecord>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Intent Mode requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.executeTransactionRollback(request),
      "BRIDGE_INTENT_EXECUTE_ROLLBACK_FAILED"
    );
  },

  async createDecision(request: DecisionCreateRequest): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.createDecision(request), "BRIDGE_DECISION_CREATE_FAILED");
  },

  async updateDecision(request: DecisionUpdateRequest): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.updateDecision(request), "BRIDGE_DECISION_UPDATE_FAILED");
  },

  async listDecisions(
    request: DecisionWorkspaceRequest
  ): Promise<IpcResponse<EngineeringDecision[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.listDecisions(request), "BRIDGE_DECISION_LIST_FAILED");
  },

  async getDecision(request: DecisionGetRequest): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.getDecision(request), "BRIDGE_DECISION_GET_FAILED");
  },

  async deleteDecision(request: DecisionGetRequest): Promise<IpcResponse<{ deleted: boolean }>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.deleteDecision(request), "BRIDGE_DECISION_DELETE_FAILED");
  },

  async transitionDecisionStatus(
    request: DecisionTransitionStatusRequest
  ): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.transitionDecisionStatus(request),
      "BRIDGE_DECISION_TRANSITION_FAILED"
    );
  },

  async createDecisionFromIntent(
    request: DecisionCreateFromIntentRequest
  ): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.createDecisionFromIntent(request),
      "BRIDGE_DECISION_FROM_INTENT_FAILED"
    );
  },

  async suggestDecisions(
    request: DecisionWorkspaceRequest
  ): Promise<IpcResponse<DecisionSuggestion[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.suggestDecisions(request), "BRIDGE_DECISION_SUGGEST_FAILED");
  },

  async dismissDecisionSuggestion(
    request: DecisionDismissSuggestionRequest
  ): Promise<IpcResponse<{ dismissed: boolean }>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: { dismissed: true } };
    return safeInvoke(
      () => bridge.dismissDecisionSuggestion(request),
      "BRIDGE_DECISION_DISMISS_SUGGESTION_FAILED"
    );
  },

  async linkDecisionEvidence(
    request: DecisionLinkEvidenceRequest
  ): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.linkDecisionEvidence(request),
      "BRIDGE_DECISION_LINK_EVIDENCE_FAILED"
    );
  },

  async linkDecisionCommit(
    request: DecisionLinkCommitRequest
  ): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.linkDecisionCommit(request),
      "BRIDGE_DECISION_LINK_COMMIT_FAILED"
    );
  },

  async listDecisionGitCommits(
    request: DecisionListGitCommitsRequest
  ): Promise<IpcResponse<DecisionGitReference[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(
      () => bridge.listDecisionGitCommits(request),
      "BRIDGE_DECISION_LIST_COMMITS_FAILED"
    );
  },

  async getDecisionTimeline(
    request: DecisionTimelineRequest
  ): Promise<IpcResponse<DecisionTimelineEntry[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.getDecisionTimeline(request), "BRIDGE_DECISION_TIMELINE_FAILED");
  },

  async searchDecisions(
    request: DecisionSearchRequest
  ): Promise<IpcResponse<DecisionSearchResult[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.searchDecisions(request), "BRIDGE_DECISION_SEARCH_FAILED");
  },

  async askWhyDecision(request: DecisionAskWhyRequest): Promise<IpcResponse<AskWhyAnswer>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(() => bridge.askWhyDecision(request), "BRIDGE_DECISION_ASK_WHY_FAILED");
  },

  async verifyAllDecisions(
    request: DecisionWorkspaceRequest
  ): Promise<IpcResponse<EngineeringDecision[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.verifyAllDecisions(request), "BRIDGE_DECISION_VERIFY_FAILED");
  },

  async revalidateDecision(
    request: DecisionRevalidateRequest
  ): Promise<IpcResponse<EngineeringDecision>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Decision Memory requires the desktop app." }
      };
    }
    return safeInvoke(
      () => bridge.revalidateDecision(request),
      "BRIDGE_DECISION_REVALIDATE_FAILED"
    );
  },

  async detectDecisionConflicts(
    request: DecisionWorkspaceRequest
  ): Promise<IpcResponse<DecisionConflict[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(
      () => bridge.detectDecisionConflicts(request),
      "BRIDGE_DECISION_CONFLICTS_FAILED"
    );
  },

  async analyzeChangeImpact(
    request: ImpactAnalysisRequest
  ): Promise<IpcResponse<ImpactAnalysisResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Change Impact analysis requires the desktop app."
        }
      };
    }
    return safeInvoke(() => bridge.analyzeChangeImpact(request), "BRIDGE_IMPACT_ANALYZE_FAILED");
  },

  async analyzeGitDiffImpact(
    request: ImpactAnalyzeGitDiffRequest
  ): Promise<IpcResponse<ImpactAnalysisResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Change Impact analysis requires the desktop app."
        }
      };
    }
    return safeInvoke(() => bridge.analyzeGitDiffImpact(request), "BRIDGE_IMPACT_GIT_DIFF_FAILED");
  },

  async getImpactAnalysis(request: ImpactGetRequest): Promise<IpcResponse<ImpactAnalysisResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Change Impact analysis requires the desktop app."
        }
      };
    }
    return safeInvoke(() => bridge.getImpactAnalysis(request), "BRIDGE_IMPACT_GET_FAILED");
  },

  async listImpactAnalyses(
    request: ImpactListRequest
  ): Promise<IpcResponse<ImpactAnalysisSummary[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.listImpactAnalyses(request), "BRIDGE_IMPACT_LIST_FAILED");
  },

  async checkImpactFreshness(
    request: ImpactGetRequest
  ): Promise<IpcResponse<ImpactAnalysisResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Change Impact analysis requires the desktop app."
        }
      };
    }
    return safeInvoke(() => bridge.checkImpactFreshness(request), "BRIDGE_IMPACT_FRESHNESS_FAILED");
  },

  async updateImpactValidationStep(
    request: ImpactUpdateValidationRequest
  ): Promise<IpcResponse<ImpactAnalysisResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Change Impact analysis requires the desktop app."
        }
      };
    }
    return safeInvoke(
      () => bridge.updateImpactValidationStep(request),
      "BRIDGE_IMPACT_UPDATE_VALIDATION_FAILED"
    );
  },

  async deleteImpactAnalysis(
    request: ImpactGetRequest
  ): Promise<IpcResponse<{ deleted: boolean }>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: { deleted: false } };
    return safeInvoke(() => bridge.deleteImpactAnalysis(request), "BRIDGE_IMPACT_DELETE_FAILED");
  },

  async listActivityEvents(request: ActivityListRequest): Promise<IpcResponse<ActivityEvent[]>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: [] };
    return safeInvoke(() => bridge.listActivityEvents(request), "BRIDGE_ACTIVITY_LIST_FAILED");
  },

  async clearActivityEvents(
    request: ActivityClearRequest
  ): Promise<IpcResponse<{ cleared: boolean }>> {
    const bridge = getBridge();
    if (!bridge) return { ok: true, data: { cleared: false } };
    return safeInvoke(() => bridge.clearActivityEvents(request), "BRIDGE_ACTIVITY_CLEAR_FAILED");
  },

  async getAppPreferences(): Promise<IpcResponse<AppPreferences>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          schemaVersion: 1,
          editorFontSize: 13,
          reopenLastWorkspace: true,
          onboardingCompleted: true,
          confirmBeforePatchApply: true,
          confirmBeforeCommandRun: true
        }
      };
    }
    return safeInvoke(() => bridge.getAppPreferences(), "BRIDGE_PREFERENCES_GET_FAILED");
  },

  async updateAppPreferences(patch: AppPreferencesPatch): Promise<IpcResponse<AppPreferences>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          schemaVersion: 1,
          editorFontSize: patch.editorFontSize ?? 13,
          reopenLastWorkspace: patch.reopenLastWorkspace ?? true,
          onboardingCompleted: patch.onboardingCompleted ?? true,
          confirmBeforePatchApply: true,
          confirmBeforeCommandRun: true
        }
      };
    }
    return safeInvoke(() => bridge.updateAppPreferences(patch), "BRIDGE_PREFERENCES_UPDATE_FAILED");
  },

  async getDiagnostics(request?: DiagnosticsGetRequest): Promise<IpcResponse<DiagnosticsSnapshot>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: { code: "ELECTRON_REQUIRED", message: "Diagnostics require the desktop app." }
      };
    }
    return safeInvoke(() => bridge.getDiagnostics(request), "BRIDGE_DIAGNOSTICS_GET_FAILED");
  }
};
