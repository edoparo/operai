---
'@operai/auth': patch
'@operai/inventory-api': patch
'@operai/notify-api': patch
---

Removes the stale `pnpm-lock.yaml` and `pnpm-workspace.yaml` from these Bun services. Their only lockfile is now `bun.lock`, which is what the Dockerfiles and CI install from; the leftover pnpm lockfiles still listed zod 3 and kept the zod advisory (GHSA-mrhx-c7xc-m3w5) showing in dependency scanners. No runtime change.
