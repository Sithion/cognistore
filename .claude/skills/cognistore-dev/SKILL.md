---
name: cognistore-dev
description: Conventions, invariants and checklists for changing the CogniStore codebase (monorepo, SQLite/sqlite-vec, Fastify sidecar, MCP server, Tauri). Use before editing any code in this repo, especially DB schema, migrations, sidecar routes, MCP tools, skills/hooks templates, setup/uninstall or performance-sensitive paths.
---

# CogniStore — developing in this repo

Read `CLAUDE.md` first; this skill is the working checklist that goes with it.

## Map (where things live)

| Area | Path | Notes |
|---|---|---|
| Schema (Drizzle) | `packages/core/src/db/schema/` | `knowledge.ts`, `fts.ts` (FTS5), `sqlite-vec.ts` (vec0 tables) |
| DB open + pragmas | `packages/core/src/db/client.ts` | `createDbClient()` — used by sidecar AND every MCP server process |
| Migrations | `packages/core/src/db/migrations/<semver>.sql` + `EMBEDDED_MIGRATIONS` in `packages/core/src/db/migrate.ts` | both must match (parity test) |
| Data access | `packages/core/src/repositories/knowledge.repository.ts` (~1.6k lines) | all SQL lives here |
| Business logic | `packages/core/src/services/knowledge.service.ts` (~1.6k lines) | search, plans, cleanup report |
| Merge policy (pure) | `packages/core/src/services/cleanup-merge.ts` | validation + tag derivation; LLM-free on purpose |
| Ollama clients | `packages/embeddings/src/{client,chat}.ts` | the ONLY Ollama boundary |
| Public API | `packages/sdk/src/sdk.ts` | what the sidecar and MCP server call |
| MCP server | `apps/mcp-server/src/server.ts` | 18 tools; published to npm, runs old versions in the wild |
| Sidecar (Fastify) | `apps/dashboard/server/index.ts` (~2.7k lines, one `start()` closure) | new route groups go in their own file like `cleanup-routes.ts` |
| Frontend | `apps/dashboard/src/` | React + Redux, i18n in `src/i18n/index.ts` (pt + en) |
| Agent templates | `apps/dashboard/templates/{skills,hooks,configs,plugins}/` | 3 platforms: `claude-code`, `copilot`, `opencode` |
| Tests | `packages/tests/src/{e2e,performance,load}/` | Playwright test runner; tags `@e2e`, `@perf`, `@load` |
| Active roadmap | `documentation/plans/` | execute with the `cognistore-phase` skill |

## Commands

```bash
pnpm install
pnpm build                     # turbo, all packages (tests import built dist/)
pnpm test                      # everything
pnpm --filter @cognistore/tests test:e2e
pnpm --filter @cognistore/tests test:perf
pnpm lint && pnpm type-check
node scripts/diagnose-db.mjs   # read-only size/health report of ~/.cognistore/knowledge.db
node apps/dashboard/templates/configs/compile-instructions.mjs   # after editing _base-instructions.md
```

Build before running tests after touching `packages/*` — the test package consumes `dist/`.

## Hard invariants (a PR that breaks one is wrong)

1. **Migrations**: new file `packages/core/src/db/migrations/<next-semver>.sql` AND identical statements in `EMBEDDED_MIGRATIONS[<ver>]` in `migrate.ts`.
   - Parser contract: the runner drops whole `--` comment lines, then splits on `;`. Never put `;` inside a comment or string literal; never put a trailing comment on a statement line.
   - Migration versions are independent of the app version; use the next unused semver.
   - Migrations must be **additive and backward compatible**: old MCP server builds (from npm) open the same DB. New columns need defaults; never rename/drop a column an old build reads.
2. **PATCH-NOTES.md** updated for every change (grouped by version, features/fixes/improvements).
3. **Setup/uninstall symmetry**: anything setup creates/injects, uninstall removes. Update the table in `CLAUDE.md` and the config tests when adding a skill dir, hook, config key, model pull, etc.
4. **Agent templates exist for all 3 platforms.** A new skill = `templates/skills/{claude-code,copilot,opencode}/<name>/SKILL.md`. Instruction text changes go into `_base-instructions.md` then re-compile.
5. **System entries** (`type='system'`) are never deleted, merged, exported or shown in the dashboard.
6. **App version** comes from `__APP_VERSION__` (build-time). Never read a `package.json` relative to `__dirname`.
7. **Tests that touch settings must inject their own settings accessors** — the suite runs against the developer's real `HOME` (see `maybeGenerateReport`).
8. **Consumers in the wild** (other machines, npm MCP server, injected agent configs): never remove/rename an MCP tool, tool parameter, response field or HTTP route in a minor release; only add optional things. A newer MCP server migrates the DB before the app updates — every migration must keep the previous app version working. See section 1.2 of the active plan.
9. **Destructive MCP tools** (`deleteKnowledge`, `deletePlanTask`, and any new one) get a `permissions.deny` entry injected by setup.

## Performance rules (the sidecar is single-threaded and better-sqlite3 is synchronous)

- No full-table load with `content` (`listAll()`) in a request path or a timer. Select only the columns you need; paginate.
- No per-row query loops over the whole base (N KNN calls, N `getEmbeddingById`). Batch: one query, then compute in memory.
- Anything that can exceed ~50 ms on a 10k-entry base runs as a background job (worker thread / chunked with `await new Promise(r => setImmediate(r))` between batches), never inline in a route.
- Read paths must not write synchronously. Usage signals (`markRead`, operation counters) go through a buffer flushed in one transaction.
- Many small writes = one `sqlite.transaction(() => { ... })()`.
- Use sync fs (`readdirSync`, `statSync`, `readSync`) only in startup code, never in timers.
- New queries over growing tables: check `EXPLAIN QUERY PLAN`; add an index or a rollup.
- Add/extend a `@perf` test when you touch search, listing, stats, duplicate detection, token scanning or cleanup.

## LLM (Ollama) usage rules

- All model output is untrusted: validate with a schema (see `validateMergeDraft`) and re-validate at apply time on the server.
- Every LLM feature has a deterministic fallback; Ollama down must never break a feature.
- Tags of a merged entry are derived by `computeMergedTags`, never taken from the model or the client.
- Destructive results (delete/merge/supersede) are soft and logged with a pre-change snapshot so they can be undone.

## Before you say "done"

- [ ] `pnpm build && pnpm test` (or the relevant filtered suites) pass — once Phase T lands, `pnpm verify`
- [ ] No new `knip` findings (unused files/exports/deps)
- [ ] Migration parity test passes if schema changed
- [ ] PATCH-NOTES.md updated
- [ ] Docs in `documentation/` updated if behaviour/schema/API changed (`database.md`, `api-reference.md`, `mcp-server.md`, `architecture.md`)
- [ ] Setup/uninstall table updated if a new artifact is created
- [ ] Capture what you learned in CogniStore itself (`workspace:cognistore`) — update an existing entry instead of adding a near-duplicate
