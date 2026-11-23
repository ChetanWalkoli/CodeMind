import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { useEditorStore } from "../../stores/editor.store";
import { useLayoutStore } from "../../stores/layout.store";
import { useThemeStore } from "../../stores/theme.store";
import { useWorkspaceStore } from "../../stores/workspace.store";

vi.mock("../../components/editor/monacoSetup", () => ({
  ensureMonacoConfigured: vi.fn()
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    language,
    theme,
    onChange
  }: {
    value?: string;
    language?: string;
    theme?: string;
    onChange?: (val: string) => void;
  }) => (
    <textarea
      data-testid="mock-monaco-textarea"
      data-language={language}
      data-theme={theme}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}));

describe("CodeMind Desktop App integration", () => {
  beforeEach(() => {
    useEditorStore.getState().resetToInitial();
    useLayoutStore.getState().resetLayout();
    useWorkspaceStore.setState({
      activeNav: "explorer",
      activeBottomTab: "problems",
      centerView: "editor"
    });
    useThemeStore.setState({ theme: "dark", initialized: false });
    window.localStorage.clear();
  });

  it("renders the IDE workbench with explorer empty state, editor, panels, and status bar", async () => {
    render(<App />);

    expect(screen.getByText("CodeMind")).toBeInTheDocument();
    expect(
      screen.getByText(/Open a project to begin exploring your codebase/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("mock-monaco-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-right-panel")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-bottom-panel")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("status-readiness")).toHaveTextContent(/Ready/i);
    });
  });

  it("switches activity bar sections and toggles panels", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Intent Mode" }));
    expect(screen.getByTestId("intent-workspace-empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Decision Memory" }));
    expect(screen.getByTestId("decision-workspace-empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change Impact" }));
    expect(screen.getByTestId("impact-workspace-empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse right panel" }));
    expect(screen.queryByTestId("workbench-right-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Toggle right panel" }));
    expect(screen.getByTestId("workbench-right-panel")).toBeInTheDocument();
  });

  it("tracks unsaved changes and guards closing dirty tabs", async () => {
    const user = userEvent.setup();
    render(<App />);

    const textarea = screen.getByTestId("mock-monaco-textarea");
    await user.type(textarea, "\nconst modified = true;");

    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByTestId("status-file")).toHaveTextContent("welcome.ts (Modified)");

    await user.click(screen.getByRole("button", { name: "Close welcome.ts" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Discard & Close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("status-file")).toHaveTextContent("ExamplePanel.tsx");
  });

  it("switches themes and synchronizes Monaco theme and document data-theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(screen.getByTestId("mock-monaco-textarea")).toHaveAttribute(
        "data-theme",
        "codemind-light"
      );
    });
  });

  it("confirms renderer has no unrestricted Node.js APIs exposed on window", () => {
    render(<App />);
    const win = window as unknown as Record<string, unknown>;
    expect(win.require).toBeUndefined();
    expect(win.ipcRenderer).toBeUndefined();
  });
});
