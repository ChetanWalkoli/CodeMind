# Phase 9 — Product Architecture & Integration Audit (Milestone 9.1)

**Date:** 2026-11-23  
**Branch:** `main` (HEAD `c890465` — Phase 8 completed)  
**Scope:** Complete pre-implementation audit of CodeMind's desktop shell, four core intelligence pillars, IPC layer, state management, persistence, and infrastructure readiness.

---

## 1. Existing Architecture Overview

CodeMind is a pnpm monorepo with 8 workspace packages:

- `packages/config` — shared constants, default ignore directories, secret file patterns.
- `packages/shared` — Zod schemas and TypeScript contracts for IPC, Code Engine, AI, Intent Mode, Decision Memory, and Change Impact Intelligence.
- `packages/code-engine` — local TypeScript/JavaScript AST parser, symbol/import/export extractor, dependency graph, search index, and cross-layer API relationship extractor (`ProjectIndexer`).
- `packages/ai-core` — Google Gemini provider (`@google/genai`), token estimator/budgeter, prompt composer, secret redaction, structured output parser, Intent Mode engines, Decision Memory search/conflict/Ask-Why engines, and Change Impact analyzers/risk scorer/validation planner.
- `packages/database` — 6-line placeholder (`DATABASE_SCHEMA_PATH = "prisma/schema.prisma"`); no Prisma client or PostgreSQL driver installed.
- `apps/api` — minimal health-check module (`getHealthStatus()`).
- `apps/website` — static marketing site.
- `apps/desktop` — Electron 45.4.1 main process, strict `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` preload bridge, and React 19 + Vite + SCSS Modules + Monaco + Zustand + `@xyflow/react` workbench.

---

## 2. Existing Feature Boundaries & State Management

| Pillar / Surface           | Main-Process Service                                                                                                           | Renderer Store                                                           | Center View / Sidebar                                          |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- | :------------------------------------------------------------- |
| **Workspace & Editor**     | `WorkspaceAuthority`, `WorkspaceFileService`                                                                                   | `useWorkspaceStore`, `useEditorStore`, `useLayoutStore`, `useThemeStore` | `FileExplorer`, `FileSearchPanel`, `CodeEditor`                |
| **Understand (Phase 3–4)** | `CodeEngineManager` (`ProjectIndexer`), `WorkspaceContextBuilder`, `AIStreamManager`                                           | `useArchitectureStore`, `useAIStore`                                     | `ArchitectureOverviewPanel`, `ArchitectureExplorer`, `AIPanel` |
| **Improve (Phase 6)**      | `IntentOrchestrator`, `InvestigationEngine`, `PatchService`, `PatchApplicationEngine`, `VerificationEngine`, `RecoveryManager` | `useIntentStore`                                                         | `IntentSidebarPanel`, `IntentWorkspace`                        |
| **Remember (Phase 7)**     | `DecisionManager`, `DecisionStore`, `DecisionEvidenceService`, `DecisionGitService`                                            | `useDecisionStore`                                                       | `DecisionSidebarPanel`, `DecisionMemoryWorkspace`              |
| **Predict (Phase 8)**      | `ImpactManager`, `ImpactStore`, `impactGitDiffService`                                                                         | `useImpactStore`                                                         | `ImpactSidebarPanel`, `ImpactWorkspace`, `ImpactGraph`         |
| **Settings (Phase 1/5)**   | `PreferencesStore`, `CredentialStore`, `AIProviderManager`, `AIUsageStore`                                                     | `useThemeStore`, `useEditorStore`, local state in `SettingsPanel`        | `SettingsPanel`                                                |

---

## 3. Confirmed Integration Gaps

1. **Workspace Switching State Leakage (HIGH)**: `useWorkspaceStore.openWorkspacePath` resets `useEditorStore` and `useArchitectureStore`, but does **not** reset `useIntentStore`, `useDecisionStore`, or `useImpactStore`. Switching workspaces could temporarily display the previous workspace's active Intent session, Decision record, or Impact report in the center pane.
2. **Missing Unified Overview Dashboard & Activity History (HIGH)**: Users land on a blank editor or explorer with no workspace-level overview combining indexing stats, Git status, recent decisions, recent impact reports, and recent engineering activity across the 4 pillars.
3. **Disconnected Cross-Feature Workflows (HIGH)**:
   - _Understand → Improve_: No direct action from `ArchitectureExplorer` to launch an Intent Mode task for a selected file/module.
   - _Improve → Predict_: `IntentWorkspace` does not offer pre-apply Change Impact Analysis on the generated patch before explicit approval.
   - _Improve → Remember_: `IntentWorkspace` does not expose a direct "Capture Draft Decision" action wired to `createDecisionFromIntent`.
   - _Remember → Predict_: `ImpactWorkspace` displays related decisions, but lacks one-click navigation into that decision in Decision Memory.
   - _Predict → Improve_: `ImpactWorkspace` has no action to launch an Intent Mode remediation task from impact findings.
   - _Shared Evidence Navigation_: File opening in Monaco is repeated ad-hoc across components rather than routed through one shared evidence navigation contract.
4. **Incomplete Persisted App Settings & Onboarding/Diagnostics (MEDIUM)**:
   - Editor font size, onboarding completion state, and startup behavior are not persisted in `PreferencesStore`.
   - No first-run onboarding walkthrough explaining the 4 pillars, local indexing, and optional Gemini setup.
   - No structured redacted Diagnostics export (`DIAGNOSTICS_GET`) or Security summary panel in Settings.
5. **Local-First Persistence vs. Database Package (INFO)**:
   - All desktop features already persist cleanly in workspace-isolated atomic JSON stores under Electron `userData` (`preferences.json`, `credentials/`, `conversations/`, `usage/`, `intent-sessions/`, `decision-memory/`, `impact-analyses/`).
   - PostgreSQL/Prisma is **not** required for local-first desktop operation; forcing a mandatory DB dependency would violate offline-first resilience.

---

## 4. Security & Privacy Review of Existing Boundaries

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are enforced in `window.ts`.
- Preload bridge exposes only an `Object.freeze`d allowlisted API (`CodeMindDesktopAPI`) validated by Zod schemas in main-process handlers.
- `WorkspaceAuthority` blocks unauthorized roots, `..` traversal, and symlink escapes.
- Gemini API keys are stored encrypted via OS `safeStorage` in `CredentialStore` and never sent to the renderer.
- Patch application and verification command execution require explicit user approval.

---

## 5. Recommended Phase 9 Changes

### Files to Create

- `packages/shared/src/schemas/activity.schema.ts` — Versioned `ActivityEventSchema` (`ACTIVITY_SCHEMA_VERSION = 1`), `AppPreferencesSchema`, and `DiagnosticsSnapshotSchema`.
- `apps/desktop/electron/activity/activityStore.ts` — Local workspace-isolated atomic JSON activity store (max 200 events, zero secrets/source code).
- `apps/desktop/electron/ipc/handlers/activity.handler.ts` — Zod-validated IPC handlers for Activity, App Preferences, and Redacted Diagnostics.
- `apps/desktop/src/services/evidenceNavigation.ts` — Shared evidence navigation contract (Monaco file + line + workspace verification).
- `apps/desktop/src/stores/activity.store.ts` — Zustand store for Activity feed + filters.
- `apps/desktop/src/features/overview/OverviewWorkspace.tsx` & `Overview.module.scss` — Unified Workspace Overview dashboard.
- `apps/desktop/src/features/activity/ActivityWorkspace.tsx`, `ActivitySidebarPanel.tsx`, `Activity.module.scss` — Unified Activity & History views.
- `apps/desktop/src/features/onboarding/OnboardingModal.tsx` & `Onboarding.module.scss` — Skippable first-run onboarding walkthrough.
- `docs/phase-9/` — Architecture, cross-feature workflows, persistence strategy, privacy & data flow, settings, onboarding, testing, and completion report.

### Files to Modify (Targeted Extensions Only)

- `packages/shared/src/index.ts` & `packages/shared/src/schemas/ipc.schema.ts` — Export Phase 9 schemas and add 5 allowlisted IPC channels (`ACTIVITY_LIST`, `ACTIVITY_CLEAR`, `PREFERENCES_GET`, `PREFERENCES_UPDATE`, `DIAGNOSTICS_GET`).
- `apps/desktop/electron/utils/preferences.ts` — Extend `PreferencesFileSchema` with versioned `appPreferences` (`editorFontSize`, `onboardingCompleted`, `reopenLastWorkspace`, `schemaVersion`).
- `apps/desktop/electron/ipc/channels.ts`, `ipc/index.ts`, `main.ts`, `preload.ts`, `desktopApi.ts`, `intentMockStubs.ts` — Wire Phase 9 IPC channels and automatic activity recording hooks.
- `apps/desktop/src/stores/workspace.store.ts` — Add `"overview"` and `"activity"` views + reset `intent`, `decisions`, `impact`, and `activity` stores on workspace switch.
- `apps/desktop/src/components/layout/ActivityBar.tsx`, `Sidebar.tsx`, `Workbench.tsx` — Wire Overview, Activity, and Onboarding into the unified shell.
- `apps/desktop/src/features/architecture/components/ArchitectureExplorer.tsx`, `apps/desktop/src/features/intent/IntentWorkspace.tsx`, `apps/desktop/src/features/impact/ImpactWorkspace.tsx` — Add cross-feature Integrations A–F.
- `apps/desktop/src/features/settings/SettingsPanel.tsx` — Extend with persisted App Preferences, Security summary, and Diagnostics export.

### Files Remaining Unchanged

- All core engines in `packages/code-engine` and `packages/ai-core` (Phases 3–8 engines remain modular and untouched).
- `apps/desktop/electron/ai/*`, `apps/desktop/electron/intent/*`, `apps/desktop/electron/decisions/*`, `apps/desktop/electron/impact/*` core business logic.
