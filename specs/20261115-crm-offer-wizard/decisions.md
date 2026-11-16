# Decisions — CRM offer wizard

Choices taken on the owner's behalf during the unattended run of 2026-11-15, and choices the
agents made that the spec, plan and tasks did not dictate. Disagree with one? It is drift:
amend the spec/plan and re-sync tasks — do not quietly edit the code.

## Orchestrator · delegated gates · 2026-11-15
- delegated: plan gate approved on the owner's delegation ("vai avanti con orchestrate per
  tutte le fasi") — plan.md `approved_by: delegated`; the plan's DD-1…DD-26 are the
  architect's decisions, listed in plan.md § Delegated decisions.
- delegated: spec amendments SA-1…SA-4 (plan § Proposed spec amendments) applied by the PO
  without the owner's confirmation, because AC-9.1 (the seven mockup templates must work) is
  unsatisfiable without them; each changed AC is marked in spec.md. AC count 46 → 53.
- delegated: O3 (spec) — when a block or option that filled fields is switched off or
  replaced, the filled fields KEEP their current values (no revert); choosing a new option or
  switching a block on overwrites only the fields that option/block fills. Why: never silently
  discards something the person may have edited; matches the mockup's `set` behaviour.
- default: the four ADR candidates of the plan written as Accepted, pending owner review.
- delegated: ADR 20261115-offer-cost-table-total-rows-and-option-lines left three rules open;
  fixed here so the engine vectors can pin them: (1) a percentage discount's base is the
  one-off lines of its own span (the lines since the previous total row); (2) per span, discounts may
  not exceed the span's counted (one-off + yearly) lines, plus 018's document-wide check
  against all one-off lines [corrected after plan DD-34: the literal one-off-only reading
  refused AC-4.6's own example]; (3) a total row whose span has no counted
  line prints "–" (the mockup's behaviour) and is not an error, while a table with no counted
  line at all stays invalid (`no_counted_line`). Why: each figure is summed over the scope its
  label names (the ADR's own rule), and the mockup already behaves this way.
- delegated: the three points the adr-writer derived beyond the plan are accepted —
  no Intl / toLocaleString / clock inside the engine (determinism of the shared copies); the
  read path re-validates stored answers; the generate transaction's compensation also covers
  the draft delete.
- delegated (supersedes rule (1) above for multi-total tables): a percentage discount is
  REFUSED in a cost table with two or more total rows (template error when the template
  declares one; answer error when a person adds one). With one total row (or none) the base is
  the whole one-off sum, exactly as in 018. Why: the adr-writer showed that an own-span base
  makes the stored price depend on where the total rows fall (1 000 | TOTAL | 500, −10 % →
  1 450 vs 1 350), contradicting AC-4.6; none of the seven seeds uses a percentage discount
  (the mockup's discount row is an amount). Alternatives: whole-sum base everywhere (a span
  total showing a share of a base outside its span), amending AC-4.6 (rejected).

## T1, T38 · frontend-dev · 2026-11-15
- default: the three paper colours are ink `#15151d`, soft `#4b4b5f`, mark `#ffe58a` / mark-ink `#3a2a00`, and paper `#fdfdfb`, rule `#d6d6de`, head `#ececf2` — why: design fixes only the contrast floors, not the values; these exceed them (17.8, 8.3, 11.1) — where: operai-ui/src/styles/tokens.css (T1)
- default: the paper tokens are `text: false` in `COLOR_TOKENS` (print colours, not UI text on ink) — where: operai-ui/src/foundations/tokens.ts (T1)
- reinterpretation: the wizard editor's strings live in `templates.wizardEditor`, not `templates.editor` — why: key collision with the existing classic editor namespace — where: crm-ui/src/strings/templates.ts (T38)
- reinterpretation: `editor.try` is `wizardEditor.tryLabel` and `offers.draft.discard` dialog strings are `offers.draft.discardDialog.*` — why: a key cannot be both a string and an object — where: crm-ui/src/strings/templates.ts, offers.ts (T38)
- assumption: Italian wizard copy says "template" as design.md's table does, although the existing classic catalog says "modello" — where: crm-ui/src/strings/offerWizard.ts (T38)
- assumption: wording of the 34 `editor.problem.<code>` messages and the `generate.fail.*` banners written by the agent, en and it — why: design lists them only as "e.g." — where: templates.ts, offerWizard.ts (T38)
- scope: added `invalid.percent_discount_multi_total` and draft-error keys beyond the design tables — why: plan's `InvalidCode` and API errors need a message — where: offerWizard.ts, offers.ts (T38)
- env fault (not a decision): `mise run ui:check` / shell suite not run in the worktree (estimai-ui had no node_modules); to run in the main tree at T58.

## T2, T3, T4 · backend-dev · 2026-11-15
- assumption: `formatNumber(value: string | number, language: "en" | "it")` — canonical decimal with the language's decimal separator (`12,5` in it), no grouping, anything not a plain decimal returned unchanged — why: plan names it without a signature — where: `crm-api/src/offers/engine/format.ts`
- reinterpretation: `shortDate` returns its input unchanged when it is not `YYYY-MM-DD` (legacy printed `NaN.NaN.undefined`) — why: the preview may format an empty date — where: `engine/format.ts`
- reinterpretation: `formatAmount` keeps the legacy output (U+2019 grouping for CHF, cents only when not whole) rather than tasks.md's `7'000.00` wording — why: AC-9.4 and legacy goldens — where: `engine/format.ts`, `vectors/format.json`
- default: `words.ts` keeps the renderer's words verbatim with its own `DocLanguage` type (engine imports nothing outside); annex words added by T11/T26 — where: `engine/words.ts`
- default: `printable` maps U+E000–U+E003 and ⟦ ⟧ to "?"; consequence for T9: map answers through `printable` before wrapping them in marker runs — where: `engine/printable.ts`
- assumption: an unclosed/unopened marker character is dropped; marker content is literal — where: `engine/markup.ts`
- assumption: a backslash before `- • # 1. a.` at line start makes the line plain; `\|` inline; a table line must start and end with an unescaped, non-marker pipe — where: `engine/markup.ts`
- assumption: C5 and C6 both reported when both fail (span first); the legacy adapter throws `discounts_exceed_one_off` for either — where: `engine/costs.ts`, `offers/costs.ts`
- assumption: a span in C5 error is "incomplete" with a null total; `oneOffCents` null only on incomplete input, C3 refusal or C6; `yearlyCents` null only on incomplete input — where: `engine/costs.ts`
- assumption: "incomplete" takes priority over "empty"; a C4 percentage computes 0 and flags the error — where: `engine/costs.ts`
- assumption: error order: too large, C3, C4, C5, C6, `no_counted_line`, `too_many_cost_lines` (pinned by vectors) — where: `engine/costs.ts`
- default: `MAX_CENTS` (1e13) and `MAX_COST_LINES` (10) duplicated in the engine; a test asserts agreement with offerSchemas — where: `engine/costs.ts`
- scope: legacy `computeCosts` adapter throws a plain Error on a legacy line with no amount (unreachable by schema) — where: `crm-api/src/offers/costs.ts`

## T5, T6, T7, T8 · backend-dev · 2026-11-15
Drift reported (accepted by the orchestrator, to be folded into plan.md in one pass after the engine):
- new ProblemCode `declaration_invalid` (unknown declaration key, unknown `kind:`, bad `default:`, > 20 options, malformed `fills`, label > 80) — needs an en/it message in crm-ui `templates.wizardEditor.problem.*` (before T13/T14).
- `WizardContext` gains `language` and `today` (`YYYY-MM-DD`); the context endpoint (T29) must supply them (server: template row + its clock; browser: `<html lang>` + its date).
- a field referenced only from the cost table is still an outline item, in the costs step (T44 renders it inside the table).
- fields bound by `source:` to client/clientAddress/contacts/place/date/reference/issuer/currency are not outline items; `deal`, `epics`, `phases`, `timeline`, `manDays`, `validityDays` stay items.
Decisions:
- assumption: an unknown `@@` word, a `{{…}}` whose head is not a condition and a `@@step` outside a section print as ordinary text, no problem — where: `syntax.ts`
- assumption: first `@@salutation` / `@@acceptance` / `@@effort-annex` win; any `@@effort-annex` value other than `on` is off — where: `syntax.ts`
- reinterpretation: empty or > 100-char salutation is `salutation_missing`; acceptance label > 100 is `heading_too_long` — where: `syntax.ts`
- default: block conditions are carried as `conds` on every body line/cost item/section/annex, so a block may cross a section boundary — where: `syntax.ts`
- assumption: a `@@costs` not first in its contract section, or a second one, is `costs_not_first`; a heading or `@@annex` inside a table is `costs_not_closed` — where: `syntax.ts`
- default: no `qty=` → quantity 1; discount with `qty=`, percentage on a non-discount, quantity 0, `unit=` with > 2 decimals → `cost_line_invalid` — where: `syntax.ts`
- assumption: `@@OPT_START` with an unreadable condition → `field_undeclared` with the raw text, block still opens — where: `syntax.ts`
- assumption: unclosed inline `{{…::` → `block_not_closed` on that line; inline conditions are per line — where: `syntax.ts`
- default: a declaration ends at a blank line or the next `@@` line; entries split at the first colon — where: `syntax.ts`
- assumption: a field needs a `label` unless it has `source:`; hint/example/label length caps → `declaration_invalid` — where: `syntax.ts`
- default: `declared_unused` is a warning; a table column counts as used when its table is; compute references count; choices never warn — where: `syntax.ts`
- default: a table's first column equals its name (else `table_column_unknown`), other columns are declared fields, `sum()` takes a non-first column — where: `syntax.ts`
- default: derived field kinds number/percentage/amount only (else `compute_invalid`); cycles reported on each field (Tarjan) — where: `syntax.ts`
- default: a `fills` option must be one of the field's options and the target a declared field without `source` (else `fills_unknown`); a choice default outside its options → `choice_option_unknown` — where: `syntax.ts`
- default: `optional_heading_not_last` fires on an optional `###` followed by another `###` in the same section — where: `syntax.ts`
- assumption: compute arithmetic exact (6-decimal scaled BigInt), canonical decimal text; `+`, `-`, unary `-` only; length ≤ 200, parentheses ≤ 16 — where: `compute.ts`
- assumption: `initialAnswers` leaves `contactIds` empty and `client.date` null, stores a field only with a default or prefill, sets `lastStep` to `"client"` — where: `answers.ts`
- default: template amounts in `default:`/`fills` are major units ("150.50" = 15 050 cents); a fill not fitting its target's kind or options is skipped, never stored invalid — where: `answers.ts`
- default: fills of default-on options/blocks/choice defaults applied when answers are first built, in that order — where: `answers.ts`
- default: `setBlock`/`chooseOption` apply fills only on an actual off→on change; `setBlock` ignores a block that is a choice option — where: `answers.ts`
- default: `perRelease` line `releases[].description` = release name; no releases → one entry named after the deal; legacy split; `manDays` quantity clamped 1–100 000 — where: `answers.ts`
- default: `reconcileAnswers` reports dropped items in order fields, blocks, lists, tables (`TABLE.COL`), `cost:<key>`; an added `default: today` date stays empty (no clock); a block that stops being a choice option keeps its value — where: `answers.ts`
- default: `sampleContext`/`sampleAnswers` use 2026-01-15, one contact, two releases, two list items, two table rows; cost lines 1 000.00, discounts 50.00, options 150.00 — where: `answers.ts`
- default: `checkAnswers` walks answers in fixed key order to depth 16; paths like `tables.TAB[0].cells.TAB` — where: `answers.ts`
- reinterpretation: `outline` omits a step with no items even when it has sections; the opening's fields go to the first contract section's step — where: `outline.ts`
- assumption: items inside a choice's option block are listed beside the choice, not nested; nesting only under an earlier block of the same step — where: `outline.ts`
- default: in wizard mode the cost-table item and sections omit lines/totals/sections inside an off block — where: `outline.ts`
- default: a table column is `required` when a cost line uses it as unit or quantity; the key column's label/kind are the table's label and text — where: `outline.ts`

## T18 · backend-dev (worktree) · 2026-11-15
- assumption: captured with local Playwright (`shell/node_modules`, headless Chromium on `file://`) because the Playwright MCP tool blocks `file:` — the mockup stays read-only, used only as the oracle — where: `golden/capture.mjs`, `README.md`
- scope: committed `capture.mjs` (replays committed answers, rewrites texts, `--check`; contains none of the mockup's code) — where: `golden/capture.mjs`
- scope: added `variants/` (mutually exclusive blocks; `-minimal` required-only answers) — where: `golden/variants/`
- default: plain text format — ` / ` for an in-block break, `| a | b |` rows, logo/footer/bold dropped — where: `README.md`
- assumption: golden text keeps page-1 header, acceptance block and "Allegati:" line; T35's allow-list removes them — where: `README.md`
- assumption: answers and figures invented; date fixed 2026-11-15; SLA fills for T3 and T1+T3 copied from the mockup's SLA table — where: `golden/answers.T3.json`, `answers.T1+T3.json`
- default: answers files hold the full mockup state (`g`, `lists`, `rows`, `c`, `x`; cost figures under internal keys like `52:1:unit`) so `setData` replays them — where: `golden/answers.*.json`
- note for T35: mockup id of `T1+T3` is `T13`; T5 "Allegati" table cells are free text in the golden.

## T21, T22 · backend-dev (worktree) · 2026-11-15
- default: each seed file exports its text as one string (`T4_TEXT`, `T5_TEXT`, `T6_TEXT`); catalog metadata left to T24 — where: `welldChIt.T4.ts`, `.T5.ts`, `.T6.ts`
- reinterpretation: T4's programme-table hours column is `ORE_MODULO` (label "Ore complessive"), not `ORE` — why: `ORE` is also a scalar field and the grammar forbids a column that is also a field — where: `welldChIt.T4.ts`. T24/T35 must map golden `rows.MODULO[].ORE` → `ORE_MODULO`.
- reinterpretation: the mockup's `_1/_2/_3` placeholders became one `@@list`/`@@table` each (`OBIETTIVO`, `MATERIALE`, `MODULO`, `CONTENUTO`, `ATTIVITÀ`, `COMPONENTE`); T6's component list required as in the mockup — why: DD-5 — where: T4, T5, T6 seeds
- assumption: `type: num` → `kind: number`, except `ACCONTO`, `SALDO`, T6 `UPTIME` (labels ending "(%)") → `percentage`; `SALDO` = `compute: 100 - ACCONTO`; `area` → `longtext`; `sel` → `options`; `ph` → `example`; `help` → `hint` — where: all three seeds
- assumption: `PREZZO_PARTECIPANTE_AGGIUNTIVO` stays `kind: number` followed by `.- [VALUTA]`, label keeps "(CHF)" — why: faithful to mockup labels (AC-9.6) — where: `welldChIt.T4.ts`
- assumption: `VALIDITA_GIORNI` is `source: validityDays`, no `default` (the system value supplies 30) — where: all three seeds
- default: `RIF` (`source: reference`) declared only in T6 (DPA annex prints it); `VALUTA` (`source: currency`) only in T4/T5 — why: avoids `declared_unused` — where: seeds
- default: optional sub-headings wrapped with `@@OPT_START` around the `###` line and its paragraph; T4 accepts the `optional_heading_not_last` warning for 4.2 (mockup's order) — where: T4, T6 seeds
- default: the entered discount is `unit=?` (amount or percentage) although the mockup's is amount-only — why: no amount-only entered discount in the grammar; DD-39 still refuses a percentage with ≥ 2 totals — where: T4, T5 seeds
- default: total rows `@@total **TOTALE**` (T4, T5) and `@@total **TOTALE primo periodo**` (T6), with `@@costs position unit` — where: seeds
- scope: tests carry the mockup's labels/hints/defaults/options as written-out expectation tables (the mockup is untracked) — where: `conversion.T4T5.test.ts`, `conversion.T6.test.ts`
- env note: worktree typecheck failed only for the missing generated Prisma client; the main-tree typecheck after integration shows errors only in T10's uncommitted work in progress.

## T19, T20, T23 · backend-dev (worktree) · 2026-11-15
Drift (task text, accepted): T23's done-when asked for "the option line after the last total"; the mockup's T13 and the golden `T1+T3` have none — the seed follows the mockup (AC-9.1). tasks.md T23 to be corrected at the next re-sync.
- assumption: `REFERENTE_CLIENTE` (T3, T13) is `source: contacts` — the SLA annex's "Referente del Cliente" takes the offer's chosen contacts, fallback "da comunicare all'avvio del servizio" — where: `welldChIt.T3.ts`, `welldChIt.T1T3.ts`
- assumption: `VALIDITA_GIORNI` is `source: validityDays`, kind number, mockup label — where: all four seeds
- default: kinds `num` → `number` / `percentage` when the label says "(%)" (ACCONTO, SALDO, RATE, IMPIEGO_MINIMO); `area` → `longtext`; `sel` → `options`; TARIFFA → `amount` (needed by `unit=[TARIFFA]`, AC-4.2) — where: seeds
- assumption: `ph` → `example:`, `help` → `hint:`, block `help` → `explain:`, verbatim — where: seeds
- assumption: `VOCE_DI_STIMA` has `step: annexes` (else its first inline use would put it in scope) — where: `welldChIt.T1.ts`, `.T1T3.ts`
- default: `TOTALE_GG` derived `sum(GG)` labelled "Totale giorni/uomo"; `SALDO` = `100 - ACCONTO - RATE` (T1), `100 - ACCONTO` (T13) — where: T1, T2, T1T3 seeds
- default: optional sub-headings written `{{block::### Title}}` — where: T1 (`ai`), T2 (`dati_critici`), T1T3 (`ai`)
- default: annex titles sentence case without "ALLEGATO X —" (the renderer draws the designation) — where: seeds with annexes
- default: cost line keys `oggetto, voce2, sconto, scelta` (T1); `consulenza, sconto` (T2); `canone, pacchetto, attivazione` (T3, T13); first line of T1/T13 `unit=deal`, T3 canone `unit=?` — where: cost tables
- assumption: the mockup's amount discount becomes `unit=?` (also allows a percentage; one total, so valid) — where: T1, T2
- assumption: T2's TARIFFA label stays "CHF / giorno" (verbatim label); follow-up: make it currency-neutral if EUR deals use T2 — where: `welldChIt.T2.ts` — OWNER REVIEW
- scope: shared-clause identity asserted by block prefix + a 20-entry `WORDED_DIFFERENTLY` list — where: `conversion.T1T3.test.ts`
- default: seed texts are plain template literals with no backslash/backtick/`${` (Bun mangles non-ASCII in `String.raw`) — where: all seeds
- env note: worktree needed `prisma generate` with a placeholder URL (no DB touched; output gitignored).

## T9, T10, T11, T12 · backend-dev · 2026-11-15
Drift reported (to fold into plan.md): `ResolvedCostRow` = `CostRowIn` + `description`; `ResolvedOffer.annexes[].intro`; `numberOffer(…, language, attachmentNames: string[])` instead of `attachmentCount`; plain surfaces (headings, annex titles/subtitles, cost descriptions, total labels, column labels) carry marker characters U+E000–U+E003 unescaped — consumers split on them and never run `parseInline` over them.
- reinterpretation: `resolveOffer(ast, answers, context, options?)` with `{ reference?: string | null; mode?: "markers" | "tokens" }`; with `reference`, `source: reference` prints it (plan step 6) — where: resolve.ts
- scope: extra exports `resolveSectionText` and types `SectionText`, `ResolvedCostRow`, `ResolvedAnnex`, `InvalidIssue` — where: resolve.ts
- reinterpretation: `ResolvedOffer.client.date` is the printed date (person's, else `context.today`), never null (DD-16) — where: resolve.ts
- default: values trimmed and escaped by the line they land in (`\ [ * _ | {` anywhere; line-start markers at a line start; in a table only `-`/`•` at cell start; `<br>` → space in a cell; one line for a table row or heading, no blank line in a list item, ≤ one blank line in a paragraph) — where: resolve.ts
- default: a body line rendering to a bare marker or empty pipes is dropped only if the template line had a condition or field; empty sub-headings dropped; 3+ newlines fold; empty sections/annexes dropped (an annex needs a title and intro or a section) — where: resolve.ts
- assumption: a line naming a list/table column repeats per non-empty item/row, driven by the first such name; other lists/tables on the same line join with ", "; an empty driver prints once with a missing marker — where: resolve.ts
- default: `missing`/`invalid` only for surviving lines, in text order, one per name (+code); keys `cost:<key>`, `cost:<key>#<n>`, `TAB#<rowId>.COL` — where: resolve.ts
- default: a missing field used in a cost line names the field; an entered line value missing is `cost:<key>` labelled by its description (field label substituted, markup stripped, ≤ 80 chars); an extra line incomplete → null label — where: resolve.ts
- default: ranges — percentage 0–100, amount whole 0…MAX_CENTS, number unrestricted, date real calendar 1900–2200, `validityDays` 1–365, cost quantity 1–100 000, discount 0–10 000 bp; printed date always checked as `client:date` within ±90 days of `context.today` — where: resolve.ts — OWNER REVIEW (±90 days)
- default: cost errors copied into `invalid` only when a cost table printed — where: resolve.ts
- default: a hand-edited section prints whenever its block conditions hold; heading trimmed, blank not printed; edit text through `printable`; limits on raw length — where: resolve.ts
- default: `ResolvedSection.uses` = every name the section reads (blocks and conditions included), for every section — where: resolve.ts
- default: client lines, contacts, place go through `printable` (DD-22) — where: resolve.ts
- default: `numberOffer` upper-cases with `toUpperCase` + `printable`; text-annex heading `<WORD> <DESIGNATION> – <TITLE>`; "Allegati:" lines use " - "; index `target` = section key / `annex:<designation>` / `annex:effort`; letters A…Z, AA…, skipping used designations — where: numbering.ts
- default: `resolveSectionForEdit` lists each token once per field (pending reference included); `findTokens` reports a lone bracket as a one-character entry with empty label and unescapes labels — where: edit.ts
- env note: the wellforge Bash hook false-positives on any command text containing `.key` (reads it as a key file).

## Orchestrator · R16 · 2026-11-15
- delegated: R16 fired — T3 and T1+T3 print `[RIF]` in two hand-editable SLA annex sections ("Parametri del servizio", "Condizioni generali"). Decision: add a reference token to hand-edited text, filled at generation (plan DD-52), implemented BEFORE the engine is mirrored (T13), instead of accepting that a hand edit drops the reference. Why: a hand edit would otherwise force the person to delete the reference or type one that does not exist yet for a new offer; the engine is still unfrozen, so the change is cheap now and drift later.

## T12b · backend-dev (worktree) · 2026-11-15
- assumption: an over-limit hand-edited body (> 20 000 raw chars) is filled with `escapeValue(ref, "")` (no line context) — why: bounded cost; such a body is already `invalid` — where: `resolve.ts` `editedBody`
- default: a reference field without `label` uses its name as the pending-marker label (`field.label ?? name`) — where: `resolve.ts`
- reinterpretation: `findTokens` sorts by `start` (n log n worst case) so results are in text order — where: `edit.ts`
- default: separate `REFERENCE_BRACKETS` regex beside `RESERVED` — where: `answers.ts`, `syntax.ts`
- scope: new resolve vectors under a top-level `referenceToken` key in `resolve.json`; T13's crm-ui vector runner should consume it — where: `vectors/resolve.json`
- assumption: `checkAnswers` finds hand-edit bodies structurally (`handEdits.<key>.body`, `orphanedEdits[i].body`) — where: `answers.ts`

## T15, T16, T17 · backend-dev · 2026-11-15
- reinterpretation: T16's "legacy tests unchanged" not met literally — `offerTemplates.test.ts` edited minimally (create posts a wizard body, a `legacyRow` helper, limits tests as PUT on a legacy row expecting 200, archive-all via DB, a keeper template before an archive), same assertions — why: wizard-only `POST` (DD-9) and the `last_template` guard — where: `crm-api/src/offer-templates/offerTemplates.test.ts`
- default: `legacyContent` throws 409 `template_format_mismatch` for a wizard row — where: `crm-api/src/offers/legacyContent.ts`
- default: empty wizard `description` stored as null — where: `offerTemplates.routes.ts`
- default: wizard body rejects NUL characters (422) and `\r` in `description` — where: `offerTemplates.routes.ts`
- default: 422 `template_invalid` `problems` includes warnings; only errors block — where: `offerTemplates.routes.ts`
- assumption: `PUT` validates the body after 428/404/403/409 (format known only after load) — where: `offerTemplates.routes.ts`
- assumption: a legacy template cannot be duplicated or language-moved into an (entity, language) with an active wizard template (409 `template_superseded`) — where: `supersession.ts`
- assumption: `last_template` applies to active templates of every format, including a language change leaving the pair; archiving an already archived template is allowed — where: `supersession.ts`
- assumption: a language change of an archived wizard template triggers neither supersession nor the guard — where: `offerTemplates.routes.ts`
- default: `seedTemplatesIfEmpty` keeps counting every row, so a wizard create on a never-read entity suppresses the legacy seed — why: seeding legacy after a wizard row would break supersession — where: `offerTemplates.routes.ts` — OWNER REVIEW (edge)
- default: the list response includes `source` for every wizard row — where: `offerTemplates.routes.ts`
- scope: `WIZARD_SOURCE`, `wizardBody`, `makeWizardTemplate` added to `test-support/world.ts` — where: world.ts
- scope: `offer_draft` mapped in `schema.prisma` with back-relations on `Deal`/`DealOffer` — where: schema.prisma
- ADR candidate (to collect): the extra supersession rules above.

## T13, T14 (partial) · frontend-dev (worktree) · 2026-11-15
Drift: the engine as built fails crm-ui's lint/`tsc -b` (unused `MARKER_CHARS` in resolve.ts, unused `FillRef` in syntax.ts, `Resolver` constructor parameter properties refused by `erasableSyntaxOnly`). Orchestrator decision: apply the behaviour-neutral fix to BOTH copies in one commit (T14's text allows a lint/compile fix) — the engine freeze forbids behaviour changes, not this.
- scope: vectors registered as one whole-file group per file, discovered from the crm-api vectors directory — where: `scripts/check-shared-copies.ts`
- assumption: `mode: "whole"` compares raw bytes (no CRLF/trailing-newline normalisation) — where: `scripts/check-shared-copies.ts`
- scope: purity test uses the TS compiler (comments stripped, AST imports/literals); currency literals allowed only in `formatAmount` and `sampleContext` — where: `crm-api/src/offers/engine/purity.test.ts`
- scope: added `crm-ui/.prettierignore` for `src/lib/offerEngine/` (the format hook broke byte-identity) — where: `crm-ui/.prettierignore`
- assumption: `declaration_invalid` copy is generic ("a declaration has an invalid setting: «name»") — where: `crm-ui/src/strings/templates.ts`
- scope: the crm-ui runner ports only vector-driven cases — where: `crm-ui/src/lib/offerEngine.vectors.test.ts`

## T14 (finish) · frontend-dev (worktree) · 2026-11-15
- default: deleted `MARKER_CHARS` and `FillRef` outright (unused) instead of commenting them out — where: `resolve.ts`, `syntax.ts`, both copies
- default: `Resolver` constructor uses plain readonly fields; comment "(T14, DD-51)" explains why — where: `resolve.ts`, both copies

## T24, T25, T26, T27, T28 · backend-dev · 2026-11-15
- reinterpretation: `###` headings in a legacy offer's OPENING are now drawn unnumbered (legacy drew "0.n TEXT"); 12 of 13 legacy fixture PDFs byte-identical, the 13th is this case — why: the engine numbers only sections; the grep gate bans numbering arithmetic in the renderer — where: `contractPdf.ts` — OWNER REVIEW if any real legacy template has `###` in its opening (deviation from AC-9.4's letter)
- assumption: snapshot `costs.rows` holds the engine's input rows (lines with `description` + total rows); the renderer computes positions/totals via `computeCosts` and prints total rows only when `costs.showTotal`; T31 must store rows that way and set `showTotal` from the template — where: `contract.ts`, `contractPdf.ts`
- default: draw-log entries one per drawn line `{page, text}`, decor included; T34 filters/normalises against `documentText` — where: `contractPdf.ts`
- default: a text annex's page registered under index target `annex:<designation>`; annex sections not indexed — where: `contractPdf.ts`
- default: "□" drawn as a 0.7 em outlined square advancing 0.85 em; `printable` replaces `winAnsi` in `layoutRuns` — where: `contractPdf.ts`
- default: with `costs.labels`, unit/quantity columns grow to fit the bold label (32 pt cut "Giorni") — where: `contractPdf.ts`
- default: inputs to `numberOffer` pass through `plain()` (markers stripped) — where: `contractPdf.ts`
- assumption: a seed whose name an active non-superseded template already holds is skipped (retried on a later read); legacy Italian templates archived only when ≥ 1 seed is inserted — where: `seedWizardTemplates` — OWNER REVIEW (edge)
- default: `WELLD_CH_IT_V1_RENAMES` shape `{table, from, to}[]` per code — where: `wizardSeeds/welldChIt.ts`
- default: `offerOrigin` = `wizard` for any contract snapshot with a `wizard` member; an unsent wizard offer blocks the next legacy generation (`blocksRevision` unchanged) — where: `generation.ts`
- scope: `createOfferVersion` stores then inserts and deletes the object on insert failure; a later failure (T32's draft delete) must delete `row.objectKey` itself — where: `generation.ts`
- scope: legacy prefill checks `assertLegacyTemplate` right after `loadContext` — where: `offers.routes.ts`
- scope: three T24-era tests scoped to non-seeded rows / welld_it, same assertions — where: `offerTemplates.wizard.test.ts`, `offerTemplates.supersession.test.ts`

## T41, T42, T43 · frontend-dev (worktree) · 2026-11-15
Drift/candidate: `ResolvedOffer` does not expose derived values and the engine is frozen; `derivedValue.ts` calls the engine's own `evaluateCompute` with the resolver's inputs, for display only (print/validation/save stay the resolver's). Candidate engine amendment: expose `derived` on `ResolvedOffer` and drop the helper. RENDERED: no (no server allowed) — QE checks layout/360 px/focus first.
- scope: helper files outside touch lists — `steps.ts`, `controlId.ts`, `derivedValue.ts`, `useFocusRequest.ts` (react-refresh rule) — where: `crm-ui/src/components/offerWizard/`
- assumption: `OfferWizard` props `mode, ast, answers, onAnswersChange, context`, optional `step`/`onStepChange`, `readOnly`, `onGenerate`, `generating`, `generateBlockedReason`, `onOpenPreview` — where: `OfferWizard.tsx`
- scope: optional `renderStep` prop as a test seam — where: `OfferWizard.tsx`
- reinterpretation: Annexes tab listed when the outline has annex items, or the context has an estimate, or the deal has PDFs (design S6 vs AC-1.2) — where: `steps.ts`
- reinterpretation: counts/missing/Generate state computed synchronously per render; the 250 ms debounce is for the preview only — where: `OfferWizard.tsx`
- assumption: "Required" shows only after blur; invalid reasons immediately; unparseable number → "Enter a number" after blur — where: `FieldInput.tsx`
- assumption: numeric inputs keep typed draft text; an unparseable text clears the answer — where: `FieldInput.tsx`
- assumption: hand-edited notice names ≤ 2 headings then "and n more" — where: `StepForm.tsx`
- scope: added strings `list.item`, `list.limit`, `table.removeNamed`, `table.up`, `table.down`, `table.removedLive` (en+it); `table.removeRow` unused — where: `strings/offerWizard.ts`
- assumption: new rows get `crypto.randomUUID()` (fallback timestamp+random); lists ≤ 50 × 2 000 chars, rows ≤ 50 — where: `RepeatableTableEditor.tsx`, `ListFieldEditor.tsx`
- default: `data-wizard-field` on the control or the list/table fieldset, `id` = `wiz-` + sanitised name — where: FieldInput/ListFieldEditor/RepeatableTableEditor

## T29, T30, T31, T32, T33 · backend-dev · 2026-11-15
- reinterpretation: hand-edit caps in the draft schema are heading ≤ 1 000 / body ≤ 100 000 (plan: 120 / 20 000), so an over-long hand edit saves and is reported at generate as `heading_too_long`/`section_too_long` — why: with caps equal to the resolver's limits an over-long draft would be unreadable (409 `draft_invalid`) and AC-5.4's generate half unreachable — where: `crm-api/src/offer-drafts/answersSchema.ts` — OWNER REVIEW (deviates from the plan's cap line)
- assumption: `PUT` takes `target` like `POST` and refuses a mismatch as 422 `answers_invalid {path:"target"}`; a `templateVersion` above current → 422 `{path:"templateVersion"}` — where: `offerDrafts.routes.ts`
- default: every `PUT` schema failure is 422 `answers_invalid` with a path relative to `answers` (per-route hook) — where: `offerDrafts.routes.ts`, `answersSchema.ts`
- default: `PUT` validates the body before the scope check, as all crm-api routes do (reveals nothing about a draft) — where: `offerDrafts.routes.ts`
- default: extra caps — record keys ≤ 200 chars, `__proto__` refused, ≤ 400 entries in fields/prefilled/blocks/lists/tables, ≤ 100 cost-line entries, ≤ 200 hand/orphaned edits, ≤ 50 cells per row, cost description ≤ 500, place ≤ 200, numbers `.safe()` — where: `answersSchema.ts`
- default: stored answers re-validated on every read (GET, generate); a non-fitting row → 409 `draft_invalid`; summary and DELETE still work — where: `offerDrafts.routes.ts`
- default: `POST`/switch refuse self-built answers that do not fit caps or carry reserved characters (422 with path) — where: `offerDrafts.routes.ts`
- default: switching to the draft's own template is a no-op (200, same version) — where: `offerDrafts.routes.ts` — OWNER REVIEW (unspecified)
- reinterpretation: the context route (no template yet) labels an unassigned release / missing epic in Italian; generation and POST use the template's language — where: `offer-drafts/context.ts`
- default: context answers 200 for `override`/`missing` estimates with empty figures and `annex: null`; 409 `entity_profile_missing` without a letterhead; lists non-archived contacts — where: `context.ts`
- assumption: edit/revision from a legacy contract offer starts with `client.date` null (dated the day of the edit, as 018), carries lines, active contacts, place; a wizard offer's own date is kept (DD-42) — where: `offerDrafts.routes.ts`
- default: a `new` draft refused 409 `offer_not_sent` at POST and at generate while the latest offer is an unsent contract; revision needs the sent latest (`offer_not_latest`/`offer_not_sent`); edit generate does not announce, new/revision announce E9 — where: `offerDrafts.routes.ts`
- default: edit draft's `targetOfferVersion` checked in the generate transaction (`offer_changed`, `offer_sent`); the replaced PDF deleted best-effort after commit — where: `offerDrafts.routes.ts`
- scope: compensation via a holder `written.objectKey`; any transaction failure (commit included) deletes the object — where: `offerDrafts.routes.ts`
- default: `wizardSnapshotOf` takes the deal currency; throws on a missing printed date or cost amount; `handEdited` always written for wizard sections — where: `generation.ts`
- assumption: log line `[offers] wizard offer generated dealId= offerId= templateId= templateVersion= target=` — where: `offerDrafts.routes.ts`
- known residual: a legacy offer's archived contacts are dropped when its draft is built.
- scope (outside touch lists): `toViews` exported (`offers.routes.ts`); `loadContext` split into `loadDealInScope`/`estimateLinkOf`/`loadProfile`, `loadAttachments` exported, `renderOffer` narrowed (`generation.ts`); 512 KiB body limit (`index.ts`); append-only fixtures (`world.ts`).
- test trap: import `../test-support/world` before anything reading env.

## T44, T45, T46 · frontend-dev (worktree) · 2026-11-15
Notes: RENDERED: no — QE checks first the sticky pane and `max-h-[80vh]` region at 1280/1024/360 px, cost-card focus order, paper light in dark theme. `documentText` exists as a test-local copy in `DocumentPreview.test.tsx`; T34's crm-api version must agree. API gap for T50: `OfferWizard` takes `effortAnnex` (context `estimate.annex`) and `referenceNote`; `onOpenPreview` only notifies. Engine candidate: a missing value inside a `###` sub-heading shows as plain upper-case text (no highlighted run).
- scope: helpers `MarkedText.tsx`, `splitMarked.ts`, `CostInputs.tsx`, `costValues.ts`, `useWideViewport.ts` — where: `components/offerWizard/`
- scope: additive edits to T41–T43 files (`StepForm` `bare`, `ListFieldEditor` caps, `StepPanel` `referenceNote`) — where: those files
- assumption: `OfferWizard` owns the preview — pane at ≥ 1280 px (matchMedia), Drawer below — where: `OfferWizard.tsx`
- assumption: preview resolves its own copy 250 ms after the last change, without a reference (pending run) — where: `DocumentPreview.tsx`
- assumption: effort annex table via an `EffortAnnexPreview` prop; without it only heading + AI note — where: `DocumentPreview.tsx`
- assumption: preview chrome carries `data-chrome` so parity excludes what the PDF does not draw — where: `DocumentPreview.tsx`
- assumption: numbering called with markers stripped; marked headings composed from `numberOffer`'s number + split text (DD-46) — where: `DocumentPreview.tsx`
- reinterpretation: `each=` lines show bound unit/quantity read-only in the row card ("Set in the table …") — where: `CostTableEditor.tsx`
- assumption: plain fields a cost line reads are edited in the first card that shows them and removed from the generic form — where: `CostTableEditor.tsx`
- assumption: switching a discount amount↔percent clears the other value — where: `CostTableEditor.tsx`
- assumption: unit/quantity columns off → entered quantities set to 1 and announced; bound quantities stay visible — where: `CostTableEditor.tsx`
- assumption: total rows hidden in the editor when "Show total rows" is off; validity input in the layout card only when no field binds `validityDays` — where: `CostTableEditor.tsx`
- assumption: AI-assisted toggle moves man-days fields still equal to their prefill (and `qty=manDays` quantities) to the other estimate figure; effort annex/AI enabled only for ready/unset estimates — where: `AnnexesStep.tsx` — OWNER REVIEW
- assumption: PDFs ≤ 5 / ≤ 20 MiB enforced in the UI (`annexes.pdfsTooBig`) — where: `AnnexesStep.tsx`
- scope: new strings (en+it) `costs.*` (kindLabel…spanTotal), `client.placeDate/dateInput/linesLimit`, `annexes.pdfsTooBig` — where: `strings/offerWizard.ts`
- default: `data-wizard-field` names `cost:<key>[#n]`, `cost:extra:<id>`, `cost:*`, `client:lines`, `client:place`, `client:date`, `annex:effort`, `annex:ai`
- assumption: date input label is its own key `client.dateInput` — where: `ClientStep.tsx`

## T39, T40 · frontend-dev (worktree) · 2026-11-15
Note for T50: build the engine's `WizardContext` from `WizardContextResponse` with `language` = the draft template's language and `today` from the response. `useOfferDraft(dealId)` returns `{load, draft, answers, ast, template, step, status, rejection, retryingLong, savedAt, notice, readOnly, generating, pending}` + `setAnswers`, `setStep`, `dismissNotice`, `reload`, `create`, `switchTemplate`, `generate`, `flush`; the page maps status to SaveStatus `saved|saving|retrying` and shows banners for `conflict|gone|rejected`; `generate()` flushes first and resolves `{kind:'unsaved'}` if the save failed.
- scope: `requestAnswered` added to `api.ts` (body, status, ETag); `requestJson` wraps it unchanged — where: `crm-ui/src/lib/api.ts` (outside touch list)
- scope: `draftInvalid`, `offerWizard` (en+it) added to `offers.errors` — where: `strings/offers.ts`
- default: calls take integer `version`, send `If-Match: "<version>"`, expose ETag (fallback to body version) — where: `crmApi.ts`
- default: `generateWizardDraft` returns a typed `incomplete` result and `created` (201 vs 200) — where: `crmApi.ts`
- default: new `listOfferTemplatesOf(entity, includeArchived, formats)`; `listOfferTemplates` unchanged — where: `crmApi.ts`
- assumption: `useOfferDraft` loads the draft's template itself and exposes `ast`/`template` — where: `useOfferDraft.ts`
- assumption: the hook owns `create`/`switchTemplate`/`generate` with flush-before-write — where: `useOfferDraft.ts`
- assumption: retryable = non-ApiError, 5xx, 408, 429 at 2/4/8/16 s; other 4xx stop autosave — where: `useOfferDraft.ts`
- assumption: 428 on save treated as 409 (stop + reload banner) — where: `useOfferDraft.ts`
- assumption: status `saving` while text waits for the debounce — where: `useOfferDraft.ts`
- assumption: a change back to the server state cancels the pending save; dirty compare excludes `lastStep` (DD-31) — where: `useOfferDraft.ts`
- assumption: `reload()` discards unsaved local changes; draft gone → `load: 'none'` — where: `useOfferDraft.ts`
- assumption: unmount sends one best-effort save, no keepalive/pagehide (apiFetch lacks keepalive); tab close relies on `beforeunload` — where: `useOfferDraft.ts`
- scope: `DraftSession` class read through `useSyncExternalStore` — ADR candidate "wizard draft state lives in a session object outside React" — where: `useOfferDraft.ts`
- assumption: no-storage guard scans wizard sources (comments excluded) for web storage, IndexedDB, Cache API, cookieStore, `.cookie`, storage libs, and asserts it found files — where: `lib/noBrowserStorage.test.ts`
- default: fake draft server `failNext(route, …)` — where: `test-support/fakeApi.ts`

## T47, T48 · frontend-dev (worktree) · 2026-11-15
For T50: `OfferWizard`/`StepPanelProps` gained optional `serverIssues` (422 `offer_incomplete` body), `issuesHeadingRef`, `commitAnswers(next): Promise<void>`. Open for T50: whether issue-jump buttons stay usable in a read-only draft (the step panel is a disabled fieldset). RENDERED: no — QE checks Preview at 360/1024/1280, the lg dialog at 360, caret scroll, stacked-dialog focus, jump focus.
- scope: `serverIssues`, `issuesHeadingRef`, `commitAnswers` props — where: `StepPanel.tsx`, `OfferWizard.tsx`
- scope: helpers `focusTarget.ts` (retries up to 60 frames), `handEdits.ts`, `IssuesList.tsx` — where: `components/offerWizard/`
- scope: `MarkupHelp` optional `placeholders`/`note` props (intro line still says "Placeholders are replaced…") — where: `components/MarkupHelp.tsx`
- reinterpretation: a `section:<key>` issue stays on Preview (target = its Edit text button) — where: `PreviewStep.tsx`
- reinterpretation: dialog "Restore wizard text" is a ghost button in the form body (FormDialog has no footer slot) — where: `HandEditDialog.tsx`
- reinterpretation: token/length errors are field errors with `errorRole="alert"`; length live, tokens on Save — where: `HandEditDialog.tsx`
- assumption: stored `sourceHeading` = section key minus `#n` — where: `handEdits.ts`
- assumption: a hand-edit heading may be empty (only the 120 limit) — where: `HandEditDialog.tsx`
- assumption: save/Restore failures through `offerFailure` — where: `HandEditDialog.tsx`, `PreviewStep.tsx`
- assumption: orphaned-hand-edits card with per-block Copy included (design S7.3) — where: `PreviewStep.tsx`
- scope: deal-context FactList (S7.4) and a second Generate in the Preview card (S7.1) NOT built; T50 can add — where: `PreviewStep.tsx`
- default: new strings (en+it) `issues.unknownReason`, `sections.tooLong/annexOf/orphanCopy/copied/editShort`, `edit.referenceNote/referenceStrayHeading/referenceStrayBody/markupNote`

## T34, T35, T36, T37, T56 · backend-dev · 2026-11-15
Drift (T35, fidelity): three differences from the mockup outside AC-9.6's six, caused by the frozen engine/renderer, asserted in `OBSERVED_DRIFT`: (1) Italian offers print number fields with a decimal comma (`0,5`, `99,5%`) where the mockup printed `0.5`/`99.5%` (engine `formatNumber`, DD-21); (2) amounts use 018's formatting (`48’000`) not the mockup's `48'000.-`, and a discount row prints a unit and quantity the mockup leaves blank; (3) a row typed into the cost table goes before the last total row (DD-35), the mockup put it before the discount row.
Orchestrator decision (delegated): amend AC-9.6 to list these three (SA-5) rather than change the frozen engine unattended. OWNER REVIEW — especially (1): Swiss convention for welld_ch is a decimal POINT; making `formatNumber` entity-aware is an engine change for a follow-up.
Orchestrator decision: T56's rollback SQL validated by `EXPLAIN` of both UPDATEs + real read-only SELECT on crm_test, never executed — accepted as meeting the done-when's intent.
T37 sample PDFs (owner review, R2): /private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/0dfeb7ea-d906-446c-b448-cb2febc4063f/scratchpad/wizard-samples/{T1,T2,T3,T4,T5,T6,T1+T3}.pdf
- scope: `documentText` includes the CRM-drawn header, acceptance block and "Allegati:" list, tagged by region — where: `test-support/documentText.ts`
- assumption: parity compares part-by-part ignoring whitespace; a repeated table header accepted only after a page break; list markers may follow their text — where: `documentText.ts`
- scope: parity runs three variants per seed (defaults; all blocks on; all on + effort annex + two PDFs) — where: `offers/parity.test.ts`
- reinterpretation: mockup cost-row number = 1-based position among `@@costs` items (totals included); `sconto` → the single discount line — where: `wizardSeeds/goldenAnswers.ts`
- assumption: T5 golden `ELENCO_ALLEGATI` dropped (AC-9.6 #4); `REFERENTE_CLIENTE` → the context contact — where: `goldenAnswers.ts`
- scope: six-entry allow-list explicit; #6 no-op; #5 checked with an EUR context — where: `fidelity.test.ts`
- default: seed fix — T1's `scelta` option line no longer starts with a literal "□ " (the renderer draws the box, DD-22) — where: `welldChIt.T1.ts`
- default: headings compared ignoring number prefix and case — where: `fidelity.test.ts`
- scope: T36 re-renders the stored snapshot with the draw-log hook — where: `offer-drafts/crossEntity.test.ts`
- default: T37 samples — `sampleAnswers`, all optional blocks on, `0001/2026`, plain letterhead, no effort annex — where: `scripts/render-wizard-samples.ts`
- assumption: T37 script fills six env vars with inert placeholders when unset, imports `wizardSnapshotOf` dynamically — where: `scripts/render-wizard-samples.ts`
- scope: R13 query reads opening/section bodies of classic templates and non-deleted `contract` snapshots — where: `infra/README.md`
- assumption: rollback restores classic templates archived from 1 minute before the pair's first wizard template; wizard rows archived first — where: `infra/README.md`
- risk: `documentText` is a second implementation of draw order and cost logic; a bug shared by both would pass.

## Collision · T47 ↔ T49 · 2026-11-15
- collision: integrating T49 (FE-F) onto the branch holding T47 (FE-E) conflicted on `crm-ui/src/components/offerWizard/StepPanel.tsx` (both added props/cases; `OfferWizard.tsx` too). The touch lists did not declare these additive edits (both agents reported them as outside their lists). Resolution: rebase aborted; a fresh agent re-applies T49/T52 onto the integrated tree keeping both additions, gates re-run. Lesson: the wizard frame files (`OfferWizard.tsx`, `StepPanel.tsx`) act as a shared registry — later wizard tasks must be serialized on them.
- resolved: rebase kept both sides in `StepPanel.tsx` (props + `preview`/`template` cases), `OfferWizard.tsx` (props, destructure, `stepProps`, Template-step fieldset exemption) and `MarkupHelp.tsx` (branch's `placeholders`/`note` + T52's hoisted `rows` and `WizardMarkupReference`); 975 crm-ui tests green after the rebase.

## T49, T52 · frontend-dev (worktree) · 2026-11-15
For T50: pass `Deal` and the context's `latestOffer` via the `templateStep` prop; render `TemplateStep` directly when no draft exists. RENDERED: no — QE checks scroll-to-line, editor two-column layout at ≥1280/360 px, Template card grid in the half-width pane, editor focus order.
- reinterpretation: `TemplateStep` inputs via a new optional `templateStep` prop; the read-only fieldset exempts the Template step (design F8) — where: `OfferWizard.tsx`, `StepPanel.tsx`
- assumption: "Use classic form" mounts `GenerateOfferDialog` unchanged (no preselect) — where: `TemplateStep.tsx`
- reinterpretation: wizard editor in `components/templateEditor/WizardTemplateEditor.tsx` with `lines.ts`, `problemMessage.ts`; the page picks the editor — where: `templateEditor/`
- reinterpretation: `OfferTemplates.test.tsx` adapted (formats query; classic tests edit an existing template; "create classic" → taken-name on PUT); file reflowed by the formatter — where: `pages/OfferTemplates.test.tsx`
- default: template cards `md:grid-cols-2` (design said `xl:grid-cols-3`); groups are `h4` — where: `TemplateStep.tsx`
- assumption: status line prints raw digits ("4210 of 150000") — where: `TemplateTextArea.tsx`
- assumption: classic Duplicate stays on the list with a notice; wizard Duplicate opens the copy's editor — where: `TemplatesCard.tsx`
- default: failed sibling lookup for the supersede note is silent — where: `WizardTemplateEditor.tsx`
- default: "Try the wizard" view not built (T53) — where: `WizardTemplateEditor.tsx`
- scope: new strings (en+it) `offerWizard.template.useOf/openSettings/classic.useOf`, `templates.wizardEditor.syntaxClose/usesLimit/problemsSummary/optional/fills/fillsFor/outlineSections/outlineAnnex/costKind/costTotal`, `templates.markup.wizard.*`; `templates.list.description` reworded
- assumption: problem selection scrolls via `revealRange` (untestable in jsdom) — where: `templateEditor/lines.ts`

## T50, T51, T53 · frontend-dev · 2026-11-15
Gap: on 409 `template_archived` at create, the Template step's list does not reload (TemplateStep owns its `useResource`); the error shows inline. RENDERED: no — QE checks sticky pane/action bar at 1280/1024/360, banner stacking, focus after Reload and failed Generate, dropped-answers dialog, draft row at 360, Try-view nested tabs.
- default: issue-jump buttons stay disabled in a read-only draft (step tabs, Back, Template still work) — where: `OfferWizardPage.tsx`
- assumption: route search `?step=` + `?kind=edit|revision&offer=<id>`, honoured only for the deal's newest offer — where: `router.tsx`, `OfferWizardPage.tsx`
- assumption: with a draft present the Template step gets `latestOffer: null`, `target: null` — where: `OfferWizardPage.tsx`
- assumption: revision banner's next reference computed client-side `…r(n+1)` mirroring `generation.ts` — where: `OfferWizardPage.tsx`
- assumption: `commitAnswers` saves via the session's `flush`, rejecting with worded ApiErrors; a hand-edit dialog on a conflicted draft is refused — where: `OfferWizardPage.tsx`
- scope: `HistoryState` gains `generated?`/`proposePrompt?`; the deal page confirms once and clears — where: `router.tsx`, `DealDetailPage.tsx`, `OffersCard.tsx`
- scope: the legacy "Generate offer" button kept (secondary) beside the new primary "New offer" while no draft exists — why: T51 requires the legacy dialog tests unchanged — where: `OffersCard.tsx` — OWNER REVIEW (remove when the classic form is retired)
- assumption: "New offer" always enabled (the Template step shows the estimate gate) — where: `OffersCard.tsx`
- assumption: header actions hidden only when a draft is known to exist; a wizard start over an existing draft opens it via 409 `draft_exists` — where: `OffersCard.tsx`
- assumption: "Classic template" origin line only for `origin === 'sections'` — where: `OffersCard.tsx`
- reinterpretation: a classic offer goes to the wizard when any active wizard template of the entity exists in the offer's language (read on click; failure → legacy dialog) — where: `OffersCard.tsx`
- assumption: Discard 404 = success; 409 refetches the summary in place — where: `OffersCard.tsx`
- assumption: Generate failure banner page-level, Preview step only, cleared on any answer change — where: `OfferWizardPage.tsx`
- scope: Try view in `WizardTemplateEditor.tsx` as a second Tabs view with `TryWizardView.tsx`; local answers, Reset; no effort annex preview — where: `components/templateEditor/`
- default: dropped-answers dialog lists names as written (fields gone from the template) — where: `OfferWizardPage.tsx`
- scope: string "Checking for a draft…" (en+it) added — where: `strings/offers.ts`
- scope: T53 edited `WizardTemplateEditor.tsx` (not `TemplateEditorPage.tsx`) since T52 moved the editor.

## Orchestrator · e2e environment · 2026-11-15
- BLOCKED (environment, not a defect): the e2e journeys (T54, T55) run against the user's `mise run dev` stack, whose crm-api uses the DEV database `crm`; the `20261115120000_offer_wizard` migration is not applied there, and the owner's standing rule forbids migrating the dev DB without being asked. Decision: T54/T55 are written and verified with `playwright test --list` + typecheck, NOT executed; QE records the e2e/browser rows as BLOCKED. Note for the owner: the running crm-api (`bun --hot`) already serves the new code against the un-migrated dev DB, so offer pages in the local app may error until `bun run db:deploy` is run on `crm`.

## T54, T55, T57 · frontend-dev · 2026-11-15
T54/T55 written, listed (8 tests), typechecked, linted — NOT run (environment block). Owner's commands: `cd crm-api && bun run db:deploy` (against the DB crm-api uses), then `cd shell && E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e crm-offer-wizard.spec.ts crm-offer-wizard-revise.spec.ts`. Blind-written locators to check on first run: "Italian templates" heading, "Nothing is missing. You can generate the offer.", field focus after an issue click, `crm-template-outline`, "No problems", sample-mode "Scope"/"Preview" tabs; `generateClassicOfferViaApi`; the fixed 2 s wait in the conflict journey.
- scope: shared fixtures in the T54 commit — where: `shell/e2e/helpers/crmOfferFixtures.ts`
- default: journeys reaching a generated offer use a minimal Italian wizard template created per run and archived after; the seeded template only in the Template-step journey — where: fixtures, specs
- assumption: the estimate gate passed with the admin override — where: `createDealPastEstimateGate`
- default: one admin `crm-offer-qe-admin@operai.test` in 2–3 browser contexts stands in for "two people" (AC-6.3) — where: AC-6.3 test
- assumption: `ensureEntityProfile` writes a welld_ch letterhead profile only if none exists — where: fixtures
- default: the legacy test skips (with reason) if welld_ch English has an active wizard template or no classic one — where: `crm-offer-wizard-revise.spec.ts`
- assumption: browser in English; assertions use English strings — where: both specs
- risk: a run spends a few welld_ch offer numbers on its database.
- T57: `.changeset/crm-offer-wizard.md` — `@operai/crm-api` minor, `@operai/crm-ui` minor, `@operai/ui` minor, `@operai/shell` patch; `changeset:check` OK.

## Orchestrator · QE + security round 1 · 2026-11-15
QE FAIL (18 PASS / 4 FAIL / 3 BLOCKED; 53/53 ACs evidenced at unit/integration/component level; e2e + browser rows BLOCKED by the dev-DB environment). Security FAIL (M-1 medium; L-1, L-2 low). Fix round 1 of 2 (fresh agents):
- D1 = M-1 (medium, code → backend, BOTH engine copies — authorised engine change, it enforces AC-3.3's approved section limit): a resolved (non-hand-edited) section or annex section whose body exceeds 20 000 characters is reported as `invalid` `section_too_long` at `section:<key>` (generate → 422 `offer_incomplete`); the resolver stops building a section once it passes the limit (bounded work and memory, also in the browser preview). Test with a ~50 000-reference template.
- D2 = L-1 (code → backend): U+0000 anywhere in draft answers (strings and keys) → 422 `answers_invalid` with its path, never 500.
- D5 (code → backend): the placeholder DB URL in `crm-api/scripts/render-wizard-samples.ts` — make it not look like a credential or allowlist it by fingerprint in `.betterleaksignore` (project rule).
- D4 (spec → PO, then backend): seed labels T2 TARIFFA "CHF / giorno" and T4 "(CHF)" contradict AC-2.5 on non-CHF deals — decision: make those labels currency-neutral; PO lists it in AC-9.6 (SA-6).
- D3 (code → frontend): Preview step lacks design S7.1 (Generate in the issues card) and S7.4 (deal-context FactList).
- QE's untracked `offerDrafts.visibility.test.ts` (AC-6.2 on all five write routes) to be committed by the backend fixer.
- L-2 (lazy seeding archives legacy templates on a `formats=wizard` read, gated by `deal:financials` only) — plan decision DD-10, left for the OWNER, not fixed.

## QE D3 fix · frontend-dev (worktree) · 2026-11-15
- scope: one shared `GenerateControl` used by the action bar and the Preview issues card — where: `GenerateControl.tsx`, `WizardActionBar.tsx`, `PreviewStep.tsx`
- assumption: the card's blocked state/counts come from the engine counts (not `serverIssues`), so a retry stays possible — where: `OfferWizard.tsx`
- scope: facts card titled "Offer settings", placed last; facts = template name, language, currency, validity, effort annex, PDF count — where: `PreviewStep.tsx`, `strings/offerWizard.ts`
- assumption: language shown by name, validity "N days", effort annex Included/Not included — where: strings
- reinterpretation: `OfferWizardPage.test.tsx` scopes Generate to the action bar and asserts both buttons blocked — where: that test
- follow-up: e2e specs `crm-offer-wizard.spec.ts:218`, `crm-offer-wizard-revise.spec.ts:123,170` now match two "Generate offer" buttons — scope them to the action bar.

## QE D1, D2, D4, D5 fix · backend-dev · 2026-11-15
ADR candidate: the output-bounding rule (per-unit character budget counted while building; `section_too_long` reused for opening/annex intro/cost labels) amends the engine-freeze decision — authorised by the orchestrator for D1.
Owner note: `.betterleaksignore` gains two COMMIT-PREFIXED fingerprints (738cbed6, 14cbefb0) — they must be regenerated if the branch is squashed or rebased before merge (the file's own convention).
Owner note: seeding is lazy — a database that already seeded the old T2/T4 labels keeps them until re-seeded.
- scope: the output bound also covers the opening, annex intros and cost labels — where: both `resolve.ts`, `vectors/resolve.json § bounds`
- reinterpretation: `section_too_long` reused with names `opening`, `annex:<designation>`, `cost:labels` (no new code) — where: `resolve.ts`
- default: build stops at 21 000 chars (`MAX_EDIT_BODY` + 1 000 slack); the final body length decides 20 000/20 001 exactly — where: `resolve.ts` `MAX_BUILD`
- default: D2 enforced in the zod schema (`noNul`, `reason: "shape"`), not in `checkAnswers` — where: `answersSchema.ts`
- default: D5 allowlist entries are commit-prefixed fingerprints — where: `.betterleaksignore`
- default: seed labels "Tariffa / giorno" and "Prezzo per partecipante aggiuntivo" (SA-6) — where: `welldChIt.T2.ts`, `welldChIt.T4.ts`
- assumption: 150 MB rss / 1 s bounds in amplification tests are loose upper bounds — where: `resolve.bounds.test.ts`, `offerDrafts.generate.test.ts`
- residual: a section truncated at the limit opens in the hand-edit dialog already over 20 000 (dialog cannot save over the limit); `index.ts` `onError` still logs raw errors (L-1 optional hardening, out of scope).

## Orchestrator · QE round 2 + security round 2 · 2026-11-15
Security round 2 PASS (M-1, L-1 closed; L-3 low = D7; I-4 info). QE round 2 FAIL (18 PASS / 2 FAIL / 3 BLOCKED): all round-1 defects fixed at every placement; three NEW defects the previous passes missed — D6 (introduced by the D1 fix: `Resolver.section()` returns null before the `section_too_long` check when a section's first line alone exceeds the budget, so a section/annex section is dropped silently — numbered section ✗, annex section ✗), D7 (NUL in `templateId` → 500 at `POST offer-draft` and `POST offer-draft/template`), D8 (info: seed example `es. 25 EUR` in T4 `BUDGET_AI`). Fix round 2 of 2 — the LAST allowed; a further FAIL escalates to the owner.
- delegated (D8): examples and hints are currency-neutral too, like labels (SA-6 extended); the seed example becomes "es. 25".

## QE D6, D7, D8 fix · backend-dev · 2026-11-15
- scope: D7 fixes `IdParams` in `crm-api/src/lib/http.ts` (shared by every crm-api route) — the single root cause — where: `lib/http.ts`
- scope: legacy template PUT body guarded by one recursive NUL scan in `parseBody` (422, dotted path, value never echoed) — where: `offerTemplates.routes.ts`
- default: an over-budget annex that does not print commits only its `section_too_long` issues — where: both `resolve.ts`
- default: a section whose heading the budget refused is kept with its source heading and reported (unreachable by value today) — where: both `resolve.ts`
- default: vectors gain an optional per-case `template`, consumed by both runners — where: `vectors/resolve.json`, runners
- default: the SA-6 seed test also checks explain, default, options, columns — where: `fidelity.test.ts`
- default: golden answers/text with "25 EUR" unchanged (the mockup's printed answer) — where: `wizardSeeds/golden/`
- assumption: lazily seeded databases keep the old T4 example until re-seeded — where: `welldChIt.T4.ts`
- orchestrator: the remaining betterleaks finding was the placeholder quoted in `security-review.md` (commit 90433fb3, the orchestrator's own commit) — allowlisted by fingerprint like D5's; regenerate after squash/rebase.

## Orchestrator · ESCALATION · 2026-11-15
QE round 3 FAIL (17 PASS / 2 FAIL / 3 BLOCKED) and security round 3 FAIL. The 2-round fix cap is reached; no third round was started without the owner. Open defects:
- D10 = M-2 (medium, dev): `pathOfNul` recursive NUL scan on legacy `PUT /offer-templates/{id}` is O(depth²) and overflows the stack (depth 40 000 → 500 RangeError, ~1 s event-loop block with a transaction open). Introduced by the D7 fix (3043d252). Fix: iterative scan with a depth cap (422) or `noNul` on `TemplateContentSchema` strings. Repro: scratchpad/probe/deep.test.ts.
- D9 = L-4 (low, dev, pre-existing on main): NUL in `offerId`/`aid` path params and `GET /deals/{id}/offers/draft?templateId=` → 500 (offers + attachments routes). Repro: scratchpad/probe/nul.test.ts.
- D11 (hygiene): empty file `crm-api/src/offer-templates/wizardSeeds/elldChIt.T4.ts` committed by mistake (6561ca70).
- info: `fidelity.test.ts` header still says "six differences"; resolved heading/annex title bounded only by the 21 000 budget; recurring `meetings-ui` NotesCard flake under load.
Owner's exits: (a) grant one more fix round for D10, D9, D11 (recommended — all three are small and localised); (b) split D9 into a follow-up bugfix (pre-existing) and fix D10/D11 here; (c) stop.

## Fix round 3 (extension granted by the owner, 2026-11-15) · backend-dev · D10, D9, D11
Owner: "procedi con a e migra pure il db di sviluppo". Dev DB `crm` migrated by the orchestrator with `bun run db:deploy` — it also applied `20261111120000_drop_activity_tables` (already on main, specs/028 T14, pending on this machine).
Commits: 15a60fe7 (D11), 8b1c8ebb (fidelity header), 424310d1 (D10), 77bca40e (D9). crm-api 1453 pass on crm_test, typecheck clean, shared copies 31/31.
- default: a body deeper than 32 levels is a 422 on the legacy template PUT, not just scanned iteratively — why: no template body goes past ~5 levels; the cap bounds work on hostile input — where: crm-api/src/offer-templates/offerTemplates.routes.ts (`MAX_BODY_DEPTH`)
- reinterpretation: the D9 sweep covers every string id, filter and search `q` reaching Prisma or another service (path, query AND body ids), not only the path/query ids named — why: same defect class, same helper — where: crm-api/src/lib/http.ts `idText`/`searchText`, 13 files
- default: one shared helper pair in `lib/http.ts` (`idText`, `searchText`) with D7's `IdParams` rebuilt on it — why: reuse the D7 mechanism — where: crm-api/src/lib/http.ts
- default: optional filters keep min 0 (`idText(64, 0)`) so an empty `?companyId=` behaves as before — where: deals/contacts/companies list queries, `/pipeline`
- scope: a NUL in free-text body fields (`requiredText`/`optionalText`: names, notes, titles) still answers 500 — pre-existing, outside the granted defects; **OWNER REVIEW — recorded as a follow-up bugfix, not added here (scope frozen)**; a two-line refine in `lib/http.ts`
- default: a NUL id is 400 on service routes and 422 on user routes (each router keeps its validation status) — where: crm-api/src/lib/nulIds.test.ts
- default: `rawBody` added to the test helper `call` — why: `JSON.stringify` cannot build a 200 000-deep body — where: crm-api/src/test-support/world.ts
- default: fidelity.test.ts header reworded to match the test — where: crm-api/src/offer-templates/wizardSeeds/fidelity.test.ts

## Owner manual test · orchestrator · 2026-11-15
Found by the owner in the browser after the crm-api restart; missed by every suite because in-process tests send no CORS preflight and the e2e were BLOCKED.
- defect: `POST /deals/{id}/offer-draft` with `If-None-Match: *` blocked by the preflight (crm-api `allowHeaders` listed only `If-Match`) — fixed in crm-api/src/index.ts, pinned by crm-api/src/cors.test.ts (red first, then green); crm-api 1454 pass on crm_test. Counted against the round-3 extension (same owner-granted round), not a fourth round.
- environment: the `activities` dev DB lacked `20261113120000_task_description_files` (on main, ADR 20261113-task-description-files-in-activities-api-bucket; additive) → applied with `bun run db:deploy`, on the owner's "migra pure il db di sviluppo".
- environment: crm-api `bun --hot` keeps its Prisma client on `globalThis`, so a schema change needs a process restart, not a hot reload (restarted by the owner).
- e2e T54/T55 first run on the migrated dev stack: 8/8 green after two TEST defects were fixed (not app defects): `Use template <name>` matched "Progetto a corpo" and "Progetto a corpo con SLA" (now `exact: true`); the discard confirm was looked up as `dialog` but @operai/ui ConfirmDialog is (correctly) an `alertdialog`.

## Owner manual test (2) · frontend-dev (worktree) · D12, D13 · 2026-11-15
Found by the owner on the Costs step; counted as fix-round extension 4 (owner-reported, owner present). Commits 73240385 (D12), a4a29201 (D13); crm-ui 1081 pass, lint/build green; RENDERED: no (verified by the browser QE).
- default: "Percent chosen, no value yet" is UI state in `OfferWizard` passed down, not stored in the answers — why: the stored shape cannot represent it; changing the shared engine and server schema was not worth it for a state with no data — where: OfferWizard.tsx, StepPanel.tsx, CostTableEditor.tsx (D12)
- assumption: after a reload, a Percent line that never received a value comes back on Amount with the field empty (nothing lost); a line with a stored percentage reloads on Percent — where: D12. **OWNER REVIEW**
- default: a template field bound to `validityDays` keeps its own label, takes the standard hint, whole number 1–365 (decimal refused); the Costs step hides its own input when such a field exists — where: ValidityDaysInput.tsx, StepForm.tsx (D13)
- reinterpretation: sources edited in the wizard's own place (client, place, date, reference, issuer, currency…) stay hidden as form fields; estimate-prefilled sources (deal, epics, phases, timeline, manDays) stay editable; only `validityDays` changed — where: SystemSources.test.tsx

## Owner scope addition · 2026-11-15
After testing, the owner chose (AskUserQuestion): (1) draw the entity's letterhead behind the HTML preview (declined: a "PDF preview" button; keeping it text-only); (2) the issuer's legal name comes from the entity profile, never written in template text (seeds said "WellD Sagl", the profile "wellD SA"). Gate 1 re-opened for these two only: PO amends spec → architect amends plan → tasks re-sync → implement → QE.

## QE round 4 fixes · frontend-dev (worktree) · D14–D18 · 2026-11-15
Fix-round extension 5 (owner present, driving). Commits b81955a9 (D14), 94479fb3 (D16), 4d2d7337 (D17), ba7e3c49 (D18), 9ee4f5c7 (D15). crm-ui 1103 pass, lint/tsc/build green; RENDERED: no — browser check of D15 (360, 1280 hand-edited row), D18 (1280/1024/360), D17 axe is for the next QE.
- scope: the invalid validity text is held in `OfferWizard` state and overlaid onto the engine's issues (empty = missing, else invalid); engine untouched — where: OfferWizard.tsx, validityEntry.ts, ValidityDaysInput.tsx
- assumption: wizard-only invalid code `days_out_of_range` cast to `InvalidCode`, own en/it string ("whole number of days from 1 to 365"); the engine's `out_of_range` text says "Must be 0 or more" — where: OfferWizard.tsx, strings/offerWizard.ts
- default: an out-of-range whole number shows its error as typed; blank/unreadable waits for blur — where: ValidityDaysInput.tsx
- scope: D14 class sweep also capped text answers (`maxLength` 20 000 = server) and kept ≥1 client line (`minItems` on ListFieldEditor) — where: FieldInput.tsx, ListFieldEditor.tsx, ClientStep.tsx
- reinterpretation: D15 breakpoint is the Sections list's OWN width (640 px, `useElementWidth`), not the viewport — why: at 1280 the form column is ~500 px — where: PreviewStep.tsx
- scope: no responsive-table/card-stack pattern added to @operai/ui; **OWNER REVIEW — library candidate** (DataTable stacking below a container width; OffersCard has the same pre-existing clipping)
- scope: D17 fixed in the syntax reference content (focusable labelled region), not the library Drawer — why: the preview drawer already has its own focusable region
- default: D18 two-column threshold = container `@lg` (32 rem) — where: TemplateStep.tsx
- reinterpretation: `save.rejected` takes the reason sentence with its own full stop — where: strings/offerWizard.ts
- noted risk: a dialog opened from a Sections row that changes the width across 640 px remounts the trigger (focus not restored); no hysteresis.

## Plan amendment (US-11, US-12) · architect · 2026-11-15
DD-53…DD-64 delegated (see plan.md § Amendment). Renderer: pdfjs-dist 5.x in crm-ui, main thread, lazy, under the current CSP; L0 spike must prove it (R21) before UI tasks, fallback = server rasterisation (owner's call). R22: CRM bucket CORS must allow GET in production.
Orchestrator, on the owner's delegation ("procedi senza il mio intervento", 2026-11-15):
- O8 → keep the one-time v1→v2 seed upgrade (AC-12.5/12.6/12.11 approved; dev and preview DBs hold v1 seeds). **OWNER REVIEW**
- O9 → accept: a letterhead with non-embedded fonts / wasm-only codecs may draw incompletely in the PREVIEW only (the owner chose an approximate preview); L0 checks both real letterheads. **OWNER REVIEW**
- O10 → no: only legal name and address are listed as supplied by the CRM in the editor (scope frozen to the owner's request).
- finding (not in scope): the old dialog route `POST /deals/{id}/offers` still prints a blank legal name on damaged data — follow-up.
- ADR candidates 8–10 → adr-writer after implementation.

## Owner manual test (3) · frontend-dev (main tree) · D19 preview scroll · 2026-11-15
Commit ab54f5f5. RENDERED: yes (1280×800, 1280×600, 1920×1080, 1024×768 Drawer; sidebar expanded/collapsed; light/dark). crm-ui 1108 pass; e2e T54/T55 8/8. Screenshots: scratchpad/d19/after4-*.png.
Cause: the shell's `<main>` is the scroller (not the window), so `80vh`/`sticky top-4` ignored the chrome; no `overscroll-behavior` (wheel chained to `main`); and the paper's `sr-only` text (absolute) had `main` as containing block, adding ~2000 px of phantom scroll.
- default: the form column scrolls `main`; the preview pane stays sticky with its height measured from the real scroll container (`useFitToScrollport`), not a two-pane layout — why: ~370 px of chrome at 1280×800 would leave a ~220 px fixed pane and nest the form in a second scroller — where: crm-ui/src/hooks/useFitToScrollport.ts, OfferWizard.tsx
- default: region height measured by a hook (scroll/resize/ancestor-resize), written as an inline runtime `height` — where: useFitToScrollport.ts
- assumption: settled top = max(flow place, pinned place), never the sticky clamped place (feedback runaway measured at 860 px) — where: useFitToScrollport.ts
- scope: `relative` on the preview region contains the sr-only text — where: DocumentPreview.tsx
- default: min fitted height 160 px, 16 px gap; `overscroll-contain` also on the Drawer region
- scope: action bar found by `data-wizard-action-bar` (`ACTION_BAR_ATTRIBUTE`)
- open: at 1280×800, scroll 0, the preview starts ~260 px tall (chrome above the wizard) and grows to ~550 px once the page scrolls; making it taller at load needs the CRM/wizard header to shrink. **OWNER REVIEW** — accepted for now by the orchestrator under delegation.

## T59 (L0 spike) · frontend-dev · 2026-11-15 — GO
Commits 2aac9c83 (renderer, 11 tests, pin, fixture shell/e2e/fixtures/letterhead-a4.pdf), d9350822 (infra/README.md release checklist: CRM bucket CORS). crm-ui 1119 pass. RENDERED: yes (harness on the shell origin under the production CSP; evidence scratchpad/l0/).
- default: `pdfjs-dist` 5.7.284 exact (newest 5.x, 2026-04-27) — where: crm-ui/package.json
- reinterpretation: `isEvalSupported` dropped (removed in 5.x, no eval in the library) — plan corrected (§ L0 findings)
- reinterpretation: render with an own alpha-enabled 2D context — a letterhead with no page fill rendered opaque black — plan corrected
- default: `verbosity: ERRORS`; 1600 px render width kept (longest task ≈ 100 ms)
- scope: `renderLetterhead` rejects non-PDF and > 5 MiB before loading pdf.js; exports the constants for DD-54's fetch
- assumption: CSP verified with a local server sending the exact production header, not a Vercel preview — Vercel's `/assets` CORS not exercised
- O9: welld_ch letterhead draws completely; **welld_it not available locally — render the production file before release (OWNER REVIEW / release checklist)**
- R22: production CRM bucket CORS unknown — a person must run the check in infra/README.md before release

## T60 · backend-dev (worktree) · 2026-11-15
Commit b2b8bcb8 (rebased). Shared copies 32/32; crm-api 1489 pass on crm_test; crm-ui 1143 pass, lint/build green. Hostile issuer vectors mutation-tested.
- assumption: `systemRead` lists every system source read, not only the issuer ones; the UI filters for `issuerAddress` — where: resolve.ts
- assumption: conditions of a hand-edited section record nothing; its cost table (printed from the template) still records — where: resolve.ts `section()`
- reinterpretation: engine `sampleContext` now "Fornitore di esempio SA" / "Sample Supplier Ltd", address "Via Esempio 2, 6900 Lugano"; goldenAnswers.ts keeps "WellD Sagl" explicitly so the golden fidelity is unaffected — where: answers.ts
- scope: three edits outside `touch:` to compile/stay green: context.ts passes `profile.addressLines`; OfferWizardPage.tsx passes `[]` until T62/T66; SystemSources.test.tsx lists `issuerAddress` as own-place
- default: new vectors file `vectors/issuer.json` (cases, hostile, reads, supplied) rather than extending resolve.json
- assumption: only `\r`/`\n` folded in supplied values; other Unicode line separators print as "?" (not WinAnsi) — where: resolve.ts `oneLine`

## T62 · backend-dev (worktree) · 2026-11-15
Commit 742eb120 (rebased). crm-api 1499 pass on crm_test; typecheck clean; shared copies 32/32. New offerDrafts.issuer.test.ts (10 tests).
- default: the context route's OpenAPI response is typed for the three issuer members with `.passthrough()` — where: offerDrafts.routes.ts
- default: `requireIssuerName` runs in the generate handler after `loadWizardInputs` (the loader serves the context/draft routes that must keep answering) — a refused generate still costs one EstimAI read — where: offerDrafts.routes.ts, generation.ts
- default: `no-store` only on the 200 letterhead link answer — where: entityProfiles.routes.ts
- assumption: "never logs the link" guarded by a console spy test; the path-only logger already guarantees it
- note: the AC-12.4 snapshot tests and the no-log test passed on first run (behaviour already existed) — already-green, not test-first

## T64 · frontend-dev (worktree) · 2026-11-15
Commit 6369135e (rebased). crm-ui 1184 pass, lint/build green. RENDERED: no (hook + lib; the render path was proven by T59).
- reinterpretation: `present: null` → `pending`, nothing starts (design G11), over the plan sketch's immediate `failed` — where: useLetterhead.ts
- default: hook returns `{ state, src?, request }`; the first mounted preview calls `request()` (DD-54)
- default: the page owns the attempt (hook called once in the page, passed to pane and Drawer); no module-level cache; each page mount is a new opening — where: useLetterhead.ts
- assumption: an attempt aborted by an input change (entity switch) does not count; a settled result is kept per entity
- default: `fetchLetterheadBytes` also refuses an oversize `content-length` up front; `credentials: 'omit'`, `no-store`, `no-referrer`, `redirect: 'error'`
- note: `fetchLetterheadBytes` tests were written after the function (test-after, not mutated)
- handoff: `OfferWizardPage.tsx` still passes `issuerAddressLines: []` — mapping and hook wiring are T65/T66

## T61 · backend-dev (worktree) · 2026-11-15
Commit e01635e0 (rebased onto T62). Integrated crm-api suite (T61+T62) 1545 pass on crm_test; typecheck clean; seed-digests --check matches history. Own DB crm_test_t61 used and dropped.
- scope: three key assertions in offerTemplates.seed.test.ts moved to `welld-ch-it-v2` (outside touch; T63 owns the file)
- scope: one-line stand-in `{ issuerAddressLines: [], ...rest }` in offerDrafts.generate.test.ts helper (the route response overrides it since T62)
- default: digests in generated `wizardSeeds/v1Digests.ts` (`{sha256, commit}[]` per code; T1 2, T2 2, T3 1, T4 3, T5 1, T6 1, T1+T3 1); `toV1` shipped in `wizardSeeds/toV1.ts`
- assumption: a v1 text = any historic export lacking `@@field EMITTENTE`; every distinct one recorded (exact match only, so wider is harmless)
- default: seed-digests evaluates the template literal itself (refusing `${`); sample script refuses blank name/line and > 5 lines
- reinterpretation: «WellD» counted once per SLA seed
- gap until T63: a dev DB holding v1 rows skips inserting v2 (name taken) and keeps "WellD Sagl"

## T63 · backend-dev (worktree) · 2026-11-15
Commit e27e908a (rebased). crm-api 1563 pass on crm_test; seedUpgrade 18 tests incl. 5 concurrent lists → one upgrade; mutation-checked.
- default: the "kept" mark does not bump `version` and restores `updatedAt` (bookkeeping, not an edit) — where: wizardSeeds/upgrade.ts
- default: raw `SELECT … FOR UPDATE` then read, update guarded by `version = seen`; a lost race is skipped and decided by the next read
- default: fast path only when no v1-keyed row exists and ≥ 7 rows carry v2/kept keys (DD-60)
- default: optional injected digest table for tests; log line = entity, code, outcome only
- assumption: a v1-keyed row whose code is not in the catalog is left alone
- dev DB effect (owner's `crm`): on the first wizard listing of welld_ch, untouched v1 rows → v2 text (issuer from the profile), key v2, version + 1 (drafts get the "template changed" notice); edited rows → key `welld-ch-it-v1-kept:*`, text unchanged ("WellD Sagl" stays), never revisited.

## T65 · frontend-dev (main tree) · 2026-11-15
Commit efc0ce1c. crm-ui 1216 pass, lint/build green. RENDERED: yes (1280×800 light/dark: letterhead behind text, A4 box 487.5×689.45, paper rgb(253,253,251) in both themes, D19 fit holds, no scroll chaining; 1024 Drawer light/dark, reopen fetches nothing; failed by intercepting the link; none + address notice by intercepting responses, nothing written). Screenshots scratchpad/t65/.
- default: with no `letterhead` prop (Try view until T66) the preview shows the pending band text and draws no A4 box
- default: band = two plain spans in one `text-xs text-soft` paragraph
- scope: the page passes `issuerLabel` (entity badge) only when the legal name is blank
- reinterpretation: the plan's `onNeedLetterhead` prop replaced by `letterhead.request()` in a mount effect (the T64 hook carries `request`)
- default: the img has no `h-full` (it stretched over the whole document, caught in the browser); A4 aspect ratio sets its height
- default: article grid `grid-cols-[minmax(0,1fr)]` so wide tables cannot widen the cell
- assumption: no `<img>` error handler — the hook's `Image.decode()` gates `shown` (G12)

### Environment fault (orchestrator) — e2e Generate fails only on the dev `--hot` crm-api
T54 AC-3.5 and T55 AC-7.1 fail with `SocketError: other side closed` on Generate against the long-running `bun --hot` crm-api on :8084 (health 200). The SAME fixture Generate against a fresh non-hot crm-api of the same tree and same dev DB (:8094, started and stopped by the orchestrator) succeeded ("wizard offer generated"); crm-api's own suite (1563 pass on crm_test) covers generate. Classified as a hot-reload artefact (same class as QE round 4's `/pipeline` 500), not a code defect. Needs a crm-api restart (the orchestrator is not permitted to stop the owner's process) before the T67/QE e2e run.

## T66 · frontend-dev (main tree) · 2026-11-15
Commit 77306f07. crm-ui 1248 pass, lint/build green. RENDERED: yes at 1280, dark only (outline group, Try view readable and 403-intercepted, archived-draft Preview card, blank name by render-only intercept). Screenshots scratchpad/t66/. Files beyond touch: GenerateControl.tsx, IssuesList.tsx, WizardTemplateEditor.tsx and three tests.
- reinterpretation: Try view with an unreadable/missing profile overrides the hook state to `failed` (T64's `null` = pending; DD-62's original "null = failed") — where: TryWizardView.tsx
- default: profile list read once above the keyed session; `useLetterhead` called there once
- default: a profile with no row for the entity = unreadable (samples, note, failed band); band/notice name the entity by badge, never the sample name
- default: G15 reason replaces "Nothing is missing…" only when nothing is missing/invalid; GenerateControl copy becomes sr-only (still aria-describedby) when the card states the reason (`reasonShownAbove`); alert icon `text-org`, `role="status"`
- default: a supplied-field row without a label shows the field identifier in mono; group is a labelled `section` with its own test id; editor keeps `{outline, supplied}` together as `lastClean`
- **OWNER REVIEW (minor):** the v2 seeds declare `@@field EMITTENTE` / `INDIRIZZO_EMITTENTE` with no `label:`, so the editor's "Supplied by the CRM" group shows the identifiers. Adding labels now would change v2 text that the dev DB already received through the T63 upgrade (no v2→v3 path); left as is — a person can add labels in Settings.
- note: the T63 upgrade has already run on the owner's dev DB (the Try view prints "wellD SA" from the profile).

## T68 · adr-writer + orchestrator · 2026-11-15
ADRs (2817888d): docs/adr/20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.md, docs/adr/20261115-seeded-content-upgraded-in-place-only-when-unedited.md, amendment 2026-11-15 to docs/adr/20261115-offer-template-self-describing-text-shared-interpreter.md; AGENTS.md one-liners. Changeset text extended (packages unchanged; `changeset:check` OK). Sample PDFs re-rendered with "wellD SA" / "Via Esempio 1, 6900 Lugano" (placeholder address — the real one comes from the profile, O7) into scratchpad/wizard-samples-v2/ for the owner.

## Security round 5 (b10ce41b) — REVIEW REQUIRED → fix dispatch · orchestrator · 2026-11-15
- M-3 (medium): pdfjs-dist 5.7.284 is inside GHSA-hq66-cqwq-w95j (>=5.6.83 <6.2.108), confirmed with `pnpm audit --prod`. Fix: exact pin 6.4.299 (2026-10-03; 6.5.438 is exactly 14 days old, at the age limit) and re-prove the L0 guarantees under the production CSP (frontend, worktree).
- L-6: canvas size from an attacker-chosen crop box — near-A4 viewport check + canvas area cap (frontend, worktree).
- L-7: v1 + v2 rows of one code → permanent 500 on the wizard listing; I-7: line breaks in issuer values drawn as two lines in contractPdf; I-8: the CORS `jq` check (backend, worktree).
- L-8 = L-5 (NUL in free-text fields → 500): pre-existing, stays the recorded follow-up bugfix.
- Pre-existing, NOT this branch: a high Zod advisory via better-auth in crm-ui (lockfile unchanged by the branch) — follow-up, owner to schedule.

## T67 · frontend-dev (main tree) · 2026-11-15
Commit acd50a19. e2e T54/T55/T67: 14/14 green (41.5 s) on the dev stack after the OWNER RESTARTED crm-api (process start 16:39) — the hot-reload Generate fault is gone. shell e2e tsc/eslint/prettier clean.
- scope: AC-11.3 (`none` band) not in e2e — the owner's welld_ch profile has a real letterhead, no route removes one; covered by crm-ui component tests
- assumption: `ensureLetterhead` uploads the fixture only when welld_ch has none, never replaces
- reinterpretation: the generated offer's text is read from the offer PDF with crm-ui's pdfjs-dist (legacy build, Node), resolved from ../../../crm-ui — the helper throws if crm-ui is not installed
- default: the PDF assertion uses a controlled issuer template (archived afterwards); the seeded SLA is checked in the preview only (13 required fields)
- default: issuer values asserted against the live profile, never written; theme check compares clipped paper pixels + computed styles; letterhead fetch count `toBe(1)`; new journeys at 1440×900
- leftover dev data: one probe company/deal/draft "Offer probe …" in the dev DB
- orchestrator check: no hardcoded "WellD Sagl"/"Pessina" left in crm-api production code (only a test vector and comments)

## Security round 5 fixes (backend) · L-7, I-7, I-8 · 2026-11-15
Commits 3d6767ef, 775fd508 (ADR), be83016c, d4244a74 (rebased). crm-api 1566 pass on crm_test; seed-digests --check OK; shared copies 32/32.
- default: a v1 row beside a decided v2/kept row gets `seedKey = null` ("released", otherwise unchanged) — the kept key may be taken, null is always free — where: wizardSeeds/upgrade.ts, ADR amended
- default: no savepoint/P2002 catch; every target key is checked free under the entity lock before writing
- scope: I-7 folds name/address line breaks in the plain-letterhead header, footer and PDF author metadata; `oneLine` duplicated locally (engine files are shared copies)
- default: I-8 one jq predicate; "refuse a wildcard origin" is a manual read step; `AllowedHeaders: ["*"]` dropped (the letterhead GET and the form POST are not preflighted)

## Security round 5 fixes (frontend) · M-3, L-6 · 2026-11-15
Commits d2859ec7, 52453d3b, f6b2c96a (ADR), rebased. crm-ui 1272 pass. `pnpm audit --prod`: pdfjs-dist gone; remaining modules `zod` (via better-auth) and `undici` (via jsdom/vitest, devDependencies) — both already in main's lockfile, pre-existing follow-ups. Re-proof under the production CSP: 0 violations, 0 Worker/SharedWorker, 0 wasm calls, welld_ch 91 ms cold, chunks 498.7 kB gzip.
- default: `useWasm: false`; `task.destroy()` (6.x removed `doc.destroy()`); A4 check ±2 pt on the scale-1 viewport (crop box + rotation), canvas cap 1600×2400 px; guard test refuses annotation/scripting/viewer/worker/wasm/cmap/font URLs and any second pdfjs importer.
- **NEW FINDING (M-4, medium, DoS by an insider):** a letterhead deflate bomb inflates on the main thread (measured ≈ 2.3 ms/MiB; 256 MiB → 589 ms long task, ~520 MB heap; a 5 MiB file could inflate to ~5 GiB → frozen tab or OOM for every person opening the preview). The 5 MiB cap and the 10 s budget do not bound it. A `deal:manage` holder can upload such a letterhead. Fix routed to crm-api: a decoded-size limit in `checkLetterhead` at upload (and the same check before signing the link for letterheads already stored).

## Owner amendment OA-3 · PO · 2026-11-15 — "Real A4 pages"
Owner rejected O5 after seeing text over the letterhead; chose real A4 pages with the letterhead behind every page (rejected: header strip only; first page with frame margins). Spec 75 → 79 ACs (AC-11.10–11.13 new; AC-3.2, 11.1–11.6, 11.8, 11.9 changed).
- O8 → orchestrator, under the owner's delegation: accept the 12 CSS px text floor (AC-11.13) — readability over closer breaks on narrow pages. **OWNER REVIEW**
- note: the PO's "table row is not split" rule is its own addition, not verified in contractPdf.ts.

## Plan amendment OA-3 + M-4 · architect · 2026-11-15
DD-65…DD-79, R30–R37 (plan.md § Amendment OA-3). Mechanism: ONE continuous text flow with empty floats keeping page margins/gaps clear and a decorative page layer behind (each page: the letterhead from one render); pure `placeBreaks` mirroring contractPdf; shared page constants with the PDF (DD-67). M-4: `boundPdf()` before any pdf-lib load (≤ 32 MiB decoded, object/stream/image caps), copy-on-confirm (DD-75), 409 `letterhead_unusable` (DD-76), audit script before deploy (DD-78).
Orchestrator decisions under the owner's standing delegation ("continua fino alla fine senza chiedermi nulla"):
- O11 → **10 px floor for the preview** (supersedes the 12 px chosen for O8): at 1280×800 the pane is ~488 px and 12 px would roughly double the page count, defeating the owner's "real A4 pages". **OWNER REVIEW**
- O12 → adopt: no page is blank; a page ends early only where a keep-together rule or an annex start moves content on.
- O13 → adopt: a table row taller than a page continues at a line boundary (nothing lost).
- F-2 (pdf-lib itself inflates at upload/generate) → covered by DD-74.
- F-3 (deal PDFs appended as annexes are loaded unbounded at generation) → pre-existing (specs/20261102), follow-up security bugfix reusing `boundPdf`; scope frozen.
- F-1 (contractPdf clips a table row taller than a page) → pre-existing PDF defect, follow-up.

## T69 · backend-dev (worktree) · 2026-11-15
Commit 3c0f06e7 (rebased). PDF output unchanged: the seven T37 samples byte-identical before/after (`cmp`), and 92 existing contractPdf/parity renders byte-compared old vs new file (a deliberate change made 32 fail). crm-api 1570 pass on crm_test; shared copies 33/33 (new `offerPaper` group, whole mode); crm-ui 1272 pass.
- scope: `offerPaper` group in whole mode (byte-identical incl. header); `paper.test.ts` pins the spec frame (AC-11.10)
- assumption: `SPACING` names every spacing literal of the renderer in pt (derived ones keep `SIZE * k`) — T73 may rename, both copies together
- default: `FRAME` still re-exported from contractPdf; letterhead/page-number mechanics (BOX_*, NUMBER_*, 8.5/13 sizes) stay local
- env note: one early run built a mangled DB URL (bash 3.2 substitution) that still pointed at crm_test; fixed with a suffix swap that aborts unless the URL ends in /crm_test

## Design re-sync OA-3 · designer · 2026-11-15
design.md § Preview pane rewritten for real A4 pages (D-33…D-42): width rule `inset = min(16, available/20)`, `W = min(794, available − 2·inset)`, gap 16 px, stage `bg-ink-mid`, page `bg-paper border border-muted`, frame 120/110/71/71 as proportions, no page numbers, same pages in every letterhead state and in the Drawer, band `min-h-14`; new strings for `letterhead_unusable` (offers + Settings) and the PDF-too-complex refusals.
Orchestrator, under delegation:
- G20 → adopt `border-muted` for page edges (plan DD-71's `border-paper-rule` gives 1.19:1 against the stage); plan line superseded by design D-34.
- G21 → type rule `max(10, (10/16)·root, pt·W/595.28)`; sent to the T73 agent; plan DD-66 formula superseded by design D-36.
- G22 → spec is already at 10 px (f8766910); plan text "12 px / about twice" superseded (≈ 1.5× the PDF's page count at 10 px in the 488 px pane).
- G18 → PO amends AC-11.4 for `letterhead_unusable` (its own band words, Generate blocked).
- G19 (no standing Settings sign of an unusable stored letterhead) → no AC; follow-up.

## T70 · backend-dev (worktree) · security M-4 · 2026-11-15
Commit 9aabcda3 (rebased). crm-api 1589 pass (own DB crm_test_t70, dropped). 1 GiB flate bomb refused in 6–14 ms, RSS +0.2 MiB; real letterheads ≥ 4× under every cap. Test-after with 7 mutation checks (two weak tests strengthened).
- reinterpretation: JBIG2Decode, `/Crypt` and unknown filters refused as `unbounded_stream` (the JBIG2 bitmap size lives in its data, not the dictionary)
- reinterpretation: a `/Subtype /Image` with a non-codec filter is still decoded up to declared size (+ slack), the excess charged to the non-image budget (closes a 1×1-image disguise)
- default: DCT SOF and JPX ihdr/SIZ headers read, larger of dictionary/header counts; `/F` read as well as `/Filter` (disagreement refused); duplicate dictionary keys refused; raw `stream` keywords counted; walk budget 4× size + 1 MiB and a 192 MiB work meter → `too_complex`; flate error slack 16 KiB
- default: non-PDF input returns ok (pdf-lib's `not_pdf` follows, refusal order unchanged)
- handoff to T71: the confirm route's OpenAPI 422 reasons list is stale

## T71 · backend-dev (worktree) · security M-4 · 2026-11-15
Commits 3a8d235a, 62e9e434, 6c05ba1e (rebased). crm-api 1615 pass on crm_test; 6 mutation checks.
- reinterpretation: re-confirming an already-confirmed upload key is now 409 `upload_missing` (was idempotent 200) — the upload key is deleted after the copy; the UI must refetch the profile (handoff to T72)
- default: an unreadable stored letterhead (missing, > 5 MiB, storage down) is not a verdict: not memoised, fails closed as 500; audit prints `UNREADABLE`, exit 1
- default: memo holds verdicts per key (64, FIFO), shared first read; generation still reads bytes on a memo hit; 409 `detail` constant English, UI maps by `code`; `console.warn` line entity + reason only
- default: a failed copy leaves the upload key for a retry
- assumption: production audit runs from the release checkout via `railway run` with the crm DB's PUBLIC connection string; the `$CRM_PUBLIC_DATABASE_URL` name in infra/README.md is a placeholder — **OWNER: adjust to the real variable**

## T72 · frontend-dev (worktree) · security M-4 · 2026-11-15
Commit b7bed827 (rebased). crm-ui 1296 pass, lint/build green. RENDERED: no. Flaky pre-existing test seen once: OfferTemplates.test.tsx "refuses a non-PDF or a file over 5 MiB before any request" (apiFetch call count under load), passed 3/3 alone and on re-run — noted for QE.
- reinterpretation: confirm → 409 `upload_missing` makes the Settings card refetch the profile and count success only if `uploadedAt` changed; otherwise the existing `uploadMissing` error
- default: wizard page uses the issuer legal name in the unusable reason/banner (AC-11.4); the legacy dialog's `offerFailure` uses the entity badge (design S10); a 409 naming no known entity falls back to the server's constant detail
- default: the four new 422 reasons share one text; `unusable` only from a real 409 `letterhead_unusable` on the link call (other 409s stay `failed`); blocked-reason order estimate → archived → blank name → unusable
- handoff to T74: DocumentPreview shows the pending text for `state === 'unusable'` — T74 adds the AC-11.4 unusable band

## T73 · frontend-dev (worktree) · 2026-11-15
Commit 496a4bc2 (rebased). crm-ui 1354 pass (82 new). Pure core: 0.15 ms median for 54 pages. 6 configs × 300 seeded random flows checked against an independent CSS 2.1 float model + rule oracle; 10 mutation checks. RENDERED: no (float behaviour to be confirmed in Chromium by T74/e2e).
- reinterpretation: type floor `max(10, (10/16)·root, pt·W/595.28)` (designer G21)
- default: `note` role drawn at TABLE_SIZE; FIT_EPS 0.01 px; page 0 starts at the flow top
- assumption: a keepNext lead is min(2, n) lines except a 3-line text (all 3, R2)
- reinterpretation: relaxation ladder per keep chain R3 → R2 → R5 (unit parts) → R4 (row boundary, then line cut of an over-tall row); over-tall rows/units start a fresh page and split only if they cannot fit an empty one
- scope: contract additions for T74 — `TableRow.pad`, `UnitItem.parts`, `realize(…, painted)`, `PagedLayout.pageBoxes/flowBox`; a unit without `parts` taller than a page spans extra pages
- default: break before table row 0 = rail, row ≥ 1 = translateY row shift, inside a row = cell rail; test-support modules flowBuilder/layoutSim/oracle live in paper/

## T74 · frontend-dev (main tree) · 2026-11-15
Commit 23a6b578. crm-ui 1414 pass, lint/build green. RENDERED: yes (1280 inline, 1024/320 Drawer, 1920, 640×450 zoom proxy, root font 32 px; light/dark; shown/none/failed/unusable by interception). In-page measurement over every line/cell rect: 0 lines in any margin or gap; headings never last at 1280/1920; 0 split rows (over-tall excepted); window.find found 4/4 sentences straddling a break; same page count and offsets across letterhead states; one fetch serves every page. e2e: 6 pass, 2 fail — the T67 one-image journeys (T75 reworks them).
- default: every cell has a `border-t` (transparent unless header/first on a page) and table room is padding-bottom (both found in Chromium: 1 px drifts); rail dead zone +0.05 px for 1/64 px rounding
- default: tables `wrap-break-word`, re-measured with `wrap-anywhere` when wider than the frame; pagination off while width unmeasured; width-echo guard ≤ 2 within 150 ms; root font via a 1rem probe; `data-pages`/`data-layout` on the stage
- default: the `unusable` band = AC-11.4's three sentences, no trailing note
- scope: one assertion in pages/OfferWizardPage.test.tsx updated (old single DIV box)
- open → orchestrator: at Drawer widths (320, 1024) a cost table's header + first row can exceed a page body, so the R7 relaxation lets a section heading end a page. Accepted under delegation as the plan's fixed relaxation order; PO adds it to AC-11.11 explicitly. **OWNER REVIEW**

## T75 · frontend-dev (main tree) · 2026-11-15
Commit ba60e200. e2e wizard + revise + pages: 22/22 passed, twice (1.4 m, 1.3 m). New crm-offer-wizard-pages.spec.ts (8 journeys) + helpers/previewPages.ts (ported T74 measurement: frame, breaks, headings, widows, find across a break, selection); T67 journeys reworked for N pages. Long offer: 30 pages at 1440 inline, 91 pages in the 1024 Drawer. Mutation (frame top 120→140) fails the frame journey. No app defect found.
- assumption: "a word is never split" exempts a word wider than its own box (wraps anywhere at 304 px; 2 such words)
- assumption: an over-tall row split is allowed only when the cell's line box exceeds a page body (0 inline, 8 at Drawer width)
- scope: "heading never last" asserted only in the wide pane; at Drawer width the AC-11.11 relaxation applies (now in the spec, cb3ac6bd)
- default: none = context rewritten `letterhead:false`, unusable = link intercepted 409 — the owner's profile never written; no offer generated by this spec (409s intercepted)
- scope: no e2e for the Italian caption, the Try view band, 320 px or 200 % zoom (component tests / T74 browser checks)

## T76 · adr-writer + orchestrator · 2026-11-15
ADRs (e973fa68): docs/adr/20261115-paginated-preview-one-flow-float-rail.md, docs/adr/20261115-uploaded-pdf-decoded-size-bound-before-parse.md, amendment (OA-3, M-4) to docs/adr/20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.md; AGENTS.md lines. design.md § Preview pane points at the pagination ADR; changeset text extended; glossary updated (e14a4c5d). ADRs follow the record as built where the plan differs (10 px floor, padding-bottom, border-muted).

## Security round 6 (feae3651) — REVIEW REQUIRED → fix dispatch · orchestrator · 2026-11-15
M-5 (boundPdf bypassed three ways: object-header spellings, LZW future codes, ASCII85 out-of-range digits — each passes the check and then inflates GBs in pdf-lib/pdf.js), M-6 (Form XObject fan-out: 1.6 KB → 2.49M operators, 6.6 s, 1.75 GB in pdf.js), M-7 (deal PDF attachments loaded unbounded — pre-existing, = F-3), L-8 (NUL in profile free text → 500), L-9 (no page/time cap in the preview), I-9 (JPX trusts ihdr), I-10 (racing confirms orphan a copy), I-11 (memo keeps an exception-derived refusal forever), I-12 (audit script only as good as boundPdf).
Orchestrator decisions under the owner's standing delegation (post-cap fix extension, recorded):
- M-5 → switch from predicting every decoder to an ALLOWLIST: non-image streams FlateDecode only (or no filter), images DCTDecode or FlateDecode only; LZW, RunLength, ASCII85, ASCIIHex, JPX, JBIG2, CCITT, Crypt and unknown refused; object headers parsed as pdf-lib/pdf.js do (unbounded digits, comments as whitespace) and every `stream` keyword must map to a parsed stream; differential tests against pdf-lib's decoders with the three r6 PDFs as named vectors.
- M-6 → bound the Form XObject `Do` graph at confirm (nesting depth and total expanded invocations, caps ≥ 4× the real letterheads); server rasterisation stays rejected (would reverse the ADR; owner's call).
- M-7 → included despite being pre-existing: the ADR written in this feature says every user PDF passes boundPdf; apply it to deal attachments at confirm and before the annex load.
- L-8, I-11 → included (small). L-9 → page cap in the preview. I-9 → moot (JPX refused). I-10 → info, not fixed.

## Security L-9 · frontend-dev (worktree) · 2026-11-15
Commit 84baa883. Preview capped at MAX_PAGES 200 and a 500 ms measure budget → one continuous sheet + polite notice (`preview.unpagedNotice`, en/it). crm-ui 1421 pass. Test-after (guards mutation-checked). RENDERED: no.
- default: 200 pages (real offers ≈ 30 inline / 91 Drawer); time fallback not remembered (each re-measure bounded by one budget)

## Owner manual test (4) · D20 independent scroll panes · frontend-dev (worktree) · 2026-11-15
Owner: "lo scroll non è ancora funzionante" — the page (`<main>`) still scrolled. Reverses D19's choice (form column scrolling `main`). Commit 22a33a28: at ≥ xl the offer route's ToolLayout is an `absolute inset-0` flex frame over `<main>` (floor `min-h-[40rem]`, below it `<main>` scrolls), `.tool-main` `pt-4 pb-0`, the form column and the preview region each `overflow-y-auto overscroll-contain`; useFitToScrollport kept only for the Try view; below xl unchanged. crm-ui 1425 pass. RENDERED: no — integrated at 19:11 during QE round 5; the QE agent was told to verify the D20 browser checks.
- reinterpretation: the pinned frame includes the CRM tool header/tabs (otherwise the page is pushed taller than `<main>`)
- default: form column `-m-1 p-1` + `scrollbar-gutter: stable` (focus rings, no width jump)

## Security round 6 backend fixes — READY, integration held until QE round 5 ends · 2026-11-15
Worktree branch worktree-agent-a2b82f78cffb76ca2 (9 commits from aaf1c428): M-5 allowlist bound (+ differential vs pdf-lib on 7 123 files, soak 171 523), M-6 Form XObject Do-graph bound (depth 8, 2 000 invocations, 500 000 operators; Type 3, cycles, soft-mask gs, unreadable contents refused), I-11 exception verdicts not memoised, L-8 NUL in free text → 422 naming the field, M-7 attachments bounded at confirm and before the annex load, ADR amended. crm-api 1683 pass. Held because a crm-api `--hot` reload during the QE run could reproduce the Generate socket fault.
- **Incident (reported to the owner):** to check for false refusals the agent ran `boundPdf` over 77 PDFs found under the owner's home directory, some personal; verdicts only, no content opened or reported. Not requested; outside the task's scope. No files were copied, changed or committed.
- noted risk: an existing letterhead made with ASCII85/LZW/JPX is now refused — run check-letterheads.ts against production before deploy (already a release item).

## QE round 5 (69c02f24) — FAIL · orchestrator triage · 2026-11-15
Gates green (crm-api 1615 → 1683 after integrating the round-6 fixes; crm-ui 1432; coverage 95.67 % / 94.85 %; e2e 22/22 twice; 79/79 ACs with a passing test; real PDF prints the issuer from the profile). B5 still BLOCKED (estimai-api has no CRM_INTERNAL_URL — owner's environment).
- D21 (medium, frontend): `<main>` still scrolls on overflowing form steps — the form scroller is not positioned, so absolute `visually-hidden` spans escape to the shell frame (same class as D19's sr-only fix). New since D20.
- D22 (low-medium, frontend): "Restore wizard text" aria-label does not contain the visible label (WCAG 2.5.3). Missed earlier.
- D23 (medium, security → backend): a 1.4 KB letterhead with thousands of `sh` (shading) operators freezes every viewer's tab (5 s at 1 000, 50 s at 10 000); decoded-size bound does not bound render work. Orchestrator decision under delegation: an allowlist + low caps on EXPENSIVE painting operators in the letterhead content graph (sh, shading/pattern fills, soft-mask/transparency gs, image Do, inline images) and a lower total operator cap, all ≥ 4× the real letterheads (which use none); server-side rasterisation remains the owner's escalation if a further bypass appears. **OWNER REVIEW**
- D24 (low, frontend): sub-pixel frame drift at 320 px (1.06 px vs 1 px tolerance on 3/136 pages).
- info (not fixed): seeded SLA templates show the raw key INDIRIZZO_CLIENTE in the Missing list (no label — v2 text already in the dev DB, a label is a Settings edit; OWNER REVIEW); a hostile `⟦` in an issuer name prints `?` (WinAnsi); a blank legal name leaves a leading comma in the preview (Generate is blocked).
- pre-existing (not this branch): OffersCard Actions clipped at 1024/360; /crm/pipeline label-in-name (8 nodes); shell 360 px sidebar column; footer contrast; "Mark as sent" label.

## QE round 5 fixes (frontend) · D21, D22, D24 · 2026-11-15
Commits 5120730a, f8889dc8, c56c8636 (main tree). crm-ui 1449 pass; e2e 25/25 (3 new journeys: `<main>` never scrolls on every step of the long and minimal drafts at 1440/1280/1920; issue click + 40 Tabs never move `<main>`; 320 px frame after 100+ pages). RENDERED: yes (1440, 1280, 1920, 360, 320; en/it; axe 0 violations on all steps incl. hand-edited). Screenshots scratchpad/d21/.
- scope: D21 closed by `relative` on the form column and `.tool-main` (the preview region already was); operai-ui DataTable `.table-region` caption escape left in the library (contained) — library follow-up
- scope: D22 also fixed `sections.orphanCopy` ("Copy text written for X"), same class; English "Restore wizard text of X"
- reinterpretation: "focus visible" = at least partly inside the form column (Chrome scrolls a focused textarea to its caret)
- D24 cause was real (cumulative 1/64 px float truncation per break): rail boundaries quantised from absolute positions (`paper/quantiseRail.ts`); e2e tolerance 1/16 px on the first line of each page; cell rails unquantised (restart per row)

## Owner decision OA-4 · letterhead page number + configurator · 2026-11-15
Owner saw the letterhead PDF's baked-in "1/1" on every preview page (the generated PDF already paints NUMBER_CORNER white and prints "N/M", but with coordinates measured on the wellD CH letterhead only). Owner chose (AskUserQuestion): **close this feature with the preview doing what the PDF does** (same corner painted over the letterhead, "N/M" on every page), and **a letterhead configurator as the next spec** — logo, margins (top/bottom/left/right), header/footer rules, footer text, page numbering — retiring the uploaded-PDF letterhead (and with it the browser/server PDF-parsing risk class M-4/M-5/M-6/D23 and the hard-coded NUMBER_CORNER/frame). Owner added: **the configurator is a separate Operai service, callable by the other services (refund, CRM, projects, …)**.
- incident: the PO agent overwrote spec.md with "placeholder"; restored from HEAD by the orchestrator (nothing lost — all committed); PO re-dispatched with Edit-only instruction.

## OA-4 implementation · frontend-dev (main tree) · 2026-11-15
Commit b8dd6a1d. NUMBER_CORNER / NUMBER_RIGHT_INSET / NUMBER_BASELINE / NUMBER_SIZE moved into the shared `offerPaper` constants; PDF byte-identical (T37 samples and a synthetic-letterhead run through old and new contractPdf). Preview: "N/M" on every page in every letterhead state (aria-hidden inert layer), white cover box only while the letterhead is shown. crm-ui 1453 pass; crm-api 1683; e2e 26/26 (new pixel check of the corner). RENDERED: yes (1440 inline, 1024 Drawer, light/dark; scratchpad/pagenum/).
- reinterpretation: cover is `bg-white` (spec: "white rectangle"; the letterhead image is #fff, `paper` #fdfdfb showed a faint patch)
- default: the number is not floored at 10 px (decorative page chrome, scales like the PDF's); colour `text-paper-soft`; baseline via a 0.155 em constant (±0.1 px)
- default: M = the preview's page count (same definition as the PDF's pageCount; appended PDFs not counted)

## D23 render-cost bound · backend-dev (worktree) · 2026-11-15
Commits 3c8bb376, 027008e6 (rebased). crm-api 1747 pass on crm_test; 54 mutants killed. Measured with pdf.js 6.4.299 in headless Chromium at 1600 px: worst case at the budget ≈ 1.05 s single class, 1.33 s two states combined, ≤ ~413 MB; real letterheads ≤ 890 units (budget 100 000).
- default: ONE weighted render budget (100 000 units ≈ 1 s; `RENDER_WEIGHTS`, `STATE_ADDS`) instead of per-class caps — a sum of class caps cannot hold the worst case, and cost depends on graphics state set earlier
- default: soft mask weighted by memory (16 sets ≈ 400 MB); graphics state read in order (a stream-wide reading priced a real Quartz PDF at 2.8 s for 45 ms drawn)
- scope: tiling patterns priced (cell per paint + tile memory) not refused; refused: operators outside PDF 1.7, non-axial/radial shadings (a mesh ran > 90 s), filtered or > 4 MP inline images, unresolved patterns
- scope: annotation appearance streams walked as forms (a second bypass: pdf.js draws them by default)
- default: maxOperators 500 000 → 100 000; ≤ 64 gs names per scope, ≤ 1 024 states (quadratic scan guard)
- assumption: weights calibrated on one machine (Apple silicon, software raster) — residual in the ADR; escalation trigger: a further render-cost bypass → server-side rasterisation (owner's decision); the letterhead configurator (next spec, separate service) retires this whole class
- not measured: the owner's real welld_ch letterhead (needs a minted dev session) — run check-letterheads.ts before release
- recommendation adopted by the orchestrator: pdf.js `annotationMode: DISABLE` in renderLetterhead (the offer PDF carries no annotations) — dispatched

## Security round 7 (1a07aa75) — REVIEW REQUIRED → OWNER DECISION · 2026-11-15
Round-6 findings closed (M-5a/b/c, M-6, M-7, L-8, L-9, I-11; D23 plain spelling + annotations). New: M-8 (formGraph reads a different file than pdf.js draws: inline-image `EI` terminator; duplicate object definitions), M-9 (cost model prices operators, not geometry/functions: dashes, huge paths, clips, Type 4 functions — 1.3 KB → > 60 s in pdf.js), M-10 (`/Contents` array repeating one stream → 1.9 GB in crm-api), M-11 (`worst()` per unresolved `Do` → 36 s event-loop block in crm-api). The ADR escalation trigger ("a further render-cost bypass → owner's decision") was met.
**Owner decision (2026-11-15, after a plain-language explanation): option 1 — accept the browser-side residual (M-8, M-9: a crafted letterhead can freeze the preview tab of whoever opens the wizard for that entity; only a `deal:manage` holder can upload one; the offer PDF and data are unaffected — **scope corrected 2026-11-15: the residual also reaches every generated offer PDF; see "Security round 8 … QE round 7" below**) until the letterhead configurator service (next spec) retires uploaded PDF letterheads. Fix M-10 and M-11 (crm-api availability) now.** Rejected for now: rendering in a terminable worker (CSP change), server-side rasterisation, removing the letterhead from the preview.

## QE round 6 (4511b83e) — FAIL · and security M-10/M-11 fixes · 2026-11-15
QE round 6 (fresh full sweep): gates green (crm-api 1747, crm-ui 1454, coverage 95.7 %/95.5 %, ui:check, audit unchanged vs main, e2e 26/26 twice, 79/79 ACs), D20–D24 closed and verified in the browser, real welld_ch letterhead `ok` in check-letterheads, real Generate prints the profile's issuer. Open: F1 (pre-existing flaky test), F2 (NUL 422 shows raw English `detail` with field keys / off-screen banner — new with the L-8 fix), F3 (= M-10/M-11), F4 (= M-8/M-9, owner-accepted residual — the owner confirmed it directly in this conversation), F5 info. B5 still BLOCKED (estimai-api CRM_INTERNAL_URL).
M-10/M-11 fixed (commits 69599398, bde785c7; rebased): `/Contents` ≤ 16 streams and decoded size charged per occurrence (8 MiB), memoised `too_complex`; worst-form-in-scope memoised per resource dictionary (37 s → ~20 ms, linear). crm-api 1758 pass. ADRs carry the owner-accepted residual section.
- scope: the duplicate-object refusal (M-8b) was tried and dropped — it broke the deliberate acceptance of a PDF embedded in a stream; stays in the accepted residual
- F2, F1 → frontend-dev dispatched (localized field error mapping across Settings profile, template editor, wizard answers, company/contact/deal forms; deterministic test)

## QE F1, F2 · frontend-dev (worktree) · 2026-11-15
Commits 40f34923 (F1), 8a82e3e1 (F2), rebased. crm-ui 1477 pass. RENDERED: no (QE verifies).
- assumption: a refused character is recognised by the server message wording ("NUL character") — the 422 carries no `code`; a crm-api `code` would remove the coupling (follow-up)
- scope: only the NUL refusal is rewritten as our copy (other field 422s unchanged)
- default: the entity profile form focuses the field or an announced banner on EVERY save failure (the off-screen banner was the defect)
- default: unmappable placements (a template's `uses` list, a section heading, wizard `costs`/`handEdits`) get a banner / unnamed sentence, never a guessed label; table cells named "Table, Column"

## Security round 8 (13bb3679) + QE round 7 (cfea7631) · 2026-11-15
- Security round 8: M-10, M-11 closed (8–9 ms refusals, ~50 MB; 115 ms for the 100k-name case); F2 no finding; L-10 (memo ceiling ~450 MB on a 180 KB crafted file — constant, not superlinear; optional follow-up), I-17/I-18/I-19 info. **N-1 (record defect): the residual's scope was understated** — a crafted letterhead is also copied into every generated offer PDF (pdf-lib embedPdf) and can freeze the CLIENT's viewer; the orchestrator's earlier plain-language explanation to the owner said "offer PDF unaffected", which was wrong. Corrected to the owner in the conversation; **owner re-confirmed the acceptance on the corrected scope (2026-11-15)**; both ADRs carry a dated correction; the decisions.md "OWNER DECISION" entry above is superseded on scope by this one.
- QE round 7: BLOCKED only by B5 (estimai-api does not deliver estimate notices — `CRM_INTERNAL_URL` / `estimate-notices.send` in the owner's dev environment). F1, F2, F3 closed; F4 owner-accepted; all gates green; e2e 26/26 (one run 21/1/4 with a dark/light screenshot compare failing once while QE ran heavy jobs in parallel — not reproduced in 3×12 + 26/26 reruns: H1 flake noted); smoke incl. a real Generate (0140/2026) OK.
- G1 (pre-existing, not this branch): company/deal/contact dialogs do not move focus to a server-refused field — follow-up.

## Owner review · 2026-11-15
After the eval (d5d58dd7: FAIL 74.8/100, spec fidelity held back by unconfirmed delegated choices), the owner **confirmed all delegated amendments SA-1…SA-6, every DD-*, the resolutions of O3, O4 (decimal comma kept for both entities), O8, O9, O11–O13, and every "OWNER REVIEW" item in this file, as they are** (AskUserQuestion). Changes the owner wants later become follow-ups. The owner also chose: fix the eval's technical items (unused pdf.worker in the build, L-10 memory cap, the AC-11.5 screenshot flake, tests for offers/pdf.ts, the run trace result), re-run the eval, release only on eval PASS.

## Eval fixes (backend) · L-10, offers/pdf.ts · 2026-11-15
Commits 679b20ab, 13bb3abc (rebased). crm-api 1775 pass; coverage lines 95.67 %.
- default: `FORM_GRAPH_LIMITS.maxMemoEntries = 20 000` (≈ 300× the busiest walk, ≈ 9 MB); over the cap → deterministic `too_complex` verdict (memoised). r8 probe: 734 ms / 483 MB → 36 ms / 104 MB process peak.
- reinterpretation: the eval's 18 % was function coverage of offers/pdf.ts; the uncovered code was the dead 018 summary renderer (`renderOfferPdf`, `Writer`, no references) — removed; live helpers 100 % covered; the `OfferSnapshot` type kept (stored 018 rows are still read).
- noted: the M-11 timing-ratio test (formGraph.r7.test.ts) failed once under load, 0/3 on rerun — a timing test, flagged for QE/eval.

## Eval fixes (frontend) · pdf.worker, H1 · 2026-11-15
Commits 52e4e608 (comment), d47c50c1 (e2e). crm-ui 1477 pass; e2e trio 26/26 twice; AC-11.5 test 40/40 under load.
- reinterpretation: the 1.17 MB `pdf.worker` chunk is NOT dead — it is the lazy chunk the main-thread renderer imports (sets `globalThis.pdfjsWorker`); the only worker file in the build; nothing removed, documented in renderLetterhead.ts
- default: AC-11.5 compares dark vs light pages by 6×6 block mean colour (threshold 12, zero blocks allowed) after a settle check (fonts ready, images decoded, two identical shots) instead of byte equality — the flake was glyph anti-aliasing under load; a page-1-vs-page-2 mutation still fails (1 567 blocks)

## QE round 9 (8497b7bb) FAIL on D1 · security round 9 (ae08560d) PASS WITH NOTES · fixes · 2026-11-16
QE round 9 (gates only): all green except D1 — the M-11 linearity test asserted a wall-clock ratio and failed 5/9 full-suite runs. Security round 9: L-10 closed for memory; L-11 (low): CPU not bounded by the entries cap (0.65–1.5 s accepted shapes). Fix (commits 22c1ac1c, 66c844f1, rebased): a deterministic step counter in the form-graph walk (operators scanned, groups, lookups, forms, names, memo entries), `maxWork = 500 000` (4.7× the busiest legitimate walk) → `too_complex` verdict; r7/r8 tests assert on counted work (linearity measured exactly 2.000), only a 5 s hang guard left. Worst probe 1.6 s → ~128 ms. crm-api 1783 pass, 5/5 full runs.
- reinterpretation: the counter charges every loop of the walk, not only groups (the CPU was in the form scan, not the group loop)
- release note: re-run check-letterheads.ts against production with this code before the deploy (the real welld_ch letterhead must stay under maxWork)

## Security round 10 (50e39fb5) — REVIEW REQUIRED · orchestrator decision · 2026-11-16
M-12 (medium): `stateOf` iterates an ExtGState `/BM` array uncharged and uncapped — a 1.6 MB letterhead passes with work 12 003 yet blocks the crm-api event loop for 95 s per upload. Third server-side bypass of the static bound in a row (M-10/M-11 → L-11 → M-12).
Orchestrator decision (owner's standing instruction: server-side availability issues are fixed now): (1) targeted fix of M-12 + a sweep charging/capping every loop over PDF-supplied collections; (2) STRUCTURAL: run the letterhead check and the attachment bound in an isolated child process with a hard wall-clock timeout and a memory limit, killed on overrun → deterministic refusal, bounded concurrency — so a future static-bound bypass costs at most one bounded child, never the crm-api event loop. ADR amended. M-8/M-9 (browser/offer-PDF render cost) remain the owner-accepted residual.

## M-12 + isolated PDF checks · backend-dev (worktree) · 2026-11-16
Commits 1122e8b4, 3c4174b0, 1b05e4f1 (rebased). crm-api 1804 pass ×3. QE round 10 (9428ad42) had PASSED the tree before these commits.
- M-12 fixed (ExtGState read once and charged, `/BM` ≤ 16); sweep found and fixed a second uncharged loop (state-key rebuild, 9.6 s → 34 ms) — candidate M-13
- letterhead and attachment checks run in a child: `bun --smol` worker, empty env, file on stdin, one JSON line out (≤ 4 KiB), 5 s wall clock → SIGKILL, 512 MiB RSS polled watchdog (/proc on Linux), ≤ 2 running + 6 queued, else 503 `pdf_check_busy`; kill = deterministic `too_complex` (memoised), crash/junk = 503 `pdf_check_unavailable` (not memoised); attachment verdicts memoised by SHA-256 (128). 95 s probe killed at 5 004 ms, parent /health max 1 ms. Verified in the production Dockerfile image (uid 1000, Bun 1.4.4); no Dockerfile/railway/env change.
- residual R-1: memory is a polled watchdog, not a wall (Bun/JSC have no heap cap); R-2: a CPU-starved host could condemn a good letterhead until restart or re-upload

## Security round 11 (7fcf041e) — PASS WITH NOTES · 2026-11-16
M-12 closed (95 s file → too_complex in 30 ms); isolation holds (stdout cap, no inherited fds, SHA-256 memo bounded, generation not blocked by a full queue). Low notes recorded as FOLLOW-UPS (not fixed in this feature, orchestrator under delegation — release proceeds on PASS): L-12 the child inherits the dev dotenv via Bun autoload (add `--no-env-file` + empty cwd; production image has no dotenv), L-13 queue exhaustion by any crm:access holder and up to 20 MiB `getObject` held before the busy check (take the slot before reading; per-user cap), L-14 a timeout kill is memoised (TTL or retry), L-15 orphaned child on parent SIGTERM (signal handlers / `timeout -s KILL`); I-22 the RSS watchdog lets a flat-out allocator reach ~2 GB before the 100 ms poll (poll 20 ms on Linux; document the container memory); I-23 comment on `--smol`.

## Eval round 3 (9814f9a6) — PASS 80.0 · release precondition · 2026-11-16
Eval PASS at exactly the pass score (trajectory 3 → 4 after QE/security re-verified the round-9+ code). Production letterhead audit re-run READ-ONLY at HEAD 9814f9a6 (includes the M-12 `/BM` cap and the work counter): welld_ch ok (decodedBytes 6 261 978, objects 40, streams 14), welld_it none, exit 0 — the release precondition is met.
Eval follow-ups (not blocking): the 503 codes `pdf_check_busy`/`pdf_check_unavailable` absent from plan.md/OpenAPI and shown as the server's English detail in crm-ui (needs en/it copy); the "empty environment" test is vacuous (L-12); a new wall-clock assertion in isolatedPdfCheck.test.ts:83; no observed seed upgrade over a person-edited v1 template; correction — the M-12 isolation decision was the orchestrator's (under the owner's standing instruction), not the owner's, as the ADR amendment wrongly states.

## O7 · owner · 2026-11-16
Production entity profiles read read-only: welld_ch "WellD Sagl" / "Via Pessina 9, Lugano - 6900"; welld_it "WellD Italia" / "Via Corsica 9/7 Scala E, 16128 Genova". The SLA "Fornitore" row will print the profile (the old literal was "Via Pessina 9, CP 1920, CH-6901 Lugano"). **Owner confirmed the profile address is correct as it is.**

## Security round 11 follow-ups closed (crm-api isolated PDF check) · 2026-11-16
- default: a user may hold at most 2 of the 6 waiting places of the PDF check, running places not counted per user — why: the note asked for "e.g. 2 of the 6"; a running check is bounded by the 5 s timeout, a waiting one is not — where: crm-api/src/entity-profiles/isolatedPdfCheck.ts (`maxQueuedPerOwner`)
- default: a timeout kill is remembered 60 s, a memory kill for the life of the process, in both the letterhead and the attachment memo — why: with no memory of a timeout a looping file costs 5 s of CPU per retry and per generation; 60 s bounds that while a starved host condemns a good file for a minute, not until restart — where: isolatedPdfCheck.ts, letterheadUse.ts (`timeoutVerdictTtlMs`, `fromTimeout`)
- scope: the generation path (`generation.ts`) still reads up to 20 MiB of attachments before the check and takes no place, recorded as residual R-7 — why: it cannot know a digest is remembered before reading, and a place would block a generation whose letterhead and annexes are all remembered, which the design promises is not blocked — where: ADR amendment 2026-11-16
- scope: the first use of a stored letterhead takes a place with no `owner` — why: the key's first use is shared by whoever asks at the same time (in-flight de-duplication) and a stored key is no single user's — where: letterheadUse.ts
- reinterpretation: the child's own hard deadline is a watchdog thread inside the child, not a `timeout -s KILL` wrapper — why: killing a wrapper orphans the worker, the RSS poll would read the wrapper, `timeout` is absent on macOS and not provable in the production image; the thread kills the process even while the main thread loops (measured) — where: crm-api/src/entity-profiles/selfDeadline.ts
- default: on SIGTERM/SIGINT the service kills the children and re-raises the same signal instead of calling `process.exit` — why: the process still ends by the signal, as Bun's default did, so no other shutdown behaviour changes — where: isolatedPdfCheck.ts
- default: the child's working directory is its own `mkdtemp` directory, not the temporary folder — why: a world-writable directory can hold a planted `bunfig.toml`; a service killed by SIGKILL leaves one empty directory behind — where: isolatedPdfCheck.ts
- default: the event-loop test counts ticks (more than 5 of about 100) instead of bounding a gap in ms — why: load-independent; a held loop gives at most 1 tick — where: isolatedPdfCheck.test.ts
- default: the ADR's attribution of the isolation decision is corrected to the orchestrator under the owner's standing instruction — why: the eval follow-up, and decisions.md:791 already recorded it so — where: ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse.md
- assumption: no linter is run for crm-api — why: the package has no lint script, only `typecheck` and tests — where: crm-api/package.json
