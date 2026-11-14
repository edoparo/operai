---
"@operai/refund-api": patch
---

The compiled monthly batch PDF now uses the same template as the per-request PDF: wellD letterhead, title and
reference, a two-column metadata grid (cutoff, contents, expense period, entities / compiled by, batch
reference), a payout table per currency with one row per employee and a brand-ruled total, then each
employee's requests (period, approved on, requested and approved amounts) with per-currency subtotals, and a
"Page N of M" footer. Timestamps are in local time (`14.11.2026 09:20 (CET)`) and amounts use the suffix form
(`1414,00 CHF`), as everywhere else. The shared drawing primitives moved to
`refund-api/src/requests/documentLayout.ts`, so the two documents cannot drift apart again. Already stored batch PDFs keep their old
look; a PDF regenerated after a storage miss uses the new one.
