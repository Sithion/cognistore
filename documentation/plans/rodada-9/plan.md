# CogniStore v2.6 — Round 9: Phase 2 curation engine

## Original Request (verbatim)

"Rodada 9 (Fase 2 curadoria, autonomia padrão `suggest`)": the maintainer's standing instruction is to act as MANAGER and EXECUTOR of the CogniStore v2.6 plan and take it to the end alone, round by round, stopping only at human gates; follow-up message: "pode seguir". Round 9 = Phase 2 of `documentation/plans/2026-11-performance-e-curadoria.md` (curation engine with the local LLM). Fleet rule added by the maintainer: balance Codex/agy against Claude; the orchestrator only dispatches parallel agents.

## Context

Round 9 delivers Phase 2: persistent curation state, reversible actions, a bounded worker pipeline, local judgment, scheduling, and write-time prevention.  
The release starts in `suggest`; deterministic and LLM proposals share one queue.  
Existing MCP and HTTP consumers must continue working against the upgraded database.  
Phase 3 MCP tools and Phase 4 dashboard screens remain outside this round.  
This document supplies execution content only; GAIA owns persistence, dispatch, verification, and plan-task status changes.

## Ground Truth (do not re-litigate)

- The roadmap’s Phase 2 items remain unchecked. Its introductory release decision already specifies `suggest`; its policy-table header incorrectly labels `auto-safe` as default.
- Panel decisions (2026-11-03): the user-approved removal path trashes immediately; the curation queue is the surface for the Phase 4 page, the legacy cleanup-report routes stay for contract 1.2.
- **Repository correction:** the supplied reconnaissance identifies `packages/mcp`, but that directory does not exist in this checkout. The verified MCP implementation is `apps/mcp-server/src/server.ts`; its package is `apps/mcp-server/package.json`. Use these actual paths.
- The latest migration is `packages/core/src/db/migrations/2.4.5.sql`. Create `2.4.6.sql` and an identical `EMBEDDED_MIGRATIONS['2.4.6']` in `packages/core/src/db/migrate.ts`. Existing migration parity tests are in `packages/tests/src/e2e/migration-parity.test.ts`.
- `knowledge_entries` already has `content_hash`, `version`, read-retention signals, and provenance. Add curation status separately; **DO NOT repurpose `KnowledgeStatus`**, which currently describes plans.
- `KnowledgeRepository.create()` already commits the entry and embedding together. Its current KNN path retrieves `limit * 5` candidates before filtering; filtering inactive rows only after that cap would starve active results.
- `KnowledgeService.add()` currently updates a similar entry automatically at similarity ≥0.85. Round 9 replaces this implicit overwrite with insertion plus advisory neighbours. Preserve existing response envelopes and optional legacy fields.
- `applyRemovalCandidate()` currently calls `bulkDelete()`. Replace that curation path with a reversible `trash` proposal; preserve its existing response fields.
- The reusable merge invariants are in `packages/core/src/services/cleanup-merge.ts`. `buildMergeDraft()` currently lives in `apps/dashboard/server/llm-merge.ts`; do not import sidecar code into core.
- `JobRunner` and dispatch live in core, but the existing worker entry is **`packages/sdk/src/jobs/worker.ts`**, not a core `worker.ts`. SDK methods reach the runner through `packages/sdk/src/sdk.ts`.
- `OllamaChatClient.chatJson()` currently accepts temperature only and sends `format: 'json'`. Extend it additively for JSON Schema, cancellation, and `keep_alive`.
- Settings currently use synchronous filesystem access. New scheduler callbacks must use cached settings and asynchronous persistence; **NO synchronous filesystem calls in new timers**.
- The MCP contract test currently requires exact tool-schema equality against the 2.5.4 snapshot. Preserve that historical snapshot and explicitly allow only the two optional `supersedes` extensions; do not regenerate the baseline to hide drift.
- Contract 1.2 is mandatory: **NO removed or renamed MCP tools, parameters, response fields, or HTTP routes; NO new MCP tools in this round; NO destructive schema migrations**. Published MCP 2.5.3 and 2.5.4 must open and write the new database. Older clients may still surface inactive entries during the transition.
- Product decisions:
  - Autonomy is `off | suggest | auto-safe | auto`, default `suggest`.
  - `keep`-tagged and `system` entries are never changed by curation, including indirect relation/tag edits, apply, undo, supersession, and purge.
  - Archived, superseded, and trashed entries are excluded from active search, browsing, and knowledge statistics.
  - Trash preserves entry data, tags, relations, and embedding sufficient for restoration. Default retention is 30 days, configurable.
  - Old removal candidates produce trash proposals.
  - Distinct verdicts are keyed by both entries’ content hashes and versions; either changing invalidates the verdict.
  - Multiple `supersedes` IDs are one transaction: invalid, missing, protected, or otherwise inadmissible targets reject the whole operation.
  - Deterministic proposals and LLM proposals use the same persistent queue.
  - Runs persist phase and cluster cursors and remain incomplete until every phase finishes.
  - Models pulled by CogniStore have persisted ownership; uninstall removes only recorded curation-model installations, preserving pre-existing models.
- Heavy work runs in the worker or bounded chunks with yields. Request handlers do not issue per-row queries. New growing-table queries require supporting indexes.
- Fixtures are synthetic and anonymized under `packages/core/test/fixtures`. No real user database content enters the repository.
- **NO version bump, commit, push, squash merge, release, or permission-workaround changes.** Update the existing unreleased 2.6.0 patch notes. B.2 and B.14 are outside this implementation scope.

## Approach

Use four waves with few wide tasks; Wave 3 has two independent parallel tasks. Wave 1 establishes the additive storage contract. Wave 2 merges engine, judge, settings, and worker integration because the worker consumes the new judge symbols; parallel dispatch would violate symbol independence. Wave 3 splits scheduling and HTTP integration from MCP write prevention into two independent parallel tasks with disjoint files. Wave 4 runs independent evaluation/test and documentation slices.

All implementation tasks use spec tier (`role: builder`): the contracts and named tests below are binding; Artemis expands the named tests before dispatch. Documentation replacements use copy tier with exact Old → New anchors. All tasks use `executor: auto`, allowing the fleet to balance Codex and agy without pinning Claude.

Before each wave GAIA records the existing dirty tree. Executors preserve unrelated changes, touch only their owned files, and do not commit. A false premise or missing required file returns `BLOCKED: <reason>`; executors never invent another scope. Completion signals are executor report lines, not substitutes for verification.

## Tasks (execution waves)

### Wave 1 — Additive schema, storage, and active retrieval

#### Task 1.1 — Establish the curation persistence contract
executor: auto  
role: builder  
files: packages/core/src/db/migrations/2.4.6.sql, packages/core/src/db/migrate.ts, packages/core/src/db/schema/knowledge.ts, packages/core/src/db/schema/fts.ts, packages/core/src/db/schema/sqlite-vec.ts, packages/core/src/repositories/knowledge.repository.ts, packages/core/src/repositories/curation.repository.ts, packages/core/src/services/knowledge.service.ts, packages/core/src/services/duplicate-scan.ts, packages/core/src/index.ts, packages/shared/src/types/knowledge.ts, packages/core/test/curation-storage.test.ts, packages/core/test/knowledge-repository.test.ts, packages/core/test/migrations-atomic.test.ts, packages/tests/src/e2e/migration-parity.test.ts, packages/tests/src/compat/mcp-matrix.test.ts  
context: packages/core/src/db/client.ts, packages/core/test/helpers.ts, packages/core/src/jobs/content-hash.ts, packages/tests/src/mcp-helpers.ts, packages/tests/src/compat/upgrade-matrix.test.ts  

````brief
Implement Phase 2 items 2.1a-c and 2.1e as one storage chain. Preserve unrelated changes. If an existing premise differs, return BLOCKED with the exact mismatch; do not improvise a different migration or package path.

1. Add atomic migration 2.4.6.sql, with an identical embedded string:
   - knowledge_entries.status TEXT NOT NULL DEFAULT 'active', constrained to active/superseded/archived/trashed.
   - Nullable superseded_by, curated_at, trashed_at.
   - curation_runs: roadmap fields id, started_at, finished_at, trigger, model, budget, stats; additionally status, cursor JSON, updated_at, lease_owner, lease_expires_at. Status is running/paused/completed/failed; finished_at remains NULL unless terminal.
   - curation_actions: all roadmap fields, with kind, actor, JSON snapshots, confidence, and proposed/applied/undone/rejected status. Add payload JSON, expected_versions JSON, idempotency_key, applied_at, undo_expires_at, and updated_at.
   - curation_verdicts: canonical ordered pair IDs plus both content hashes and versions, verdict, confidence, reason, model, judged_at. The ordered pair/version/hash tuple is unique.
   - curation_activity: one singleton row containing last_seen_at. This is installation activity, not a growing event log.
   - Index active entries by scope/updated_at/id and scope/content_hash/id using partial status='active' indexes; index status/trashed_at/id for retention and status/curated_at/id for superseded aging. Index queue status/created_at/id, actions run_id, run status/updated_at/id, verdict pair IDs, and unique action idempotency_key.
   - No foreign key from historical action IDs that prevents entry purge. No migration trigger may depend on a newly registered application function unavailable to old npm MCP processes.
   - Retain migration-runner backup, transaction, locking, and applied-version behavior. Reopening must not execute ALTER TABLE again.

2. Migrate existing valid leading "[SUPERSEDED by X]" markers to status superseded and superseded_by=X only when X resolves to another entry and neither participant is protected. Preserve title/content rather than deleting historical text. Malformed, dangling, self-referential, and protected cases remain active. Set curated_at from the old updated_at so aging is deterministic.
   Keep deprecated tags and content intact; the later engine treats them as rule candidates.
   The data migration must not change any keep-tagged or system entry.

3. Add a separate entry-status type and optional additive curation fields to KnowledgeEntry. Do not alter the plan KnowledgeStatus enum.
   Map the new fields in KnowledgeService serialization without dropping any existing field.

4. Create CurationRepository for paged runs/actions/verdicts, lease acquisition, snapshot capture, and synchronous transaction primitives.
   Snapshot format version 1 contains original entry fields, exact embedding bytes encoded as base64 with dimensions, outgoing relatedIds, incoming references, and plan_relations. Preserve absent embeddings explicitly. Reads are batched by IDs and bounded pages, never listAll().
   Expose storage primitives for the following wave; no LLM or scheduling dependencies.
   Reject stale action claims using captured versions, hashes, status, and protection checks inside the committing transaction.

5. Enforce status='active' across knowledge list/recent/tags/scopes/statistics, semantic and hybrid retrieval, plan-context augmentation, stale/deprecated/unread candidates, and duplicate-scan metadata/cache fingerprints.
   Keep explicit by-ID/history/snapshot access capable of loading inactive records.
   Apply eligibility before KNN/FTS LIMIT, or use a bounded worker-compatible retrieval strategy that demonstrably fills the requested active result count. Simply filtering the current limit*5 candidates is unacceptable.
   Preserve sqlite-vec and old-MCP compatibility: do not replace its existing table with an incompatible definition.
   Inactive rows may retain their vector/FTS data for restore; retrieval must join/filter authoritative status. Invalidate duplicate caches on status transitions.
   Knowledge statistics count active entries; historical operation telemetry and physical embedding-health diagnostics retain their existing meanings.

6. Add/extend tests, with these exact test names and behaviors:
   curation-storage.test.ts:
   - "2.4.6 upgrades and reopens without losing legacy rows": defaults, marker conversion, protected rows, invalid markers, deprecated preservation.
   - "curation migration failure rolls back schema and version": injected statement failure leaves no partially applied migration.
   - "snapshots round-trip tags vectors incoming references and plan relations": exact data restoration inputs.
   - "queue pagination and leases use bounded indexed queries": deterministic pagination, single lease owner, expiry takeover.
   knowledge-repository.test.ts:
   - "inactive entries never enter active lists statistics semantic FTS or plan context".
   - "inactive nearest neighbours do not starve active top-k": inactive rows exceed the old five-times candidate cap.
   - "status transitions invalidate duplicate scan state".
   migrations-atomic.test.ts: retain existing transaction/reopen cases and include 2.4.6.
   migration-parity.test.ts:
   - "2.4.6 disk and embedded bytes are identical": compare the new SQL and embedded value exactly.
   mcp-matrix.test.ts:
   - "published 2.5.x can read and write after curation migration": both existing npm versions operate on a database containing every new status/table, without requiring new SQL functions.

Artemis expands these named tests before execution. Do not run broad suites in this task; GAIA owns the commands in Verification.
Completion signal: R9-W1 storage complete
````

### Wave 2 — Engine, judge, settings, and worker

#### Task 2.1 — Implement the bounded reversible pipeline and its local judge
executor: auto  
role: builder  
files: packages/core/src/services/curation-types.ts, packages/core/src/services/curation-engine.ts, packages/core/src/repositories/curation.repository.ts, packages/core/src/services/knowledge.service.ts, packages/core/src/jobs/protocol.ts, packages/core/src/jobs/dispatch.ts, packages/core/src/index.ts, packages/sdk/src/jobs/worker.ts, packages/sdk/src/sdk.ts, packages/embeddings/src/chat.ts, packages/embeddings/src/curation-judge.ts, packages/embeddings/src/index.ts, apps/dashboard/server/settings.ts, packages/core/test/curation-engine.test.ts, packages/core/test/curation-actions.test.ts, packages/core/test/curation-judge.test.ts, apps/dashboard/server/test/settings.test.ts, packages/tests/src/e2e/cleanup-report.test.ts  
context: packages/core/src/services/cleanup-merge.ts, packages/core/src/jobs/runner.ts, packages/core/src/services/duplicate-pairs.ts, packages/core/test/helpers.ts, packages/embeddings/src/client.ts, apps/dashboard/server/llm-merge.ts  

````brief
Implement 2.1d, 2.2, 2.3, and 2.4b-d in one sequential builder chain. Engine and judge are deliberately merged: the SDK worker consumes the new judge implementation. Core must not gain an embeddings-package dependency or import sidecar files. Return BLOCKED on false premises; preserve unrelated changes.

1. Publish core curation types:
   - CurationAutonomy: off|suggest|auto-safe|auto.
   - JudgeInput contains task kind, bounded entry data, candidate IDs, hashes/versions, and optional aging neighbours.
   - JudgeResult contains validated verdict, confidence [0,1], nonempty reason, and task-specific candidate IDs/payload.
   - CurationJudge is an injected asynchronous interface accepting AbortSignal; core never constructs an Ollama client.
   - CurationOptions contains autonomy, time/item budgets, retention, cluster threshold, deprecated inactivity days, model, trigger, and optional runId.
   - Engine entry points run/resume, apply, reject, undo, and purge use CurationRepository.
   - SDK methods expose these capabilities to the sidecar without adding MCP tools.

2. Extend chatJson additively with optional JSON Schema format, keepAlive, and AbortSignal. Existing callers still receive parsed objects or null and retain format:'json' behavior when no schema is supplied.
   CurationJudgeClient lives in packages/embeddings/src/curation-judge.ts and uses structural input/output types without importing core.
   Use Ollama format JSON Schema, temperature 0, keep_alive:'2m', bounded prompts, and runtime validation. Verdict IDs must belong to the submitted candidates.
   Support cluster duplicate/supersedes/complementary/distinct, aging still_valid/outdated/unsure, and tag/title proposal payloads.
   Invalid JSON/schema/confidence/IDs, HTTP errors, timeout, cancellation, and unavailable models cannot authorize a mutation.
   Use configured model when available, then installed llama3.2:3b fallback. Background jobs never download a model. No result means deterministic-only processing, not a fabricated distinct verdict.
   Reuse core merge validation and deterministicMergeDraft for lossless fallback. Keep the existing sidecar buildMergeDraft export working.
   The judge prompt presents entry text only as quoted data delimited from the instructions; it has no tools or free-form actions, and entry text is never interpolated into instructions.

3. Add settings, sanitization, and defaults:
   curationAutonomy='suggest';
   curationBudgetMs=900000, bounded 1000..3600000;
   curationMaxClusters=50, bounded 1..500;
   curationMaxItems=500, bounded 1..5000;
   curationTrashRetentionDays=30, bounded 1..3650;
   curationClusterThreshold=0.85, bounded 0.8..1;
   curationDeprecatedUnreadDays=180, bounded 30..3650;
   curationIdleMinutes=10, bounded 1..1440;
   curationMinIntervalHours=24, bounded 24..8760;
   curationModel='llama3.2:3b', validated with the existing model-name validator.
   Add installedCurationModels:string[] as an internally managed ownership ledger: validate/deduplicate names and default to [].
   Preserve unknown settings and existing cleanup settings.
   Provide asynchronous settings persistence for scheduler/model ownership with serialized atomic writes so concurrent patches do not overwrite each other. Existing synchronous accessors remain supported outside timer paths.
   Public settings updates must not let callers forge installed-model ownership.

4. Implement phases in order, each checkpointed:
   a. Deterministic: identical normalized content hash within an eligible scope keeps newest updated_at, then created_at, then ID as tie-breaker; expired entries; superseded entries older than 14 days; deprecated entries unread for the configured interval.
   b. Cluster: similarity >= configured threshold; same workspace plus global, never two unrelated workspaces; connected components, deterministically split to <=8 members, deduplicating overlapping global pairs.
   c. Judge: duplicate -> validated lossless merge; supersedes -> explicit directed replacement; complementary -> reversible relation changes; distinct -> version/hash-keyed verdict.
   d. Aging: score =
      0.35*min(ageDays/365,1)
      +0.25*min(unreadDays/180,1)
      +0.15/(1+readCount)
      +0.15*(1-confidenceScore)
      +0.10*typeWeight.
      typeWeight is 1 for workspace gotcha/fix, 0.25 for decision/constraint, 0.5 otherwise. Age/unread values are nonnegative. Subtract 0.10, floored at zero, when another active entry in that scope changed within 30 days. Threshold 0.70 invokes judgment with up to three newer active same-scope neighbours. Only outdated proposes trash; still_valid/unsure do not.
   e. Light restructuring: synonym-map and empty/generic title proposals; generic means a case-insensitive exact match of note, notes, update, or untitled. Validate title limits and prohibit content invention. Tag rewrites must target eligible entries only; never call an unrestricted global tag rename that would change protected entries.

5. Apply policy centrally:
   off: no run/proposals/purge; explicit review/undo remains available.
   suggest: every deterministic or LLM mutation is proposed.
   auto-safe: deterministic actions and merge/supersede >=0.85 apply; other actions stay proposed.
   auto: deterministic actions apply, merge/supersede >=0.70 apply, outdated aging and validated restructuring apply; lower-confidence merges remain proposed.
   Complementary relation changes remain proposed in suggest/auto-safe and apply in auto.
   Distinct verdict caching is bookkeeping, never an entry mutation.
   Recheck keep/system, eligibility, versions, hashes, and scope inside every application transaction. If any participant is protected, reject the entire multi-entry action.

6. Persist idempotent action creation and phase/cluster cursors. Budget exhaustion, AbortSignal, worker cancellation, or crash leaves a resumable incomplete run with finished_at=NULL. Commit an action and its cursor advancement together. Do not hold a transaction across await/LLM calls. Re-read and compare versions before commit.
   Use database leases to prevent simultaneous sidecar/MCP processes from running curation. Expired leases allow restart recovery.
   Preserve failures separately from completion. Mark completed only after every phase and its final checkpoint.

7. All entry-changing actions have before snapshots and post-apply guards. Undo is atomic, restores vectors/tags/relations/status, and rejects stale/conflicting or expired restores rather than overwriting subsequent work. Merge losers are retained reversibly; no eager permanent delete.
   Purge only trash older than configured retention, in bounded worker batches. Recheck protections. Delete vectors, FTS, plan relations, dangling relatedIds, and entry rows; redact expired entry payload/vector copies from historical snapshots so purge really removes recoverable content. Preserve non-content audit metadata.
   The new retention worker runs only when autonomy is enabled; due purge is housekeeping for previously applied trash, not approval of a new suggestion.

8. Replace applyRemovalCandidate's bulkDelete path. The user's explicit approval creates AND applies a reversible `trash` action immediately (entry status `trashed`, snapshot taken, retention per settings, default 30 days); autonomy `suggest` governs only autonomous proposals. Preserve the response fields: `deleted` counts the entries moved to trash, `skipped`/`errors` keep their meaning, `deletedSnapshot` keeps its shape; add action metadata. Idempotent (same candidate twice creates one action). No physical deletion from this method. Update `packages/tests/src/e2e/cleanup-report.test.ts` (around lines 221-276): keep `deleted` expectations, and additionally assert the entry is absent from active lists and present as trashed and restorable; never delete or weaken an assertion.

9. Extend JobKind/JobPayloads/JobResults/JobProgress and dispatch for curation run/apply/reject/undo/purge/activity. Construct/inject the judge in the existing SDK worker, not in core. Pass serializable settings in payloads. Honor existing checkpoint acknowledgments, cancellation, and shutdown behavior.
   Heavy scans, snapshots, apply/undo batches, and purge run there. Progress is monotonic semantic state, not a required timing sequence.

10. Add exact named tests:
   curation-engine.test.ts:
   - "suggest queues deterministic and LLM actions without changing entries".
   - "off skips pipeline and purge".
   - "autonomy matrix enforces confidence thresholds".
   - "clusters respect workspace boundaries global inclusion and eight-member cap".
   - "distinct cache invalidates when either hash or version changes".
   - "aging and restructuring produce bounded eligible proposals".
   - "budget and cancellation resume every phase without duplicate actions".
   - "expired lease resumes an interrupted run".
   curation-actions.test.ts:
   - "merge undo restores entries vectors tags and relations atomically".
   - "stale apply and undo reject without partial writes".
   - "keep and system survive every direct and indirect curation operation".
   - "trash purge respects retention and removes dependencies and snapshot payloads".
   - "legacy removal creates one trash proposal and deletes nothing".
   curation-judge.test.ts:
   - "judge sends JSON Schema keep_alive configured model and cancellation".
   - "invalid judgments never authorize changes".
   - "missing Ollama preserves deterministic processing without pulling".
   - "installed three-billion fallback preserves model attribution".
   settings.test.ts:
   - "curation defaults to suggest and clamps every budget and retention setting".
   - "curation model ownership is validated and cannot be forged by public patches".
   - "async settings patches serialize without losing unrelated values".

Artemis expands these tests before dispatch. GAIA owns builds and test execution.
Completion signal: R9-W2 engine judge and worker complete
````

### Wave 3 — Scheduling, additive HTTP, and write prevention

The two tasks below are independent slices with disjoint files and may run in parallel.

#### Task 3.1 — Sidecar scheduler, routes and model ownership
executor: auto  
role: builder  
files: apps/dashboard/server/curation-routes.ts, apps/dashboard/server/curation-scheduler.ts, apps/dashboard/server/curation-models.ts, apps/dashboard/server/index.ts, apps/dashboard/server/settings.ts, apps/dashboard/server/cleanup-routes.ts, apps/dashboard/server/llm-merge.ts, apps/dashboard/server/test/curation-scheduler.test.ts, apps/dashboard/server/test/curation-models.test.ts, apps/dashboard/server/test/settings.test.ts, CLAUDE.md  
context: apps/dashboard/server/auth.ts, apps/dashboard/server/worker-path.ts, packages/core/src/services/curation-types.ts, packages/core/src/jobs/protocol.ts  

````brief
Implement 2.4a and 2.5a-b with scheduler and uninstall integration. Preserve all existing tool names, parameters, annotations, response envelopes, and HTTP routes. Add no MCP tools. Return BLOCKED on a false premise and leave unrelated changes alone.

1. Add authenticated HTTP routes:
   POST /api/curation/run with optional runId -> 202 {runId,status}; duplicate scheduling returns the current run rather than spawning another.
   GET /api/curation/runs/:id -> {run}; missing ->404.
   GET /api/curation/queue?scope=&limit=&cursor= -> {actions,nextCursor}; limit defaults 50, max100.
   POST /api/curation/actions/:id/apply -> {action}.
   POST /api/curation/actions/:id/reject -> {action}.
   POST /api/curation/actions/:id/undo -> {action}.
   POST /api/curation/model/prepare -> installation result for the configured model; this is the only new curation pull path.
   Validate IDs/body/query; invalid ->400, stale/protected/conflicting ->409, not ready ->503. Keep current auth/CSRF enforcement.
   Action endpoints dispatch bounded worker work; run returns before the full pipeline finishes. Responses expose no unbounded snapshot blobs.
   The queue endpoint returns only id, kind, status, confidence, titles and entry ids per action (no snapshot or entry content); content is loaded on demand for a single action.

2. Scheduler uses injected clock, cached settings, activity source, readiness/upgrade/maintenance gates, and worker dispatch.
   Check at one-minute intervals, unref and dispose timers on shutdown.
   Require ten idle minutes and at least 24 hours between newly started automatic runs, using configured settings. Persist daily scheduling state in runs; restart must not reset the interval.
   Resume incomplete runs when eligible, rather than start another; continuation chunks are not new daily runs.
   Manual runs bypass idle/daily gates but still honor autonomy off, leases, budgets, readiness, and upgrade/maintenance exclusion.
   Catch background rejections; do not mark failed starts completed.
   Keep existing cleanup-report APIs. Stop the legacy automatic report timer/startup invocation from competing with the curation scheduler; manual report generation remains supported.
   Every new settings key is written through the async serialized writer only; the existing synchronous accessors stay read-only.

3. Count actual MCP/API calls toward shared idle activity.
   Sidecar request hooks update an in-memory timestamp coalesced through the Wave 2 activity job into curation_activity; no synchronous write on a read path, no per-call event table, and no sync filesystem access in timers.
   Exclude scheduler-internal operations from activity. Until pending activity persistence is acknowledged, scheduling conservatively treats that process as active. Failure to establish reliable shared activity prevents automatic dispatch and is logged.
   Preserve request handlers' existing behavior.

7. Model preparation uses the configured valid name and async Ollama operations. Recommend qwen2.5:7b-instruct for machines with sufficient RAM in the response/documented configuration, retaining the installed 3B fallback.
   Check availability first. Record ownership only when CogniStore actually installs a previously absent model. Persist the actual pulled name, not only the current selection, so changing models does not lose ownership.
   Serialize preparation and retain recoverable installation state if ownership persistence fails.
   Scheduler/model fallback never silently downloads a 7B model.
   Prevent the legacy merge-preview/uninstall path from removing a pre-existing model also used by curation; share accurate ownership accounting where these paths intersect.
   Ollama is invoked through its HTTP API or an argv array, never a shell string; the model name is validated before use and before it is written to installedCurationModels.

8. Read the curation ownership ledger before uninstall removes settings. Validate names, deduplicate shared cleanup/curation names, preserve pre-existing/unrecorded curation models, and remove each owned model once. Keep unrelated uninstall behavior and embedding policy intact.

9. Mechanical documentation edit: verify the quoted old text matches exactly before replacing; if it does not, STOP and report BLOCKED.
   In CLAUDE.md, replace the following row with the two rows below.

Old:
```text
| Pull cleanup LLM model via Ollama API (first consolidation preview) | Remove via `ollama rm <cleanupLlmModel>` — name read from `settings.json` **before** the directory is removed, re-validated, `llama3.2:3b` fallback; skipped when never pulled |
```

New:
```text
| Pull cleanup LLM model via Ollama API (first consolidation preview) | Remove recorded app-installed cleanup models once; read ownership before directory removal, validate names, and preserve pre-existing models |
| Pull curation model via explicit model preparation | Record each model actually installed by CogniStore in settings; uninstall removes only recorded installations once, preserves pre-existing models, and reads ownership before directory removal |
```

10. Add exact named tests:
    curation-scheduler.test.ts:
    - "idle daily scheduling survives restart and resumes incomplete runs".
    - "manual run bypasses idle but respects off upgrades and leases".
    - "MCP and API activity postpone scheduling without synchronous timer IO".
    - "scheduler shutdown clears timers and catches dispatch failures".
    curation-models.test.ts:
    - "model preparation records only installations made by CogniStore".
    - "model switches preserve ownership and uninstall removes each owned model once".
    - "pre-existing shared models survive preview and uninstall".
    - "failed ownership persistence is recoverable without an untracked installation".
    settings.test.ts: public patches cannot forge ownership; cached scheduler settings refresh after PUT.

Artemis expands these named tests. GAIA owns build/test commands.
Completion signal: R9-W3a sidecar scheduler and models complete
````

#### Task 3.2 — Write path: neighbours, supersedes, MCP
executor: auto  
role: builder  
files: packages/core/src/services/knowledge.service.ts, packages/core/src/repositories/knowledge.repository.ts, packages/core/src/repositories/curation.repository.ts, packages/sdk/src/sdk.ts, packages/shared/src/types/knowledge.ts, packages/shared/src/utils/validation.ts, apps/mcp-server/src/server.ts, packages/core/test/curation-writes.test.ts, packages/core/test/knowledge-service.test.ts, packages/core/test/knowledge-service-more.test.ts, packages/tests/src/contract/mcp-contract.test.ts, packages/tests/src/e2e/sdk-knowledge.test.ts  
context: packages/core/src/services/curation-types.ts, packages/core/src/jobs/protocol.ts, packages/tests/src/contract/mcp-contract.snapshot.json  

````brief
Implement 2.4a and 2.5a-b with scheduler and uninstall integration. Preserve all existing tool names, parameters, annotations, response envelopes, and HTTP routes. Add no MCP tools. Return BLOCKED on a false premise and leave unrelated changes alone.

3. Count actual MCP/API calls toward shared idle activity.
   MCP handler wrappers report activity without modifying schemas or annotations.
   MCP handler wrappers report activity by calling the SDK method added in Wave 2 (coalesced, never a synchronous write on a read path); if the MCP process cannot reach that method, return BLOCKED instead of writing from a handler path.
   No per-call event table and no sync filesystem access in timers.
   Exclude scheduler-internal operations from activity. Until pending activity persistence is acknowledged, scheduling conservatively treats that process as active. Failure to establish reliable shared activity prevents automatic dispatch and is logged.
   Preserve request handlers' existing behavior.

4. addKnowledge must insert rather than automatically overwrite a similar entry. Before insertion, obtain up to five active neighbours with similarity >=0.88 from the exact same scope; no implicit global expansion for this advisory query.
   Return additive similarExisting:[{id,title,similarity}] and, when nonempty, hint:"considere updateKnowledge(id) em vez de criar".
   Advisory lookup failure never blocks insertion. Preserve existing response fields/envelopes and provenance. Existing skipDedup input remains accepted; it may suppress advisory lookup but must never restore overwrite behavior.
   Update legacy unit expectations to pin the new intentional insertion behavior.
   `deduplicated` stays an optional response field and is never set to true after this change; update `packages/core/test/knowledge-service.test.ts` (lines ~26 and ~39) and `packages/tests/src/e2e/sdk-knowledge.test.ts` (line ~227) to the new insert-with-hint behaviour by flipping those expectations (assert two entries exist and `similarExisting` lists the neighbour); never delete or weaken an assertion.

5. Add optional supersedes?:string[] to shared create/update types and schemas, SDK forwarding, nested single/batch addKnowledge entry schema, and updateKnowledge MCP schema.
   On update, return the same advisory fields computed for the resulting content, excluding self.
   Deduplicate IDs. Reject self-reference, malformed/missing ID, protected source or target, non-active target, scope mismatch, and supersession cycles. Scope must match exactly.
   Empty/omitted supersedes is a normal write.
   Compute embeddings and advisory data before the write transaction, then revalidate every ID/protection/version inside it.
   Commit creation/update, embedding, FTS, old-entry statuses, superseded_by links, and applied audit action together. Any failure rolls everything back, including the new entry. Do not swallow supersedes errors in best-effort neighbour handling.
   This explicit caller write applies independently of autonomous suggest policy.
   Atomicity is per add/update operation and its supersedes array; do not change existing MCP batch envelope/partial-operation semantics.

6. Keep the 2.5.4 contract snapshot unchanged. Update its test to strip only the newly permitted optional supersedes property at the exact addKnowledge object/array entry paths and updateKnowledge path before comparison.
   Assert the stripped schema is optional string-array input and no existing required list changed. Compare every remaining schema value, tool name, annotation, and historical response field exactly.
   Do not broadly permit arbitrary schema additions or regenerate the baseline.

10. Add exact named tests:
    curation-writes.test.ts:
    - "similar add inserts and reports exact-scope active neighbours".
    - "advisory failure still inserts without overwriting existing knowledge".
    - "supersedes commits entry vectors status and audit together".
    - "invalid protected stale or cyclic supersedes rolls back every write".
    - "update supersedes returns neighbours and preserves provenance".
    mcp-contract.test.ts:
    - "only optional supersedes extensions differ from the frozen input contract".
    Preserve existing all-tools response compatibility assertions.

Artemis expands these named tests. GAIA owns build/test commands.
Completion signal: R9-W3b write path and MCP complete
````

### Wave 4 — Evaluation, end-to-end coverage, and release notes

The two slices below have disjoint owned files and no sibling-generated dependencies. Task 4.1 reads implementation from completed waves; Task 4.2 performs only the quoted documentation replacements.

#### Task 4.1 — Add synthetic evaluation and full curation scenarios
executor: auto  
role: builder  
files: packages/core/test/fixtures/curation-eval.json, packages/core/test/curation-eval.test.ts, packages/tests/scripts/curation-eval.ts, packages/tests/src/e2e/curation-r9.test.ts, packages/tests/src/compat/curation-r9.test.ts, packages/tests/src/api/sidecar-api.test.ts  
context: packages/core/src/services/curation-types.ts, packages/embeddings/src/curation-judge.ts, packages/core/test/helpers.ts, packages/tests/src/sidecar-helpers.ts, packages/tests/src/mcp-helpers.ts  

````brief
Implement 2.6a-b as test/evaluation artifacts only. Do not change product code to fit test expectations. Return BLOCKED for implementation-contract gaps.

1. Create exactly 60 synthetic, manually labeled pairs: 15 duplicate, 15 supersedes, 15 complementary, 15 distinct.
   Each fixture has stable ID, two synthetic entries, expected verdict, directed winner when applicable, and English rationale. Include version conflicts, negation, near-identical distinct facts, complementary facts, and ambiguous wording.
   Use fictitious workspace labels and example.invalid where a domain is needed. No exports, snippets, identities, paths, secrets, or facts copied from the user's knowledge database.

2. Create packages/tests/scripts/curation-eval.ts, runnable through tsx.
   The script refuses an --output path that does not resolve inside the workspace; run via the dashboard's tsx (packages/tests declares no tsx; add no dependency).
   Flags: --model <name> repeatable, --host <url>, --output <workspace-path>.
   Default models are llama3.2:3b and qwen2.5:7b-instruct. No automatic pull.
   Evaluate through the actual judge. Report per-model availability, completed/invalid counts, confusion matrix, accuracy, false-duplicate count, and confidence>=0.85 decision precision/coverage.
   Qualification requires all 60 judgments valid, accuracy>=0.85, and zero false duplicate verdicts. Unavailable/invalid/incomplete results are unqualified, never counted as correct or silently skipped.
   Write JSON only to the requested workspace output. Print one summary per model and a final "curation-eval: complete" or "curation-eval: unavailable" line.
   Qualification never changes the default autonomy or settings.

3. curation-eval.test.ts:
   - "synthetic corpus contains sixty balanced labeled pairs with stable IDs".
   - "evaluation scoring counts invalid answers and false duplicates conservatively".
   - "model qualification requires complete accuracy and zero false duplicate verdicts".
   Unit tests use scripted judgments; never require a live model.

4. curation-r9.test.ts under e2e contains exactly these eight tests:
   - "suggest run queues rule and LLM proposals without changing knowledge".
   - "approved merge and undo restore searchable content vectors and relations".
   - "supersedes is atomic through HTTP and existing MCP tools".
   - "retention purges expired trash and preserves recoverable recent trash".
   - "autonomy levels preserve keep and system entries".
   - "interrupted budgeted worker resumes without duplicated actions".
   - "manual scheduling and queue routes enforce authentication and conflicts".
   - "model preparation and uninstall preserve pre-existing models".
   Use sandbox HOME/COGNISTORE_HOME, temporary SQLite, deterministic mock Ollama, and controlled clocks/checkpoints. Never invoke real uninstall or real ollama rm. Assert semantic progress, not exact event timing.

5. curation-r9.test.ts under compat contains exactly these four tests:
   - "old npm MCP writes active-default entries after 2.4.6".
   - "bundled worker runs curation against disk and embedded migration databases".
   - "curation additions preserve historical HTTP routes and response fields".
   - "new optional supersedes survives single batch and update MCP boundaries".
   Reuse the existing npm launch matrix and sandbox rules; missing npm coverage is a reported verification limitation, not a pass.

6. Extend sidecar-api.test.ts inventory for the new additive routes while preserving old route assertions.
   Keep fixtures/evaluation independent from documentation changes in the sibling task.
   Artemis expands these named tests before execution. GAIA owns all test and live-evaluation execution.
Completion signal: R9-W4 evaluation and integration artifacts complete
````

#### Task 4.2 — Update unreleased notes and correct roadmap policy
executor: auto  
role: builder  
files: PATCH-NOTES.md, documentation/plans/2026-11-performance-e-curadoria.md  

````brief
Copy-tier edits only. Preserve unrelated changes. Verify the quoted old text matches exactly before replacing; if it does not, STOP and report BLOCKED. Do not tick roadmap items or update plan-task status: GAIA owns completion bookkeeping. Do not bump any version.

In PATCH-NOTES.md, replace the following paragraph with the paragraph and Round 9 notes below.

Old:
```text
**Performance and knowledge curation.** Work in progress on `release/2.6` — see `documentation/plans/2026-11-performance-e-curadoria.md`.
```

New:
```text
**Performance and knowledge curation.** Work in progress on `release/2.6` — see `documentation/plans/2026-11-performance-e-curadoria.md`.

### Round 9 — Curation engine
- Curation defaults to `suggest`: deterministic rules and local-model judgments share a persistent proposal queue.
- Indexed active-entry filtering excludes archived, superseded, and trashed knowledge from active retrieval and statistics.
- Bounded worker runs resume from saved checkpoints; applied actions support guarded undo, and trash retains restoration data until its configured retention expires.
- Optional `supersedes` on existing knowledge writes applies atomically; similar-entry hints help prevent accidental duplication.
- Local judgment uses validated structured output, configurable models, and deterministic processing when Ollama is unavailable.
- Explicit curation-model preparation records installation ownership so uninstall preserves pre-existing models.
- Synthetic evaluation fixtures and compatibility coverage exercise curation without including private knowledge.
```

In documentation/plans/2026-11-performance-e-curadoria.md, replace the policy-table header.

Old:
```text
| Ação | `suggest` | `auto-safe` (padrão) | `auto` |
```

New:
```text
| Ação | `suggest` (padrão na 2.6.0) | `auto-safe` | `auto` |
```

In documentation/plans/2026-11-performance-e-curadoria.md, replace the evaluation item to match the fixed synthetic-corpus decision.

Old:
```text
- [ ] Conjunto de avaliação: ~60 pares rotulados à mão do banco real (duplicate/supersedes/complementary/distinct). Teste mede acurácia do juiz por modelo; meta ≥ 85% em `auto-safe` sem falso "duplicate".
```

New:
```text
- [ ] Conjunto de avaliação: 60 pares sintéticos e anonimizados, rotulados à mão (duplicate/supersedes/complementary/distinct), versionados em `packages/core/test/fixtures`. Teste mede acurácia do juiz por modelo; meta ≥ 85% em `auto-safe` sem falso "duplicate". Resultados incompletos ou modelos indisponíveis não qualificam o modelo; o padrão da 2.6.0 permanece `suggest`.
```

Completion signal: R9-W4 documentation complete
````

## Files to Modify

All paths below are absolute. “Create” paths are proposed artifacts; their parent directories and existing neighboring implementations were verified.

| Area | Files | Waves |
|---|---|---|
| Migration | `packages/core/src/db/migrations/2.4.6.sql` (create)<br>`packages/core/src/db/migrate.ts` | 1 |
| Knowledge schema and retrieval | `packages/core/src/db/schema/knowledge.ts`<br>`packages/core/src/db/schema/fts.ts`<br>`packages/core/src/db/schema/sqlite-vec.ts` | 1 |
| Repositories | `packages/core/src/repositories/knowledge.repository.ts`<br>`packages/core/src/repositories/curation.repository.ts` (create) | 1–2, 3.2 |
| Core services | `packages/core/src/services/knowledge.service.ts`<br>`packages/core/src/services/duplicate-scan.ts`<br>`packages/core/src/services/curation-types.ts` (create)<br>`packages/core/src/services/curation-engine.ts` (create) | 1–2, 3.2 |
| Core exports and jobs | `packages/core/src/index.ts`<br>`packages/core/src/jobs/protocol.ts`<br>`packages/core/src/jobs/dispatch.ts` | 1–2 |
| Shared boundary | `packages/shared/src/types/knowledge.ts`<br>`packages/shared/src/utils/validation.ts` | 1, 3.2 |
| SDK and worker | `packages/sdk/src/sdk.ts`<br>`packages/sdk/src/jobs/worker.ts` | 2, 3.2 |
| Ollama boundary | `packages/embeddings/src/chat.ts`<br>`packages/embeddings/src/curation-judge.ts` (create)<br>`packages/embeddings/src/index.ts` | 2 |
| MCP | `apps/mcp-server/src/server.ts` | 3.2 |
| Sidecar integration | `apps/dashboard/server/index.ts`<br>`apps/dashboard/server/settings.ts`<br>`apps/dashboard/server/cleanup-routes.ts`<br>`apps/dashboard/server/llm-merge.ts` | 2, 3.1 |
| New sidecar modules | `apps/dashboard/server/curation-routes.ts`<br>`apps/dashboard/server/curation-scheduler.ts`<br>`apps/dashboard/server/curation-models.ts` (all create) | 3.1 |
| Existing core tests | `packages/core/test/knowledge-repository.test.ts`<br>`packages/core/test/migrations-atomic.test.ts`<br>`packages/core/test/knowledge-service.test.ts`<br>`packages/core/test/knowledge-service-more.test.ts` | 1, 3.2 |
| New core tests | `packages/core/test/curation-storage.test.ts`<br>`packages/core/test/curation-engine.test.ts`<br>`packages/core/test/curation-actions.test.ts`<br>`packages/core/test/curation-judge.test.ts`<br>`packages/core/test/curation-writes.test.ts`<br>`packages/core/test/curation-eval.test.ts` (all create) | 1–2, 3.2, 4 |
| Sidecar tests | `apps/dashboard/server/test/settings.test.ts`<br>`apps/dashboard/server/test/curation-scheduler.test.ts` (create)<br>`apps/dashboard/server/test/curation-models.test.ts` (create) | 2, 3.1 |
| Evaluation | `packages/core/test/fixtures/curation-eval.json` (create)<br>`packages/tests/scripts/curation-eval.ts` (create) | 4 |
| Existing integration contracts | `packages/tests/src/e2e/migration-parity.test.ts`<br>`packages/tests/src/compat/mcp-matrix.test.ts`<br>`packages/tests/src/contract/mcp-contract.test.ts`<br>`packages/tests/src/api/sidecar-api.test.ts` | 1, 3.2, 4 |
| Existing SDK knowledge E2E | `packages/tests/src/e2e/sdk-knowledge.test.ts` | 3.2 |
| Existing cleanup report E2E | `packages/tests/src/e2e/cleanup-report.test.ts` | 2 |
| New integration tests | `packages/tests/src/e2e/curation-r9.test.ts`<br>`packages/tests/src/compat/curation-r9.test.ts` (both create) | 4 |
| Documentation | `CLAUDE.md`<br>`PATCH-NOTES.md`<br>`documentation/plans/2026-11-performance-e-curadoria.md` | 3.1, 4 |

## Verification

GAIA owns all commands below, run from `<repo>`. These are orchestration checks, not execution tasks.

Builders for Tasks 1.1, 2.1, 3.1, 3.2 are dispatched with `--model gpt-6.1-sol --effort medium` (GAIA decision; BLOCKED is never retried, the plan is fixed).

Before dispatch, Artemis expands the specified tests. GAIA verifies the three Wave 4 Old anchors and the CLAUDE.md symmetry anchor. Generate dispatch files with `make_waves.py` using the actual persisted plan path and plan directory, then run `delegate.py --check` on those generated wave files. Expected: every wave reports `"status": "ok"`, exit 0, and no unresolved warnings. Never hand-edit generated wave JSON.

At every wave boundary:

- Record `git status --short` before and after; compare touched paths with task ownership and preserve pre-existing changes.
- Require the exact completion signal, executor status `DONE`, and empty `out_of_scope`. A `BLOCKED` result stops dependent dispatch.
- Record actual backend/model selection. `executor: auto` balances Codex/agy; a `no_quota` fallback is reported explicitly.
- Return failures as one coupled fix brief to the owning builder. GAIA does not repair product code in-session.
- Do not infer model accuracy from passing mocked tests.

| When | Command | Expected result |
|---|---|---|
| After Waves 1–3, before their named suites | `pnpm build` | Exit 0; core SQL assets, SDK worker, MCP, and sidecar build successfully. |
| Wave 1 | `pnpm --filter @cognistore/core exec vitest run test/curation-storage.test.ts test/knowledge-repository.test.ts test/migrations-atomic.test.ts` | Exit 0; all named migration, snapshot, active-filter, and starvation cases pass. |
| Wave 1 | `pnpm --filter @cognistore/tests exec playwright test src/e2e/migration-parity.test.ts src/compat/mcp-matrix.test.ts` | Exit 0; exact 2.4.6 parity and both published MCP versions pass. Network-related skips are recorded as incomplete compatibility evidence. |
| Wave 2 | `pnpm --filter @cognistore/core exec vitest run test/curation-engine.test.ts test/curation-actions.test.ts test/curation-judge.test.ts` | Exit 0; policy, protection, resumability, purge, undo, and judge-failure cases pass without live Ollama. |
| Wave 2 | `pnpm --filter @cognistore/dashboard exec vitest run server/test/settings.test.ts` | Exit 0; `suggest` defaults, all bounds, ownership, and asynchronous persistence cases pass. |
| Wave 3, Task 3.2 | `pnpm --filter @cognistore/core exec vitest run test/curation-writes.test.ts test/knowledge-service.test.ts test/knowledge-service-more.test.ts` | Exit 0; insert-with-hint behavior and all-or-nothing supersession pass. |
| Wave 3, Task 3.1 | `pnpm --filter @cognistore/dashboard exec vitest run server/test/curation-scheduler.test.ts server/test/curation-models.test.ts server/test/settings.test.ts` | Exit 0; idle/daily/restart, model ownership, and uninstall symmetry pass. |
| Wave 3, Task 3.2 | `pnpm --filter @cognistore/tests exec playwright test src/contract/mcp-contract.test.ts` | Exit 0; historical responses and annotations remain compatible; only the two specified optional input extensions differ. |
| After Waves 2 and 3 | `pnpm --filter @cognistore/tests exec playwright test src/e2e/sdk-knowledge.test.ts src/e2e/cleanup-report.test.ts` | Exit 0; insert-with-hint and approved reversible trash behavior pass without weakened assertions. |
| Wave 4 | `pnpm --filter @cognistore/core exec vitest run test/curation-eval.test.ts` | Exit 0; exactly 60 balanced fixture pairs and conservative scoring pass. |
| After final wave | `pnpm verify --coverage` | Exit 0; final output contains `✔ verify passed:`; coverage baseline gate passes without weakened thresholds. |
| After final wave | `pnpm --filter @cognistore/tests exec playwright test src/compat` | Exit 0; no failures. Record actual pass/skip counts; required npm compatibility cases must not be silently skipped. |
| New E2E stability | `pnpm --filter @cognistore/tests exec playwright test src/e2e/curation-r9.test.ts --repeat-each=20 --workers=1` | Exactly 160 passed, 0 failed, 0 skipped. |
| New compatibility cases | `pnpm --filter @cognistore/tests exec playwright test src/compat/curation-r9.test.ts --workers=1` | Exactly 4 passed, 0 failed, 0 skipped. |
| Existing performance guard | `pnpm --filter @cognistore/tests test:perf` | Exit 0; existing event-loop/performance budgets remain satisfied without relaxed limits. |
| Diff integrity | `git diff --check` | Exit 0; silence means success. |

For real model evaluation, GAIA runs:

```bash
pnpm --filter @cognistore/dashboard exec tsx ../../packages/tests/scripts/curation-eval.ts --model llama3.2:3b --model qwen2.5:7b-instruct --output curation-eval-r9.json
```

The output file is untracked scratch: never commit it (add it to `.gitignore` is NOT part of this plan; GAIA deletes it after reading).

Expected: one report per model, each accounting for 60 cases, followed by `curation-eval: complete` when both evaluations finish. A qualifying model has at least 51/60 correct judgments, zero false duplicate verdicts, and no invalid/missing judgments. If a model is unavailable, report `curation-eval: unavailable` and its unqualified status; do not pull it implicitly, claim measured accuracy, or enable `auto-safe`.

GAIA also inspects the final diff for ownership violations, fixture privacy, unchanged version manifests, unchanged historical contract snapshot, active-query indexes, absence of new MCP tools, and setup/uninstall symmetry. Update Phase 2 completion bookkeeping only for delivered, verified items; real-model qualification limitations remain explicit.

## Stop Points

None expected for implementation.

If an anchor, storage contract, or required premise is false, the executor returns `BLOCKED: <reason>` to GAIA for reconciliation; this is not permission to improvise or bypass safeguards.

Unavailable optional local models do not block deterministic/suggest delivery, but their evaluation remains unqualified and explicitly reported. Existing automatic-approval restrictions are not bypassed.

**Squash merge and release remain with the maintainer. No commit, push, merge, version bump, or release is authorized by this plan.**
