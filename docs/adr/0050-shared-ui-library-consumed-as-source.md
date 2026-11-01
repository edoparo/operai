# 0050 — The suite's design system becomes a shared React library, `@operai/ui` in `operai-ui/`, that every frontend compiles from source; its stylesheet is the shell's `tokens.css`

**Date:** 2026-10-31
**Status:** Proposed (experiment on `feat/operai-ui-library`, refund-ui migrated; to be accepted or rejected after review)
**Deciders:** wellD
**Project:** Operai

---

## Context

The suite has six frontends (the shell and five federated remotes, ADR-0006), each installed and deployed on its own. The shell already shares one stylesheet, `shell/src/styles/tokens.css` (tokens, `.btn`, `.card`, form controls), exposed to remotes as `shell/tokens.css`. There was no shared React component: ADR-0006 forbids a remote importing another remote's source, so every reusable pattern was re-authored per app. The audit done before this ADR (`docs/ui-inconsistencies.md`) counts five confirm-dialog copies, four skeletons, three error banners, three permission-denied screens, three tab navs and seven badge components. The copies have drifted: only one dialog returns focus to its trigger, primary buttons fail contrast in three apps, four remotes nest a second `<main>`, `font-mono` silently falls back to the system font.

Two constraints shape how a library can be shared. The repo is a mixed pnpm (frontends) and Bun (backends) monorepo with no workspace on purpose (`lerna.json` lists packages for Changesets only, AGENTS.md § Git). Each frontend is a separate Vercel project whose build runs inside the app directory, though the full repository is checked out: the shell's Tailwind already `@source`-scans the sibling remotes' `src/`.

## Decision

1. **One package, `operai-ui/` (`@operai/ui`, private, versioned by Changesets).** It holds the design tokens and component classes (`src/styles/tokens.css`, moved from the shell with its history), the React components (`src/components/`), their tests, a Storybook (foundations, components, page compositions) and the rules (`docs/design-system.md`, `docs/building-pages.md`).
2. **Consumed as source, not built or installed.** An app aliases `@operai/ui` to `../operai-ui/src/index.ts` in `vite.config.ts` and `vitest.config.ts`, adds `resolve.dedupe: ['react', 'react-dom']`, and maps `@operai/ui` plus `react`/`react-dom` types in `tsconfig.app.json` `paths`. The app's own bundler compiles the library's `.tsx`, so the library's `react` resolves to the app's copy and stays under the Module Federation singleton. There is no build step, no publish and no version skew between an app and the library it was built with.
3. **The stylesheet keeps its federation contract.** `shell/src/styles/tokens.css` becomes a one-line `@import` of the library's file, so `shell/index.css` and the exposed `./tokens.css` work unchanged. The shell `@source`-scans `operai-ui/src` (and `notify-ui/src`, which was missing).
4. **Components render library classes only.** No Tailwind utility and no inline colour inside a library component, so it renders the same in the shell's sheet, in a remote's standalone build and in Storybook. All user-visible copy is a prop; the library has no strings and no i18n.
5. **The tokens gain readable tone-text colours** (`--acc-text`, `--grn-text`, `--org-text`, `--red-text`), and the `@theme` font keys are corrected to Tailwind v4's `--font-*` namespace.
6. **Adoption is app by app.** refund-ui is migrated here as the experiment: its components become thin adapters that bind copy and test ids to library components, so call sites, unit tests' behaviour and e2e `data-testid`s are unchanged. The other apps keep working untouched and migrate in their own changes.

## Failure shape

A pattern that every app needs but no app may share, so each one re-authors it from the last copy it saw: the copies are correct on the day they are made and diverge on every later fix, and nobody can tell which one is canonical. The cost is invisible per app (each copy passes its own tests) and only shows up across the suite as an inconsistent product and an accessibility fix that has to be made five times.

It recurs whenever an architecture boundary forbids imports between peers (federated remotes, separately deployed services) and something cross-cutting must still be shared. Recognise it by a doc comment that says "ported from …", "re-authored from …" or "mirrors … exactly"; by the same component name in several apps; or by a bug fixed in one app that is still present in another. The answer is a shared, independently-owned unit that the peers depend on, never a peer depending on a peer.

## Options considered

**A. Source-consumed library via alias (chosen).** No install step, live edits across library and app (HMR), one React, works on Vercel because the repository is checked out in full (the shell already relies on that). Cost: every consuming app carries the alias, the dedupe and the tsconfig paths (documented in `operai-ui/README.md`), and a library change affects every consumer on its next build.

**B. pnpm `file:`/`link:` dependency.** `link:` symlinks the package, but the library's own `react` import then resolves to `operai-ui/node_modules` (absent on Vercel, a second React locally). `file:` copies a snapshot that goes stale until the next `pnpm install`, which defeats editing the library while building a page. Rejected.

**C. A pnpm workspace.** Explicitly rejected by AGENTS.md: it makes pnpm treat every app as one workspace and breaks the per-app installs and deploys.

**D. Expose components through Module Federation from the shell** (like `./tokens.css`). Runtime sharing with no build coupling, but every remote's types become hand-written ambient declarations, unit tests must stub every component, Storybook cannot use the real federation runtime, and a shell deploy changes every remote's UI at runtime without the remote being rebuilt or tested. Rejected; it stays open for the stylesheet only, which already works this way.

**E. Publish to a private npm registry.** Versioned and conventional, but adds a registry, credentials in five Vercel projects and a publish step to every library change, for a library with one consumer team. Revisit if the library is used outside this repository.

## Consequences

- A library change is a change to every app that uses it. Changesets must select `@operai/ui` and each affected app; CI type-checks only the apps it builds, so a library change runs the consuming apps' `pnpm build` locally before merge (the trigger to add a CI job is the second migrated app).
- A Vercel project that rebuilds only on changes under its own root directory would miss a library change. None is configured that way today (`vercel.json` has no `ignoreCommand`); keep it so, or include `operai-ui/` in the check.
- `operai-ui/node_modules` exists only for Storybook and the library's tests. Apps never resolve through it; `react:skew` does not check it, because it never reaches a browser.
- The visual changes that came with the migration (contrast fixes, dialog button variants, DM Mono where `font-mono` was used) are listed in `operai-ui/docs/decisions.md`.
