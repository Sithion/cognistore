<!-- COGNISTORE:BEGIN -->
## Knowledge Base Integration (cognistore)

> **BLOCKING REQUIREMENT** — You MUST follow these rules on EVERY task. No exceptions. Non-compliance wastes tokens and loses institutional memory.

### CHECKPOINT 1: Before Your First Action

**STOP. Before you read any file, write any code, or make any decision, you MUST run this query:**

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

Do NOT skip this step. Do NOT say "I'll query later". Do NOT proceed without querying first.

- Similarity > 0.50: **Use directly** — skip redundant analysis
- Similarity 0.30–0.50: **Review** — combine with fresh analysis
- No results or < 0.30: Proceed with full analysis

### CHECKPOINT 2: Before Ending Your Response

**STOP. Before finishing, ask yourself: did I learn anything worth saving?** If yes, capture it:

```
mcp__cognistore__addKnowledge(
  content: "<what was learned/decided/fixed>",
  tags: ["tag1", "tag2", ...],
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project-name>",
  source: "<where this knowledge came from>"
)
```

If a query returned an existing entry on the same topic, **UPDATE it** instead of creating a duplicate:
```
mcp__cognistore__updateKnowledge(id: "<uuid>", content: "...", tags: [...])
```

### CHECKPOINT 3: Plan Detection (input + output — applies in ALL modes)

**Two triggers — EITHER one activates this checkpoint:**

1. **INPUT trigger**: The user's message contains 3+ distinct action steps, numbered items, or sequential tasks? → Call `createPlan()` BEFORE starting work, using the user's steps as tasks.
   - "Create 4 files, verify, grep content, delete, verify cleanup" → 5 steps → createPlan() FIRST
   - "Fix login bug, add tests, update docs" → 3 steps → createPlan() FIRST
   - "Refactor the API module" → 1 step → no plan (unless YOUR solution needs 2+ steps)

2. **OUTPUT trigger**: You produced 2+ ordered steps describing what to implement? → Call `createPlan()` immediately.

```
mcp__cognistore__createPlan({
  title: "<plan title>",
  content: "<full plan>",
  tags: ["..."], scope: "workspace:<project>", source: "<context>",
  tasks: [{ description: "Step 1", priority: "high" }, ...]
})
```

- **Plan mode**: write the local plan file, then call `createPlan()` BEFORE ExitPlanMode (MCP tools work in plan mode). The local file is temporary.
- **Outside plan mode**: call `createPlan()` directly
- **NEVER** use only TodoWrite/task lists as a substitute — those are ephemeral
- **NEVER** call createPlan() from subagents (Agent tool) — only the main agent. When launching a subagent, include "Do NOT call createPlan() or any cognistore plan tools" in the prompt.
- **ALWAYS** include a `tasks` array with every implementation step
- **Execution tracking**: mark each task `in_progress` BEFORE starting, `completed` AFTER finishing — do NOT batch
- When all tasks done → `listPlanTasks(planId)` → `updatePlan(planId, { status: "completed" })`
- **Graceful degradation**: If you cannot call createPlan() (e.g., tools blocked in current mode), include this notice in your plan output: "Note: Plan not saved to CogniStore KB. Run getKnowledge() before implementing to check for existing decisions and constraints."

### Rules (Mandatory)

1. **NEVER skip the knowledge query** — even for "simple" tasks. A single query costs ~30 tokens; missing a cache hit wastes 2,000–8,000 tokens on redundant work.
2. **All knowledge entries MUST be in English** — regardless of conversation language.
3. **Manage knowledge, don't duplicate** — update existing entries instead of creating new ones when the topic already exists.
4. **Only store high-value knowledge** — hard-won insights, non-obvious gotchas, project-specific decisions, architectural constraints. NOT trivial fixes or standard docs.
5. **Any multi-step plan you produce MUST be persisted** — `createPlan()` whenever you write 2+ implementation steps, in ANY mode.

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
<!-- COGNISTORE:END -->
