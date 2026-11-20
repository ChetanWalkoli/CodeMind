export type EditorLanguageId =
  | "typescript"
  | "javascript"
  | "json"
  | "css"
  | "scss"
  | "html"
  | "markdown"
  | "python"
  | "java"
  | "sql"
  | "plaintext";

export interface DetectedLanguage {
  monacoId: EditorLanguageId;
  label: string;
}

const EXTENSION_MAP: Record<string, DetectedLanguage> = {
  ".ts": { monacoId: "typescript", label: "TypeScript" },
  ".mts": { monacoId: "typescript", label: "TypeScript" },
  ".cts": { monacoId: "typescript", label: "TypeScript" },
  ".tsx": { monacoId: "typescript", label: "TypeScript JSX" },
  ".js": { monacoId: "javascript", label: "JavaScript" },
  ".mjs": { monacoId: "javascript", label: "JavaScript" },
  ".cjs": { monacoId: "javascript", label: "JavaScript" },
  ".jsx": { monacoId: "javascript", label: "JavaScript JSX" },
  ".json": { monacoId: "json", label: "JSON" },
  ".css": { monacoId: "css", label: "CSS" },
  ".scss": { monacoId: "scss", label: "SCSS" },
  ".html": { monacoId: "html", label: "HTML" },
  ".htm": { monacoId: "html", label: "HTML" },
  ".md": { monacoId: "markdown", label: "Markdown" },
  ".markdown": { monacoId: "markdown", label: "Markdown" },
  ".py": { monacoId: "python", label: "Python" },
  ".java": { monacoId: "java", label: "Java" },
  ".sql": { monacoId: "sql", label: "SQL" },
  ".txt": { monacoId: "plaintext", label: "Plain Text" }
};

export function detectEditorLanguage(fileName: string): DetectedLanguage {
  const normalized = fileName.trim().toLowerCase();
  const lastDotIndex = normalized.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return { monacoId: "plaintext", label: "Plain Text" };
  }

  const ext = normalized.slice(lastDotIndex);
  return EXTENSION_MAP[ext] ?? { monacoId: "plaintext", label: "Plain Text" };
}
