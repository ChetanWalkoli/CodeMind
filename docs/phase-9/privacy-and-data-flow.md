# Phase 9 — Privacy, Security & Data Flow

## Core Security Boundaries Preserved

- **Electron Sandbox**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Narrow Preload Bridge**: Frozen `CodeMindDesktopAPI` with allowlisted IPC channels (`APPROVED_IPC_CHANNELS`) and Zod validation on every request.
- **Workspace Containment**: `WorkspaceAuthority` blocks unauthorized roots, path traversal (`..`), and symlink escapes; `CodeEngineIgnore` excludes `.gitignore`d and default-ignored directories.
- **Secret Protection**: `.env*`, `*.pem`, `*.key`, `secrets*`, `credentials*`, and `id_rsa` are blocked from AI context, Change Impact, Git Diff, and Activity records.
- **Gemini Credentials**: Encrypted via OS `safeStorage` in `CredentialStore`; never sent to the renderer or stored in `preferences.json`.
- **Explicit User Approval**:
  - No source code is sent to Google Gemini without an approved context snapshot (`SecureTransmissionGate`).
  - No patch is written to disk without explicit transaction approval (`PatchApplicationEngine`).
  - No shell command is executed without explicit per-command approval (`VerificationEngine`).
- **Cloud Sync**: Disabled by default (`cloudSyncEnabled: false`). No source code, decisions, impact reports, workspace paths, or activity events are uploaded.
- **Redacted Diagnostics**: `DIAGNOSTICS_GET` exports only runtime versions, workspace basename (never full path), item counts, AI configured boolean/model (never keys), and redacted error categories.
