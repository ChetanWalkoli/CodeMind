import { useEffect, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEditorStore } from "../../stores/editor.store";
import { useThemeStore } from "../../stores/theme.store";
import { EmptyEditorState } from "./EmptyEditorState";
import { ensureMonacoConfigured } from "./monacoSetup";
import styles from "./CodeEditor.module.scss";

export function CodeEditor() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const settings = useEditorStore((s) => s.settings);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const setCursor = useEditorStore((s) => s.setCursor);
  const theme = useThemeStore((s) => s.theme);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    try {
      ensureMonacoConfigured();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to configure Monaco editor.");
    }
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  if (!activeTab) {
    return <EmptyEditorState />;
  }

  if (loadError) {
    return (
      <div className={styles.statusOverlay} role="alert">
        Monaco editor failed to initialize: {loadError}
      </div>
    );
  }

  const handleMount: OnMount = (editor) => {
    editor.onDidChangeCursorPosition((event) => {
      setCursor({
        line: event.position.lineNumber,
        column: event.position.column
      });
    });
    editor.focus();
  };

  return (
    <div className={styles.editorWrapper} data-testid="monaco-editor-container">
      <Editor
        path={activeTab.id}
        language={activeTab.language}
        value={activeTab.content}
        theme={theme === "dark" ? "codemind-dark" : "codemind-light"}
        loading={<div className={styles.statusOverlay}>Loading editor...</div>}
        onMount={handleMount}
        onChange={(value) => {
          updateTabContent(activeTab.id, value ?? "");
        }}
        options={{
          automaticLayout: true,
          fontFamily: "var(--font-mono)",
          fontSize: settings.fontSize,
          tabSize: settings.tabSize,
          insertSpaces: true,
          lineNumbers: "on",
          renderLineHighlight: "line",
          minimap: { enabled: settings.minimap },
          wordWrap: settings.wordWrap,
          bracketPairColorization: { enabled: true },
          folding: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          padding: { top: 10, bottom: 10 },
          find: {
            addExtraSpaceOnTop: false
          }
        }}
      />
    </div>
  );
}
