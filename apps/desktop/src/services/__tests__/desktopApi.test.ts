import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopApi, isElectronEnvironment } from "../desktopApi";

describe("desktopApi service", () => {
  afterEach(() => {
    delete window.codemindDesktop;
    window.localStorage.clear();
  });

  it("uses safe browser fallback when running outside Electron", async () => {
    expect(isElectronEnvironment()).toBe(false);

    const appInfo = await desktopApi.getAppInfo();
    expect(appInfo.ok).toBe(true);
    if (appInfo.ok) {
      expect(appInfo.data.platform).toBe("browser");
    }

    const setRes = await desktopApi.setTheme("light");
    expect(setRes).toEqual({ ok: true, data: "light" });

    const getRes = await desktopApi.getTheme();
    expect(getRes).toEqual({ ok: true, data: "light" });
  });

  it("delegates to window.codemindDesktop when inside Electron and catches bridge rejections", async () => {
    window.codemindDesktop = {
      getAppInfo: vi.fn().mockResolvedValue({
        ok: true,
        data: { name: "CodeMind", version: "0.1.0", platform: "win32" }
      }),
      getPlatformInfo: vi.fn().mockRejectedValue(new Error("IPC channel closed")),
      healthCheck: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: "ready", timestamp: new Date().toISOString() }
      }),
      getTheme: vi.fn().mockResolvedValue({ ok: true, data: "dark" }),
      setTheme: vi.fn().mockResolvedValue({ ok: true, data: "light" })
    };

    expect(isElectronEnvironment()).toBe(true);

    const appRes = await desktopApi.getAppInfo();
    expect(appRes).toEqual({
      ok: true,
      data: { name: "CodeMind", version: "0.1.0", platform: "win32" }
    });

    const platformRes = await desktopApi.getPlatformInfo();
    expect(platformRes.ok).toBe(false);
    if (!platformRes.ok) {
      expect(platformRes.error.code).toBe("BRIDGE_PLATFORM_INFO_FAILED");
    }
  });
});
