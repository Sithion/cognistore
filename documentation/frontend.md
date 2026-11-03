# Frontend Architecture

## Overview

The dashboard frontend is a React 19 SPA built with Vite and Tailwind CSS 4, using Redux Toolkit and React Router. Production screens share the shadcn/ui design system, semantic theme tokens, local fonts, lucide icons, sonner notifications, and a cmdk command palette. The Tauri WebView and browser tests load the application and API from the same Fastify sidecar origin.

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19 | UI framework |
| Vite | 6 | Build tool + HMR |
| Tailwind CSS | 4 | Utility-first styling |
| Redux Toolkit | 2 | State management |
| React Router | 7 | Client-side routing |
| Recharts | 2 | Charts and data visualization |
| react-i18next | 16 | Internationalization |
| React Query | 5 | Server state (setup page) |

## Pages

### HomePage (`/`)

Knowledge management interface with search, filters, and CRUD.

**Components:**
- Search bar with natural language query input
- Bulk select toggle (SVG checkbox icon) for multi-delete with floating action bar
- Filter dropdowns: type (decision/pattern/fix/constraint/gotcha), scope, tags
- Cleanup banner when a report has pending proposals (reads `/api/cleanup/pending-count` once per mount, dismissible per session)
- Knowledge cards grid with title, tag chips, type badges, related plans, and similarity scores
- Inline icon buttons: pencil (amber) for edit, trash (red) for delete
- Floating action button (FAB) → add knowledge modal (confidence score step: 0.01 for fine granularity)
- Auto-refresh polling (detects new entries every 5 seconds)

### PlansPage (`/plans`)

Plan management with live task tracking.

**Components:**
- Active plans section at top showing plans with `active` status in a responsive grid layout
- Task list per plan with status icons: ○ pending, spinner in_progress, ✓ completed
- Priority left-border colors: red (high), yellow (medium), gray (low)
- Progress bars and mini progress counters (e.g., "3/5 tasks")
- **Delete button** (red trash icon) per task row in the plan detail view — confirms with the task's own description, then refreshes the plan, its progress and the list counts. The read-only task lists on the active-plan cards carry no actions
- **Status filter chips** (`Draft` / `Active` / `Completed` / `Archived`) are a multi-select toggle group, not a radio group: each chip toggles independently and they combine, so `Draft` + `Active` lists both. There is deliberately **no "All" chip** — deselecting every chip *is* "all". The selection is sent to `GET /api/plans` as a comma-separated `status` list and composes with the scope dropdown
- Plan relations sections (input/output knowledge entries)
- **Origin** line at the top of the detail view for a plan that continues another one: names the parent and jumps to it. The title comes from the chain when present; the chain walk is bounded, so a distant parent falls back to a short id
- **`↳ Continuation` chip** on the cards in both plan lists (active plans and the paginated list) when the plan has a parent — clicking it opens the parent instead of the card's own plan
- **Plan chain** section (hidden for standalone plans, where the chain is just the plan itself): the ORIGINAL plan and every follow-up, indented by server-computed depth, with an `Original` badge at depth 0 and a status badge per row; every row except the one being viewed is clickable and switches the detail view to that plan. A note appears when the chain returned is only part of a longer one
- Plan status lifecycle: draft → active → completed → archived
- **Archive button** on completed plans — allows users to archive plans directly from the dashboard (agents cannot set `archived` status via MCP; this is a user-only action)
- All destructive actions (delete plan, delete entry, etc.) use the shared **ConfirmModal** component

### StatsPage (`/stats`)

Analytics dashboard with charts and metrics.

**Components:**
- Metric cards: total entries, 24h activity, 7d activity, database size
- Type distribution pie chart (Recharts)
- Scope distribution bar chart
- 15-day activity trend area chart
- 90-day contribution heatmap
- Tag cloud with size variation
- Plans analytics section: donut charts (status/scope distribution), area chart (plan activity), metric cards (total plans, active, completed)
- Auto-refresh interval selector (Off / 1s / 10s / 30s / 1m / 5m)
- Manual refresh button with inline spinner

### SettingsPage (`/settings`)

System health monitoring, updates, data management, maintenance, and uninstall.

**Components:**
- Service status cards: Database (connected/path), Ollama (connected/host)
- Overall health indicator (green/red) with polling every 5 seconds
- Check for updates: auto-update in Tauri, GitHub Releases API fallback in dev mode
- Language selection (English, Spanish, Portuguese)
- Maintenance: re-deploy configurations, remove unused embeddings
- Data Management: unified Export/Import with modal-based flows (checkboxes for knowledge/plans selection, single JSON file)
- Cleanup Report: the periodic proposal of removable entries. Three groups — deprecated, unread, and duplicate groups to consolidate. Removals are approved per item or per group (never across groups); a consolidation shows its members with the canonical starred and can only be applied *after* its merged text has been previewed, so nothing unseen is ever applied. Renders the unread-detection gate (including the date it activates) instead of a silently empty list, and labels the unread group with the configured window. The settings themselves are read-only here — there is no editor for them in this release.
- Danger Zone: uninstall button with confirmation dialog

### SetupPage (conditional, first launch)

7-step sequential installation wizard.

**Components:**
- Step list with status icons (pending/running/done/error)
- Progress tracking per step
- Retry button on failure
- "Open Dashboard" button on completion

### UpgradePage (boot screen, not routed)

Shown by `App.tsx` whenever `/api/upgrade/check` reports an upgrade is due — it both **runs** the upgrade (`POST /api/upgrade/run`) and shows its progress. It is not a failure screen: before v2.4.1 the upgrade ran silently behind the loading screen and this page was reached only when that failed.

**Components:**
- Version header (`from → to`) and a progress bar whose denominator adapts to the number of steps actually emitted (two of them are conditional)
- Step rows fed by polling `GET /api/upgrade/progress` (750 ms) while the POST is in flight, plus a spinner row for the step in progress; the POST result replaces the list when it lands, since only it carries step messages
- `Finishing previous update…` while a deploy that was already running has not released yet
- Status icons cover `success` / `error` / `skipped` / `warning`
- On success: brief "Update complete!" then the dashboard opens automatically; on failure: a static message and a Retry button

## State Management

### Redux Store

**File:** `apps/dashboard/src/store/statsSlice.ts`

```typescript
interface StatsState {
  stats: Stats | null;           // total, byType[], byScope[]
  statsState: LoadState;         // idle | loading | loaded | empty | error
  metrics: Metrics | null;       // database, activity, heatmap, charts
  metricsState: LoadState;
  tags: string[];
  tagsState: LoadState;
  lastFetchedAt: number | null;
  isRefreshing: boolean;         // True during background refresh
  refreshInterval: RefreshInterval; // 0|1|10|30|60|300 seconds
}
```

**Async Thunks (all with 3-attempt retry):**
- `fetchStats()` — Total entries + breakdown by type/scope
- `fetchMetrics()` — Database size, activity counters, chart data
- `fetchTags()` — Unique tags list

**Actions:**
- `setRefreshInterval(value)` — Configure auto-refresh frequency

### Loading Strategy

Following the project's "no blocking loading" rule:
- No full-page spinners or blocking overlays **inside the dashboard**
- Small inline spinner next to section titles during background refresh
- Data displays immediately from cache; refreshes happen silently
- `isRefreshing` flag drives the inline spinner visibility

The boot screens are the deliberate exception: SetupPage and UpgradePage are full-screen and block, because there is no dashboard to show until they finish. Both state what they are doing rather than spinning anonymously — the upgrade screen lists each step as it completes (see below).

## Internationalization

**File:** `apps/dashboard/src/i18n/index.ts`

| Language | Code | Status |
|----------|------|--------|
| English | `en` | Default |
| Spanish | `es` | Complete |
| Portuguese (BR) | `pt` | Complete |

**Persistence:** `localStorage` key `cognistore-lang`
**UI:** Language switcher buttons (EN/ES/PT) in sidebar footer
**Guard:** `typeof window !== 'undefined'` check for SSR safety

## Routing

**Registry:** `apps/dashboard/src/navigation/routes.ts` defines destinations, grouped navigation metadata, hidden internal routes, and compatibility redirects. The public groups are Work (Knowledge, Plans, Curation), Insights, Integrations, and Settings/System. The sidebar is collapsible and persists its collapsed state in `localStorage` (`cognistore.sidebar.collapsed`). The command palette is available with Cmd+K or Ctrl+K. Keyboard shortcuts include `g` followed by `k`, `p`, `c`, `i`, or `s`; `/` focuses search, `n` starts a knowledge entry, `Esc` closes an open detail, and `?` opens shortcut help. Shortcuts do not intercept typing in inputs or dialogs.

**Application boot:** `App.tsx` checks `/api/setup/status`, then `/api/upgrade/check`; it shows setup or upgrade screens as needed before mounting the dashboard routes.

**Public routes:** `/` and `/knowledge` show Knowledge; `/knowledge/:id` addresses an entry detail; `/plans` and `/plans/:id` show the plan list and detail; `/curation` shows the latest cleanup report and knowledge health, with `/curation/history` for the available report history view and `/curation/trash` explicitly reporting that trash/restore is unavailable; `/insights/knowledge`, `/insights/plans`, and `/insights/tokens` show analytics; `/integrations/agents`, `/integrations/providers`, and `/integrations/widgets` cover integrations; `/settings/general`, `/settings/models`, `/settings/curation`, `/settings/telemetry`, and `/settings/advanced` address Settings sections; `/system/health` and `/system/about` show system information. `/_design` and its subroutes are hidden internal design-preview routes.

**Compatibility redirects:** `/stats` → `/insights/knowledge`, `/stats/plans` → `/insights/plans`, `/tokens` → `/insights/tokens`, `/providers` → `/integrations/providers`, `/widgets` → `/integrations/widgets`, and `/settings` → `/settings/general`. Legacy `/?edit=<id>` links become `/knowledge/<id>` and legacy plan selection is carried into `/plans/<id>`. Redirects preserve query parameters where applicable. The Fastify sidecar serves the SPA for application paths and continues to enforce authentication on `/api` routes.

**URL state contract:** Knowledge detail IDs are path segments; the list filters, search, pagination, and creation/edit state are query parameters. Plan detail IDs are path segments, with status, scope, sort, and page in the query string. Insights scope, provider, and date-range filters are URL-addressable. Filter changes retain other query parameters where applicable, and browser history supports navigation between list and detail states. Shareable URLs can be copied or reloaded to restore the represented view.

**Theme:** `apps/dashboard/src/design/theme.ts` persists `light`, `dark`, or `system` in `localStorage` under `cognistore.theme`; dark is the fallback when no valid value is stored. `public/theme-init.js` applies the saved choice before React renders to avoid a first-paint flash. System mode follows the operating-system color preference.

**Coverage:** React component tests live in `packages/tests/src/ui` and use Vitest with Testing Library (`pnpm --filter @cognistore/tests test:ui`). Playwright browser tests live in `packages/tests/src/e2e`; `packages/tests/src/ui/browser-fixture.ts` starts an isolated Fastify sidecar and mock embedding service, seeds knowledge and a plan, injects the test API token, and exercises application routes on the sidecar origin.

**Unavailable capabilities:** Curation history currently exposes only the latest cleanup report; full curation history, deletion audit records, trash, and undo/restore are unavailable. The system screen reports setup readiness and database/Ollama health; platform MCP process health is unknown because process information is unavailable. No scope-filtered chart behavior is provided by the Insights screens. These UI routes do not imply future API endpoints.

## Layout

**Sidebar:**
- App logo + name
- Navigation links (Knowledge, Plans, Stats, Settings)
- Language selector (EN/ES/PT buttons)
- App version display

**Header:**
- Page title
- Auto-refresh indicator (inline spinner when `isRefreshing`)

**Content:**
- Full-width content area with page component

## Auto-Update UI

**File:** `apps/dashboard/src/components/UpdateChecker.tsx`

Fixed-position banner (z-index: 9999) that appears when an update is available:

```
States:
1. Checking (invisible)
2. Update available → shows version + "Update now" button + dismiss (x)
3. Downloading → shows progress percentage
4. Installing → shows "Installing..." message
5. Ready → auto-relaunch after 1.5 seconds
```

## Shared Components

### ConfirmModal

**File:** `apps/dashboard/src/components/ConfirmModal.tsx`

A portal-based modal used for all destructive action confirmations across the dashboard. Replaces the previous inline confirmation patterns.

**Features:**
- Rendered via React portal (attached to document body, z-index layering)
- Closes on Escape key press or backdrop click (click outside)
- Backdrop blur effect for visual focus
- Shows a loading spinner on the confirm button while the action is in progress (prevents double-clicks)
- Accepts custom title, message, confirm/cancel labels, and an async `onConfirm` handler
- Used by: delete knowledge entry, delete plan, delete plan task, bulk delete, uninstall wizard, cleanup orphan embeddings, plan archive

### System Knowledge Filtering

The frontend automatically filters out `type=system` entries from all views:
- Knowledge list (HomePage) excludes system entries
- Search results exclude system entries
- Stats page charts exclude system entries from type distribution
- System entries are not editable or deletable from the UI

## API Client

**File:** `apps/dashboard/src/api/`

HTTP client that communicates with the Fastify sidecar. Base URL is determined from `window.location` (same host, dynamic port set by Tauri).

All requests are standard `fetch()` calls with JSON content type, plus an `x-cognistore-token` header — every sidecar route requires it (see api-reference.md § Authentication). The token is read from `window.__COGNISTORE_TOKEN__`, seeded by the Tauri shell through an initialization script; under `pnpm dev` there is no shell, so `VITE_SIDECAR_TOKEN` stands in.
