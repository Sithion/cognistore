---
description: "Capture knowledge after completing tasks"
---

# cognistore-capture

Before finishing, save what you learned:

```
cognistore_addKnowledge({
  title: "Descriptive title for semantic search",
  content, tags,
  type: "pattern|decision|fix|constraint|gotcha",
  scope, source,
  planId: "<your-plan-id>"
})
```

- Always pass `planId` and a descriptive `title` (powers semantic search)
- Dedup is automatic — similar entries in same scope+type are updated, not duplicated
- **Prefer `scope: "global"`** for language/framework/tool insights that apply beyond this project
- All entries in English

## Pattern Checklist

Before finishing, check: did you discover any reusable **pattern** about a language, framework, library, or tool? If yes, store it with `type: "pattern"`, `scope: "global"`. Patterns compound across every future project.

## Pre-Capture Check
Before capturing knowledge, ensure any active plan tasks are marked completed.

## Avoid duplicates and supersessions

- Search before adding. If an entry on the topic already exists, use `cognistore_updateKnowledge` to update it instead of adding a near copy.
- If the new entry REPLACES older ones, pass `supersedes: [<old ids>]` when adding or updating. Never prefix a title with SUPERSEDED.
