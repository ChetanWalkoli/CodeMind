# Phase 9 — Persistence & Infrastructure Strategy (Milestone 9.7)

## 1. Local-First Persistence Audit

All desktop features persist locally in Electron `userData` with atomic temp-file writes, Zod validation on load, corruption recovery, and SHA-256 workspace-hash isolation:

| Data Category                   | Storage Location                                           | Schema Version | Retention / Cap                         |
| :------------------------------ | :--------------------------------------------------------- | :------------: | :-------------------------------------- |
| App & AI Preferences            | `<userData>/preferences.json`                              |       v1       | Current state (migrated safely on load) |
| Encrypted Gemini Credentials    | `<userData>/credentials/` (OS `safeStorage`)               |       v1       | Single active key per provider          |
| AI Conversations & Usage        | `<userData>/conversations/`, `<userData>/usage/`           |       v1       | Workspace-isolated                      |
| Intent Mode Sessions & Recovery | `<userData>/intent-sessions/<wsHash>/`                     |       v1       | Workspace-isolated + atomic backups     |
| Decision Memory                 | `<userData>/decision-memory/<wsHash>/`                     |       v1       | Workspace-isolated                      |
| Change Impact Reports           | `<userData>/impact-analyses/<wsHash>/`                     |       v1       | Max 40 reports per workspace            |
| Activity History                | `<userData>/activity-history/<wsHash>/`                    |       v1       | Max 200 events per workspace            |
| Code Intelligence Index         | In-memory `ProjectIndexer` + incremental `syncWorkspace()` |       —        | Rebuilt/synced locally from disk        |

## 2. Database / PostgreSQL & Prisma Evaluation

- `packages/database` currently contains only a boundary placeholder (`DATABASE_SCHEMA_PATH = "prisma/schema.prisma"`), with no Prisma client or PostgreSQL server dependency.
- **Decision**: CodeMind Desktop does **not** require PostgreSQL for Phase 9. All local-first workflows operate 100% offline using workspace-isolated atomic JSON stores.
- **Future Cloud Readiness**: If optional team/cloud sync is introduced in a future phase, PostgreSQL + Prisma should be scoped strictly to opt-in account/sync metadata (`apps/api` + `packages/database`), keeping desktop startup completely independent of remote database availability.
