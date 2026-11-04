---
name: cognistore-maintain
description: >
  Review the CogniStore curation queue for the current workspace: merge,
  supersede, reject or flag proposed knowledge changes (up to 10 per run).
  Run it when the session-end hook suggests maintenance or when asked to
  clean up knowledge.
user-invocable: true
argument-hint: <optional scope, defaults to the current workspace>
---

# CogniStore Maintain

Second-level curation: the local model proposes merges, supersessions and aging; you, the agent, judge them with far better reasoning and resolve them.

## Procedure

1. Fetch the queue for the CURRENT workspace scope (at most 10 items per run):

```
mcp__cognistore__getCurationQueue(scope: "workspace:<current project name>", limit: 10)
```

2. For each item, read the listed entries and the proposal reason, then decide:

| Situation | Call |
|-----------|------|
| True duplicates, nothing lost by merging | `mcp__cognistore__resolveCuration(itemId: <action id>, decision: "apply", reason: "...")` (optionally pass `mergedTitle` + `mergedContent` together when you wrote a better merged text) |
| A newer entry replaces older ones | `mcp__cognistore__supersedeKnowledge(oldIds: [...], newId: "...", reason: "...")` |
| Entries are distinct or the proposal is wrong | `mcp__cognistore__resolveCuration(itemId: <action id>, decision: "reject", reason: "...")` |
| Two entries contradict each other | `mcp__cognistore__resolveCuration(itemId: <entry id>, decision: "flag", reason: "...")` |

## Rules

- NEVER touch entries tagged `keep` or of type `system`.
- ALWAYS pass a concrete `reason` (one sentence, English).
- Stop after 10 items and report a one-line summary: applied, rejected, flagged.
- If `mcp__cognistore__resolveCuration` is denied by permissions, tell the user to allow `mcp__cognistore__resolveCuration` and stop; do not try other tools to work around it.
- Merges are reversible for 30 days; still prefer `reject` when unsure.
