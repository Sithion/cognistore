# Patch Notes

## v1.0.0

### Milestone
First stable release. All features validated across Claude Code, Copilot, and OpenCode via automated test battery (5/5 scores).

## v0.9.16

### Features
- **System knowledge type** (`type='system'`): mandatory entries seeded during setup/upgrade, injected into agent context via UserPromptSubmit hook. Contains the CogniStore workflow protocol (query-first, plan lifecycle, capture-after)
- **System knowledge guards**: system entries cannot be deleted (single, bulk, or MCP), type cannot be changed via update, stripped from imports, excluded from dashboard, stats, search, and export
- **Archive button**: completed plans can now be archived from the dashboard via a new "Archive" button with confirmation modal
- **Active plans grid**: active plans section uses responsive CSS grid layout with blue left accent border and scope badge
- **Hook-based protocol injection**: UserPromptSubmit hooks read system knowledge from DB and inject as `[COGNISTORE-PROTOCOL]` system message, with hardcoded fallback if sqlite3 unavailable

### Fixes
- **Plan lifecycle enforcement**: SKILL.md templates now explicitly state `archived` status is dashboard-only — agents must never set it
- **Import sanitization**: CSV and JSON imports with `type='system'` are automatically downgraded to `type='pattern'`

## v0.9.15

### Features
- **Reusable ConfirmModal component**: new portal-based modal (`ConfirmModal.tsx`) with backdrop blur, Escape key, loading state, and i18n support — used as the standard for all destructive confirmations
- **Knowledge delete via modal**: replaced inline confirm/cancel buttons in KnowledgeCard with a proper confirmation modal
- **Bulk delete confirmation**: bulk delete now shows a modal with entry count before executing (previously had no confirmation)
- **Uninstall via modals**: converted the inline multi-step uninstall flow to a 2-step modal confirmation sequence

### Fixes
- **KnowledgeCard simplified**: removed `confirmingDelete` and `onCancelDelete` props — delete button now delegates to parent modal
- **PlansPage refactored**: plan delete now uses the shared ConfirmModal instead of an inline implementation

## v0.9.14

### Features
- **Input-based plan detection**: CHECKPOINT 3 now has dual triggers — INPUT (user message contains 3+ action steps) and OUTPUT (agent produced 2+ ordered steps). Previously only OUTPUT was detected, missing multi-step user requests
- **MCP tool annotations**: Read-only tools marked with `readOnlyHint: true` (getKnowledge, listTags, healthCheck, listPlanTasks). Future-proofing for when clients respect annotations in plan mode
- **MCP Resource `cognistore://context/{scope}`**: Exposes scope-aware KB context as auto-loaded resource with recent entries, active plans, and tags. Prepares for future resource support in plan mode
- **Permission config injection**: Read-only CogniStore tools auto-allowed in Claude Code's dontAsk mode via `~/.claude/settings.json` permission rules
- **Graceful degradation notice**: Agents warn when they cannot save plans to KB (tools blocked in plan mode)

### Fixes
- **Plan mode persistence**: createPlan() is now called BEFORE ExitPlanMode (not after). Fixes race condition where agent's turn ended before persisting the plan
- **OpenCode execution tracking**: Full Execution Tracking Protocol added to AGENTS.md (updatePlanTask lifecycle that Claude/Copilot get from SKILL.md Phase 2)
- **UserPromptSubmit hook**: INPUT detection added to cognistore-query hooks to detect multi-step tasks at the earliest point
- **Subagent plan leak**: Explicit instruction added to prevent subagents from calling createPlan() — "When launching a subagent, include 'Do NOT call createPlan()' in the prompt"

### Known assumptions
- **MCP tools in plan mode**: The plan mode persistence fix relies on MCP tools (createPlan, getKnowledge) being callable during Claude Code's plan mode. This was empirically confirmed (2026-03-20) but is not guaranteed by the spec — Anthropic could restrict MCP calls in plan mode in a future release. The `post-plan-check.sh` hook serves as a fallback if this assumption breaks.

## v0.9.13

### Fixes
- **Output-based plan detection**: CHECKPOINT 3 in all instruction templates (Claude Code, Copilot, OpenCode) now triggers based on OUTPUT — "if you produced 2+ ordered implementation steps, call createPlan()" — instead of intent ("any time you plan work"). This fixes plan mode ignoring createPlan() because the agent didn't identify itself as "planning work"
- **Consistent language across all templates**: all 3 instruction templates + both user-prompt-check.sh hooks use the same output-based detection rule

## v0.9.12

### Features
- **OpenCode AGENTS.md instructions**: new instruction template injected into `~/.config/opencode/AGENTS.md` during setup — OpenCode now gets the same knowledge-first protocol as Claude Code and Copilot (query → plan → track → capture)
- **OpenCode setup/upgrade/uninstall symmetry**: AGENTS.md is injected on setup, re-injected on upgrade/redeploy, and cleaned up on uninstall

### Fixes
- **Skill/hook rewrite — full lifecycle coverage**: skills and hooks now cover the entire plan lifecycle (creation + execution tracking), not just plan mode events. Previously hooks only fired on EnterPlanMode/ExitPlanMode, missing execution-phase tracking entirely
- **Claude Code plan mode compatibility**: `pre-plan-file-check.sh` now detects `.claude/plans/` directory paths (plan mode generates random slugs like `sorted-jumping-whistle.md` that the previous filename-only check missed)
- **Claude Code SKILL.md conflict**: changed approach from "NEVER write local files" to "write local AND ALSO call createPlan()" — works WITH plan mode instead of against it, resolving instruction priority conflict where system-level plan mode instructions overrode skill-level instructions
- **Claude Code `post-plan-check.sh`**: shortened verbose 8-line message to 1 direct instruction — reduces likelihood of model ignoring the hook after "finishing" planning
- **Copilot execution tracking**: restructured SKILL.md with Two-Phase Workflow (Planning + Execution) at the top, added execution tracking callout and task tracking reference table
- **Copilot hook fatigue**: shortened hook messages; `post-plan-check` now includes execution tracking reminder instead of only planning reminder
- **`user-prompt-check.sh` (both agents)**: updated to include execution tracking reminders on every user message, not just plan creation
- **Instruction templates**: claude-code-instructions.md and copilot-instructions.md updated with consistent plan tracking language
- **Renamed "AI Knowledge" to "CogniStore"**: all SKILL.md titles now use "CogniStore Plan" instead of "AI Knowledge Plan"

## v0.9.11

## v0.9.5

### Features
- **Export/Import**: export knowledge entries (JSON/CSV) and plans (JSON) for backup or migration; import with duplicate detection (hash-based) and automatic embedding regeneration
- **Scope Autocomplete**: replaced free-text scope input with dropdown autocomplete showing existing scopes across knowledge and plans; custom values still allowed
- **Bulk Delete**: checkbox selection mode on knowledge entries with bulk action bar (select all, deselect all, delete selected)
- **Plan Templates**: 4 predefined plan structures (Bug Fix, Feature, Refactoring, Investigation) with pre-filled title patterns, markdown content, default tags, and task lists
- **Inline Task Editing**: click-to-edit task descriptions, priority dropdown, editable notes, and status cycling (click status icon) directly in plan detail view

### Improvements
- **Data Management section in Settings**: centralized export/import UI with buttons for JSON/CSV knowledge export, plans JSON export, and file picker for imports with progress indicator
- **Export buttons on pages**: quick-access export buttons on Knowledge and Plans pages
- **New API endpoints**: `GET /api/scopes`, `DELETE /api/knowledge/bulk`, `GET /api/export/knowledge`, `GET /api/export/plans`, `POST /api/import/knowledge`, `POST /api/import/plans`

### Fixes
- **Duplicate plan prevention**: subagents (Agent tool) are now explicitly blocked from calling `createPlan()` — only the main conversation agent creates plans, preventing duplicate entries in the knowledge base

## v0.9.4

### Features
- **Create Plan from Dashboard**: users can now create draft plans directly from the Plans page with title, description, tags, scope, and tasks — then ask an agent to refine and execute the plan
- **POST /api/plans endpoint**: new server endpoint for creating plans from the dashboard UI

### Improvements
- **Markdown rendering**: plan detail view and card previews (both Plans and Knowledge) now render content as formatted markdown (headings, lists, code blocks, tables, blockquotes)
- **Unified UI pattern**: both Knowledge and Plans pages now use floating action button (FAB) + full-page form view instead of modal overlay
- **Unified 5s polling**: all pages now auto-refresh every 5 seconds; removed manual refresh interval selector from Stats page
- **Activity chart**: replaced single-line area chart with 3-line chart (Total, Reads, Writes) with color legend

### Fixes
- **Copilot instructions template**: rewrote `copilot-instructions.md` template to explicitly reference all 3 mandatory skills (`cognistore-query`, `cognistore-capture`, `cognistore-plan`) by name — fixes issue where Copilot treated skills as optional and wrote plans to local files instead of using `createPlan()`
- **Copilot [PLAN] mode**: updated `cognistore-plan` skill to explicitly state it applies in `[PLAN]` mode — plan mode changes HOW you plan, NOT WHERE you store it (always `createPlan()`)

## v0.9.3

### Improvements
- **Plan enforcement**: createPlan() now mandatory for ALL tasks (removed "3+ steps" threshold)
- **Override clause**: plan skill explicitly overrides all other planning rules (EnterPlanMode, TodoWrite, local files)
- **Knowledge linking**: mandatory relatedKnowledgeIds on create + addPlanRelation during execution
- **Plans list auto-refresh**: 10s polling on plans list view (not just detail view)
- **CI version check**: new `version-check` job blocks PRs to main that forget version bumps

## v0.9.2

### Fixes
- **PlansPage**: removed plan status change buttons from dashboard — plan status can only be changed by agents via MCP

### Improvements
- **Copilot skills**: converted from flat `.md` files to directory format (`SKILL.md` + hooks) matching Claude Code structure
- **Copilot hooks**: added `preToolUse`, `sessionEnd`, and `postToolUse` hooks (parity with Claude Code)
- **Instruction templates**: stronger enforcement language with CHECKPOINT-based flow for both Claude Code and Copilot
- **Skill descriptions**: rewritten with MANDATORY/BLOCKING REQUIREMENT language for better auto-triggering
- **UserPromptSubmit hook**: new earliest-possible hook fires when user sends a message, BEFORE any tool use — reminds to query knowledge base and use createPlan() for multi-step tasks
- **Plan enforcement**: added CHECKPOINT 3 to instruction templates — 3+ steps = mandatory createPlan()
- **Plan file guard hook**: new PreToolUse hook on Write/Edit detects plan-like filenames (plan.md, TODO.md, etc.) and warns to use createPlan() instead
- **Plan skill rewrite**: explicit FORBIDDEN section listing banned patterns (local files, task-list-only, chat-only plans)
- **PostToolUse hook strengthened**: ExitPlanMode hook now explicitly forbids local file plans and task-list substitutes
- **Re-deploy button**: new "Re-deploy configurations" in Settings → Maintenance re-deploys skills, hooks, instructions, and MCP configs without losing data
- **Plan detail auto-refresh**: 5s polling on plan detail view + new `GET /api/plans/:id` endpoint
- **Upgrade cleanup**: old flat Copilot skill files (`.md`) are automatically removed during upgrade

## v0.9.1

### Upgrade System (New)
- App detects version changes on startup and shows upgrade screen (`vOLD → vNEW`)
- Re-deploys: database migrations, agent instructions, MCP configs, skills/hooks
- Visual progress with step-by-step status indicators

### Bug Fixes
- **Embedded migrations**: MCP server now works via npx (SQL embedded in code, not external files)
- **UpdateChecker**: distinguish manual vs automatic checks — errors only shown when user clicks "Check for updates"
- **UpdateChecker**: new states `upToDate`, `error`, `unavailable` with proper SettingsPage feedback
- **Plan creation**: rollback plan if task creation fails (no more orphaned plans)
- **HTTP status codes**: 404 returned for missing resources (was 200 with error body)
- **Upgrade race condition**: concurrent upgrade requests blocked with 409 Conflict
- **PlansPage**: shows error message instead of infinite loading on API failure
- **Version tracking**: `.version` file saved on setup completion (not via fragile hook)

### Other
- **CI:** no longer triggers on push to `main` (only PRs + feature branches)
- **PATCH-NOTES.md** added and linked from README
- **CLAUDE.md**: development rules (upgrade scripts, patch notes, testing) for all contributors

## v0.9.0

### Plans (New Feature)
- Plans are now a **separate entity** with their own `plans` table and embedding
- Plan tasks (`plan_tasks`) with status (pending/in_progress/completed), priority (low/medium/high), notes, and position ordering
- Plan relations (`plan_relations`) link plans to knowledge entries as input (consulted) or output (produced)
- 6 new MCP tools: `createPlan`, `updatePlan`, `addPlanRelation`, `addPlanTask`, `updatePlanTask`, `listPlanTasks`
- New `/plans` dashboard page with active plans section, task icons (spinner/check), progress bars, and priority indicators
- Plan analytics on StatsPage: metric cards, status distribution chart, task completion chart, activity chart

### Migration System
- Versioned SQL migrations (`schema_version` table + `.sql` files per version)
- Bootstrap detection for existing databases (automatically marks v0.8.0 as applied)
- Seeds directory for initial data on fresh installs

### Upgrade System (New)
- App detects version changes on startup and shows upgrade screen
- Re-deploys: database migrations, agent instructions, MCP configs, skills/hooks
- Visual progress with `vOLD → vNEW` header and step-by-step status

### Knowledge Improvements
- `title` field added to all knowledge entries (mandatory, shown on cards)
- `addKnowledge` MCP tool now requires `title` parameter
- `PLAN` removed from KnowledgeType (plans are separate)

### Dashboard
- Cleanup orphan embeddings moved from Stats to Settings > Maintenance
- New `cognistore-plan` skill with PostToolUse hook on ExitPlanMode
- Plan completion protocol: agents must verify all tasks completed before closing plan

### Auto-Update
- Removed redundant `generate-updater` CI job (tauri-action handles `latest.json`)

### Testing
- 69 automated tests in `packages/tests` (E2E, load, performance)
- CI workflow runs on PRs and feature branch pushes
- Pre-commit security hook scans for leaked secrets

### Documentation
- README and all 9 documentation files updated for v0.9.0

---

## v0.8.1

- Operations stats: read/write counters (last hour + last day)
- Settings page (renamed from Monitoring): infrastructure, updates, language, maintenance
- Heatmap color scheme (GitHub-style green)
- Browser language auto-detection
- UI improvements: chart tooltips, cleanup button as trash icon

## v0.8.0

- Mandatory skills with hooks (PreToolUse, Stop)
- Monitoring page with health checks
- UI improvements

## v0.7.x

- Bug fixes, CI improvements, search fixes, tag input redesign
