---
description: "Query CogniStore knowledge base before any task"
---

# cognistore-query

Your FIRST action on every task: search the knowledge base for existing insights.

```
cognistore_getKnowledge(query: "<describe the task>")
```

Save returned entry IDs for createPlan's relatedKnowledgeIds.

## Superseded results and contradictions

- Ignore results whose status is superseded; they are kept only for history.
- If you find two entries that contradict each other, report it with `cognistore_resolveCuration(itemId: <entry id>, decision: "flag", reason: "...")` so the curation queue shows it to the user.
