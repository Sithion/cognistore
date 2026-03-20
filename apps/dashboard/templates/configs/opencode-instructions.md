<!-- COGNISTORE:BEGIN -->
## Knowledge Base Integration (cognistore)

> **BLOCKING REQUIREMENT** — You MUST follow these rules on EVERY task. No exceptions.
> Tools are provided by the `cognistore` MCP server.

### CHECKPOINT 1: Query First

**STOP. Before you read any file, write any code, or make any decision:**

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

- Similarity > 0.50: **Use directly** — skip redundant analysis
- Similarity 0.30–0.50: **Review** — combine with fresh analysis
- No results or < 0.30: Proceed with full analysis

### CHECKPOINT 2: Capture Last

**Before finishing, capture what you learned:**

```
mcp__cognistore__addKnowledge({
  content: "<what was learned>",
  tags: ["tag1", "tag2"],
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project-name>",
  source: "<origin>"
})
```

If an existing entry covers the topic, **UPDATE it** instead of creating a duplicate.

### CHECKPOINT 3: Plan Detection (input + output — applies in ALL modes)

**Two triggers — EITHER one activates this checkpoint:**

1. **INPUT trigger**: The user's message contains 3+ distinct action steps, numbered items, or sequential tasks? → Call `createPlan()` BEFORE starting work, using the user's steps as tasks.

2. **OUTPUT trigger**: You produced 2+ ordered steps describing what to implement? → Call `createPlan()` immediately.

```
mcp__cognistore__createPlan({
  title: "<plan title>",
  content: "<full plan>",
  tags: ["..."], scope: "workspace:<project>", source: "<context>",
  tasks: [{ description: "Step 1", priority: "high" }, ...]
})
```

- **ALWAYS** include a `tasks` array
- **ALWAYS** track execution: `updatePlanTask(taskId, {status: 'in_progress'})` BEFORE each task, `updatePlanTask(taskId, {status: 'completed', notes: '...'})` AFTER
- **ALWAYS** set plan to `active` when starting, `completed` when all tasks done
- **Graceful degradation**: If you cannot call createPlan() (e.g., tools blocked in current mode), include this notice in your plan output: "Note: Plan not saved to CogniStore KB. Run getKnowledge() before implementing to check for existing decisions and constraints."

### Execution Tracking Protocol (MANDATORY)

After calling `createPlan()`, you MUST track execution in real-time:

1. `updatePlan(planId, { status: "active" })` — set plan to active
2. `listPlanTasks(planId)` — get all task IDs
3. **For EACH task:**
   - `updatePlanTask(taskId, { status: "in_progress" })` — BEFORE starting
   - Do the work
   - `updatePlanTask(taskId, { status: "completed", notes: "..." })` — AFTER finishing
4. When ALL tasks done: `listPlanTasks(planId)` → `updatePlan(planId, { status: "completed" })`

**Flow**: `in_progress` → work → `completed`. Never skip `in_progress`. Never batch updates.

### Rules

1. **NEVER skip the knowledge query** — costs ~30 tokens; missing a hit wastes 2,000–8,000 tokens.
2. **All entries MUST be in English** — regardless of conversation language.
3. **Update, don't duplicate** — update existing entries when the topic already exists.
4. **Only store high-value knowledge** — non-obvious insights, not trivial fixes or standard docs.
5. **Any multi-step plan you produce MUST be persisted** — `createPlan()` whenever you write 2+ implementation steps, in ANY mode.
<!-- COGNISTORE:END -->
