# Frontend Architecture

## Overview

The dashboard frontend is a React 19 SPA built with Vite, styled with Tailwind CSS 4, and uses Redux Toolkit for state management. It runs inside a Tauri v2 WebView, connecting to the Fastify sidecar via HTTP.

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
- Filter dropdowns: type (decision/pattern/fix/constraint/gotcha), scope, tags
- Knowledge cards grid with title, tag chips, type badges, and similarity scores
- Floating action button (FAB) → add knowledge modal
- Auto-refresh polling (detects new entries every 10 seconds)

### PlansPage (`/plans`)

Plan management with live task tracking.

**Components:**
- Active plans section at top showing plans with `active` status in a responsive grid layout
- Task list per plan with status icons: ○ pending, spinner in_progress, ✓ completed
- Priority left-border colors: red (high), yellow (medium), gray (low)
- Progress bars and mini progress counters (e.g., "3/5 tasks")
- Plan relations sections (input/output knowledge entries)
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

System health monitoring, maintenance, and uninstall. (Renamed from InfrastructurePage/Monitoring in v0.8.1.)

**Components:**
- Service status cards: Database (connected/path), Ollama (connected/host)
- Overall health indicator (green/red)
- Health polling every 5 seconds
- Maintenance section: cleanup orphan embeddings button (moved from StatsPage)
- Danger Zone: uninstall button with 3-step confirmation dialog

### SetupPage (conditional, first launch)

7-step sequential installation wizard.

**Components:**
- Step list with status icons (pending/running/done/error)
- Progress tracking per step
- Retry button on failure
- "Open Dashboard" button on completion

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
- No full-page spinners or blocking overlays
- Small inline spinner next to section titles during background refresh
- Data displays immediately from cache; refreshes happen silently
- `isRefreshing` flag drives the inline spinner visibility

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

**File:** `apps/dashboard/src/App.tsx`

```
App Mount:
  → GET /api/setup/status
  → If all ready → show Dashboard layout with routes
  → If not ready → show SetupPage

Dashboard Routes:
  /          → HomePage
  /plans     → PlansPage
  /stats     → StatsPage
  /settings  → SettingsPage
```

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
- Closes on Escape key press or background blur (click outside)
- Shows a loading spinner while the action is in progress
- Accepts custom title, message, confirm/cancel labels, and an async `onConfirm` handler
- Used by: delete knowledge entry, delete plan, uninstall wizard, cleanup orphan embeddings

### System Knowledge Filtering

The frontend automatically filters out `type=system` entries from all views:
- Knowledge list (HomePage) excludes system entries
- Search results exclude system entries
- Stats page charts exclude system entries from type distribution
- System entries are not editable or deletable from the UI

## API Client

**File:** `apps/dashboard/src/api/`

HTTP client that communicates with the Fastify sidecar. Base URL is determined from `window.location` (same host, dynamic port set by Tauri).

All requests are standard `fetch()` calls with JSON content type. No authentication required (localhost only).
