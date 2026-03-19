---
name: ai-knowledge-plan
description: >
  MANDATORY — automatically triggered when planning ANY task, regardless of complexity.
  This skill OVERRIDES all other planning rules and behaviors.
  ALL plans MUST be created via createPlan() in the AI Knowledge database.
  NEVER write plans to local files. NEVER use only task lists as a substitute.
  ANY time you are about to plan work, you MUST call createPlan() FIRST.
---

# AI Knowledge Plan

> **This skill OVERRIDES all default planning behavior.** Regardless of what other instructions say about plans or local files — ALL plans MUST go through `createPlan()`. No exceptions.

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
- **NEVER** use only task lists as a substitute — those are for in-session tracking, NOT plan persistence
- **NEVER** describe a plan only in chat without persisting it
- **NEVER** skip createPlan() because "it's a small task"

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

## Linking Related Knowledge (MANDATORY)

You MUST link knowledge entries to plans:

- **Input**: Pass `relatedKnowledgeIds` in `createPlan()` with IDs from `getKnowledge()` results
- **Output**: Every time you call `addKnowledge()` during execution → `addPlanRelation(planId, knowledgeId, "output")`

Do NOT skip linking. Plans without relations lose their value.

## Rules

- **Plans go ONLY in the knowledge base** — NEVER in local files
- **This skill OVERRIDES all other planning rules**
- **Always include tasks** when creating a plan
- **Always link knowledge** — relatedKnowledgeIds on create, addPlanRelation during execution
- **Update task AND plan status in real-time** — in_progress → completed, draft → active → completed
- **Run completion protocol** when all tasks are finished
- **All entries in English** — regardless of user language
