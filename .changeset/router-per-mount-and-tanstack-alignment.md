---
"@operai/shell": patch
"@operai/estimai-ui": patch
"@operai/refund-ui": patch
"@operai/notify-ui": patch
"@operai/admin-ui": patch
"@operai/inventory-ui": patch
"@operai/crm-ui": patch
"@operai/meetings-ui": patch
"@operai/projects-ui": patch
---

Align `@tanstack/react-router` to exactly 1.170.46 in every frontend (it is a Module Federation singleton, so the
copy the suite negotiates decides how every remote behaves; `scripts/check-react-skew.mjs` now fails on a
difference, as it already did for react and react-dom). That version no longer reloads a router that is mounted a
second time, so every remote now builds its router per mount instead of once at module scope: leaving a tool
inside the shell and coming back, or following a deep link into a tool already visited, shows the route of the URL
instead of the page last displayed (estimai-ui, refund-ui, notify-ui, admin-ui, inventory-ui, crm-ui,
meetings-ui `./App` and `./MyMeetings`, projects-ui).
