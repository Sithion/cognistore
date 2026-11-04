---
name: cognistore-phase
description: Execute the next phase or item of a CogniStore roadmap in documentation/plans/ (e.g. the performance + knowledge-curation plan). Use when asked to "run phase N", "continue the plan", "next step of the roadmap" or similar.
argument-hint: "[plan file] [phase or item id, e.g. 1A or 1A.3]"
---

# Execute a roadmap phase

Plans live in `documentation/plans/*.md`. Each has phases with checkbox items (`- [ ] 1A.2 ...`), a "Pronto quando" (definition of done) per phase, and a "Diário de execução" (execution log) at the end.

## Steps

1. **Load context**
   - Read the plan file in full (default: the newest file in `documentation/plans/`).
   - Load the `cognistore-dev` skill — its invariants and perf rules apply to every item.
   - Query CogniStore (`workspace:cognistore`) for prior decisions/gotchas on the files you will touch.
2. **Pick the work**
   - If the user named a phase/item, do that. Otherwise take the first unchecked item of the earliest unfinished phase whose dependencies (see "Ordem sugerida") are done.
   - Scope = one item, or one phase if its items are small. Prefer one PR per phase.
   - If an item is ambiguous or the code no longer matches the plan, stop and ask; do not improvise a different design silently.
3. **Branch**: `git switch -c plan/<phase>-<slug>` from `main` (never commit on `main`).
4. **Implement**
   - Measure first when the item is about performance: run the relevant `@perf` test or `node scripts/diagnose-db.mjs` and note the "before" number.
   - Write/extend tests in `packages/tests/src/` together with the code.
   - Follow every invariant in `cognistore-dev` (migration parity, patch notes, setup/uninstall symmetry, 3 platform templates).
5. **Verify**: `pnpm build`, the filtered test suites you touched, `pnpm lint`, `pnpm type-check`. For perf items, record the "after" number.
   - Optionally ask the `perf-reviewer` and `invariants-reviewer` subagents to review the diff.
6. **Update the plan file**
   - Tick the finished checkboxes (`- [x]`).
   - Append a line to "Diário de execução": date · item ids · branch/commit · before→after numbers · any deviation and why.
   - If you discovered new work, add it as a new unchecked item in the right phase instead of doing it now.
7. **Commit** with a message like `perf(core): batch markRead writes (plan 1A.3)`. Do not push or open a PR unless asked.
8. **Report** to the user: what was done, numbers, what is next.

## Rules

- Never mark an item done without its tests passing.
- Never delete or rewrite user knowledge in a real `~/.cognistore` DB while developing; use fixtures or a copy.
- Keep each change small enough to review; split a big item into sub-items in the plan if needed.
