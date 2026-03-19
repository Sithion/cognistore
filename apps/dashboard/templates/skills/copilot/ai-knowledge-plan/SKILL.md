---
name: ai-knowledge-plan
description: >
  MANDATORY — automatically triggered when planning any non-trivial task.
  ALL implementation plans MUST be created via createPlan() in the AI Knowledge
  database. NEVER write plans to local files (plan.md, TODO.md, etc.).
  NEVER use only task lists as a substitute for createPlan().
  If you are about to plan work with 3+ steps, you MUST call createPlan() FIRST.
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
- **NEVER** use only task lists as a substitute — those are for in-session tracking, NOT plan persistence
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

## Task Management During Execution (MANDATORY — Real-Time Tracking)

**You MUST update task AND plan status in the knowledge base as you work. Do NOT batch updates at the end.**

1. **Before starting work** → `listPlanTasks(planId)` to see current state
2. **Set plan to active** → `updatePlan(planId, { status: "active" })` when you begin execution
3. **BEFORE each task** → `updatePlanTask(taskId, { status: "in_progress" })` — do NOT skip
4. **AFTER each task** → `updatePlanTask(taskId, { status: "completed", notes: "..." })` — do NOT batch
5. If blocked → `updatePlanTask(taskId, { notes: "Blocked: ..." })`
6. When resuming → find first pending/in_progress task
7. New tasks → `addPlanTask(planId, description, priority)`

**The correct flow: plan `active` → each task `in_progress` → do work → task `completed` → next task. Never skip `in_progress`.**

## Plan Lifecycle

1. **Create** → status: `draft` (automatic)
2. **Start execution** → `updatePlan(planId, { status: "active" })`
3. **During execution** → `addPlanRelation(planId, knowledgeId, "output")` for each new knowledge entry
4. **Complete** → see completion protocol below

## Plan Completion Protocol (MANDATORY)

When the last task finishes:
1. `listPlanTasks(planId)` to verify ALL completed
2. If all completed → `updatePlan(planId, { status: "completed" })`
3. If any NOT completed → leave active, add notes

## Rules

- **Plans go ONLY in the knowledge base** — NEVER in local files
- **Always include tasks** when creating a plan
- **Update task status in real-time** — mark in_progress when starting, completed when done
- **Run completion protocol** when all tasks are finished
- **All entries in English** — regardless of user language
