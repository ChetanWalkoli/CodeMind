# Phase 9 — Cross-Feature Workflows (Milestone 9.3)

| Workflow                          | Trigger                                                 | Data Passed                                           | Safety Gate                                                                             |
| :-------------------------------- | :------------------------------------------------------ | :---------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| **A. Understand → Improve**       | `ArchitectureInspector` → **Improve in Intent Mode**    | Workspace root + selected file path                   | Fresh context preview & explicit Gemini approval required before transmission.          |
| **B. Improve → Remember**         | `IntentWorkspace` → **Capture Draft Decision**          | Intent session ID, files, patch, verification results | Always creates a `proposed` draft decision; developer must explicitly confirm/accept.   |
| **C. Improve → Predict**          | `IntentWorkspace` Stage 6 → **Check Change Impact**     | Patch `targetFile`, `beforeContent`, `afterContent`   | Optional pre-apply check; explicitly states when not run; never auto-applies patches.   |
| **D. Remember → Predict**         | `ImpactManager` + `ImpactWorkspace` → **Open Decision** | Related Phase 7 decisions (read-only)                 | Never mutates decisions automatically; links straight to authoritative decision record. |
| **E. Predict → Improve**          | `ImpactWorkspace` → **Create Intent Task**              | Impact risk summary + affected targets                | Fresh context preview & explicit Gemini approval required before transmission.          |
| **F. Shared Evidence Navigation** | `navigateToEvidence()` across pillars                   | Workspace root, file path, line                       | Validates active workspace match before opening in Monaco.                              |
