import {
  FileSearchMatchSchema,
  FileTreeNodeSchema,
  GitStatusRequestSchema,
  GitStatusSchema,
  WorkspaceInfoSchema,
  WorkspaceOpenRequestSchema,
  WorkspaceSearchRequestSchema,
  WorkspaceSessionSchema,
  WorkspaceTreeRequestSchema,
  type FileSearchMatch,
  type FileTreeNode,
  type GitStatus,
  type IpcResponse,
  type WorkspaceInfo,
  type WorkspaceSession
} from "@codemind/shared";
import { z } from "zod";
import type { PreferencesStore } from "../../utils/preferences.js";
import type { WorkspaceFileService } from "../../workspace/filesystem.js";
import { detectGitStatus } from "../../workspace/gitStatus.js";
import { WorkspaceSecurityError } from "../../workspace/pathSecurity.js";

export type SelectFolderFn = () => Promise<string | null>;

function toErrorResponse<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (err instanceof WorkspaceSecurityError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: err instanceof Error ? err.message : "Workspace operation failed."
    }
  };
}

export function createWorkspaceHandlers(deps: {
  fileService: WorkspaceFileService;
  preferences: PreferencesStore;
  selectFolder: SelectFolderFn;
}) {
  return {
    async selectFolder(): Promise<IpcResponse<WorkspaceInfo | null>> {
      try {
        const selectedPath = await deps.selectFolder();
        if (!selectedPath) {
          return { ok: true, data: null };
        }
        const info = deps.fileService.openWorkspace(selectedPath);
        const validated = WorkspaceInfoSchema.parse(info);

        const currentSession = deps.preferences.getWorkspaceSession();
        deps.preferences.saveWorkspaceSession({
          ...currentSession,
          lastWorkspacePath: validated.rootPath
        });

        return { ok: true, data: validated };
      } catch (err) {
        return toErrorResponse(err, "WORKSPACE_SELECT_FAILED");
      }
    },

    openWorkspace(payload: unknown): IpcResponse<WorkspaceInfo> {
      const parsed = WorkspaceOpenRequestSchema.safeParse(payload);
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
        const info = deps.fileService.openWorkspace(parsed.data.rootPath);
        const validated = WorkspaceInfoSchema.parse(info);

        const currentSession = deps.preferences.getWorkspaceSession();
        deps.preferences.saveWorkspaceSession({
          ...currentSession,
          lastWorkspacePath: validated.rootPath
        });

        return { ok: true, data: validated };
      } catch (err) {
        return toErrorResponse(err, "WORKSPACE_OPEN_FAILED");
      }
    },

    getWorkspaceSession(): IpcResponse<WorkspaceSession> {
      try {
        const session = deps.preferences.getWorkspaceSession();
        return { ok: true, data: WorkspaceSessionSchema.parse(session) };
      } catch (err) {
        return toErrorResponse(err, "WORKSPACE_SESSION_READ_FAILED");
      }
    },

    saveWorkspaceSession(payload: unknown): IpcResponse<WorkspaceSession> {
      const parsed = WorkspaceSessionSchema.safeParse(payload);
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
        const saved = deps.preferences.saveWorkspaceSession(parsed.data);
        return { ok: true, data: saved };
      } catch (err) {
        return toErrorResponse(err, "WORKSPACE_SESSION_SAVE_FAILED");
      }
    },

    async getWorkspaceTree(payload: unknown): Promise<IpcResponse<FileTreeNode[]>> {
      const parsed = WorkspaceTreeRequestSchema.safeParse(payload);
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
        const excludes =
          parsed.data.customExcludes ?? deps.preferences.getWorkspaceSession().customExcludes;
        const nodes = await deps.fileService.readDirectory(
          parsed.data.workspaceRoot,
          parsed.data.relativeDir ?? "",
          excludes
        );
        return { ok: true, data: z.array(FileTreeNodeSchema).parse(nodes) };
      } catch (err) {
        return toErrorResponse(err, "WORKSPACE_TREE_FAILED");
      }
    },

    async searchWorkspaceFiles(payload: unknown): Promise<IpcResponse<FileSearchMatch[]>> {
      const parsed = WorkspaceSearchRequestSchema.safeParse(payload);
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
        const excludes =
          parsed.data.customExcludes ?? deps.preferences.getWorkspaceSession().customExcludes;
        const matches = await deps.fileService.searchFiles(
          parsed.data.workspaceRoot,
          parsed.data.query,
          parsed.data.maxResults ?? 100,
          excludes
        );
        return { ok: true, data: z.array(FileSearchMatchSchema).parse(matches) };
      } catch (err) {
        return toErrorResponse(err, "WORKSPACE_SEARCH_FAILED");
      }
    },

    async getGitStatus(payload: unknown): Promise<IpcResponse<GitStatus>> {
      const parsed = GitStatusRequestSchema.safeParse(payload);
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
        // Ensure the requested workspace root is authorized before running git status.
        const info = deps.fileService.openWorkspace(parsed.data.workspaceRoot);
        const status = await detectGitStatus(info.rootPath);
        return { ok: true, data: GitStatusSchema.parse(status) };
      } catch (err) {
        return toErrorResponse(err, "GIT_STATUS_FAILED");
      }
    }
  };
}
