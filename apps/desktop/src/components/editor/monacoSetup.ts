import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let monacoConfigured = false;

export function ensureMonacoConfigured(): void {
  if (monacoConfigured || typeof window === "undefined") {
    return;
  }

  const globalScope = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker;
    };
  };

  globalScope.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === "json") {
        return new jsonWorker();
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }
      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }
      return new editorWorker();
    }
  };

  loader.config({ monaco });

  monaco.editor.defineTheme("codemind-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#111113",
      "editor.lineHighlightBackground": "#1c1c20",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editorIndentGuide.background1": "#242429",
      "editor.selectionBackground": "#2563eb44"
    }
  });

  monaco.editor.defineTheme("codemind-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f4f4f5",
      "editorLineNumber.foreground": "#a1a1aa",
      "editorLineNumber.activeForeground": "#3f3f46",
      "editorIndentGuide.background1": "#e4e4e7",
      "editor.selectionBackground": "#2563eb2e"
    }
  });

  monacoConfigured = true;
}
