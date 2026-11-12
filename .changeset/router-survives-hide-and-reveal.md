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

Fix EstimAI, Refund, Inventory, CRM and Admin opening to a blank page (and every in-tool navigation doing the
same in development). The shell hides a mounted tool and shows it again on each URL change, which React reports as
an unmount-and-mount of the tool's effects; the router torn down by that came back as a second router that was
never loaded. `@operai/ui`'s `DisposableRouterHost` replaces the `useDisposableRouter` hook: it builds the router
once and releases its browser history only when its element leaves the document, so a hide and reveal keeps the
router and a real unmount, even one that happens while the tool is hidden, still gives the window listeners and
`pushState`/`replaceState` wrappers back.
