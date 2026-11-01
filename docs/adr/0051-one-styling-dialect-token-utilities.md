# 0051 — One styling dialect for every frontend: design tokens reach elements as Tailwind utilities generated from `@theme inline`, never as inline `var(--…)` styles

**Date:** 2026-10-31
**Status:** Proposed (applied to all six frontends on `feat/operai-ui-library`)
**Deciders:** wellD
**Project:** Operai

---

## Context

The six frontends styled the same tokens two ways (`docs/ui-inconsistencies.md`, the audit's
summary). The shell and estimai-ui used Tailwind palette utilities (`text-soft`,
`bg-ink-soft`: about 550 uses). refund-ui, admin-ui, notify-ui and inventory-ui used inline
styles (`style={{ color: 'var(--soft)' }}`: about 850 token values in 680 `style` attributes).

The inline dialect rested on a premise that stopped being true on 2026-07-10. The remotes
were written when each one shipped its own Tailwind sheet, which had no `@theme`, so palette
utilities did not exist in their builds. The ADR-0006 addendum of that date made the shell
the single owner of the suite's Tailwind sheet: it `@source`-scans every remote's source with
the shared `@theme`, and verified that palette utilities resolve inside remotes. The four
remotes kept the old idiom and their doc comments kept the old reason.

The cost of two dialects is more than inconsistency. An inline style cannot express a variant
(`hover:`, `focus-visible:`, `disabled:`, responsive), so the inline apps had hover states
that never applied (an inline colour beats a `hover:` class) and fixed `colorScheme: 'dark'`
on date inputs that were wrong in the light theme. It beats every class, so a library
component class cannot be adjusted with a utility. And the tokens were defined twice: as
`--x` for inline use and as `--color-x` for Tailwind, with both copies repeated in three
theme blocks.

## Decision

1. **Tokens are CSS custom properties, defined once** in `operai-ui/src/styles/tokens.css`
   (`--ink`, `--soft`, `--acc`, …), redefined per theme. Nothing else defines a colour.
2. **Tailwind maps them with `@theme inline`** (`--color-soft: var(--soft)`, …). Utilities
   read the custom property itself, so a theme switch changes one variable and every utility
   follows; the second `--color-*` copy and its three theme repeats are gone.
   `--color-*: initial` removes Tailwind's default palette, so only tokens are colours.
   Opacity modifiers replace hand-written `color-mix()` (`bg-org/10`, `border-rule/50`).
3. **Three layers, each with one job.** Tokens (CSS custom properties) → component classes
   in `@operai/ui` (`.btn`, `.card`, `.badge-success`, …), which use the tokens directly →
   utilities in app code (layout, spacing and token colours). A component's own style lives
   in the library; a page composes with utilities.
4. **Inline `style` only for values computed at runtime** (a width, a position, a transform),
   never for a token or a colour. `colorScheme` follows the theme from `tokens.css`.
5. **Enforced by lint in every app and the library** (`operai-ui/eslint/design-tokens.ts`,
   spread into each `eslint.config.js`): no string containing `var(--`, no colour literal or
   `colorScheme` in a `style` attribute. A status → colour map therefore becomes a status →
   class-string map. Class names stay complete literals, because the shell's scan cannot see
   `text-${tone}`.
6. **Every remote's standalone stylesheet** (`src/index.css`, used only outside the shell)
   is Tailwind + the library's `tokens.css` + a scan of the library: no copy of the tokens.
   This supersedes the ADR-0006 addendum's "keep a copy in each remote in sync".

The existing code was converted by a one-off AST codemod (790 properties), then by hand for
what it could not convert safely (config maps, shared style constants, backdrops). The
rendered colours are the same tokens at the same opacities; mixes are now computed in oklab
instead of srgb, which is not visible at 6–50%.

## Failure shape

An architecture decision that removes the reason for a coding idiom, while the idiom stays,
written down as the rule in the code that still uses it ("palette utilities don't exist in
this build"). The two styles then coexist indefinitely, new code copies whichever file it
started from, and each style's own limitations (here: no variants inline, double token
definitions) are paid in full by half the codebase.

It recurs whenever a constraint is lifted centrally (a shared sheet, a polyfill, a runtime
upgrade) but the workaround it forced was written locally in many places. Recognise it by a
doc comment that justifies a pattern with a constraint the system no longer has, or by two
idioms for one job split along app boundaries. The answer is to convert in one pass and make
the old idiom fail lint, so it cannot come back by copy-paste.

## Options considered

**A. Tailwind token utilities in the shell's single sheet (chosen).** Already the suite's
stack (ADR-0006 addendum) and already used by two apps; variants, responsive and theming work;
no runtime cost. Cost: the shell's sheet is generated from the remotes' sources at the shell's
build, so a remote must not ship a class the shell has not scanned. Today every project builds
from the same commit of one repository, so they cannot diverge; the gap is only the minutes
between two Vercel deploys of the same push, and a new class appearing then renders unstyled
until the shell's deploy lands.

**B. Keep inline `var(--…)` styles everywhere.** No build coupling at all. Rejected: no
variants, highest specificity (fights every class), and the shell and estimai would have to
convert the other way (550 uses).

**C. CSS Modules or a zero-runtime CSS-in-JS (vanilla-extract, Panda).** Scoped, typed
styles. Rejected: a second styling toolchain beside Tailwind in every app, and scoping solves a
problem the suite does not have (one design system, one shell).

**D. Runtime CSS-in-JS (styled-components, Emotion).** Rejected: runtime cost, a styling
engine per remote sharing one page, and the ecosystem has moved away from it.

**E. A Tailwind sheet per remote with a class prefix** (`@import "tailwindcss" prefix(rf)`).
The fully federation-safe variant: each remote ships its own utilities, prefixed so no two
sheets define the same selector, and the shell no longer scans remotes. Rejected for now:
every class in five apps renamed (`rf:text-soft`), for a deploy-skew risk that same-commit
builds make negligible. **Trigger to revisit:** a remote that deploys from another repository
or on its own cadence.

## Consequences

- One way to style, enforced: new code cannot reintroduce inline tokens.
- Hover, focus and responsive variants now apply where inline colours used to override them.
  Two navigation components in admin-ui moved active/inactive colours to TanStack Router's
  `activeProps`/`inactiveProps` classes for that reason.
- Tests assert classes and ARIA, not inline colours (`style.color`); the apps' string-scan
  tests recognise a utility-class list as styling instead of allowlisting each class string.
- A token is added in one place (`:root` plus the light-theme blocks) and one line in
  `@theme inline`.
