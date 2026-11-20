import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

const electronBinary = require("electron");
if (typeof electronBinary !== "string" || electronBinary.length === 0) {
  console.error("[CodeMind] Failed to resolve local Electron executable.");
  process.exit(1);
}

const args = process.argv.slice(2);
const devUrlFlagIndex = args.indexOf("--dev-url");
let devServerUrl = process.env.VITE_DEV_SERVER_URL;
const electronArgs = [];

for (let i = 0; i < args.length; i += 1) {
  if (i === devUrlFlagIndex) {
    devServerUrl = args[i + 1];
    i += 1;
  } else {
    electronArgs.push(args[i]);
  }
}

if (electronArgs.length === 0) {
  electronArgs.push(".");
}

// Build a clean environment without ELECTRON_RUN_AS_NODE so Electron always
// boots in desktop application mode (even when launched from an Electron IDE).
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Explicitly preserve opt-in GPU fallback flag when set by the caller.
if (process.env.CODEMIND_DISABLE_GPU !== undefined) {
  env.CODEMIND_DISABLE_GPU = process.env.CODEMIND_DISABLE_GPU;
}

if (devServerUrl) {
  env.VITE_DEV_SERVER_URL = devServerUrl;
} else {
  delete env.VITE_DEV_SERVER_URL;
}

const child = spawn(electronBinary, electronArgs, {
  cwd: desktopRoot,
  env,
  stdio: "inherit"
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error("[CodeMind] Failed to launch Electron:", error);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
