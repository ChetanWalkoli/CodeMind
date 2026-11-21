import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AIProviderName } from "@codemind/shared";

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

export class CredentialStoreError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

const EncryptedEntrySchema = z.object({
  encryptedBase64: z.string().min(1),
  maskedHint: z.string().min(1),
  updatedAt: z.string().datetime()
});

const CredentialFileSchema = z.object({
  version: z.literal(1),
  providers: z.record(z.string(), EncryptedEntrySchema)
});

type CredentialFile = z.infer<typeof CredentialFileSchema>;

export function createMaskedKeyHint(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) {
    return "****";
  }
  const prefix = trimmed.startsWith("AIza") ? "AIza" : trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * OS-backed encrypted credential store for Electron main process.
 * Strictly requires Electron `safeStorage.isEncryptionAvailable()` and NEVER falls back to plaintext.
 */
export class CredentialStore {
  private readonly filePath: string;
  private readonly storage: SafeStorageAdapter;

  constructor(baseDirectory: string, storage: SafeStorageAdapter) {
    this.filePath = path.join(baseDirectory, "ai-credentials.enc.json");
    this.storage = storage;
  }

  public isEncryptionAvailable(): boolean {
    try {
      if (!this.storage.isEncryptionAvailable()) {
        return false;
      }
      if (
        typeof this.storage.getSelectedStorageBackend === "function" &&
        this.storage.getSelectedStorageBackend() === "basic_text"
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private readFileSafe(): { data: CredentialFile; corrupt: boolean } {
    if (!fs.existsSync(this.filePath)) {
      return { data: { version: 1, providers: {} }, corrupt: false };
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const validated = CredentialFileSchema.safeParse(parsed);
      if (!validated.success) {
        return { data: { version: 1, providers: {} }, corrupt: true };
      }
      return { data: validated.data, corrupt: false };
    } catch {
      return { data: { version: 1, providers: {} }, corrupt: true };
    }
  }

  private writeFileAtomic(data: CredentialFile): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
  }

  /**
   * Safely removes any legacy unsupported provider credentials (keeping only "gemini")
   * without logging or exposing their contents.
   */
  public purgeUnsupportedProviders(supportedProviders: readonly string[] = ["gemini"]): number {
    const { data, corrupt } = this.readFileSafe();
    if (corrupt) return 0;

    const allowed = new Set(supportedProviders);
    let removed = 0;
    for (const key of Object.keys(data.providers)) {
      if (!allowed.has(key)) {
        delete data.providers[key];
        removed += 1;
      }
    }

    if (removed > 0) {
      if (Object.keys(data.providers).length === 0) {
        if (fs.existsSync(this.filePath)) {
          fs.unlinkSync(this.filePath);
        }
      } else {
        this.writeFileAtomic(data);
      }
    }

    return removed;
  }

  public getStatus(provider: AIProviderName): {
    hasApiKey: boolean;
    maskedKeyHint: string | null;
    encryptionAvailable: boolean;
    credentialCorrupt: boolean;
    statusError: string | null;
  } {
    const encryptionAvailable = this.isEncryptionAvailable();
    const { data, corrupt } = this.readFileSafe();

    if (corrupt) {
      return {
        hasApiKey: false,
        maskedKeyHint: null,
        encryptionAvailable,
        credentialCorrupt: true,
        statusError:
          "Stored credential file is corrupted. Reset stored credentials before saving a new API key."
      };
    }

    const entry = data.providers[provider];
    if (entry && !encryptionAvailable) {
      return {
        hasApiKey: false,
        maskedKeyHint: entry.maskedHint,
        encryptionAvailable: false,
        credentialCorrupt: false,
        statusError:
          "OS-backed credential encryption became unavailable after your API key was saved. Plaintext fallback is disabled."
      };
    }

    return {
      hasApiKey: Boolean(entry && encryptionAvailable),
      maskedKeyHint: entry ? entry.maskedHint : null,
      encryptionAvailable,
      credentialCorrupt: false,
      statusError: null
    };
  }

  public setApiKey(provider: AIProviderName, rawApiKey: string): { maskedKeyHint: string } {
    if (!this.isEncryptionAvailable()) {
      throw new CredentialStoreError(
        "ENCRYPTION_UNAVAILABLE",
        "OS-backed credential encryption is unavailable on this system. Plaintext storage is not permitted."
      );
    }

    const { data, corrupt } = this.readFileSafe();
    if (corrupt) {
      throw new CredentialStoreError(
        "CREDENTIAL_CORRUPT",
        "Stored credential file is corrupted. Clear stored credentials before saving a new API key."
      );
    }

    const trimmed = rawApiKey.trim();
    if (trimmed.length < 10 || /\s/.test(trimmed)) {
      throw new CredentialStoreError("INVALID_API_KEY", "API key format is invalid.");
    }

    const encryptedBuffer = this.storage.encryptString(trimmed);
    const maskedHint = createMaskedKeyHint(trimmed);

    data.providers[provider] = {
      encryptedBase64: encryptedBuffer.toString("base64"),
      maskedHint,
      updatedAt: new Date().toISOString()
    };

    this.writeFileAtomic(data);
    return { maskedKeyHint: maskedHint };
  }

  /**
   * Decrypts the stored credential strictly inside the Electron main process.
   * Never expose the return value over IPC or to the renderer.
   */
  public getDecryptedApiKey(provider: AIProviderName): string | null {
    if (!this.isEncryptionAvailable()) {
      throw new CredentialStoreError(
        "ENCRYPTION_UNAVAILABLE",
        "OS-backed credential encryption is unavailable on this system."
      );
    }

    const { data, corrupt } = this.readFileSafe();
    if (corrupt) {
      throw new CredentialStoreError(
        "CREDENTIAL_CORRUPT",
        "Stored credential file is corrupted. Please remove and re-enter your API key."
      );
    }

    const entry = data.providers[provider];
    if (!entry) {
      return null;
    }

    try {
      const buffer = Buffer.from(entry.encryptedBase64, "base64");
      const decrypted = this.storage.decryptString(buffer);
      if (!decrypted || decrypted.trim().length === 0) {
        throw new Error("Empty decrypted credential");
      }
      return decrypted;
    } catch {
      throw new CredentialStoreError(
        "CREDENTIAL_DECRYPT_FAILED",
        "Could not decrypt stored credential. Please remove and re-enter your API key."
      );
    }
  }

  public clearApiKey(provider: AIProviderName): void {
    const { data, corrupt } = this.readFileSafe();
    if (corrupt) {
      try {
        if (fs.existsSync(this.filePath)) {
          fs.unlinkSync(this.filePath);
        }
      } catch {
        // Ignore cleanup failure
      }
      return;
    }

    delete data.providers[provider];
    if (Object.keys(data.providers).length === 0) {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      return;
    }

    this.writeFileAtomic(data);
  }
}
