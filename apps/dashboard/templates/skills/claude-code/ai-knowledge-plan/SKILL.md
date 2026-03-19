---
name: ai-knowledge-plan
description: >
  Persist implementation plans with task tracking in the AI Knowledge database.
  MANDATORY: All plans MUST be stored exclusively in the knowledge base
  via createPlan(). Never save plans to local files.
user-invocable: true
argument-hint: <plan title and description>
---

# AI Knowledge Plan

**MANDATORY**: All implementation plans MUST be stored in the knowledge base. The knowledge base is the **ONLY** source of truth for plans. Never save plans to local files (e.g., plan.md).

## When to Create a Plan

Create a plan whenever you:
- Start a non-trivial implementation task (3+ files, architectural decisions)
- Design an approach that should be preserved for future reference
- Plan a multi-step migration or refactoring

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

## Task Management During Execution

1. **Before starting work**, check task state:
   ```
   mcp__ai-knowledge__listPlanTasks(planId: "<plan-id>")
   ```

2. **For each task**, mark in_progress before starting:
   ```
   mcp__ai-knowledge__updatePlanTask(taskId: "<task-id>", status: "in_progress")
   ```

3. **When done**, mark completed:
   ```
   mcp__ai-knowledge__updatePlanTask(taskId: "<task-id>", status: "completed", notes: "What was done")
   ```

4. **If blocked**, add notes:
   ```
   mcp__ai-knowledge__updatePlanTask(taskId: "<task-id>", notes: "Blocked: reason...")
   ```

5. **When resuming** a plan, find the first `pending` or `in_progress` task and continue from there.

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

This ensures plans are never left in `active` state when all work is done.

## Linking Related Knowledge

- **Input** (consulted during planning): Pass `relatedKnowledgeIds` when creating the plan, or use `addPlanRelation` with `relationType: "input"`
- **Output** (created/updated during execution): Use `addPlanRelation` with `relationType: "output"` for each knowledge entry you create or update

## Rules

- **Plans go ONLY in the knowledge base** — never in local plan files
- **Always include tasks** when creating a plan
- **Always include relatedKnowledgeIds** if you queried knowledge beforehand
- **Update task status in real-time** — mark in_progress when starting, completed when done
- **Run completion protocol** when all tasks are finished
- **All entries in English** — regardless of user language preference
