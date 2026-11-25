# Phase 9 — Settings & Configuration (Milestones 9.5 & 9.6)

## Global vs. Workspace Settings

- **Global (`<userData>/preferences.json`, Zod-validated via `PreferencesStore`)**:
  - `theme`: `"dark" | "light"`
  - `aiSettings`: `{ provider: "gemini", model }` (Gemini-only; automatically migrates retired `gemini-2.5-*` defaults)
  - `appPreferences` (`APP_PREFERENCES_SCHEMA_VERSION = 1`):
    - `editorFontSize` (10–24, default `13`)
    - `reopenLastWorkspace` (boolean, default `true`)
    - `onboardingCompleted` (boolean, default `false`)
    - `confirmBeforePatchApply` (immutable `true`)
    - `confirmBeforeCommandRun` (immutable `true`)
- **Workspace-Scoped (`workspaceSession.customExcludes` + `.gitignore`)**:
  - Custom ignore patterns enforced across Explorer, Code Engine indexing, AI Context Builder, and Change Impact analysis.
- **Encrypted Credentials (`<userData>/credentials/`, OS `safeStorage`)**:
  - Stored strictly separate from `preferences.json`; never readable in plaintext from renderer or diagnostics.
