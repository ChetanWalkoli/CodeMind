import { describe, expect, it } from "vitest";
import { detectLanguage, isIgnoredDirectory } from "./index.js";

describe("@codemind/code-engine foundation", () => {
  it("detects supported languages from file extensions", () => {
    expect(detectLanguage("src/App.tsx")).toBe("tsx");
    expect(detectLanguage("src/server.ts")).toBe("typescript");
    expect(detectLanguage("src/legacy.jsx")).toBe("jsx");
    expect(detectLanguage("README.md")).toBe("markdown");
    expect(detectLanguage("binary.bin")).toBe("unknown");
  });

  it("identifies default ignored directories", () => {
    expect(isIgnoredDirectory("node_modules")).toBe(true);
    expect(isIgnoredDirectory(".git")).toBe(true);
    expect(isIgnoredDirectory("src")).toBe(false);
  });
});
