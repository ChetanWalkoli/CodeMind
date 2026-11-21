import {
  DEFAULT_MODEL_BY_PROVIDER,
  getModelConfig,
  listModelsForProvider,
  mapHttpStatusToAIError,
  normalizeProviderError,
  redactSecrets
} from "@codemind/ai-core";
import {
  AIClearKeyRequestSchema,
  AIConfigStatusSchema,
  AISetKeyRequestSchema,
  AISetModelRequestSchema,
  AIValidateKeyRequestSchema,
  AIValidateKeyResultSchema,
  type AIConfigStatus,
  type AIKeyValidationStatus,
  type AIProviderName,
  type AIValidateKeyResult,
  type IpcResponse
} from "@codemind/shared";
import { CredentialStoreError, type CredentialStore } from "../../ai/credentialStore.js";
import type { AIProviderManager } from "../../ai/providerManager.js";
import type { PreferencesStore } from "../../utils/preferences.js";

export type KeyValidatorFn = (
  provider: AIProviderName,
  apiKey: string
) => Promise<AIValidateKeyResult>;

export interface ValidateGeminiKeyOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function sanitizeMessage(message: string, candidateKey?: string | null): string {
  let safe = redactSecrets(message);
  if (candidateKey && candidateKey.trim().length > 0) {
    safe = safe.split(candidateKey.trim()).join("[REDACTED]");
  }
  return safe;
}

function mapAIErrorCodeToValidationStatus(code: string): AIKeyValidationStatus {
  switch (code) {
    case "AUTH_ERROR":
      return "auth_failed";
    case "RATE_LIMITED":
      return "rate_limited";
    case "TIMEOUT":
      return "timeout";
    case "NETWORK_ERROR":
      return "network_error";
    default:
      return "provider_error";
  }
}

/**
 * Validates a Google Gemini API key via the official Gemini Developer API models endpoint
 * using the `x-goog-api-key` header (never exposing the key in query parameters).
 */
export async function validateGeminiKey(
  provider: AIProviderName,
  apiKey: string,
  options: ValidateGeminiKeyOptions = {}
): Promise<AIValidateKeyResult> {
  if (provider !== "gemini") {
    return {
      valid: false,
      status: "provider_error",
      message: `Unsupported provider: ${provider}`
    };
  }

  const fetchImpl = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models", {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey
      },
      signal: controller.signal
    });

    if (response.ok) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        return {
          valid: false,
          status: "provider_error",
          message: "Received an unexpected non-JSON response while validating the Gemini API key."
        };
      }

      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as { models?: unknown }).models)
      ) {
        return {
          valid: false,
          status: "provider_error",
          message: "Gemini validation response did not contain the expected model catalog payload."
        };
      }

      return {
        valid: true,
        status: "valid",
        message: "Google Gemini API key verified successfully."
      };
    }

    const bodyText = await response.text().catch(() => "");
    // Gemini often returns HTTP 400 with API_KEY_INVALID for malformed/revoked API keys
    if (response.status === 400 && /API_KEY_INVALID|invalid api key/i.test(bodyText)) {
      return {
        valid: false,
        status: "auth_failed",
        message: sanitizeMessage(`Authentication failed (400): ${bodyText}`, apiKey)
      };
    }

    const normalized = mapHttpStatusToAIError(response.status, bodyText, "gemini");
    return {
      valid: false,
      status: mapAIErrorCodeToValidationStatus(normalized.code),
      message: sanitizeMessage(normalized.message, apiKey)
    };
  } catch (err) {
    if (timedOut) {
      return {
        valid: false,
        status: "timeout",
        message:
          "Validation request timed out while contacting Google Gemini. Check your network connection and try again."
      };
    }

    const normalized = normalizeProviderError(err, "gemini");
    return {
      valid: false,
      status: mapAIErrorCodeToValidationStatus(normalized.code),
      message: sanitizeMessage(normalized.message, apiKey)
    };
  } finally {
    clearTimeout(timer);
  }
}

function toSafeError<T>(
  err: unknown,
  fallbackCode: string,
  candidateKey?: string | null
): IpcResponse<T> {
  if (err instanceof CredentialStoreError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: sanitizeMessage(err.message, candidateKey)
      }
    };
  }

  const rawMsg = err instanceof Error ? err.message : "AI configuration operation failed.";
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: sanitizeMessage(rawMsg, candidateKey)
    }
  };
}

export function createAIConfigHandlers(deps: {
  credentials: CredentialStore;
  preferences: PreferencesStore;
  providerManager?: AIProviderManager;
  onCredentialsChanged?: (provider: AIProviderName, reason: string) => void;
  validateKeyFn?: KeyValidatorFn;
}) {
  const validateKeyFn = deps.validateKeyFn ?? validateGeminiKey;

  // Safely purge any legacy non-Gemini provider credentials on startup without exposing them
  deps.credentials.purgeUnsupportedProviders(["gemini"]);

  const buildStatus = (): AIConfigStatus => {
    const aiPrefs = deps.preferences.getAISettings();
    const credStatus = deps.credentials.getStatus(aiPrefs.provider);
    const availableModels = listModelsForProvider(aiPrefs.provider).map((m) => ({
      id: m.id,
      displayName: m.displayName,
      contextWindowTokens: m.contextWindowTokens,
      maxOutputTokens: m.maxOutputTokens,
      freeTierAvailable: m.freeTierAvailable,
      lifecycleStatus: m.lifecycleStatus
    }));

    const validModel = getModelConfig(aiPrefs.model);
    const effectiveModel =
      validModel && validModel.provider === aiPrefs.provider
        ? validModel.id
        : DEFAULT_MODEL_BY_PROVIDER[aiPrefs.provider];

    return AIConfigStatusSchema.parse({
      provider: aiPrefs.provider,
      model: effectiveModel,
      availableModels,
      hasApiKey: credStatus.hasApiKey,
      maskedKeyHint: credStatus.maskedKeyHint,
      encryptionAvailable: credStatus.encryptionAvailable,
      credentialCorrupt: credStatus.credentialCorrupt,
      statusError: credStatus.statusError
    });
  };

  return {
    getConfig(): IpcResponse<AIConfigStatus> {
      try {
        return { ok: true, data: buildStatus() };
      } catch (err) {
        return toSafeError(err, "AI_CONFIG_READ_FAILED");
      }
    },

    setApiKey(payload: unknown): IpcResponse<AIConfigStatus> {
      const parsed = AISetKeyRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      let keyBuffer: string | null = parsed.data.apiKey;
      try {
        deps.credentials.setApiKey(parsed.data.provider, keyBuffer);
        deps.providerManager?.invalidate(parsed.data.provider);
        deps.onCredentialsChanged?.(parsed.data.provider, "API credentials were updated.");
        return { ok: true, data: buildStatus() };
      } catch (err) {
        return toSafeError(err, "AI_KEY_SAVE_FAILED", keyBuffer);
      } finally {
        keyBuffer = null;
        void keyBuffer;
      }
    },

    clearApiKey(payload: unknown): IpcResponse<AIConfigStatus> {
      const parsed = AIClearKeyRequestSchema.safeParse(payload ?? {});
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
        deps.credentials.clearApiKey(parsed.data.provider);
        deps.providerManager?.invalidate(parsed.data.provider);
        deps.onCredentialsChanged?.(parsed.data.provider, "API credentials were removed.");
        return { ok: true, data: buildStatus() };
      } catch (err) {
        return toSafeError(err, "AI_KEY_CLEAR_FAILED");
      }
    },

    setModel(payload: unknown): IpcResponse<AIConfigStatus> {
      const parsed = AISetModelRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      const modelConfig = getModelConfig(parsed.data.model);
      if (!modelConfig || modelConfig.provider !== parsed.data.provider) {
        return {
          ok: false,
          error: {
            code: "INVALID_MODEL",
            message: `Model "${parsed.data.model}" is not supported for provider "${parsed.data.provider}".`
          }
        };
      }

      try {
        deps.preferences.saveAISettings({
          provider: parsed.data.provider,
          model: modelConfig.id
        });
        return { ok: true, data: buildStatus() };
      } catch (err) {
        return toSafeError(err, "AI_MODEL_SAVE_FAILED");
      }
    },

    async validateApiKey(payload: unknown): Promise<IpcResponse<AIValidateKeyResult>> {
      const parsed = AIValidateKeyRequestSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      let candidateKey: string | null = null;
      try {
        candidateKey =
          parsed.data.apiKey ?? deps.credentials.getDecryptedApiKey(parsed.data.provider);

        if (!candidateKey) {
          return {
            ok: true,
            data: AIValidateKeyResultSchema.parse({
              valid: false,
              status: "not_configured",
              message: "No Gemini API key is configured."
            })
          };
        }

        const result = await validateKeyFn(parsed.data.provider, candidateKey);
        return {
          ok: true,
          data: AIValidateKeyResultSchema.parse({
            valid: result.valid,
            status: result.status,
            message: sanitizeMessage(result.message, candidateKey)
          })
        };
      } catch (err) {
        return toSafeError(err, "AI_KEY_VALIDATE_FAILED", candidateKey);
      } finally {
        candidateKey = null;
        void candidateKey;
      }
    }
  };
}
