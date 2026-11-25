import os from "node:os";
import { IPC_CHANNELS, type IpcResponse } from "@codemind/shared";
import { APPROVED_IPC_CHANNELS, type ApprovedIpcChannel } from "./channels.js";
import { createActivityAndDiagnosticsHandlers } from "./handlers/activity.handler.js";
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
import { ActivityStore } from "../activity/activityStore.js";
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
  activityStore?: ActivityStore;
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
  const activityStore = deps.activityStore ?? new ActivityStore(os.tmpdir());
  const activityHandlers = createActivityAndDiagnosticsHandlers({
    authority,
    activityStore,
    preferences: deps.preferences,
    metadata: deps.metadata,
    engineManager,
    credentials,
    decisionStore,
    impactStore
  });
  const recordSafeActivity = (input: Parameters<ActivityStore["record"]>[0]): void => {
    try {
      activityStore.record(input);
    } catch {
      // Activity recording must never break primary workflows
    }
  };
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
    wrapHandler(async (payload) => {
      const res = await workspaceHandlers.openWorkspace(payload);
      if (res.ok) {
        recordSafeActivity({
          workspaceRoot: res.data.rootPath,
          eventType: "workspace_opened",
          feature: "workspace",
          summary: `Opened workspace "${res.data.name}".`
        });
      }
      return res;
    })
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
    wrapHandler(async (payload) => {
      const res = await engineHandlers.indexWorkspace(payload);
      if (res.ok) {
        recordSafeActivity({
          workspaceRoot: res.data.workspaceRoot,
          eventType: "codebase_indexed",
          feature: "understand",
          summary: `Indexed ${res.data.indexedFiles} files and ${res.data.totalSymbols} symbols (${res.data.durationMs}ms).`
        });
      }
      return res;
    })
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
    wrapHandler(async (payload) => {
      const res = await decisionHandlers.createDecision(payload);
      if (res.ok && payload && typeof payload === "object" && "workspaceRoot" in payload) {
        const ws = String((payload as { workspaceRoot: string }).workspaceRoot);
        recordSafeActivity({
          workspaceRoot: authority.getAuthorizedRoot(ws),
          eventType: res.data.status === "accepted" ? "decision_accepted" : "decision_drafted",
          feature: "remember",
          relatedRecordId: res.data.id,
          relatedFiles: res.data.evidence
            .map((e) => e.filePath)
            .filter((p): p is string => Boolean(p)),
          summary: `Decision "${res.data.title}" recorded (${res.data.status}).`
        });
      }
      return res;
    })
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
    wrapHandler(async (payload) => {
      const res = await decisionHandlers.transitionStatus(payload);
      if (res.ok && payload && typeof payload === "object" && "workspaceRoot" in payload) {
        const ws = String((payload as { workspaceRoot: string }).workspaceRoot);
        const eventType =
          res.data.status === "superseded"
            ? "decision_superseded"
            : res.data.status === "accepted"
              ? "decision_accepted"
              : "decision_drafted";
        recordSafeActivity({
          workspaceRoot: authority.getAuthorizedRoot(ws),
          eventType,
          feature: "remember",
          relatedRecordId: res.data.id,
          summary: `Decision "${res.data.title}" transitioned to ${res.data.status}.`
        });
      }
      return res;
    })
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DECISION_CREATE_FROM_INTENT,
    wrapHandler(async (payload) => {
      const res = await decisionHandlers.createFromIntent(payload);
      if (res.ok && payload && typeof payload === "object" && "workspaceRoot" in payload) {
        const ws = String((payload as { workspaceRoot: string }).workspaceRoot);
        recordSafeActivity({
          workspaceRoot: authority.getAuthorizedRoot(ws),
          eventType: "decision_drafted",
          feature: "remember",
          relatedRecordId: res.data.id,
          relatedFiles: res.data.evidence
            .map((e) => e.filePath)
            .filter((p): p is string => Boolean(p)),
          summary: `Draft decision "${res.data.title}" captured from Intent Mode.`
        });
      }
      return res;
    })
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
    wrapHandler(async (payload) => {
      const res = await impactHandlers.analyze(payload);
      if (res.ok && payload && typeof payload === "object" && "workspaceRoot" in payload) {
        const ws = String((payload as { workspaceRoot: string }).workspaceRoot);
        recordSafeActivity({
          workspaceRoot: authority.getAuthorizedRoot(ws),
          eventType: "impact_completed",
          feature: "predict",
          relatedRecordId: res.data.analysisId,
          relatedFiles: res.data.analyzedTargets.map((t) => t.filePath),
          summary: `Impact analysis completed (${res.data.risk.level} risk ${res.data.risk.score}/100, ${res.data.impactedFiles.length} impacted files).`
        });
      }
      return res;
    })
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.IMPACT_ANALYZE_GIT_DIFF,
    wrapHandler(async (payload) => {
      const res = await impactHandlers.analyzeGitDiff(payload);
      if (res.ok && payload && typeof payload === "object" && "workspaceRoot" in payload) {
        const ws = String((payload as { workspaceRoot: string }).workspaceRoot);
        recordSafeActivity({
          workspaceRoot: authority.getAuthorizedRoot(ws),
          eventType: "impact_completed",
          feature: "predict",
          relatedRecordId: res.data.analysisId,
          relatedFiles: res.data.analyzedTargets.map((t) => t.filePath),
          summary: `Git diff impact analysis completed (${res.data.risk.level} risk ${res.data.risk.score}/100).`
        });
      }
      return res;
    })
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
    wrapHandler(async (payload) => {
      const res = await impactHandlers.checkFreshness(payload);
      if (
        res.ok &&
        res.data.status === "stale" &&
        payload &&
        typeof payload === "object" &&
        "workspaceRoot" in payload
      ) {
        const ws = String((payload as { workspaceRoot: string }).workspaceRoot);
        recordSafeActivity({
          workspaceRoot: authority.getAuthorizedRoot(ws),
          eventType: "impact_stale",
          feature: "predict",
          relatedRecordId: res.data.analysisId,
          relatedFiles: res.data.staleFiles,
          status: "warning",
          summary: `Impact report marked stale (${res.data.staleFiles.length} changed evidence item(s)).`
        });
      }
      return res;
    })
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
  registerSafe(
    ipcMain,
    IPC_CHANNELS.ACTIVITY_LIST,
    wrapHandler((payload) => activityHandlers.listActivity(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.ACTIVITY_CLEAR,
    wrapHandler((payload) => activityHandlers.clearActivity(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.PREFERENCES_GET,
    wrapHandler(() => activityHandlers.getAppPreferences())
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.PREFERENCES_UPDATE,
    wrapHandler((payload) => activityHandlers.updateAppPreferences(payload))
  );
  registerSafe(
    ipcMain,
    IPC_CHANNELS.DIAGNOSTICS_GET,
    wrapHandler((payload) => activityHandlers.getDiagnostics(payload))
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
