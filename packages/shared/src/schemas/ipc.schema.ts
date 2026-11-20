import { z } from "zod";

export const IPC_CHANNELS = {
  WORKSPACE_SELECT_FOLDER: "workspace:select-folder",
  WORKSPACE_GET_TREE: "workspace:get-tree",
  FILE_READ: "file:read",
  FILE_WRITE: "file:write",
  APP_GET_INFO: "app:get-info"
} as const;

export const FileReadRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1)
});

export type FileReadRequest = z.infer<typeof FileReadRequestSchema>;

export const FileWriteRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1),
  content: z.string(),
  expectedContentHash: z.string().min(1).optional()
});

export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string()
});

export type AppInfo = z.infer<typeof AppInfoSchema>;
