import {
  AIProviderError,
  AIProviderRegistry,
  GeminiProvider,
  type AIProvider
} from "@codemind/ai-core";
import type { AIProviderName } from "@codemind/shared";
import { CredentialStoreError, type CredentialStore } from "./credentialStore.js";

export type ProviderFactoryFn = (provider: AIProviderName, apiKey: string) => AIProvider;

function defaultProviderFactory(provider: AIProviderName, apiKey: string): AIProvider {
  if (provider === "gemini") {
    return new GeminiProvider({ apiKey });
  }
  throw new AIProviderError("INVALID_CONFIG", `Unsupported AI provider: ${String(provider)}`, {
    provider: String(provider),
    retryable: false
  });
}

/**
 * Electron main-process AI provider lifecycle manager.
 * Lazily instantiates and caches GeminiProvider instances from encrypted credentials,
 * and invalidates cached instances whenever credentials are replaced, removed,
 * or OS encryption becomes unavailable.
 */
export class AIProviderManager {
  private readonly credentials: CredentialStore;
  private readonly registry = new AIProviderRegistry();
  private readonly factory: ProviderFactoryFn;

  constructor(credentials: CredentialStore, factory: ProviderFactoryFn = defaultProviderFactory) {
    this.credentials = credentials;
    this.factory = factory;
  }

  public getProvider(provider: AIProviderName): AIProvider {
    if (!this.credentials.isEncryptionAvailable()) {
      this.invalidate(provider);
      throw new CredentialStoreError(
        "ENCRYPTION_UNAVAILABLE",
        "OS-backed credential encryption is unavailable on this system."
      );
    }

    if (this.registry.has(provider)) {
      return this.registry.get(provider);
    }

    let decryptedKey: string | null = null;
    try {
      decryptedKey = this.credentials.getDecryptedApiKey(provider);
      if (!decryptedKey) {
        throw new CredentialStoreError(
          "NO_API_KEY",
          `No API key is configured for provider "${provider}".`
        );
      }

      const instance = this.factory(provider, decryptedKey);
      this.registry.register(instance, { setAsDefault: true });
      return instance;
    } finally {
      decryptedKey = null;
      void decryptedKey;
    }
  }

  public invalidate(provider?: AIProviderName): void {
    if (provider) {
      this.registry.unregister(provider);
      return;
    }
    for (const id of this.registry.list()) {
      this.registry.unregister(id);
    }
  }

  public hasCachedProvider(provider: AIProviderName): boolean {
    return this.registry.has(provider);
  }
}
