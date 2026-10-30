# Database Layer

## Overview

The knowledge base uses **SQLite** with the **sqlite-vec** extension for vector similarity search. The database is managed through **Drizzle ORM** and stored as a single file at `~/.cognistore/knowledge.db`.

## Round 5 migration 2.4.2

Migration 2.4.2 removes only `consumption_samples` and
`consumption_ingest_state`. Current token usage, scan state, operations,
knowledge, and plans remain. Both compatibility matrices use the unchanged
1.3.0-legacy fixture.

## Token usage retention

Migration 2.4.3 adds permanent daily counters keyed by lexical stored date,
source, model, project, and a project-null discriminator. SQL NULL projects
display as `(unknown)`; a real empty-string project remains a separate group.
The day is `substr(occurred_at, 1, 10)`, including for offset-bearing timestamps.

Whole-day aggregates use rollups. Retained partial-day edges use raw rows.
Outside raw retention, a partial-day edge uses the whole rollup day and can
overcount the requested hours. Historical hourly precision cannot be recovered.
Heatmaps and sessions use retained raw rows.

`token_usage_meta.pruned_before` permanently records the greatest pruning
cutoff. Current ingestion skips older events, and the insert trigger ignores
older events from other connections, preventing permanent totals from growing
when scan state is reset after pruning. Retention never deletes daily counters.
The migration also indexes `knowledge_entries(updated_at)`.

## Incremental vacuum

Only an explicitly opted-in upgrade switches SQLite to incremental auto-vacuum.
The rewrite runs in a dedicated worker. Database opens and MCP startup never
run VACUUM. Maintenance only reclaims a bounded number of pages when mode 2
is already enabled, using bounded work every six hours. Enabling it rewrites
the database and needs free disk space of about twice the database's current size.
Agent sessions writing during the opted-in rewrite may wait. External lock
failures are recorded as warnings and do not block indefinitely.
Periodic reclaim runs independently of token retention and only starts when
`freelist_count` exceeds `max(1000, page_count * 0.05)`.

## Content hashes

Migration 2.4.5 adds nullable `content_hash` and its composite index.
SHA-256 encodes the NFC/newline/outer-whitespace-normalized title/content JSON
pair. Current writers maintain hashes transactionally. Old inserts leave NULL
and old content edits invalidate hashes. Bounded worker repair fills them.
Import rechecks NULL hashes and dedup candidates under its final immediate
lock after embedding; interference triggers bounded repair and retry.
The index is nonunique and candidates are content-checked. An import matching a
system entry is stored as a `pattern` entry, since imports cannot create system
knowledge.

## FTS repair coverage

After SDK initialization, a background worker checks non-system knowledge IDs in
bounded rowid pages using a list-subquery membership check. Row count alone, or a
nonempty index, cannot establish completeness. Cancellation retains committed
batches; a later run repairs remaining IDs. System entries stay out of the FTS
index and remain excluded from user search and exports.

## Schema

### knowledge_entries (relational table)

**File:** `packages/core/src/db/schema/knowledge.ts`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | UUIDv4 | Unique identifier |
| `title` | TEXT NOT NULL | `''` | Short descriptive title |
| `content` | TEXT NOT NULL | — | Knowledge content (free text) |
| `content_hash` | TEXT | NULL | SHA-256 of normalized title/content pair (migration `2.4.5.sql`) |
| `tags` | TEXT NOT NULL | `'[]'` | JSON array of string tags |
| `type` | TEXT NOT NULL | — | One of: `decision`, `pattern`, `fix`, `constraint`, `gotcha`, `system` |
| `scope` | TEXT NOT NULL | — | `global` or `workspace:<project-name>` |
| `source` | TEXT NOT NULL | — | Origin of the knowledge (file, conversation, etc.) |
| `version` | INTEGER NOT NULL | `1` | Incremented on each update |
| `expires_at` | TEXT | NULL | ISO timestamp for TTL (optional) |
| `confidence_score` | REAL NOT NULL | `1.0` | 0.0–1.0 confidence rating |
| `related_ids` | TEXT | NULL | JSON array of related entry IDs |
| `agent_id` | TEXT | NULL | ID of the agent that created this entry |
| `platform` | TEXT | NULL | Auto-detected host platform: `claude-code`, `copilot`, `opencode` or `unknown` |
| `last_read_at` | TEXT | NULL | ISO timestamp of the last tracked retrieval. Written only by read tracking (`SearchOptions.trackRead`), never by edits — see below |
| `read_count` | INTEGER NOT NULL | `0` | Number of tracked retrievals since read tracking began |
| `created_at` | TEXT NOT NULL | — | ISO timestamp |
| `updated_at` | TEXT NOT NULL | — | ISO timestamp |

**Indices:**
- `idx_type` on `type`
- `idx_scope` on `scope`
- `idx_knowledge_content_hash` on `(content_hash, id)` (migration `2.4.5.sql`)

**Trigger:** `knowledge_content_hash_invalidate` clears a populated hash after
an older writer changes title/content without changing the hash itself.

**System entries (`type=system`):** Mandatory protocol entries seeded during setup. These entries are protected at the application layer:
- `deleteKnowledge` rejects deletion requests for system entries
- `updateKnowledge` rejects type or content changes to system entries
- Bulk operations (import, export, bulk delete) skip system entries
- `addPlanRelation` silently skips system entries (no error, no relation created)
- The dashboard frontend filters them out of all views and search results
- `UserPromptSubmit` hooks read system entries and inject them as `[COGNISTORE-PROTOCOL]` system messages

**Read tracking (`last_read_at` / `read_count`):** These columns are a retention signal, not an audit log. They are updated only when a search explicitly opts in via `SearchOptions.trackRead`, which today happens at exactly two call sites: agent retrieval through the MCP `getKnowledge` tool, and the dashboard's explicit search endpoint (`POST /api/knowledge/search`, which forces the flag server-side so a client cannot suppress or forge it). Browsing endpoints (`/api/knowledge/recent`, `/api/knowledge/:id`), the MCP knowledge-context resource, internal scans and re-embeds deliberately do **not** opt in. Marking a read never changes `updated_at` or `version` — a read is not an edit.

### knowledge_embeddings (virtual table)

**File:** `packages/core/src/db/schema/sqlite-vec.ts`

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_embeddings
USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768] distance_metric=cosine
);
```

This is a **sqlite-vec** virtual table that stores 768-dimensional float32 vectors with cosine distance metric. It supports KNN (k-nearest-neighbor) queries.

### plans (relational table)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | UUIDv4 | Unique identifier |
| `title` | TEXT NOT NULL | — | Plan title |
| `content` | TEXT NOT NULL | — | Full plan content (steps, approach, considerations) |
| `tags` | TEXT NOT NULL | `'[]'` | JSON array of string tags |
| `scope` | TEXT NOT NULL | — | `global` or `workspace:<project-name>` |
| `status` | TEXT NOT NULL | `'draft'` | One of: `draft`, `active`, `completed`, `archived` — enforced by a `CHECK` constraint and mirrored in code by `PLAN_STATUS_VALUES` (`@cognistore/shared`), the source of truth every validator quotes. Changing the vocabulary means editing this `CHECK` in **both** `migrate.ts` and `migrations/0.9.0.sql` plus that constant |
| `source` | TEXT NOT NULL | `''` | Origin of the plan |
| `parent_plan_id` | TEXT | `NULL` | Plan that spawned this one. `NULL` means this plan is the ORIGINAL (root) of its chain |
| `root_plan_id` | TEXT | `NULL` | Cached first plan of the chain. `NULL` means this plan **is** the root |
| `created_at` | TEXT NOT NULL | — | ISO timestamp |
| `updated_at` | TEXT NOT NULL | — | ISO timestamp |

**Indices:**
- `idx_plans_status` on `status`
- `idx_plans_scope` on `scope`
- `idx_plans_parent_plan_id` on `parent_plan_id`
- `idx_plans_root_plan_id` on `root_plan_id`

**Lineage columns** (migration `2.4.1.sql`): `root_plan_id` is denormalized so a whole chain is one indexed lookup. There is **no foreign key** — SQLite cannot add one via `ALTER TABLE` — so a parent may dangle, a cycle may exist and a cached root may drift; every traversal in the service layer is bounded (visited set, depth 64, 500 entries) instead of trusting the data. Lineage is instance-local: `importPlans` strips both columns because ids are regenerated on import.

> Migration file versions are independent of the app version. `2.4.1.sql` ships inside the v2.4.0 release simply because `2.4.0.sql` was already applied on that branch; the runner sorts `.sql` files by semver and applies whatever is unapplied.

### plan_relations (join table)

Links plans to knowledge entries with a relation type.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Row ID |
| `plan_id` | TEXT NOT NULL FK → plans(id) ON DELETE CASCADE | Parent plan |
| `knowledge_id` | TEXT NOT NULL FK → knowledge_entries(id) ON DELETE CASCADE | Linked entry |
| `relation_type` | TEXT NOT NULL | `input` (consulted during planning) or `output` (created during execution) |
| `created_at` | TEXT NOT NULL | ISO timestamp |

**Constraints:** `UNIQUE(plan_id, knowledge_id, relation_type)`

**Indices:**
- `idx_plan_relations_plan` on `plan_id`
- `idx_plan_relations_knowledge` on `knowledge_id`

### plan_tasks (todo list per plan)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | UUIDv4 | Unique identifier |
| `plan_id` | TEXT NOT NULL FK → plans(id) ON DELETE CASCADE | Parent plan |
| `description` | TEXT NOT NULL | — | Task description |
| `status` | TEXT NOT NULL | `'pending'` | One of: `pending`, `in_progress`, `completed` |
| `priority` | TEXT NOT NULL | `'medium'` | One of: `low`, `medium`, `high` |
| `notes` | TEXT | NULL | Optional notes about progress or blockers |
| `position` | INTEGER NOT NULL | `0` | Sort order within the plan |
| `created_at` | TEXT NOT NULL | — | ISO timestamp |
| `updated_at` | TEXT NOT NULL | — | ISO timestamp |

**Indices:**
- `idx_plan_tasks_plan` on `plan_id`
- `idx_plan_tasks_status` on `status`

### plans_embeddings (virtual table)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS plans_embeddings
USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768] distance_metric=cosine
);
```

Separate sqlite-vec virtual table for plan embeddings, identical structure to `knowledge_embeddings`.

### schema_version (migration tracking)

Tracks which SQL migrations have been applied.

| Column | Type | Description |
|--------|------|-------------|
| `version` | TEXT PK | Migration version (e.g., `0.8.0`, `0.9.0`) |
| `applied_at` | TEXT NOT NULL | ISO timestamp when migration was run |

## Migration System

**Files:** `packages/core/src/db/migrations/*.sql`, `packages/core/src/db/client.ts`

Schema changes are managed through versioned SQL migration files. On startup, `createDbClient()` calls `runMigrations()` which:

1. Creates the `schema_version` table if it does not exist
2. Reads all `.sql` files from the migrations directory, sorted by version
3. Acquires an immediate transaction for each migration and rechecks its applied version under the write lock
4. Executes marked atomic scripts whole; historical unmarked scripts retain statement splitting and duplicate-column/already-exists tolerance
5. Records the version with `INSERT OR IGNORE` in the same transaction; a failure rolls back that migration

For pre-migration databases (existing databases with no `schema_version` table but with `knowledge_entries`), the runner bootstraps by running the `0.8.0` base schema and then every subsequent migration.

**Note on system knowledge:** System knowledge entries (`type=system`) are seeded via application code in `server/index.ts` during the setup configure step, not via SQL migrations. This allows the content to be updated programmatically on upgrades without requiring new migration files.

**Note on schema_version bootstrap:** When the migration runner encounters an existing database that has no `schema_version` table, it creates the table and applies `0.8.0` like any pending migration. The `0.8.0` base schema is also re-run on every open, even when it is already recorded. Its statements are all `IF NOT EXISTS`: existing tables and rows are untouched. This base-schema check runs in autocommit mode; on an up-to-date database it only reads and takes no write lock. Before 2.6 the runner only recorded `0.8.0` as applied, so a real v0.8.0 install, which never had `operations_log`, failed from 2.3.2 on (`no such table: operations_log`, the table `2.3.2` reads). That also covers such a database after an older release recorded 0.8.0 … 2.3.0 in it.

**Upgrade matrix:** `packages/tests/src/compat/upgrade-matrix.test.ts` opens one fixture per published schema (0.8.0 through 2.5.4, a 0.8.0 database after v2.1.0 opened it, and the legacy 1.3.0 `.deb` layout) with the current code and checks that no rows are lost, the FTS and embeddings are intact, search works and the migrations are idempotent. The fixtures in `packages/tests/fixtures/upgrade/` are written by each release's own SDK from its git tag (`node packages/tests/scripts/gen-upgrade-fixtures.mjs`); never edit them by hand. Published fixtures remain immutable.

```
packages/core/src/db/migrations/
├── 0.8.0.sql   # Base schema: knowledge_entries, operations_log
├── 0.9.0.sql   # Plans: plans, plan_relations, plan_tasks, title column
├── 2.4.2.sql   # Remove obsolete consumption tables
├── 2.4.3.sql   # Token usage rollups and updated_at index
├── 2.4.5.sql   # Knowledge content hashes and composite index
└── meta/
    └── _journal.json
```

## Auto-Schema Creation

**File:** `packages/core/src/db/client.ts`

The `createDbClient()` function runs versioned migrations and then creates sqlite-vec virtual tables (idempotent). This means the MCP server can initialize from scratch without the setup wizard — the SDK will create the database and schema on first use.

## SQLite Configuration

| Pragma | Value | Purpose |
|--------|-------|---------|
| `journal_mode` | `WAL` | Write-Ahead Logging for concurrent reads |
| `busy_timeout` | `5000` | Wait 5s before SQLITE_BUSY error |
| `foreign_keys` | `ON` | Enforce referential integrity |

## Vector Search Implementation

**File:** `packages/core/src/repositories/knowledge.repository.ts`

### Similarity Search Algorithm

```
Input: query vector (768-dim), options (scope, tags, type, limit, threshold)

1. KNN Phase (sqlite-vec):
   SELECT id, distance FROM knowledge_embeddings
   WHERE embedding MATCH ?
   ORDER BY distance
   LIMIT (limit * 5)  -- oversample for post-filtering

2. Post-Filter Phase (application layer):
   - Fetch full entries for KNN results
   - Filter by scope (requested scope + always include global)
   - Filter by tags (if specified, entry tags must include all query tags)
   - Filter by type (if specified)
   - Filter by expiration (exclude expired entries)
   - Convert: similarity = 1 - distance
   - Filter by threshold (default 0.3)
   - Sort by similarity descending
   - Limit to requested count

3. Return: [{ entry, similarity }]
```

### Duplicate Detection (cooperative scan, v2.6)

**Files:** `packages/core/src/services/duplicate-scan.ts` (orchestration), `duplicate-pairs.ts` (pure pair engine), `readEmbeddingsChunked` in `packages/core/src/db/schema/sqlite-vec.ts`.

`findDuplicateGroups` / `findDuplicatePairs` find every pair of non-system entries whose cosine similarity is at or above the threshold (default 0.9), the exact threshold graph, then group them with union-find. They never load `content` and never run one KNN query per entry:

SDK paths run these scans in the `JobRunner` worker, which owns a SQLite connection, reports time-sliced checkpoints, and accepts cancellation. The cleanup report uses the same worker path. The SDK result cache uses the core duplicate fingerprint, including `dup_scan_generation` so vector-only re-embedding invalidates cached results. Requests clamp group/pair counts to 1–500; each group returns at most 50 members and includes the full `memberCount`.

1. Metadata (`id, title, scope, type, version, updated_at`) in keyset pages of 5,000.
2. Every vector once, read chunk by chunk (≤1024 vectors) straight from the vec0 shadow tables `knowledge_embeddings_rowids` + `knowledge_embeddings_vector_chunks00` into one preallocated matrix, normalized as it is filled.
3. Exact pair search with Cauchy–Schwarz pruning (first 64 dimensions + tail norms), yielding to the event loop with `setImmediate` every ~15 ms. No synchronous slice reaches 100 ms on a 10k-entry base.

**Incremental state** lives in `cleanup_meta`, one row per threshold: `dup_scan_state:<threshold>` holds JSON `{ v: 1, dims, maxRowid, maxUpdated, pairs }`, and `dup_scan_state` lists the thresholds kept, most recent first (at most 3). The next scan compares only entries with a vec0 rowid above `maxRowid` or an `updated_at` at or above `maxUpdated` against the whole base. It drops pairs whose entries are gone and keeps the rest. The row is rewritten only when the outcome changed, under a 250 ms `busy_timeout`, so it never waits behind an agent's write. A missing or corrupt state, another dimension count, or rowids going backwards (the vec table was rebuilt) mean a full scan. `reembedAll` and `embedMissing` delete every `dup_scan_state*` row through retryable writes whenever they publish at least one embedding, because vector changes do not touch `updated_at`. These rows are a cache: deleting them is always safe.

**Limits:** the search stops at 20,000 pairs (`DUP_PAIR_CAP`; m identical copies make m(m−1)/2 pairs) and reports `truncated`. Such a result, or one above 10,000 pairs, is not persisted. Above 100,000 entries the scan is skipped (`MAX_SCAN_ENTRIES`; the matrix is entries × dimensions × 4 bytes). Concurrent scans of the same threshold share one run. If the vec0 shadow layout ever changes, vectors are read by primary-key lookups instead, and the scan runs in full mode only.

### Why Tags Are Embedded (Not Content)

Tags serve as semantic anchors — they are concise, intentional descriptors chosen by the agent. Content can be arbitrarily long and noisy, which dilutes embedding quality. By embedding tags:

- Search queries like "React performance" match entries tagged with `react`, `performance`, `optimization`
- Short tag text produces more focused, discriminative embeddings
- The `nomic-embed-text` model performs well on concise tag text for discriminative embeddings

### Embedding Generation

**File:** `packages/embeddings/src/client.ts`

```
Input: tags array → join with space → "react performance hooks"
POST http://localhost:11434/api/embeddings
Body: { model: "nomic-embed-text", prompt: "react performance hooks" }
Response: { embedding: [0.012, -0.045, ...] }  // 768 floats
```

## File Location

| Item | Path |
|------|------|
| Database file | `~/.cognistore/knowledge.db` |
| WAL file | `~/.cognistore/knowledge.db-wal` |
| SHM file | `~/.cognistore/knowledge.db-shm` |

The parent directory `~/.cognistore/` is created automatically by `createDbClient()` if it doesn't exist.
