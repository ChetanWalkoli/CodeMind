import {
  FileReadRequestSchema,
  FileReadResultSchema,
  FileStatRequestSchema,
  FileStatResultSchema,
  FileWriteRequestSchema,
  FileWriteResultSchema,
  type FileReadResult,
  type FileStatResult,
  type FileWriteResult,
  type IpcResponse
} from "@codemind/shared";
import type { WorkspaceFileService } from "../../workspace/filesystem.js";
import { WorkspaceSecurityError } from "../../workspace/pathSecurity.js";

function toErrorResponse<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (err instanceof WorkspaceSecurityError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: err instanceof Error ? err.message : "File operation failed."
    }
  };
}

export function createFileHandlers(
  fileService: WorkspaceFileService,
  onFileSaved?: (workspaceRoot: string, relativePath: string) => Promise<void>
) {
  return {
    async readFile(payload: unknown): Promise<IpcResponse<FileReadResult>> {
      const parsed = FileReadRequestSchema.safeParse(payload);
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
        const result = await fileService.readFile(
          parsed.data.workspaceRoot,
          parsed.data.relativePath
        );
        return { ok: true, data: FileReadResultSchema.parse(result) };
      } catch (err) {
        return toErrorResponse(err, "FILE_READ_FAILED");
      }
    },

    async writeFile(payload: unknown): Promise<IpcResponse<FileWriteResult>> {
      const parsed = FileWriteRequestSchema.safeParse(payload);
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
        const result = await fileService.writeFile(
          parsed.data.workspaceRoot,
          parsed.data.relativePath,
          parsed.data.content,
          parsed.data.expectedContentHash,
          parsed.data.force ?? false
        );
        if (onFileSaved) {
          await onFileSaved(parsed.data.workspaceRoot, result.relativePath);
        }
        return { ok: true, data: FileWriteResultSchema.parse(result) };
      } catch (err) {
        return toErrorResponse(err, "FILE_WRITE_FAILED");
      }
    },

    async statFile(payload: unknown): Promise<IpcResponse<FileStatResult>> {
      const parsed = FileStatRequestSchema.safeParse(payload);
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
        const result = await fileService.statFile(
          parsed.data.workspaceRoot,
          parsed.data.relativePath
        );
        return { ok: true, data: FileStatResultSchema.parse(result) };
      } catch (err) {
        return toErrorResponse(err, "FILE_STAT_FAILED");
      }
    }
  };
}
