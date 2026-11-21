export const DEFAULT_IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".vite",
  ".cache"
] as const;

export const SECRET_FILE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "id_rsa",
  "id_ed25519"
] as const;

export const SUPPORTED_EXTENSIONS = {
  javascript: [".js", ".mjs", ".cjs"],
  jsx: [".jsx"],
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  json: [".json"],
  css: [".css"],
  scss: [".scss"],
  html: [".html"],
  markdown: [".md"]
} as const;

export const APP_CONSTANTS = {
  APP_NAME: "CodeMind",
  API_PREFIX: "/api/v1",
  DEFAULT_CONTEXT_BYTES: 128 * 1024,
  MAX_CONTEXT_BYTES: 256 * 1024,
  DEFAULT_PER_FILE_MAX_BYTES: 10 * 1024
} as const;
