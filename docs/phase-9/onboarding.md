# Phase 9 — Onboarding & Diagnostics (Milestone 9.8)

## First-Run Onboarding (`OnboardingModal.tsx`)

Shown once on first launch when `appPreferences.onboardingCompleted === false`, and reopenable anytime from the Workspace Overview header (**Guide** / **Getting Started Guide**):

1. **Step 1 — Welcome & Four Pillars**: Explains Understand, Improve, Remember, and Predict.
2. **Step 2 — Local-First Workspace & Indexing**: Lets the developer pick a local project folder; explains workspace containment and secret exclusion.
3. **Step 3 — Optional Gemini AI & Explicit Consent**: Explains that Gemini is optional, API keys are OS-encrypted, code is never sent without explicit context approval, and patches/commands never run automatically.

Users can click **Skip** on any step without configuring Gemini.

## Redacted Diagnostics (`DIAGNOSTICS_GET` + `SettingsPanel.tsx`)

Displays runtime versions (App, Electron, Node, Platform), active workspace index scope, local store counts, AI provider readiness, and security posture. Clicking **Copy Redacted Diagnostics JSON** exports a schema-validated JSON payload containing zero API keys, zero source code, and zero full absolute workspace paths.
