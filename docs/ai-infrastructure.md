# CodeMind — Phase 5 AI Infrastructure

CodeMind's AI infrastructure is a **local-first, provider-independent, security-gated** execution pipeline built to power codebase understanding, Q&A, architecture analysis, change impact intelligence, and future optimization workflows.

## Execution Architecture

```text
React Renderer (ContextPreviewPanel / SettingsPanel)
       │  (Zod-validated, allowlisted IPC — no raw keys, no raw fs)
       ▼
Secure Preload Bridge (contextIsolation: true, sandbox: true)
       │
       ▼
Electron Main Process
  ├── CredentialStore (OS safeStorage; refuses plaintext & basic_text)
  ├── AIProviderManager (lazy cache; invalidated on key change/removal)
  ├── WorkspaceContextBuilder (ProjectIndexer + WorkspaceAuthority + Secret/Ignore filters)
  ├── ContextApprovalStore (SHA-256 snapshot-bound approval + file-save invalidation)
  ├── SecureTransmissionGate (re-verifies approval, realpath/symlinks, SHA-256, inline secrets, budget)
  ├── AIStreamManager (requestId-isolated streaming, cancellation, credential-change abort)
  ├── ConversationStore (local-first userData persistence; metadata & source refs only)
  └── AIUsageStore (privacy-safe token, duration & estimated cost accounting)
       │
       ▼
@codemind/ai-core (Zero Electron/React/Express/Prisma dependencies)
  ├── AIProvider / AIProviderRegistry / GeminiProvider (@google/genai SDK + streaming + retry/backoff)
  ├── Prompt Templates (versioned) + Untrusted Content Injection Boundaries
  ├── HeuristicTokenEstimator (heuristic-code-v2) + budgetContextForModel()
  ├── Inline Secret Scanner (detectInlineSecrets)
  ├── Structured Response Parser + Zod Validation + Source Reference Validator
  └── AIRateLimiter + Model Pricing Estimator (no fabricated billing)
```

## Security Guarantees

1. **OS-Backed Credential Storage**: API keys are encrypted via Electron `safeStorage` and stored in `userData/ai-credentials.enc.json` (`0o600`, atomic write). Plaintext fallback and Linux `basic_text` backends are refused. Raw keys are never returned over IPC or stored in `localStorage`/`sessionStorage`.
2. **Explicit Snapshot-Bound Context Approval**: Context preview is strictly local and never invokes an AI provider. Approval is bound to the exact SHA-256 `snapshotId` (workspace, task, template version, query, and included file hashes/ranges).
3. **Mandatory SecureTransmissionGate**: Immediately before every AI request, the main process verifies approval status/expiry, re-checks ignore/secret rules, verifies canonical paths and symlink containment inside the authorized workspace, re-reads files to verify exact SHA-256 hashes, re-scans for inline secrets, and verifies that the final model token budget matches the approved preview (rejecting with `CONTEXT_BUDGET_CHANGED` rather than silently omitting approved context).
4. **Prompt Injection Boundaries**: Repository files are isolated inside `<untrusted_repository_context>` / `<untrusted_repository_file>` tags with breakout-tag escaping and explicit untrusted-data instructions.
5. **Verified Source References**: Structured AI responses are parsed safely (no `eval`/`new Function`), validated against allowlisted Zod schemas, and checked so every cited `filePath` and line range exists within the approved context snapshot.
6. **Cancellation & Credential Lifecycle**: Renderer-initiated `AI_STREAM_CANCEL` aborts the exact `requestId`'s `AbortController`. Replacing or removing API credentials invalidates cached providers and cancels all active streams for that provider.

## Token Budgeting & Cost Estimation

- Model limits (`contextWindowTokens`, `maxOutputTokens`) are centralized in `packages/ai-core/src/models/catalog.ts`.
- `HeuristicTokenEstimator` (`heuristic-code-v2`, `isExact: false`) conservatively estimates code-heavy inputs using the maximum of character-density (`2.8` chars/token for code, `3.4` for prose) and lexeme-boundary counts, plus chat-framing overhead.
- `budgetContextForModel()` verifies the **complete composed provider request** fits within `contextWindowTokens - reservedOutputTokens - safetyMarginTokens`, prioritizing mandatory instructions and user query, then ranked source context with $O(\log N)$ whole-line-boundary truncation.
- Cost estimates (`estimateRequestCostUsd`) are explicitly labeled as estimates and return `null` for unpriced models.

## Persistence & Privacy

- **Conversations**: Stored locally in `userData/ai-conversations.json` (workspace-scoped, paginated). Stores conversation metadata, messages, and verified source reference metadata — never API keys or full repository dumps. Cloud metadata models (`Conversation`, `ConversationMessage`) are defined in `prisma/schema.prisma` for future sync without requiring cloud connectivity for desktop AI.
- **Usage & Diagnostics**: Stored locally in `userData/ai-usage.json` (bounded ring buffer). Never logs API keys, authorization headers, or repository source code.

## Verification & Testing

Run the full verification suite from the repository root:

```powershell
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

## Known Limitations

- `HeuristicTokenEstimator` is conservative and deterministic but not an exact BPE tokenizer; the `TokenEstimator` interface supports plugging in an exact tokenizer adapter later.
- Cloud conversation synchronization is not yet enabled; conversations persist locally on the desktop machine.
- Automated patch application, Intent Mode execution, and Decision Memory capture belong to later phases.
