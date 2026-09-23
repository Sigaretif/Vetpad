# UI change checklist (10xDevs 4 · m2l5)

Use after `/10x-implement` on a visual change, before merge.

## Charges

- [ ] The change started from a written list of 3–5 charges, each with file, line and user impact
- [ ] Missing tokens: one-off hex/spacing in the view replaced by values from the repo's token source
- [ ] Missing shared component: no second `Button`/card/field shadowing the design system
- [ ] Accidental architecture: entry points checked logged out, with no data, and straight from a link
- [ ] Charges the plan did not address are recorded as deferred, not dropped silently

## Contract

- [ ] Tokens: colors/spacing/type from this repo's own token source (course app: `@theme` in `src/styles/global.css`), not one-off hex in the view
- [ ] The component layer this repo already has (course app: shadcn, including `shadcn add`), not a new Button primitive
- [ ] States covered where the view is interactive: default, hover, focus, disabled, error, empty, loading
- [ ] Desktop plus one mobile width
- [ ] Focus visible / control name (minimum a11y, not a WCAG course)
- [ ] Dark mode, if the app has it, changed at the token layer and checked in both themes

## Gate

- [ ] Kitchen sink or `toHaveScreenshot` on this view; baseline updated only if the delta is intended
- [ ] `/10x-impl-review` run; UI findings triaged by user impact (not mass-skipped as cosmetic)
- [ ] Scope held: one view plus global tokens, not a whole-MVP rebrand
