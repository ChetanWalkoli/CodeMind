import { describe, expect, it } from "vitest";
import { detectEditorLanguage } from "../languageDetection";

describe("detectEditorLanguage", () => {
  it("maps supported file extensions to Monaco languages and labels", () => {
    expect(detectEditorLanguage("App.tsx")).toEqual({
      monacoId: "typescript",
      label: "TypeScript JSX"
    });
    expect(detectEditorLanguage("server.ts")).toEqual({
      monacoId: "typescript",
      label: "TypeScript"
    });
    expect(detectEditorLanguage("index.js")).toEqual({
      monacoId: "javascript",
      label: "JavaScript"
    });
    expect(detectEditorLanguage("Button.jsx")).toEqual({
      monacoId: "javascript",
      label: "JavaScript JSX"
    });
    expect(detectEditorLanguage("package.json")).toEqual({ monacoId: "json", label: "JSON" });
    expect(detectEditorLanguage("styles.css")).toEqual({ monacoId: "css", label: "CSS" });
    expect(detectEditorLanguage("tokens.scss")).toEqual({ monacoId: "scss", label: "SCSS" });
    expect(detectEditorLanguage("index.html")).toEqual({ monacoId: "html", label: "HTML" });
    expect(detectEditorLanguage("README.md")).toEqual({ monacoId: "markdown", label: "Markdown" });
    expect(detectEditorLanguage("script.py")).toEqual({ monacoId: "python", label: "Python" });
    expect(detectEditorLanguage("Main.java")).toEqual({ monacoId: "java", label: "Java" });
    expect(detectEditorLanguage("schema.sql")).toEqual({ monacoId: "sql", label: "SQL" });
    expect(detectEditorLanguage("notes.txt")).toEqual({
      monacoId: "plaintext",
      label: "Plain Text"
    });
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(detectEditorLanguage("Makefile")).toEqual({
      monacoId: "plaintext",
      label: "Plain Text"
    });
    expect(detectEditorLanguage("archive.unknown")).toEqual({
      monacoId: "plaintext",
      label: "Plain Text"
    });
  });
});
