import {
  AppInfoSchema,
  HealthCheckResponseSchema,
  PlatformInfoSchema,
  type AppInfo,
  type HealthCheckResponse,
  type IpcResponse,
  type PlatformInfo
} from "@codemind/shared";

export interface AppRuntimeMetadata {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
}

export function createAppHandlers(metadata: AppRuntimeMetadata) {
  return {
    getAppInfo(): IpcResponse<AppInfo> {
      const parsed = AppInfoSchema.safeParse({
        name: metadata.name,
        version: metadata.version,
        platform: metadata.platform
      });

      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_APP_INFO",
            message: "Application metadata failed validation."
          }
        };
      }

      return { ok: true, data: parsed.data };
    },

    getPlatformInfo(): IpcResponse<PlatformInfo> {
      const parsed = PlatformInfoSchema.safeParse({
        platform: metadata.platform,
        arch: metadata.arch,
        electronVersion: metadata.electronVersion,
        nodeVersion: metadata.nodeVersion,
        chromeVersion: metadata.chromeVersion
      });

      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PLATFORM_INFO",
            message: "Platform metadata failed validation."
          }
        };
      }

      return { ok: true, data: parsed.data };
    },

    healthCheck(): IpcResponse<HealthCheckResponse> {
      const parsed = HealthCheckResponseSchema.safeParse({
        status: "ready",
        timestamp: new Date().toISOString()
      });

      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "HEALTH_CHECK_FAILED",
            message: "Health check response failed validation."
          }
        };
      }

      return { ok: true, data: parsed.data };
    }
  };
}
