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
  type AIStreamCancelRequest,
  type AIStreamIpcEvent,
  type AIStreamStartRequest,
  type AISetKeyRequest,
  type AISetModelRequest,
  type AIValidateKeyRequest,
  type CodeMindDesktopAPI,
  type EngineFileIntelRequest,
  type EngineGraphRequest,
  type EngineIndexRequest,
  type EngineSearchSymbolsRequest,
  type FileReadRequest,
  type FileStatRequest,
  type FileWriteRequest,
  type GitStatusRequest,
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
  getAIUsageSummary: () => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_USAGE)
});

contextBridge.exposeInMainWorld("codemindDesktop", desktopApi);
