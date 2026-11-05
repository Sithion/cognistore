# Current design system

Verified inventory as of 2026-11-05. Paths are repository-relative. Counts are a dated baseline, not a target or a live assertion.

## Stack and components

| Area | Existing system |
|---|---|
| Dashboard | React + Vite; Tauri shell and widgets; Fastify sidecar. |
| Styling | Tailwind CSS v4; `@theme` in `apps/dashboard/src/design/theme.css`; no `tailwind.config` file. |
| Components | shadcn/ui in `apps/dashboard/src/components/ui`, backed by Radix primitives. |
| Component inventory | badge, button, card, checkbox, command, dialog, dropdown-menu, input, label, popover, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, tabs, tooltip. |
| Icons and charts | `lucide-react` and Recharts. |
| Fonts | Inter Variable + JetBrains Mono, loaded through local `@fontsource` imports. |

## Tokens

- Semantic `--design-*` light tokens live in `apps/dashboard/src/design/theme.css`; dark overrides live under `html.dark`.
- Roles include background, foreground, muted, muted-foreground, card, popover, primary, secondary, accent, destructive, border, input, ring, sidebar-*, chart-1..5, success, and warning.
- Tokens map to Tailwind `--color-*` values; use semantic classes such as `bg-background`.
- `apps/dashboard/src/styles.css` retains compatibility aliases such as `--bg-main`, `--bg-card`, `--accent`, `--text-primary`, and `--text-secondary`. Do not add new aliases.
- No project spacing/radius/type scale tokens exist; values are hardcoded, including border-radius 12px and padding 24px.

## Theme

- `apps/dashboard/src/design/theme.ts` persists light/dark/system in localStorage under `cognistore.theme`, with a dark fallback.
- `apps/dashboard/public/theme-init.js` applies the theme before React.
- CSP forbids inline scripts; keep theme initialization external.

## Styling split

| Pattern | Baseline | Concentration |
|---|---|---|
| Inline `style={{}}` objects | About 394 | SettingsPage.tsx, PlansPage.tsx, UpgradePage.tsx, widgets. |
| `className` uses | About 316 | HomePage.tsx, DesignWorkspace.tsx, CurationPanels.tsx. |

Migrate styling when redesigning the affected file; do not turn a focused design change into a repository-wide migration.

## Design gallery

The hidden route `/_design` renders `DesignWorkspace.tsx` through the lazy-loaded `DesignPage.tsx`. It shows components, overlays, loading states, and keyboard examples. Use it to prototype component behavior.

## Tooltips today

| Surface | Existing behavior |
|---|---|
| Radix primitive | `apps/dashboard/src/components/ui/tooltip.tsx` styles TooltipContent with `rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md` and `sideOffset` 4. |
| Gallery | The styled Radix tooltip is used ONLY in `/_design`; its local `TooltipProvider` has `delayDuration` 300. |
| Real app | Native `title=` attributes appear on collapsed sidebar links in `apps/dashboard/src/components/Layout.tsx`, plus Plans, Stats, Settings, Tokens pages and widgets. OS/WebKitGTK renders these unstyled, theme-unaware tooltips without keyboard-focus access. |
| Charts | Every Recharts `<Tooltip>` (StatsPage.tsx, TokenConsumptionPage.tsx) spreads `chartTooltipProps(kind, format)` from `insights/ChartTooltip.tsx`: a compact popover-token card, themed in dark mode, with a subtle cursor (since 2.6.1). |
| Tray | `apps/dashboard/src-tauri/src/tray.rs` uses the static tray tooltip string "CogniStore". |

## Icons

`lucide-react` appears in 11 files. About 29 emoji are used as icons; sidebar navigation icons in `Layout.tsx` are emoji.

## Tests and documentation

| Resource | Location and constraint |
|---|---|
| UI tests | `packages/tests/src/ui`: Vitest, jsdom, `createElement`, no tsx. |
| E2E tests | `packages/tests/src/e2e`: Playwright serves the BUILT dist; rebuild first. |
| Accessibility and visuals | `packages/tests/src/e2e/quality-ui-r8.test.ts`: axe-core check and `toHaveScreenshot`; screenshot assertions run only with `COGNISTORE_VISUAL=1`. |
| Frontend guide | `documentation/frontend.md`: routes, theme, layout. |
| Design-system report | `documentation/plans/reports/2026-11-03-rodada-7.md`, section "U.0.2 + U.1 — shadcn/ui e sistema de design". |

## Known debt

Keep this list ordered; add newly discovered violations with evidence.

1. Native `title` tooltips across the app; replace with Radix tooltips, starting with the collapsed sidebar, and mount one app-root provider.
2. Unthemed Recharts tooltips.
3. Emoji navigation icons.
4. Inline styles in Settings/Plans/Upgrade/widgets.
5. Two token layers: `--design-*` and legacy aliases.
6. No spacing/radius/type scale tokens.
7. Settings/Stats visual redesign pending maintainer screenshots.
