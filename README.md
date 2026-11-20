# CodeMind

**Understand. Improve. Remember.**

CodeMind is a local-first, desktop-first AI development environment that understands an entire software project, helps developers improve it safely with reviewed patches, explains complex architectures with source-code evidence, and remembers the engineering decisions behind important changes.

## Core Capabilities

1. **Explain My Codebase** — Static analysis, symbol extraction, dependency graphs, and evidence-backed architecture explanations.
2. **Intent Mode** — Natural-language engineering goals converted into ranked findings, reviewable diffs, explicit approvals, and verified patches.
3. **Decision Memory** — Searchable history of why important engineering decisions were made, linked to files, content hashes, and Git commits.
4. **Change Impact Intelligence** — Identify direct/indirect dependents, related tests, API contracts, and historical decisions before editing code.

## Monorepo Structure

```text
codemind/
├── apps/
│   ├── desktop/        # Electron + React + TypeScript + Monaco IDE
│   ├── api/            # Node.js + Express + TypeScript cloud metadata & AI API
│   └── website/        # Documentation & landing site
├── packages/
│   ├── shared/         # Shared TypeScript types & Zod contracts
│   ├── config/         # Shared constants, ignore rules & secret patterns
│   ├── code-engine/    # Independent local scanner, parser, graph & impact engine
│   ├── ai-core/        # Provider-agnostic AIProvider interface & output validation
│   └── database/       # Database boundary (PostgreSQL + Prisma)
├── prisma/
│   └── schema.prisma   # Cloud metadata & Decision Memory schema
├── docs/
│   └── adr/            # Architecture Decision Records
└── tests/
    ├── fixtures/       # Sample projects for indexing & integration tests
    └── integration/    # Cross-package integration tests
```

## Prerequisites

- Node.js `>= 20`
- pnpm `>= 9`
- Docker (optional, for local PostgreSQL via `docker compose up -d`)

## Getting Started

```bash
# Install dependencies
pnpm install

# Build all workspace packages
pnpm build

# Typecheck across the monorepo
pnpm typecheck

# Lint & format check
pnpm lint
pnpm format:check

# Run unit tests
pnpm test
```

## Development Phases

- [x] **Phase 0** — Product foundation, monorepo, shared contracts, tooling, and ADRs
- [ ] **Phase 1** — Desktop shell (Electron + React + Vite) and Monaco editor
- [ ] **Phase 2** — Workspace and local filesystem boundary
- [ ] **Phase 3** — Code intelligence engine (scanner, AST, symbols, dependency graph, incremental indexing)
- [ ] **Phase 4** — Explain My Codebase (architecture explorer, React Flow graph, source navigation)
- [ ] **Phase 5** — AI infrastructure (provider adapter, structured outputs, context retrieval, SSE)
- [ ] **Phase 6** — Intent Mode (findings, diff review, approval, verification, rollback)
- [ ] **Phase 7** — Decision Memory
- [ ] **Phase 8** — Change Impact Intelligence
- [ ] **Phase 9** — Authentication and cloud services (Express + PostgreSQL + Prisma)
- [ ] **Phase 10** — Security review, testing, and desktop release packaging
