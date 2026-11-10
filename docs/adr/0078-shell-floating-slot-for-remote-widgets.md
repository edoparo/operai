# 0078 — A remote may ask the shell for a floating slot that survives navigation; the shell owns the frame and the fallback

**Date:** 2026-11-10
**Status:** Accepted (specs/021-meetings spec A13, decided by the user 2026-11-10). Extends [ADR-0060](0060-host-extension-federated-panel-through-the-shell.md) (same loader, same failure rule) and [ADR-0006](0006-suite-frontend-module-federation.md) (the shell owns chrome).
**Deciders:** wellD
**Project:** Operai
**Relates to:** [ADR-0006](0006-suite-frontend-module-federation.md), [ADR-0030](0030-suite-version-generated-file-federated-export.md), [ADR-0060](0060-host-extension-federated-panel-through-the-shell.md), [ADR-0050](0050-shared-ui-library-consumed-as-source.md), [ADR-0058](0058-meetings-tool-shape-visibility-by-participation.md)

---

## Context

A meeting recorded in the browser lived in a panel on the meeting's page. Leaving the page asked first and a
confirmed leave stopped the recording (AC-2.10), so a person could not record a call and keep working in the CRM
or EstimAI. The recorder itself (`capture/session.ts`) was already a module-level controller that outlives the
panel; what was missing was a place to show it that every page shares. A remote's routed page cannot be that
place (it unmounts on navigation), and a remote owns no chrome (ADR-0006).

## Decision

1. **The shell owns a floating slot** (`shell/src/lib/floating.ts`): `openFloating(name, props)` and
   `closeFloating(name)`, exported through `shell/session`. `FloatingHost`, mounted once by `ShellLayout`
   OUTSIDE the router outlet, shows the newest open widget in `@operai/ui`'s `FloatingPanel`: fixed, above pages,
   below dialogs, resting on the window's edge clear of the header and footer, moved by dragging or with the
   arrow keys, its position kept in memory for the tab.
2. **The remote owns the content**, loaded through the `HostExtension` loader of ADR-0060 (5 s timeout, error
   boundary). Names are registry data (`meetings.recorderDock` → `meetings/RecorderDock`); props are plain strings
   (validated: strings only, bounded), never a callback or an object.
3. **The shell's fallback is a duty, not a nicety:** while the widget loads and whenever it cannot load or throws,
   the shell shows its own "Recording in progress · Open meeting". The rule is general: a widget that stands for
   something running on the person's behalf (a microphone in use) must never disappear because the remote's code
   failed.
4. **The remote asks, the shell does not poll:** the shell never loads a remote to find out whether it has
   something to show. meetings-ui opens the slot when its recording panel goes away with audio at stake, and
   closes it when the panel comes back or the audio is saved.
5. **Keeping the work alive stays the remote's job.** The recorder counts holders (`attach`/`detach`); the panel
   hands the session to the widget (the widget's hold is taken before the panel's is released) and takes it back
   on return; while the widget holds it, the remote keeps the tab-close prompt itself, so the prompt does not
   depend on the widget having loaded.
6. **Feature-detected both ways (ADR-0030):** a remote calling a shell without the slot keeps the old behaviour
   (in-app prompt, a confirmed leave stops and saves); a shell whose remote predates the widget shows its fallback.

## Consequences

- A recording survives any in-app navigation; it still dies with the tab (reload, close, a sign-in redirect), and
  the browser asks first.
- The widget and the meeting page share one recorder only because both entries of the `meetings` remote share its
  module instances. Verified end to end (`shell/e2e/meetings-capture.spec.ts`); a build change that duplicated the
  module would show the widget with only "Open meeting", and the panel's hold would still keep the audio safe.
- `FloatingPanel` is a library component (with a story and tests), so a second tool can reuse the slot by adding a
  name to the registry and a loader.

## Rejected

- **The widget inside meetings-ui's routed page or a portal from it:** unmounts with the route; a remote rendering
  chrome breaks ADR-0006.
- **The shell rendering the recorder itself:** recording logic in the shell (against ADR-0009's posture of keeping
  tool logic out of `shell/session`) and a second copy of the session.
- **Loading the meetings remote on every page to ask whether to show something:** a bundle per page view for
  every user, for a rare state.
- **Persisting the position in browser storage:** a recording does not survive a reload anyway; memory is enough.

## Failure shape

**Something running on the person's behalf becoming invisible because the code that draws it failed.** Whoever
shows the frame must be able to say "this is running" without the code of whoever runs it.
