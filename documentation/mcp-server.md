# MCP Server

## Overview

The MCP server (`@cognistore/mcp-server`) is the primary interface for AI coding agents. It exposes 12 tools via the [Model Context Protocol](https://modelcontextprotocol.io/) stdio transport. Published to npm as a standalone package.

**System knowledge guard:** Several tools enforce protection of system entries (`type=system`). System entries are seeded during setup and contain mandatory protocol instructions. They cannot be deleted or modified through MCP tools, and `addPlanRelation` silently skips them.

## Transport

```
AI Client ←── stdio (stdin/stdout JSON-RPC) ──→ MCP Server ──→ SDK ──→ SQLite + Ollama
```

The server is launched by AI clients via `npx -y @cognistore/mcp-server`. Communication happens over stdin/stdout using JSON-RPC messages per the MCP specification.

## Tools

### addKnowledge

Store a new knowledge entry with automatic semantic embedding.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | Yes | — | Short descriptive title |
| `content` | string | Yes | — | The knowledge content text |
| `tags` | string[] | Yes | — | Categorical tags for filtering and embedding |
| `type` | enum | Yes | — | `decision`, `pattern`, `fix`, `constraint`, `gotcha`, or `system` |
| `scope` | string | Yes | — | `global` or `workspace:<project-name>` |
| `source` | string | Yes | — | Where this knowledge came from |
| `confidenceScore` | number | No | 1.0 | 0.0–1.0 confidence rating |
| `agentId` | string | No | — | ID of the creating agent |

> **Note:** The `system` type is reserved for mandatory protocol entries seeded during setup. Agents should not create entries with `type=system` — these are managed exclusively by the setup wizard.

### getKnowledge

Search knowledge entries using semantic similarity.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Natural language search query |
| `tags` | string[] | No | — | Filter by tags (all must match) |
| `type` | enum | No | — | Filter by knowledge type |
| `scope` | string | No | — | Filter by scope (global always included) |
| `limit` | number | No | 10 | Maximum results to return |
| `threshold` | number | No | 0.7 | Minimum similarity score (0.0–1.0) |

### updateKnowledge

Update an existing entry. Re-embeds if tags change. Auto-increments version. Rejects type or content changes to system entries (`type=system`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | UUID of the entry to update |
| `title` | string | No | New title |
| `content` | string | No | New content text |
| `tags` | string[] | No | New tags (triggers re-embedding) |
| `type` | enum | No | New type |
| `scope` | string | No | New scope |
| `source` | string | No | New source |
| `confidenceScore` | number | No | New confidence score |

### deleteKnowledge

Remove an entry and its embedding by ID. Returns an error if the entry has `type=system` (system entries are protected and cannot be deleted).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | UUID of the entry to delete |

### listTags

List all unique tags across all knowledge entries. No parameters.

### healthCheck

Verify database connectivity and Ollama availability. No parameters. Returns status for both services.

### createPlan

Create a new plan with optional initial tasks and knowledge relations. Status starts as `draft`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | Yes | — | Plan title (short, descriptive) |
| `content` | string | Yes | — | Full plan content (steps, approach, considerations) |
| `tags` | string[] | Yes | — | Tags for categorization |
| `scope` | string | Yes | — | `global` or `workspace:<project-name>` |
| `source` | string | Yes | — | Source/context of the plan |
| `relatedKnowledgeIds` | string[] | No | — | IDs of knowledge entries consulted during planning (creates input relations) |
| `tasks` | object[] | No | — | Initial tasks with `description` and optional `priority` (`low`/`medium`/`high`) |

### updatePlan

Update an existing plan's title, content, tags, scope, status, or source.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | UUID of the plan to update |
| `title` | string | No | New title |
| `content` | string | No | New content |
| `tags` | string[] | No | New tags |
| `scope` | string | No | New scope |
| `status` | enum | No | `draft`, `active`, or `completed` (agents cannot set `archived` — archiving is a user-only action via the dashboard) |
| `source` | string | No | New source |

### addPlanRelation

Link a knowledge entry to a plan as input or output. Silently skips system knowledge entries (`type=system`) — no error is returned, but no relation is created.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | UUID of the plan |
| `knowledgeId` | string | Yes | UUID of the knowledge entry to link |
| `relationType` | enum | Yes | `input` (consulted during planning) or `output` (created during execution) |

### addPlanTask

Add a task to a plan's todo list. Position is auto-calculated.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | Yes | — | UUID of the plan |
| `description` | string | Yes | — | Task description |
| `priority` | enum | No | `medium` | `low`, `medium`, or `high` |
| `notes` | string | No | — | Optional notes |

### updatePlanTask

Update a plan task's status, description, priority, or notes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | UUID of the task |
| `status` | enum | No | `pending`, `in_progress`, or `completed` |
| `description` | string | No | New description |
| `priority` | enum | No | `low`, `medium`, or `high` |
| `notes` | string/null | No | Notes about progress or blockers |

### listPlanTasks

List all tasks for a plan, ordered by position. Use to check progress or resume work.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | UUID of the plan |

## Bundling Strategy

**File:** `apps/mcp-server/tsup.config.ts`

The MCP server uses **tsup** to create a single ESM bundle that inlines all workspace packages:

**Inlined (bundled):**
- `@cognistore/sdk`
- `@cognistore/core`
- `@cognistore/embeddings`
- `@cognistore/shared`

**External (resolved at runtime via node_modules):**
- `better-sqlite3` (native addon)
- `sqlite-vec` (native addon)
- `drizzle-orm`
- `@modelcontextprotocol/sdk`
- `zod`

This means `npx -y @cognistore/mcp-server` installs only the external dependencies — the workspace code is pre-bundled.

## Configuration

The MCP server reads configuration from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SQLITE_PATH` | `~/.cognistore/knowledge.db` | Database file path |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `all-minilm` | Embedding model |
| `EMBEDDING_DIMENSIONS` | `384` | Vector dimensions |

## Client Configuration

### Claude Code

```json
// ~/.claude/mcp-config.json
{
  "mcpServers": {
    "cognistore": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cognistore/mcp-server"]
    }
  }
}
```

### GitHub Copilot

```json
// ~/.copilot/mcp-config.json
{
  "mcpServers": {
    "cognistore": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cognistore/mcp-server"]
    }
  }
}
```

### OpenCode

```json
// ~/.config/opencode/opencode.json
{
  "mcp": {
    "cognistore": {
      "type": "local",
      "command": ["npx", "-y", "@cognistore/mcp-server"],
      "enabled": true
    }
  }
}
```
