# Patch Notes

## v0.9.1

- **Fix:** CI workflow no longer triggers on push to `main` (only PRs + feature branches)

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
