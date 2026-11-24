---
spec: 20261115
generated: 2026-11-15
synced: 2026-11-24
---


> Re-sync 2026-11-15 (orchestrator, after SA-5): AC-9.6 now lists three more differences from the mockup (decimal comma, 018 amount format and discount-row unit/quantity, added-row position). No task changes: T35 already asserts them in `OBSERVED_DRIFT`; T58 confirms the list matches.

> Re-sync 2026-11-15 (orchestrator, owner amendment US-11/US-12, plan DD-53…DD-64, design D-22…D-32): added T59–T68 from the plan's task hints (L0, I1, I3, I2, I4, L1, L2, L3, E, D). T61 deps T60 (seeds use the new `issuerAddress` source, so the plan's I1 ∥ I3 is serialised); T62 ∥ T61. Owner fixes D12–D19 landed as fix commits outside the task list (decisions.md).

> Re-sync 2026-11-15 (orchestrator, OA-3 real A4 pages + security M-4; plan DD-65…DD-79): added T69–T76 from the plan's task hints. T74 reworks T65, T75 reworks T67.

> Re-sync 2026-11-16 (orchestrator, before the close): OA-4 (page numbers in the preview) is T77, done in b8dd6a1d; plan.md's hand-edit limits text aligned with the build (no task change); owner fixes D12–D24, security fixes (rounds 4–11) and eval fixes landed as fix commits recorded in decisions.md. T58 checked: every gate green (QE round 11 PASS, security round 11 PASS WITH NOTES, eval round 3 PASS 80.0), owner review confirmed (SA-1…SA-6, O3, O4, OWNER REVIEW items), O7 confirmed by the owner on the production profile addresses (2026-11-16).

> Re-sync 2026-11-16 (post-release, after commit 07dca8de): plan.md gained the post-release note on the 503 codes `pdf_check_busy` / `pdf_check_unavailable` (documented and translated by that fix commit). No task added or changed; the feature stays done.

# Tasks: CRM offer wizard

Contracts are `plan.md` (approved by delegation 2026-11-15, DD-1…DD-52 and § Amendments);
screens, states and copy are `design.md`; delegated choices are `decisions.md` (O3: filled
fields keep their values when a block is switched off or another option is chosen; DD-39
supersedes decisions.md rule 1). Rigor `production`: plan.md is the contract, so there is no
architecture section here.

Re-synced 2026-11-15 after the engine (plan § Amendments "post-engine, delegated", DD-40…DD-51):
T18–T23 checked (implemented and integrated, commits 075f2ad3, f299b3a4, 44387fa6, 1c3a7e71,
449bebdf, 0f593678); T23's done-when corrected (no option line after the last total); T13, T14,
T24, T25, T26, T29, T30, T32, T33, T34, T35, T42, T44, T45, T46, T47, T50, T53 updated for the
engine as built. IDs and checked boxes preserved; no task added or removed.

Re-synced 2026-11-15 for R16 (plan § Amendments "R16, delegated", DD-52): new task **T12b** (the
reference token "⟪REF⟫" in hand-edited text) before the engine is mirrored; T13 depends on it;
T30, T32 and T48 updated for DD-52; Coverage and Overlaps updated. IDs and checked boxes
preserved; T12b is the only task added.

Conventions every task follows:
- **Domain → agent:** `backend` = backend-dev (crm-api, `scripts/`), `frontend` = frontend-dev
  (crm-ui, operai-ui, shell, including e2e), `library` = frontend-dev working in `operai-ui/`,
  `devops` = files only (runbook), no provisioning.
- **Backend tests run on the `crm_test` database only**, never the dev DB `mise run dev` uses:
  `[crm_test]` below means `cd crm-api && DATABASE_URL=<crm_test url> bun test …` after
  `bun run db:deploy` against `crm_test` (crm-api/README.md § Commands). Engine tests are pure
  and need no DB, but run the same way.
- **Shared engine:** every file in `crm-api/src/offers/engine/` (tests excepted) wraps its body in
  `// shared-copy:begin offerEngine.<file>` … `// shared-copy:end offerEngine.<file>`; pure, no
  I/O, no imports outside the engine, no `Intl`/`toLocale*`/`Date.now`/`new Date()` (determinism
  of the copies, decisions.md; allowed exceptions: plan DD-50). Tests live next to it as
  `*.test.ts` and are NOT copied. From T13 on, crm-ui holds a byte-identical copy of the engine
  **as built at T13**. **Engine freeze (DD-51): after T13, any engine change is drift** — amend
  plan.md, re-sync tasks.md, then edit both copies in one commit with their vectors. T14 may touch
  both copies only to satisfy crm-ui's compiler/linter, with no behaviour change (every vector
  unchanged); no other task edits the engine.
- **Engine as built (consumers read this, never re-derive it):** the day and the document
  language come in `WizardContext.today`/`.language` (DD-41: language = the template's, never
  `<html lang>`; today = the server's UTC day, returned by the context route); plain surfaces —
  headings, annex titles/subtitles, cost descriptions, total labels, column labels — carry the
  marker characters U+E000–U+E003 unescaped: split on them, **never `parseInline`** (DD-47);
  `numberOffer`'s strings are print-ready, a marker in them is "?" (DD-46); fills only through
  `setField`/`setBlock`/`chooseOption` (O3).
- **The mockup** (`WellD_OperAI_Wizard_Offerte.html`, repo root, untracked) is a UX and text
  reference only: T18–T23 read its line 263 (`window.__WIZ__.templates[].src`, codes `T1`, `T2`,
  `T3`, `T4`, `T5`, `T6`, `T1+T3`); no code, style or file of it is imported or committed.
- **Copy:** every user-visible string in `crm-ui/src/strings/` (`en` + complete `it: typeof en`);
  template texts, labels and hints are never translated (AC-10.1).
- **Deploy order** (plan R4, design § Component inventory): crm-api → shell carrying the new
  `@operai/ui` tokens → crm-ui. Locally, the same branch is fine.

## Shared engine (crm-api, then mirrored into crm-ui)

- [x] T1: Add the `paper-*` colour tokens to the design system (preview paper, light in both themes) — refs: AC-3.1, AC-3.3 — deps: none
  - domain: library
  - touch: `operai-ui/src/styles/tokens.css`, `operai-ui/src/foundations/tokens.ts`, `operai-ui/src/foundations/Colours.stories.tsx`, `operai-ui/src/foundations/paperTokens.test.ts`
  - done when: `operai-ui/src/foundations/paperTokens.test.ts` passes — it reads `tokens.css` and asserts `--paper`, `--paper-ink`, `--paper-soft`, `--paper-rule`, `--paper-head`, `--paper-mark`, `--paper-mark-ink` exist with identical values in both themes, each has an `@theme inline` line, and contrast is ink/paper ≥ 15:1, soft/paper ≥ 6:1, mark-ink/mark ≥ 7:1 (design § Accessibility); `mise run ui:check` is green (library + every consumer build)

- [x] T2: Move `markup.ts` into `offers/engine/`, add backslash escapes and the missing/pending marker runs, and add `printable.ts` (WinAnsi + "□", everything else "?") — refs: AC-3.2, AC-3.3 — deps: none
  - domain: backend
  - touch: `crm-api/src/offers/markup.ts`, `crm-api/src/offers/markup.test.ts`, `crm-api/src/offers/engine/markup.ts`, `crm-api/src/offers/engine/markup.test.ts`, `crm-api/src/offers/engine/printable.ts`, `crm-api/src/offers/engine/printable.test.ts`, `crm-api/src/offers/engine/vectors/markup.json`, `crm-api/src/offers/contractPdf.ts`
  - done when: `[crm_test] bun test src/offers/engine/markup.test.ts src/offers/engine/printable.test.ts src/offers/contractPdf.test.ts` passes — the old `markup.test.ts` cases unchanged plus `vectors/markup.json` (escapes `\[ \* \_ \| \{ \\` and line-start markers, U+E000…U+E001 → mark `missing`, U+E002…U+E003 → mark `pending`, legacy texts without backslashes parse as before); `printable` maps "□" (U+25A1) to itself and a non-WinAnsi character to "?"; `crm-api/src/offers/markup.ts` no longer exists and `bun run typecheck` passes

- [x] T3: Move the document formatting to `engine/format.ts` and the fixed document words to `engine/words.ts`; the renderer imports them — refs: AC-2.5, AC-3.2, AC-4.1 — deps: T2
  - domain: backend
  - touch: `crm-api/src/offers/engine/format.ts`, `crm-api/src/offers/engine/words.ts`, `crm-api/src/offers/engine/format.test.ts`, `crm-api/src/offers/engine/vectors/format.json`, `crm-api/src/offers/contractPdf.ts`, `crm-api/src/offers/contractPdf.test.ts`
  - done when: `[crm_test] bun test src/offers/engine/format.test.ts src/offers/contractPdf.test.ts` passes — `vectors/format.json` pins `formatAmount` (`7'000.00` style, CHF and EUR), `shortDate` (`9.2.2026`), `formatPercent`, `formatNumber`, computed without `Intl`; the legacy renderer goldens in `contractPdf.test.ts` are unchanged (only the import path of the formatters moved); `grep -n "formatAmount\|shortDate\|const t = " crm-api/src/offers/contractPdf.ts` finds no definition, only imports

- [x] T4: Implement `engine/costs.ts` (rules C1–C9: span totals, option lines, DD-39) with `vectors/costs.spans.json`; the legacy `offers/costs.ts` becomes a thin adapter — refs: AC-4.1, AC-4.3, AC-4.6, AC-4.7, AC-2.5 — deps: none
  - domain: backend
  - touch: `crm-api/src/offers/engine/costs.ts`, `crm-api/src/offers/engine/costs.test.ts`, `crm-api/src/offers/engine/vectors/costs.spans.json`, `crm-api/src/offers/costs.ts`
  - done when: `[crm_test] bun test src/offers/engine/costs.test.ts src/offers/offers.test.ts` passes — the vector file holds every case listed under plan § Engine contracts `vectors/costs.spans.json` (AC-4.6's example → 1 500.00 / 150.00, `oneOffCents` 95 000, `yearlyCents` 70 000; placement invariance over 0–3 total rows; ≤ 1 total row with 10 % = legacy 018 result 1 350.00; ≥ 2 total rows with a percentage → `percent_discount_multi_total` for `cost:<key>` and `cost:extra:<id>`, `oneOffCents` null; off-block second total; `discount_without_base`; C5 and C6 each failing alone; empty span "–"/null; incomplete span; option line numbered, priced, never counted; 11 lines → `too_many_cost_lines`; `no_counted_line`); the legacy offers tests are unchanged and green through the adapter

- [x] T5: Implement the template parser's structure in `engine/syntax.ts`: opening, `##` sections, `@@step`, `@@costs`/`@@line`/`@@total`/`@@costlabels`/`@@end`, `@@annex`/`@@subtitle`, inline and block conditions, `@@salutation`/`@@acceptance`/`@@effort-annex`, and the structural problems with line numbers — refs: AC-8.3, AC-9.5, AC-4.6, AC-4.7 — deps: T2
  - domain: backend
  - touch: `crm-api/src/offers/engine/syntax.ts`, `crm-api/src/offers/engine/syntax.test.ts`, `crm-api/src/offers/engine/syntax.fuzz.test.ts`, `crm-api/src/offers/engine/vectors/syntax.json`
  - done when: `[crm_test] bun test src/offers/engine/syntax.test.ts src/offers/engine/syntax.fuzz.test.ts` passes — one vector per structural code with its line (`block_not_closed`, `unexpected_close`, `no_costs_section`, `costs_not_first`, `costs_not_closed`, `cost_line_invalid`, `cost_key_duplicate`, `cost_line_after_last_total`, `percent_discount_multi_total` incl. a `@@total` inside an `@@OPT_START` block, `unit=?` with two totals → no problem, `annex_designation_invalid`/`_duplicate`, `salutation_missing`, `too_many_sections` (> 15), `too_many_annexes` (> 5), `too_many_annex_sections` (> 30), `heading_too_long`, `too_large` (> 150 000), `nesting_too_deep` (> 8), `reserved_character` (U+E000–U+E0FF, "⟦", "⟧"), warning `non_printable_character`); the fuzz test (random, huge, deeply nested input) returns problems within 200 ms and never throws

- [x] T6: Add the declarations (`@@field`/`@@list`/`@@table`/`@@block`/`@@choice`: label, hint, example, kind incl. `amount`, default, `options`, `fills`, `source`, `compute`, `step`) to `syntax.ts`, and the closed-grammar expression parser `engine/compute.ts` — refs: AC-1.3, AC-1.8, AC-1.9, AC-4.5, AC-8.1, AC-8.3 — deps: T5
  - domain: backend
  - touch: `crm-api/src/offers/engine/syntax.ts`, `crm-api/src/offers/engine/compute.ts`, `crm-api/src/offers/engine/compute.test.ts`, `crm-api/src/offers/engine/syntax.declarations.test.ts`, `crm-api/src/offers/engine/vectors/declarations.json`, `crm-api/src/offers/engine/vectors/compute.json`
  - done when: `[crm_test] bun test src/offers/engine/syntax.declarations.test.ts src/offers/engine/compute.test.ts src/offers/engine/syntax.test.ts` passes — one vector per declaration code with its line (`field_undeclared`, `label_missing`, warning `declared_unused`, `choice_too_few_options`, `choice_option_unknown`, `name_duplicate`, `table_column_unknown`, `column_in_two_tables`, `compute_invalid`, `compute_cycle`, `fills_unknown` incl. a fill targeting a `source:` field, `source_unknown`, `step_unknown`, warning `optional_heading_not_last`); `options` > 20 refused; `compute.json` covers `100 - ACCONTO - RATE`, parentheses, `sum(COL)`, and inputs such as `process.exit()` / `a;b` rejected as `compute_invalid`; `grep -nE "eval\(|new Function" crm-api/src/offers/engine` finds nothing

- [x] T7: Implement `engine/answers.ts`: the `WizardAnswers` type, `initialAnswers`, `sampleAnswers`, `reconcileAnswers`, `switchTemplate`, the `fills` rule (O3: choosing sets, switching off keeps) and the answer checks (reserved characters, options) — refs: AC-1.4, AC-1.9, AC-2.1, AC-2.3, AC-6.5, AC-8.4, AC-8.5 — deps: T6
  - domain: backend
  - touch: `crm-api/src/offers/engine/answers.ts`, `crm-api/src/offers/engine/answers.test.ts`, `crm-api/src/offers/engine/vectors/answers.json`
  - done when: `[crm_test] bun test src/offers/engine/answers.test.ts` passes — vectors: defaults of fields/blocks/choices (exactly one choice option true); `initialAnswers` from a context fills client lines/contacts/place and the system prefills (`deal`, `epics`, `phases`, `timeline`, `manDays`); `sampleAnswers` fills every required item without a deal; `reconcileAnswers` keeps names that still exist and reports the dropped ones, unmatched hand edits move to `orphanedEdits`; `switchTemplate` keeps `client.lines`, `contactIds`, `place`, `date` and resets the rest; a fill sets its targets, a later edit stands, switching the block off or choosing another option keeps current values and overwrites only the new option's targets (decisions.md O3); a value containing U+E000–U+E0FF or "⟦"/"⟧" and a text value outside its `options` are reported with their JSON path

- [x] T8: Implement `engine/outline.ts` — `outline(ast, null)` for the editor (every item, nested under its block) and `outline(ast, answers)` for the wizard (only shown items, non-empty steps, sections per step), per DD-33 — refs: AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-8.2 — deps: T7
  - domain: backend
  - touch: `crm-api/src/offers/engine/outline.ts`, `crm-api/src/offers/engine/outline.test.ts`, `crm-api/src/offers/engine/vectors/outline.json`
  - done when: `[crm_test] bun test src/offers/engine/outline.test.ts` passes — items appear per step in text order, an empty step is omitted, a field used only inside an off block is absent from the wizard outline and present (nested) in the editor outline, `optional` is true exactly when every occurrence sits in a `{{?…}}` naming it, `derived`/`system`/`options`/`fills`/`default` are carried, a `step:` override moves the item, the cost table item lists line keys and total labels

- [x] T9: Implement `engine/resolve.ts` core — `resolveOffer` for text: conditions, escaped answers, system values (pending reference marker), lists and repeatable tables (order, empty items/rows dropped), derived fields, dropping empty sub-headings/sections, `missing`, printable mapping — refs: AC-1.5, AC-1.7, AC-2.2, AC-3.3, AC-4.2, AC-4.5, AC-10.1 — deps: T3, T8
  - domain: backend
  - touch: `crm-api/src/offers/engine/resolve.ts`, `crm-api/src/offers/engine/resolve.test.ts`, `crm-api/src/offers/engine/vectors/resolve.json`
  - done when: `[crm_test] bun test src/offers/engine/resolve.test.ts` passes — vectors: an answer `**x**` / `## y` / `| z |` prints literally (escaped); `source: reference` emits the pending marker; a missing required field emits the missing marker with its label and appears once in `missing` with its `step`; turning a block on makes its inner field missing; list/table reorder changes the printed order and empty items/rows are not printed (only key column and unit/quantity columns required in a table row); a derived `SALDO = 100 - ACCONTO - RATE` with `rate` off counts it 0, empty input → empty, never in `missing`; a cost line `unit=[TARIFFA]` reads the same answer as the field; an Italian template resolved with any UI language yields Italian document text (no strings module involved)

- [x] T10: Extend `resolveOffer` with the cost table (rows from `@@line`/`@@total`, `each=`, `perRelease`, extra lines before the last total, off-block lines removed), `invalid` (answer codes, cost errors from `computeCosts`, hand-edit limits) and hand-edited sections — refs: AC-1.8, AC-3.5, AC-3.6, AC-4.3, AC-4.4, AC-4.6, AC-5.2, AC-5.4 — deps: T4, T9
  - domain: backend
  - touch: `crm-api/src/offers/engine/resolve.ts`, `crm-api/src/offers/engine/resolve.costs.test.ts`, `crm-api/src/offers/engine/vectors/resolve.costs.json`
  - done when: `[crm_test] bun test src/offers/engine/resolve.costs.test.ts src/offers/engine/resolve.test.ts` passes — vectors: a line inside an off block is neither a row nor counted; extra lines land before the last `@@total`; `invalid` holds `out_of_range` (derived SALDO < 0), `not_integer` (fractional qty), `date_out_of_range`, `not_an_option`, every `CostErrorCode` and `percent_discount_multi_total` with `name` `cost:<key>` / `cost:extra:<id>` / `cost:*` and the template label (never an answer value; `null` for extra lines and `cost:*`); a hand edit with heading > 120 or body > 20 000 is `heading_too_long`/`section_too_long` at `section:<key>`; a hand-edited section ignores later field changes and lists its `uses`

- [x] T11: Implement `engine/numbering.ts` (`numberOffer`: section and sub-heading numbers, text-annex headings, effort-detail and deal-PDF letters skipping used designations, the "Allegati:" list, the index only with the effort-detail annex) — refs: AC-9.5, AC-3.2 — deps: T3
  - domain: backend
  - touch: `crm-api/src/offers/engine/numbering.ts`, `crm-api/src/offers/engine/numbering.test.ts`, `crm-api/src/offers/engine/vectors/numbering.json`
  - done when: `[crm_test] bun test src/offers/engine/numbering.test.ts` passes — vectors: text annex "A" → effort-detail "B", deal PDFs "C", "D"; text annex "SLA" → effort-detail "A"; two text annexes in template order before the effort-detail annex; no effort-detail annex → no index; with it, the index lists the text annexes too; annex sections numbered within the annex; headings upper-cased without `toLocale*`; a legacy 018 input (no text annexes) numbers exactly as today's renderer does

- [x] T12: Implement `engine/edit.ts` — `resolveSectionForEdit` (answers escaped, missing values and the pending reference as "⟦Label⟧", `tokens` listed; a hand-edited section returned unchanged) and `findTokens` — refs: AC-5.1, AC-5.2 — deps: T10
  - domain: backend
  - touch: `crm-api/src/offers/engine/edit.ts`, `crm-api/src/offers/engine/edit.test.ts`, `crm-api/src/offers/engine/vectors/edit.json`
  - done when: `[crm_test] bun test src/offers/engine/edit.test.ts` passes — vectors per plan § `edit.ts`: unknown key / unprinted section → `null`; tokens in text order; an already hand-edited section → stored text, `tokens: []`; `findTokens` returns start/end/label for every "⟦…⟧" and a stray "⟦" alone

- [x] T12b: Add the reference token "⟪REF⟫" to hand-edited text, filled at generation (DD-52, closes R16) — `REFERENCE_TOKEN` in `markup.ts`; `resolveSectionForEdit` writes it for `source: reference` in a body (not in `tokens`); `findTokens(text, where)` skips an exact token in a body and reports stray "⟪"/"⟫"; `resolveOffer` fills it in hand-edited bodies (reference, or pending marker without one); `checkAnswers` and the template's `reserved_character` refuse "⟪"/"⟫" except an exact token in a hand edit's body — refs: AC-2.2, AC-5.1, AC-5.2 — deps: T2, T6, T7, T10, T12
  - domain: backend
  - touch: `crm-api/src/offers/engine/markup.ts`, `crm-api/src/offers/engine/edit.ts`, `crm-api/src/offers/engine/resolve.ts`, `crm-api/src/offers/engine/answers.ts`, `crm-api/src/offers/engine/syntax.ts`, `crm-api/src/offers/engine/printable.ts` (comment only: the reserved brackets it maps to "?"; no behaviour change), `crm-api/src/offers/engine/edit.test.ts`, `crm-api/src/offers/engine/resolve.test.ts`, `crm-api/src/offers/engine/answers.test.ts`, `crm-api/src/offers/engine/printable.test.ts`, `crm-api/src/offers/engine/vectors/edit.json`, `crm-api/src/offers/engine/vectors/resolve.json`, `crm-api/src/offers/engine/vectors/answers.json`, `crm-api/src/offers/engine/vectors/syntax.json`
  - done when: `[crm_test] bun test src/offers/engine` passes with every existing vector unchanged except the edit vectors that listed the pending reference as "⟦Label⟧" in a body (now "⟪REF⟫", absent from `tokens` — the test "writes the pending reference as a token too, and lists it" rewritten accordingly), plus new vectors per plan DD-52 and the AC-5.1/AC-5.2 rows: `resolveSectionForEdit` on the T3 seed's "Parametri del servizio" (table cell) and "Condizioni generali" (`**[RIF]**` list item) → "⟪REF⟫" in place, `tokens` without the reference; a reference in a heading → "⟦Label⟧" listed; `findTokens` — "⟪REF⟫" in a body no entry, in a heading an entry, "⟪ref⟫", a lone "⟪"/"⟫" and "⟪⟪REF⟫⟫" (two one-character entries) reported, entries in text order mixed with "⟦…⟧"; `resolveOffer` on a hand-edited body with "⟪REF⟫" — without `reference` a pending-marker run (label of the first `source: reference` field; "REF" with none declared) and `missing` unchanged; with `{ reference: "0007/2026" }` the reference at a line start, in a table cell and inside `**…**`, twice for two tokens, in a section whose template never used the reference; `mode: "tokens"` keeps the token; `"\⟪REF⟫"` still filled; over every vector the resolved offer contains no "⟪"/"⟫"; `checkAnswers` — "⟪REF⟫" in `handEdits[k].body` and `orphanedEdits[i].body` accepted, in a heading, a field, a list item or a client line `reserved_character` with its path, "⟪⟪REF⟫⟫" or "⟪ref⟫" in a body refused, "⟦" in a body still refused (DD-30 untouched); `syntax.json` — "⟪" or "⟫" in a template line → `reserved_character`; `printable` maps "⟪"/"⟫" to "?" (pinned, unchanged); `grep -rn "⟪REF⟫" crm-api/src/offers/engine/*.ts` finds the literal only in `markup.ts` (comments excepted); `bun run typecheck` passes; the seeds' conversion tests unchanged and green

- [x] T13: Mirror the engine **as built** into `crm-ui/src/lib/offerEngine/` and register it: one `offerEngine.<file>` group per engine file, a whole-file mode for the JSON vectors (JSON cannot carry markers), the workflow path filter, and an engine purity test; from this task on the engine is frozen (DD-51) — refs: AC-3.2, AC-9.3 — deps: T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T12b
  - domain: backend
  - touch: `crm-ui/src/lib/offerEngine/**`, `crm-api/src/offers/engine/*.ts`, `crm-api/src/offers/engine/purity.test.ts`, `scripts/check-shared-copies.ts`, `scripts/check-shared-copies.test.ts`, `.github/workflows/shared-copies.yml`
  - done when: the twelve engine files as built (including T12b's reference token, DD-52) — `markup`, `printable`, `format`, `words`, `costs`, `compute`, `syntax`, `answers`, `outline`, `resolve`, `numbering`, `edit` — and every `vectors/*.json` exist in crm-ui with identical bytes, and no engine behaviour changed (`[crm_test] bun test src/offers/engine` green with the vectors unchanged; an edit to an engine `.ts` in this task is limited to shared-copy markers); `bun test scripts/check-shared-copies.test.ts` passes (incl. a new whole-file JSON case: one changed byte fails); `bun scripts/check-shared-copies.ts` prints all twelve `offerEngine.*` groups and the vectors in sync; `.github/workflows/shared-copies.yml` paths include `crm-api/src/offers/engine/**` and `crm-ui/src/lib/offerEngine/**`; `[crm_test] bun test src/offers/engine/purity.test.ts` passes — on code with comments stripped (DD-50), no engine file contains a `welld_` literal, `Intl`, `toLocale`, `Date.now`, `new Date(`, `localStorage`, `eval(`, `new Function`, or an import outside the engine directory; a `"CHF"`/`"EUR"` value literal appears only in `format.ts`'s separator choice and `answers.ts`'s `sampleContext` (the allow-list has exactly these two; a third fails); `Date.UTC` is allowed; no `*.test.ts` was copied

- [x] T14: Run the shared vectors in crm-ui, make the copy pass crm-ui's compiler and linter, and give every engine problem and issue code its en/it message (incl. the new `declaration_invalid`, DD-40) — refs: AC-3.2, AC-8.3, AC-10.1 — deps: T13
  - domain: frontend
  - touch: `crm-ui/src/lib/offerEngine.vectors.test.ts`, `crm-ui/src/lib/offerEngine/**`, `crm-api/src/offers/engine/*.ts` (only to keep both copies identical if a crm-ui compile/lint fix is needed — edited in both in the same commit, behaviour unchanged, DD-51), `crm-ui/src/strings/templates.ts` (shared, append-only), `crm-ui/src/lib/engineCodes.test.ts`
  - done when: `cd crm-ui && pnpm test src/lib/offerEngine.vectors.test.ts src/lib/engineCodes.test.ts src/strings.test.ts` passes — the vectors test runs every `vectors/*.json` file of the crm-ui copy through the crm-ui copy with the same expectations as the crm-api tests; `templates.wizardEditor.problem.declaration_invalid` exists in `en` and `it` (it may name the offending key, the problem's `name`); `engineCodes.test.ts` asserts that every `ProblemCode` of the crm-ui `syntax.ts` has a `templates.wizardEditor.problem.*` key and every `InvalidCode` of `resolve.ts` an `offerWizard.invalid.*` key, so a code without copy fails; `catalogGaps` finds no gap; `pnpm lint` and `pnpm build` pass in crm-ui; `bun scripts/check-shared-copies.ts` still green; `[crm_test] bun test src/offers/engine` still green

## crm-api: schema and templates

- [x] T15: Add the `offer_wizard` migration (template format columns + CHECK, `seedKey` index, `offer_draft` table), the Prisma schema, the `legacyContent(row)` narrowing helper, and rename the legacy prefill type `OfferDraft` → `OfferPrefill` — refs: AC-6.1, AC-8.1, AC-9.4 — deps: none
  - domain: backend
  - touch: `crm-api/prisma/schema.prisma`, `crm-api/prisma/migrations/*`, `crm-api/src/offers/legacyContent.ts`, `crm-api/src/offers/draft.ts`, `crm-api/src/offers/offers.routes.ts`, `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerWizardMigration.test.ts`
  - done when: `cd crm-api && bun run db:deploy` succeeds on `crm_test`; `bun run typecheck` passes; `[crm_test] bun test src/offer-templates/offerWizardMigration.test.ts` passes — existing template rows read back as `format = 'sections'`; a `wizard` row without `source` and a `sections` row with `source` are rejected by the CHECK; `offer_draft_target` rejects `targetKind='new'` with an offer id; the migration SQL contains no statement altering, updating or deleting `deal_offer`; the full `[crm_test] bun test` stays green (legacy routes read legacy columns only through `legacyContent`)

- [x] T16: Extend the offer-template routes for the wizard format: `formats` filter (default `sections`), `description`/`uses`/`source`/`seeded` in `TemplateSchema`, wizard-only create/duplicate, format-specific `PUT`, 422 `template_invalid` + `problems` — refs: AC-1.1, AC-8.1, AC-8.3, AC-9.3 — deps: T6, T15
  - domain: backend
  - touch: `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.wizard.test.ts`, `crm-api/src/test-support/world.ts` (shared, append-only)
  - done when: `[crm_test] bun test src/offer-templates/offerTemplates.wizard.test.ts src/offer-templates/offerTemplates.test.ts` passes — `GET ?formats=wizard` returns wizard rows with description/uses and `GET` without `formats` returns legacy rows only; create/duplicate/edit with `deal:financials` + manage in scope, `403 out_of_scope` for another entity, 428/409 on `PUT` without/with stale `If-Match`; a text with an unclosed block, undeclared field, missing label, choice < 2 or no costs section → 422 with `problems[{line, code, severity}]`; a `10%` discount in a two-total table → 422 `percent_discount_multi_total`; a welld_it English wizard template is created and listed (no entity/language branch); legacy tests unchanged

- [x] T17: Implement supersession per (entity, language) under the template advisory lock, the last-template guard (`409 last_template`) and the legacy-restore refusal (`409 template_superseded`) — refs: AC-9.2 — deps: T16
  - domain: backend
  - touch: `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/supersession.ts`, `crm-api/src/offer-templates/offerTemplates.supersession.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/offerTemplates.supersession.test.ts` passes — the first wizard template of (welld_ch, it) archives the Italian legacy templates in the same transaction (incl. one named like the new template: no name clash), not the English ones and not welld_it's; a duplicate, a restore and a language change that leave an active wizard template trigger it too; nothing is archived before; restoring a superseded legacy row → 409; archiving the only active template of an (entity, language) → 409; the welld_ch English legacy template still generates through `POST /deals/{id}/offers`

## crm-api: the seven mockup templates

- [x] T18: Produce the golden fidelity fixtures from the mockup: for each of the seven templates, a fixed set of answers and the printed text the mockup produces with them, captured once in a browser — refs: AC-9.1, AC-9.6 — deps: none
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/golden/**`
  - done when: `crm-api/src/offer-templates/wizardSeeds/golden/` holds, for each code `T1 T2 T3 T4 T5 T6 T1+T3`, an `answers.<code>.json` (mockup field names → values, every optional block exercised in at least one template) and a `text.<code>.txt` (the mockup's printed text for those answers), plus a `README.md` stating the mockup version (2026-11-14), the browser used and the capture procedure; `git ls-files` shows no copy of the mockup HTML or its scripts

- [x] T19: Convert the mockup's "Progetto a corpo" (T1) and "Risorse a tempo" (T2) texts from line 263 (`window.__WIZ__.templates[].src`) to the plan's grammar — refs: AC-9.1, AC-9.6 — deps: T8
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/welldChIt.T1.ts`, `crm-api/src/offer-templates/wizardSeeds/welldChIt.T2.ts`, `crm-api/src/offer-templates/wizardSeeds/conversion.T1T2.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/wizardSeeds/conversion.T1T2.test.ts` passes — each text parses with zero errors; the outline's steps match the mockup's mapping (DD-26: sections 1–3 scope, 4–5 conditions, 6–8 costs, 9 and annexes annexes); labels, hints, defaults are the mockup's verbatim; the conversions of DD-1 (header lines removed, two opening paragraphs kept), DD-5 (no `@@W`/`@@PAGEBREAK`/`^^`/`---`, unnumbered headings), DD-12 (literal "CHF" → a `source: currency` field) and DD-24 (T2 `@@costlabels`) are applied; T1's "voce a scelta" is an `option` line after the last `@@total`

- [x] T20: Convert the mockup's "Manutenzione e SLA" (T3) text, incl. its SLA text annex and the SLA profile `fills`, from line 263 — refs: AC-9.1, AC-9.5, AC-9.6, AC-1.9 — deps: T8
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/welldChIt.T3.ts`, `crm-api/src/offer-templates/wizardSeeds/conversion.T3.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/wizardSeeds/conversion.T3.test.ts` passes — zero parse errors; steps per DD-26; canone and pacchetto ore are `yearly` lines, "TOTALE primo anno" a `@@total` (DD-13); choosing the SLA profile option fills the fields the mockup sets; the SLA annex is a text annex with ≤ 30 sections; no percentage discount (DD-39)

- [x] T21: Convert the mockup's "Formazione" (T4) and "Consulenza e assessment" (T5) texts from line 263 — refs: AC-9.1, AC-9.6 — deps: T8
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/welldChIt.T4.ts`, `crm-api/src/offer-templates/wizardSeeds/welldChIt.T5.ts`, `crm-api/src/offer-templates/wizardSeeds/conversion.T4T5.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/wizardSeeds/conversion.T4T5.test.ts` passes — zero parse errors; steps per DD-26; T4's price-model option `fills` as the mockup; T5's free "Allegati" field is removed in favour of the deal-PDF picker (DD-24, AC-9.6) and no `[ALLEGATI]`-like field remains

- [x] T22: Convert the mockup's "Servizi a canone" (T6) text from line 263 — refs: AC-9.1, AC-9.6 — deps: T8
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/welldChIt.T6.ts`, `crm-api/src/offer-templates/wizardSeeds/conversion.T6.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/wizardSeeds/conversion.T6.test.ts` passes — zero parse errors; steps per DD-26; canone, extra users and licences `yearly`, activation `one_off`, "TOTALE primo periodo" a `@@total` (DD-13); a table with no activation still has a counted line (AC-4.3 relaxed rule)

- [x] T23: Convert the mockup's "Progetto a corpo con SLA" (`T1+T3`) text from line 263, consistent with T19/T20's conversions of the shared clauses — refs: AC-9.1, AC-9.5, AC-9.6 — deps: T19, T20
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/welldChIt.T1T3.ts`, `crm-api/src/offer-templates/wizardSeeds/conversion.T1T3.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/wizardSeeds/conversion.T1T3.test.ts` passes — zero parse errors; ≤ 15 contract sections and each text annex ≤ 30 sections (DD-3); two `@@total` rows and **no** option line after the last (the mockup's T13 and the golden `T1+T3` have none — AC-9.1 wins over this task's earlier text; DD-49); text ≤ 150 000 chars; clauses shared with T1/T3 are identical to their converted form there (asserted by the test by block prefix plus the listed `WORDED_DIFFERENTLY` entries, decisions.md "T19, T20, T23")

- [x] T24: Wire the seven seeds: the catalog `wizardSeeds/welldChIt.ts` (imports the seven texts under their built export names — `welldChItT1Text`, `welldChItT2Text`, `welldChItT3Text`, `welldChItT1T3Text`, `T4_TEXT`, `T5_TEXT`, `T6_TEXT`; catalog name, description, uses from the mockup; `seedKey` `welld-ch-it-v1:<code>` with codes `T1 T2 T3 T4 T5 T6 T1+T3`; the mockup id `T13` ↔ `T1+T3`; and each code's mockup→seed renames, today `T4: rows.MODULO[].ORE → ORE_MODULO`, DD-48) and `seedWizardTemplates(entity)` — lazy, idempotent, `welld_ch` only, run when `formats` includes `wizard`, followed by supersession — refs: AC-9.1, AC-9.2 — deps: T17, T19, T20, T21, T22, T23
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/welldChIt.ts`, `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.seed.test.ts`
  - done when: `[crm_test] bun test src/offer-templates/offerTemplates.seed.test.ts` passes — the first `GET ?entity=welld_ch&formats=wizard` creates exactly seven active Italian wizard templates (names Progetto a corpo, Risorse a tempo, Manutenzione e SLA, Formazione, Consulenza e assessment, Servizi a canone, Progetto a corpo con SLA; description and uses as the mockup) and archives the Italian legacy ones; five concurrent first reads still yield seven; an archived seed is not re-created; `GET` without `formats` seeds nothing; welld_it gets none; each seed parses with zero errors; the catalog's renames name only fields the seed declares (`ORE_MODULO` is a column of `MODULO` in T4)

## crm-api: renderer and generation

- [x] T25: Make the renderer read numbering, annex letters, cost positions and document words from the engine (legacy and wizard snapshots alike), extend `ContractSnapshot` (optional `wizard`, `textAnnexes`, `costs.rows`, `costs.labels`, `sections[].handEdited`, kind `option`) and add the test-only draw log — refs: AC-3.2, AC-9.4 — deps: T3, T4, T11
  - domain: backend
  - touch: `crm-api/src/offers/contract.ts`, `crm-api/src/offers/contractPdf.ts`, `crm-api/src/offers/contractPdf.test.ts`, `crm-api/src/offers/contractPdf.numbering.test.ts`
  - done when: `[crm_test] bun test src/offers/contractPdf.test.ts src/offers/contractPdf.numbering.test.ts src/offers/offers.test.ts` passes — every legacy renderer golden is unchanged; the draw log of a legacy snapshot lists the same strings as before the refactor; a grep test finds no section/annex numbering or letter arithmetic left in `contractPdf.ts` (it calls `numberOffer` with `{ language, sections, annexes, effortAnnex, attachmentNames }` — the deal PDFs' file names, DD-46); a legacy snapshot without the new members still renders; plain surfaces (headings, cost descriptions, total and column labels) are drawn as text, never through `parseInline` — a cost description `**x**` prints the four characters, and a U+E000–U+E003 character in one is split out, not drawn (DD-47; a grep test finds no `parseInline` call on them)

- [x] T26: Draw what the seven texts need: text annexes (each from a new page, "ALLEGATO A – …" heading, the subtitle, the `intro` markup before the first section — DD-45 —, before the effort-detail annex), total rows over spans ("–" for an empty span), `option` lines with "□" and their position, optional cost column labels — refs: AC-4.1, AC-4.6, AC-4.7, AC-9.5 — deps: T25
  - domain: backend
  - touch: `crm-api/src/offers/contractPdf.ts`, `crm-api/src/offers/contract.ts`, `crm-api/src/offers/contractPdf.wizard.test.ts`
  - done when: `[crm_test] bun test src/offers/contractPdf.wizard.test.ts src/offers/contractPdf.test.ts` passes — draw-log assertions: AC-4.6's example prints "TOTALE primo anno" 1 500.00 and "TOTALE successivo" 150.00; an option line prints "□", its position after the counted lines and its total, and no total includes it; a text annex "A" is headed "ALLEGATO A – …" on a new page, its subtitle and intro (with an unnumbered `###`) drawn before its "1." section, the effort-detail annex is "ALLEGATO B", the index lists both; `@@costlabels` labels replace the default column headers; annex titles/subtitles, total labels and column labels are drawn as plain text split on the marker characters, never `parseInline` (DD-47); legacy goldens unchanged

- [x] T27: Extract the generation core (`loadContext`, `prepareOffer`, numbering, storage, compensation) from `offers.routes.ts` into `offers/generation.ts`, with no behaviour change — refs: AC-9.4 — deps: T15
  - domain: backend
  - touch: `crm-api/src/offers/generation.ts`, `crm-api/src/offers/offers.routes.ts`
  - done when: `[crm_test] bun test src/offers/offers.test.ts src/matrix.test.ts` passes unchanged; `bun run typecheck` passes; `offers.routes.ts` no longer defines `loadContext`/`prepareOffer`

- [x] T28: Move `OfferSchema` to `offerSchemas.ts` with `origin: "summary" | "sections" | "wizard"`; legacy prefill and `POST /deals/{id}/offers` refuse a wizard template (`409 template_format_mismatch`); legacy `/form` and `PUT` refuse a wizard offer (`409 offer_wizard`) — refs: AC-7.3, AC-9.4 — deps: T16, T27
  - domain: backend
  - touch: `crm-api/src/offers/offerSchemas.ts`, `crm-api/src/offers/offers.routes.ts`, `crm-api/src/offers/offers.wizardGuards.test.ts`, `crm-api/src/test-support/world.ts` (shared, append-only)
  - done when: `[crm_test] bun test src/offers/offers.wizardGuards.test.ts src/offers/offers.test.ts` passes — the offers list reports `origin` for an 018-summary `OF-…` offer, a legacy contract offer and a wizard offer row; the four refusals above; an 018-summary offer and a legacy contract offer still list, download and (legacy) edit as before

- [x] T29: Add the offer-drafts router: `GET /deals/{id}/offer-wizard/context` (carrying `today`, DD-41), `GET /deals/{id}/offer-draft`, `GET …/offer-draft/summary` and `POST …/offer-draft` for target `new` (answers built server-side with `initialAnswers` over a `WizardContext` whose `language` is the template's and `today` the server's UTC day), the generating gate checked before any draft lookup — refs: AC-2.1, AC-2.3, AC-2.4, AC-6.2, AC-6.4 — deps: T7, T16
  - domain: backend
  - touch: `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offer-drafts/context.ts`, `crm-api/src/offer-drafts/offerDrafts.test.ts`, `crm-api/src/index.ts`, `crm-api/src/matrix.test.ts`, `crm-api/src/test-support/world.ts` (shared, append-only)
  - done when: `[crm_test] bun test src/offer-drafts/offerDrafts.test.ts src/matrix.test.ts` passes — context returns client lines per language, contacts, place, attachments, estimate (ready / override / missing) and `today` (`YYYY-MM-DD`, the server's UTC day — the same function 018 uses for `issuedOn`, faked in the test) with `no-store`, and no `language` member (the browser takes it from the template); a `POST` on an Italian template for a deal whose context also has English lines stores the Italian client lines, and a `default: today` date field holds the server's day; `POST` prefill equals the legacy `buildDraft` values for the same deal (epics, phases, timeline, man-days incl. AI, deal amount, per-release split) using the shared `draft.test.ts` fixture; no ready estimate and no override → 409 `estimate_not_ready`; 428 without `If-None-Match: *`, 409 `draft_exists`; summary is `{ draft: null }` without a draft and, with one, carries template/target/`version`/`updatedBy`/`updatedAt`/`templateChanged` and no answer value in its bytes, `ETag` = version, `no-store`; matrix: manage+financials in scope 200; financials without manage, manage without financials, out of scope → 403 with the same body whether a draft exists or not; `GET /deals/{id}` and the offers list contain no draft data

- [x] T30: Add `PUT …/offer-draft` (If-Match, strict zod caps, reserved characters, "⟦"/"⟧" and "⟪"/"⟫" except an exact "⟪REF⟫" in a hand edit's body (DD-52), options check when `templateVersion` is current — DD-38, deep-equal no-op — DD-31, 413 over 512 KiB), `DELETE …/offer-draft` and `POST …/offer-draft/template` (`switchTemplate`) — refs: AC-1.8, AC-5.1, AC-6.1, AC-6.3, AC-6.5, AC-8.4 — deps: T29
  - domain: backend
  - touch: `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offer-drafts/answersSchema.ts`, `crm-api/src/offer-drafts/offerDrafts.write.test.ts`, `crm-api/src/matrix.test.ts`
  - done when: `[crm_test] bun test src/offer-drafts/offerDrafts.write.test.ts src/matrix.test.ts` passes — reserved characters and options are checked with the engine's `checkAnswers` (`{ options: false }` for a stale `templateVersion`), never re-implemented; `client.date` is checked for shape only — a real `YYYY-MM-DD` 200 days from today is saved (the ±90-day window is the resolver's, DD-42), `2026-02-30` → 422 `{ path: "client.date" }`; `PUT`/`GET` round trip; stale `If-Match` → 409 and the other version intact; no header → 428; a body deep-equal to the stored one → 200, same version, `updatedAt` unchanged; a value outside its field's options with a current `templateVersion` → 422 `answers_invalid` `{ path: "fields.<NAME>" }`, with a stale one → 200; "⟦" in a hand edit or U+E000 in a field → 422 with its path; "⟪REF⟫" in a hand edit's body → 200, in its heading or in a field → 422 with its path, a stray "⟫" in a body → 422 (DD-52); > 512 KiB → 413; `DELETE` with If-Match → 204, stale → 409; template switch keeps client lines, contacts, place, date; every new route in the matrix

- [x] T31: Build the wizard offer's snapshot in `generation.ts` from `resolveOffer` + `computeCosts` (018 `ContractSnapshot` + `wizard`, `textAnnexes`, `costs.rows`/`labels`, `handEdited`; `issuedOn` = the printed date, DD-16) — refs: AC-3.2, AC-6.6, AC-4.6 — deps: T10, T26, T27
  - domain: backend
  - touch: `crm-api/src/offers/generation.ts`, `crm-api/src/offers/generation.wizardSnapshot.test.ts`
  - done when: `[crm_test] bun test src/offers/generation.wizardSnapshot.test.ts` passes — for a fixture template + answers + context the snapshot holds `wizard.answers` and `templateVersion`, the resolved sections and text annexes in order, `costs.oneOffCents` = `computeCosts(...).oneOffCents` (placement-invariant), option lines kind `option`, and renders without error; the template source is not stored (DD-20)

- [x] T32: Add `POST …/offer-draft/generate` for target `new`: If-Match, template version pin (`409 template_changed`), estimate gate, 422 `offer_incomplete` equal to `resolveOffer(...).missing/.invalid`, transaction with 018 numbering, render, store, insert, `DELETE` of the draft at its version, compensation, content-free log line — refs: AC-1.1, AC-2.2, AC-2.4, AC-3.5, AC-3.6, AC-4.3, AC-4.6, AC-5.4, AC-6.6, AC-8.4 — deps: T28, T30, T31
  - domain: backend
  - touch: `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offers/generation.ts`, `crm-api/src/offer-drafts/offerDrafts.generate.test.ts`, `crm-api/src/matrix.test.ts`, `crm-api/src/test-support/world.ts` (shared, append-only)
  - done when: `[crm_test] bun test src/offer-drafts/offerDrafts.generate.test.ts src/matrix.test.ts` passes — a complete draft → 201, reference `0001/<year>` then `r1`, `offer.language` = the template's, `priceCents` = `oneOffCents`, draft gone; a draft with a missing field, an invalid percentage, an over-span discount, an extra percentage discount in a two-total table, an over-long hand edit and a printed date 91 days from the server's day (`client:date`, DD-42) → 422 whose `missing`/`invalid` deep-equal `resolveOffer` of the same stored draft (names and labels only, no values), no offer row, no stored object, draft kept; the first resolve runs without a reference (a template printing `[RIF]` is not incomplete for it) and the snapshot's text carries the assigned reference from the second resolve with `{ reference }` (DD-44); a T3 draft whose "Parametri del servizio" and "Condizioni generali" are hand-edited from `resolveSectionForEdit` (so carrying "⟪REF⟫") is not incomplete and its snapshot text prints the assigned reference in both sections, with no "⟪"/"⟫" anywhere (DD-52); a draft with `client.date` null is issued on the server's day; 11 cost lines → `too_many_cost_lines` inside `offer_incomplete`; template edited since → 409 `template_changed`; no estimate → 409; a forced render failure keeps the draft and leaves no object; a stale draft version → 409 and nothing created

- [x] T33: Support edit and revision targets: `POST …/offer-draft` with `target: edit | revision` (optional `templateId`, DD-28; reconcile the snapshot's answers or switch; legacy offer → `initialAnswers` + its client data or 422 `template_required`) and their generate branches (edit CAS on `targetOfferVersion`, same reference; revision → next `rN`, sent offer untouched) — refs: AC-6.6, AC-7.1, AC-7.2, AC-7.3 — deps: T32
  - domain: backend
  - touch: `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offers/generation.ts`, `crm-api/src/offer-drafts/offerDrafts.target.test.ts`
  - done when: `[crm_test] bun test src/offer-drafts/offerDrafts.target.test.ts` passes — edit of an unsent wizard offer without `templateId` → the snapshot's template and its answers, hand edits included; snapshot's template archived → 409 `template_archived` `{ templateId }`; another `templateId` → client lines/contacts/place/date kept, rest initial; generate edit → same reference, offer version + 1, old PDF replaced; offer sent meanwhile → 409 `offer_sent`; stale offer version → 409 `offer_changed`; revision of a sent wizard offer → next `rN`, sent row and object unchanged; legacy contract offer with `templateId` → its client lines and contacts prefilled, without → 422; 018-summary offer → 409 `offer_legacy`; a target offer of another deal → 404; a revision draft of an offer dated more than 90 days ago keeps that date and its generate is 422 `offer_incomplete` with `client:date` until a new date is set (DD-42)

- [x] T34: Prove preview ≡ PDF: for each of the seven seeds with `sampleAnswers` and a fixed context, the renderer's draw log equals `documentText(resolveOffer, numberOffer, computeCosts)` after whitespace/line-wrap normalisation; annex headings and "Allegati:" lines included — refs: AC-3.2, AC-9.5 — deps: T24, T32
  - domain: backend
  - touch: `crm-api/src/offers/parity.test.ts`, `crm-api/src/test-support/documentText.ts`
  - done when: `[crm_test] bun test src/offers/parity.test.ts` passes for all seven seeds — `documentText` built from `resolveOffer(…, { reference })` and `numberOffer({ …, attachmentNames })` with `sampleContext("it")` — including section and sub-heading numbers, annex letters, annex intros, cost positions, span totals and document words; `documentText` reads plain surfaces by splitting on the marker characters, never `parseInline` (DD-47); a deliberately altered draw (test of the test) makes it fail

- [x] T35: Golden fidelity: each seed's printed text with the T18 answers equals the mockup's golden text except exactly the AC-9.6 differences (the test's normalisation allow-list is that list and nothing else); fix the seed texts where it fails — refs: AC-9.1, AC-9.6 — deps: T18, T34
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/fidelity.test.ts`, `crm-api/src/offer-templates/wizardSeeds/goldenAnswers.ts`, `crm-api/src/offer-templates/wizardSeeds/welldChIt.*.ts`
  - done when: `goldenAnswers.ts` maps a golden answers file (mockup state: `f`, `g`, `lists`, `rows`, `c` internal cost keys, `x` extras; `tpl` `T13` = code `T1+T3`) to `WizardAnswers`, applying the catalog's renames (`rows.MODULO[].ORE` → `ORE_MODULO`, DD-48 — no rename written in the test) and the system values (`CLIENTE`/`INDIRIZZO_CLIENTE` → client lines, `DATA` → `client.date` with `context.today` = the capture day 2026-11-15, `RIF` → the `reference` option); `[crm_test] bun test src/offer-templates/wizardSeeds/fidelity.test.ts` passes for all seven codes and every `golden/variants/` file; the allow-list has exactly six entries (CRM-drawn header/acceptance/"Allegati:", renderer section numbers, 018 annex heading style, T5 annex picker, deal currency for a literal "CHF", no width hints); the conversion tests T19–T23 still pass

- [x] T36: Prove nothing is entity-, language- or currency-specific: a welld_it English wizard template created through the API generates end to end on an EUR deal — refs: AC-9.3, AC-2.5 — deps: T17, T32
  - domain: backend
  - touch: `crm-api/src/offer-drafts/crossEntity.test.ts`
  - done when: `[crm_test] bun test src/offer-drafts/crossEntity.test.ts` passes — the English template supersedes welld_it's English legacy templates only; the generated PDF's draw log prints every amount and the `source: currency` field as EUR, with the English document words; welld_ch Italian is untouched

- [x] T37: Add a script that renders the seven seeds with sample answers to PDFs, for the owner's review before release (plan R2) — refs: AC-9.1 — deps: T24, T31
  - domain: backend
  - touch: `crm-api/scripts/render-wizard-samples.ts`, `crm-api/scripts/render-wizard-samples.test.ts`
  - done when: `cd crm-api && bun test scripts/render-wizard-samples.test.ts` passes (seven non-empty PDFs written to a temp dir, no DB, no bucket); `bun scripts/render-wizard-samples.ts --out <dir>` writes `T1.pdf` … `T1+T3.pdf`

## crm-ui

- [x] T38: Add every wizard and template-editor string of design § Copy keys, `en` + `it` — refs: AC-10.1 — deps: none
  - domain: frontend
  - touch: `crm-ui/src/strings/offerWizard.ts`, `crm-ui/src/strings/offers.ts`, `crm-ui/src/strings/templates.ts`, `crm-ui/src/strings.ts`, `crm-ui/src/strings.test.ts`
  - done when: `cd crm-ui && pnpm test src/strings.test.ts` passes (`catalogGaps` finds no gap for the new namespace and the additions); every key of design.md § Copy keys exists; `pnpm build` passes

- [x] T39: Add the API client and types for the wizard (templates `formats`, wizard template body, context, draft view/summary, `POST`/`PUT`/`DELETE`/template/generate, `offer_incomplete`), the error-code mapping, and the fake API handlers — refs: AC-6.1, AC-6.4, AC-8.1 — deps: T17, T33, T38
  - domain: frontend
  - touch: `crm-ui/src/lib/crmApi.ts`, `crm-ui/src/lib/types.ts`, `crm-ui/src/lib/offerErrors.ts`, `crm-ui/src/lib/offerDraftApi.test.ts`, `crm-ui/src/test-support/fakeApi.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/lib/offerDraftApi.test.ts` passes — each call sends `If-Match`/`If-None-Match` as the plan says and exposes the `ETag`; every new error code of plan § API contracts maps to a strings key; a 422 `offer_incomplete` body is returned typed, not thrown as text; `pnpm build` passes

- [x] T40: Implement `useOfferDraft` — in-memory state, autosave 1 s after the last content change (≤ 5 s while typing), step changes ride on the next content save, one request in flight with the latest `ETag`, 409 stop + reload banner, backoff on network errors, `beforeunload` while pending, `reconcileAnswers` on a changed template; plus the no-browser-storage guard — refs: AC-6.1, AC-6.3, AC-6.7, AC-8.4 — deps: T14, T39
  - domain: frontend
  - touch: `crm-ui/src/hooks/useOfferDraft.ts`, `crm-ui/src/hooks/useOfferDraft.test.tsx`, `crm-ui/src/lib/noBrowserStorage.test.ts`, `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/hooks/useOfferDraft.test.tsx src/lib/noBrowserStorage.test.ts` passes — fake timers: one `PUT` after the debounce with `If-Match`; clicking through steps issues no `PUT`, the next content save carries the current `lastStep`; a 409 stops saving and exposes the conflict state; a network error retries with backoff and reports "not saved yet"; a draft whose `templateVersion` differs is reconciled, saved and reports dropped names and orphaned edits; the static scan finds no `localStorage`/`sessionStorage`/`indexedDB` in `src/**/offerWizard*`, `src/hooks/useOfferDraft.ts` and `src/lib/offerEngine/**`, and `Storage.prototype` spies stay unused through a hook run

- [x] T41: Build the `OfferWizard` core frame: steps as `Tabs` from `outline()` (only non-empty steps, missing counts per tab), Back/Next and visited tabs without losing answers, `WizardActionBar` (progress, Generate `aria-disabled` with missing/invalid counts), `SaveStatus`, `TemplateText`, the `StepPanel` dispatch, `mode: deal | sample` — refs: AC-1.2, AC-1.6, AC-3.5 — deps: T14, T38
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/OfferWizard.tsx`, `crm-ui/src/components/offerWizard/StepPanel.tsx`, `crm-ui/src/components/offerWizard/WizardActionBar.tsx`, `crm-ui/src/components/offerWizard/SaveStatus.tsx`, `crm-ui/src/components/offerWizard/TemplateText.tsx`, `crm-ui/src/components/offerWizard/OfferWizard.test.tsx`, `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/OfferWizard.test.tsx` passes — a template with nothing for Conditions shows no Conditions tab; filling step 2, jumping to 4 and back via tab and via Back keeps the values; Generate is `aria-disabled` with "{m} missing · {c} to correct" while `ResolvedOffer.missing`/`.invalid` are non-empty; `pnpm lint` passes

- [x] T42: Build the generic step form for Scope/Conditions: `FieldInput` by kind (select when `options`, `MoneyInput` in the deal currency for `amount`), visible "optional" tag (DD-36), `*` + `aria-required`, derived fields read-only, `BlockSwitch`, `BlockChoice`, `fills` with the "Fills: …" hint, the hand-edited-section notice on a field — refs: AC-1.3, AC-1.4, AC-1.5, AC-1.8, AC-1.9, AC-4.5, AC-5.2 — deps: T41
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/StepForm.tsx`, `crm-ui/src/components/offerWizard/FieldInput.tsx`, `crm-ui/src/components/offerWizard/BlockSwitch.tsx`, `crm-ui/src/components/offerWizard/BlockChoice.tsx`, `crm-ui/src/components/offerWizard/StepForm.test.tsx`, `crm-ui/src/components/offerWizard/StepPanel.tsx` (shared, append-only), `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/StepForm.test.tsx` passes — label, hint, example, default per kind; an `amount` field is a `MoneyInput` in the deal's currency; an optional field shows "optional" and is never counted missing; a block switch shows label + explanation at its default and hides/shows its children; a choice is a radio group with exactly one selected; a field with options is a select offering exactly them; choosing an option that fills sets the targets and announces it, a later edit stands, switching off keeps values (O3); a derived field is read-only with `aria-readonly`; a field used by a hand-edited section shows the notice naming it; every change goes through the engine's `setField`/`setBlock`/`chooseOption` (a grep finds no fills logic in `src/components/offerWizard/`); items are placed and nested exactly as `outline(ast, answers)` returns them (DD-43 — e.g. a choice's option contents beside the choice, not under it)

- [x] T43: Build `ListFieldEditor` and `RepeatableTableEditor` (add, remove, move up/down, labelled icon buttons, focus to neighbour on remove) inside the step form — refs: AC-1.7 — deps: T42
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/ListFieldEditor.tsx`, `crm-ui/src/components/offerWizard/RepeatableTableEditor.tsx`, `crm-ui/src/components/offerWizard/CollectionEditors.test.tsx`, `crm-ui/src/components/offerWizard/StepForm.tsx`, `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/CollectionEditors.test.tsx` passes — add/remove/reorder updates the answers in order and the resolved document follows; empty items/rows are kept in the form but absent from `resolveOffer` output; icon buttons name the item ("Remove item 2 of …")

- [x] T44: Build `CostTableEditor` for the Costs step: template lines (description, unit, quantity, total), total rows in document formatting, unit/quantity bound to their fields, extra lines add/remove up to 10, columns and "show totals" switches, validity, the amount-only discount when two or more total rows are present (DD-39), `invalid` shown on the line by name — refs: AC-2.5, AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.6, AC-4.7 — deps: T41
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/CostTableEditor.tsx`, `crm-ui/src/components/offerWizard/CostTableEditor.test.tsx`, `crm-ui/src/components/offerWizard/StepPanel.tsx` (shared, append-only), `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/CostTableEditor.test.tsx` passes — editing `[TARIFFA]` in the line changes the field and vice versa; the 11th line is refused (`aria-disabled` Add with the reason); a line in an off block is not shown; with two total rows the discount offers an amount only and a stored percentage is listed as `percent_discount_multi_total` with the toggle kept; an option line shows its price and is excluded from the totals; amounts show the deal currency; a field used only by the table (an outline item of the Costs step, DD-43) is edited in the table; descriptions and total labels come from `ResolvedOffer.costs.rows` (stripped plain text) and a missing value in a description shows as a marked run split on the marker characters, never `parseInline` (DD-47)

- [x] T45: Build the Client step (client lines 1–8, contacts ≤ 5 as `CheckboxGroupField`, place, printed date, the reference shown as "assigned when the offer is generated") and the Annexes step (template annex items, effort-detail annex switch, AI-assisted, deal PDFs ≤ 5) — refs: AC-2.1, AC-2.2, AC-2.5, AC-9.6 — deps: T41
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/ClientStep.tsx`, `crm-ui/src/components/offerWizard/AnnexesStep.tsx`, `crm-ui/src/components/offerWizard/ClientAnnexes.test.tsx`, `crm-ui/src/components/offerWizard/StepPanel.tsx` (shared, append-only), `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/ClientAnnexes.test.tsx` passes — prefilled client lines, contacts and place are editable and the resolved document follows; the reference is never an input; a sixth contact or PDF cannot be chosen; a printed date 91 days from the context's `today` shows the `client:date` `date_out_of_range` error on the date input (label from the strings module, the issue's label is null — DD-42); the Annexes step lists the deal's PDFs as the only annex picker (no free "Allegati" field)

- [x] T46: Build `DocumentPreview` on the `paper-*` tokens: React elements only, numbers/letters from `numberOffer` (`attachmentNames` = the chosen PDFs' names), cost rows from `computeCosts` in document formatting, missing as a highlighted "⟦Label⟧" run with a hidden "Missing:" prefix, pending reference run, annex subtitles and intros, "Edited by hand" caption, `lang` = template language; plain surfaces split on the marker characters, never `parseInline` (DD-47); beside the form at ≥ 1 280 px, in a `Drawer` below; re-resolved 250 ms after the last change — refs: AC-3.1, AC-3.2, AC-3.3, AC-5.2 — deps: T1, T41
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/DocumentPreview.tsx`, `crm-ui/src/components/offerWizard/DocumentPreview.test.tsx`, `crm-ui/src/components/offerWizard/OfferWizard.tsx`, `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/DocumentPreview.test.tsx` passes — fake timers: a change is visible in the preview within 1 s; a narrow viewport shows the Drawer trigger instead; the preview's text equals `documentText` of the same `ResolvedOffer` (section numbers, annex letters, span totals and "–" included); a missing field renders a `mark` with its label — also inside a section heading, an annex title and a cost description, where the heading is composed from `numberOffer`'s number and the split text (no "?" shown for a marker, DD-46); a value `**x**` in a heading or cost description renders the literal characters; no `dangerouslySetInnerHTML` in `src/components/offerWizard/` (grep in the test); `pnpm lint` passes (token utilities only)

- [x] T47: Build the Preview step: `IssuesList` from `ResolvedOffer.missing`/`.invalid` (or a 422 `offer_incomplete` body as is), selecting an issue switches step and focuses its target by `name` (field, table cell, cost row, `cost:*` card heading, section Edit text button) via `focusFirstInvalid`; the sections table — refs: AC-3.4, AC-3.5, AC-3.6 — deps: T42, T43, T44, T45, T46
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/PreviewStep.tsx`, `crm-ui/src/components/offerWizard/IssuesList.tsx`, `crm-ui/src/components/offerWizard/PreviewStep.test.tsx`, `crm-ui/src/components/offerWizard/StepPanel.tsx` (shared, append-only), `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/PreviewStep.test.tsx` passes — every missing field and every invalid answer is listed with its label and reason; selecting a missing field, an invalid derived field, a cost line issue, a section issue and `client:date` (label null → the strings module's printed-date label) each opens the right step and focuses the element carrying `data-wizard-field="{name}"`; a derived field is never listed as missing; a 422 body replaces both lists

- [x] T48: Build the hand-edit dialog (`FormDialog` from `resolveSectionForEdit`, token warning, save refused while "⟦"/"⟧" or a stray "⟪"/"⟫" remain (`findTokens` on the body, `findTokens(…, "heading")` on the heading) with caret on the first token, "⟪REF⟫" in the body allowed with a note that it becomes the offer reference (DD-52), heading ≤ 120 / body ≤ 20 000) and Restore (`ConfirmDialog` naming the section and what is lost), with the "Edited by hand" badge in the sections table — refs: AC-5.1, AC-5.2, AC-5.3, AC-5.4 — deps: T47
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/HandEditDialog.tsx`, `crm-ui/src/components/offerWizard/HandEditDialog.test.tsx`, `crm-ui/src/components/offerWizard/PreviewStep.tsx`, `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/HandEditDialog.test.tsx` passes — Edit text opens the resolved section with "⟦Label⟧" tokens and the warning; Save is refused (field error, caret on the token) while a token remains, also for a field filled since; a section whose wizard text prints the reference opens with "⟪REF⟫", shows the note (en/it strings), and saves with it; "⟪REF⟫" typed into the heading, or a stray "⟪", is refused with the caret on it; heading > 120 / body > 20 000 refused; after save the section is badged and a field change no longer alters it; Restore asks for confirmation naming the section, then the wizard's text returns

- [x] T49: Build the Template step: active wizard templates of the deal's entity grouped by language (name, description, uses), "Classic templates" for languages without a wizard template (opens `GenerateOfferDialog`), estimate banner and disabled cards when no estimate, unsent-latest-offer banner, template switch with confirmation — refs: AC-1.1, AC-2.4, AC-6.5, AC-7.3 — deps: T39, T41
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/TemplateStep.tsx`, `crm-ui/src/components/offerWizard/TemplateStep.test.tsx`, `crm-ui/src/components/offerWizard/StepPanel.tsx` (shared, append-only), `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/offerWizard/TemplateStep.test.tsx` passes — cards grouped by language with name, description, uses; a language with only legacy templates appears under "Classic templates" and opens the legacy dialog; `estimate.state === "missing"` shows the banner and `aria-disabled` "Use template"; choosing another template on an existing draft asks for confirmation and keeps client lines and contacts

- [x] T50: Add the `OfferWizardPage` at `/crm/deals/$id/offer` (`?step=`, `lastStep`, no draft until a template is chosen), wiring context, `useOfferDraft`, generate and its errors (S9/S10: conflict banner, template-changed notice with dropped answers, 422 lists), the `wide` route in `CrmShell` — refs: AC-1.6, AC-3.5, AC-6.1, AC-6.3, AC-8.4 — deps: T40, T46, T47, T48, T49
  - domain: frontend
  - touch: `crm-ui/src/pages/OfferWizardPage.tsx`, `crm-ui/src/pages/OfferWizardPage.test.tsx`, `crm-ui/src/router.tsx`, `crm-ui/src/components/CrmShell.tsx`, `crm-ui/src/components/CrmShell.test.tsx`, `crm-ui/src/components/offerWizard/OfferWizard.tsx`, `crm-ui/src/strings/offerWizard.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/pages/OfferWizardPage.test.tsx src/components/CrmShell.test.tsx` passes (fake API) — opening without a draft shows the Template step and issues no write; choosing a template creates the draft; reopening lands on `lastStep` or `?step=`; a 409 on save shows "Someone else changed this draft — reload"; a changed template shows the notice with the dropped answers; Generate with a 422 replaces the lists; a successful generate navigates to the deal; the engine's `WizardContext` is the context response plus `language` = the draft template's language and `today` = the response's `today` — with the UI in English and an Italian template the preview prints the Italian client lines and document words, and the browser clock is never read (a test with a faked browser date one year off changes nothing, DD-41); the route is `wide`; `pnpm build` passes

- [x] T51: Extend `OffersCard`: draft row from `GET …/offer-draft/summary` (template, target, "changed by X, date", Continue, Discard with confirmation and `If-Match`, 409 → refetch) fetched only with `financials` and manage for the deal's entity; Edit/New revision by `origin` (wizard → draft without `templateId`; sections → legacy dialog or wizard by template availability; existing draft offered first) — refs: AC-6.2, AC-6.4, AC-7.1, AC-7.2, AC-7.3 — deps: T39, T50
  - domain: frontend
  - touch: `crm-ui/src/components/OffersCard.tsx`, `crm-ui/src/pages/DealDetailPage.tsx`, `crm-ui/src/components/OffersCard.wizard.test.tsx`, `crm-ui/src/strings/offers.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/components/OffersCard.wizard.test.tsx src/pages/DealDetailPage.test.tsx src/pages/DealSalesFlow.test.tsx` passes — no summary request without `financials` or without manage for the entity; with a draft: author/time, Continue opens the wizard, Discard confirms and sends the summary's version, a 409 refetches and says so; Edit of a wizard offer posts a draft without `templateId`; a legacy contract offer opens the legacy dialog when its (entity, language) has no wizard template, else the wizard's Template step with the target; legacy dialog tests unchanged

- [x] T52: Extend Settings › Templates and the template editor's wizard branch: format badge and description in `TemplatesCard`; editor with name, language, description, uses, monospace text with `Line n, col m`, the outline from `outline(ast, null)`, the problems list (select → caret to the line), Save `aria-disabled` on errors, If-Match, `last_template`/`template_superseded` mapped; extended `MarkupHelp` — refs: AC-8.1, AC-8.2, AC-8.3, AC-9.2 — deps: T14, T38, T39
  - domain: frontend
  - touch: `crm-ui/src/components/TemplatesCard.tsx`, `crm-ui/src/pages/TemplateEditorPage.tsx`, `crm-ui/src/components/templateEditor/OutlineView.tsx`, `crm-ui/src/components/templateEditor/ProblemsList.tsx`, `crm-ui/src/components/templateEditor/TemplateTextArea.tsx`, `crm-ui/src/components/MarkupHelp.tsx`, `crm-ui/src/pages/TemplateEditorWizard.test.tsx`, `crm-ui/src/strings/templates.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/pages/TemplateEditorWizard.test.tsx src/pages/OfferTemplates.test.tsx` passes — rows show Wizard/Classic; Create and Duplicate open the wizard editor, legacy rows the 018 editor; typing updates the outline (steps → sections → items under blocks, optional/derived/Fills); an unclosed block lists the problem with its line, selecting it moves the caret there, Save is `aria-disabled`; a 422 `template_invalid` shows the server problems; archive of the last template and restore of a superseded one show their messages

- [x] T53: Add the editor's "Try the wizard" view: the `OfferWizard` in `sample` mode on the unsaved text with `sampleContext(<editor's language>)` and `sampleAnswers`, no deal, no draft, no API write — refs: AC-8.5 — deps: T47, T48, T52
  - domain: frontend
  - touch: `crm-ui/src/pages/TemplateEditorPage.tsx`, `crm-ui/src/components/templateEditor/TryWizardView.tsx`, `crm-ui/src/pages/TemplateEditorTry.test.tsx`, `crm-ui/src/strings/templates.ts` (shared, append-only)
  - done when: `cd crm-ui && pnpm test src/pages/TemplateEditorTry.test.tsx` passes — an edit to the text not yet saved appears in the Try view's steps and preview; the fake API records no draft or template request during the session; switching views keeps the typed text

## End to end, operations, release

- [x] T54: Write the wizard journeys through the shell: new offer from a seeded template on a welld_ch deal, fill, reload and resume on a second browser context, Generate blocked then generated, draft row on the deal page, two contexts saving the same draft (one only navigating steps gets no conflict) — refs: AC-1.1, AC-3.5, AC-6.1, AC-6.3, AC-6.4, AC-9.1 — deps: T24, T50, T51
  - domain: frontend
  - touch: `shell/e2e/crm-offer-wizard.spec.ts`, `shell/e2e/helpers/crmOfferFixtures.ts`
  - done when: with the stack up (`mise run dev`), `cd shell && pnpm e2e crm-offer-wizard.spec.ts` passes; fixtures set up deals, contacts and the estimate state through crm-api's REST API with seeded sessions (adminSession/seedSession), never through the UI

- [x] T55: Write the edit, revision and template-editor journeys through the shell: edit an unsent wizard offer (same reference), revise a sent one (next `rN`), a legacy contract offer still opening the legacy dialog for welld_ch English, create a wizard template in Settings and try it with sample answers — refs: AC-7.1, AC-7.2, AC-7.3, AC-8.1, AC-8.5 — deps: T53, T54
  - domain: frontend
  - touch: `shell/e2e/crm-offer-wizard-revise.spec.ts`, `shell/e2e/helpers/crmOfferFixtures.ts`
  - done when: with the stack up, `cd shell && pnpm e2e crm-offer-wizard-revise.spec.ts` passes, and `pnpm e2e crm-offer-wizard.spec.ts` still passes

- [x] T56: Document the rollout in `infra/README.md`: deploy order (crm-api → shell with the tokens → crm-ui, never the UI first — R4), the pre-deploy count of templates and offer snapshots containing a backslash before a markup character (R13), and the supersession rollback SQL (R11) — refs: AC-9.2, AC-9.4 — deps: T17, T24
  - domain: devops
  - touch: `infra/README.md`
  - done when: `infra/README.md` has a "CRM offer wizard rollout" section with the three items; the R13 query and the rollback SQL run without error against `crm_test` after `bun run db:deploy` (pasted output of `psql <crm_test url> -f` on each snippet in the PR description)

- [x] T57: Record the release intent: one changeset for `@operai/crm-api` (minor), `@operai/crm-ui` (minor), `@operai/ui` (minor: new tokens) and `@operai/shell` (patch: ships the library with the tokens) — refs: — (process task, no AC; AGENTS.md § Git) — deps: none
  - domain: devops
  - touch: `.changeset/crm-offer-wizard.md`
  - done when: `mise run changeset:check` passes; the file names exactly those four packages (names as in each `package.json`, apps listed in `lerna.json`)

- [x] T59: Spike the letterhead renderer: pin `pdfjs-dist` exactly, render page 1 to an image on the main thread under the production CSP, check both real letterheads and the CRM bucket CORS (L0) — refs: AC-11.1, AC-11.7, R21, R22, O9 — deps: none
  - domain: frontend
  - touch: `crm-ui/package.json`, `crm-ui/pnpm-lock.yaml`, `crm-ui/src/lib/letterhead/**`, `shell/e2e/fixtures/letterhead-a4.pdf`, `infra/README.md`
  - done when: `renderLetterhead` unit tests pass; a production-CSP browser run shows 0 CSP violations and no Worker/blob/wasm attempt, both real letterheads rendered (screenshots in the scratchpad); `infra/README.md` rollout lists the bucket-CORS check; a NO-GO stops T64–T67 and goes to the owner

- [x] T60: Engine — `issuerAddress` system value, CRM-supplied values print nothing when empty and are never missing, `systemRead`, `suppliedFields`, hostile-name vectors, no /welld/i in samples (I1, DD-57, DD-58) — refs: AC-12.1, AC-12.2, AC-12.9, AC-12.12, AC-12.13 — deps: none
  - domain: backend
  - touch: `crm-api/src/offers/engine/{syntax,answers,resolve,outline}.ts`, `crm-api/src/offers/engine/*.test.ts`, `crm-api/src/offers/engine/vectors/*.json`, `crm-ui/src/lib/offerEngine/{syntax,answers,resolve,outline}.ts`, `crm-ui/src/lib/offerEngine/vectors/*.json`, `crm-ui/src/lib/offerEngine.vectors.test.ts`
  - done when: both engine copies byte-identical (`bun scripts/check-shared-copies.ts`), new vectors pass in both runners (crm-api `[crm_test] bun test src/offers/engine`, crm-ui `pnpm test offerEngine`), the purity test refuses /welld/i in sample data

- [x] T61: Seeds v2 — `[EMITTENTE]` for every "WellD Sagl", SLA parties row `[EMITTENTE]{{?INDIRIZZO_EMITTENTE::, [INDIRIZZO_EMITTENTE]}}`, v1 digests, fidelity run twice, sample script args (I3, DD-59, DD-63, DD-64) — refs: AC-12.3, AC-12.10, AC-9.6 — deps: T60
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/*.ts` (not `golden/**`, not `upgrade.ts`), `crm-api/src/offer-templates/wizardSeeds/*.test.ts`, `crm-api/scripts/seed-digests.ts`, `crm-api/scripts/render-wizard-samples.ts`
  - done when: no seed contains "WellD Sagl" or "Via Pessina"; fidelity test passes both runs (mockup name/address = golden; "wellD SA" = exactly the two new differences); `toV1(v2)` reproduces the stored v1 digests; `[crm_test] bun test src/offer-templates` passes

- [x] T62: Context, generate and letterhead link — `issuerLegalName`/`issuerAddressLines`/`letterhead` in the wizard context, blank legal name refused at generate (409 `entity_profile_missing`), `no-store` on the letterhead link, OpenAPI (I2, DD-54, DD-61) — refs: AC-12.2, AC-12.4, AC-12.7, AC-11.3, AC-11.7, AC-11.8 — deps: T60
  - domain: backend
  - touch: `crm-api/src/offer-drafts/{context,offerDrafts.routes}.ts`, `crm-api/src/offer-drafts/*.test.ts`, `crm-api/src/offers/{generation.ts,parity.test.ts,generation.wizardSnapshot.test.ts}`, `crm-api/src/entity-profiles/**`
  - done when: `[crm_test] bun test` passes with new tests for each AC listed; `bun run typecheck` clean; an offer already generated keeps its snapshot text after the profile name changes

- [x] T63: One-time v1→v2 seed upgrade inside the lazy seeding, under the entity lock, exact-digest match only, "kept" for edited rows, never revisited (I4, DD-60) — refs: AC-12.5, AC-12.6, AC-12.11, AC-8.4 — deps: T61
  - domain: backend
  - touch: `crm-api/src/offer-templates/wizardSeeds/upgrade.ts`, `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.seed*.test.ts`
  - done when: `offerTemplates.seedUpgrade.test.ts` passes on crm_test: untouched v1 (active and archived) → v2 text, version +1, archived stays archived; edited / duplicated / name-taken → unchanged and never revisited; a second run changes nothing; drafts on an upgraded template get the AC-8.4 notice

- [x] T64: Letterhead fetch and `useLetterhead` hook — one attempt per opening, 10 s budget, ≤ 5 MiB, `%PDF-`, no credentials/cache/storage, `unknown` input keeps `pending` (design G11), decode before `shown` (G12), context type members and every crm-ui context fixture (L1) — refs: AC-11.4, AC-11.7, AC-11.8, AC-11.9 — deps: T59, T62
  - domain: frontend
  - touch: `crm-ui/src/lib/crmApi.ts`, `crm-ui/src/lib/types.ts`, `crm-ui/src/components/offerWizard/useLetterhead*.ts`, `crm-ui/src/pages/*.test.tsx`
  - done when: hook tests cover pending/shown/none/failed (fetch error, timeout, oversize, non-PDF, undecodable), no retry, no refetch on re-render; `pnpm lint && pnpm test` pass

- [x] T65: Preview on the letterhead — A4 box behind the first page (img alt="" aria-hidden, no filter in dark), the four-state band above the paper, the missing-address notice from the settled `systemRead`, Drawer shares the attempt; strings en+it (L2, DD-55, DD-56, design F14/F15, D-22…D-32) — refs: AC-11.1, AC-11.2, AC-11.3, AC-11.4, AC-11.5, AC-11.6, AC-3.2, AC-12.12 — deps: T60, T64
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/{DocumentPreview,OfferWizard}.tsx`, `crm-ui/src/components/offerWizard/{DocumentPreview,OfferWizard}*.test.tsx`, `crm-ui/src/strings/offerWizard.ts`, `crm-ui/src/pages/OfferWizardPage.tsx`, `crm-ui/src/pages/OfferWizardPage.test.tsx`
  - re-sync 2026-11-15: the page's context mapping (`issuerAddressLines`) and `useLetterhead` wiring moved here from T66 so the preview can be rendered; T66 keeps the blank-name reason, the Try view, the outline group and G15
  - done when: component tests for each band state, the notice, no tab stop added, no layout shift (box reserved); the D19 fit tests stay green; RENDERED in a browser at 1280 and 1024 (Drawer), light and dark, screenshots recorded; `pnpm lint && pnpm test && pnpm build` pass

- [x] T66: Pages — context mapping and hook wiring on the wizard page, blank-legal-name Generate reason (DD-61), Try view with the profile's name/address/letterhead or marked samples (DD-62), editor outline "Supplied by the CRM"; the Preview card no longer says "You can generate" while Generate is blocked by any reason (design G15) (L3) — refs: AC-12.7, AC-12.8, AC-12.13, AC-12.1, AC-12.9, AC-8.5, AC-11.9 — deps: T62, T65
  - domain: frontend
  - touch: `crm-ui/src/pages/OfferWizardPage*.tsx`, `crm-ui/src/components/templateEditor/{TryWizardView,OutlineView}*.tsx`, `crm-ui/src/components/offerWizard/PreviewStep.tsx`, `crm-ui/src/components/offerWizard/PreviewStep*.test.tsx`, `crm-ui/src/strings/templates.ts`, `crm-ui/src/strings/offerWizard.ts`
  - done when: page/editor tests for each AC listed pass; `pnpm lint && pnpm test && pnpm build` pass; RENDERED in a browser (wizard with a blank-name profile is test-only, by fixture)

- [x] T67: E2e — the preview shows the uploaded letterhead (fixture PDF), the failure band when the link fails, dark theme keeps the paper light, the issuer's name/address from the profile in preview and generated PDF, revise journey sees it (E) — refs: AC-11.1, AC-11.3, AC-11.4, AC-11.5, AC-12.3, AC-12.10 — deps: T63, T66
  - domain: frontend
  - touch: `shell/e2e/crm-offer-wizard*.spec.ts`, `shell/e2e/helpers/**`
  - done when: `cd shell && E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e crm-offer-wizard.spec.ts crm-offer-wizard-revise.spec.ts` passes on the dev stack

- [x] T68: Records — ADRs for candidates 8–10 (pdf.js in the remote, seeded content upgraded only when unedited, supplied values print nothing when empty), changeset covers the new crm-ui dependency, T37 sample PDFs re-rendered with the profile's name and address (D) — refs: AC-9.6 (samples) — deps: T67
  - domain: devops
  - touch: `docs/adr/20261115-*.md`, `AGENTS.md`, `.changeset/*.md`
  - done when: ADR files exist and are listed in AGENTS.md; `mise run changeset:check` passes; sample PDFs in the scratchpad

- [x] T69: Shared page constants (A4 size, frame 120/110/71/71 pt, type sizes, spacing) in one file copied byte-identically to crm-ui; `contractPdf.ts` imports them with no output change (DD-67) — refs: AC-11.10, AC-3.2 — deps: none
  - domain: backend
  - touch: `crm-api/src/offers/{paper,contractPdf}.ts`, `crm-api/src/offers/contractPdf.test.ts`, `crm-ui/src/lib/offerPaper/**`, `scripts/check-shared-copies.ts`, `scripts/check-shared-copies.test.ts`, `.github/workflows/shared-copies.yml`
  - done when: shared copies in sync incl. the new group; contractPdf tests unchanged and green; `[crm_test] bun test` passes

- [x] T70: `boundPdf()` — decoded-size, object, stream and image bounds before any pdf-lib load; `checkLetterhead` calls it first (DD-74, security M-4, F-2) — refs: AC-11.7, AC-11.4 — deps: none
  - domain: backend
  - touch: `crm-api/src/entity-profiles/{pdfBounds,letterhead}.ts`, `crm-api/src/entity-profiles/*.test.ts`, `crm-api/src/entity-profiles/fixtures/**`
  - done when: hostile fixtures (flate bomb with lying /Length, object/stream floods, oversized images, nested filters) are refused within the caps without inflating past them; real letterheads accepted; `[crm_test] bun test` passes

- [x] T71: Copy on confirm, `usableLetterhead` memo, 409 `letterhead_unusable` on the link and both generate routes, OpenAPI, read-only `scripts/check-letterheads.ts`, infra release item (DD-75, DD-76, DD-78) — refs: AC-11.4, AC-11.7 — deps: T70
  - domain: backend
  - touch: `crm-api/src/entity-profiles/**`, `crm-api/src/offers/{generation,offers.routes}.ts`, `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offers/*.test.ts`, `crm-api/src/offer-drafts/*.test.ts`, `crm-api/src/lib/storage.ts`, `crm-api/src/matrix.test.ts`, `crm-api/scripts/check-letterheads.ts`, `infra/README.md`
  - done when: tests for swap-after-check, a stored bomb answering 409 on all three routes with a constant body, the audit script's dry output; `[crm_test] bun test` passes

- [x] T72: Browser defence in depth (`maxImageSize`) + guard test; Settings and generation-error copy for `letterhead_unusable` (DD-76, DD-77) — refs: AC-11.4 — deps: T71
  - domain: frontend
  - touch: `crm-ui/src/lib/letterhead/**`, `crm-ui/src/lib/offerErrors*.ts`, `crm-ui/src/components/LetterheadCard.tsx`, `crm-ui/src/strings/{templates,offers}.ts`, `crm-ui/src/pages/OfferTemplates.test.tsx`
  - done when: `pnpm lint && pnpm test && pnpm build` pass; the 409 maps to "upload the letterhead again" in Settings and generation

- [x] T73: Pure page geometry, `placeBreaks` (rules R1–R8 mirroring contractPdf) and realisation, with vectors (DD-66, DD-68, DD-70, DD-79) — refs: AC-11.10, AC-11.11, AC-11.13 — deps: T69
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/paper/**`
  - done when: vector tests for every rule incl. O12/O13 readings, 10 px floor, 30-page input under the time budget; `pnpm test` passes

- [x] T74: The paginated `DocumentPreview` — one flow, float rail, page layer with the letterhead on every page, caption/bands per DD-72; reworks T65 (DD-65, DD-69, DD-71) — refs: AC-11.1, AC-11.2, AC-11.3, AC-11.4, AC-11.5, AC-11.6, AC-11.8, AC-11.9, AC-11.12, AC-11.13, AC-3.2 — deps: T72, T73
  - domain: frontend
  - touch: `crm-ui/src/components/offerWizard/{DocumentPreview,MarkedText,OfferWizard}*.tsx`, `crm-ui/src/components/offerWizard/useLetterhead*.ts`, `crm-ui/src/components/offerWizard/paper/**`, `crm-ui/src/strings/offerWizard.ts`
  - done when: component tests pass with an injected layout; RENDERED in Chromium at 1280 and 1024 (Drawer), light/dark, letterhead shown/none/failed, a long offer over several pages with no text in margins or gaps, selection and find across a break; D19 fit tests green; `pnpm lint && pnpm test && pnpm build` pass

- [x] T75: E2e — `crm-offer-wizard-pages.spec.ts` (pages, breaks, search across a break, theme per page, 409 failure journey) and rework of the T67 letterhead journeys for several pages — refs: AC-11.1, AC-11.2, AC-11.4, AC-11.5, AC-11.10, AC-11.11, AC-11.12 — deps: T71, T74
  - domain: frontend
  - touch: `shell/e2e/crm-offer-wizard*.spec.ts`, `shell/e2e/helpers/**`, `shell/e2e/fixtures/**`
  - done when: `cd shell && E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e crm-offer-wizard.spec.ts crm-offer-wizard-revise.spec.ts crm-offer-wizard-pages.spec.ts` passes

- [x] T76: Records — ADRs 11–13, design.md § Preview pane re-sync (if not done earlier), glossary (Letterhead every page, Preview page), changeset text, AGENTS.md — refs: — (process) — deps: T75
  - domain: devops
  - touch: `docs/adr/20261115-*.md`, `specs/20261115-crm-offer-wizard/design.md`, `.claude/context/glossary.md`, `.changeset/*.md`, `AGENTS.md`
  - done when: ADR files exist and are in AGENTS.md; `mise run changeset:check` passes

- [x] T77: Preview prints the PDF's page number "N/M" on every page and covers the letterhead's own baked-in number when shown; shared NUMBER_* constants (OA-4) — refs: AC-11.10, AC-11.12 — deps: T74
  - domain: frontend
  - touch: `crm-api/src/offers/{paper,contractPdf}.ts`, `crm-ui/src/lib/offerPaper/paper.ts`, `crm-ui/src/components/offerWizard/{DocumentPreview,paper/geometry}*.ts*`, `shell/e2e/crm-offer-wizard-pages.spec.ts`
  - done when: PDF byte-identical before/after; component tests for N/M and the corner cover; e2e pixel check of the corner (done: b8dd6a1d)

- [x] T58: All gates green, spec status → done — refs: every AC — deps: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29, T30, T31, T32, T33, T34, T35, T36, T37, T38, T39, T40, T41, T42, T43, T44, T45, T46, T47, T48, T49, T50, T51, T52, T53, T54, T55, T56, T57, T59, T60, T61, T62, T63, T64, T65, T66, T67, T68, T69, T70, T71, T72, T73, T74, T75, T76, T77
  - domain: devops
  - touch: `specs/20261115-crm-offer-wizard/spec.md` (frontmatter `status:` only, after the gates)
  - done when: `cd crm-api && bun run typecheck` and `[crm_test] bun test` pass; `cd crm-ui && pnpm lint && pnpm build && pnpm test` pass; `mise run ui:check` passes; `bun scripts/check-shared-copies.ts` and `bun test scripts/check-shared-copies.test.ts` pass; `mise run changeset:check` passes; `cd shell && pnpm e2e crm-offer-wizard.spec.ts crm-offer-wizard-revise.spec.ts` passes with the stack up; the owner has reviewed the T37 sample PDFs, the delegated amendments SA-1…SA-6, O3, O4 and the OWNER REVIEW items in decisions.md; O7 (each entity profile's address lines) checked; then spec `status: done`

## Amendment 2026-11-24 — the object and the cost line are separate (spec OA-5)

> Re-synced 2026-11-24 after spec OA-5 (owner decision 2026-11-24). Built directly on `main`.

- [x] T78: T1 and T1+T3 revision 2: the cost line `oggetto` reads `[VOCE_DI_COSTO]`, a new text field asked in the costs step; `seedRevision` column (migration `20261124120000_offer_template_seed_revision`); `wizardSeeds/revise.ts` moves an untouched v2 row (SHA-256 of revision 1) to revision 2 under the template lock and marks an edited one, once; inserts and the v1 upgrade write the revision; revision-1 texts kept as test fixtures (`wizardSeeds/revisions/`); golden answers carry `VOCE_DI_COSTO` = the object — refs: AC-9.1, AC-12.5, AC-12.6, AC-8.4 — deps: none
  - domain: backend
  - touch: `crm-api/prisma/**`, `crm-api/src/offer-templates/wizardSeeds/**`, `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.{seedUpgrade,seedRevision}.test.ts`
  - done when: `cd crm-api && bun run typecheck` and `[crm_test] bun test` pass; `bun scripts/check-shared-copies.ts` passes

## Coverage

| AC | Tasks |
|---|---|
| AC-1.1 | T16, T24, T32, T49, T54 |
| AC-1.2 | T8, T41 |
| AC-1.3 | T6, T8, T42 |
| AC-1.4 | T7, T8, T42 |
| AC-1.5 | T8, T9, T42 |
| AC-1.6 | T41, T50 |
| AC-1.7 | T9, T43 |
| AC-1.8 | T6, T10, T30, T42 |
| AC-1.9 | T6, T7, T20, T42 |
| AC-2.1 | T7, T29, T45 |
| AC-2.2 | T9, T12b, T32, T45 |
| AC-2.3 | T7, T29 |
| AC-2.4 | T29, T32, T49 |
| AC-2.5 | T3, T4, T36, T44, T45 |
| AC-3.1 | T1, T46 |
| AC-3.2 | T2, T3, T11, T13, T14, T25, T31, T34, T46, T65, T69, T74 |
| AC-3.3 | T1, T2, T9, T46 |
| AC-3.4 | T47 |
| AC-3.5 | T10, T32, T41, T47, T50, T54 |
| AC-3.6 | T10, T32, T45, T47 |
| AC-4.1 | T3, T4, T26, T44 |
| AC-4.2 | T9, T44 |
| AC-4.3 | T4, T10, T32, T44 |
| AC-4.4 | T10, T44 |
| AC-4.5 | T6, T9, T42 |
| AC-4.6 | T4, T5, T10, T26, T31, T32, T44 |
| AC-4.7 | T4, T5, T26, T44 |
| AC-5.1 | T12, T12b, T30, T48 |
| AC-5.2 | T10, T12, T12b, T32, T42, T46, T48 |
| AC-5.3 | T48 |
| AC-5.4 | T10, T32, T48 |
| AC-6.1 | T15, T30, T40, T50, T54 |
| AC-6.2 | T29, T51 |
| AC-6.3 | T30, T40, T50, T54 |
| AC-6.4 | T29, T51, T54 |
| AC-6.5 | T7, T30, T49 |
| AC-6.6 | T31, T32, T33 |
| AC-6.7 | T40 |
| AC-7.1 | T33, T51, T55 |
| AC-7.2 | T33, T51, T55 |
| AC-7.3 | T28, T33, T49, T51, T55 |
| AC-8.1 | T6, T15, T16, T52, T55 |
| AC-8.2 | T8, T52 |
| AC-8.3 | T5, T6, T14, T16, T52 |
| AC-8.4 | T7, T30, T32, T40, T50, T63 |
| AC-8.5 | T7, T53, T55, T66 |
| AC-9.1 | T18, T19, T20, T21, T22, T23, T24, T35, T37, T54 |
| AC-9.2 | T17, T24, T52, T56 |
| AC-9.3 | T13, T16, T36 |
| AC-9.4 | T15, T25, T27, T28, T56 |
| AC-9.5 | T5, T11, T20, T23, T26, T34 |
| AC-9.6 | T18, T19, T20, T21, T22, T23, T35, T45, T61, T68 |
| AC-10.1 | T9, T14, T38, T50 |
| AC-11.1 | T59, T65, T67, T74, T75 |
| AC-11.2 | T65, T74, T75 |
| AC-11.3 | T62, T65, T67, T74 |
| AC-11.4 | T64, T65, T67, T70, T71, T72, T74, T75 |
| AC-11.5 | T65, T67, T74, T75 |
| AC-11.6 | T65, T74 |
| AC-11.7 | T59, T62, T64, T70, T71 |
| AC-11.8 | T62, T64, T74 |
| AC-11.9 | T64, T66, T74 |
| AC-12.1 | T60, T66 |
| AC-12.2 | T60, T62 |
| AC-12.3 | T61, T67 |
| AC-12.4 | T62 |
| AC-12.5 | T63 |
| AC-12.6 | T63 |
| AC-12.7 | T62, T66 |
| AC-12.8 | T66 |
| AC-12.9 | T60, T66 |
| AC-12.10 | T61, T67 |
| AC-12.11 | T63 |
| AC-12.12 | T60, T65 |
| AC-12.13 | T60, T66 |
| AC-11.10 | T69, T73, T75 |
| AC-11.11 | T73, T75 |
| AC-11.12 | T74, T75 |
| AC-11.13 | T73, T74 |

79 of 79 ACs covered (53 + 22 added by the owner on 2026-11-15 + 4 by OA-3). Tasks serving no AC: **T57** (changeset — process, required by AGENTS.md § Git).
T58 serves every AC only as the closing gate. Tasks whose AC link is indirect (tooling or
evidence that makes an AC provable rather than delivering behaviour): T13/T14 (AC-3.2 holds only
if the copies are identical), T18 (fixtures for AC-9.1/9.6), T37 (owner review of AC-9.1 output,
plan R2), T56 (deploy safety of AC-9.2/9.4).

## Overlaps

Computed over every pair of `touch:` lists, globs expanded against the files each task creates.
Handled by a `deps:` edge (the later task waits), or declared a shared append-only file.

| File / glob | Tasks | Handling |
|---|---|---|
| `crm-api/src/offers/contractPdf.ts` | T2, T3, T25, T26 | chain T2 → T3 → T25 → T26 |
| `crm-api/src/offers/contractPdf.test.ts` | T3, T25 | T25 deps T3 |
| `crm-api/src/offers/contract.ts` | T25, T26 | T26 deps T25 |
| `crm-api/src/offers/engine/syntax.ts` | T5, T6, T12b | T6 deps T5; T12b deps T6 |
| `crm-api/src/offers/engine/resolve.ts` | T9, T10, T12b | T10 deps T9; T12b deps T10 |
| `crm-api/src/offers/engine/*.ts` | T2–T12 (own files), T12b (`markup`, `edit`, `resolve`, `answers`, `syntax`, `printable` comment), T13, T14 | T12b deps T2, T6, T7, T10, T12; T13 deps T2–T12 and T12b; T14 deps T13. Engine frozen after T13 (DD-51): T14 only compile/lint fixes in both copies, behaviour unchanged; any other engine change is drift |
| `crm-ui/src/lib/offerEngine/**` | T13, T14 | T14 deps T13 |
| `crm-api/src/offers/offers.routes.ts` | T15, T27, T28 | chain T15 → T27 → T28 |
| `crm-api/src/offer-templates/offerTemplates.routes.ts` | T15, T16, T17, T24 | chain T15 → T16 → T17 → T24 |
| `crm-api/src/offers/generation.ts` | T27, T31, T32, T33 | chain T27 → T31 → T32 → T33 |
| `crm-api/src/offer-drafts/offerDrafts.routes.ts` | T29, T30, T32, T33 | chain T29 → T30 → T32 → T33 |
| `crm-api/src/matrix.test.ts` | T29, T30, T32 | chain T29 → T30 → T32 |
| `crm-api/src/test-support/world.ts` | T16, T28, T29, T32 | **shared, append-only** (test fixture helpers); T28 and T29 may run in parallel, each only appends its own helpers |
| `crm-api/prisma/migrations/*`, `schema.prisma` | T15 only | the series has one new migration; no other task creates one |
| `crm-api/src/offer-templates/wizardSeeds/welldChIt.*.ts` | T19–T23 (one file each, done), T35 | T35 deps T18, T34 → T24 → T19–T23 |
| `crm-api/src/offer-templates/wizardSeeds/welldChIt.ts` (catalog) | T24 only | not matched by `welldChIt.*.ts`; T35 reads it, never edits it |
| `crm-api/src/offer-templates/wizardSeeds/golden/**` | T18 only | — |
| `crm-ui/src/strings/offerWizard.ts` | T38 (creates), T40, T41, T42, T43, T44, T45, T46, T47, T48, T49, T50 | **shared, append-only** (strings module; T38 adds every design key, later tasks only add a key they discover); parity test guards both languages |
| `crm-ui/src/strings/offers.ts` | T38, T51 | T51 deps T39 deps T38; append-only |
| `crm-ui/src/strings/templates.ts` | T38, T14, T52, T53 | T14 adds `declaration_invalid` after T38 (done); T52 deps T14; T53 deps T52; append-only |
| `crm-ui/src/components/offerWizard/StepPanel.tsx` | T41 (creates), T42, T44, T45, T47, T49 | **shared, append-only** (one `case` per step: the step dispatch); T42/T44/T45/T49 may run in parallel |
| `crm-ui/src/components/offerWizard/OfferWizard.tsx` | T41, T46, T50 | chain T41 → T46 → T50 (T50 deps T46) |
| `crm-ui/src/components/offerWizard/StepForm.tsx` | T42, T43 | T43 deps T42 |
| `crm-ui/src/components/offerWizard/PreviewStep.tsx` | T47, T48 | T48 deps T47 |
| `crm-ui/src/pages/TemplateEditorPage.tsx` | T52, T53 | T53 deps T52 |
| `crm-ui/src/test-support/fakeApi.ts` | T39 | **shared, append-only** (fake API handlers); only T39 lists it, later UI tests use its handlers |
| `shell/e2e/helpers/crmOfferFixtures.ts` | T54, T55 | T55 deps T54 |
| `crm-ui/src/router.tsx`, `CrmShell.tsx` | T50 only | — |
| `operai-ui/src/**` | T1 only | — |
| `specs/…/spec.md` | T58 only (status line) | — |
| `crm-api/src/offer-templates/wizardSeeds/**` | T61 (`*.ts`), T63 (`upgrade.ts`) | T63 deps T61 |
| `crm-api/src/offers/engine/**`, `crm-ui/src/lib/offerEngine/**` | T60 only (after the T13 freeze, an authorised change under DD-51/DD-57) | T61, T62 dep T60 |
| `crm-ui/src/strings/offerWizard.ts` | T65, T66 | T66 deps T65; append-only |
| `crm-ui/src/components/offerWizard/OfferWizard.tsx`, `DocumentPreview.tsx` | T65 (after D19 ab54f5f5) | — |

No overlap was merged away: every chained pair is a different reviewable unit.
