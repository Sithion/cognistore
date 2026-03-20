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
  content: "Description of what was learned",
  type: "fix" | "decision" | "pattern" | "constraint" | "gotcha",
  scope: "global" | "workspace:<project-name>",
  source: "Where this was discovered",
  tags: ["relevant", "tags"],
  confidenceScore: 0.9
})
```

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
  content: "Chose all-minilm (384 dimensions) over nomic-embed-text for embeddings. Reason: 3x faster inference, lower memory footprint, sufficient accuracy for code knowledge retrieval.",
  type: "decision",
  scope: "workspace:knowledge-base",
  source: "embedding model selection",
  tags: ["ollama", "embeddings", "performance"],
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

## Scope Guidelines

| Scope | When |
|-------|------|
| `workspace:<project>` | Knowledge specific to one project |
| `global` | Cross-project knowledge (language patterns, tools, conventions) |

## Other Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__cognistore__getKnowledge` | Query existing knowledge |
| `mcp__cognistore__addKnowledge` | Store new knowledge (this skill) |
| `mcp__cognistore__updateKnowledge` | Update existing entry by ID |
| `mcp__cognistore__deleteKnowledge` | Remove outdated entry by ID |
| `mcp__cognistore__listTags` | Browse all tags in the database |
