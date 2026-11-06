---
name: cognistore-design
description: Design and UX workflow for the CogniStore dashboard and Tauri widgets, covering screen audits, web design research through the learning routine, redesign proposals and implementation with existing tokens and shadcn/Radix components, and accessibility and visual verification; use before changing any UI, when the user dislikes how something looks or behaves, or before a redesign.
---

# CogniStore design and UX

## Purpose and read first

Turn a concrete usability complaint into an evidenced, user-selected design improvement.

Before starting:
- Read [references/current-system.md](references/current-system.md) for the existing system and known debt.
- Read [references/principles.md](references/principles.md) for design rules and their confidence.
- Call CogniStore `getKnowledge` with query `cognistore design <area>`, replacing `<area>` with the screen or component.

## Workflow

1. **Scope.** Name the screen/component and the user's complaint in one sentence; state the task the user should complete.
2. **Audit.** Run `scripts/local-test.sh web --copy-db` in the sandbox only; never use the production database. In that sandbox, send `POST /api/setup/configure` once (it writes only the sandbox HOME), or the setup wizard covers every route; load `/` and navigate client-side, because a hard load of a non-root SPA route returns 403. Use the hidden `/_design` gallery for component audits and prototypes. Capture Playwright screenshots in light AND dark at 1280x800 and 390x844. Run the axe check using `packages/tests/src/e2e/quality-ui-r8.test.ts` as the pattern; e2e tests serve built dist, so rebuild before testing changed UI. Score every NN/g heuristic in `principles.md` as pass, concern, fail, or not applicable with a reason; assess the relevant component rules too. Write each finding as `problem -> evidence (screenshot/file:line) -> principle violated`.
3. **Learn when needed.** If `principles.md` does not cover the problem, run [references/learning-routine.md](references/learning-routine.md) before proposing anything.
4. **Propose.** Present 2-3 options, each with an ASCII or HTML mockup and trade-offs, then recommend one. The USER chooses the visual direction; never ship one silently. For a new visual direction also load `frontend-design:frontend-design` before drafting the options.
5. **Implement.** Apply the chosen option under the implementation rules below. Keep unrelated cleanup outside the change.
6. **Verify.** Require no serious/critical axe violations; review light/dark screenshots at both sizes; run `pnpm --filter @cognistore/tests test:ui` and require green; check i18n keys in en/es/pt; test the keyboard path with Tab, Escape, and Enter. Record actual results and any blocked checks.

## Implementation rules

| Do | Don't |
|---|---|
| Use `--design-*` tokens through Tailwind semantic classes such as `bg-background` and `text-muted-foreground`. | Add hex literals or new legacy aliases; aliases in `styles.css` exist for compatibility only. |
| Build new UI with Tailwind classes and `apps/dashboard/src/components/ui/*`. Migrate an existing file's styling when redesigning that file. | Add new inline `style={{}}` objects or mass-migrate unrelated files; about 394 inline objects already exist. |
| Use `components/ui/tooltip.tsx` (Radix) with ONE `TooltipProvider` at the app root. Follow the tooltip values in `principles.md`. | Use native `title=` for anything a user must read, repeat a visible label in a tooltip, or place interactive content in a tooltip; use Popover/toggletip for interaction. |
| Keep tooltip text short. Give every icon-only button an `aria-label` AND a tooltip. | Make the tooltip the only accessible name or the only place to find required task information. |
| Use `lucide-react` icons in new UI. | Use emoji as new UI icons. |
| Give every Recharts `<Tooltip>` the shared `{...chartTooltipProps(kind, format)}` from `insights/ChartTooltip.tsx`; verify dark mode. | Leave Recharts' default white tooltip box in dark mode. |
| Meet 4.5:1 contrast for normal text and 3:1 for large text and meaningful UI parts. | Rely on color alone to convey meaning. |
| Make every hover/focus popup dismissible with Escape, hoverable, and persistent under WCAG 1.4.13. | Hide content while the pointer crosses into it or force users to move focus to dismiss it. |
| Add every user-facing string to en/es/pt and review both themes at 390px width. | Ship untranslated strings, theme-specific breakage, or horizontal overflow at 390px. |
| Respect `prefers-reduced-motion` for animations. | Make motion necessary to understand or operate the interface. |

## Design review output

Use this Markdown structure; include evidence rather than unsupported scores.

```markdown
## Scope
Screen/component, complaint, and user task.

## Screenshots
Light/dark at 1280x800 and 390x844; link each capture.

## Findings
| Problem | Evidence | Principle | Severity |
|---|---|---|---|
| Concrete failure | Screenshot or file:line | Named rule/heuristic | High / Medium / Low |

## Options
2-3 options, each with an ASCII or HTML mockup and trade-offs.

## Recommendation
Preferred option, reason, and the user's recorded choice before implementation.

## Verification
Actual axe results, screenshot review, UI test result, i18n check, and keyboard path; mark unrun checks explicitly.
```

## Knowledge

Store each durable design decision or research result with CogniStore `addKnowledge`:
- General UX rule: `type: pattern`, `scope: global`.
- Project choice: `type: decision`, `scope: workspace:cognistore`.
- Include supporting URLs in `source`; separate evidence from project preferences.

Append the session record to [references/learning-log.md](references/learning-log.md), preserving existing entries and placing the newest entry first.
