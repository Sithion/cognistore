---
name: ai-knowledge-plan
description: >
  Persist implementation plans with task tracking in the AI Knowledge database.
  MANDATORY: All plans MUST be stored exclusively in the knowledge base.
---

# AI Knowledge Plan

**MANDATORY**: All implementation plans MUST be stored in the knowledge base via `createPlan()`. Never save plans to local files.

## How to Create (with Tasks)

```
mcp__ai-knowledge__createPlan({
  title: "Short descriptive title",
  content: "Full plan content",
  tags: ["feature-name", "component"],
  scope: "workspace:<project-name>",
  source: "planning session for <task>",
  relatedKnowledgeIds: ["id1", "id2"],
  tasks: [
    { description: "Step 1", priority: "high" },
    { description: "Step 2" }
  ]
})
```

## Task Management

1. Before starting → `listPlanTasks(planId)` to see current state
2. For each task → `updatePlanTask(taskId, { status: "in_progress" })`
3. When done → `updatePlanTask(taskId, { status: "completed", notes: "..." })`
4. If blocked → `updatePlanTask(taskId, { notes: "Blocked: ..." })`
5. When resuming → find first pending/in_progress task
6. New tasks → `addPlanTask(planId, description, priority)`

## Plan Completion Protocol (MANDATORY)

When the last task finishes:
1. `listPlanTasks(planId)` to verify ALL completed
2. If all completed → `updatePlan(planId, { status: "completed" })`
3. If any NOT completed → leave active, add notes

## Rules

- Plans go ONLY in the knowledge base
- Always include tasks array
- Update task status in real-time
- Run completion protocol when done
- All entries in English
