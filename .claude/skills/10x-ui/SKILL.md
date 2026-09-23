---
name: 10x-ui
description: >
  Audit and improve a view that already exists. Starts from UI you can open
  and screenshot, and runs the change as a normal 10x change with a
  design-system contract: turn the view into a list of concrete charges
  (missing tokens, missing shared component, accidental architecture), fix
  the contract before the pixels, cover named states, and gate the result
  with a screenshot. Use when the user wants a theme, a restyle, "make it
  prettier", shadcn/Tailwind work, design tokens, dark mode, a visible-focus
  pass, or cleanup of UI an agent built feature by feature. Not a generator
  for a view that does not exist yet — build it through the ordinary chain
  first. Not a component catalog. Not parallel multi-agent Innovate work.
  Not a Playwright course.
---

# 10x-ui — design-system contract for a single visual change

UI is a normal 10x change. Do not open a vibes chat on the CRUD thread, and do not start
from a prompt that says only "make it nicer".

**This skill iterates on UI that is already there.** It assumes a view you can open and
screenshot: the markup renders, the data flows, the screen does its job and just is not good
enough. Producing that first view is ordinary feature work for the Core Skills Chain; this
skill picks up the moment it is on screen and you want it audited and improved.

If `context/foundation/lessons.md` exists, read it once for recurring UI failures in this repo.

## When to skip

- Parallel agents, `/goal`, isolated checkouts for throughput — that is a later lesson (Innovate / m2l6).
- Initializing a second design system (`shadcn init` and its equivalents) on a repo that already ships tokens and in-repo components. Extend the first one.
- A view that does not exist yet. Build it through the ordinary chain first, then come back and audit it.
- A design-tool file as the only source of truth: this skill works from the running app.

## Router

1. `/10x-new <change-id>` — a folder for this visual change. In `change.md` name **one** view and one named motif or token source.
2. `/10x-research <change-id>` — two directions. **Audit**: locate in *this* repo the **source of values** (token file, theme object, variables — whatever this stack calls it) and the **shared components directory**, then find which views actually read them. If neither exists, that is the first phase of the plan, not a blocker. **Reference**: a named motif or DS vocabulary to borrow from. Not a moodboard. Output is the charge list below.
3. `/10x-plan` — phases: environment/library → values in that source → **one** view → states.
4. `/10x-implement` phase by phase. After a visual phase: screenshot (desktop; one mobile width).
5. Visual gate: kitchen sink or `toHaveScreenshot` on **that one view**. Do not blind-update baselines.
6. `/10x-impl-review` — UI findings are not "cosmetic skip" by default. Then the review loop below.

## The audit: three categories of charge

This is the technique the rest of the skill depends on. Before any CSS, walk the view and write
3–5 charges. Each charge gets a **file and line**, and **one sentence about the effect on the user**.
A charge list is the input to the plan; "make it nicer" is not.

| Category | What it looks like | Evidence to record | Typical fix |
| --- | --- | --- | --- |
| **Missing tokens** | one-off hex/rgb in the view, three shades of the same "primary", spacing invented per file | file:line of the literal, plus the token that should have covered it | move the value into this repo's token source and reference it by role (e.g. `bg-primary` / `text-muted-foreground` in the Tailwind variant) |
| **Missing shared component** | a second `Button` built from `div`+classes, a card that copies a DS card, copy-pasted form field | file:line of the duplicate, plus the component it shadows | import the real component, or add it through the stack's own path (e.g. `npx shadcn add <name>`) |
| **Accidental architecture** | the screen or flow mirrors the order features were added: unauthenticated route returning raw JSON, a modal that is a page, a "settings" tab holding four unrelated things | the route/component path, plus what the user sees when they arrive that way | fix the entry point (guard, redirect, layout), not the color |

The third category is the hardest to see on a screenshot and the easiest to skip. Ask explicitly:
*what happens if someone reaches this view logged out, with no data, or straight from a link?*

Record the list in the change folder. Charges that the plan does not address stay visible as
deferred, not deleted.

## Design-system contract

The contract has two halves, and neither names a tool:

1. **Semantic tokens** — one source of values, with names describing the **role** (`primary`, `surface`, `muted`, `destructive`), never the colour (`purple-600`).
2. **Importable components that live in the repo** — readable by the agent, not a black-box dependency it can only guess at.

Without both, the agent reinvents primitives on every view. With both, it has somewhere to look.

How the two halves are realised depends on the stack. Find yours, then read it before proposing values:

| Stack | Where the values live | Where the components live |
| --- | --- | --- |
| **Tailwind v4 + shadcn/ui** (the course variant) | `:root` / `.dark` in CSS, published through `@theme` / `@theme inline` | copied into the repo, usually `src/components/ui` |
| **CSS Modules / plain CSS variables** | a variables file (`:root`, often `theme.css` / `variables.css`) | a shared components directory, imported by path |
| **CSS-in-JS with a theme** (styled-components, vanilla-extract, Panda) | a theme object or `.css.ts` token file | styled primitives exported from one module |
| **Component library with a theme** (MUI, Chakra, Mantine) | the library's theme/config object, extended in your code | the library's components, wrapped locally where you customise them |
| **Nothing yet** | — | — |

Tailwind detail, for that variant only: `:root` / `.dark` hold the **values**, `@theme inline`
**publishes** them as `--color-*`, and only then does `bg-primary` exist. Raw colours written straight
into `@theme inline` are the classic dark-mode break — the `.dark` values are there, the toggle does
nothing. Other stacks have their own version of this split; find it before you edit.

- **Repo already has a system** — read it first: its value source, its shared components and any design notes, before you propose anything. Extend it; do not fork a second palette. An existing, worse system beats a better one you bring in.
- **Repo has a value source nothing reads** — the most common greenfield case. A starter ships a token file, and the screens ignore it in favour of literal classes. The first phase is not choosing a theme; it is making the existing views read the tokens that are already there.
- **Repo has no system at all** — see *Proposing a system* below.
- **Tokens from a named motif or preset** — map them onto the existing variable names, keep the count small (primary, surface, border, muted, destructive, plus radius and spacing scale).

Whatever the source of the values, **deposit them in the repo**: the raw values in a file inside the
change folder, plus a line naming where they came from, next to the block you edited. Values that
live only in a chat window are values the next session will invent again from scratch.

Optional: a short design note (`DESIGN.md` or equivalent) recording tokens and why they were chosen.
The obligation is tokens in the repo; the file is a convenience for the next change.

Adding a component: use the stack's own path — e.g. `npx shadcn add <name>` (or shadcn MCP if
already configured) in the course variant. Do not require `mcp init` to finish the change.

### Proposing a system

"Use what you have" does not mean "never add anything". On an empty field, introducing the contract
**is** the change. Propose it — under three conditions, stated out loud in `change.md`:

1. **Marked as adding a dependency to the stack**, not slipped in as an assumption. The learner decides.
2. **Scoped to what this change needs** — a token block plus the 2–3 components the view actually uses. Not a whole library.
3. **It loses to what the repo already has.** If there is any system, even a worse one, extend it.

## States, breakpoints, a11y floor

- Name the states you touch: **default, hover, focus, disabled, error, empty, loading**. `disabled` and `error` are where agent-built UI drifts first, because nothing in the happy path exercises them.
- Focus usually has its own token, separate from the accent (`--ring` in shadcn) — moving the accent does not move it, and on many stacks nobody has defined it at all, so the browser default shows through. Review focus separately, the way you review `disabled`.
- Desktop plus **one** mobile width. Not a responsive matrix.
- a11y floor, not a WCAG course: focus must be visible, every control needs an accessible name, and contrast on token changes must survive both themes if the app has dark mode.
- Dark mode: change it at the token layer. A dark-mode pass that edits component classes is the missing-tokens charge in disguise.

## Visual gate

One view, every named state visible at once. The cheapest form needs no test runner at all: a
**kitchen-sink page** that renders the view in all seven states side by side, screenshotted from the
browser. It doubles as review evidence and it works on any stack.

If the repo already has a screenshot-testing tool, wire the gate into it — e.g.
`await expect(page).toHaveScreenshot({ maxDiffPixels: 100 })` with Playwright, masking volatile
regions (dates, avatars, counters). Do not install one to satisfy this skill.

This is a merge gate for **this change**, not an E2E course. Never update a baseline to make CI green
without explaining the visual delta first.

## Review loop: from charge to PR

A view can be technically correct and still unreadable — heading competing with the primary button,
every piece of information at the same weight, each small thing in its own card. Judge the layout
**after** the view is built from tokens and repo components; on a screen glued together from one-off
classes, layout criticism collapses into a list of cosmetic tweaks.

1. Get the critique: `/10x-impl-review`, plus an optional layout pass (Impeccable, `frontend-design`) if the learner has it installed. Do not vendor those tools into the repo.
2. Triage each finding by **effect on the user**, the same way code-review findings are triaged: a missing focus ring or a dead tab deserves as concrete a decision as a logic bug.
3. Fix, or record the finding as deferred with a reason. Silence is not triage.
4. Re-run the visual gate. A finding that changed the view without changing the baseline is a warning sign.

Merge checklist: [`ui-quality-checklist`](references/ui-quality-checklist.md). Green CI alone is not the gate — a screenshot test
passes happily on a view whose `disabled` state was never rendered.

## Hard rules

- No prompt that is only "make it nicer / prettier".
- Colors, type, radius, spacing: a token from **this repo's** system (e.g. `bg-primary` in the Tailwind variant), not one-off hex in the view.
- Reuse an existing component or add one through the stack's own path; do not invent a second `Button`.
- One view plus global tokens per change. Not a whole-MVP rebrand.
- Every charge carries file, line and user impact before it enters the plan.
- Model: whatever you actually have — see *Model routing* below. The loop is what carries the change, not the model name.

## Model routing (phase first, availability second)

No model is required to run this skill. The work needs two capabilities: **vision** (read a
screenshot) and **tool use** (edit files, run the app). Beyond that, route by **phase**, not by
vendor. Judgement is expensive and happens a few times; execution is cheap and happens many times.

| Phase | What it needs | Tier |
| --- | --- | --- |
| Audit + plan — charge list, token contract | vision, long context, judgement | the strongest model you have; a wrong call here costs a dozen edits in the wrong direction |
| Implement charges — render → compare → fix one charge | tool use, speed, price | a cheaper working tier; you run this loop many times against a finished list |
| Review — layout, states, a11y | judgement, vision, a fresh read | strongest again, ideally not the one that wrote the code |

Escalate from the working tier only when the **same charge survives two rounds**. That is the
signal that the problem is judgement, not typing.

Names date faster than this skill. As of September 2026 the top tier is Fable 5.1 or Opus 5
(Anthropic), GPT-6 Astra (OpenAI), Gemini 3.1 Pro (Google); the working tier is Sonnet 5, an
IDE-native model (Composer in Cursor), or open-weight coders (Kimi, GLM, Qwen Coder). Substitute
whatever your plan actually gives you — the phase split is the part that transfers.

Notes that keep this honest:

- **No model here is a requirement, including Fable 5.1.** Access varies by plan and region. One
  model for all three phases is fine: the split still holds, only the bill changes.
- A cheap model in a tight loop beats an expensive model given one vague prompt. Charges, tokens
  and a kitchen sink do more for the result than model choice.
- **No vision model at all?** The change still works: render the kitchen sink, list the states in
  text, and describe the delta yourself. The screenshot gate stays in CI.
- Do not quote arena rankings as if they settled UI quality — they measure a pretty view written
  from scratch, not the cleanup of someone else's module.

## Failures to refuse

| Smell | Do this instead |
| --- | --- |
| Default purple/blue gradient "AI landing" | Change `--primary` / theme tokens first |
| New primitive `div`+CSS that copies a DS component | Import the real component |
| "Selected" tab that is only CSS, not clickable | Wire the state |
| Unauthenticated or empty-state entry that dumps raw JSON / a blank frame | Fix the entry point; it is an architecture charge, not a style one |
| Updating a Playwright baseline to make CI green | Explain the visual delta; update only if the change is intended |
| Restyling the whole MVP in one change | One view + global tokens |
| "Fix the design" as one agent task on the CRUD thread | New change folder, audit, plan, gate |

## Playbooks

Short paths through the router for the usual entry points. All of them keep the charge list.

- **Theme or restyle of one view** — the default path above, start at tokens.
- **Inherited agent slop** (module built feature by feature, each one accepted because it worked) — audit first and expect all three categories; fix tokens and the shared component before touching layout.
- **Single component** — skip the token phase only if the component's values already come from tokens; otherwise the token phase is the change.
- **Dark mode** — token layer, both themes in the kitchen sink, contrast check in the gate.
- **Focus/keyboard pass** — states phase carries it: visible focus, control names, tab order on the one view.
- **Fresh starter whose screens ignore its own tokens** — do not start by picking a theme. Phase 1 is making the existing views read the value source that already ships in the repo; only then are new values worth choosing.
- **Repo with no design system at all** — phase 1 is the contract (tokens + the components you need) under the three conditions in *Proposing a system*, phase 2 is the view. Resist shipping a library nobody asked for.

## Optional extras (not vendored by this skill)

Impeccable / `frontend-design`: the learner may install them; this skill does not add them to the repo.
