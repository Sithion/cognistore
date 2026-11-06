# Design principles

Confidence labels: **normative** = a WCAG requirement; **research-backed** = NN/g guidance; **convention** = informative patterns/design systems/vendor heuristics; **project decision** = a CogniStore choice. W3C APG is informative, not a normative WCAG requirement.

## Tooltips

| Rule | Confidence |
|---|---|
| Show supplemental text on hover AND keyboard focus after a short delay; close on Escape and pointer/focus leave after leaving both trigger and popup; never move focus into the tooltip. APG's tooltip pattern is marked work in progress. | Convention — W3C APG |
| Make hover/focus content dismissible, hoverable, and persistent: allow the pointer to enter the popup; keep it visible until dismissal, hover/focus leaves, or its information becomes invalid. Use Escape for dismissal. | Normative — WCAG 2.2 SC 1.4.13, AA; Escape is the project mechanism |
| Write brief microcontent; never repeat a visible label or hide information needed to finish a task in a tooltip. | Research-backed — NN/g Tooltip Guidelines, 2019 |
| Use a tooltip for non-interactive text; use a toggletip/popover for interactive content. | Convention — Carbon |
| A tooltip is not the trigger's only accessible name; keep an `aria-label` on icon-only controls and expose the tooltip as a description. | Convention — APG/Carbon |
| Use one app-root `TooltipProvider` with `delayDuration={300}` and `skipDelayDuration={300}`. Radix defaults are 700/300 ms; 700 ms feels sluggish in this dense desktop app. | Project decision |
| Use side offset 4-6 px, max width about 240-280 px, `text-xs`, and token colors (`bg-foreground text-background` or popover tokens). No arrow is required. | Project decision |

[W3C APG tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
[WCAG 2.2 Understanding 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
[NN/g Tooltip Guidelines](https://www.nngroup.com/articles/tooltip-guidelines/)
[Carbon tooltip usage](https://carbondesignsystem.com/components/tooltip/usage/)
[Radix Tooltip API](https://www.radix-ui.com/primitives/docs/components/tooltip)

## Labels and icons

- **Research-backed:** give icons a visible text label unless their meaning is universally understood in the current context; familiarity to the developer is not evidence.
- **Project decision:** icon-only controls, including the collapsed sidebar, require both `aria-label` and a tooltip; the accessible name must exist without opening the tooltip.

[NN/g Icon Usability](https://www.nngroup.com/articles/icon-usability/)

## Color and contrast

- **Normative:** meet WCAG 1.4.3 AA contrast: 4.5:1 for normal text; 3:1 for large text (at least 18 pt regular or 14 pt bold).
- **Normative:** meet WCAG 1.4.11 contrast of 3:1 for visual information needed to identify UI components, states, and meaningful graphical objects.
- **Project decision:** never use color as the only carrier of meaning; pair it with text, shape, or an icon and inspect the result in grayscale.
- **Convention:** use Radix Colors' 12-step semantics as a model for new color tokens: 1-2 app/subtle backgrounds; 3-5 component backgrounds and states; 6-8 borders; 9-10 solid backgrounds/hover; 11-12 text. Verify actual contrast; the step number alone does not prove compliance.

[WCAG 2.2 Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
[WCAG 2.2 Understanding 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
[Radix Colors scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)

## Visual hierarchy

- **Research-backed:** use scale to signal importance, hierarchy to order attention, balance to distribute visual weight, contrast to distinguish roles, and Gestalt proximity/similarity to group related content.
- **Project decision:** establish one primary action per view; keep secondary and destructive actions visually distinct.
- **Project decision:** use a consistent spacing scale with a 4 px base; prefer existing Tailwind spacing utilities while spacing tokens remain absent.

[NN/g 5 Principles of Visual Design](https://www.nngroup.com/articles/principles-visual-design/)

## Minimalism and disclosure

- **Research-backed:** apply heuristic #8: remove irrelevant information that competes with the task.
- **Research-backed:** progressively disclose advanced options while keeping the core task understandable.
- **Project decision:** keep active filters visible and reversible; show how to clear them.
- **Convention — vendor dashboard heuristic:** make the most important number readable within about 5 seconds. Use this as a review prompt, not a measured research result or accessibility requirement.

[NN/g Usability Heuristics, including #8](https://www.nngroup.com/articles/ten-usability-heuristics/)
[NN/g Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

## Empty, loading and error states

- **Research-backed:** empty states communicate current status, teach what belongs here, and provide a direct path to the key task.
- **Project decision:** use skeletons that approximate the eventual layout while loading; avoid implying that loading has completed.
- **Research-backed:** errors say what happened and what the user can do next; use plain language and a constructive recovery path (heuristic #9).

[NN/g Empty-State Interface Design](https://www.nngroup.com/articles/empty-state-interface-design/)
[NN/g Usability Heuristics, including #9](https://www.nngroup.com/articles/ten-usability-heuristics/)

## Usability heuristics

Use all ten as the screen-audit checklist; confidence for each is **research-backed**.

1. **Visibility of system status:** show timely progress, selection, save, and completion feedback.
2. **Match between system and the real world:** use the user's vocabulary and a natural information order.
3. **User control and freedom:** provide escape, cancellation, and reversal where appropriate.
4. **Consistency and standards:** reuse meanings, components, and platform conventions.
5. **Error prevention:** prevent invalid or destructive actions before they occur.
6. **Recognition rather than recall:** expose needed choices and context instead of requiring memory.
7. **Flexibility and efficiency of use:** support efficient repeat work without obscuring the beginner path.
8. **Aesthetic and minimalist design:** keep task-relevant information prominent and remove competing noise.
9. **Help users recognize, diagnose, and recover from errors:** explain the problem and a practical recovery.
10. **Help and documentation:** provide concise, searchable, task-focused guidance where needed.

[NN/g Ten Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)

## Design tokens

- **Convention — stable specification:** DTCG Design Tokens Format 2025.10 is the first stable specification, published as a W3C Community Group report; it describes JSON tokens with `$`-prefixed properties. It is not a W3C Recommendation.
- **Project decision:** CogniStore tokens remain CSS custom properties; follow category-role-state naming ideas when adding tokens, without claiming the existing CSS is a DTCG JSON implementation.
- **Project decision:** reuse semantic `--design-*` tokens; do not add legacy aliases or introduce a token pipeline without a user decision.

[DTCG Design Tokens Format 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/)
