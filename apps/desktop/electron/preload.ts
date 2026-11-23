import { contextBridge, ipcRenderer } from "electron";
import {
  AIStreamIpcEventSchema,
  IPC_CHANNELS,
  type AIClearKeyRequest,
  type AIContextApprovalRequest,
  type AIContextBuildRequest,
  type AIContextGetApprovalRequest,
  type AIConversationCreateRequest,
  type AIConversationDeleteRequest,
  type AIConversationGetRequest,
  type AIConversationListRequest,
  type AIConversationRenameRequest,
  type AIExecuteApprovedRequest,
  type AIResolveMissingFilesRequest,
  type AISearchContextFilesRequest,
  type AIStreamCancelRequest,
  type AIStreamIpcEvent,
  type AIStreamStartRequest,
  type AISetKeyRequest,
  type AISetModelRequest,
  type AIValidateKeyRequest,
  type CodeMindDesktopAPI,
  type DecisionAskWhyRequest,
  type DecisionCreateFromIntentRequest,
  type DecisionCreateRequest,
  type DecisionDismissSuggestionRequest,
  type DecisionGetRequest,
  type DecisionLinkCommitRequest,
  type DecisionLinkEvidenceRequest,
  type DecisionListGitCommitsRequest,
  type DecisionRevalidateRequest,
  type DecisionSearchRequest,
  type DecisionTimelineRequest,
  type DecisionTransitionStatusRequest,
  type DecisionUpdateRequest,
  type DecisionWorkspaceRequest,
  type EngineFileIntelRequest,
  type EngineGraphRequest,
  type EngineIndexRequest,
  type EngineSearchSymbolsRequest,
  type FileReadRequest,
  type FileStatRequest,
  type FileWriteRequest,
  type GitStatusRequest,
  type IntentAnalyzeRequest,
  type IntentApplyPatchTxRequest,
  type IntentApprovePatchTxRequest,
  type IntentCancelVerificationRequest,
  type IntentCheckRollbackRequest,
  type IntentClarifyRequest,
  type IntentCreateRequest,
  type IntentDecideRecommendationRequest,
  type IntentDiscoverVerificationRequest,
  type ImpactAnalysisRequest,
  type ImpactAnalyzeGitDiffRequest,
  type ImpactGetRequest,
  type ImpactListRequest,
  type ImpactUpdateValidationRequest,
  type IntentExecuteRollbackRequest,
  type IntentGeneratePatchRequest,
  type IntentGetRequest,
  type IntentInvestigateRequest,
  type IntentListRequest,
  type IntentRecommendRequest,
  type IntentReviewPatchRequest,
  type IntentRunVerificationRequest,
  type SetThemeRequest,
  type WorkspaceOpenRequest,
  type WorkspaceSearchRequest,
  type WorkspaceSession,
  type WorkspaceTreeRequest
} from "@codemind/shared";

/**
 * Restricted preload bridge.
 * Only explicitly approved, Zod-validated operations are exposed to the renderer.
 * No Node.js APIs, raw ipcRenderer, unrestricted fs, or shell execution are exposed.
 */
const desktopApi: CodeMindDesktopAPI = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  getPlatformInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.APP_HEALTH_CHECK),
  getTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET),
  setTheme: (request: SetThemeRequest) => ipcRenderer.invoke(IPC_CHANNELS.THEME_SET, request),
  selectWorkspaceFolder: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SELECT_FOLDER),
  openWorkspace: (request: WorkspaceOpenRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN, request),
  getWorkspaceSession: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_LAST),
  saveWorkspaceSession: (session: WorkspaceSession) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SAVE_SESSION, session),
  getWorkspaceTree: (request: WorkspaceTreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_TREE, request),
  searchWorkspaceFiles: (request: WorkspaceSearchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SEARCH_FILES, request),
  getGitStatus: (request: GitStatusRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_STATUS, request),
  indexWorkspace: (request: EngineIndexRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_INDEX_WORKSPACE, request),
  searchSymbols: (request: EngineSearchSymbolsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_SEARCH_SYMBOLS, request),
  getDependencyGraph: (request: EngineGraphRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_GET_GRAPH, request),
  getFileIntelligence: (request: EngineFileIntelRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_GET_FILE_INTEL, request),
  getArchitectureOverview: (request: EngineGraphRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_GET_OVERVIEW, request),
  readFile: (request: FileReadRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, request),
  writeFile: (request: FileWriteRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, request),
  statFile: (request: FileStatRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_STAT, request),
  getAIConfig: () => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_CONFIG),
  setAIApiKey: (request: AISetKeyRequest) => ipcRenderer.invoke(IPC_CHANNELS.AI_SET_KEY, request),
  clearAIApiKey: (request?: AIClearKeyRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CLEAR_KEY, request),
  setAIModel: (request: AISetModelRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_SET_MODEL, request),
  validateAIApiKey: (request?: AIValidateKeyRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_VALIDATE_KEY, request),
  buildAIContext: (request: AIContextBuildRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_BUILD_CONTEXT, request),
  searchAIContextFiles: (request: AISearchContextFilesRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_SEARCH_CONTEXT_FILES, request),
  resolveAIMissingFiles: (request: AIResolveMissingFilesRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_RESOLVE_MISSING_FILES, request),
  approveAIContext: (request: AIContextApprovalRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_APPROVE_CONTEXT, request),
  getAIContextApproval: (request: AIContextGetApprovalRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_GET_CONTEXT_APPROVAL, request),
  executeApprovedAIContext: (request: AIExecuteApprovedRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT, request),
  startAIStream: (request: AIStreamStartRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_STREAM_START, request),
  cancelAIStream: (request: AIStreamCancelRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_STREAM_CANCEL, request),
  onAIStreamEvent: (requestId: string, listener: (event: AIStreamIpcEvent) => void) => {
    const handler = (_ipcEvent: unknown, payload: unknown) => {
      const parsed = AIStreamIpcEventSchema.safeParse(payload);
      if (parsed.success && parsed.data.requestId === requestId) {
        listener(parsed.data);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.AI_STREAM_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AI_STREAM_EVENT, handler);
    };
  },
  createAIConversation: (request: AIConversationCreateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_CREATE, request),
  listAIConversations: (request: AIConversationListRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_LIST, request),
  getAIConversation: (request: AIConversationGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_GET, request),
  renameAIConversation: (request: AIConversationRenameRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_RENAME, request),
  deleteAIConversation: (request: AIConversationDeleteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CONVERSATION_DELETE, request),
  getAIUsageSummary: () => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_USAGE),
  createIntent: (request: IntentCreateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_CREATE, request),
  listIntents: (request: IntentListRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_LIST, request),
  getIntent: (request: IntentGetRequest) => ipcRenderer.invoke(IPC_CHANNELS.INTENT_GET, request),
  clarifyIntent: (request: IntentClarifyRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_CLARIFY, request),
  cancelIntent: (request: IntentGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_CANCEL, request),
  deleteIntent: (request: IntentGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_DELETE, request),
  investigateIntent: (request: IntentInvestigateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_INVESTIGATE, request),
  analyzeIntent: (request: IntentAnalyzeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_ANALYZE, request),
  recommendIntent: (request: IntentRecommendRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_RECOMMEND, request),
  decideRecommendation: (request: IntentDecideRecommendationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_DECIDE_RECOMMENDATION, request),
  generateIntentPatch: (request: IntentGeneratePatchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_GENERATE_PATCH, request),
  reviewIntentPatch: (request: IntentReviewPatchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_REVIEW_PATCH, request),
  approvePatchTransaction: (request: IntentApprovePatchTxRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_APPROVE_PATCH_TX, request),
  applyPatchTransaction: (request: IntentApplyPatchTxRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_APPLY_PATCH_TX, request),
  discoverVerificationCommands: (request: IntentDiscoverVerificationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_DISCOVER_VERIFICATION, request),
  runVerificationCommand: (request: IntentRunVerificationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_RUN_VERIFICATION, request),
  cancelVerificationCommand: (request: IntentCancelVerificationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_CANCEL_VERIFICATION, request),
  checkTransactionRollback: (request: IntentCheckRollbackRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_CHECK_ROLLBACK, request),
  executeTransactionRollback: (request: IntentExecuteRollbackRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.INTENT_EXECUTE_ROLLBACK, request),
  createDecision: (request: DecisionCreateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_CREATE, request),
  updateDecision: (request: DecisionUpdateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_UPDATE, request),
  listDecisions: (request: DecisionWorkspaceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_LIST, request),
  getDecision: (request: DecisionGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_GET, request),
  deleteDecision: (request: DecisionGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_DELETE, request),
  transitionDecisionStatus: (request: DecisionTransitionStatusRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_TRANSITION_STATUS, request),
  createDecisionFromIntent: (request: DecisionCreateFromIntentRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_CREATE_FROM_INTENT, request),
  suggestDecisions: (request: DecisionWorkspaceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_SUGGEST, request),
  dismissDecisionSuggestion: (request: DecisionDismissSuggestionRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_DISMISS_SUGGESTION, request),
  linkDecisionEvidence: (request: DecisionLinkEvidenceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_LINK_EVIDENCE, request),
  linkDecisionCommit: (request: DecisionLinkCommitRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_LINK_COMMIT, request),
  listDecisionGitCommits: (request: DecisionListGitCommitsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_LIST_GIT_COMMITS, request),
  getDecisionTimeline: (request: DecisionTimelineRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_TIMELINE, request),
  searchDecisions: (request: DecisionSearchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_SEARCH, request),
  askWhyDecision: (request: DecisionAskWhyRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_ASK_WHY, request),
  verifyAllDecisions: (request: DecisionWorkspaceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_VERIFY_ALL, request),
  revalidateDecision: (request: DecisionRevalidateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_REVALIDATE, request),
  detectDecisionConflicts: (request: DecisionWorkspaceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DECISION_DETECT_CONFLICTS, request),
  analyzeChangeImpact: (request: ImpactAnalysisRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_ANALYZE, request),
  analyzeGitDiffImpact: (request: ImpactAnalyzeGitDiffRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_ANALYZE_GIT_DIFF, request),
  getImpactAnalysis: (request: ImpactGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_GET, request),
  listImpactAnalyses: (request: ImpactListRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_LIST, request),
  checkImpactFreshness: (request: ImpactGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_CHECK_FRESHNESS, request),
  updateImpactValidationStep: (request: ImpactUpdateValidationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_UPDATE_VALIDATION, request),
  deleteImpactAnalysis: (request: ImpactGetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPACT_DELETE, request)
});

contextBridge.exposeInMainWorld("codemindDesktop", desktopApi);
