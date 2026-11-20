/// <reference types="vite/client" />

import type { CodeMindDesktopAPI } from "@codemind/shared";

declare global {
  interface Window {
    codemindDesktop?: CodeMindDesktopAPI;
  }
}
