# Documentation

Technical documentation for CogniStore v1.0.0.

## Contents

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System overview, data flow, package graph, directory structure, system knowledge, design decisions |
| [Tauri Sidecar](./tauri-sidecar.md) | Desktop app internals: startup sequence, Node.js discovery, port allocation, auto-update, security |
| [Database](./database.md) | SQLite schema, sqlite-vec virtual table, system type, vector search algorithm, embedding strategy |
| [MCP Server](./mcp-server.md) | Tool definitions, parameters, system entry guards, bundling strategy, client configuration |
| [Config Injection](./config-injection.md) | Marker-based injection, hook-based protocol injection, supported clients, skills installation |
| [Setup & Uninstall](./setup-uninstall.md) | Setup wizard steps (incl. system knowledge seeding), uninstall teardown, symmetry rule |
| [Frontend](./frontend.md) | React pages, ConfirmModal, plan archive, Redux state, i18n, routing, loading strategy |
| [API Reference](./api-reference.md) | Fastify sidecar REST endpoints: health, CRUD, stats, setup, uninstall, system guards |
| [CI/CD](./ci-cd.md) | GitHub Actions workflows, publish pipeline, agent test battery, version management |

## Quick Navigation

**Building the app?** Start with [Architecture](./architecture.md) then [CI/CD](./ci-cd.md).

**Adding a feature?** Check [Frontend](./frontend.md) for UI patterns and [API Reference](./api-reference.md) for backend endpoints.

**Debugging MCP?** See [MCP Server](./mcp-server.md) for tool details and [Database](./database.md) for search behavior.

**Modifying setup?** Read [Setup & Uninstall](./setup-uninstall.md) — remember the symmetry rule.

**Adding a new AI client?** Follow [Config Injection](./config-injection.md) patterns.

**Running agent tests?** See [CI/CD](./ci-cd.md) for the agent test battery (`scripts/test-agents.sh`).
