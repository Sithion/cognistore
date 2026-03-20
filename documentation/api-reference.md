# API Reference (Fastify Sidecar)

## Overview

The Fastify sidecar server exposes a REST API consumed by the React frontend. It runs on `localhost:3210+` (dynamic port) and is only accessible locally.

**File:** `apps/dashboard/server/index.ts`

## Health & Status

### GET /api/health

Check database and Ollama connectivity.

**Response:**
```json
{
  "database": { "connected": true, "path": "~/.cognistore/knowledge.db" },
  "ollama": { "connected": true, "host": "http://localhost:11434" }
}
```

### GET /api/setup/status

Check if all setup components are installed and ready.

**Response:**
```json
{
  "node": true,
  "ollama": true,
  "database": true,
  "model": true,
  "mcpConfig": true,
  "sdkReady": true
}
```

## Knowledge CRUD

### GET /api/knowledge/recent

List recent knowledge entries.

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | number | 20 | Max entries to return |

**Response:** `KnowledgeEntry[]`

### POST /api/knowledge/search

Semantic search across knowledge entries.

**Body:**
```json
{
  "query": "React performance optimization",
  "tags": ["react"],
  "type": "pattern",
  "scope": "workspace:my-project",
  "limit": 10,
  "threshold": 0.3
}
```

All fields except `query` are optional.

**Response:** `{ entry: KnowledgeEntry, similarity: number }[]`

### GET /api/knowledge/:id

Get a single entry by ID.

**Response:** `KnowledgeEntry`

### POST /api/knowledge

Create a new knowledge entry.

**Body:**
```json
{
  "title": "React.memo for list items",
  "content": "Use React.memo for expensive list items",
  "tags": ["react", "performance", "memo"],
  "type": "pattern",
  "scope": "global",
  "source": "code-review",
  "confidenceScore": 0.9,
  "agentId": "claude-code"
}
```

Required: `title`, `content`, `tags`, `type`, `scope`, `source`

**Response:** `KnowledgeEntry`

### PUT /api/knowledge/:id

Update an existing entry. Only include fields to change. Returns `403 Forbidden` if attempting to change `type` or `content` on a system entry (`type=system`).

**Body:**
```json
{
  "content": "Updated content",
  "tags": ["new", "tags"]
}
```

**Response:** `KnowledgeEntry`

### DELETE /api/knowledge/:id

Delete an entry and its embedding. Returns `403 Forbidden` if the entry has `type=system` (system entries are protected and cannot be deleted).

**Response:** `{ success: true }`

**Error (system entry):**
```json
{
  "error": "System knowledge entries cannot be deleted",
  "statusCode": 403
}
```

## Statistics & Metrics

### GET /api/stats

Aggregated entry counts.

**Response:**
```json
{
  "total": 150,
  "byType": [
    { "type": "pattern", "count": 45 },
    { "type": "fix", "count": 38 }
  ],
  "byScope": [
    { "scope": "global", "count": 80 },
    { "scope": "workspace:my-app", "count": 70 }
  ]
}
```

### GET /api/metrics

Detailed metrics for the stats dashboard.

**Response:**
```json
{
  "database": { "size": "2.4 MB", "path": "~/.cognistore/knowledge.db" },
  "activity": { "last24h": 12, "last7d": 45 },
  "activityByDay": [
    { "date": "2026-03-17", "count": 8 },
    { "date": "2026-03-16", "count": 4 }
  ],
  "heatmap": [
    { "date": "2026-03-17", "count": 8 },
    { "date": "2025-12-18", "count": 0 }
  ],
  "typeDistribution": [
    { "type": "pattern", "count": 45 }
  ]
}
```

- `activityByDay`: Last 15 days of activity
- `heatmap`: Last 90 days (daily counts for contribution heatmap)

### GET /api/tags

List all unique tags.

**Response:** `string[]`

## Setup Endpoints

### POST /api/setup/node

Install or detect Node.js v20.

### POST /api/setup/ollama

Install Ollama (brew on macOS, curl on Linux).

### POST /api/setup/ollama-start

Start `ollama serve` as background daemon. Waits up to 15 seconds for readiness.

### POST /api/setup/database

Create SQLite database with schema and indices.

### POST /api/setup/model

Pull `all-minilm` embedding model via Ollama API.

### POST /api/setup/configure

Inject MCP configs, instruction markers, and AI skills into all supported clients.

### POST /api/setup/complete

Finalize setup and re-initialize the SDK.

## Uninstall

### POST /api/uninstall

Full teardown: remove configs, skills, data, Ollama, and self-delete app. See [Setup & Uninstall](./setup-uninstall.md) for details.

## Plans CRUD

### GET /api/plans

List plans with optional status filter.

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | number | 20 | Max plans to return |
| `status` | string | — | Filter by status: `draft`, `active`, `completed`, `archived` |

**Response:** `Plan[]`

### POST /api/plans

Create a new plan.

**Body:**
```json
{
  "title": "Migration to v2 API",
  "content": "Step-by-step migration plan...",
  "tags": ["migration", "api"],
  "scope": "workspace:my-app",
  "source": "planning-session",
  "tasks": [
    { "description": "Audit current endpoints", "priority": "high" },
    { "description": "Write migration scripts", "priority": "medium" }
  ],
  "relatedKnowledgeIds": ["uuid-1", "uuid-2"]
}
```

Required: `title`, `content`, `tags`, `scope`, `source`

**Response:** `Plan`

### PUT /api/plans/:id

Update a plan. Only include fields to change. The `archived` status can only be set from the dashboard (not via MCP) — agents are restricted to `draft`, `active`, and `completed` transitions.

**Body:**
```json
{
  "status": "active",
  "title": "Updated title"
}
```

**Response:** `Plan`

### DELETE /api/plans/:id

Delete a plan and all associated tasks and relations.

**Response:** `{ success: true }`

### GET /api/plans/:id/relations

Get knowledge entries linked to a plan.

**Response:** `{ entry: KnowledgeEntry, relationType: "input" | "output" }[]`

### POST /api/plans/:id/relations

Link a knowledge entry to a plan. Silently skips system knowledge entries (`type=system`) — returns success but does not create the relation.

**Body:**
```json
{
  "knowledgeId": "uuid-of-entry",
  "relationType": "input"
}
```

**Response:** `{ success: true }`

## Plan Tasks

### GET /api/plans/:planId/tasks

List tasks for a plan, ordered by position.

**Response:** `PlanTask[]`

### POST /api/plans/:planId/tasks

Add a task to a plan.

**Body:**
```json
{
  "description": "Write unit tests",
  "priority": "high",
  "notes": null
}
```

**Response:** `PlanTask`

### PUT /api/tasks/:id

Update a task (status, description, priority, notes).

**Body:**
```json
{
  "status": "completed",
  "notes": "All tests passing"
}
```

**Response:** `PlanTask`

### DELETE /api/tasks/:id

Delete a task.

**Response:** `{ success: true }`

## Error Handling

### Degraded Mode (503)

If the SDK fails to initialize on startup, the server enters degraded mode:

- All knowledge endpoints return `503 Service Unavailable`
- Setup and health endpoints remain available
- SDK re-initialization retried every 10 seconds
- Once SDK initializes, all endpoints become available

### Standard Error Response

```json
{
  "error": "Entry not found",
  "statusCode": 404
}
```
