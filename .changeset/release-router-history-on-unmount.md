---
"@operai/estimai-ui": patch
"@operai/refund-ui": patch
"@operai/notify-ui": patch
"@operai/admin-ui": patch
"@operai/inventory-ui": patch
"@operai/crm-ui": patch
"@operai/meetings-ui": patch
"@operai/projects-ui": patch
"@operai/ui": patch
---

Release each remote's router when it unmounts. A router builds a browser history that wraps
`window.history.pushState`/`replaceState` and adds `popstate`/`beforeunload` listeners, and only
`history.destroy()` undoes that; since every remote builds its router per mount, each leave-and-return to a
tool (or the meetings recorder mounting and unmounting) left one more router, two window listeners and one more
wrapper behind for the rest of the session. The shared `useDisposableRouter` hook in `@operai/ui` now creates
the router on mount and destroys its history on unmount, last-in-first-out, and is safe under React StrictMode.
