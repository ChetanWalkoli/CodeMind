import { AIProviderError } from "../errors/aiError.js";
import type { AIProvider, AIProviderId } from "../types/ai.types.js";

/**
 * Registry decoupling application features from concrete AI provider implementations.
 */
export class AIProviderRegistry {
  private readonly providers = new Map<AIProviderId, AIProvider>();
  private defaultProviderId: AIProviderId | null = null;

  public register(provider: AIProvider, options?: { setAsDefault?: boolean }): void {
    this.providers.set(provider.id, provider);
    if (options?.setAsDefault || this.defaultProviderId === null) {
      this.defaultProviderId = provider.id;
    }
  }

  public unregister(id: AIProviderId): boolean {
    const removed = this.providers.delete(id);
    if (removed && this.defaultProviderId === id) {
      const next = this.providers.keys().next();
      this.defaultProviderId = next.done ? null : next.value;
    }
    return removed;
  }

  public has(id: AIProviderId): boolean {
    return this.providers.has(id);
  }

  public get(id: AIProviderId): AIProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new AIProviderError("INVALID_CONFIG", `AI provider "${id}" is not registered.`, {
        provider: id,
        retryable: false
      });
    }
    return provider;
  }

  public getDefault(): AIProvider {
    if (!this.defaultProviderId) {
      throw new AIProviderError("INVALID_CONFIG", "No AI provider is currently registered.", {
        retryable: false
      });
    }
    return this.get(this.defaultProviderId);
  }

  public setDefault(id: AIProviderId): void {
    if (!this.providers.has(id)) {
      throw new AIProviderError(
        "INVALID_CONFIG",
        `Cannot set default: provider "${id}" is not registered.`,
        {
          provider: id,
          retryable: false
        }
      );
    }
    this.defaultProviderId = id;
  }

  public list(): AIProviderId[] {
    return Array.from(this.providers.keys());
  }
}
