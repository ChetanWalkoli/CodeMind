// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@codemind/ai-core";
import {
  IPC_CHANNELS,
  type AIConfigStatus,
  type AIValidateKeyResult,
  type IpcResponse
} from "@codemind/shared";
import {
  CredentialStore,
  CredentialStoreError,
  createMaskedKeyHint,
  type SafeStorageAdapter
} from "../ai/credentialStore.js";
import { AIProviderManager } from "../ai/providerManager.js";
import { validateGeminiKey } from "../ipc/handlers/aiConfig.handler.js";
import { registerIpcHandlers, unregisterIpcHandlers, type IpcMainLike } from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";

function createMutableSafeStorage(
  initialAvailable = true,
  failDecrypt = false
): {
  adapter: SafeStorageAdapter;
  setAvailable: (next: boolean) => void;
} {
  let available = initialAvailable;
  const adapter: SafeStorageAdapter = {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => {
      const bytes = Buffer.from(plainText, "utf8");
      const out = Buffer.alloc(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) {
        out[i] = bytes[i]! ^ 0x5a;
      }
      return out;
    },
    decryptString: (encrypted: Buffer) => {
      if (failDecrypt) {
        throw new Error("Decryption failed");
      }
      const out = Buffer.alloc(encrypted.length);
      for (let i = 0; i < encrypted.length; i += 1) {
        out[i] = encrypted[i]! ^ 0x5a;
      }
      return out.toString("utf8");
    }
  };
  return {
    adapter,
    setAvailable: (next: boolean) => {
      available = next;
    }
  };
}

class MockIpcMain implements IpcMainLike {
  public handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke<T>(channel: string, payload?: unknown): Promise<IpcResponse<T>> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for ${channel}`);
    }
    return (await handler({}, payload)) as IpcResponse<T>;
  }
}

describe("Gemini CredentialStore, Validation, Migration & Lifecycle Security", () => {
  let tempDir: string;
  let ipcMain: MockIpcMain;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-ai-cred-"));
    ipcMain = new MockIpcMain();
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("encrypts Gemini credentials on disk without storing plaintext and supports replace & clear", () => {
    const { adapter } = createMutableSafeStorage(true);
    const store = new CredentialStore(tempDir, adapter);
    const rawKey = "AIzaSySecretGeminiKey9876543210ABCD";

    expect(createMaskedKeyHint(rawKey)).toBe("AIza...ABCD");

    const saved = store.setApiKey("gemini", rawKey);
    expect(saved.maskedKeyHint).toBe("AIza...ABCD");

    const filePath = path.join(tempDir, "ai-credentials.enc.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const rawFileContent = fs.readFileSync(filePath, "utf8");
    expect(rawFileContent).not.toContain(rawKey);
    expect(rawFileContent).not.toContain("SecretGeminiKey");

    expect(store.getDecryptedApiKey("gemini")).toBe(rawKey);
    expect(store.getStatus("gemini")).toEqual({
      hasApiKey: true,
      maskedKeyHint: "AIza...ABCD",
      encryptionAvailable: true,
      credentialCorrupt: false,
      statusError: null
    });

    // Replace existing key
    const replacementKey = "AIzaSyReplacementKey0000000000WXYZ";
    store.setApiKey("gemini", replacementKey);
    expect(store.getDecryptedApiKey("gemini")).toBe(replacementKey);
    expect(store.getStatus("gemini").maskedKeyHint).toBe("AIza...WXYZ");

    // Clear key removes file
    store.clearApiKey("gemini");
    expect(store.getDecryptedApiKey("gemini")).toBeNull();
    expect(store.getStatus("gemini")).toEqual({
      hasApiKey: false,
      maskedKeyHint: null,
      encryptionAvailable: true,
      credentialCorrupt: false,
      statusError: null
    });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("safely purges legacy unsupported provider credentials and migrates legacy preferences without losing theme", () => {
    const credFilePath = path.join(tempDir, "ai-credentials.enc.json");
    fs.writeFileSync(
      credFilePath,
      JSON.stringify({
        version: 1,
        providers: {
          legacyProvider: {
            encryptedBase64: Buffer.from("legacy-cipher").toString("base64"),
            maskedHint: "leg...1234",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        }
      }),
      "utf8"
    );

    const { adapter } = createMutableSafeStorage(true);
    const store = new CredentialStore(tempDir, adapter);
    const purged = store.purgeUnsupportedProviders(["gemini"]);
    expect(purged).toBe(1);
    expect(fs.existsSync(credFilePath)).toBe(false);

    // Preferences migration preserves theme while migrating aiSettings to Gemini
    const prefsPath = path.join(tempDir, "preferences.json");
    fs.writeFileSync(
      prefsPath,
      JSON.stringify({
        theme: "light",
        workspaceSession: {
          lastWorkspacePath: "C:\\demo",
          openTabPaths: [],
          activeTabPath: null,
          customExcludes: ["*.log"]
        },
        aiSettings: {
          provider: "legacy",
          model: "old-model"
        }
      }),
      "utf8"
    );

    const prefs = new PreferencesStore(tempDir);
    expect(prefs.getTheme()).toBe("light");
    expect(prefs.getWorkspaceSession().customExcludes).toEqual(["*.log"]);
    expect(prefs.getAISettings()).toEqual({ provider: "gemini", model: "gemini-3.8-flash" });
  });

  it("refuses silent overwrite of corrupted credential file until explicitly cleared", () => {
    const filePath = path.join(tempDir, "ai-credentials.enc.json");
    const corruptContent = "{ not valid json";
    fs.writeFileSync(filePath, corruptContent, "utf8");

    const { adapter } = createMutableSafeStorage(true);
    const store = new CredentialStore(tempDir, adapter);

    const status = store.getStatus("gemini");
    expect(status.hasApiKey).toBe(false);
    expect(status.credentialCorrupt).toBe(true);
    expect(status.statusError).toMatch(/corrupted/i);

    try {
      store.setApiKey("gemini", "AIzaSyNewKey1234567890abcd");
      expect.fail("Expected CREDENTIAL_CORRUPT error");
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialStoreError);
      expect((err as CredentialStoreError).code).toBe("CREDENTIAL_CORRUPT");
    }
    expect(fs.readFileSync(filePath, "utf8")).toBe(corruptContent);

    store.clearApiKey("gemini");
    expect(fs.existsSync(filePath)).toBe(false);
    store.setApiKey("gemini", "AIzaSyRecoveredKey1234567890");
    expect(store.getStatus("gemini").hasApiKey).toBe(true);
    expect(store.getStatus("gemini").credentialCorrupt).toBe(false);
  });

  it("handles OS encryption becoming unavailable after credentials were saved with no plaintext fallback", () => {
    const { adapter, setAvailable } = createMutableSafeStorage(true);
    const store = new CredentialStore(tempDir, adapter);
    const providerManager = new AIProviderManager(store, (_provider, apiKey) => {
      return {
        id: "gemini",
        name: `Gemini(${apiKey.slice(-4)})`,
        defaultModel: "gemini-3.8-flash",
        generate: vi.fn(),
        stream: vi.fn()
      } as unknown as AIProvider;
    });

    store.setApiKey("gemini", "AIzaSySavedBeforeLock1234567890AAAA");
    const cached = providerManager.getProvider("gemini");
    expect(cached.name).toBe("Gemini(AAAA)");
    expect(providerManager.hasCachedProvider("gemini")).toBe(true);

    setAvailable(false);

    const status = store.getStatus("gemini");
    expect(status.encryptionAvailable).toBe(false);
    expect(status.hasApiKey).toBe(false);
    expect(status.maskedKeyHint).toBe("AIza...AAAA");
    expect(status.statusError).toMatch(/encryption became unavailable/i);

    expect(() => store.getDecryptedApiKey("gemini")).toThrow(CredentialStoreError);
    expect(() => store.setApiKey("gemini", "AIzaSyAttemptPlaintext123456")).toThrow(
      CredentialStoreError
    );
    expect(() => providerManager.getProvider("gemini")).toThrow(CredentialStoreError);
    expect(providerManager.hasCachedProvider("gemini")).toBe(false);
  });

  it("rejects Electron basic_text storage backend as unavailable (no plaintext fallback)", () => {
    const { adapter } = createMutableSafeStorage(true);
    const basicTextAdapter: SafeStorageAdapter = {
      ...adapter,
      getSelectedStorageBackend: () => "basic_text"
    };
    const store = new CredentialStore(tempDir, basicTextAdapter);

    expect(store.isEncryptionAvailable()).toBe(false);
    expect(() => store.setApiKey("gemini", "AIzaSyShouldNotBeSaved123456")).toThrow(
      CredentialStoreError
    );
    expect(fs.existsSync(path.join(tempDir, "ai-credentials.enc.json"))).toBe(false);
  });

  it("distinguishes valid, auth_failed, rate_limited, timeout, network_error, and non-provider responses during Gemini validation", async () => {
    const testKey = "AIzaSyTestValidationKey9999999999";

    const validFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "models/gemini-2.5-flash" }] })
    }) as unknown as typeof fetch;
    const okRes = await validateGeminiKey("gemini", testKey, { fetchFn: validFetch });
    expect(okRes.valid).toBe(true);
    expect(okRes.status).toBe("valid");
    expect(validFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({
        headers: { "x-goog-api-key": testKey }
      })
    );

    // Non-JSON 200 captive portal
    const portalFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      }
    }) as unknown as typeof fetch;
    const portalRes = await validateGeminiKey("gemini", testKey, { fetchFn: portalFetch });
    expect(portalRes.valid).toBe(false);
    expect(portalRes.status).toBe("provider_error");

    // Gemini HTTP 400 API_KEY_INVALID with echoed key -> auth_failed + redacted
    const authFailFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => `API_KEY_INVALID for key ${testKey}`
    }) as unknown as typeof fetch;
    const authRes = await validateGeminiKey("gemini", testKey, { fetchFn: authFailFetch });
    expect(authRes.valid).toBe(false);
    expect(authRes.status).toBe("auth_failed");
    expect(authRes.message).not.toContain(testKey);
    expect(authRes.message).toContain("[REDACTED]");

    // Rate limit 429
    const rateLimitFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "RESOURCE_EXHAUSTED"
    }) as unknown as typeof fetch;
    const rateRes = await validateGeminiKey("gemini", testKey, { fetchFn: rateLimitFetch });
    expect(rateRes.valid).toBe(false);
    expect(rateRes.status).toBe("rate_limited");

    // Network failure
    const networkFetch = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed: ENOTFOUND")) as unknown as typeof fetch;
    const netRes = await validateGeminiKey("gemini", testKey, { fetchFn: networkFetch });
    expect(netRes.valid).toBe(false);
    expect(netRes.status).toBe("network_error");

    // Timeout
    const hangingFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortErr = new Error("The operation was aborted");
          abortErr.name = "AbortError";
          reject(abortErr);
        });
      });
    }) as unknown as typeof fetch;
    const timeoutRes = await validateGeminiKey("gemini", testKey, {
      fetchFn: hangingFetch,
      timeoutMs: 25
    });
    expect(timeoutRes.valid).toBe(false);
    expect(timeoutRes.status).toBe("timeout");
  });

  it("invalidates cached providers on key replace and key removal, and never exposes raw keys over IPC", async () => {
    const preferences = new PreferencesStore(tempDir);
    const { adapter } = createMutableSafeStorage(true);
    const credentials = new CredentialStore(tempDir, adapter);
    const createdKeys: string[] = [];

    const providerManager = new AIProviderManager(credentials, (_provider, apiKey) => {
      createdKeys.push(apiKey);
      return {
        id: "gemini",
        name: `Gemini-${apiKey.slice(-4)}`,
        defaultModel: "gemini-3.8-flash",
        generate: vi.fn(),
        stream: vi.fn()
      } as unknown as AIProvider;
    });

    const keyV1 = "AIzaSyFirstSecretKey1234567890AAA1";
    const keyV2 = "AIzaSySecondSecretKey123456789BBB2";

    const validateMock = vi.fn().mockImplementation(async (_provider: string, key: string) => {
      if (key === keyV1 || key === keyV2) {
        return {
          valid: true,
          status: "valid" as const,
          message: "Google Gemini API key verified successfully."
        };
      }
      return {
        valid: false,
        status: "auth_failed" as const,
        message: `Rejected key ${key}`
      };
    });

    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "win32",
        arch: "x64",
        electronVersion: "45.4.1",
        nodeVersion: "24.0.0",
        chromeVersion: "156.0.0"
      },
      preferences,
      credentials,
      providerManager,
      validateAIKey: validateMock
    });

    const setV1Res = await ipcMain.invoke<AIConfigStatus>(IPC_CHANNELS.AI_SET_KEY, {
      provider: "gemini",
      apiKey: keyV1
    });
    expect(setV1Res.ok).toBe(true);
    expect(JSON.stringify(setV1Res)).not.toContain(keyV1);

    const providerV1 = providerManager.getProvider("gemini");
    expect(providerV1.name).toBe("Gemini-AAA1");
    expect(createdKeys).toEqual([keyV1]);

    const setV2Res = await ipcMain.invoke<AIConfigStatus>(IPC_CHANNELS.AI_SET_KEY, {
      provider: "gemini",
      apiKey: keyV2
    });
    expect(setV2Res.ok).toBe(true);
    expect(JSON.stringify(setV2Res)).not.toContain(keyV2);
    expect(providerManager.hasCachedProvider("gemini")).toBe(false);

    const providerV2 = providerManager.getProvider("gemini");
    expect(providerV2).not.toBe(providerV1);
    expect(providerV2.name).toBe("Gemini-BBB2");
    expect(createdKeys).toEqual([keyV1, keyV2]);

    // Validate leaked secret redaction via IPC
    const leakedKey = "AIzaSyLeakedKey9999999999999999";
    const invalidRes = await ipcMain.invoke<AIValidateKeyResult>(IPC_CHANNELS.AI_VALIDATE_KEY, {
      provider: "gemini",
      apiKey: leakedKey
    });
    expect(invalidRes.ok).toBe(true);
    if (invalidRes.ok) {
      expect(invalidRes.data.valid).toBe(false);
      expect(invalidRes.data.message).not.toContain(leakedKey);
      expect(invalidRes.data.message).toContain("[REDACTED]");
    }

    // Clear key invalidates cached provider
    const clearRes = await ipcMain.invoke<AIConfigStatus>(IPC_CHANNELS.AI_CLEAR_KEY, {
      provider: "gemini"
    });
    expect(clearRes.ok).toBe(true);
    expect(providerManager.hasCachedProvider("gemini")).toBe(false);

    expect(() => providerManager.getProvider("gemini")).toThrow(CredentialStoreError);
  });
});
