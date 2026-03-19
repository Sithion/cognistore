<!-- AI-KNOWLEDGE:BEGIN -->
## Knowledge Base Integration (ai-knowledge)

> **BLOCKING REQUIREMENT** — You MUST follow these rules on EVERY task. No exceptions. Non-compliance wastes tokens and loses institutional memory.

### CHECKPOINT 1: Before Your First Action

**STOP. Before you read any file, write any code, or make any decision, you MUST run this query:**

```
mcp__ai_knowledge__getKnowledge(query: "<describe the task or problem>")
```

Do NOT skip this step. Do NOT say "I'll query later". Do NOT proceed without querying first.

- Similarity > 0.50: **Use directly** — skip redundant analysis
- Similarity 0.30–0.50: **Review** — combine with fresh analysis
- No results or < 0.30: Proceed with full analysis

### CHECKPOINT 2: Before Ending Your Response

**STOP. Before finishing, ask yourself: did I learn anything worth saving?** If yes, capture it:

```
mcp__ai_knowledge__addKnowledge(
  content: "<what was learned/decided/fixed>",
  tags: ["tag1", "tag2", ...],
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project-name>",
  source: "<where this knowledge came from>"
)
```

If a query returned an existing entry on the same topic, **UPDATE it** instead of creating a duplicate:
```
mcp__ai_knowledge__updateKnowledge(id: "<uuid>", content: "...", tags: [...])
```

### CHECKPOINT 3: Planning (3+ steps = createPlan)

**If your task has 3 or more steps, you MUST create a plan in the knowledge base:**

```
mcp__ai_knowledge__createPlan({
  title: "<plan title>",
  content: "<full plan>",
  tags: ["..."], scope: "workspace:<project>", source: "<context>",
  tasks: [{ description: "Step 1", priority: "high" }, ...]
})
```

- **NEVER** write plans to local files (plan.md, TODO.md, etc.)
- **NEVER** use only TodoWrite/task lists as a substitute — those are ephemeral, not persistent
- **ALWAYS** include a `tasks` array with every implementation step
- **ALWAYS** set plan status to `active` when you begin execution: `updatePlan(planId, { status: "active" })`
- **ALWAYS** mark each task `in_progress` BEFORE starting it, then `completed` AFTER finishing — do NOT batch updates
- When all tasks done → verify with `listPlanTasks(planId)` → `updatePlan(planId, { status: "completed" })`

### Rules (Mandatory)

1. **NEVER skip the knowledge query** — even for "simple" tasks. A single query costs ~30 tokens; missing a cache hit wastes 2,000–8,000 tokens on redundant work.
2. **All knowledge entries MUST be in English** — regardless of conversation language.
3. **Manage knowledge, don't duplicate** — update existing entries instead of creating new ones when the topic already exists.
4. **Only store high-value knowledge** — hard-won insights, non-obvious gotchas, project-specific decisions, architectural constraints. NOT trivial fixes or standard docs.
5. **Plans go ONLY in the knowledge base** — use `createPlan()`. NEVER save plans to local files. NEVER use only task lists as a substitute.

### Quick Reference

| Tool | Required Params | When |
|------|----------------|------|
| `getKnowledge` | `query` | **FIRST action** of every task |
| `addKnowledge` | `content`, `tags`, `type`, `scope`, `source` | **LAST action** — after completing work |
| `updateKnowledge` | `id` + fields to update | When existing knowledge is stale |
| `deleteKnowledge` | `id` | When knowledge is wrong or obsolete |
| `listTags` | (none) | To discover existing tag taxonomy |
| `healthCheck` | (none) | To verify database and Ollama connectivity |

### What to Capture

| Event | Type | Example Tags |
|-------|------|-------------|
| Bug fixed | `fix` | error-name, module, root-cause |
| Architecture choice | `decision` | component, approach, trade-off |
| Code pattern found | `pattern` | language, pattern-name, where-used |
| Limitation discovered | `constraint` | tool, version, workaround |
| Unexpected behavior | `gotcha` | tool, symptom, fix |

### Priority Order for Information

1. **Knowledge base** (`getKnowledge`) — always first
2. **Project codebase** — files, patterns, existing code
3. **Web search** — only if knowledge base and codebase insufficient

### Hooks (automatic enforcement)

- **PreToolUse hook**: Fires before Edit, Write, Bash, MultiEdit, Agent, NotebookEdit — reminds you to query first
- **Stop hook**: Fires at session end — reminds you to capture knowledge before finishing
- These hooks are non-blocking reminders. If you already queried, proceed normally.
<!-- AI-KNOWLEDGE:END -->
