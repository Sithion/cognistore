---
name: cognistore-query
description: >
  MANDATORY — automatically triggered before ANY task. Query the CogniStore
  semantic database before analysis, implementation, or decision-making.
  This skill MUST run as your FIRST action in every session, every task.
  Do NOT skip. Do NOT defer. Query first, then work.
user-invocable: true
argument-hint: <natural language query describing the task or problem>
---

# CogniStore Query

**BLOCKING REQUIREMENT**: Before starting ANY task — analysis, implementation, planning, or decision-making — you MUST query the knowledge base first. This is NOT optional. A single query costs ~30 tokens. A missed cache hit wastes 2,000–8,000 tokens on redundant work.

## When to Query

| Situation | Why |
|-----------|-----|
| Start of any task | Surface known patterns, decisions, or constraints |
| Before architectural decisions | Avoid re-deciding what was already decided |
| Encountering unfamiliar code | Load context before reading files |
| Hitting an error or bug | Check if it was seen and fixed before |
| Before writing new code | Reuse existing patterns and conventions |

## How to Call

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

### Examples

```
mcp__cognistore__getKnowledge(query: "authentication middleware patterns")
mcp__cognistore__getKnowledge(query: "PostgreSQL connection pooling configuration")
mcp__cognistore__getKnowledge(query: "React form validation approach")
```

## Evaluate Results

| Similarity Score | Action |
|-----------------|--------|
| > 0.50 | **Use directly** — skip redundant analysis |
| 0.30–0.50 | **Evaluate** — combine with targeted fresh analysis |
| < 0.30 or empty | **Proceed** with full analysis, then capture findings |

## Rules

- **Always query first** — before reading files, before writing code, before making decisions
- **All agents must query** — orchestrator, planner, executor, researcher — no exceptions
- **Capture what you learn** — after completing your task, store new findings using `mcp__cognistore__addKnowledge`
- **Never skip** — no task is "too simple" or "too obvious" to query first

## What's Worth Storing

After completing work, only capture knowledge that **saves future sessions significant time**:
- Hard-won root causes, non-obvious gotchas, project-specific decisions, architectural constraints
- NOT: standard docs, trivial fixes, temporary state, obvious patterns
- **Rule of thumb**: web search answers it in 30s → don't store. Took 5+ min to figure out → store it.

## Knowledge Management: Update, Don't Duplicate

Knowledge must be **managed**, not just accumulated. When a query returns an existing entry and your work produces updated information about the same topic:

- **UPDATE the existing entry** using `mcp__cognistore__updateKnowledge(id, ...)` — do NOT create a new one
- **DELETE obsolete entries** using `mcp__cognistore__deleteKnowledge(id)` if the knowledge is no longer valid
- **Only ADD new entries** when the knowledge is genuinely new (no existing entry covers the topic)

Example: You query and find a `decision` entry about "chose SQLite for storage". During your work, you discover SQLite now also needs WAL mode enabled. **Update** the existing entry with the new detail — don't create a second entry about SQLite storage.

## Other Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__cognistore__getKnowledge` | Query knowledge (this skill) |
| `mcp__cognistore__addKnowledge` | Store new knowledge |
| `mcp__cognistore__updateKnowledge` | Update existing entry |
| `mcp__cognistore__deleteKnowledge` | Remove outdated entry |
| `mcp__cognistore__listTags` | Browse all tags |
| `mcp__cognistore__healthCheck` | Verify system status |
