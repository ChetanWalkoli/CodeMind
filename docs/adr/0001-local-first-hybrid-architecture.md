# ADR-0001: Local-First Hybrid Architecture

- **Status**: Accepted
- **Date**: 2026-11-20

## Context

CodeMind analyzes real developer repositories to explain architecture, detect improvements, predict change impact, and preserve engineering decisions. Uploading entire repositories to a cloud server creates privacy concerns, latency, and unnecessary storage costs.

## Decision

1. Source code, file indexing, AST parsing, dependency graphs, and local Git inspection run locally inside `@codemind/code-engine` invoked by the Electron desktop app.
2. Cloud PostgreSQL stores only user accounts, project metadata, Decision Memory records, Intent session metadata, and AI usage metrics.
3. Sensitive files (`.env`, private keys, ignored directories) are excluded by default and never transmitted to AI providers.
4. Only minimal, relevant, developer-permitted code excerpts are sent for AI reasoning.

## Consequences

- Strong privacy guarantees by default.
- Fast incremental indexing without network round trips.
- Clear separation between local intelligence (`@codemind/code-engine`) and cloud persistence (`apps/api` + PostgreSQL).
