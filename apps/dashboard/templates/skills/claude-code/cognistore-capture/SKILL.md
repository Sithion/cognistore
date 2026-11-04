---
name: cognistore-capture
description: >
  MANDATORY — automatically triggered after completing ANY task. Store discoveries,
  decisions, fixes, and patterns in the CogniStore knowledge base.
  This skill MUST run as your LAST action before finishing work.
  Do NOT skip. Do NOT forget. Capture knowledge, then finish.
user-invocable: true
argument-hint: <knowledge content to store>
---

# CogniStore Capture

**BLOCKING REQUIREMENT**: After completing ANY task that produces new knowledge — fixing a bug, making a decision, discovering a pattern, finding a constraint — you MUST capture it in the knowledge base immediately. This is NOT optional.

## When to Capture

| Event | What to Document | Type |
|-------|-----------------|------|
| Bug fixed | Root cause, fix applied, how to prevent | `fix` |
| Technical decision made | Choice, reasoning, discarded alternatives | `decision` |
| Pattern identified | Convention, where used, why | `pattern` |
| Limitation found | Constraint, impact, workarounds | `constraint` |
| Unexpected behavior | The gotcha, workaround, why it happens | `gotcha` |

## How to Call

```
mcp__cognistore__addKnowledge({
  title: "Descriptive title for semantic search",
  content: "Description of what was learned",
  type: "fix" | "decision" | "pattern" | "constraint" | "gotcha",
  scope: "global" | "workspace:<project-name>",
  source: "Where this was discovered",
  tags: ["relevant", "tags"],
  confidenceScore: 0.9,
  planId: "<your-plan-id>"
})
```

**Important**: Always include a descriptive `title` — it powers semantic search. Always pass `planId` if you have an active plan.

### Examples

**Fix discovered:**
```
mcp__cognistore__addKnowledge({
  content: "PostgreSQL pgvector extension requires CREATE EXTENSION before creating vector columns. Without it, the 'vector' type is not recognized and migrations fail silently.",
  type: "fix",
  scope: "workspace:knowledge-base",
  source: "database migration debugging",
  tags: ["postgresql", "pgvector", "migration"],
  confidenceScore: 0.95
})
```

**Decision made:**
```
mcp__cognistore__addKnowledge({
  content: "Chose nomic-embed-text (768 dimensions) over all-minilm for embeddings. Reason: significantly better accuracy for semantic search, richer vector space for knowledge retrieval, acceptable size trade-off (274MB vs 23MB).",
  type: "decision",
  scope: "workspace:knowledge-base",
  source: "embedding model selection",
  tags: ["ollama", "embeddings", "accuracy"],
  confidenceScore: 0.9
})
```

**Pattern found:**
```
mcp__cognistore__addKnowledge({
  content: "React components in this project use inline styles with CSS variables (--bg-card, --text-primary, etc.) defined in index.css. No component library is used.",
  type: "pattern",
  scope: "workspace:knowledge-base",
  source: "dashboard codebase analysis",
  tags: ["react", "styling", "css-variables"],
  confidenceScore: 0.95
})
```

## Rules

- **All agents must capture** — orchestrator, planner, executor, researcher — no exceptions
- **Capture immediately** — do not wait until end of session; capture when the event occurs
- **Never fix without documenting** — the fix alone is not enough; root cause and prevention are required
- **Never decide without documenting** — future agents need reasoning, not just outcomes
- **Be concise but complete** — one entry should give full context without re-investigation
- **All entries in English** — regardless of user language preference

## What NOT to Capture

Not everything deserves a knowledge entry. **Only store knowledge that saves significant time in future sessions.** Do NOT capture:

- **Publicly documented facts** — standard API docs, language syntax, framework basics (easily found via web search)
- **Trivial fixes** — typos, missing imports, simple syntax errors
- **Temporary state** — "currently debugging X", work-in-progress notes
- **Obvious patterns** — standard CRUD operations, boilerplate code, common conventions

**DO capture** things that are:
- **Hard-won insights** — root causes that took significant investigation to find
- **Project-specific decisions** — choices and reasoning that aren't documented elsewhere
- **Non-obvious gotchas** — unexpected behaviors, workarounds, edge cases
- **Cross-session context** — architectural decisions, constraints, integration details that future agents would waste time rediscovering

**Rule of thumb**: If a web search can answer it in 30 seconds, don't store it. If it took you 5+ minutes of investigation, store it.

## Update Existing Knowledge, Don't Duplicate

**CRITICAL**: Knowledge must be managed, not just accumulated. Before calling `addKnowledge`:

1. **Check if a related entry already exists** — did your initial `getKnowledge` query return something relevant?
2. If yes → **UPDATE it** with `mcp__cognistore__updateKnowledge(id, { content, tags })` instead of creating a new entry
3. If the existing entry is wrong or obsolete → **DELETE it** with `mcp__cognistore__deleteKnowledge(id)` and create a fresh one
4. Only **ADD** when the knowledge is genuinely new — no existing entry covers the topic

Duplicates pollute search results and waste tokens on redundant entries. One well-maintained entry is worth more than three stale duplicates.

## Automatic Deduplication

`addKnowledge()` checks for semantically similar entries in the same scope+type (threshold 0.85). If a match is found, it **updates the existing entry** instead of creating a duplicate. You still get the entry back — with `deduplicated: true` in the response.

This means you can call `addKnowledge()` freely without worrying about creating duplicates. The system handles it.

## Scope Guidelines

| Scope | When |
|-------|------|
| `workspace:<project>` | Knowledge specific to one project — architecture decisions, project-specific patterns |
| `global` | Cross-project knowledge (language patterns, tools, conventions, framework gotchas) |

### Prefer Global Scope for Reusable Knowledge

**Actively create `scope: "global"` entries** for insights about:
- **Languages** — TypeScript quirks, Go idioms, Python gotchas
- **Frameworks** — React patterns, Express middleware, Tauri lifecycle
- **Libraries** — sqlite-vec limitations, Zod patterns, better-sqlite3 gotchas
- **Tools** — Git workflows, npm/pnpm behaviors, CI/CD patterns
- **General patterns** — error handling strategies, testing approaches, API design

These entries benefit ALL future projects, not just the current one. If it took investigation to discover and applies beyond this codebase, make it global.

## Other Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__cognistore__getKnowledge` | Query existing knowledge |
| `mcp__cognistore__addKnowledge` | Store new knowledge (this skill) |
| `mcp__cognistore__updateKnowledge` | Update existing entry by ID |
| `mcp__cognistore__deleteKnowledge` | Remove outdated entry by ID |
| `mcp__cognistore__listTags` | Browse all tags in the database |

## Pattern Checklist

Before finishing, ask yourself each question. If YES to any, store a `type: "pattern"` entry with `scope: "global"`:

1. Did I discover a **reusable coding pattern** for a language or framework? (e.g., "TypeScript: use discriminated unions for exhaustive switch with never type")
2. Did I learn a **library usage pattern** not obvious from docs? (e.g., "react-markdown requires remark-gfm plugin for table support")
3. Did I find a **tool workflow** that saves time? (e.g., "pnpm: use --filter to run scripts in specific workspaces")
4. Did I use an **architectural pattern** worth repeating? (e.g., "Repository pattern: separate raw SQL for sqlite-vec virtual tables from Drizzle ORM")
5. Did I discover a **testing or debugging technique**? (e.g., "sqlite-vec: test KNN search with known vectors to verify distance metric")

Patterns are the most valuable knowledge type — they compound across every future project.

### Global vs Workspace Pattern Examples

**Global pattern (language):**
```json
{
  "title": "TypeScript: Exhaustive switch with never type",
  "content": "Use 'const _exhaustive: never = value' as the default case in switch statements over discriminated unions. TypeScript will error at compile time if a new variant is added but not handled.",
  "type": "pattern", "scope": "global",
  "tags": ["typescript", "type-safety", "switch"]
}
```

**Global pattern (library):**
```json
{
  "title": "better-sqlite3: WAL mode + busy_timeout for concurrent access",
  "content": "When multiple processes access the same SQLite database, enable WAL mode and set busy_timeout to 5000ms. Without busy_timeout, concurrent writes throw SQLITE_BUSY immediately.",
  "type": "pattern", "scope": "global",
  "tags": ["sqlite", "better-sqlite3", "concurrency", "wal"]
}
```

**Workspace pattern (project-specific):**
```json
{
  "title": "CogniStore: inline styles with CSS variables for dashboard components",
  "content": "Dashboard components use inline styles with CSS variables (--bg-card, --text-primary) defined in index.css. No component library is used.",
  "type": "pattern", "scope": "workspace:knowledge-base",
  "tags": ["react", "styling", "css-variables"]
}
```

## Pre-Capture: Plan Completion Check

Before capturing knowledge, ensure active plans are complete:
1. `listPlanTasks(planId)` — if any tasks are not `completed`, update them first
2. Only after plan tracking is current, proceed with knowledge capture

## Avoid duplicates and supersessions

- Search before adding. If an entry on the topic already exists, use `mcp__cognistore__updateKnowledge` to update it instead of adding a near copy.
- If the new entry REPLACES older ones, pass `supersedes: [<old ids>]` when adding or updating. Never prefix a title with SUPERSEDED.
