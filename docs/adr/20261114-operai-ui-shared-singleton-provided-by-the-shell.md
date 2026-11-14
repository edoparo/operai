# 20261114 — The design system is compiled once, by the shell, and shared with every remote as a Module Federation singleton

**Date:** 2026-11-14  
**Status:** Accepted  
**Amends:** ADR 20261031-shared-ui-library-consumed-as-source (point 2, "consumed as source" by every app; rejected option D)  
**Deciders:** Matteo Codogno (owner). He asked that a remote declare it needs `@operai/ui` without including it in its bundle, delegating it to the host through `import: false` in Module Federation's `shared`, built directly on `main`.  
**Project:** Operai

---

## Context

ADR 20261031-shared-ui-library-consumed-as-source made `@operai/ui` a library compiled from source by every frontend through a Vite alias. Each of the nine apps therefore bundled its own copy of the library: the same components downloaded once by the shell and again by every remote a person opens. Copies also mean module-level state (a focus helper, a locale cache) existed once per app rather than once per page.

`@module-federation/vite` (1.23.9) supports consume-only shares: `import: false` makes a remote take a shared module from the share scope and never bundle a fallback. Two facts about the plugin decide the wiring:

- A Vite alias for a shared name bypasses sharing. The plugin warns, "the shared module will bypass Module Federation's sharing mechanism", and bundles the library anyway.
- With `import: false` the plugin reads the package's named exports at build time from the installed package. Without an installed `@operai/ui`, it generates a module with no named exports, and `import { Button } from '@operai/ui'` breaks.

## Decision

1. **The shell is the one provider.** `shell/vite.config.ts` shares `@operai/ui` as `{ singleton: true, requiredVersion: false }` and compiles it from source (one chunk, version 0.2.0 from `operai-ui/package.json`).
2. **Every remote consumes it with `import: false`.** estimai-ui, refund-ui, admin-ui, notify-ui, inventory-ui, crm-ui, meetings-ui and projects-ui declare `'@operai/ui': { singleton: true, import: false, requiredVersion: false }`. They have no fallback: outside the shell nothing provides the library.
3. **Resolved through `link:`, not an alias.** Each app has the devDependency `"@operai/ui": "link:../operai-ui"`, a symlink, so the plugin can read the named exports and the shell can resolve the package. The Vite alias of the main entry is removed. `resolve.dedupe: ['react', 'react-dom']` stays, so the library's own `react` imports still resolve to the app's copy (operai-ui/node_modules does not exist on Vercel). `mise run react:skew` stays green and the shell's build contains React only in its shared modules.
4. **`requiredVersion: false`.** The library is private and every app builds from the same repository; a version range would check nothing useful. Compatibility is a deploy rule instead (point 6).
5. **The rich-text entry stays compiled into its remotes.** `@operai/ui/rich-text` needs TipTap, which the shell does not install, so crm-ui, meetings-ui and projects-ui keep the exact-match alias for that entry only. It imports `AttachmentList` and `Icon` by relative path, so those two stateless components are bundled again in those three remotes. Moving TipTap into the shell would share it too; that is not done here.
6. **Deploy rule.** At runtime a remote uses the library of the LIVE shell, which may come from a different commit (Vercel deploys each project on its own, and a remote can be redeployed alone). A change to the main entry is therefore compatible in both directions for one deploy:
   - an added export is used by a remote only once a shell that has it is live;
   - an export is removed or renamed, or a prop changed incompatibly, only in a push after the last remote stopped using it;
   - a visual change reaches every remote at the next shell deploy, without the remote being rebuilt.
   A remote that imports a name the live shell lacks gets `undefined` and fails where it uses it; the shell's `RemoteMount` error boundary shows "couldn't load".
7. **Unchanged.** Types still come from tsconfig `paths` (the library's real source, no ambient declarations). Unit tests do not load the federation plugin and keep aliasing the source in `vitest.config.ts`. Storybook is untouched. CSS is unchanged: the shell's Tailwind already scans `operai-ui/src`.

## Consequences

- The library is downloaded once per page, and has one instance per page.
- A remote's standalone `pnpm dev` page no longer renders library components; a remote runs through the shell (`mise run dev`), as it already must for an authenticated session.
- A dev server started before the `link:` existed keeps a stale export list in the plugin's in-process cache (its config restarts happen in the same process). After pulling this change, restart `mise run dev`.
- ADR 20261031's rejection of option D ("a shell deploy changes every remote's UI at runtime without the remote being rebuilt or tested") is now accepted for the main entry, bounded by the deploy rule in point 6. The other reasons given against D do not apply: types and tests still use the source, and no component is hand-declared.

## Alternatives considered

**Keep compiling the library in every app** (ADR 20261031 as written). No runtime coupling, but one copy per app and per page. Rejected by the owner.

**Share with a fallback** (`import` left on in the remotes). Each remote would still bundle the library and use the shell's copy when present. The bundle size stays the same, and two copies could run if versions diverged. Rejected: the point is not to ship it.

**Expose the library as a shell module** (`shell/ui`, like `./tokens.css`). Needs ambient type declarations and test stubs for every component, the cost ADR 20261031 rejected. `shared` keeps the ordinary `import { … } from '@operai/ui'`.

**Share the rich-text entry too.** Needs TipTap installed in the shell and shared as well. Deferred; trigger: a fourth rich-text consumer or its size becoming a concern.
