---
name: cognistore-query
description: >
  MANDATORY — automatically triggered before ANY task. Query the CogniStore
  semantic database before analysis, implementation, or decision-making.
  This skill MUST run as your FIRST action in every session, every task.
  Do NOT skip. Do NOT defer. Query first, then work.
---

# CogniStore Query

**BLOCKING REQUIREMENT**: Before starting ANY task — analysis, implementation, planning, or decision-making — you MUST query the knowledge base first. This is NOT optional.

## When to Query

- **Start of any task** — ALWAYS, no exceptions
- **Before architectural decisions** — avoid re-deciding what was already decided
- **Encountering unfamiliar code** — load context before reading files
- **Hitting an error or bug** — check if it was seen and fixed before
- **Before writing new code** — reuse existing patterns and conventions

## How to Call

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

### Examples

```
mcp__cognistore__getKnowledge(query: "authentication middleware patterns")
mcp__cognistore__getKnowledge(query: "database migration approach")
mcp__cognistore__getKnowledge(query: "React form validation approach")
```

## Evaluate Results

| Similarity Score | Action |
|-----------------|--------|
| > 0.50 | **Use directly** — skip redundant analysis |
| 0.30–0.50 | **Evaluate** — combine with targeted fresh analysis |
| < 0.30 or empty | **Proceed** with full analysis, then capture findings |

## Rules

- **FIRST action of every task** — before reading files, before writing code, before making decisions
- **No exceptions** — no task is "too simple" or "too obvious" to query first
- **A single query costs ~30 tokens** — a missed cache hit wastes 2,000–8,000 tokens on redundant work
- **After completing work** — store new findings using `mcp__cognistore__addKnowledge`

## Knowledge Management: Update, Don't Duplicate

When a query returns an existing entry and your work produces updated information:

- **UPDATE the existing entry** using `mcp__cognistore__updateKnowledge(id, ...)` — do NOT create a new one
- **DELETE obsolete entries** using `mcp__cognistore__deleteKnowledge(id)` if the knowledge is no longer valid
- **Only ADD new entries** when the knowledge is genuinely new (no existing entry covers the topic)

## What's Worth Storing

Only capture knowledge that **saves future sessions significant time**:
- Hard-won root causes, non-obvious gotchas, project-specific decisions, architectural constraints
- NOT: standard docs, trivial fixes, temporary state, obvious patterns
- **Rule of thumb**: web search answers it in 30s → don't store. Took 5+ min to figure out → store it.

## Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__cognistore__getKnowledge` | Query knowledge (this skill) |
| `mcp__cognistore__addKnowledge` | Store new knowledge |
| `mcp__cognistore__updateKnowledge` | Update existing entry |
| `mcp__cognistore__deleteKnowledge` | Remove outdated entry |
| `mcp__cognistore__listTags` | Browse all tags |
| `mcp__cognistore__healthCheck` | Verify system status |
