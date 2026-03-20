---
name: cognistore-plan
description: >
  MANDATORY — automatically triggered when planning ANY task, regardless of complexity.
  ALL plans MUST be persisted via createPlan() in the CogniStore knowledge base.
  If plan mode (EnterPlanMode) requires a local plan file, write it AND ALSO call createPlan().
  The local file is temporary — createPlan() is the persistent source of truth.
  ANY time you finish planning, you MUST call createPlan().
user-invocable: true
argument-hint: <plan title and description>
---

# CogniStore Plan

> **BLOCKING REQUIREMENT**: ALL plans MUST be persisted via `createPlan()`. This is the persistent source of truth. Local plan files (`.claude/plans/`) are temporary artifacts of plan mode — they do NOT substitute for `createPlan()`.

## Plan Mode Integration

**When plan mode (EnterPlanMode) is active:**
1. Follow plan mode's workflow normally — write the local plan file as instructed
2. **After ExitPlanMode**, IMMEDIATELY call `createPlan()` to persist the plan in the knowledge base
3. The local plan file is ephemeral. `createPlan()` is what makes the plan searchable, trackable, and persistent across sessions

**When NOT in plan mode:**
- Call `createPlan()` directly — no local file needed

## When to Create a Plan — ALWAYS

**Every task that involves planning MUST use createPlan().** No minimum complexity threshold:
- Feature, bug fix, refactoring, migration, research, any multi-step work → **createPlan()**

## FORBIDDEN

- **NEVER** persist a plan ONLY as a local file without also calling `createPlan()`
- **NEVER** use only TodoWrite as a substitute — those are for in-session tracking, NOT persistence
- **NEVER** describe a plan only in chat without persisting it
- **NEVER** skip createPlan() because "it's a small task"
- **NEVER** call createPlan() from a subagent (Agent tool) — ONLY the main agent creates plans

## How to Create (with Tasks)

```
mcp__cognistore__createPlan({
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

**Important**: Always include a `tasks` array when creating a plan.

## Task Management During Execution (MANDATORY — Real-Time Tracking)

**You MUST update task status as you work. Do NOT batch updates at the end.**

1. **Before starting work** → `listPlanTasks(planId)` + `updatePlan(planId, { status: "active" })`
2. **BEFORE each task** → `updatePlanTask(taskId, { status: "in_progress" })` — do NOT skip
3. **AFTER each task** → `updatePlanTask(taskId, { status: "completed", notes: "..." })` — do NOT batch
4. **If blocked** → `updatePlanTask(taskId, { notes: "Blocked: ..." })`
5. **When resuming** → find first `pending` or `in_progress` task
6. **New tasks** → `addPlanTask(planId, description, priority)`

**Flow: `in_progress` → do work → `completed`. Never skip `in_progress`.**

## Plan Lifecycle

1. **Create** → status: `draft` (automatic)
2. **Start execution** → `updatePlan(planId, { status: "active" })`
3. **During execution** → `addPlanRelation(planId, knowledgeId, "output")` for new knowledge
4. **Complete** → see completion protocol below

## Plan Completion Protocol (MANDATORY)

1. `listPlanTasks(planId)` to verify ALL completed
2. If all completed → `updatePlan(planId, { status: "completed" })`
3. If any NOT completed → leave `active`, add notes

## Linking Related Knowledge (MANDATORY)

- **Input** (consulted during planning): pass IDs as `relatedKnowledgeIds` in `createPlan()`, or use `addPlanRelation(planId, knowledgeId, "input")`
- **Output** (created during execution): `addPlanRelation(planId, knowledgeId, "output")` after each `addKnowledge()`

## Rules

- **createPlan() is the source of truth** — local files are temporary
- **Always include tasks** when creating a plan
- **Always link knowledge** — relatedKnowledgeIds on create, addPlanRelation during execution
- **Update task AND plan status in real-time** — in_progress → completed, draft → active → completed
- **Run completion protocol** when all tasks are finished
- **All entries in English** — regardless of user language preference
