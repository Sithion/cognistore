# Design learning log

This log is append-only: preserve existing entries unchanged and insert each new entry above the previous sessions, newest first. Record one entry per research session with date, question, sources and access dates, rules added/changed, findings, and follow-ups.

## 2026-11-05 — Why do CogniStore tooltips feel wrong, and what should they be?

### Sources

Access date for all sources: 2026-11-05.

- [W3C APG tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) — informative pattern, marked work in progress.
- [WCAG 2.2 SC 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) — dismissible, hoverable, persistent additional content.
- [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — text contrast.
- [NN/g Tooltip Guidelines](https://www.nngroup.com/articles/tooltip-guidelines/) — brief, supplemental microcontent.
- [NN/g Ten Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) — audit checklist.
- [Carbon tooltip usage](https://carbondesignsystem.com/components/tooltip/usage/) — tooltip versus interactive toggletip.
- [Radix Tooltip API](https://www.radix-ui.com/primitives/docs/components/tooltip) — provider and timing defaults.
- [Radix Colors scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) — semantic palette roles.
- [DTCG Design Tokens Format 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) — stable token-format reference.

### Rules added

Seeded the Tooltips, Labels and icons, Color and contrast, and Design tokens sections of `principles.md`.

Keep tooltip content supplemental and non-interactive; support hover and keyboard focus; preserve an accessible trigger name; provide dismissal, pointer access, and reading time. Use semantic token colors and verify contrast in both themes.

Project timing decision: `delayDuration` 300 ms and `skipDelayDuration` 300 ms. Radix defaults are 700/300 ms; the shorter initial delay suits the dense desktop app. This is a project preference, not a WCAG requirement.

### Findings

- The real app uses native `title=` tooltips rather than the styled Radix component shown in the design gallery.
- Recharts tooltips lack token-based styling and retain the default white box in dark mode.

### Follow-ups

1. Replace native `title` tooltips with Radix Tooltip, starting with the collapsed sidebar.
2. Theme Recharts tooltips with existing tokens.
3. Mount one `TooltipProvider` at the app root.

These are deferred implementation items; this research entry does not claim they are fixed.
