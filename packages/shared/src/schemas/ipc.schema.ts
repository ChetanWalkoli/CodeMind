import { z } from "zod";

export const IPC_CHANNELS = {
  WORKSPACE_SELECT_FOLDER: "workspace:select-folder",
  WORKSPACE_GET_TREE: "workspace:get-tree",
  FILE_READ: "file:read",
  FILE_WRITE: "file:write",
  APP_GET_INFO: "app:get-info",
  APP_GET_PLATFORM: "app:get-platform",
  APP_HEALTH_CHECK: "app:health-check",
  THEME_GET: "theme:get",
  THEME_SET: "theme:set"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

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
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1)
});

export type AppInfo = z.infer<typeof AppInfoSchema>;

export const PlatformInfoSchema = z.object({
  platform: z.string().min(1),
  arch: z.string().min(1),
  electronVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  chromeVersion: z.string().min(1)
});

export type PlatformInfo = z.infer<typeof PlatformInfoSchema>;

export const ThemePreferenceSchema = z.enum(["dark", "light"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const SetThemeRequestSchema = z.object({
  theme: ThemePreferenceSchema
});

export type SetThemeRequest = z.infer<typeof SetThemeRequestSchema>;

export const HealthCheckResponseSchema = z.object({
  status: z.literal("ready"),
  timestamp: z.string().datetime()
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

export const IpcErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});

export type IpcError = z.infer<typeof IpcErrorSchema>;

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export interface CodeMindDesktopAPI {
  getAppInfo(): Promise<IpcResponse<AppInfo>>;
  getPlatformInfo(): Promise<IpcResponse<PlatformInfo>>;
  healthCheck(): Promise<IpcResponse<HealthCheckResponse>>;
  getTheme(): Promise<IpcResponse<ThemePreference>>;
  setTheme(request: SetThemeRequest): Promise<IpcResponse<ThemePreference>>;
}
