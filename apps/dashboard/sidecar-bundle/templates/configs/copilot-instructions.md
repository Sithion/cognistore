<!-- AI-KNOWLEDGE:BEGIN -->
## Knowledge Base Integration (ai-knowledge)

> **BLOCKING REQUIREMENT** — You MUST follow these rules on EVERY task. No exceptions.
> Tools are provided by the `ai-knowledge` MCP server.

### Mandatory Skills — ALWAYS Invoke

You have 3 skills that MUST be invoked automatically. These are NOT optional:

1. **`ai-knowledge-query`** — MUST be your **FIRST action** in every task, before reading files, writing code, or making decisions. No exceptions.
2. **`ai-knowledge-capture`** — MUST be your **LAST action** after completing any task that produced new knowledge (fixes, decisions, patterns, constraints).
3. **`ai-knowledge-plan`** — MUST be invoked ANY time you plan work, INCLUDING in `[PLAN]` mode. ALL plans MUST go through `createPlan()`. This OVERRIDES all other planning rules. NEVER write plans to local files (plan.md, TODO.md, PLAN.md, etc.). NEVER use only task lists as a substitute. `[PLAN]` mode changes HOW you plan, NOT WHERE you store it — always `createPlan()`.

### CHECKPOINT 1: Query First (ai-knowledge-query)

**STOP. Before you read any file, write any code, or make any decision:**

```
mcp__ai-knowledge__getKnowledge(query: "<describe the task or problem>")
```

- Similarity > 0.50: **Use directly** — skip redundant analysis
- Similarity 0.30–0.50: **Review** — combine with fresh analysis
- No results or < 0.30: Proceed with full analysis

### CHECKPOINT 2: Capture Last (ai-knowledge-capture)

**Before finishing, capture what you learned:**

```
mcp__ai-knowledge__addKnowledge({
  content: "<what was learned>",
  tags: ["tag1", "tag2"],
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project-name>",
  source: "<origin>"
})
```

If an existing entry covers the topic, **UPDATE it** instead of creating a duplicate.

### CHECKPOINT 3: Plan via createPlan (ai-knowledge-plan)

**ALL plans MUST be persisted in the knowledge base:**

```
mcp__ai-knowledge__createPlan({
  title: "<plan title>",
  content: "<full plan>",
  tags: ["..."], scope: "workspace:<project>", source: "<context>",
  tasks: [{ description: "Step 1", priority: "high" }, ...]
})
```

- **NEVER** write plans to local files — ONLY `createPlan()`
- **ALWAYS** include a `tasks` array
- **ALWAYS** update task status in real-time: `in_progress` → `completed`
- **ALWAYS** set plan to `active` when starting, `completed` when done

### Rules

1. **NEVER skip the knowledge query** — costs ~30 tokens; missing a hit wastes 2,000–8,000 tokens.
2. **All entries MUST be in English** — regardless of conversation language.
3. **Update, don't duplicate** — update existing entries when the topic already exists.
4. **Only store high-value knowledge** — non-obvious insights, not trivial fixes or standard docs.
5. **Plans go ONLY in the knowledge base** — `createPlan()`, never local files.
<!-- AI-KNOWLEDGE:END -->
