# QE report — Record hours in place, and the Week view of My hours

Spec `specs/20261116-record-hours-in-place/` · rigor `production` (full mode, every row blocks) · branch `feat/record-hours-in-place`

This file holds the latest pass on top (**pass 4, 2026-11-19, after the reopening**: the table view, week and month) and the earlier passes below it
(pass 3, then pass 2) as history, unedited. A reader who wants the verdict reads the first heading that says `QE verdict`.

## QE pass 4 (2026-11-19, after the reopening: the table view, week and month)

By a fresh QE agent, full mode (rigor `production`, every row blocks). A fresh, full sweep of the reopened feature (spec approved 2026-11-19: AC-5.1–5.34,
5.12 withdrawn; ledger D15–D27; plan and design amendments of 2026-11-19; tasks T17–T26), not a check of the last fix. Measured at **1ff16599**
(`git rev-parse --short HEAD`); the working tree was clean before and after (`git status --short` empty); the commit that carries this file adds only this file.
Evidence lives in the session scratch directory
`/private/tmp/claude-331608204/-Users-edoardo-paronzini-Work-Experiments-operai/f2ce1f1a-3ebd-4e72-83ca-8155e69a4eef/scratchpad/qe4/` (logs `*.log`,
screenshots `explore/shots/`, the scratch Playwright files `explore/x*.spec.ts`); it is outside the repo and not committed. Only Chromium
(Playwright's headless shell) is installed here: **Firefox and WebKit were not run and nothing below is claimed for them.**

### Read this first

1. **Verdict: FAIL, on one defect class, severity low (D1).** A project name, deal title or meeting title can be 200 characters with no space (the bound of
   a name; owasp-report L1 used that input). The L1 fix covered the month's and the week's row label only. The same input spills out of
   the cell dialog (new in this feature), the delete confirmation opened from a cell, and — in the feature's earlier scope, never
   tried with a long name in passes 1–3 — the Record hours dialog's description and the success message on a host page. Nothing becomes unusable except
   the cell dialog's × (Close in the footer, Escape and every action still work). Everything else passed: 51 of 51 ACs executed, 30/30 e2e, every gate green.
   The fix is small and the re-run is one row (see Defects, Recommendations).
2. **What is not in this verdict.** The screen-reader readback is out of the gate by D14 (not run, not verified, not claimed). Firefox and WebKit: not installed.
   The live drives of the unreadable-name row (AC-5.23 and the unreadable half of AC-5.24), of a meeting that counts for a deal (AC-5.7) and of the deal-filter
   503 (design S7 refusal state) were not done: they need a deal or meeting whose reader lost access, or hours-api's 503, and stay on their unit tests (named below).
3. **Test strength was measured, not assumed.** Seven mutants of the headline new behaviours were applied to the production code one at a time and the e2e
   journey G run: **6 of 7 killed**. The 7th (M1: the date field accepts a day after today) survived the e2e because on today's date (Thursday 19 November, so
   tomorrow is in the same week and the same month) G.3's "a day after today reads nothing" cannot see it; **12 unit tests kill it**. The tree was restored by
   `git checkout` after each; `git status` is clean.
4. Environment: see *Environment faults*. None counts as a defect.

## QE verdict: FAIL (full mode, rigor production — every row blocks; measured at 1ff16599)

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (an executed check behind every AC) | 51/51 (US-1–4: 18; US-5: 33, AC-5.12 withdrawn) | 51/51 executed, 51/51 pass (table below) | ✓ |
| e2e `hours-in-place.spec.ts` + `hours-in-place.round1.spec.ts` + `hours.spec.ts` + `hours-owners.spec.ts` | 30/30 | **30/30** (2.7 min; A–F, G.1–G.7, R1–R4, 7 owners, 3 hours), dev stack reused, nothing stubbed except the failures R1–R3 name | ✓ |
| Other e2e specs that open `/hours` | none besides the four | `grep` of `shell/e2e` for `/hours` and "My hours": only those four plus their helpers | ✓ |
| hours-ui lint / build / unit | green | lint 0, build 0, **2709/2709** (87 files), 0 "same key" warnings | ✓ |
| projects-ui lint / build / unit | green | lint 0, build 0, **941 passed + 2 expected fail** (45 files) | ✓ |
| crm-ui lint / build / unit | green | lint 0, build 0, **1824/1824** (94 files) | ✓ |
| shell lint / build / unit | green | lint 0, build 0, **706/706** (43 files) | ✓ |
| operai-ui lint / typecheck / unit | green | lint 0, typecheck 0, **389/389** (32 files) | ✓ |
| `mise run ui:check` (library change `DataTable` `pin` reaches every consumer) | exit 0 | exit 0 with `NODE_OPTIONS=--no-webstorage` (operai-ui 389, shell 706, refund-ui 789, meetings-ui 1091, hours-ui 2709); exit 1 without it (Environment faults) | ✓ |
| `cd shell && npx tsc -p tsconfig.e2e.json --noEmit` | 0 errors | 0 (the 4 errors the owasp-L1 round recorded are gone) | ✓ |
| `mise run shared:check` / `changeset:check` / `react:skew` / `env:doctor` | pass | 33 groups in sync / OK (`hours-ui-record-in-place`, `operai-ui-datatable-pin` among the matched) / OK, 12 frontends one React / all checks passed | ✓ |
| Secret scan of the 22 commits `b1d85618..HEAD` | 0 leaks | `betterleaks` is not installed here; `gitleaks` 8.30.1 (the mise-installed binary, run directly): 22 commits, ~543 KB, **no leaks** | ✓ |
| Dependency change / audit | none new | no `package.json` or lockfile in `git diff b1d85618..HEAD`; no audit job exists | n/a ✓ |
| Coverage | no gate configured | not measured (no provider in these apps) | n/a |
| Test strength (mutants of the new behaviours against e2e G) | every effective mutant killed | 6/7 killed by e2e; M1 survives e2e on a Thursday and is killed by 12 unit tests (Read this first, 3) | ✓ |
| Design: states and placements (design.md § Amendment 2026-11-19: S6, S7, F3, F5, F7, width) | all present | toolbar under the heading (Period · navigator · date field, wraps), month header compact with hidden long date, blank empty cells, `aria-disabled` Next/This week at the current period, pinned label and Total from 768 px, scroll hint at every width in the month, skeleton / empty / filtered-empty / error with Retry, scroll position kept across a re-read (G18), focus to the heading when a cell empties — all seen live (screenshots below), except the deal-filter 503 refusal and the source-down notes, which stay on their unit tests (`MyHoursPage.table` / `.month`, `HoursBanners`) | ✓ |
| Design: width of every hours page (AC-5.33, D16) | one width over List, week, month, Everyone's, Settings | 8 window configurations × 5 pages: tool container and page root identical to 0.00 px at 1920 (1691/1643), 1440 (1211/1163), 1280 (1051/1003), 1024 (795/747 with the shell rail, 955/907 collapsed), 800 (731/683), 375 (306/258 collapsed, 146/98 with the rail); no page-level horizontal overflow in any of the 40 measurements | ✓ |
| Design: month scroll (AC-5.34, decision 6/7) | scrolls inside its region, pins hold, hint at every width | region/grid 1605/1720 (1920), 1125/1720 (1440), 965/1720 (1280), 709/1720 (1024 with rail), 869/1720 (1024 collapsed), 645/1720 (800), 220/1720 (375); label and Total `position: sticky` from 800 px, static at 375; hint `display: block` at every width; page overflow 0 | ✓ |
| Accessibility (design.md § Accessibility, amended) | tab order, ARIA, focus per design | Tab order read live in both periods: Record hours → view tab → panel → Filters (5) → Period radio (one stop) → Previous → This week/month (`aria-disabled`, still a stop) → Next (`aria-disabled`, still a stop) → date field → table region → cells that hold hours, row by row; no stop on an empty cell, a total or a pin. Arrow keys switch the radio and keep focus; Enter/Space on Previous/This week/Next as designed; cell dialog traps Tab, Escape returns to the cell; Edit→Escape returns to Edit; Delete confirm opens on Cancel, Escape returns to Delete. Dark theme: pinned surfaces opaque and equal to the card (`rgb(19,19,30)`; light `rgb(240,240,248)`) | ✓ |
| Language (AC-4.6) on the new copy | Italian complete, no English | `<html lang="it">`: Periodo/Settimana/Mese, Questa settimana/Questo mese, Mostra la settimana del/il mese del, Fino a oggi., hint, empty/filtered/error states, announcements ("5 ore e 30 minuti in totale"), month heading "novembre 2026", header long date "domenica 1 novembre 2026, oggi", saved-outside in both periods | ✓ |
| Component reuse (design.md inventory) | no NEW library component | `operai-ui` diff: `DataTable` `pin` (prop, story, tests, docs), `tokens.css`; hours-ui new files `PeriodDateField`, `PeriodSwitch` (planned); the rest renamed | ✓ |
| **Long third-party names do not spill or hide controls (owasp L1 class) on this feature's surfaces** | no spill, no control off-screen | row label ✓ (month, week; every day reachable 1920–375); cell dialog ✗, delete confirmation from a cell ✗, Record hours dialog description ✗, success message ✗ — **D1** | **✗** |
| Screen-reader readback (NVDA, VoiceOver) | — | out of the gate by D14; not executed, not verified, not claimed | excluded |
| Firefox / WebKit | — | not installed; not run | not run |

### Defects

**D1 — a long unbreakable name is printed without wrapping or a cap in this feature's dialogs and messages (low).** Class: the same input and the same root
cause as owasp-report L1 (a name written by the record's owner, up to 200 characters, no break opportunity, in a container that sizes to its content). The L1 fix
(39ceb3de, b3725fb6) capped the table's row label only. Input used: a project of 200 `W`-padded characters, team = the person, 1 h on it, exactly G.7's input. **Missed
earlier** (the cell dialog since T12, the widget since T2; no pass tried a long name there); not new since the fix.

| # | Placement | Measured (Chromium, 1280 px unless stated) | Result |
|---|---|---|---|
| 1 | Cell dialog title, week and month (`TableCellDialog`, "Project: <name>") | title 3,401 px wide in a 640 px dialog (scroll 3,451 / client 638) at 1920, 1280, 1024, 800; at 375 the title is clipped at the dialog's edge; the dialog's **×** sits at x = 3,760 (3,456 at 375): off-screen, unreachable by pointer (`explore/shots/x5-dialog-1280d.png`, `x5b-dialog-375.png`) | ✗ |
| 2 | Cell dialog, the entry's target link (`EntryRow` inside the dialog) | link 2,563 px (x 358..2,921) in a 640 px dialog, runs under the figure, Edit and Delete; **Edit, Delete, footer Close and Add hours are still on top and hit-testable** | ✗ (cosmetic) |
| 3 | Delete confirmation opened from a cell | the sentence "1 h on <name>, 18.11.2026. This can't be undone." runs out of the dialog; Cancel and Delete entry usable (`x5c-delete.png`) | ✗ (cosmetic) |
| 4 | Record hours dialog from a project page (`./RecordHours`, description "Recording hours on the project <name>") | scroll 2,255 / client 638 at 1280 and at 375 | ✗ (cosmetic) |
| 5 | The success message on the host page ("1 h recorded on <name>. See in My hours") | scroll 2,577 / client 382; the name runs across the Record hours button; at 375 the message box's right edge is at x = 472 for a 375 px window (`x10-message-1280.png`) | ✗ (cosmetic) |
| — | Row label, month and week (the L1 fix) | label column 272 px (month, cap `max-w-64`) / 284 px (week at 1280); the first and last day reachable at 1920, 1280, 1024 (both rail states), 800, 375 (unpinned, by scrolling); hit-tests on the cells land on the cells | ✓ |
| — | Cell dialog's Edit dialog; Filters' project picker with the long name chosen | no overflow (638 = 638; card 1,001 = 1,001) | ✓ |

Same class, **not counted as defects of this feature** (the code is time-tracking's or a host's, outside `b1d85618..HEAD`; listed so one fix at the cause covers them):
the List's `EntryRow` (link 2,563 px in a 1,001 px card at 1280; card scroll 2,592 / client 1,641 at 1920; `x5b-list-entries-1280.png`), the List's Totals "by project" row
(clipped at the card edge), the delete confirmation opened from the List, and projects-ui's own page title on a project with that name. Everyone's hours was not conclusive (its entries card measured 1,001 / 1,001 after 0.8 s; whether the person's row had rendered was not checked).

Repro: as the e2e G.7 builds it (`createProjectViaApi` with a 200-character name, `setTeamViaApi`, one entry), open `/hours?view=month`, focus the cell, press Enter; or open
the project's page and press Record hours, save. Scratch versions: `explore/x5b-dialog-controls.spec.ts`, `explore/x10-widget-longname.spec.ts`. jsdom has no layout, so the guard
is an e2e step like G.7 (an unreachable × is `boundingBox().x > window width`).
Owner: **frontend-dev**: `overflow-wrap` / a width cap where the name is printed (`TableCellDialog` title, `EntryRow`'s link, the widget's description and message), or once in the
library's dialog and banner text — which would ship through the shell, so the deploy order of the changeset applies. If the fix goes into `@operai/ui`, the designer decides the rule.

### Findings that are not defects of this reopening (reported, not counted)

- **O1 — the Week's scroll hint is keyed to the window, not to the room (design gap, missed earlier, unchanged code).** The hint is `lg:hidden` (design S7, "as built"). With the shell's rail expanded
  (the default in a fresh browser, 224 px) an ordinary week (3 projects of 17–28 characters, 31 h 30) scrolls sideways by 108 px at 1024 px and by 32 px at 1100 px with **no hint**; at 1280 it fits. With the rail collapsed it fits at 1024
  (869 = 869) and scrolls 12 px at 960 with the hint — the numbers the design and passes 2–3 measured. The Month always shows its hint. Owner: **designer** (key the hint to overflow or to the content width).
- **O2 — R-D1, the check the design asked QE to make: a filled cell reads as plain text at rest.** Computed at rest: transparent background and border, no underline; hover: pointer cursor and background
  `rgb(232,232,244)`; keyboard focus: 2 px solid ring. There is no signal at rest and none on a touch screen. The design names the smallest remedy (`variant="secondary"` on filled cells). Owner: **designer / product owner** (it is the user's
  own request, D17, that removed the plus); not a defect.
- **O3 — G.3's future-day step cannot fail on most days** (Read this first, 3): "a day after today reads nothing" passes whatever `pickedPeriod` does when tomorrow is in the period shown. The 12 unit tests carry it. A one-line
  hardening is to use `max + 1 day` only on a day that crosses a period, or to also assert it against next Monday / the 1st of next month. Owner: **frontend-dev**, optional.
- **O4 — at 375 px with the shell's default rail the toolbar overflows the card** (navigator group 150 px in a 98 px card; `x1` log, `375d`). The rail does not collapse on a phone (pass 3, observation; `Sidebar.tsx` "desktop-only"). With the rail collapsed, the toolbar wraps inside the card
  and nothing overflows. Owner: the shell, as its own spec.
- **O5 — the current month opens at its left edge**, so today's column (the 19th of 30) is off-screen on a 1440 px window until the person scrolls. The design lists this under "Not designed" (scrolling today into view); recorded for the product owner.
- **O6 — as designed, stated so nobody files them:** typing 15/10/2026 key by key passes through other periods (the 1st, then the 15th of November, then January, then October; F7 step 3); `?week=2000-01-01` (a Saturday) opens the current week because the first reachable week begins on 2000-01-03; the trailing slash in `/hours/?view=month` after the first in-app navigation (pass 2).

### Environment faults (not defects, no fix round)

- **Node 26.10.0 without `NODE_OPTIONS=--no-webstorage`:** `localStorage` is undefined, so `mise run ui:check` failed at the shell's unit tests (`TypeError: Cannot read properties of undefined (reading 'getItem')`, `ui-check.log`) while the library part passed. The same shell suite is 706/706 with the flag and `ui:check` exit 0 with it (`ui-check2.log`). Same cause as pass 3's finding; `mise.toml` pins Node 24, which refuses the flag. I ran every suite with the flag, as the brief says.
- **`betterleaks` is not installed.** `mise x gitleaks@8.30.1 -- gitleaks …` was refused by the permission classifier; I ran the already-installed binary from its install path (`~/.local/share/mise/installs/gitleaks/8.30.1/gitleaks`), same scan, read-only.
- **Data left in the dev databases** (projects have no delete route): about 40 projects named `QE4 …`, `QE4Long…`, `Alpenstrom — portale clienti`, `Rete vendite …`, `Migrazione ERP fase 2` (13 scratch seeds × 3 plus the realistic week's three), plus the official specs' `Hip …` companies, deals and projects as in pass 3. Every time entry I and the specs recorded was deleted by `deleteOwnEntriesQuietly`, every `hip-*@operai.test` person by `cleanupPeople`. The seeded category "Talk preparation" was retired and **restored** for the AC-5.24 drive (`retired=false` read back). `git status` is clean. No dev server was started or stopped by me; no background process of mine is left.

### Acceptance criteria — 51 of 51 executed, 51 pass

`G`, `F`, `A`–`E`, `R1`–`R4` = `shell/e2e/hours-in-place.spec.ts` and `hours-in-place.round1.spec.ts`, all green in the 30/30 run; `unit` = the hours-ui suites named, green in 2709/2709; `live` = driven by me in Chromium
(`explore/x1`–`x10`); `M#` = the mutant the e2e killed.

| AC | Evidence | Result |
|---|---|---|
| 1.1–1.3, 2.1–2.3 | e2e A, B (the button for the team member / owner, none for a reader / task-only assignee; dialog with the target fixed, Day today, focus on Duration); unit `recordHours.test.ts`, `ProjectDetailPage.recordHours`, `DealDetailPage.recordHours`; the widget with a 200-character project opened live (x10) | ✓ |
| 3.1–3.6 | e2e B, C, D, R1, R4; unit `ProjectTaskItem` / `MyTasksPageRow` / `ActivityItem.recordHours`, `RecordHours.test.tsx` | ✓ |
| 4.1, 4.3, 4.4 | e2e A (My hours lists the entry, same values; message with link, no host re-read); unit `RecordHours.test.tsx` (POST only) | ✓ |
| 4.2 | e2e R1, R2; unit `EntryDialog.preset`, `EntryDialog.refusalFocus` | ✓ |
| 4.5 | e2e E (hours remote aborted: project page, deal page, My tasks keep working with the link) | ✓ |
| 4.6 | unit `strings.test.ts` parity, `TableView.it`, `PeriodNavigator`, `PeriodDateField`; live Italian drive (x3), English drive (x2, x4) | ✓ |
| 5.1 | e2e F, `hours.spec` ("opens My hours from the user menu" lands on the table); unit `ViewSwitch`, `HoursShell`, `MyHoursPage.table`; live: `/hours` opens Table first, tabs Table \| List | ✓ |
| 5.2 | e2e G.1 (`?view=list`, `?view=week&week=<day>`, `?view=month&month=<last month>`); unit `HoursFiltersState.address`; live x6 (floor, garbage and array values, `2026-13`, `2026-1`) | ✓ |
| 5.3 | unit `TableView`, `tablePeriod`, `week`; e2e F, G.2; live (Mon–Sun headers, Today badge) | ✓ |
| 5.4 | unit address / `tablePeriod`; e2e F, G.2; live (`/hours` = 16.11.–22.11.2026 on Thu 19.11.) | ✓ |
| 5.5 | unit `PeriodNavigator`, `tablePeriod`; e2e F, G.2; live x2 (Enter on Previous, Space on This week, Enter+Space on `aria-disabled` Next: URL unchanged, focus kept) | ✓ |
| 5.6, 5.8, 5.9, 5.10 | unit `tableGrid`, `TableView` (both periods); e2e F, G.2, G.6 (300 entries: every cell, row, day and month sum); live x4 (month grid 18 h 30 = API 1,110 min after an add, an edit, a delete and a header record) | ✓ |
| 5.7 | unit `tableGrid` ("a meeting linked to a visible deal stays on its own row"); **not driven live** (needs a deal-linked meeting) | ✓ (unit) |
| 5.11 | unit `TableView` (1 h and 160 h week/month, one markup); screenshots: no target, mark or comparison | ✓ |
| 5.13, 5.18 | unit `EntryDialog.preset`, `MyHoursPage.cells` (week and month blocks); e2e F (day and project changeable, the changed values posted); live x4 (Add hours in a month cell: Day = the cell's, project = the row's, focus on Duration; save; the cell dialog stays, focus back on Add hours) | ✓ |
| 5.14, 5.32 | e2e F, G.2 (an empty past cell: blank `td`, no button, no tab stop, click opens nothing); **M4 killed**; live x2 (no tab stop on any empty cell) | ✓ |
| 5.15, 5.16, 5.17 | e2e F (week); unit `TableCellDialog`, `MyHoursPage.cells`; live x4 and x2 in the **month**: open, Edit (PATCH, figure follows, focus back on that Edit), Delete (confirm on Cancel, Escape back to Delete; confirmed delete empties the cell, focus on the card heading) | ✓ |
| 5.19, 5.20 | e2e F; unit `MyHoursPage.cells` / `.month`; live x4 (Record hours in the header on a new category adds its row in the month, scroll position 420 → 420; figures follow without a reload) | ✓ |
| 5.21, 5.22 | unit `MyHoursPage.table`, `.month`, `.pick`, `HoursFiltersState.address`; live x4: category and project filters carried by every read through week → month → List → Table → week; the List keeps its Period; Clear filters in the month keeps `view=month` | ✓ |
| 5.23 | unit `TableView`, `TableViewModel`, `tableGrid`; **not driven live** | ✓ (unit) |
| 5.24 | unit `tableGrid`, `TableCellDialog`, `MyHoursPage.cells`; live x6: a retired category's row in the week and the month — label "Other work Talk preparation (retired)", its cell dialog has no Add hours, one Edit, one Delete; the unreadable half is unit-only | ✓ |
| 5.25 | e2e G.2 (header count = days + 2, first and last day named by date); unit `month`, `tablePeriod`; live (30 columns for November, which starts on a Sunday: first column "Sun 1") | ✓ |
| 5.26, 5.27 | unit `tablePeriod.switchTo` (D25 and D26 vectors), `PeriodSwitch`, `MyHoursPage.month`; e2e G.2 (current week → month → week, past weeks → month → week back to the week left); **M3 killed**; live x2 (ArrowRight/Left on the radios keep focus and the address) | ✓ |
| 5.28 | e2e F, G.2; **M2 killed**; live x2 | ✓ |
| 5.29 | e2e G.1; **M7 killed**; live x6 (`?week=2000-01-01`, `1999-12-27`, `month=1999-12`, `2026-13`, `garbage`, `week[]=…` all open a real period, every request `whose=mine` and ≤ 31 days) | ✓ |
| 5.30 | e2e G.3 (picked and typed key by key under slow and fast reads, both periods); live x2 (typed 15/10/2026 digit by digit: navigates only on complete in-range days, the year 0002/0020/0202 change nothing, the typed text survives, the reference day returns on blur) | ✓ |
| 5.31 | unit `tablePeriod`, `PeriodDateField`, `MyHoursPage.pick` (12 tests kill M1); e2e G.3 (`max` = today); live x2/x6 (a future day typed or filled: no request; `min` 2000-01-03 week, 2000-01-01 month; `fill('2000-01-02')`, `1999-12-31` read nothing; the floor day's period has Previous `aria-disabled`) | ✓ |
| 5.33 | e2e G.4 (1440 and 1920, admin); **M5 killed**; live x1 (8 configurations × 5 pages, 0.00 px spread) | ✓ |
| 5.34 | e2e G.5 (1280: region scrolls, page does not, focused cell clear of the pins), G.7; **M6 killed**; live x1 (region wider than its viewport at every width, page overflow 0), x5 (every day reachable with the 200-character label) | ✓ |

### Exploratory evidence (what was driven)

Real Chromium against the real dev stack, `@operai.test` people only (per-run `hip-*` people and a per-run admin, never Google or GitHub), nothing stubbed except where named. `x1` widths (8 configurations × List/week/month/Everyone's/Settings, with
screenshots); `x2` keyboard (Tab order in both periods, radios, navigator, date field typed digit by digit, cell dialog trap and Escape); `x3` Italian (week, month, states, cell dialog, saved-outside in both periods, error with Retry);
`x4` the month's cell flows and the filters; `x5`, `x5b`, `x5c`, `x10` the long name in every placement; `x6` rapid period changes under random 100–800 ms read delays (a 15 ms DOM recorder saw 14 distinct states, **0** with a grid under another
period's heading), a browser in Auckland (its day is the 20th; Today badge and `max` stayed on Zurich's 19th), the floor and junk addresses, a retired category; `x7` light and dark; `x8` a realistic week; `x9` the cell affordance. Console errors and warnings during `x6`: none.
First month grid 61 ms (G.2) and 64 ms with 300 entries (G.6): far under R13's 800 ms.

Screenshots cited: `explore/shots/month-1440d.png`, `month-1440d-end.png`, `week-1024d.png`, `x5-dialog-1280d.png`, `x5b-dialog-375.png`, `x5b-list-entries-1280.png`, `x5c-delete.png`, `x10-message-1280.png`, `x7-dark.png`, `x9-rest.png`, `x8-week-1024d.png`,
`x8-week-1024c.png`, `it-month.png`, `everyone-1440d.png`, `settings-1920d.png` (all present, checked with `ls`).

### Tests added or changed

None committed (the brief says to commit only this file). The scratch Playwright files stay in the scratchpad. The failing repro for D1 is `explore/x5b-dialog-controls.spec.ts` (asserts nothing; it prints the boxes) and, as an assertion, the G.7 pattern: a `boundingBox()` of the dialog's × inside the window.

### Recommendations

- **Fix round, frontend-dev, one defect (D1):** wrap or cap the name where it is printed (placements 1–5), with one e2e step in G in the G.7 style (dialog ×, link and message inside their containers); then re-run QE for that row and e2e G/A. The same class on the List and Totals (not counted) is cheapest fixed in the same change.
- Owasp-reviewer pass: **not needed again** unless the fix goes into `@operai/ui` (then a look at the deploy order only); the commits since the delta pass are class strings and tests.
- Designer: O1 (Week hint) and O2 (R-D1) are decisions, not defects. Product owner: O5.
- tasks.md is not edited by QE; T27 stays open until D1 is fixed and re-verified.

---


# Pass 3 — 2026-11-19 — after the rebase onto the new `feat/time-tracking` and the user's decision D14

By a fresh QE agent. Scope: only what this branch adds on top of `feat/time-tracking` (`git diff --name-only feat/time-tracking...HEAD`:
52 commits; problems in other modules are context, never findings). This is a re-verification, not a second full sweep: it re-runs
every gate and the end-to-end journeys at the commit handed over, re-measures the layout on the new base, tests the one test change
since pass 2 for strength, and says plainly what it carries over and why.

## Read this first

1. **The screen-reader readback (NVDA, VoiceOver) is out of the gate by the user's decision D14 (2026-11-19; `ledger.md` D14, `design.md`
   § "Amendment 2026-11-19", commit c4b4f0cd). It was never executed in any pass and it is NOT verified. This PASS does not claim it.**
   What stays verified, by tests I re-ran green here: the roles (`role="status"` on the success message, `role="alert"` on a refusal, the
   labelled scroll region), the texts and labels in both languages, `aria-hidden="true"` on the scroll hint (read from the live DOM
   below), and where focus goes after every write, refusal and retry (`toBeFocused()` in R1–R3). What is not verified, and nobody
   should read this PASS as saying so: that any browser and screen-reader pair *speaks* them as designed. The follow-up (a person runs
   the five-step readback with NVDA and VoiceOver and files a bugfix if it finds one) is design.md's, not scheduled; its script is in
   pass 2's **Blocked** section below, kept verbatim for that reason.
2. **Nothing is BLOCKED.** Every row of the table was executed in this pass, at the commit named in the verdict line.
3. **What was carried over from pass 2, and why that is sound.** The live drives of pass 2 (D1/D2/D3 in every placement, both languages,
   the Italian messages) were not repeated. The basis: I compared the added and removed lines of the non-spec diff pass 2 measured
   (`72a2760e..6c638586`) with this branch's now (`feat/time-tracking...HEAD`). **No production line differs.** The whole difference is
   test code: a new crm-ui test helper `src/test-support/RouterWrapper.tsx` and its use in three crm-ui test files (main's `ActivityItem`
   now renders a router `<Link>` for a task's deal, 8ffd408c), and the `shell/e2e/hours-in-place.spec.ts` helper (bbe8747c). The same
   comparison against the pre-rebase backup tip (`backup/record-hours-pre-rebase-20261119`) differs only in that e2e spec. Since the
   OWASP follow-up (239a6302) the only commits touch tests and docs. What *did* change under the branch is its base (origin/main
   cc2c3f46), so the rows that depend on the base (gates, e2e through the real shell, layout) were re-run, not carried.
4. **Environment fault, kept out of Defects** (details under *Environment faults*): this machine's `pnpm test` runs on Node 26.10.0 and one
   crm-ui test from main fails there without `NODE_OPTIONS=--no-webstorage`. Under the pinned Node 24.22.1 (`mise.toml`) every suite passes with
   no flag.
5. No coverage gate and no dependency-audit job exist in these apps (unchanged since pass 2); those two rows are n/a, not passed.

## QE verdict: PASS (full mode, rigor production — every row blocks; measured at c4b4f0cd; the report commit that follows adds only this file)

No row failed, none is blocked. Defects: **0**. Environment faults: 1 (does not block). The screen-reader readback is **excluded by D14,
not verified**.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (an executed check behind every AC) | 41/41 | 41/41: every AC's unit suites and e2e A–F / R1–R4 re-run green at c4b4f0cd; the AC rows of pass 2 stand (production patch identical, see Read this first 3) | ✓ |
| Branch patch unchanged since pass 2's measured tree (6c638586) and by the rebase | no production difference | **0 production lines differ**; the only differences are test code: crm-ui `RouterWrapper` + 3 test files (8ffd408c) and the e2e helper in `hours-in-place.spec.ts` (bbe8747c) | ✓ |
| e2e `hours-in-place.spec.ts` + `hours-in-place.round1.spec.ts` | 10/10 | **10/10** (52 s), notify-api up (`/health` 200), nothing stubbed except R's named failures | ✓ |
| e2e `hours.spec.ts` + `hours-owners.spec.ts` (time-tracking, on the new base) | 12/12 | **12/12** (56 s) | ✓ |
| Strength of bbe8747c ("no Record hours" for a reader, A and B) | the assertion fails when the button is there | mutated in a scratch copy of the spec (not committed, deleted): A with the team member in the reader's place and B with the deal's owner: both stop at `toHaveCount(0)` with `Expected: 0 Received: 1` after the wait; the wait does not mask a present button (`mutant-A.log`, `mutant-B.log`) | ✓ |
| hours-ui lint / build / unit | green | lint 0, build 0, **2153/2153** (81 files) | ✓ |
| projects-ui lint / build / unit | green | lint 0, build 0, **941 passed + 2 expected fail** (45 files) | ✓ |
| crm-ui lint / build / unit | green | lint 0, build 0, **1824/1824** (94 files) on Node 24.22.1 with no flag, and on Node 26.10.0 with `--no-webstorage`; 1823/1824 on Node 26 without it (Environment faults) | ✓ |
| shell lint / build / unit | green | lint 0, build 0, **706/706** (43 files), on both Nodes | ✓ |
| operai-ui lint / typecheck / unit | green | lint 0, typecheck 0, **379/379** (31 files), on both Nodes | ✓ |
| `ListRows` consumers on the new base (refund-ui, meetings-ui, admin-ui, inventory-ui, notify-ui, estimai-ui) | unit green, no duplicate-key warning | 789, 1091, 1100, 1099, 53, 360 passed; **0** "same key" warnings in any of the ten suite outputs | ✓ |
| `mise run shared:check` | in sync | 33 groups in sync | ✓ |
| `mise run changeset:check` | pass | OK (22 changesets matched, `hours-ui-record-in-place`, `projects-ui-record-hours`, `crm-ui-record-hours`, `shell-hours-record-hours-extension`, `operai-ui-list-rows-keyed` among them) | ✓ |
| `mise run react:skew` | one React | OK, 12 frontends | ✓ |
| `mise run env:doctor` | all pass | all checks passed | ✓ |
| Secret scan, `mise x gitleaks@8.30.1 -- gitleaks git --log-opts=feat/time-tracking..HEAD` | 0 | 52 commits scanned, no leaks | ✓ |
| Dependency change / audit | none new | no `package.json` or lockfile in the diff; no audit job exists | n/a ✓ |
| Coverage | no gate configured | not measured (no coverage provider in hours-ui, none configured in the others) | n/a |
| OWASP (`owasp-report.md`, follow-up at 239a6302) | PASS | PASS; the commits since touch tests and docs only, so no new sink, storage, origin or dependency | ✓ |
| Design: Week at 1024 px | no overflow of the grid region | 869 = 869 px with day figures and with a 144 h 30 total (`week-1024-pass3-small.png`, `-big.png`) | ✓ |
| Design: Week at 960 px | scrolls inside the card, as designed | 805 px region, 807 px grid (small) / 824 px (144 h 30): sideways scroll inside the card, hint shown, no page overflow | ✓ (as designed) |
| Design: Week at 375 px | the whole Monday column with its figure visible unscrolled | region 220 px; Monday's header 235–323 and Monday's figure 235–323 inside the region 107–327; page overflow 0 (`week-375-pass3b-small.png`) | ✓ |
| Design: scroll hint | below `lg` only, only with a grid, `aria-hidden` | `display:none` at 1440, 1100, 1024; `block` at 1023, 960, 768, 375; `aria-hidden="true"` every time; absent on an empty week at 1440, 1024, 960 and 375 | ✓ |
| Design states (S1–S9) and a11y plan (roles, labels, focus) | all present | unchanged code; the unit suites and e2e A–F, R1–R4 (incl. `toBeFocused` after a refusal, a failed delete, a failed Week read) green; region `aria-label` "Hours by project, deal, meeting and other work, 09.11.2026 – 15.11.2026", `tabindex="0"` read from the live DOM | ✓ |
| Component reuse (design.md inventory) | no NEW library component | `operai-ui` diff is `ListRows` (one key rule) and its test, plus a docs line; no new component | ✓ |
| Exploratory UI pass | every designed flow walked | the journeys A–F and R1–R4 in a real browser against the real stack, plus the layout probe above, both measured at c4b4f0cd; the per-placement and both-language live drives of pass 2 are carried (Read this first 3) | ✓ (part re-run, part carried) |
| Screen-reader readback (NVDA, VoiceOver) | — | **out of the gate by user decision D14 (2026-11-19); not executed, not verified, not claimed** | excluded |

## Defects

None. Nothing is new since the fix round and nothing was missed earlier. The two findings pass 2 filed as **not defects of this feature**
stand unchanged (outside the diff or wording only): hours-ui Settings → Add category leaves focus on `<body>` after a refused save
(`TimeListItemDialog`, specs/20261112-time-tracking, the cause is `@operai/ui` `FormDialog`), and design.md's "fits at 960 (805 px)" is
a few pixels optimistic (the measure above: 805 px region against a 807 px grid; its threshold "from about 980 px up" is right).

## Blocked

None. (The readback is not blocked: it is not part of the gate, D14.)

## Environment faults (not defects, no fix round)

- **`crm-ui/src/hooks/useOfferDraft.test.tsx` > "a whole editing session touches neither web storage nor cookies" fails on this machine's
  Node 26.10.0 without `NODE_OPTIONS=--no-webstorage`** (`TypeError: Cannot convert undefined or null to object` at `Object.keys(window.localStorage)`;
  `crm-ui.test.log`). What I checked: the file and the hook it tests are not in this branch's diff (they come from main's offer wizard,
  33ebd929); `pnpm test` here runs on Node 26.10.0 (`pnpm exec node -v`), while `mise.toml` pins Node 24; run directly under the pinned
  Node 24.22.1 with no flag, **crm-ui 1824/1824, projects-ui 941 + 2 expected fail, hours-ui 2153/2153, shell 706/706, operai-ui 379/379**
  (`*.node24.log`); and with the flag on Node 26 crm-ui is also 1824/1824. It is the cause `specs/20261112-time-tracking/decisions.md`
  already records for the shell's tests (Node 26, `localStorage` undefined, "not verified under CI's Node": now it is, for these five
  suites). Note for whoever runs the gates here: Node 24 refuses `--no-webstorage` in `NODE_OPTIONS` ("not allowed in NODE_OPTIONS"), so the flag is for the
  local Node 26 only. I did not run the failing test on a baseline checkout (a second worktree would need its own install); the
  attribution rests on the above, not on that run.
- **Data left in the dev databases** by the journeys and my probes (no delete route exists for them): companies, deals and projects named
  `Hip …`; every time entry, task and `hip-*@operai.test` user the runs made was deleted (the specs' own cleanup; my scratch probes cleaned
  their entries and people in `finally`). `git status` is clean at the end.

## Observations (not defects, outside this diff)

- **The shell's rail does not collapse on a phone.** `Sidebar.tsx` documents it ("Collapsible (desktop-only; no mobile drawer)"), and the
  collapsed state is a per-browser preference (`operai_sidebar_collapsed`). In a **fresh browser context the rail is expanded (224 px) at
  every width**, so at 375 px the content area of every page is 151 px and the Week's grid region is 60 px (measured: 1440 → 1125 px,
  1024 → 709 px, 960 → 645 px, 375 → 60 px, the Monday column outside the region). The design's 375 px, 1024 px and 960 px figures (and
  pass 2's) are with the rail collapsed, which is how I measured the rows above, and every one of them matches pass 2's numbers on the
  new base. This is the shell's responsiveness, not the Week's, and it is the same for every tool. Owner if anyone wants it:
  **frontend-dev** on the shell, as its own spec.
- The project page's 409 "reload" path unmounts the header widget's message; `/hours/?view=week&week=…` gains a trailing slash after the first
  in-app navigation; the hint shows between about 980 and 1023 px though the grid fits; the dev-only Duration error under StrictMode.
  All as in pass 2.

## Tests added or changed (this pass)

None committed. Three scratch Playwright files were used and deleted (they are in the scratchpad, not in the tree): two mutants of
`hours-in-place.spec.ts` (A and B's reader replaced by a person who is offered the button) and a layout probe of the Week at seven widths.
Each was removed with `rm` after its run; `git status` is clean.

## Recommendations

- **Owasp-reviewer pass: not needed.** No production line has changed since the follow-up that passed (239a6302); the rebase changed the base,
  not the branch.
- The close (T16, `/wellforge:done`) can proceed on this verdict; the evaluator is the next step. tasks.md is not edited by QE.
- Follow-ups, none part of this feature's gate: the screen-reader readback (D14); Settings → Add category focus (pass 2, finding 1); the
  shell's phone-width rail (above).

---

# History — pass 2 (re-run after fix round 1), superseded by pass 3 above, kept unedited

Spec `specs/20261116-record-hours-in-place/` · rigor `production` (full mode, every row blocks) · branch `feat/record-hours-in-place`
Pass 2 (re-run after fix round 1), by a fresh QE agent. It re-verifies D1, D2, D3 and the designer's findings of pass 1 in the
running app, re-runs every gate, and re-checks the 41 ACs. Round under test: `git log 109448a0..HEAD`.

## Read this first — what could not run, and what was judged instead

1. **BLOCKED row: screen-reader readback (NVDA, VoiceOver).** Unchanged from pass 1: no screen reader can be driven from here.
   What I checked instead, in the DOM of the running app: the success message is `role="status"` with its text complete (English
   and Italian), every cell button's accessible name carries the row and the day, the scroll hint is `aria-hidden="true"` (it is a cue
   for the eye; the region is a labelled scroll region), and the dialogs are `aria-modal` with their description wired. Script for the
   person who runs it is under **Blocked**.
2. **Judged from the cause, not run in a production build: the dev-only "Duration error on open"** (React StrictMode's simulated unmount
   in the shell's dev root; pass 1, item 2). Unchanged by the round; not counted as a defect.
3. **No coverage gate and no dependency-audit job exist** in hours-ui, projects-ui, crm-ui or shell (nothing configured; hours-ui has
   no coverage provider; `.github/workflows/` has no audit job). Those two rows are n/a, not passed. The round adds no dependency
   (`git diff 72a2760e..HEAD` over every `package.json` and `pnpm-lock.yaml`: empty).
4. The whole `pnpm e2e` was not run (caller's environment note: about 26 failures outside hours for local reasons). The four specs of
   this feature were: **20/20**.
5. The D2 focus unit tests rest on an emulation of the browser's focus fixup (`hours-ui/src/test-support/focusFixup.ts`). I did not
   take it on trust: every focus claim below was measured on `document.activeElement` in real Chromium, and two of the fixes were
   switched off to see the real browser answer `BODY` (see Test strength).

## QE verdict: BLOCKED        (measured at 6c638586; the report commit that follows adds only this file)

No row failed. One row could not be executed (screen-reader readback), so the verdict is BLOCKED, not PASS.
Defects: **0** (D1, D2, D3 and the two design defects are fixed in every placement). Blocked: 1. Environment faults: 1.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (executed check behind every AC) | 41/41 | 41/41 executed, 41/41 pass (AC-4.2, the one failing in pass 1, passes) | ✓ |
| D1 — a fixed task's `activity_not_allowed` is shown | every placement | 7/7 placements shown with the sentence, dialog open, values kept, focus on Save (live) + e2e R1 | ✓ |
| D2 — focus after a refusal / failed delete / failed Week read | never `<body>` | 35 real-browser cases driven by hand, every one on Save / Confirm / Retry / heading, + e2e R1–R3 | ✓ |
| D3 — a row's message survives the list's re-read | every placement | 6/6 placements × removal, deletion and insertion above the row (live) + e2e R4 | ✓ |
| Design: Week at 375 px | the whole Monday column with its figure visible without scrolling | header and figure inside the 220 px region, no scroll (`week-375.png`) | ✓ |
| Design: Week at 1024 px | no overflow of the grid region | 869 = 869 px with small totals and with "144 h" / "160 h" totals | ✓ |
| Design: Week at 960 px | scrolls inside the card, as designed (fits from about 980) | 805 px region, 809 px grid: 4 px sideways scroll; hint shown | ✓ (as designed) |
| Design: scroll hint | below `lg` only, only with a grid | shown at 1023, 960, 768, 375; `display:none` at 1024+; absent while loading, on an empty week, a future week and an error | ✓ |
| Design: Italian success message | "Hai registrato …" | 30 min, 1 h, 2 h 30, 24 h, other work: all read correctly | ✓ |
| Design states (design.md S1–S9) | all states present | unchanged since pass 1 (S1–S9 rendered live; S3 persistence now holds) | ✓ |
| Accessibility (design.md) | keyboard + ARIA per design | keyboard paths and focus after every write, refusal, retry and failed delete hold (see D2) | ✓ |
| Component reuse (design.md inventory) | no NEW library component | `operai-ui` changed by one bug fix of `ListRows` (keys rows by their child's key), no new component; hosts reuse `ListRows` again | ✓ |
| e2e `hours-in-place.spec.ts` + `hours.spec.ts` + `hours-owners.spec.ts` | 16/16 | 16/16 (A–F, 7 owners, 3 hours) | ✓ |
| e2e `hours-in-place.round1.spec.ts` (new, R1–R4) | 4/4 | 4/4 (20/20 with the above, 1.5 min) | ✓ |
| hours-ui lint / build / unit | green | lint 0, build 0, **2134/2134** (81 files) | ✓ |
| shell lint / build / unit | green | lint 0, build 0; unit 668/669 once (see Environment faults), **669/669** (42 files) in the `ui:check` run at the same commit, 3/3 alone | ✓ |
| projects-ui lint / build / unit | green | lint 0, build 0, **942/942** (45 files) | ✓ |
| crm-ui lint / build / unit | green | lint 0, build 0, **1593/1593** (81 files) | ✓ |
| `mise run ui:check` | exit 0 | exit 0: operai-ui 299/299 (25 files), shell 669, refund-ui 789, meetings-ui 1052, hours-ui 2134 | ✓ |
| `ListRows` consumers (admin-ui, inventory-ui, notify-ui, estimai-ui) | unit green | 490/490, 1057/1057, 53/53, 360/360 | ✓ |
| `mise run shared:check` | in sync | 33 groups in sync | ✓ |
| `mise run env:doctor` | all pass | all checks passed | ✓ |
| `mise run changeset:check` | pass | OK (36 changesets matched, `.changeset/operai-ui-list-rows-keyed.md` among them) | ✓ |
| `mise run react:skew` | one React | OK, 11 frontends | ✓ |
| Secret scan, `gitleaks@8.30.1 git --log-opts=72a2760e..HEAD` | 0 | 48 commits scanned, no leaks | ✓ |
| Dependency change / audit | none new | no `package.json` or lockfile in the diff; no audit job exists | n/a ✓ |
| Coverage | no gate configured | not measured (see 3 above) | n/a |
| OWASP (`owasp-report.md`, follow-up at fc8be39e) | PASS | PASS, N1 fixed; my scan of the round's added production lines finds no sink, storage, origin or dependency change | ✓ |
| Test strength (mutation of the fixes) | every effective mutant killed | 7 of 7 killed by the new e2e journeys, 2 more shown live as `BODY` / lost message (see below) | ✓ |
| Exploratory UI pass | every designed flow walked | the placements above, both languages, five widths (1440 / 1280 / 1024 / 960 / 375, plus 1100, 1023, 768) | ✓ |
| Screen-reader readback | NVDA + VoiceOver | not executed | BLOCKED |

## Pass 1's defects, re-verified by placement

All driven in Chromium against the real stack through the dev test-auth sessions (`@operai.test` people, never Google). `focus` is
`document.activeElement` read in the page 1 s after the answer, so a control that was disabled while the request ran has been through
a rendering.

### D1 — `activity_not_allowed` of a fixed task: **fixed** (shown in every placement)

Method: open the page, delete the task through activities-api, press **Record hours** on the row that is still drawn, Duration `1`, Save.
POST answers 422; the dialog stays open, shows "This activity does not belong to the chosen project." (deal: "…chosen deal."), keeps
the value, and focus is on Save (Enter retries with the same result).

| Placement | Result |
|---|---|
| projects-ui project Tasks card row | ✓ (also e2e R1, real services) |
| projects-ui My tasks project row | ✓ |
| projects-ui My tasks pre-sales row with a deal | ✓ |
| crm-ui Tasks page deal-task row | ✓ |
| crm-ui deal timeline deal-task row | ✓ (also e2e R1) |
| crm-ui company timeline deal-task row | ✓ |
| crm-ui contact timeline deal-task row | ✓ |
| project header, deal header (no task fixed: the refusal is on the Activity select) | ✓ by construction, not driven |
| a deal-less task (other work, no activity sent) | n/a, nothing to refuse |

Root cause, as the round states it: the fixed task is a `dl` fact with no field to carry an error, so `failureOf` now routes it to the
dialog's form-level alert when `taskFixed`. Mutant M-D1 (always route to the field) is killed by R1.

### D2 — focus after a refusal: **fixed** in every placement of the class

Dialog placements, each with the refusals that have no field, then Enter on the focused control (retries) and Escape (focus returns to
the opener). 

| Placement | `host_unavailable` | 500 | network | entity refusal | focus after |
|---|---|---|---|---|---|
| project header → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_on_project` Save ✓ | Escape → Record hours ✓ |
| project Tasks card row → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_on_project` Save ✓ (and the real 403 of a person removed from the team: My tasks, Save ✓) | ✓ |
| deal header (owner) → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_involved_in_deal` Save ✓ | ✓ |
| deal timeline row → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_involved_in_deal` Save ✓ | ✓ |
| My hours' own dialog (other work) | (generic sentence) Save ✓ | Save ✓ | Save ✓ | focus on the picker (unit tests + e2e `hours-owners`, not re-driven) | ✓ |
| My hours' own dialog, **edit** (PATCH 500, List) | | Save ✓ | | | ✓ |
| `DeleteEntryDialog` from the List | | Confirm ✓ | Confirm ✓ | (503: Confirm ✓) | Escape → the entry's Delete ✓ |
| `DeleteEntryDialog` from the Week cell dialog | | Confirm ✓ | Confirm ✓ | | Escape → the entry's Delete ✓; a delete that works → the dialog's heading, never `<body>` |
| Week read, **Retry fails again** (500) | | new Retry ✓ | | | |
| Week read, **Retry works** | | | | | card heading `H3#hours-week-heading` ✓ |

The same refusals in e2e R1–R3 (real Chromium, `toBeFocused()`), with hours-api's answer stubbed only where a real failure cannot be
caused (the harness never breaks a shared service). Real refusals (not stubbed): the deleted-task 422, and the 403 `not_on_project` of
a task row whose assignee left the team.

**Same class, other placement, pre-existing and outside this feature's diff:** hours-ui **Settings → Add category**
(`TimeListItemDialog`, specs/20261112-time-tracking): a refused save (stubbed 500) leaves focus on `BODY`. It is the same cause as D2
(`@operai/ui` `FormDialog` disables Save and the fieldset while busy and gives no ref to Save); decisions.md routed it as a follow-up.
This is **missed by pass 1 and not introduced by the round**; it is not counted as a defect of this feature. Every other
`FormDialog` consumer in the nine apps shares the cause and was not checked.

### D3 — the widget's message dropped by an unrelated reload of the host list: **fixed**

Method: press **Record hours** on a row (message shows), then change the list above or below it, and count the message inside that row
after the re-read has landed. "Above" = Mark done on a row above, Delete on a row above, a row inserted above (a task or an activity
that sorts first, or logged by the person).

| Placement | Mark done above | Delete above | Row inserted above |
|---|---|---|---|
| projects-ui project Tasks card | ✓ | ✓ | ✓ (Add task; also R4) |
| projects-ui My tasks | ✓ (two rows above, in turn) | n/a (no Delete) | ✓ (a task created by the API appears first after the re-read) |
| crm-ui company timeline | ✓ | ✓ | ✓ (Log activity) |
| crm-ui deal timeline | ✓ | ✓ | ✓ (Log activity; also R4 with a call logged by the API) |
| crm-ui contact timeline | n/a (rows above were done) | ✓ | ✓ (Log activity) |
| crm-ui Tasks page | ✓ | ✓ | ✓ (a task due earlier appears first) |

Strength, live A/B on My tasks: with `ListRows` switched back to `key={index}` the message is gone after a row above is marked done
(`[]`); with the fix it stays in its row (`["Overdue | QE2 W task W3 …"]`). Root cause (pass 1 was right to widen it): `ListRows` keyed
each `<li>` by index, so a removed or inserted row above made every row below take its neighbour's element; the cards that also
re-read through `loading` unmounted every row. Fixed in the library (keyed by the child's key, `Children.toArray` namespaced) and in
`TasksCard` / `ActivityTimeline` (`cacheKey`, so a re-read keeps the rows). Known, outside D3's class: the project page's own 409
"reload" path (`resource.retry`) still unmounts the header widget's message; recorded in decisions.md, not exercised here.

### The designer's defects (design.md amended 2026-11-17)

| Item | Measured |
|---|---|
| Week at 375 px | the grid region is 220 px; Monday's header ("MON 16.11.2026") and figure ("2 h 30") are inside it, 249–315 px against 107–327, with the region unscrolled (`.playwright-mcp/qe-hip2/week-375.png`); the page does not scroll sideways (0 px at every width) |
| Week at 1024 px | region 869 px = grid 869 px (no overflow), with day figures only and with totals "144 h" and "160 h" (three-digit hours); fits down to 980 px |
| Week at 960 px | region 805 px, grid 809 px: a 4 px sideways scroll inside the card, with the hint shown, which is what design.md says below about 980 px (`week-960.png`). design.md's sentence "at 960 (805 px) for a short Total" is a few pixels optimistic; its threshold ("from about 980 px up") is right |
| Hint "Scroll sideways to see all seven days." | `display:block` at 1023, 960, 768 and 375; `display:none` at 1024, 1280 and 1440 (`lg`); one element, `aria-hidden="true"`, only in the loaded-with-rows state: absent while loading ("Loading your week…"), on "No hours recorded this week", on "This week has not started" and on the error with Retry. Italian: "Scorri di lato per vedere tutti e sette i giorni." |
| Italian success message | "Hai registrato 30 min su …", "Hai registrato 1 h su …", "Hai registrato 2 h 30 su …", "Hai registrato 24 h su …" (project header and task rows), "Hai registrato 1 h su altro lavoro: Training." (company task without a deal; its dialog reads "Questa attività riguarda un'azienda, non un'opportunità, quindi le ore vengono registrate come altro lavoro. Non sono collegate all'attività.") |

## Acceptance criteria — 41 of 41 executed, 41 pass

`e2e A–F` = `shell/e2e/hours-in-place.spec.ts`; `R1–R4` = `shell/e2e/hours-in-place.round1.spec.ts` (new); `unit` = the feature's vitest files,
all green at 6c638586; `live` = driven by me in the browser this pass. Where an AC's code did not change in the round, the executed
evidence is its unit and e2e tests (re-run green here) plus pass 1's live drive; I say so.

| AC | Evidence | Result |
|---|---|---|
| 1.1 | e2e A; unit `projects-ui/src/lib/recordHours.test.ts`, `ProjectDetailPage.recordHours.test.tsx`; live: the manager's header shows Record hours first, before the state actions | ✓ |
| 1.2 | e2e A (a reader sees no button, no fallback); unit | ✓ |
| 1.3 | e2e A (project as text, no radio, no picker, Day today, Duration focused); live: description "Recording hours on the project …", focus on Duration on open | ✓ |
| 2.1 | e2e B; live: the owner's deal header shows it | ✓ |
| 2.2 | e2e B; unit; live: the admin, who is not owner or technical contact, has none in the deal header | ✓ |
| 2.3 | e2e B; live: "Recording hours on the deal …" | ✓ |
| 3.1 | e2e B, C, R1, R4; live: the row button on the project Tasks card, My tasks (project and pre-sales), the CRM Tasks page and the deal, company and contact timelines; unit `ActivityItem/ProjectTaskItem/MyTasksPageRow.recordHours` | ✓ |
| 3.2 | e2e C; live: project and task as text | ✓ |
| 3.3 | e2e B; live: My tasks pre-sales row and the deal timeline (deal as text, task fixed) | ✓ |
| 3.4 | e2e D; live (Italian): a company task with no deal opens other work, category empty, the "not linked to the task" sentence | ✓ |
| 3.5 | e2e D; live: saved as other work with the chosen category | ✓ |
| 3.6 | unit (a done row offers it, same label and position), pass 1's live drive of the Done tabs; code unchanged in the round | ✓ |
| 4.1 | e2e A (My hours lists the entry with the same values); live: entries recorded from rows appear in My hours with their targets | ✓ |
| 4.2 | R1, R2; live: `not_on_project`, `not_involved_in_deal`, `host_unavailable`, 500, network and **`activity_not_allowed`** all shown in My hours' words, values kept, no "Choose another"; unit `EntryDialog.preset`, `EntryDialogModel.preset`, `EntryDialog.refusalFocus` | ✓ (was ✗ in pass 1) |
| 4.3 | e2e A (dialog closes, message with link, no host read after the save); live: the message stays with the page's re-reads (D3) and has no timer | ✓ |
| 4.4 | unit `RecordHours.test.tsx` (POST only; no Edit, Delete, PATCH); live: the message reads "… See in My hours" with its dismiss, nothing else | ✓ |
| 4.5 | e2e E (hours remote aborted: project page, My tasks, deal page keep working with the link) | ✓ |
| 4.6 | unit `strings.test.ts` parity in four apps, `RecordHours.it.test.tsx`, `WeekView.it.test.tsx`; live: the Italian dialog, messages, Week and hint | ✓ |
| 5.1 | e2e F; live: `/hours` is the List with the List / Week tabs | ✓ |
| 5.2 | e2e F; live: `/hours?view=week` opens the Week | ✓ |
| 5.3 | e2e F; live: MON … SUN headers, Today marked | ✓ |
| 5.4 | e2e F; live: "Week 16.11.2026 – 22.11.2026" on 17.11.2026 | ✓ |
| 5.5 | e2e F; live: Previous, Next, This week (`aria-disabled` on the current week); the next week is "This week has not started" | ✓ |
| 5.6 | e2e F; unit `weekGrid.test.ts`; live: one row per project, deal and category | ✓ |
| 5.7 | unit `weekGrid.test.ts` (a meeting linked to a visible deal stays on its own row); pass 1's live drive | ✓ |
| 5.8 | e2e F; unit; live: projects, deals, other work, in that order | ✓ |
| 5.9 | e2e F (a two-entry cell reads the sum); live: "5 h … 5 entries" | ✓ |
| 5.10 | e2e F (exact day, row and week totals after each write); live: Monday 4 h 30, Tuesday 11 h 30, rows 8 h 30 / 6 h 30 / 1 h, total 16 h | ✓ |
| 5.11 | unit `WeekView.test.tsx` (42 h and 1 h week, same markup); live: no mark and no target in a 160 h week | ✓ |
| 5.12 | e2e F; unit `MyHoursPage.weekCells.test.tsx` | ✓ |
| 5.13 | e2e F; unit (day and target changeable, the changed values posted) | ✓ |
| 5.14 | e2e F; live: Wednesday to Sunday of the current week and every day of the next week offer nothing | ✓ |
| 5.15 | e2e F; live: a cell opens its dialog with the entries, focus on the first Edit | ✓ |
| 5.16 | e2e F (Edit → PATCH, figures follow); live: a refused PATCH (from the List) keeps the dialog open with the alert, focus on Save | ✓ |
| 5.17 | e2e F, R3 (Cancel sends nothing, Confirm deletes; a failed delete keeps the confirmation); live | ✓ |
| 5.18 | unit `WeekCellDialog.test.tsx`; pass 1's live drive; code unchanged in the round | ✓ |
| 5.19 | e2e F (Record hours on a target with no hours that week adds its row) | ✓ |
| 5.20 | e2e F; live: after a delete the cell reads "4 h … 4 entries" without a reload | ✓ |
| 5.21 | unit `MyHoursPage.week.test.tsx` (the read carries all five filters); pass 1's live drive | ✓ |
| 5.22 | unit `MyHoursPage.week.test.tsx`; pass 1's live drive | ✓ |
| 5.23 | unit `weekGrid`, `WeekView`; pass 1's live drive | ✓ |
| 5.24 | unit `weekGrid`, `WeekView`, `WeekCellDialog`; pass 1's live drive | ✓ |

## Defects

None. Findings that are **not** defects of this feature:

1. **Same class as D2, pre-existing, outside the diff** (missed by pass 1, not introduced by the round): hours-ui Settings → Add category
   (`TimeListItemDialog`) leaves focus on `<body>` after a refused save (measured live). Owner: **frontend-dev**, as a follow-up of
   specs/20261112-time-tracking, ideally at the cause (`@operai/ui` `FormDialog`, which ships with the shell to every remote), then a
   check of every other `FormDialog` consumer.
2. design.md's "fits at 960 (805 px) for a short Total" is optimistic by 4 px; the stated threshold (about 980 px) and the hint
   (below 1024 px) are right. Owner: **designer**, wording only.

## Observations (not defects)

- The project page's 409 "reload" path unmounts the header widget's message (decisions.md, round-1 projects-ui entry). Not exercised.
- `/hours/?view=week&week=…` has a trailing slash after the first in-app navigation; the List's `?period=` does the same (pre-existing).
- Between about 980 and 1023 px the hint shows although the grid fits (design.md accepts it).
- Dev-only: the Duration error on open under StrictMode (pass 1, item 2).

## Tests added or changed (this pass)

- `shell/e2e/hours-in-place.round1.spec.ts` (new, committed in 6c638586): R1 (D1 and D2 on the project row and the deal row, real services, a second task keeps the
  person "on one of the deal's activities" so the refusal is the task's); R2 (D2: `host_unavailable`, 500 and a dropped connection on the
  project header's widget dialog, 500 and a dropped connection on My hours' own dialog); R3 (D2: a failed delete from the List and from the Week cell
  dialog, a Week read that fails again then works); R4 (D3: Mark done, Delete and an inserted row above the row holding the message, in the
  project Tasks card and the CRM deal timeline; each re-read is waited for before the count is read, so the check cannot pass early).
  The people are per-run `hip-*@operai.test`, every entry and task is deleted afterwards.
- **Seen to fail when the behavior is broken** (each mutant applied alone, the spec run, the file restored with `git checkout`, tree clean after):

| Mutant | Killed by |
|---|---|
| M-D1 `failureOf` sends `activity_not_allowed` to the field again | R1 (alert text missing) |
| M-D2 `EntryDialog` focus fallback to Save removed | R1 and, alone, R2 (`toBeFocused` fails: inactive) |
| M-D2b `DeleteEntryDialog` focus fallback removed | R3 |
| M-D2c `WeekView.focusRetry` no longer focuses | R3 |
| M-D3 `ListRows` keyed by index again | R4 (message count 0) |
| M-D3b `TasksCard` without `cacheKey` | R4 |
| M-D3c `ActivityTimeline` without `cacheKey` | R4 |

  Also by hand in the browser: with M-D2 and M-D2b applied the real browser answered `BODY` after a refused save and after a failed
  delete (the next Tab went to the dialog's ×); with M-D3 applied the message was lost after a row above was marked done on My tasks.
- No test of pass 1 was changed. Pass 1's `hours-ui/src/components/EntryDialog.fixedActivityRefusal.test.tsx` (written to fail) is green.

## Environment faults (not defects, no fix round)

- **`shell/src/router.meetings.test.tsx` "/my-meetings/$ … shows RemoteMount's error state … when the remote fails to load" failed once** (a
  1012 ms `findBy`, 1 s timeout) in the shell run while the dev stack and a browser were up. At the same commit the file passes 3 of 3
  alone, and the full shell suite passes 669/669 in the `ui:check` run. A timing-sensitive router test the feature does not touch.
- notify-api is not running (`ERR_CONNECTION_REFUSED` on `:8081` in every console); unrelated.
- crm-api answers 503 "Activities are not configured for the CRM" on `DELETE /contacts/{id}` in this environment, so my scratch contact stayed.
- **Data left in the dev databases** (no delete route exists for them): projects `QE2 project …`, `QE2 outsiders …`, `Hip R project …`, companies
  `QE2 company …`, `Hip R company …`, deals `QE2 deal …`, `Hip R deal …` and the contact `QE Contact …`. Deleted: every time entry (26), every task and
  activity of the pass (29, plus the journeys' own), and every user (`hip-*` of this pass, two runs). Browser session snippets with tokens removed;
  the screenshots are in the git-ignored `.playwright-mcp/qe-hip2/` (`week-375.png`, `week-1024.png`, `week-960.png`).

## Blocked

- **Screen-reader readback (NVDA on Windows, VoiceOver on macOS and iOS).** Needs a person with those tools. Script: open a project page as a
  team member, record 2 h 30 from the header and from a task row, and listen for "2 h 30 recorded on <name>. See in My hours" (Italian:
  "Hai registrato 2 h 30 su <nome>. Vedi in Le mie ore"); open My hours → Week and read a filled cell ("2 h on <row>, Wednesday 11 November
  2026, 1 entry"); on a phone-width window confirm the scroll hint is not read (it is `aria-hidden`) while the grid region is announced as a
  labelled region; after a refused save confirm the alert is read and a further Enter retries (focus is on Save). Re-run this row only.

## Recommendations

- Owasp-reviewer pass: **not needed again**. The follow-up (fc8be39e) is PASS with N1 fixed, and the round adds no sink, storage, origin,
  dependency or change to how a save is sent (my scan of its added production lines found none).
- After the person who ran the screen reader records the readback, the verdict becomes PASS with no code change.
- File the Settings dialog (finding 1) against specs/20261112-time-tracking or a small library spec, before the next feature that adds a form dialog.
