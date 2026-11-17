---
'@operai/activities-api': patch
'@operai/meetings-api': patch
---

Add `410: "Gone"` to the problem-title table of `src/lib/problem.ts`, the file these services keep as a copy of the shared one (specs/20261116-letterhead-service). A 410 problem response now carries the title `Gone` instead of falling back to the generic title.
