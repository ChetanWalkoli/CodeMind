# Phase 9 — Integrated Product Architecture

CodeMind is organized as a local-first Electron desktop environment connecting four modular intelligence pillars through a narrow, Zod-validated IPC boundary and a shared application context layer:

1. **Application Shell (`ActivityBar`, `Sidebar`, `Workbench`, `OverviewWorkspace`, `ActivityWorkspace`, `OnboardingModal`)**
   - Primary Navigation: Overview, Explorer, Search, Codebase Graph, Intent Mode, Decision Memory, Change Impact.
   - Secondary Navigation: Activity, Settings.
   - Workspace switching (`useWorkspaceStore.openWorkspacePath`) clears and isolates state across `useEditorStore`, `useArchitectureStore`, `useIntentStore`, `useDecisionStore`, `useImpactStore`, and `useActivityStore`.

2. **Shared Cross-Feature Integration Layer (`evidenceNavigation.ts`)**
   - `navigateToEvidence`: verifies active workspace identity, opens file at line in Monaco, switches to editor.
   - `launchIntentFromContext`: launches an Intent Mode session from Architecture or Change Impact while preserving fresh Gemini context approval requirements.
   - `navigateToDecisionRecord`, `navigateToImpactRecord`, `navigateToIntentRecord`: jumps directly to authoritative pillar records from Overview, Impact, or Activity.

3. **Modular Main-Process Engines (Unchanged Core Boundaries)**
   - `CodeEngineManager` (`ProjectIndexer`), `AIProviderManager` (Gemini-only `@google/genai`), `IntentOrchestrator`, `DecisionManager`, `ImpactManager`, `ActivityStore`, `PreferencesStore`, and `WorkspaceAuthority`.
