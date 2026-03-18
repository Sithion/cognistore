---
name: ai-knowledge-capture
description: >
  Store discoveries, decisions, fixes, and patterns in the AI Knowledge
  semantic database. MANDATORY: Every agent must capture knowledge after
  completing work — fixes, decisions, patterns, constraints, and gotchas.
user-invocable: true
argument-hint: <knowledge content to store>
---

# AI Knowledge Capture

**MANDATORY**: After completing ANY task that produces new knowledge — fixing a bug, making a decision, discovering a pattern, finding a constraint — capture it in the knowledge base immediately. Every entry builds institutional memory that benefits all future sessions.

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
mcp__ai-knowledge__addKnowledge({
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
mcp__ai-knowledge__addKnowledge({
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
mcp__ai-knowledge__addKnowledge({
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
mcp__ai-knowledge__addKnowledge({
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

## Scope Guidelines

| Scope | When |
|-------|------|
| `workspace:<project>` | Knowledge specific to one project |
| `global` | Cross-project knowledge (language patterns, tools, conventions) |

## Other Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__ai-knowledge__getKnowledge` | Query existing knowledge |
| `mcp__ai-knowledge__addKnowledge` | Store new knowledge (this skill) |
| `mcp__ai-knowledge__updateKnowledge` | Update existing entry by ID |
| `mcp__ai-knowledge__deleteKnowledge` | Remove outdated entry by ID |
| `mcp__ai-knowledge__listTags` | Browse all tags in the database |
