# Proposal 001: Initial Architecture

## Status
Accepted

## Summary
Establish the foundational architecture for the @ai-knowledge semantic knowledge management system.

## Problem
AI agents (Claude Code, GitHub Copilot, custom TypeScript agents) need a persistent, semantically-searchable knowledge base to store and retrieve patterns, decisions, fixes, constraints, and gotchas across sessions and projects.

## Solution
A monorepo-based system providing:
- **SDK** (`@ai-knowledge/sdk`) — npm-publishable package with full CRUD + semantic search
- **MCP Server** — Plugin for Claude Code and GitHub Copilot
- **CLI** — Standalone command-line interface
- **Dashboard** — Vite+React web UI for visual knowledge management

### Technical Stack
- PostgreSQL 17 + pgvector for vector storage and similarity search
- Ollama for local embedding generation (configurable model, default all-minilm 384d)
- Drizzle ORM for type-safe database operations
- Docker for automated infrastructure management

### Search Strategy
- Full text content is vectorized via Ollama embeddings
- Tags serve as structured categorical filters (GIN-indexed arrays)
- Semantic search combines cosine similarity on embeddings with optional tag/type/scope filters
- **Scope behavior**: searching with a specific scope (e.g., `workspace:api`) always includes `global` knowledge alongside scoped results

### Package Architecture
```
shared (types/validation) → core (DB/business) + embeddings (Ollama)
                           ↘         ↙
                             SDK
                           ↙  ↓  ↘
                     MCP   CLI  Dashboard
```

## Decision
Approved for implementation. See wireframe at `openspec/design/wireframe.html`.
