import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import { useEditorStore } from "../../stores/editor.store";
import { useThemeStore } from "../../stores/theme.store";
import { EmptyEditorState } from "./EmptyEditorState";
import { ensureMonacoConfigured } from "./monacoSetup";
import styles from "./CodeEditor.module.scss";

export function CodeEditor() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const pendingNavigation = useEditorStore((s) => s.pendingNavigation);
  const clearPendingNavigation = useEditorStore((s) => s.clearPendingNavigation);
  const settings = useEditorStore((s) => s.settings);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const setCursor = useEditorStore((s) => s.setCursor);
  const theme = useThemeStore((s) => s.theme);

  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    try {
      ensureMonacoConfigured();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to configure Monaco editor.");
    }
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  useEffect(() => {
    if (!pendingNavigation || !activeTab || pendingNavigation.tabId !== activeTab.id) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const { line, column } = pendingNavigation;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column });
    editor.focus();
    clearPendingNavigation();
  }, [pendingNavigation, activeTab, clearPendingNavigation]);

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
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => {
      setCursor({
        line: event.position.lineNumber,
        column: event.position.column
      });
    });

    const nav = useEditorStore.getState().pendingNavigation;
    if (nav && nav.tabId === activeTab.id) {
      editor.revealLineInCenter(nav.line);
      editor.setPosition({ lineNumber: nav.line, column: nav.column });
      clearPendingNavigation();
    }

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
