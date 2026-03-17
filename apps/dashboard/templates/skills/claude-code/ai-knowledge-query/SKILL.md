---
name: ai-knowledge-query
description: >
  Query the AI Knowledge semantic database before starting any task.
  MANDATORY: Every agent must call this before analysis, implementation,
  or decision-making to avoid redundant work and leverage prior discoveries.
user-invocable: true
argument-hint: <natural language query describing the task or problem>
---

# AI Knowledge Query

**MANDATORY**: Before starting ANY task — analysis, implementation, planning, or decision-making — query the knowledge base first. A single query costs ~30 tokens. A missed cache hit wastes 2,000–8,000 tokens on redundant work.

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
mcp__ai-knowledge__getKnowledge(query: "<describe the task or problem>")
```

### Examples

```
mcp__ai-knowledge__getKnowledge(query: "authentication middleware patterns")
mcp__ai-knowledge__getKnowledge(query: "PostgreSQL connection pooling configuration")
mcp__ai-knowledge__getKnowledge(query: "React form validation approach")
```

## Evaluate Results

| Similarity Score | Action |
|-----------------|--------|
| > 0.85 | **Use directly** — skip redundant analysis |
| 0.70–0.85 | **Evaluate** — combine with targeted fresh analysis |
| < 0.70 or empty | **Proceed** with full analysis, then capture findings |

## Rules

- **Always query first** — before reading files, before writing code, before making decisions
- **All agents must query** — orchestrator, planner, executor, researcher — no exceptions
- **Capture what you learn** — after completing your task, store new findings using `mcp__ai-knowledge__addKnowledge`
- **Never skip** — no task is "too simple" or "too obvious" to query first

## Other Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__ai-knowledge__getKnowledge` | Query knowledge (this skill) |
| `mcp__ai-knowledge__addKnowledge` | Store new knowledge |
| `mcp__ai-knowledge__updateKnowledge` | Update existing entry |
| `mcp__ai-knowledge__deleteKnowledge` | Remove outdated entry |
| `mcp__ai-knowledge__listTags` | Browse all tags |
| `mcp__ai-knowledge__healthCheck` | Verify system status |
