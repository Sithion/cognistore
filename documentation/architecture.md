# Architecture Overview

## System Context

CogniStore is a desktop application that provides AI coding agents with persistent semantic memory. It runs entirely on the user's machine — no cloud services, no API keys, no data leaving the laptop.

The system consists of three runtime subsystems:

1. **Desktop Application** — Tauri v2 shell wrapping a React frontend + Fastify sidecar process
2. **MCP Server** — Standalone npm package consumed by AI clients (Claude Code, Copilot, OpenCode) via stdio transport
3. **Shared Libraries** — Monorepo packages for database, embeddings, SDK, and config management

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     AI Coding Agents                             │
│         (Claude Code / GitHub Copilot / OpenCode)                │
└──────────────┬───────────────────────────────────────────────────┘
               │ MCP stdio transport
               ▼
┌──────────────────────────┐    ┌──────────────────────────────────┐
│  @cognistore/mcp-server│    │  Tauri Desktop App               │
│  (npx, standalone)       │    │  ┌────────────┐ ┌──────────────┐ │
│                          │    │  │ React UI   │ │ Fastify      │ │
│  12 tools (knowledge +   │    │  │ (WebView)  │→│ sidecar      │ │
│  plans + tasks + health) │    │  └────────────┘ └──────┬───────┘ │
│                          │    │                        │         │
│                          │    └────────────────────────┼─────────┘
│                          │                             │
│                          │                             │
└──────────┬───────────────┘                             │
           │                                             │
           ▼                                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      @cognistore/sdk                           │
│              (unified entry point for all consumers)             │
└──────────┬──────────────────────────────────┬────────────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────┐          ┌────────────────────────────────┐
│  @cognistore/core  │          │  @cognistore/embeddings      │
│  SQLite + sqlite-vec │          │  Ollama HTTP client             │
│  Drizzle ORM         │          │  all-minilm model (384-dim)     │
└──────────┬───────────┘          └──────────┬─────────────────────┘
           │                                 │
           ▼                                 ▼
┌──────────────────────┐          ┌────────────────────────────────┐
│  ~/.cognistore/    │          │  Ollama (localhost:11434)       │
│  knowledge.db        │          │  Native, auto-installed         │
└──────────────────────┘          └────────────────────────────────┘
```

## Package Dependency Graph

```
@cognistore/mcp-server ──→ @cognistore/sdk
                                    │
                            ┌───────┴───────┐
                            ▼               ▼
                    @cognistore/core  @cognistore/embeddings
                            │               │
                            ▼               ▼
                    @cognistore/shared  @cognistore/shared

@cognistore/dashboard ──→ @cognistore/sdk
                         ──→ @cognistore/config
```

All cross-package dependencies use `workspace:*` protocol via pnpm.

## Data Flow

### Write Path (addKnowledge)

```
1. MCP client sends addKnowledge(title, content, tags, type, scope, source)
2. MCP server validates input with Zod schema (packages/shared)
3. SDK.add() delegates to KnowledgeService.add()
4. Service joins tags into text → sends to Ollama /api/embeddings
5. Ollama returns 384-dimensional float32 vector
6. Repository generates UUIDv4 + ISO timestamps
7. INSERT into knowledge_entries table (Drizzle ORM)
8. INSERT embedding into knowledge_embeddings virtual table (sqlite-vec)
9. Return { id, title, content, tags, type, scope, source, createdAt }
```

### Read Path (getKnowledge)

```
1. MCP client sends getKnowledge(query, options?)
2. Query text → Ollama embedding → 384-dim vector
3. sqlite-vec KNN search returns (limit * 5) candidates with cosine distances
4. Filter candidates: scope (always includes global), tags, type, expiration
5. Convert: similarity = 1 - distance
6. Filter by threshold (default 0.3), sort descending, limit results
7. Return [{ entry, similarity }]
```

### Update Path (updateKnowledge)

```
1. Fetch existing entry by ID
2. If tags changed → re-embed via Ollama
3. Increment version field (version = version + 1)
4. UPDATE knowledge_entries + replace embedding if changed
```

### System Knowledge

System knowledge entries (`type=system`) are a special class of mandatory entries seeded during setup. They contain protocol instructions that agents must follow (e.g., knowledge-first workflow, plan persistence rules). Key properties:

- **Seeded on setup** — Created by the setup wizard as part of the configure step
- **Injected via hook** — `UserPromptSubmit` hooks read system entries from the database and inject them as a `[COGNISTORE-PROTOCOL]` system message at the start of every agent session
- **Hidden from dashboard** — The frontend filters out `type=system` entries from all views (knowledge list, stats, search results)
- **Undeletable** — The `deleteKnowledge` tool and `DELETE /api/knowledge/:id` endpoint reject requests targeting system entries. The `updateKnowledge` tool also rejects type or content changes to system entries
- **Excluded from bulk operations** — Import, export, and bulk delete operations skip system entries
- **Excluded from plan relations** — `addPlanRelation` silently skips system entries to prevent agents from linking protocol instructions to plans

### Plans (Separate Entity)

Plans are stored in their own `plans` table with a separate `plans_embeddings` virtual table. They are linked to knowledge entries via `plan_relations` and have associated `plan_tasks` for todo tracking. The plan lifecycle is: `draft` -> `active` -> `completed` -> `archived`.

**Plan status lifecycle enforcement:** Agents (via MCP) can transition plans through `draft` -> `active` -> `completed` but cannot set `archived` status. Archiving is a user-only action available from the dashboard on completed plans.

```
Write: createPlan(title, content, tags, scope, source, tasks?, relatedKnowledgeIds?)
  1. Validate input → INSERT into plans table
  2. If tasks provided → INSERT each into plan_tasks
  3. If relatedKnowledgeIds → INSERT into plan_relations (type=input)
  4. Embed tags → INSERT into plans_embeddings

Task Flow: addPlanTask / updatePlanTask / listPlanTasks
  - Tasks ordered by position (auto-calculated)
  - Status: pending → in_progress → completed
  - Priority: low / medium / high
```

### Migration System

Database schema changes are managed through versioned SQL migration files:

```
packages/core/src/db/migrations/
├── 0.8.0.sql    # Base schema (knowledge_entries, operations_log)
├── 0.9.0.sql    # Plans table, plan_tasks, plan_relations, title column
├── 1.0.0.sql    # System knowledge type support
└── meta/
    └── _journal.json
```

A `schema_version` table tracks which migrations have been applied. On startup, `createDbClient()` runs `runMigrations()` which detects the current version and applies pending migrations. Pre-migration databases (no `schema_version` table) are bootstrapped automatically.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding target | Tags (not content) | Tags are concise semantic anchors; content can be long and noisy |
| Embedding model | all-minilm (384d) | Small (23MB), fast, good quality for short text |
| Similarity threshold | 0.3 default | Tags produce lower similarity scores than full sentences |
| Database | SQLite + sqlite-vec | Zero-config, single file, no daemon, native vector ops |
| Ollama install | brew (macOS), curl (Linux) | No sudo required on macOS via Homebrew |
| App framework | Tauri v2 | Native desktop, small binary (~15MB), Rust backend |
| MCP distribution | npm (tsup bundle) | Workspace packages inlined, only native deps external |
| Sidecar model | Fastify as child process | Tauri WebView connects to localhost; avoids Tauri IPC complexity |
| State management | Redux Toolkit | Centralized stats/metrics state with async thunks |

## Directory Structure

```
cognistore/
├── apps/
│   ├── dashboard/              # Tauri v2 desktop application
│   │   ├── src/                # React frontend
│   │   │   ├── pages/          # HomePage, PlansPage, StatsPage, SettingsPage, SetupPage
│   │   │   ├── components/     # Sidebar, UpdateChecker, LanguageSelector
│   │   │   ├── store/          # Redux Toolkit (statsSlice)
│   │   │   ├── i18n/           # Translations (EN, ES, PT)
│   │   │   └── api/            # HTTP client for Fastify sidecar
│   │   ├── server/             # Fastify sidecar
│   │   │   └── index.ts        # API routes (setup, CRUD, stats, health, uninstall)
│   │   ├── src-tauri/          # Rust shell
│   │   │   ├── src/main.rs     # App entry, plugin registration, sidecar spawn
│   │   │   └── src/sidecar.rs  # Node.js finder, process spawner, port allocation
│   │   ├── templates/          # Bundled resources
│   │   │   ├── skills/         # AI skills for Claude Code and Copilot
│   │   │   └── configs/        # Instruction templates for AI clients
│   │   └── scripts/
│   │       └── bundle-sidecar.mjs  # Pre-build: copies server + deps for Tauri bundle
│   └── mcp-server/             # MCP server (published to npm)
│       ├── src/server.ts       # Tool registration + handlers
│       └── tsup.config.ts      # Bundler config (inlines workspace packages)
├── packages/
│   ├── shared/                 # Types, constants, Zod schemas
│   │   └── src/
│   │       ├── types.ts        # KnowledgeEntry, SDKConfig, etc.
│   │       ├── constants.ts    # DEFAULT_SQLITE_PATH, DEFAULT_OLLAMA_HOST, etc.
│   │       └── schemas.ts      # Zod validation schemas
│   ├── core/                   # Database layer
│   │   └── src/
│   │       ├── db/client.ts    # createDbClient(), migration runner, sqlite-vec loader
│   │       ├── db/schema/      # Drizzle table definitions + sqlite-vec virtual tables
│   │       ├── db/migrations/  # Versioned SQL migrations (0.8.0.sql, 0.9.0.sql)
│   │       ├── repositories/   # KnowledgeRepository (CRUD + vector search)
│   │       └── services/       # KnowledgeService (embedding + persistence orchestration)
│   ├── embeddings/             # Ollama client
│   │   └── src/client.ts       # OllamaEmbeddingClient (embed, ensureModel, healthCheck)
│   ├── sdk/                    # Public SDK
│   │   └── src/sdk.ts          # KnowledgeSDK class (initialize, add, search, update, delete)
│   └── config/                 # Config injection
│       └── src/config-manager.ts  # Marker-based injection for Claude, Copilot, OpenCode
├── scripts/
│   ├── bump-version.sh         # Version bump across all packages + Cargo.toml + LICENSE
│   └── test-agents.sh          # Agent test battery (Docker Ollama, local DB, multi-client tests)
├── documentation/              # Technical documentation (this directory)
└── .github/
    └── workflows/
        ├── ci.yml              # PR checks: build + test + npm dry-run
        └── publish.yml         # Release: npm publish + Tauri binary builds
```
