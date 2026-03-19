---
name: ai-knowledge-plan
description: >
  MANDATORY — automatically triggered when planning any non-trivial task.
  ALL implementation plans MUST be created via createPlan() in the AI Knowledge
  database. NEVER write plans to local files (plan.md, TODO.md, etc.).
  NEVER use only TodoWrite or in-memory task lists as a substitute for createPlan().
  If you are about to plan work with 3+ steps, you MUST call createPlan() FIRST.
user-invocable: true
argument-hint: <plan title and description>
---

# AI Knowledge Plan

**BLOCKING REQUIREMENT**: ALL implementation plans MUST be stored in the knowledge base via `createPlan()`. This is the ONLY acceptable way to persist plans.

## What Counts as a Plan

If your work involves **3 or more steps**, **architectural decisions**, or **multi-file changes**, you MUST create a plan. Examples:
- Feature implementation → **createPlan()**
- Bug fix requiring investigation → **createPlan()**
- Refactoring across files → **createPlan()**
- Migration or upgrade → **createPlan()**

## FORBIDDEN — Never Do These

- **NEVER** write a plan to a local file (plan.md, TODO.md, PLAN.md, etc.)
- **NEVER** use only TodoWrite/task lists as a substitute — those are for in-session tracking, NOT plan persistence
- **NEVER** describe a plan only in chat without persisting it
- **NEVER** skip createPlan() because "it's a small task" — if it has 3+ steps, it needs a plan

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

## Linking Related Knowledge

- **Input** (consulted during planning): Pass `relatedKnowledgeIds` when creating the plan, or use `addPlanRelation` with `relationType: "input"`
- **Output** (created/updated during execution): Use `addPlanRelation` with `relationType: "output"` for each knowledge entry you create or update

## Rules

- **Plans go ONLY in the knowledge base** — NEVER in local files
- **Always include tasks** when creating a plan
- **Always include relatedKnowledgeIds** if you queried knowledge beforehand
- **Update task status in real-time** — mark in_progress when starting, completed when done
- **Run completion protocol** when all tasks are finished
- **All entries in English** — regardless of user language preference
