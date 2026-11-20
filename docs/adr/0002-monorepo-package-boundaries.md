# ADR-0002: Monorepo and Package Boundaries

- **Status**: Accepted
- **Date**: 2026-11-20

## Context

CodeMind spans a desktop app (Electron + React), a cloud API (Express + Prisma), a local code intelligence engine, and an AI provider abstraction. Tight coupling between UI, parsing, and API logic would make testing and phase-by-phase delivery difficult.

## Decision

Use a `pnpm` workspaces monorepo with strict package boundaries:

- `packages/shared` (`@codemind/shared`): Shared TypeScript types and Zod schemas (IPC, code engine, AI outputs, decisions, impact reports).
- `packages/config` (`@codemind/config`): Shared constants, default ignore rules, secret patterns, and supported extensions.
- `packages/code-engine` (`@codemind/code-engine`): Independent local source-code analysis engine. Must never depend on React, Electron UI, or PostgreSQL.
- `packages/ai-core` (`@codemind/ai-core`): Provider-agnostic `AIProvider` interface and Zod-validated structured output helpers.
- `packages/database` (`@codemind/database`): Database access boundary backed by `prisma/schema.prisma`.
- `apps/desktop`: Electron main/preload/renderer + React + Monaco Editor.
- `apps/api`: Express + TypeScript cloud API.
- `apps/website`: Product documentation and marketing site.

## Consequences

- Every core module can be unit-tested in isolation with Vitest.
- Shared Zod contracts guarantee type safety across IPC and REST boundaries.
