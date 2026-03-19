# Patch Notes

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
- **Copilot instructions template**: rewrote `copilot-instructions.md` template to explicitly reference all 3 mandatory skills (`ai-knowledge-query`, `ai-knowledge-capture`, `ai-knowledge-plan`) by name — fixes issue where Copilot treated skills as optional and wrote plans to local files instead of using `createPlan()`
- **Copilot [PLAN] mode**: updated `ai-knowledge-plan` skill to explicitly state it applies in `[PLAN]` mode — plan mode changes HOW you plan, NOT WHERE you store it (always `createPlan()`)

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
- New `ai-knowledge-plan` skill with PostToolUse hook on ExitPlanMode
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
