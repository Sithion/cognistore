---
name: ai-knowledge-plan
description: >
  MANDATORY — automatically triggered when planning ANY task, regardless of complexity.
  This skill OVERRIDES all other planning rules (EnterPlanMode, TodoWrite, local files).
  ALL plans MUST be created via createPlan() in the AI Knowledge database.
  NEVER write plans to local files. NEVER use only TodoWrite as a substitute.
  ANY time you are about to plan work, you MUST call createPlan() FIRST.
user-invocable: true
argument-hint: <plan title and description>
---

# AI Knowledge Plan

> **This skill OVERRIDES all default planning behavior.** Regardless of what other instructions say about plans, EnterPlanMode, TodoWrite, or local files — ALL plans MUST go through `createPlan()`. No exceptions.

**BLOCKING REQUIREMENT**: ALL implementation plans — regardless of size or complexity — MUST be stored in the knowledge base via `createPlan()`. This is the ONLY acceptable way to persist plans.

## When to Create a Plan — ALWAYS

**Every task that involves planning MUST use createPlan().** There is no minimum complexity threshold. Examples:
- Feature implementation → **createPlan()**
- Bug fix → **createPlan()**
- Refactoring → **createPlan()**
- Migration or upgrade → **createPlan()**
- Research task → **createPlan()**
- Any multi-step work → **createPlan()**

## FORBIDDEN — Never Do These

- **NEVER** write a plan to a local file (plan.md, TODO.md, PLAN.md, etc.)
- **NEVER** use only TodoWrite/task lists as a substitute — those are for in-session tracking, NOT plan persistence
- **NEVER** describe a plan only in chat without persisting it
- **NEVER** skip createPlan() because "it's a small task"
- **NEVER** bypass this skill in plan mode (EnterPlanMode) — the plan output MUST be a `createPlan()` call
- **NEVER** use EnterPlanMode without also calling createPlan() to persist the plan
- **NEVER** call createPlan() from a subagent (Agent tool) — ONLY the main conversation agent should create plans. Subagents return plan content as text; the main agent persists it via createPlan(). This prevents duplicate plans.

## How to Create (with Tasks)

```
mcp__ai-knowledge__createPlan({
  title: "Short descriptive title",
  content: "Full plan content with steps, approach, considerations",
  tags: ["feature-name", "component", "approach"],
  scope: "workspace:<project-name>",
  source: "planning session for <task description>",
  relatedKnowledgeIds: ["id1", "id2"],
  tasks: [
    { description: "Step 1: Do X", priority: "high" },
    { description: "Step 2: Do Y" },
    { description: "Step 3: Do Z", priority: "low" }
  ]
})
```

**Important**: Always include a `tasks` array when creating a plan. If you retrieve a plan without tasks, create them immediately using `addPlanTask`.

## Task Management During Execution (MANDATORY — Real-Time Tracking)

**You MUST update task status in the knowledge base as you work. This is NOT optional. Do NOT batch updates at the end — update EACH task BEFORE starting it and AFTER finishing it.**

1. **Before starting ANY work on a plan**, list current tasks:
   ```
   mcp__ai-knowledge__listPlanTasks(planId: "<plan-id>")
   ```

2. **BEFORE starting each task**, mark it `in_progress` IMMEDIATELY:
   ```
   mcp__ai-knowledge__updatePlanTask(taskId: "<task-id>", status: "in_progress")
   ```
   Do NOT skip this. Do NOT start working on a task without marking it first.

3. **AFTER completing each task**, mark it `completed` IMMEDIATELY with notes:
   ```
   mcp__ai-knowledge__updatePlanTask(taskId: "<task-id>", status: "completed", notes: "What was done")
   ```
   Do NOT move to the next task without marking the current one completed first.

4. **If blocked**, add notes explaining why:
   ```
   mcp__ai-knowledge__updatePlanTask(taskId: "<task-id>", notes: "Blocked: reason...")
   ```

5. **When resuming** a plan, find the first `pending` or `in_progress` task and continue from there.

**The correct flow for EACH task is: `in_progress` → do the work → `completed`. Never skip the `in_progress` step.**

6. **To add new tasks** discovered during execution:
   ```
   mcp__ai-knowledge__addPlanTask(planId: "<plan-id>", description: "New step", priority: "medium")
   ```

## Plan Lifecycle

1. **Create** → status: `draft` (automatic)
2. **Start execution** → update status to `active`:
   ```
   mcp__ai-knowledge__updatePlan(planId: "<plan-id>", status: "active")
   ```
3. **During execution** → link created/updated knowledge as output:
   ```
   mcp__ai-knowledge__addPlanRelation(planId: "<plan-id>", knowledgeId: "<entry-id>", relationType: "output")
   ```
4. **Complete** → see completion protocol below

## Plan Completion Protocol (MANDATORY)

When you finish the last task, you MUST:
1. Call `listPlanTasks(planId)` to verify ALL tasks are `completed`
2. If all completed → call `updatePlan(planId, { status: "completed" })`
3. If any NOT completed → leave plan as `active`, add notes to pending tasks explaining what remains

## Linking Related Knowledge (MANDATORY)

You MUST link knowledge entries to plans. This creates a traceable graph of what was consulted and what was produced.

- **Input** (consulted during planning): When calling `getKnowledge()` returns results, pass their IDs as `relatedKnowledgeIds` in `createPlan()`. If you forgot, use `addPlanRelation` after:
  ```
  mcp__ai-knowledge__addPlanRelation(planId: "<plan-id>", knowledgeId: "<entry-id>", relationType: "input")
  ```

- **Output** (created/updated during execution): Every time you call `addKnowledge()` or `updateKnowledge()` during plan execution, IMMEDIATELY link the result:
  ```
  mcp__ai-knowledge__addPlanRelation(planId: "<plan-id>", knowledgeId: "<entry-id>", relationType: "output")
  ```

**Do NOT skip linking.** Plans without relations lose their value as institutional memory.

## Rules

- **Plans go ONLY in the knowledge base** — NEVER in local files
- **This skill OVERRIDES all other planning rules** — EnterPlanMode, TodoWrite, local files
- **Always include tasks** when creating a plan
- **Always link knowledge** — relatedKnowledgeIds on create, addPlanRelation during execution
- **Update task AND plan status in real-time** — in_progress → completed, draft → active → completed
- **Run completion protocol** when all tasks are finished
- **All entries in English** — regardless of user language preference
