import os from "node:os";
import { IPC_CHANNELS, type IpcResponse } from "@codemind/shared";
import { APPROVED_IPC_CHANNELS, type ApprovedIpcChannel } from "./channels.js";
import { createAIConfigHandlers, type KeyValidatorFn } from "./handlers/aiConfig.handler.js";
import { createAIContextHandlers } from "./handlers/aiContext.handler.js";
import { createAIStreamAndConversationHandlers } from "./handlers/aiConversation.handler.js";
import { createAppHandlers, type AppRuntimeMetadata } from "./handlers/app.handler.js";
import { CodeEngineManager, createEngineHandlers } from "./handlers/engine.handler.js";
import { createDecisionHandlers } from "./handlers/decision.handler.js";
import { createFileHandlers } from "./handlers/file.handler.js";
import { createImpactHandlers } from "./handlers/impact.handler.js";
import { createIntentHandlers } from "./handlers/intent.handler.js";
import { createThemeHandlers } from "./handlers/theme.handler.js";
import { createWorkspaceHandlers, type SelectFolderFn } from "./handlers/workspace.handler.js";
import { ContextApprovalStore } from "../ai/contextApprovalStore.js";
import { WorkspaceContextBuilder } from "../ai/contextBuilder.js";
import { ConversationStore } from "../ai/conversationStore.js";
import { CredentialStore, type SafeStorageAdapter } from "../ai/credentialStore.js";
import { AIProviderManager } from "../ai/providerManager.js";
import { AIStreamManager, type StreamEventEmitter } from "../ai/streamManager.js";
import { SecureTransmissionGate } from "../ai/transmissionGate.js";
import { AIUsageStore } from "../ai/usageStore.js";
import { DecisionManager } from "../decisions/decisionManager.js";
import { DecisionStore } from "../decisions/decisionStore.js";
import { ImpactManager } from "../impact/impactManager.js";
import { ImpactStore } from "../impact/impactStore.js";
import { IntentOrchestrator } from "../intent/intentOrchestrator.js";
import { IntentStore } from "../intent/intentStore.js";
import type { AtomicWriteFileFn } from "../intent/patchApplicationEngine.js";
import { VerificationEngine } from "../intent/verificationEngine.js";
import type { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceFileService } from "../workspace/filesystem.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

const UNAVAILABLE_SAFE_STORAGE: SafeStorageAdapter = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("OS encryption is unavailable.");
  },
  decryptString: () => {
    throw new Error("OS encryption is unavailable.");
  }
};

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcRegistrationDeps {
  metadata: AppRuntimeMetadata;
  preferences: PreferencesStore;
  authority?: WorkspaceAuthority;
  fileService?: WorkspaceFileService;
  engineManager?: CodeEngineManager;
  selectFolder?: SelectFolderFn;
  credentials?: CredentialStore;
  providerManager?: AIProviderManager;
  approvalStore?: ContextApprovalStore;
  conversationStore?: ConversationStore;
  usageStore?: AIUsageStore;
  intentStore?: IntentStore;
  decisionStore?: DecisionStore;
  impactStore?: ImpactStore;
  writeFileAtomic?: AtomicWriteFileFn;
  streamManager?: AIStreamManager;
  streamEventEmitter?: StreamEventEmitter;
  validateAIKey?: KeyValidatorFn;
}

const registeredChannels = new Set<ApprovedIpcChannel>();

function wrapHandler<T>(handler: (payload: unknown) => IpcResponse<T> | Promise<IpcResponse<T>>) {
  return async (_event: unknown, payload?: unknown): Promise<IpcResponse<T>> => {
    try {
      return await handler(payload);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "INTERNAL_IPC_ERROR",
          message: err instanceof Error ? err.message : "Unexpected IPC error."
        }
      };
    }
  };
}

function registerSafe(
  ipcMain: IpcMainLike,
  channel: ApprovedIpcChannel,
  listener: (event: unknown, payload?: unknown) => unknown
) {
  if (registeredChannels.has(channel)) {
    return;
  }
  ipcMain.handle(channel, listener);
  registeredChannels.add(channel);
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcRegistrationDeps): void {
  const authority = deps.authority ?? new WorkspaceAuthority();
  const fileService = deps.fileService ?? new WorkspaceFileService(authority);
  const engineManager = deps.engineManager ?? new CodeEngineManager();
  const selectFolder = deps.selectFolder ?? (async () => null);
  const credentials =
    deps.credentials ?? new CredentialStore(os.tmpdir(), UNAVAILABLE_SAFE_STORAGE);
  const providerManager = deps.providerManager ?? new AIProviderManager(credentials);
  const approvalStore = deps.approvalStore ?? new ContextApprovalStore();
  const conversationStore = deps.conversationStore ?? new ConversationStore(os.tmpdir());
  const usageStore = deps.usageStore ?? new AIUsageStore(os.tmpdir());
  const intentStore = deps.intentStore ?? new IntentStore(os.tmpdir());
  const intentOrchestrator = new IntentOrchestrator({
    authority,
    preferences: deps.preferences,
    engineManager,
    providerManager,
    store: intentStore,
    writeFileAtomic: deps.writeFileAtomic
  });
  const intentHandlers = createIntentHandlers(intentOrchestrator);
  const decisionStore = deps.decisionStore ?? new DecisionStore(os.tmpdir());
  const decisionManager = new DecisionManager({
    authority,
    store: decisionStore,
    engineManager,
    preferences: deps.preferences,
    intentStore,
    providerManager
  });
  const decisionHandlers = createDecisionHandlers(decisionManager);
  const impactStore = deps.impactStore ?? new ImpactStore(os.tmpdir());
  const verificationEngine = new VerificationEngine(authority);
  const impactManager = new ImpactManager({
    workspaceAuthority: authority,
    impactStore,
    decisionManager,
    verificationEngine,
    getIndexer: (workspaceRoot) => engineManager.get(workspaceRoot)
  });
  const impactHandlers = createImpactHandlers(impactManager);
  const contextBuilder = new WorkspaceContextBuilder(authority);
  const transmissionGate = new SecureTransmissionGate({
    authority,
    approvalStore,
    preferences: deps.preferences,
    providerManager
  });
  const streamManager =
    deps.streamManager ??
    new AIStreamManager({
      transmissionGate,
      providerManager,
      usageStore,
      conversationStore
    });

  const appHandlers = createAppHandlers(deps.metadata);
  const themeHandlers = createThemeHandlers(deps.preferences);
  const workspaceHandlers = createWorkspaceHandlers({
    fileService,
    preferences: deps.preferences,
    selectFolder
  });
  const engineHandlers = createEngineHandlers({
    authority,
    preferences: deps.preferences,
    engineManager
  });
  const fileHandlers = createFileHandlers(fileService, async (workspaceRoot, relativePath) => {
    const realRoot = authority.getAuthorizedRoot(workspaceRoot);
    await engineManager.notifyFileSaved(realRoot, relativePath);
    approvalStore.invalidateForFile(realRoot, relativePath);
  });
  const aiConfigHandlers = createAIConfigHandlers({
    credentials,
    preferences: deps.preferences,
    providerManager,
    onCredentialsChanged: (provider, reason) => {
      streamManager.cancelAllForProvider(provider, reason);
    },
    validateKeyFn: deps.validateAIKey
  });
  const aiContextHandlers = createAIContextHandlers({
    authority,
    preferences: deps.preferences,
    engineManager,
    contextBuilder,
    approvalStore,
    transmissionGate
  });
  const aiStreamConvHandlers = createAIStreamAndConversationHandlers({
    authority,
    preferences: deps.preferences,
    streamManager,
    conversationStore,
    usageStore
  });

  registerSafe(
    ipcMain,
    IPC_CHANNELS.APP_GET_INFO,
    wrapHandler(() => appHandlers.getAppInfo())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.APP_GET_PLATFORM,
    wrapHandler(() => appHandlers.getPlatformInfo())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.APP_HEALTH_CHECK,
    wrapHandler(() => appHandlers.healthCheck())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.THEME_GET,
    wrapHandler(() => themeHandlers.getTheme())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.THEME_SET,
    wrapHandler((payload) => themeHandlers.setTheme(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_SELECT_FOLDER,
    wrapHandler(() => workspaceHandlers.selectFolder())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_OPEN,
    wrapHandler((payload) => workspaceHandlers.openWorkspace(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_GET_LAST,
    wrapHandler(() => workspaceHandlers.getWorkspaceSession())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_SAVE_SESSION,
    wrapHandler((payload) => workspaceHandlers.saveWorkspaceSession(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_GET_TREE,
    wrapHandler((payload) => workspaceHandlers.getWorkspaceTree(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_SEARCH_FILES,
    wrapHandler((payload) => workspaceHandlers.searchWorkspaceFiles(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_GET_GIT_STATUS,
    wrapHandler((payload) => workspaceHandlers.getGitStatus(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_INDEX_WORKSPACE,
    wrapHandler((payload) => engineHandlers.indexWorkspace(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_SEARCH_SYMBOLS,
    wrapHandler((payload) => engineHandlers.searchSymbols(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_GET_GRAPH,
    wrapHandler((payload) => engineHandlers.getDependencyGraph(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_GET_FILE_INTEL,
    wrapHandler((payload) => engineHandlers.getFileIntelligence(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_GET_OVERVIEW,
    wrapHandler((payload) => engineHandlers.getArchitectureOverview(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.FILE_READ,
    wrapHandler((payload) => fileHandlers.readFile(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.FILE_WRITE,
    wrapHandler((payload) => fileHandlers.writeFile(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.FILE_STAT,
    wrapHandler((payload) => fileHandlers.statFile(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_GET_CONFIG,
    wrapHandler(() => aiConfigHandlers.getConfig())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_SET_KEY,
    wrapHandler((payload) => aiConfigHandlers.setApiKey(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_CLEAR_KEY,
    wrapHandler((payload) => aiConfigHandlers.clearApiKey(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_SET_MODEL,
    wrapHandler((payload) => aiConfigHandlers.setModel(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_VALIDATE_KEY,
    wrapHandler((payload) => aiConfigHandlers.validateApiKey(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_BUILD_CONTEXT,
    wrapHandler((payload) => aiContextHandlers.buildContext(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_APPROVE_CONTEXT,
    wrapHandler((payload) => aiContextHandlers.approveContext(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_SEARCH_CONTEXT_FILES,
    wrapHandler((payload) => aiContextHandlers.searchContextFiles(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_RESOLVE_MISSING_FILES,
    wrapHandler((payload) => aiContextHandlers.resolveMissingFiles(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_GET_CONTEXT_APPROVAL,
    wrapHandler((payload) => aiContextHandlers.getContextApproval(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
    wrapHandler((payload) => aiContextHandlers.executeApprovedContext(payload))
  );

  registerSafe(ipcMain, IPC_CHANNELS.AI_STREAM_START, async (ipcEvent, payload) => {
    try {
      const sender = (ipcEvent as { sender?: { send?: (ch: string, data: unknown) => void } })
        ?.sender;
      const emit: StreamEventEmitter =
        deps.streamEventEmitter ??
        ((streamEvt) => {
          sender?.send?.(IPC_CHANNELS.AI_STREAM_EVENT, streamEvt);
        });
      return aiStreamConvHandlers.startStream(payload, emit);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "INTERNAL_IPC_ERROR",
          message: err instanceof Error ? err.message : "Unexpected IPC error."
        }
      };
    }
  });

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_STREAM_CANCEL,
    wrapHandler((payload) => aiStreamConvHandlers.cancelStream(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_CONVERSATION_CREATE,
    wrapHandler((payload) => aiStreamConvHandlers.createConversation(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_CONVERSATION_LIST,
    wrapHandler((payload) => aiStreamConvHandlers.listConversations(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_CONVERSATION_GET,
    wrapHandler((payload) => aiStreamConvHandlers.getConversation(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_CONVERSATION_RENAME,
    wrapHandler((payload) => aiStreamConvHandlers.renameConversation(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_CONVERSATION_DELETE,
    wrapHandler((payload) => aiStreamConvHandlers.deleteConversation(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.AI_GET_USAGE,
    wrapHandler(() => aiStreamConvHandlers.getUsageSummary())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_CREATE,
    wrapHandler((payload) => intentHandlers.createIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_LIST,
    wrapHandler((payload) => intentHandlers.listIntents(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_GET,
    wrapHandler((payload) => intentHandlers.getIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_CLARIFY,
    wrapHandler((payload) => intentHandlers.clarifyIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_CANCEL,
    wrapHandler((payload) => intentHandlers.cancelIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_DELETE,
    wrapHandler((payload) => intentHandlers.deleteIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_INVESTIGATE,
    wrapHandler((payload) => intentHandlers.investigateIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_ANALYZE,
    wrapHandler((payload) => intentHandlers.analyzeIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_RECOMMEND,
    wrapHandler((payload) => intentHandlers.recommendIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_DECIDE_RECOMMENDATION,
    wrapHandler((payload) => intentHandlers.decideRecommendation(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_GENERATE_PATCH,
    wrapHandler((payload) => intentHandlers.generatePatch(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_REVIEW_PATCH,
    wrapHandler((payload) => intentHandlers.reviewPatch(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_APPROVE_PATCH_TX,
    wrapHandler((payload) => intentHandlers.approvePatchTx(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_APPLY_PATCH_TX,
    wrapHandler((payload) => intentHandlers.applyPatchTx(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_DISCOVER_VERIFICATION,
    wrapHandler((payload) => intentHandlers.discoverVerification(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_RUN_VERIFICATION,
    wrapHandler((payload) => intentHandlers.runVerification(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_CANCEL_VERIFICATION,
    wrapHandler((payload) => intentHandlers.cancelVerification(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_CHECK_ROLLBACK,
    wrapHandler((payload) => intentHandlers.checkRollback(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.INTENT_EXECUTE_ROLLBACK,
    wrapHandler((payload) => intentHandlers.executeRollback(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_CREATE,
    wrapHandler((payload) => decisionHandlers.createDecision(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_UPDATE,
    wrapHandler((payload) => decisionHandlers.updateDecision(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_LIST,
    wrapHandler((payload) => decisionHandlers.listDecisions(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_GET,
    wrapHandler((payload) => decisionHandlers.getDecision(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_DELETE,
    wrapHandler((payload) => decisionHandlers.deleteDecision(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_TRANSITION_STATUS,
    wrapHandler((payload) => decisionHandlers.transitionStatus(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_CREATE_FROM_INTENT,
    wrapHandler((payload) => decisionHandlers.createFromIntent(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_SUGGEST,
    wrapHandler((payload) => decisionHandlers.suggestDecisions(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_DISMISS_SUGGESTION,
    wrapHandler((payload) => decisionHandlers.dismissSuggestion(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_LINK_EVIDENCE,
    wrapHandler((payload) => decisionHandlers.linkEvidence(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_LINK_COMMIT,
    wrapHandler((payload) => decisionHandlers.linkCommit(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_LIST_GIT_COMMITS,
    wrapHandler((payload) => decisionHandlers.listGitCommits(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_TIMELINE,
    wrapHandler((payload) => decisionHandlers.getTimeline(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_SEARCH,
    wrapHandler((payload) => decisionHandlers.searchDecisions(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_ASK_WHY,
    wrapHandler((payload) => decisionHandlers.askWhy(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_VERIFY_ALL,
    wrapHandler((payload) => decisionHandlers.verifyAll(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_REVALIDATE,
    wrapHandler((payload) => decisionHandlers.revalidate(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_DETECT_CONFLICTS,
    wrapHandler((payload) => decisionHandlers.detectConflicts(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_ANALYZE,
    wrapHandler((payload) => impactHandlers.analyze(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_ANALYZE_GIT_DIFF,
    wrapHandler((payload) => impactHandlers.analyzeGitDiff(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_GET,
    wrapHandler((payload) => impactHandlers.get(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_LIST,
    wrapHandler((payload) => impactHandlers.list(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_CHECK_FRESHNESS,
    wrapHandler((payload) => impactHandlers.checkFreshness(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_UPDATE_VALIDATION,
    wrapHandler((payload) => impactHandlers.updateValidation(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_DELETE,
    wrapHandler((payload) => impactHandlers.delete(payload))
  );
}

export function unregisterIpcHandlers(ipcMain: IpcMainLike): void {
  for (const channel of APPROVED_IPC_CHANNELS) {
    if (registeredChannels.has(channel)) {
      ipcMain.removeHandler(channel);
      registeredChannels.delete(channel);
    }
  }
}

export function getRegisteredIpcChannels(): ApprovedIpcChannel[] {
  return Array.from(registeredChannels);
}
