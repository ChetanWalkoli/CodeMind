# ADR-0003: Human-in-the-Loop Patch Safety & Electron Security

- **Status**: Accepted
- **Date**: 2026-11-20

## Context

AI-generated code edits and shell commands carry high risk if applied silently or with unrestricted filesystem access.

## Decision

1. **No unapproved modifications**: AI must never silently overwrite project files. Every patch must pass schema validation, content-hash verification, diff review, and explicit developer approval.
2. **Recovery checkpoints**: Before applying an approved patch, create a recovery checkpoint so rollback is always possible.
3. **Electron security boundary**: `contextIsolation: true`, `nodeIntegration: false`, narrow preload API, Zod-validated IPC payloads, and workspace-scoped file access.
4. **Untrusted repo content**: Source code and comments are treated as untrusted input to defend against prompt injection.
5. **Separated Decision Memory**: Verified developer-written reasoning is stored separately from AI-inferred interpretations.

## Consequences

- Slightly more UI steps during Intent Mode, in exchange for predictable, trustworthy engineering workflows.
