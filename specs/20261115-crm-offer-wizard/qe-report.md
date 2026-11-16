# QE report — CRM offer wizard (specs/20261115-crm-offer-wizard, rigor production, full mode)

## QE verdict (round 11, gates + isolated-child smoke): PASS        (measured at bd5db68c, tree clean apart from the untracked WellD_OperAI_Wizard_Offerte.html)

Scope: crm-api after 1122e8b4 (M-12 form-graph fix), 3c4174b0 (letterhead and attachment PDF checks in an isolated child process) and the ADR 1b05e4f1. Nothing blocked. Logs in `SP/r11/` (SP = `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad`); smoke script `SP/r11/smoke.ts`.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| crm-api typecheck | clean | exit 0 | pass |
| crm-api full suite on crm_test, 3 runs | green each | 1804 pass / 0 fail, 3 of 3 (was 1783 in round 10: +21 tests for the child process) | pass |
| crm-api coverage | no regression | 93.56% funcs / 96.27% lines (round 10: 93.54 / 96.33); `offers/pdf.ts` 100% | pass |
| crm-ui lint / test / build | clean | lint 0; 1477 pass (72 files); build 0 | pass |
| `mise run ui:check` | exit 0 | exit 0 first run (218 + 616 + 789 + 1052 pass) | pass |
| shared copies + test | in sync | 33 groups in sync; 28 pass / 0 fail | pass |
| `seed-digests --check` | matches history | "v1Digests.ts matches the git history" | pass |
| `changeset:check` | OK | OK (`.changeset/crm-offer-wizard.md`) | pass |
| betterleaks main..HEAD | no leaks | no leaks found | pass |
| e2e trio (wizard, revise, pages) | all | 26 passed (1.8 m), 0 failed; includes T67 letterhead behind the preview, light in dark theme, issuer text alike in preview and PDF | pass |
| Smoke (second crm-api :8094 on crm_test): letterhead link + render | 200, valid 1-page PDF | GET letterhead 200, 1269 bytes, `%PDF-`, 1 page | pass |
| Smoke: real Generate carries the letterhead | letterhead on the offer | 201; offer page 1 holds the embedded letterhead page (XObject `EmbeddedPdfPage`) and its text "Fixture Letterhead SA - Via Esempio 1 - 6900 Lugano" is in the offer text | pass |
| Smoke: deal PDF attachment upload + confirm, appended as annex | 200 and annex appended | start 201, bucket POST 204, confirm 200; classic generate with `attachmentIds` 201, offer = 2 pages (offer + 1-page annex) | pass |
| Smoke: crafted letterhead uploads refused | 422, profile untouched | not a PDF -> 422 `letterhead_invalid` not_pdf; 300 MiB flate bomb (~300 KB) -> 422 decoded_too_large; two pages -> 422 page_count; stored letterhead identical afterwards and still downloadable (200) | pass |

Defects: none.

Notes on the smoke setup (not defects). The wizard preview itself in the browser is the e2e T67 above (it runs on the live dev stack and passed); the API-level letterhead and generate checks ran against a second crm-api (port 8094) on crm_test, stopped afterwards, and the dev profile and letterhead were never written (the e2e's `ensureLetterhead` only adds a missing one, as before). crm_test had no classic template (only 8 Italian wizard ones), and annex attachments exist only on the classic generate route, so I inserted one English classic template row (`qe-r11-classic-en`, entity welld_ch) into crm_test by SQL to exercise it; it stays in crm_test, with a QE-only company/deal, a letterhead (QE admin) and a 1-page attachment in the shared dev bucket under the crm keys. My first insert had a wrong cost-line shape (500 from the draft prefill); that was my fixture, the corrected row worked.
The "[pdf-check] the child ended without a verdict (exit 137/3/0/1)" lines in the coverage log are the crash-path tests logging, not failures.
Environment faults: none. The dev crm-api on :8084 stayed up and healthy throughout.

---

## Previous pass (round 10)

### QE verdict (round 10, gates only): PASS        (measured at edf23a62)

Overall feature verdict: PASS. D1, the only open defect of round 9, is closed. No ✗, nothing blocked.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| D1 closed: crm-api full suite on crm_test, repeated | green every run | 6 of 6 full runs 1783 pass / 0 fail (5 idle, 1 with crm-ui's suite running in parallel). M-11 now asserts on counted work: ratio 2.000 (26436 -> 52861 steps), repro 105711 steps | pass |
| crm-api typecheck | clean | exit 0 | pass |
| crm-api coverage | no regression | 93.54% funcs / 96.33% lines (same as round 9) | pass |
| crm-ui lint / test / build | clean | lint 0; 1477 pass (72 files), also under load; build 0 | pass |
| `mise run ui:check` | exit 0 | exit 0 on the 2nd run (218 + 616 + 789 + 1052 pass). 1st run: 1 failure in refund-ui `RequestDetailPage.test.tsx` (focus heading assertion), 3 of 3 isolated reruns 26/26 green; refund-ui untouched by this branch (F2) | pass |
| shared copies + test | in sync | 33 groups in sync; 28 pass / 0 fail | pass |
| `seed-digests --check` | matches history | "v1Digests.ts matches the git history" | pass |
| `changeset:check` | OK | OK (`.changeset/crm-offer-wizard.md`) | pass |
| betterleaks main..HEAD | no leaks | no leaks found | pass |
| e2e trio (wizard, revise, pages) | all | 26 passed (1.8 m), 0 failed | pass |
| check-letterheads read-only vs production | exit 0 | not run by me; verified by: orchestrator, 2026-11-16, welld_ch ok, exit 0 | reported |

Defects: none open. D1 root cause (round 9): the test asserted a wall-clock ratio under 3.2 on a 5 ms baseline, which GC/ordering noise in the full suite pushed over; fixed by 22c1ac1c (the walk counts its own steps and refuses above maxWork) and 66c844f1 (tests assert on counted work). Verified by repeated full runs, not one.

Observations: F1 (shell `router.meetings.test.tsx` timing flake, round 9) did not recur. F2 (new): refund-ui `RequestDetailPage` submit/focus test failed once under `ui:check` load, green in isolation 3 of 3 and in the second full run; unrelated to this branch, watch it.

Environment faults: none. Logs in `SP/r10/` (SP = `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad`).

---

## Previous pass (round 9)

### QE verdict (round 9, gates only): FAIL        (measured at 62b30b6c plus one added test file edit, committed below)

Scope: gates-only after 679b20ab, 13bb3abc, 52e4e608, d47c50c1. No browser sweep (no UI code changed). Nothing was blocked. Logs in `SP/r9/` (SP = `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad`).

| Check | Threshold | Actual | Result |
|---|---|---|---|
| crm-api typecheck | clean | exit 0 | pass |
| crm-api full suite + coverage (crm_test) | all green, every run | 1775 pass / 0 fail on 4 of 9 full runs; 1 fail on 5 of 9 (always `M-11 ... is linear`, formGraph.r7.test.ts:120). Coverage 93.54% funcs / 96.33% lines overall, `offers/pdf.ts` and `legacyContent.ts` 100% | FAIL (flaky, see D1) |
| crm-ui lint / test / build | clean | lint exit 0; 1477 pass (72 files); build ok | pass |
| `mise run ui:check` | exit 0 | exit 0 on the 2nd run (operai-ui 218, shell 616, 3 other consumers 789 + 1052 pass). First run: 1 shell test failed (`router.meetings.test.tsx` RemoteMount error state, 1 s `findBy` timeout); 3 isolated reruns 12/12 green. Shell untouched by the four commits | pass (one unrelated timing flake, F1) |
| `check-shared-copies` + its test | 33 groups in sync; 28 pass | 33 in sync; 28 pass / 0 fail | pass |
| `seed-digests --check` | matches git history | "v1Digests.ts matches the git history" | pass |
| `changeset:check` | OK | OK (`.changeset/crm-offer-wizard.md`) | pass |
| betterleaks main..HEAD | no leaks | no leaks found | pass |
| Audit vs main | no critical | crm-api: none (166 pkgs). crm-ui: 0 critical, 4 moderate + 5 high, all transitive `undici`/`zod`, not from this branch's one added dependency (`pdfjs-dist`) | pass |
| e2e trio | all | 26 passed (1.8 m), 0 failed | pass |
| Removal of the 018 renderer breaks no reader of stored 018 offers | none | `renderOfferPdf`/`displayDate` have zero remaining references; `OfferSnapshot` is now a type only (generation.ts `StoredSnapshot`, wizardGuards test). Download (`offers.routes.ts:519`) mints a presigned GET on the stored `objectKey` and reads only `snapshot.reference` for the file name: the PDF is never re-rendered. New test below proves list + download of a summary-kind row | pass |

### Defects

D1 (test instability, new since 679b20ab; not a missed earlier one). `crm-api/src/entity-profiles/formGraph.r7.test.ts` "M-11 ... is linear" asserts a time ratio < 3.2 (5 ms vs ~15 ms). In the full suite it fails on most runs at HEAD (ratios 3.77, 3.86, 3.83, 3.91; green at 2.25, 2.30). Alone it is 1.26 to 1.45 in 6 of 6 runs. With `formGraph.ts` put back to its pre-679b20ab version (the file only, tree otherwise identical) three full runs gave ratios 1.91, 2.09, 2.37, all under the threshold (the only failures were the 3 new r8 cap tests, expected without the cap). So either the memo cap makes the large input measurably slower in-suite or the new r8 test file changes GC/ordering for it; I did not tell which. I did not lower the threshold or skip the test. Owner action: measure the cap's cost on the large case, or make the check robust (best of N, a larger floor than 5 ms) without weakening the linearity claim. Repro: `sh w29.sh bun test --coverage` in crm-api, repeat 3 times, grep `M-11 scaling`.

### Observations

F1: `shell/src/router.meetings.test.tsx` "shows RemoteMount's error state" timed out once at 1 s under the `ui:check` load, 0 in 3 isolated reruns and the second full `ui:check`. Pre-existing, unrelated to this branch's four commits. Not filed as a defect; watch it.

Environment faults: none. I restored `formGraph.ts` to HEAD after the comparison (`git status` shows only my test edit).

Tests I added: `crm-api/src/offers/offers.wizardGuards.test.ts` — "a stored 018 summary-kind offer survives the removal of its renderer": a summary-snapshot row is listed and its download returns 200 with a presigned URL on its stored object key. 9 pass in that file.

OWASP re-review: not needed for the gates; 679b20ab is the L-10 hardening already reviewed.

---


History: r1 FAIL D1–D5 · r2 FAIL D6–D8 · r3 FAIL D9–D11 · r4 FAIL D14–D18 · r5 FAIL D21–D24 · r6 FAIL F1–F5 · r7 BLOCKED on B5 only · r8 (this section: B5 re-run, plus the e2e trio). The round-7 and round-6 reports are kept unchanged below. Scratchpad paths are relative to `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad/` (written SP/).

## QE verdict (round 8): PASS        (code measured at e2588823; `git diff 13bb3679..HEAD` touches docs, run traces and ADR text only, so the round-7 gate numbers hold for this commit)

Nothing was blocked this round. The owner's change worked: estimai-api now delivers its notice (CRM_INTERNAL_URL set, scope `estimate-notices.send` granted, restarted; the stack process tree started 22:05:21). I restarted nothing. The only row that was open, B4/B5 (estimate-ready states), is executed and green. Every other row is carried from round 7 (same code: no `crm-api`, `crm-ui`, `shell` or `operai-ui` file differs between 13bb3679 and HEAD).

| # | Check | Threshold | Actual | Result |
|---|---|---|---|---|
| B5-1 | Estimate notice delivered | CRM deal turns `ready` after the estimate is closed in EstimAI | `SP/r6/ex/n.ts`: request estimate for a fresh deal, PUT 200, close 200, CRM `estimate.state` = `ready` within the first poll (round 7: stuck at `requested`). A second and a third deal in the new drivers: also `ready`, `readyAt` set | pass |
| B5-2 | Annexes step with a ready estimate (AC-2.x) | effort + AI-assisted controls enabled, effect on the preview, persistence | `n.ts`: effort checkbox enabled at 1280 and 360 collapsed, light and dark, no hscroll, axe clean. `b5c.ts` (SP/r6/b5c-all.log, 107 OK, 0 FAIL): effort and AI checkboxes both enabled; effort on: preview prints "ALLEGATO A – DETTAGLIO DELL’IMPEGNO" with 26,8 total and no AI note; AI on: annex shows the AI note and 17,7 total (15,1 / 2,7 per release), Giorni 18; both checkboxes and the figure survive a reload (persisted server-side before each navigation). AI off: Giorni back to 27 | pass |
| B5-3 | Estimate-prefilled fields (deal, epics, phases, timeline, manDays) | prefilled once from the estimate, editable, refreshed by the AI switch only where untouched | API and UI agree: PROGETTO = deal title, EPICI `1. Frontend\n2. Backend`, FASI `- Release 1: Frontend, Backend\n- Release 2: Backend`, TEMPI table `Release 1 | 0 - 1`, `Release 2 | 0`, GIORNI `27` (hand check of the estimate: expected 9,17 + 12,33 + 5,33 = 26,83, AI 17,72, both rounded as shown). Refresh: AI on moves an untouched GIORNI 27 to 18; a GIORNI the person edited to 40 keeps 40 while AI is on; AI off restores 27 (`SP/r6/b5a.log`, `b5c-all.log`) | pass |
| B5-4 | Estimate-bound cost lines (`perRelease`, `deal`, `qty=manDays`) | one card per release, split by man-days, editable description, totals right | `perRelease`: 2 cards "Release 1" / "Release 2", unit 40062.00 and 9938.00 (deal 5 000 000 cents split 21,5 : 5,3 man-days, last takes the remainder, sum 50 000), `deal` line 50000.00, `qty=manDays` line 27 x 1 000 = 27’000, TOTALE 127’000. Editing a release description ("Fase uno QE") reaches the preview and the generated PDF. AI on: the untouched man-days line follows to 18 (18’000, table 118’000) while the edited field stays 40 | pass |
| B5-5 | Effort-detail annex in a real generated PDF | text read from the PDF | Real Generate from the UI (1280 light, AI on, GIORNI edited to 40): offer 0145/2026, pdf.js text: "INDICE" lists the annex (page 3), contract and costs 1/3 (Giorni: 40, Fase uno QE 40’062, Giornate 18’000, TOTALE 118’000), acceptance and "Allegati: Allegato A - Dettaglio dell’impegno" 2/3, "ALLEGATO A – DETTAGLIO DELL’IMPEGNO", "L’impegno considera uno sviluppo assistito da AI.", Totale 17,7, 3/3. API-generated, AI off: Totale 26,8 and no AI note. The preview and the PDF carry the same texts, rows and figures (AC-3.2) | pass |
| B5-6 | Paginated preview: the effort annex starts a new page | annex heading first on its own page, every page "N/M" | measured on the drawn text (Range rects) against the page frames, 1280 and 1024 x light and dark: 1280 = 3 pages ("1/3".."3/3"), heading on page 3 at offset 91 px (page 2 ends after the acceptance block and the annex list, leaving blank space, as designed); 1024 = 4 pages, heading on page 4. Stage screenshot read: letterhead on each page, annex alone on page 3 (SP/r6shots/B5-stage.png). The preview breaks the costs table one row earlier than the PDF does (Progetto and TOTALE on preview page 2, page 1 in the PDF): the documented approximate-pagination rule (AC-3.2, AC-11.11), not a defect | pass |
| B5-7 | Light/dark at 1280 and 1024 | all four, axe clean, no horizontal scroll, preview 1024 through the Preview dialog | `b5c.ts` 1280 light 30 OK, 1280 dark 26, 1024 light 25, 1024 dark 26; 15 axe runs (scope, costs, annexes, preview), 0 violations; no hscroll in any. Screenshots read: `r6shots/B5-w1024-dark-annexes-ai.png`, `B5-w1280-dark-costs.png` | pass |
| E1 | e2e trio (the caller's command) | all | 26 passed (1.8 m), 0 failed, 0 skipped. `SP/r6/e2e8.log`. The round-7 flake (AC-11.5 screenshot compare) did not recur | pass |
| G | Code gates (tsc, bun test, coverage, lint, build, ui:check, shared copies, digests, changeset, secret scan, audit) | as round 7 | not re-run: the tree differs from the round-7 measurement only in docs, traces and ADR text. Round-7 numbers stand: crm-api 1758 pass / 0 fail, coverage per file as r7 (r6 95.74% lines), crm-ui 1477 pass, lint and build clean, `ui:check` exit 0, 33 shared-copy groups in sync, digests match, changeset present, betterleaks clean, no critical CVE | pass (carried, same code) |
| C1 | AC coverage (79 ACs) | each has an executed test | unchanged since r6; AC-2.3, AC-2.4's ready branch and AC-9.5's effort-annex lettering/page rule are now also executed against a real ready estimate | pass |

### Defects

None. One non-defect observation recorded so nobody files it later: the AI-assisted checkbox is enabled independently of the effort-detail checkbox (it is only disabled when there is no ready estimate), although the design draws it nested under the effort card. The design text names the disabled condition as "no ready estimate" only, so this is conformant; ticking AI with the effort annex off still moves the untouched man-days fields and cost line, and the annex note appears only when the annex is on.

Carried, not re-opened: G1 (pre-existing, Info: company/deal/contact dialogs do not move focus to a server-refused field), H1 (AC-11.5 byte-compare flake, 1 in about 10 earlier runs, 0 in this one), F4/F5 (owner-accepted render-cost residual), and the pre-existing items listed in rounds 5/6.

Environment faults: none. Housekeeping: the QE templates this round created ("QE8 …") are archived; the entity again lists only the seven seeded wizard templates. The deals and offers created (0141 to 0145/2026) stay, as in earlier rounds.

Tests I added: none to the tree (drivers `SP/r6/ex/b5setup.ts`, `b5a.ts`, `b5c.ts`, `b5d.ts`, `n.ts`; none of the checks needed a new regression test because the e2e trio and unit suites already cover the code paths and the only inputs I added were an estimate and a template).

owasp-reviewer: no further pass recommended by this round (no code change); security round 8 stands.

---

History: r1 (527f262d) FAIL D1–D5 · r2 (cce55bac) FAIL D6–D8 · r3 (778b09e4) FAIL D9–D11 · r4 (a74ba145) FAIL D14–D18, B5 blocked · r5 (69c02f24) FAIL D21–D24, B5 blocked · r6 (ef66ee57) FAIL F1–F5, B5 blocked · r7 (this section, verification of r6 plus regression). This file is the latest pass; the round-6 report is kept unchanged below the line; older rounds are in git history. Scratchpad paths below are relative to `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad/` (written SP/).

## QE verdict (round 7): BLOCKED        (measured at 13bb3679; b5345b9e was HEAD when I started, the only commit in between is docs-only: `git diff b5345b9e..13bb3679 --stat` = security-review.md)

**Blocked, named first.** B5 (estimate-ready states: Annexes effort detail / AI figures, `deal`/`manDays`/`perRelease` bound cost lines, effort annex in preview and PDF) is STILL BLOCKED, for the sixth round. Executed: `SP/r6/ex/n.ts` requested an estimate for a fresh deal, filled 3 activities, closed it (PUT 200, close 200); the CRM kept `state:"requested", readyAt:null` (re-read over several minutes with `SP/r7q/st.ts cmwi9vzm6000cmeveo0za2smb`), then `POST offer-draft` answered 409 `estimate_not_ready`. So estimai-api's notice still does not reach crm-api `POST /system/estimate-notices`. The estimai-api process is still the one started at 20:54:25. Unblock steps (not by QE: I may not restart processes or read dotenv files): (1) set `CRM_INTERNAL_URL=http://localhost:8084` in estimai-api's dev environment; (2) confirm auth's `SERVICE_CLIENTS` entry for `estimai-api` carries the scope `estimate-notices.send`; (3) restart estimai-api; (4) re-dispatch QE for this one row with driver `SP/r6/ex/n.ts` (then the annexes/costs states and the PDF effort annex).

No ✗ in any other row. One unexecuted row makes this BLOCKED, not PASS.

| # | Check | Threshold | Actual | Result |
|---|---|---|---|---|
| F1 | crm-ui flaky test `OfferTemplates.test.tsx` "refuses a non-PDF or a file over 5 MiB before any request" | no flake: full suite 4x, test alone 20x | the test now asserts that no upload request (any non-GET, any `/letterhead` call) was made, not the total call count. Full suite 4/4 green with crm-api's 1758-test suite running concurrently; the test alone 20/20 under 8 busy loops; under 24 busy loops (load average 15 on 18 cores) the full suite 2/2 and the whole file 10/10. Logs `SP/r7q/ui4.log`, `single20.log` | pass (F1 closed) |
| F2 | NUL 422 reads as localized UI copy, at the field, announced when it names none | en AND it, 1280 light + 360 collapsed dark | Settings entity profile: 7 form fields + 2 unowned keys x 2 locales x 2 viewports, 188 checks, 0 fail (`f2a.log`): focus on the field from the Save button, `aria-invalid`, described by "This text contains a character that cannot be saved." / "Questo testo contiene un carattere che non può essere salvato.", field in view, no raw text; a field the form does not own (`letterheadKey`, `someOther`): banner `role=alert` in view with focus, same sentence, axe clean. Wizard template editor (real server): name -> at the Name field, source -> at the text area (tall at 360 px: the error line below it is visible, focus on it). Classic template editor (PUT intercepted, the dev template untouched): name, salutation, opening, acceptance label at their fields with focus; an unmappable key (`sections.0.heading`) -> announced banner in view with our sentence (focus stays on the page body: announced, not focused; accepted, the banner is beside Save). Wizard answer (real server, NUL typed into "Project subject"): banner "This change could not be saved: The answer “Project subject” contains a character that cannot be saved." / it "Questa modifica non è stata salvata: La risposta «Project subject» contiene un carattere che non può essere salvato.", role alert, in view, no path or server line; valid text then saves and the banner clears. Company, deal and contact dialogs (real server): our sentence at the Name / Title / First name field, `aria-invalid`, no raw text, axe clean. Normal text still saves: company name "QE7 Café 🙂 — « ü »<tab>…" created, wizard template with accents/emoji/tab and a CRLF source created, wizard answer "Café 🙂 — « ü »<tab>Tab" stored in the draft, the Settings profile text sent unchanged (interception; the owner's profile was never written). Logs `f2a.log f2b.log f2c.log` | pass for the copy and the placements named (F2 closed); see G1 |
| F3 | M-10/M-11 probes through `checkLetterhead`: fast refusal, no event-loop block | no block | `contents_50/100/200.pdf` (one stream repeated in `/Contents`): `too_complex` in 14/8/6 ms, loop lag <= 1 ms, RSS 53 MB; `worst_1000_1000`, `worst_4000_4000`: refused in 2–4 ms; `worst2_10000_5000`, `worst2_20000_5000`: refused in 21/31 ms (r6: 4.0 s, 7.4 s); `worst2_100000_1900` (r6: 40.4 s): 258 ms, max loop lag 39 ms, RSS 251 MB, ACCEPTED (linear now; how fast the browser draws it is the accepted F4 class, not measured). Driver `SP/r7q/lag.ts` | pass (F3 closed) |
| F4 | M-8/M-9 render-cost residual | owner-accepted | OWNER DECISION 2026-11-15 (decisions.md; the caller states the owner confirmed it in the orchestrator conversation): accepted until the letterhead configurator retires uploaded PDFs. Not a defect | accepted |
| G-1 | crm-api `tsc --noEmit` (crm_test, w29.sh) | 0 errors | 0 | pass |
| G-2 | crm-api `bun test --coverage` on crm_test | 0 fail | 1758 pass / 0 fail, 88 files (a second run without coverage, concurrent with the UI runs: 1758/0) | pass |
| G-3 | crm-api coverage | >=80% | per-file table unchanged in kind from r6 (95.74% lines then); `src/offers/pdf.ts` shows 18% in that table as in r6 (its tests run in a separate pass) | pass |
| G-4 | crm-ui `pnpm lint` | clean | clean | pass |
| G-5 | crm-ui `pnpm test` | 0 fail | 1477 pass x 8 runs, 72 files | pass |
| G-6 | crm-ui `pnpm build` | green | green (chunk-size warning only) | pass |
| G-7 | `mise run ui:check` | green | exit 0: library 218, shell 616, refund-ui 789, meetings-ui 1052 | pass |
| G-8 | `check-shared-copies.ts` | in sync | 33 groups in sync | pass |
| G-9 | `seed-digests.ts --check` | matches | exit 0 (T1+T3 a385cf2a8688, T5 393fab739f24, T6 8b794eee9e9d) | pass |
| G-10 | `check-changeset.mjs` | present | OK `.changeset/crm-offer-wizard.md` | pass |
| G-11 | secret scan `betterleaks git --log-opts main..HEAD` (security floor) | 0 | no leaks found | pass |
| G-12 | dependency audit (security floor, critical CVE) | no critical, nothing new | crm-ui `pnpm audit --prod` 9 (5 high, 4 moderate: zod + undici, the r5/r6 set); no `package.json` or lockfile change since ef66ee57 (`git diff ef66ee57..HEAD -- '*package.json' '*lock*'` empty); crm-api `bun audit --prod` 6 (1 high, 4 moderate, 1 low), `bun.lock` identical to main. No critical | pass |
| E1 | e2e wizard + revise + pages (the caller's command) | all | run 1: 21 passed, 1 FAILED, 4 not run (serial): `crm-offer-wizard-pages.spec.ts:692` "the dark theme keeps every page … (AC-11.5)", "page 1 looks the same in both themes" (byte compare of two screenshots). NOT reproduced: the same command again 26/26 (1.8 m); that test alone 4/4; the whole pages spec 3 times under 24 busy loops 12/12 each. During run 1 I was running betterleaks, `seed-digests` and the audits in parallel, which I should not have. 1 failure in about 9 observations of the spec; cause not isolated | pass with one unreproduced flake (H1) |
| C1 | AC coverage (79 ACs) | each has an executed test | unchanged since r6 (`SP/r6/ac-map.txt`): the diff 4511b83e..HEAD touches no AC behaviour; the new tests are F1/F2/M-10/M-11 | pass |
| B1 | Smoke: D20 independent scroll panes | `<main>` never scrolls: long and minimal draft x 7 steps x 1440x900, 1280x800, 1920x1080, 1280x640 | `d20.ts` 12 OK, 0 FAIL (wheel over the header leaves main at 0; over the form only the form moves; over the preview only the preview, pages stay 30; 60 Tabs never move main, 0 offscreen focus stops) | pass |
| B2 | Smoke: preview pages, "N/M", letterhead states, light and dark | every page numbered | `o4.ts` 74 OK, 0 FAIL (1440/1024/360 collapsed x light/dark x shown/none/failed/unusable) | pass |
| B3 | Smoke: a real Generate | offer made, PDF prints the profile issuer | UI at 1440 (issuer template, preview 1 page "1/1", axe clean at 1280 and 1440, no horizontal scroll, `<main>` 0 overflow): POST generate 201, one offer 0140/2026, the PDF prints the profile's legal name and address as the preview does, "1/1"; my temporary templates archived (0 active QE7 templates left). The dark pass of this driver died on my own script (the draft is consumed by Generate), dark is covered by `o4.ts` | pass |
| B4 | Estimate-ready states (B5 of earlier rounds) | walked | not run | BLOCKED |

### Defects

None blocking. For the record:

**G1 — Info, PRE-EXISTING (not introduced by this branch; I do not count it as a ✗): the company, deal and contact dialogs do not move focus or scroll to a field the server refuses.** Placements: company dialog ✗ (after Create company the focus is `<body>`; at 1280x900 the Name field with the error is 214 px above the viewport, so the person sees nothing change), deal dialog ✗ (focus on body, field in view), contact dialog ✗ (same), Settings profile ✓, wizard template editor ✓, classic template editor ✓. It is identical for every server field refusal the dialogs already handled before this work: reproduced with an ordinary duplicate company name (`company_name_taken`: focus BODY, field at -214), `SP/r7q/g1.ts`. The NUL fix inherits it; the copy is right and the field is marked (`aria-invalid`, described by the sentence). Missed earlier: in r6 I scored the company dialog "at the field ~" without checking focus and scroll. Suggest a follow-up calling `focusFirstInvalid` in the three dialogs' server-refusal branches (their client-side branch already does); owner: frontend dev. Screenshot `SP/r6shots/F2b-en-w1280-company.png` (the form scrolled to the Create button, the Name field out of sight).

**H1 — Info: the AC-11.5 e2e is a byte-exact screenshot compare; it failed once and passed 10 of 10 reruns, including under load.** Not new to this round's changes (the test is from r6, which ran it 26/26 twice). Not lowered, not skipped; if it recurs, look at what differs on page 1 (the letterhead and the N/M layer).

Environment faults: none (I restarted nothing; the dev stack ran from 20:54:25 throughout).

Unchanged and not re-opened: the preview-render residual F4/F5 (owner-accepted); the pre-existing items listed in round 5/6 (OffersCard Actions clipped at 1024/360, /crm/pipeline label-in-name, the shell's 360 px sidebar toggle label, footer contrast).

Tests I added: none (the dev's F1/F2 and M-10/M-11 tests are in the tree; my checks are scratchpad drivers under `SP/r7q/` and `SP/r6/ex/`).

owasp-reviewer: no new pass recommended by this round (the only input-handling change is the NUL refusal copy; security round 8 is already recorded).

---

# Round 6 (ef66ee57), kept for history


History: r1 (527f262d) FAIL D1–D5 · r2 (cce55bac) FAIL D6–D8 · r3 (778b09e4) FAIL D9–D11 · r4 (a74ba145) FAIL D14–D18, B5 blocked (D12, D13 owner-found, fixed) · r5 (69c02f24) FAIL D21–D24, B5 blocked (D19, D20 owner-found). This file is the latest pass (round 6, a fresh full sweep); earlier rounds are in git history.

## Round 6 verdict: FAIL        (code gates and browser rows measured at ef66ee57; HEAD moved to 17822636 during the pass by two docs-only commits, `git diff ef66ee57..HEAD --stat` = decisions.md + security-review.md only)

**Blocked, named first.** B5 (estimate-ready states: Annexes effort detail / AI figures, `deal`/`manDays`/`perRelease` bound cost lines, effort annex in preview and PDF) is STILL BLOCKED. Executed this round: `scratchpad/r6/ex/n.ts` requests an estimate for a fresh deal, fills 3 activities, closes it (PUT 200, close 200), polls 10 s: the CRM keeps `estimate.state = requested`, then `POST offer-draft` answers 409 `estimate_not_ready`. So estimai-api still does not deliver its notice to crm-api `POST /system/estimate-notices` (I may not read `.env` files: a hook blocks it, so I did not confirm `CRM_INTERNAL_URL` by reading it; the behaviour is the evidence). Unblock: set `CRM_INTERNAL_URL=http://localhost:8084` in estimai-api's dev env, make sure its `SERVICE_CLIENTS` entry in auth carries the scope `estimate-notices.send`, restart estimai-api (not by QE), then re-dispatch QE for this one row; driver: `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad/r6/ex/n.ts`.

Environment fault, named first: the dev stack was restarted by someone else at 20:54:25 while the browser drivers ran (`ps` start times of the `mise run dev` tree). Seen as one `ERR_CONNECTION_REFUSED`/`ERR_INCOMPLETE_CHUNKED_ENCODING` in S17 and one `GET /pipeline` 500 in S13 (12 retries afterwards: 200 in 1–7 ms; pipeline code is untouched by this branch). No process was restarted by me. The documented `--hot` Generate socket drop did not occur; two real Generate runs (API + UI) succeeded.

| # | Check | Threshold | Actual | Result |
|---|---|---|---|---|
| G1 | crm-api `tsc --noEmit` (crm_test wrapper w29.sh) | 0 errors | 0 | pass |
| G2 | crm-api `bun test --coverage` on crm_test | 0 fail | 1747 pass / 0 fail, 87 files | pass |
| G3 | crm-api coverage | >=80% | 95.74% lines, 92.73% funcs | pass |
| G4 | crm-ui `pnpm lint` | clean | clean | pass |
| G5 | crm-ui `pnpm test` | 0 fail | 1454 pass x 2 clean runs; ONE run of 4 failed 1 test (`OfferTemplates.test.tsx` "refuses a non-PDF or a file over 5 MiB before any request", expected 4 to be 2) while the backend suite ran in parallel; passes 3/3 in isolation. Test race on `apiFetch.mock.calls.length` captured before Settings' own queries settle; the test is on main (commit bc428e8a), not new (F1) | pass (flake noted) |
| G6 | crm-ui `pnpm build` | green | green (chunk-size warning only) | pass |
| G7 | crm-ui wizard coverage (engine, wizard components, letterhead) | >=80% | 95.5% lines, 93.11% stmts, 85.7% branches (lowest derivedValue.ts 69.56% lines, engine answers.ts 79.23%) | pass |
| G8 | `mise run ui:check` | green | exit 0: library 218, shell 616, refund-ui 789, meetings-ui 1052 | pass |
| G9 | `check-shared-copies.ts` + its test | in sync | 33 groups in sync; 28/28 tests | pass |
| G10 | `seed-digests.ts --check` | matches | exit 0 (T1+T3, T5, T6 digests unchanged) | pass |
| G11 | `changeset:check` | present | OK `.changeset/crm-offer-wizard.md` | pass |
| G12 | secret scan (security floor) | 0 new | `betterleaks git --log-opts main..HEAD`: no leaks | pass |
| G13 | dependency audit (security floor, critical CVE) | no new / no critical | crm-ui `pnpm audit --prod` 9 (5 high, 4 moderate: undici via better-auth>vitest>jsdom, zod via better-auth) = the identical set as r5/main, none introduced; no package.json or lockfile change since r5 (`git diff c2abbe24..HEAD -- '*package.json' '*lock*'` empty); pdfjs-dist 6.4.299 has none. crm-api `bun audit --prod` 6 (1 high, 4 moderate, 1 low), `bun.lock` identical to main. No critical | pass |
| E1 | e2e wizard + revise + pages, run twice | all | 26/26 and 26/26 (1.7 m each); r5 had 22, the +4 are the D20/D21/D24/OA-4 journeys | pass |
| C1 | AC coverage (79 ACs) | each has an executed test | every one of the 79 is referenced by at least one test file that passes (api/ui/e2e counts in `scratchpad/r6/ac-map.txt`); OA-4 corner pinned by an e2e pixel check and my numeric comparison against a real PDF (below) | pass |
| C2 | AC-12.2/12.3/12.9/12.10 in a REAL PDF | profile name + address | real Generate through the UI (issuer template): offer 0127/2026, PDF "Supplier line: wellD SA, Via Example 1, 6900 Lugano" = preview text; "WellD Sagl / Via Pessina" appear only in the letterhead's own artwork text | pass |
| C3 | OA-4 corner vs the real PDF | same place as the PDF | PDF (pdf.js text positions): own "1/1" right edge 72.0 pt from the page edge, baseline 35.5 pt; preview number right inset 72.83 pt, bottom 35.3 pt (font differs: DM Sans 8.6 pt wide vs Helvetica 11.8 pt, so ~0.8 pt on the right edge) | pass |
| B1 | Exploratory UI, every state, 360/1024/1100/1280/1440/1920 (+320, root 32, 200% proxy), light+dark | all walked | walked; defect F2 (copy of the NUL 422); everything else below | ✗ |
| B2 | D20 independent scroll panes: `<main>` never scrolls | overflow 0 on all 7 steps | long and minimal draft x 7 steps x 1440x900, 1280x800, 1920x1080: 0 overflow, wheel over header leaves main at 0; below the 40rem floor (1280x640) main scrolls 97 px as designed; wheel over the form moves only the form (0 to 375/375), over the preview only the preview (0 to 12 000/22 691, pages stay 30), 60 Tabs never move main, 0 offscreen focus stops; 1100 px Drawer page scrolls as before | pass |
| B3 | D21 re-verified at r5's exact placements (Scope 174/310 px, Costs 747/903/547 px) | 0 | 0 at every step and size above | pass |
| B4 | D22 label in name, class sweep | every button/link/tab with visible text | EN and IT x 1280 and 360 collapsed x 7 steps on the long (hand-edited) draft: 46 controls per step set, every `aria-label` contains its visible text, "Restore wizard text" and "Copy text written for X" included; axe on the Preview step with the hand-edited row: 0 violations (all four combinations). One outside-class hit: the shell's sidebar toggle (visible "Collapse", label "expand sidebar" at 360 collapsed); shell code is untouched by this branch (pre-existing) | pass |
| B5 | Estimate-present states | walked | not run | BLOCKED |
| B6 | D24 sub-pixel frame drift at 320 px | 0 | P1 sweep, 30 checks at w320c (7 widths x 2 themes + root font 32 + 200% proxy: 218 checks, 0 violations); e2e 320 px journey green | pass |
| B7 | L-9 page cap | one sheet + notice | 320 px root 32 and 360 px root 24: pages=1, notice "This preview is too long to lay out as pages, so it is shown as one continuous sheet. The PDF is the authority.", all 58 898 characters present, axe clean, no hscroll; 1440 px: 30 pages no notice | pass |
| B8 | OA-4 page numbers "N/M" + corner cover in the preview | every page, every letterhead state | 1440/1024/360(collapsed) x light/dark x shown, none, failed, unusable: 74 checks, 0 fail: "N/M" on every page with M = `data-pages`; cover boxes on exactly the shown state, absent otherwise; the number lies inside the page and inside the cover; the layer is inert + aria-hidden and the number is not in the reading flow; contrast 8.35 to 8.5:1; axe clean. At 360 px the number renders at 4 px (decorative, recorded default, info I1) | pass |
| B9 | Letterhead four states + unusable, 3 widths x 2 themes, exact copy | exact | S6/S11 drivers: all texts exact, unusable blocks Generate with the reason, Try view with profile 403/503/none OK | pass |
| B10 | Settings letterhead card: refusals and acceptance | right copy; a normal letterhead accepted | UI (interception, owner profile untouched): 409 unusable banner + Replace; confirm 422 too_complex / decoded_too_large / image_too_large / unbounded_stream / page_count / no reason and 409 upload_missing all show the right copy. Acceptance end to end on a second crm-api (:8094 on crm_test, started and stopped by me): the repo's `letterhead-a4.pdf`, a normal text+rule+logo page, 40 and 100 `sh` (0.2 and 0.5 s to draw), 3000 beziers and 2000 dashed strokes ACCEPTED (200); 1000 and 10 000 `sh`, 300 000 glyphs, 560 000 strokes refused 422 `too_complex`. Read-only `check-letterheads.ts` on the dev DB: welld_ch `ok decodedBytes=6261978 objects=40 imagePixels=2469600` | pass |
| B11 | D23 render-cost (D23 itself) | bounded | D23's placement (shading fills 1 000 and 10 000, with and without a gs state) refused; accepted worst cases I measured draw in <= 0.7 s. The CLASS is not closed: F4, F5 | ✗ (F4, F5) |
| B12 | pdf.js `annotationMode: DISABLE` | no annotations drawn | `max_annot_sh.pdf` (security round 7) renders in 100 ms, no long task | pass |
| B13 | Round-6 NUL refine: normal text still accepted | accents, emoji, CRLF, tab OK; NUL 422 names the field | API (crm_test): profile legal name "Via Nosée 1 — « ü »", multi-line terms, company "Café 🙂 \r\nSA" + CRLF notes accepted; NUL in legal name, address line, company name, deal title, template source, wizard answer -> 422 naming the field. UI: Settings profile sends the typed text unchanged (accents, emoji; interception) and shows the 422; company dialog and template editor show it. Presentation: F2 | ✗ (F2) |
| B14 | Keyboard-only walk, tablist, focus | per design | h.ts: tab stops with visible focus, one stop in the tablist, arrows/Home/End, focus to the panel heading | pass |
| B15 | axe wcag2a/aa/21 (shell footer excluded) | 0 | ~120 runs over steps, bands, dialogs, Settings, editor, Try view, hand-edited row, NUL error states, 1440 preview with page numbers: 0 | pass |
| B16 | Console + network | no CORS from the real crm-api, no unexpected 5xx | 0 CORS errors; every 4xx/5xx is an interception, the documented `GET offer-draft` 404, or the environment restart above; meetings-api 500s of r5 did not recur | pass |
| B17 | Costs: percent, validity, date mode (D12/D13/D14) | no 4xx, sticks, blocks | S9/S9p: validity ''/4a5/0/-1/366/21 digits/4.5 each flagged invalid, no 4xx PUT, 45 survives reload; percent flows OK | pass |
| B18 | Security floor | none open | secret scan, critical-CVE audit pass. Open mediums M-10/M-11 (availability) are F3; the render-cost residual is F4/F5 | see F3-F5 |

## Defects (all listed before any is fixed; by class, with placements)

**F1 — Flaky unit test (pre-existing on main, not introduced here). Low. Owner: frontend dev.** `crm-ui/src/pages/OfferTemplates.test.tsx:158` ("refuses a non-PDF or a file over 5 MiB before any request"): `const calls = apiFetch.mock.calls.length` is read right after the letterhead card appears, but the page's other queries are still being issued, so under CPU load the later count is higher (got 4, expected 2). 1 failure in 4 full-suite runs, 0 in 3 isolated runs. A fix is to wait for the page's requests to settle (or assert that no call to the letterhead endpoints was made) instead of counting all calls.

**F2 — The new NUL 422 reads as a raw API message, not as UI copy (the owner asked that it show nicely). Low. Owner: frontend dev (copy + placement). NEW with the round-6 backend fix.** The text shown is the server's `detail` verbatim: "legalName: Not text: contains a NUL character" / "addressLines.0: …" / "name: …" / "source: Must not contain a NUL character": an internal field key, English only (I did not render it in the Italian locale; by construction the string comes from the server). Placements: (a) Settings entity profile: the banner sits at the top of the card (measured y = -328 of a 900 px viewport after clicking Save at the bottom), focus stays on Save, so the person sees nothing change; a screen reader gets the alert ✗; (b) CRM company dialog: shown under the Name field as "name: Not text: …" (at the field, raw prefix) ~; (c) offer template editor: alert "source: Must not contain a NUL character" (raw) ✗; (d) wizard answer: the draft banner says "Some answers are not valid, so the draft was not saved." with no field named ✗. Not walked: contact form, deal form (same server shape). The generic pattern (banner = server detail) pre-exists; what is new is that a user can now hit it with ordinary pasted text. Normal text is unaffected (B13).

**F3 — Backend availability: M-10 and M-11 of security round 7 are open in the tree I tested (fix "now" per decisions.md). Medium. Owner: backend dev.** M-11 reproduced by me: `checkLetterhead` on the security probe `worst2_100000_1900.pdf` blocks the calling process for **40.4 s** (`worst2_20000_5000` 7.4 s, `worst2_10000_5000` 4.0 s; `scratchpad/r6/v7.log`), and that is the crm-api event loop, single replica, so one `deal:manage` upload stalls the whole CRM API. M-10 (`/Contents` array repeating one stream, 1.9 GB per the reviewer) I did not run: it would exhaust memory of the machine's services. Placements: `POST /entity-profiles/{entity}/letterhead/confirm` and the first use of a letterhead in generate. Re-verify after the fix with `scratchpad/r7/pdfs/worst2_*` and `contents_*`.

**F4 — D23 class still bypassed: the preview draws a different thing than the check measures (M-8) and the cost model prices operators, not geometry (M-9). Medium (insider, `deal:manage` uploader, preview tab freeze only). Owner: recorded in decisions.md as an OWNER decision of 2026-11-15 to accept the residual until the letterhead configurator retires uploaded PDFs — I did not receive or verify that decision myself; it is a document I read.** My independent reproduction: `m9dash30.pdf` (1 296 bytes, 30 dashed strokes `[0.05 0.05] 0 d`) is ACCEPTED by `checkLetterhead` and freezes the preview's main thread 3.4 s (the reviewer measured 5.7 s at 50 and no answer in 60 s at 1 000 strokes); the reviewer's `sh3000_hidden.pdf` (3 000 `sh` behind a premature `EI`), `clip_star.pdf`, `ps_many.pdf` are also accepted. D23's own report (shading operators) is closed at its placements, see "Earlier defects".

**F5 — Info on F4: weights were calibrated on one machine (security I-13).** Not a separate defect; recorded so it is not lost.

Info, not counted: (I1) the OA-4 page number is 4 px high at 360 px (it scales like the PDF's, aria-hidden, decorative; contrast is 8.4:1) — by the recorded default. (I2) The Missing list still shows the raw key INDIRIZZO_CLIENTE for the seeded SLA templates (r5 info 3, OWNER REVIEW, a Settings edit). (I3) A hostile `⟦y⟧` in an issuer name prints `?y?` in preview and PDF (WinAnsi fold); the S6 driver's "hostile printed literally" check fails on exactly that and nothing else (r5 info 1). (I4) The SLA draft cannot be generated through the API loop because `cost:canone` is a cost-line field; the real Generate was therefore run on the issuer template (C2), not on the SLA one, which r5 had run. (I5) `crm-ui` build still emits a 1.17 MB `pdf.worker.min` asset that nothing loads.

Pre-existing, NOT this branch: shell sidebar leaves a 45-136 px column at 360 px expanded (D15 at 360 expanded fails only for that reason: 2 of 12 placement checks); shell sidebar toggle label-in-name at 360 collapsed; OffersCard Actions clipped at 1024/360; /crm/pipeline cards `label-content-name-mismatch`; "Mark as sent" label; shell footer contrast.

## Earlier defects, re-verified this round (new since the fix vs missed earlier)

- **D21 closed** at the exact r5 placements (see B2/B3). Not new, not missed: the fix held at 3 sizes x 2 templates x 7 steps.
- **D22 closed** at both rows of the Sections list and the whole class (B4), EN and IT.
- **D24 closed** at 320 px (B6).
- **D23 closed at its reported placement, class open (F3-F5)**: new since the fix are M-10/M-11 (introduced with the round-6 bound; the Do-graph walk is O(calls x forms) and the `/Contents` array is not bounded), missed earlier are M-8/M-9 (the model was always operator-based).
- D20 (owner) verified by B2; L-9 and OA-4 verified by B7/B8.

## AC to evidence

79/79 ACs have an executed passing test. Browser this round: US-11 (11.1-11.13) at 6-7 widths in both themes incl. the D20/OA-4 changes; US-12 12.2, 12.3, 12.9, 12.10 in a real PDF, 12.7/12.12/12.13 by interception (S6/S11); US-6/US-7/US-8 through e2e (26/26 twice). AC-12.5/12.6/12.11 rely on crm-api tests and the dev DB's seeded templates (observed). The estimate ACs that need a ready estimate (AC-2.3/2.4 with an estimate, AC-4.2 bound lines, annex effort) are covered by unit/api tests only; their browser walk is B5.

## Security

`owasp-reviewer` is already at round 7 (security-review.md). Recommended again, narrowly, after F3 is fixed (the new Do-graph/contents bounds are new input-handling code), and note that this pass found no new dependency and no secret.

## Files and evidence

Screenshots and findings log: `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad/r6shots/` (`O4-w1440-light-shown.png`, `O4-w1440-dark-shown.png`, `NUL-banner.png`, `NUL-company.png`, `NUL-w1280-light.png`, `findings.jsonl`). Drivers `.../scratchpad/r6/ex/*.ts` (o4, d20, d22, nu*, pn, g1, n); probes `.../scratchpad/r6/qe/` (make.ts, make2.ts, render*.ts, up.ts, nul.ts, v7.ts); logs `.../scratchpad/r6/*.log` (g1-g8, e1, e2, browser1, o4, v7). No test file was added to the repo this round (the existing suites already cover the new surfaces; my drivers write only to the scratchpad). Cleanup: every QE/E2E template I or the e2e left active is archived; the second crm-api on :8094 is stopped; the owner's welld_ch profile and letterhead were never written (the only letterhead writes went to crm_test through :8094).
