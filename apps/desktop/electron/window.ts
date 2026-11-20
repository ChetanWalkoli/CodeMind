import { BrowserWindow } from "electron";
import path from "node:path";
import type { ThemePreference } from "@codemind/shared";
import { buildMainWindowOptions } from "./windowConfig.js";

export {
  buildMainWindowOptions,
  getWindowBackgroundColor,
  WINDOW_DEFAULTS
} from "./windowConfig.js";

export interface CreateMainWindowParams {
  preloadPath: string;
  rendererDistPath: string;
  devServerUrl?: string;
  theme: ThemePreference;
}

export function createMainWindow(params: CreateMainWindowParams): BrowserWindow {
  const win = new BrowserWindow(buildMainWindowOptions(params.preloadPath, params.theme));

  win.once("ready-to-show", () => {
    win.show();
  });

  // Prevent arbitrary external popups or navigation hijacking.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.webContents.on("will-navigate", (event, targetUrl) => {
    const allowedDevOrigin = params.devServerUrl ? new URL(params.devServerUrl).origin : null;
    try {
      const parsed = new URL(targetUrl);
      const isAllowedDev = allowedDevOrigin !== null && parsed.origin === allowedDevOrigin;
      const isLocalFile = parsed.protocol === "file:";
      if (!isAllowedDev && !isLocalFile) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(
      `[CodeMind] Renderer failed to load (${errorCode}): ${errorDescription} [${validatedUrl}]`
    );
    const fallbackHtml = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>CodeMind — Load Error</title>
          <style>
            body {
              margin: 0;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              background: #111111;
              color: #ededed;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
            }
            .card {
              max-width: 480px;
              padding: 24px;
              border: 1px solid #2e2e2e;
              border-radius: 8px;
              background: #191919;
            }
            h1 { font-size: 16px; margin: 0 0 8px; }
            p { font-size: 13px; color: #a1a1aa; margin: 0; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>CodeMind could not load the workspace interface</h1>
            <p>Error ${errorCode}: ${errorDescription}. Verify that the renderer build or dev server is available and restart the application.</p>
          </div>
        </body>
      </html>
    `;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
  });

  if (params.devServerUrl) {
    void win.loadURL(params.devServerUrl);
  } else {
    const indexHtml = path.join(params.rendererDistPath, "index.html");
    void win.loadFile(indexHtml);
  }

  return win;
}
