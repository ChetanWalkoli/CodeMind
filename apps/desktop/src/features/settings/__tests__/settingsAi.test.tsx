import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIConfigStatus, CodeMindDesktopAPI } from "@codemind/shared";
import { SettingsPanel } from "../SettingsPanel";

function createBridgeForAI(initialConfig: AIConfigStatus): {
  bridge: CodeMindDesktopAPI;
  mocks: {
    getAIConfig: ReturnType<typeof vi.fn>;
    setAIApiKey: ReturnType<typeof vi.fn>;
    clearAIApiKey: ReturnType<typeof vi.fn>;
    setAIModel: ReturnType<typeof vi.fn>;
    validateAIApiKey: ReturnType<typeof vi.fn>;
  };
} {
  let state = { ...initialConfig };

  const getAIConfig = vi.fn().mockImplementation(async () => ({
    ok: true as const,
    data: { ...state }
  }));

  const setAIApiKey = vi.fn().mockImplementation(async () => {
    state = {
      ...state,
      hasApiKey: true,
      maskedKeyHint: "AIza...ABCD",
      credentialCorrupt: false,
      statusError: null
    };
    return { ok: true as const, data: { ...state } };
  });

  const clearAIApiKey = vi.fn().mockImplementation(async () => {
    state = {
      ...state,
      hasApiKey: false,
      maskedKeyHint: null,
      credentialCorrupt: false,
      statusError: null
    };
    return { ok: true as const, data: { ...state } };
  });

  const setAIModel = vi.fn().mockImplementation(async (req: { model: string }) => {
    state = {
      ...state,
      model: req.model
    };
    return { ok: true as const, data: { ...state } };
  });

  const validateAIApiKey = vi.fn().mockResolvedValue({
    ok: true as const,
    data: { valid: true, status: "valid", message: "Google Gemini API key verified successfully." }
  });

  const bridge = {
    getAIConfig,
    setAIApiKey,
    clearAIApiKey,
    setAIModel,
    validateAIApiKey,
    getAIUsageSummary: vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        totalRequests: 2,
        succeededRequests: 1,
        failedRequests: 0,
        cancelledRequests: 1,
        providerReportedInputTokens: 250,
        providerReportedOutputTokens: 80,
        estimatedInputTokens: 0,
        averageDurationMs: 420,
        estimatedCostUsd: null,
        recentRequests: []
      }
    })
  } as unknown as CodeMindDesktopAPI;

  return {
    bridge,
    mocks: { getAIConfig, setAIApiKey, clearAIApiKey, setAIModel, validateAIApiKey }
  };
}

describe("SettingsPanel — Google Gemini Configuration", () => {
  afterEach(() => {
    delete window.codemindDesktop;
  });

  it("saves, validates, switches model, and removes a Gemini API key without displaying the raw key", async () => {
    const { bridge, mocks } = createBridgeForAI({
      provider: "gemini",
      model: "gemini-3.8-flash",
      availableModels: [
        {
          id: "gemini-3.8-flash",
          displayName: "Gemini 2.5 Flash",
          contextWindowTokens: 1_048_576,
          maxOutputTokens: 65_536,
          freeTierAvailable: true,
          lifecycleStatus: "active"
        },
        {
          id: "gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          contextWindowTokens: 1_048_576,
          maxOutputTokens: 65_536,
          freeTierAvailable: true,
          lifecycleStatus: "active"
        }
      ],
      hasApiKey: false,
      maskedKeyHint: null,
      encryptionAvailable: true,
      credentialCorrupt: false,
      statusError: null
    });
    window.codemindDesktop = bridge;

    const user = userEvent.setup();
    render(<SettingsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("ai-key-status")).toHaveTextContent("Not configured");
      expect(screen.getByTestId("gemini-free-tier-notice")).toBeInTheDocument();
      expect(screen.getByTestId("ai-usage-section")).toBeInTheDocument();
    });

    const rawKey = "AIzaSySecretValue9876543210ABCD";
    const keyInput = screen.getByLabelText("Gemini API key");
    await user.type(keyInput, rawKey);
    await user.click(screen.getByRole("button", { name: "Save Key" }));

    await waitFor(() => {
      expect(mocks.setAIApiKey).toHaveBeenCalledWith({
        provider: "gemini",
        apiKey: rawKey
      });
      expect(screen.getByTestId("ai-key-status")).toHaveTextContent("Configured (AIza...ABCD)");
    });

    expect(keyInput).toHaveValue("");
    expect(document.body.textContent).not.toContain(rawKey);

    await user.click(screen.getByRole("button", { name: "Validate Key" }));
    await waitFor(() => {
      expect(mocks.validateAIApiKey).toHaveBeenCalledWith({ provider: "gemini" });
      expect(screen.getByTestId("ai-settings-feedback")).toHaveTextContent(
        "Google Gemini API key verified successfully."
      );
    });

    await user.selectOptions(screen.getByLabelText("AI Model"), "gemini-2.5-pro");
    await waitFor(() => {
      expect(mocks.setAIModel).toHaveBeenCalledWith({
        provider: "gemini",
        model: "gemini-2.5-pro"
      });
      expect(screen.getByLabelText("AI Model")).toHaveValue("gemini-2.5-pro");
    });

    await user.click(screen.getByRole("button", { name: "Remove Key" }));
    await waitFor(() => {
      expect(mocks.clearAIApiKey).toHaveBeenCalledWith({ provider: "gemini" });
      expect(screen.getByTestId("ai-key-status")).toHaveTextContent("Not configured");
    });
  });

  it("displays an alert and disables key input when OS encryption is unavailable", async () => {
    const { bridge } = createBridgeForAI({
      provider: "gemini",
      model: "gemini-3.8-flash",
      availableModels: [{ id: "gemini-3.8-flash", displayName: "Gemini 2.5 Flash" }],
      hasApiKey: false,
      maskedKeyHint: null,
      encryptionAvailable: false,
      credentialCorrupt: false,
      statusError: null
    });
    window.codemindDesktop = bridge;

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("ai-encryption-warning")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Gemini API key")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Key" })).toBeDisabled();
  });

  it("requires explicit reset when stored credentials are corrupted before allowing a new key", async () => {
    const { bridge, mocks } = createBridgeForAI({
      provider: "gemini",
      model: "gemini-3.8-flash",
      availableModels: [{ id: "gemini-3.8-flash", displayName: "Gemini 2.5 Flash" }],
      hasApiKey: false,
      maskedKeyHint: null,
      encryptionAvailable: true,
      credentialCorrupt: true,
      statusError:
        "Stored credential file is corrupted. Reset stored credentials before saving a new API key."
    });
    window.codemindDesktop = bridge;

    const user = userEvent.setup();
    render(<SettingsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("ai-encryption-warning")).toHaveTextContent(/corrupted/i);
    });

    expect(screen.getByLabelText("Gemini API key")).toBeDisabled();
    const resetBtn = screen.getByRole("button", { name: "Reset Credentials" });
    expect(resetBtn).toBeEnabled();

    await user.click(resetBtn);
    await waitFor(() => {
      expect(mocks.clearAIApiKey).toHaveBeenCalledWith({ provider: "gemini" });
      expect(screen.getByLabelText("Gemini API key")).toBeEnabled();
    });
  });
});
