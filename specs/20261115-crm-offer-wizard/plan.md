---
spec: 20261115
status: approved
approved: 2026-11-15
approved_by: delegated — the owner (Matteo Codogno) delegated the plan gate for an unattended run; to be reviewed
amended_owner: "2026-11-15 — owner amendment OA-1/OA-2 (US-11, US-12; changed AC-3.2, AC-8.5, AC-9.6); approved_by: delegated — the owner approved the spec amendment and delegated this plan gate; DD-53…DD-64 to be reviewed"
amended_owner_oa3: "2026-11-15 — owner amendment OA-3 (real A4 pages: AC-3.2, AC-11.1…11.6, 11.8, 11.9 changed; AC-11.10…11.13 added) and security round 5 M-4 (a letterhead's decoded size bounded in crm-api); approved_by: delegated — the owner delegated this plan gate; DD-65…DD-79 to be reviewed"
---

# Plan: CRM offer wizard — a guided offer built from the template

> The owner approved the spec with O1 and O2 open and delegated the plan gate. Every choice
> made on the owner's behalf is listed in **§ Delegated decisions** (DD-n) with its
> alternatives. Four of them stretch an approved AC; they are collected in **§ Proposed
> spec amendments** and must be confirmed (or refused) before `/wellforge:tasks`.
>
> Amended after the design (2026-11-15, delegated): DD-27…DD-38 close the contract gaps the
> designer found (design.md § Spec/plan coverage and findings, G1–G9) and fold in the
> cost-table rules of `decisions.md`; DD-39 refuses a percentage discount in a table with two
> or more total rows. See **§ Amendments**.
>
> Amended after the engine (2026-11-15, delegated): DD-40…DD-51 record what T2–T12 (the shared
> engine) and T18–T23 (the seven converted texts) actually built where it differs from this plan
> — the engine's exports are now the contract the later tasks consume. The engine is frozen once
> T13 mirrors it: any later change is drift (DD-51).
>
> Amended for R16 (2026-11-15, delegated, decisions.md "Orchestrator · R16"): DD-52 adds the
> reference token "⟪REF⟫" to hand-edited text, filled at generation; built by T12b before T13
> mirrors the engine.
>
> Amended for the owner's spec amendment (2026-11-15, **approved_by: delegated**): US-11 (the
> entity's letterhead behind the HTML preview) and US-12 (the issuer's legal name and address from
> the entity profile), DD-53…DD-64. The design is in **§ Amendment (2026-11-15, owner)** at the end;
> the sections below are updated in place where it changes them. It is an authorised engine change
> after T13 (DD-51 procedure: both copies, one commit, vectors).
>
> Amended for the owner's OA-3 (2026-11-15, **approved_by: delegated**): the preview becomes real A4
> pages — one continuous flow of real text, the page gaps kept free by a rail of floats, the letterhead
> behind every page — and security M-4 bounds a letterhead's decoded size in crm-api before any parser
> runs, DD-65…DD-79. The design is in **§ Amendment OA-3** at the end; DD-55 is superseded, DD-56
> amended, and the sections below are updated in place where it changes them.

## Architecture

### Shape in one paragraph

A wizard template is **one self-describing text** (`offer_template.source`): the offer
markup of specs/20261102-crm-offer-document AC-1.6, extended with the mockup's field and
condition syntax and with explicit declarations (`@@field`, `@@block`, …) that carry labels,
hints, kinds, defaults and steps. One **pure TypeScript engine** parses that text, derives
what the wizard asks, and resolves a template + answers + deal context into a
**`ResolvedOffer`**: plain 018 markup per section plus a computed cost table. The engine
exists as **byte-identical copies** in crm-api and crm-ui, policed by
`scripts/check-shared-copies.ts`. The browser resolves on every change and renders the
preview from the `ResolvedOffer`; crm-api resolves the **stored draft** with the same code at
generation and hands the same structure to the existing contract renderer. The wizard's
work in progress is an **`offer_draft` row per deal**, autosaved with If-Match, and removed
in the generation transaction.

```
                 crm-ui (remote)                                    crm-api
┌───────────────────────────────────────────┐        ┌───────────────────────────────────────────┐
│ OfferWizardPage                            │        │ offer-drafts router (new)                 │
│  ├─ useOfferDraft (autosave, If-Match) ────┼─PUT───▶│  offer_draft (1 per deal, version CAS)    │
│  ├─ step forms ◀── outline(ast)            │        │  POST …/generate:                         │
│  └─ DocumentPreview ◀── resolveOffer(…)    │        │    load draft → resolveOffer(…) ──┐       │
│        ▲                                   │        │    computeCosts → snapshot        │       │
│  lib/offerEngine/  ══ byte-identical ══════╪════════╪══ src/offers/engine/              │       │
│  (markup, syntax, outline, resolve,        │        │                                   ▼       │
│   costs, compute, answers, format)         │        │  contractPdf.ts (018 renderer, extended)  │
│ TemplateEditorPage (wizard format)         │        │  offer-templates router (extended):       │
│  ├─ parse → problems, outline (AC-8.2/8.3) │        │    wizard CRUD, supersession, seeds       │
│  └─ preview overlay, sampleAnswers (8.5)   │        │                                           │
└───────────────────────────────────────────┘        └───────────────────────────────────────────┘
```

### Components touched / added

| Where | What | Kind |
|---|---|---|
| `crm-api/src/offers/engine/` (new, shared) | `markup.ts` (moved from `src/offers/`, extended), `syntax.ts`, `outline.ts`, `resolve.ts`, `edit.ts` (DD-30), `costs.ts`, `compute.ts`, `answers.ts`, `format.ts`, `numbering.ts` + `words.ts` (DD-29), `printable.ts`, `vectors/*.json` | pure, no I/O, no deps |
| `crm-ui/src/lib/offerEngine/` (new) | byte-identical copies of the above | pure |
| `scripts/check-shared-copies.ts` | one group per engine file (`offerEngine.markup`, `offerEngine.syntax`, …); `.github/workflows/shared-copies.yml` path filter gains `crm-api/src/offers/engine/**` and `crm-ui/src/lib/offerEngine/**` (finding: the filter today lists only the serviceToken copies, so most groups are not checked on PRs that touch only them) | tooling |
| `crm-api/src/offer-drafts/offerDrafts.routes.ts` (new) | draft CRUD, template switch, generate, wizard context | API |
| `crm-api/src/offer-templates/offerTemplates.routes.ts` | wizard format, `formats` filter, supersession, last-template guard, wizard seed | API |
| `crm-api/src/offer-templates/wizardSeeds/` (new) | `welldChIt.<code>.ts` — one converted mockup text per file (`T1`, `T2`, `T3`, `T4`, `T5`, `T6`, `T1T3`; built by T19–T23); `welldChIt.ts` — the catalog (name, description, uses, `seedKey`, the mockup→seed renames of DD-48; T24); `golden/` — the T18 fidelity fixtures (DD-49) | data in code (018 lazy-seed posture) |
| `crm-api/src/offers/offers.routes.ts` | legacy routes refuse wizard templates/offers; generation core (`prepareOffer`, numbering, storage) extracted to `offers/generation.ts` so the legacy body and the draft share it; `OfferSchema` gains `origin` | refactor + API |
| `crm-api/src/offers/contractPdf.ts` | text annexes, total rows and `option` lines (DD-13), optional cost column labels, the □ glyph, a test-only draw log; formatting moves to `engine/format.ts`; section/sub-heading numbers, annex letters, cost positions and the fixed document words are **read from the engine** (`numbering.ts`, `words.ts`, `costs.ts` rows — DD-29) for legacy and wizard snapshots alike, never computed here | renderer |
| `crm-api/src/offers/contract.ts` | `ContractSnapshot` gains optional `wizard`, `textAnnexes`, `costs.rows`, `costs.labels`; legacy snapshots unchanged | types |
| `crm-api/src/offers/draft.ts` | rename the legacy prefill type `OfferDraft` → `OfferPrefill` (glossary: "Offer draft" now names the stored draft) | rename |
| `crm-api/prisma` | one migration (§ Data model) | schema |
| `crm-ui/src/pages/OfferWizardPage.tsx` + `components/offerWizard/*` (new) | the wizard, route `/crm/deals/$id/offer` | UI |
| `crm-ui/src/components/OffersCard.tsx` | draft row (AC-6.4), entry points into the wizard / legacy dialog (AC-7.3) | UI |
| `crm-ui/src/components/TemplatesCard.tsx`, `pages/TemplateEditorPage.tsx` | format badge, wizard editor (text, outline, problems, preview overlay); the legacy editor stays for legacy rows | UI |
| `crm-ui/src/components/GenerateOfferDialog.tsx` | unchanged behaviour; reached only for legacy templates (DD-9, DD-11) | UI |
| `crm-ui/src/strings.ts` | every new string, `en` + `it` | copy |
| `shell/e2e/crm-offer-wizard.spec.ts` (new) | journeys | e2e |
| `crm-ui/src/lib/letterhead/renderLetterhead.ts` (new, owner amendment) | the ONLY importer of `pdfjs-dist` (lazy): page 1 of the letterhead → PNG `Blob`, main thread, no Worker (DD-53) | UI lib |
| `crm-ui/src/components/offerWizard/useLetterhead.ts` (new, owner amendment) | one attempt per opening: link → bytes → render, 10 s budget, `pending`/`shown`/`none`/`failed` (DD-54) | UI hook |
| `crm-ui/src/lib/crmApi.ts` | `getLetterheadDownload(entity, init)` takes a signal; `fetchLetterheadBytes(url, signal)` beside `postToBucket` (DD-54) | UI lib |
| `crm-ui/src/components/offerWizard/DocumentPreview.tsx`, `OfferWizard.tsx`, `pages/OfferWizardPage.tsx`, `templateEditor/TryWizardView.tsx`, `templateEditor/OutlineView.tsx` | A4 pages with the letterhead behind each (DD-65…DD-72, OA-3; DD-55 superseded) + bands above the region (DD-56, DD-72), address notice (DD-58), blank-name reason (DD-61), Try view profile (DD-62), "supplied by the CRM" in the outline (DD-58) | UI |
| `crm-api/src/offer-drafts/context.ts`, `offerDrafts.routes.ts`, `offers/generation.ts` | context gains `issuerAddressLines`, `letterhead`; draft generate refuses a blank legal name (DD-61) | API |
| `crm-api/src/entity-profiles/entityProfiles.routes.ts` | the letterhead link answers `Cache-Control: no-store` (DD-54) | API |
| `crm-api/src/offer-templates/wizardSeeds/` | v2 texts bind the issuer (DD-59); `upgrade.ts` (new): the one-time in-place upgrade of unedited v1 rows (DD-60) | data in code |
| `crm-ui/src/components/offerWizard/paper/` (new, OA-3) | `geometry.ts`, `placement.ts`, `realize.ts` (pure), `collectFlowItems.ts`, `usePagination.ts`, `PaperTypeContext` — the preview's A4 pages (DD-65…DD-70) | UI lib |
| `crm-api/src/offers/paper.ts` + `crm-ui/src/lib/offerPaper/paper.ts` (new, OA-3, shared copy `offerPaper`) | page size, frame, type sizes, line height, spacing points; `contractPdf.ts` imports them instead of literals (DD-67) | constants |
| `crm-api/src/entity-profiles/pdfBounds.ts`, `letterheadUse.ts` (new, security M-4) | decoded-size bound before any parse; copy on confirm; a stored letterhead checked before use, 409 `letterhead_unusable` (DD-74…DD-76) | API |
| `crm-api/scripts/check-letterheads.ts` (new, security M-4) | read-only release audit of the stored letterheads (DD-78) | tooling |

No `auth` change (same `deal:manage` / `deal:financials` gates), no new env variable, no new
cross-service call, no new bucket. The owner amendment adds one browser dependency (`pdfjs-dist`,
crm-ui only, lazy, DD-53), no server dependency, no migration and no CSP change. OA-3 and M-4 add no dependency, no migration, no CSP change and no
env variable; crm-api newly reads a stored letterhead's bytes to check it before signing its link (a new reason for ADR
20261102's bounded read, ADR candidate 13). No `groma/` map exists in the repo, so no component ids
are cited.

### ADRs this plan keeps

- **20261101-crm-financial-visibility-permission** — every draft, template and context route
  requires `deal:financials`; a non-holder learns nothing about drafts (AC-6.2).
- **20261101-crm-tool-shape-and-authorization** — writes outside the caller's entity are
  `403 out_of_scope`, checked **before** any draft lookup so the answer is the same whether a
  draft exists or not.
- **20260807-optimistic-concurrency-version-if-match-cas-amends-0004** — the draft and the
  templates use integer `version` + `If-Match` (428 absent, 409 stale); creation uses
  `If-None-Match: *`.
- **20260720-mileage-rate-money-precision-integer-micros** posture — money is integer cents
  end to end, BigInt intermediates, one round-half-up, in the shared `engine/costs.ts`.
- **20260607-jwt-in-memory-never-web-storage** extended to business data by AC-6.7 — the
  draft never touches `localStorage`/`sessionStorage`/IndexedDB.
- **20260716-eu-object-storage-refund-attachments** — the preview's letterhead is read by the
  BROWSER through the existing 60 s presigned GET; crm-api never proxies it (owner amendment, DD-54).
- **20261102-crm-api-reads-attachment-bytes-for-offer-annexes** — unchanged bounded read of
  the chosen deal PDFs and the letterhead.
- **20261031-shared-ui-library-consumed-as-source / 20261114-…-singleton** — every control is an
  `@operai/ui` component; the wizard stepper and the document preview stay in crm-ui (one
  consumer, 018 D-63 rule) and move to the library only when a second app needs them.
- **20260714-invitation-lifecycle-derived-expiry-state** posture — seeding is lazy and
  idempotent on read; no migration data, no cron.

New decisions that constrain future work are ADR candidates (§ ADR candidates):
`docs/adr/20261115-offer-template-self-describing-text-shared-interpreter.md`,
`docs/adr/20261115-offer-draft-server-held-generated-from-stored-state.md`,
`docs/adr/20261115-offer-template-format-supersession-per-entity-language.md`,
`docs/adr/20261115-offer-cost-table-total-rows-and-option-lines.md`.

### Why this shape

- **One engine, two copies, one output type.** AC-3.2 (preview ≡ PDF) holds by construction
  only if the same code produces what both draw. A server-rendered preview would also give one
  implementation but costs a round trip per change against AC-3.1's one second, loads crm-api
  on every keystroke and cannot run the editor preview (AC-8.5) without a deal. A shared
  package needs a workspace, which the repo forbids (AGENTS.md § Git: mixed pnpm/Bun, per-app
  installs). The suite already copies modules on purpose and checks them byte for byte
  (`scripts/check-shared-copies.ts`, e.g. the `manDays` group), so the engine follows that
  pattern.
- **The renderer stays the 018 renderer.** The resolver's output is 018 markup per section,
  so `markup.ts` + `contractPdf.ts` keep drawing letterhead, numbering, cost table, index,
  Annex A and appended PDFs (spec § Constraints). The renderer gains only what the seven
  texts need and 018 cannot draw (text annexes, total rows, option lines).
- **Generation reads the stored draft, not a request body.** What is generated is exactly
  what was autosaved and previewed (the If-Match pins the version), and the draft can be
  removed in the same transaction (AC-6.6). The client never re-sends a 50 KB body.

## Template text — the extended offer markup

The 018 markup (AC-1.6) is kept as is: paragraphs, `- ` bullets, `1.`/`a.` lists nested by two
spaces, `**bold**`, `*italic*`, `__underline__`, `### Sub-heading`, `| a | b |` tables with
`<br>`. The mockup's field and condition syntax is kept so that wellD's authors write what they
already wrote; the mockup's **heuristics** (`_1/_2` suffixes, detecting the cost table by a
"Totale CHF" header, the address block by "Spett.le", the discount by "Scontistica", sections
by a leading number) are replaced by explicit declarations. One syntax (spec § Constraints).

### Grammar

| Construct | Written as | Meaning |
|---|---|---|
| Field use | `[NAME]` — `NAME` = `[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9_]{0,39}` | Prints the field's value. Must be declared (else `field_undeclared`, AC-8.3). |
| Inline condition | `{{block::text}}`, `{{?A,B::text}}`, `{{!A,B::text}}` | Text printed when the block is on / when any of the fields is filled / when none is. Nestable; the condition ends at the **first** `::` (so `{{?F::: …}}` keeps the colon). |
| Block condition | `@@OPT_START <cond>` … `@@OPT_END` | The same, for whole paragraphs, lists, tables, cost lines, sections or annexes. |
| Escape | `\[`, `\*`, `\_`, `\|`, `\{`, `\\`, and `\` before a line-start marker | Literal character. **New in `markup.ts`**: the resolver escapes every answer it inserts, so a value can never become markup (DD-5, § Security). |
| Salutation | `@@salutation Spett.le` | Required, 1–100 chars. |
| Acceptance label | `@@acceptance Il Cliente` | Optional, ≤ 100 chars. |
| Effort-detail annex default | `@@effort-annex on\|off` | 018's Annex A default (default `off`). |
| Opening | the blocks before the first `##` | 018 "opening", 1–5 000 chars resolved. |
| Section | `## HEADING` | A contract section. **No number in the text**: the renderer numbers sections and sub-headings (018 AC-1.3 kept). |
| Step of a section | `@@step client\|scope\|conditions\|costs\|annexes` on the line after `##` | Default: the previous section's step; first contract section `scope`; annex sections `annexes`. |
| Costs section | the section whose first block is `@@costs` | Exactly one (AC-8.3 `no_costs_section` / `costs_not_first`). |
| Text annex | `@@annex <DESIGNATION> <title>`, optional `@@subtitle <text>` | Starts an annex after the contract; designation `[A-Z0-9]{1,8}` (`A`, `SLA`, `DPA`), unique. Its `##` sections are numbered within the annex. Printed from a new page. |
| Declarations | `@@field`, `@@list`, `@@table`, `@@block`, `@@choice` + `key: value` lines up to a blank line or the next `@@` line; an entry splits at its first colon | Never printed. Anywhere in the text (convention: at the end). An unknown key, an unknown `kind:`, a `default:` its kind cannot hold, more than 20 or empty/duplicate `options`, a malformed `fills` or `columns`, a repeated key, or a `label`/`hint`/`example` over its cap is the error `declaration_invalid` (DD-40). |

**Cost table** (inside the costs section; rendered by 018 AC-1.5):

```
@@costs position unit                       ← default columns (018 switches)
@@costlabels [VALUTA] / giorno | Giorni     ← optional unit/quantity column labels (T2)
@@line <key> <kind> [each=<TABLE>] | <description markup> | unit=<amount> | qty=<quantity>
@@total <label markup>
@@end
```

- `<key>` `[a-z][a-z0-9_]{0,39}`, unique — the answer key of the line, stable across template
  edits (AC-8.4).
- `<kind>` `one_off | yearly | discount | option` (`option`: DD-13).
- `unit=` `?` (entered on the line) · `deal` (prefilled with the deal amount, 018) · `perRelease`
  (one prefilled line per estimate release, 018 D-13) · `[FIELD]` (an `amount` field or table
  column — AC-4.2) · a literal (`150`, `150.50`; in the deal's currency, DD-12). A discount
  takes `?` (amount or percentage, entered), or `10%`. In a table with two or more `@@total`
  rows a discount is an **amount only** (DD-39): a declared `10%` there is the template error
  `percent_discount_multi_total`, and a `?` discount is entered as an amount.
- `qty=` integer literal · `?` · `[FIELD]` · `manDays` (018 D-14). No `qty=` → quantity 1. A
  discount with `qty=`, a percentage on a non-discount line, quantity 0 or a literal `unit=` with
  more than two decimals → `cost_line_invalid`. A second `@@costs`, or one that is not the first
  block of its section → `costs_not_first`; a heading or `@@annex` inside the table →
  `costs_not_closed`.
- `each=TABLE` repeats the line for every printed row of a repeatable table (T2).
- A line inside `@@OPT_START block … @@OPT_END` exists only while the block is on (AC-4.4).
- `@@total` closes a **span**: the lines since the previous `@@total` (or the top). After the
  last `@@total` only `option` lines may follow; a `one_off`, `yearly` or `discount` line there
  is the error `cost_line_after_last_total` (it would be in the stored price and in no printed
  total — DD-35). A table with no `@@total` prints no total row. The person's extra lines
  (AC-4.3) are placed immediately before the last `@@total` (at the end when there is none),
  in the order added. Span arithmetic: DD-34, `costs.ts` below.

**Declarations** (keys are language-neutral; values are the author's, in the template's
language — AC-10.1):

| Declaration | Keys |
|---|---|
| `@@field NAME` | `label` (required unless `source:` is given — else `label_missing`; ≤ 80) · `hint` (≤ 200) · `example` (input placeholder, ≤ 80) · `kind` `text`\|`longtext`\|`number`\|`percentage`\|`date`\|`amount` (default `text`) · `default` (`today` for a date) · `options: a \| b \| c` (text only, ≤ 20: shown as a select) · `fills <option>: FIELD = value` (repeatable: choosing the option sets other fields, the SLA profile of T3) · `source: <system value>` · `compute: <expression>` · `step:` (override) |
| `@@list NAME` | `label`, `hint`, `step` — used as a bullet whose only content is `[NAME]` (optionally inside `{{?NAME::…}}`); expands to one bullet per non-empty item |
| `@@table NAME` | `label`, `hint`, `columns: NAME, COL2, …` (first column = `NAME`, the row key; every other column a declared `@@field` of no other table — `table_column_unknown`, `column_in_two_tables`), `step` — a markdown table row or cost line referencing its columns repeats per non-empty row. A column field is a column wherever it is used (a line naming it repeats per row), so a field cannot be both a scalar and a column: T4's hours column is `ORE_MODULO`, not the scalar `ORE` (DD-48) |
| `@@block name` | `label` (required), `explain` (one line), `default: on\|off`, `fills: FIELD = value`, `step` |
| `@@choice name` | `label` (the group name), `options: block_a \| block_b` (≥ 2 declared blocks), `default:` one of them, `step` |

**System values** (`source:`) — 018 AC-1.6 placeholders, now bound by name:

| `source` | Value | Editable where |
|---|---|---|
| `client` | first client-block line (legal name) | Client step |
| `clientAddress` | the other client-block lines, joined with ", " | Client step |
| `contacts` | the chosen contacts' names, ", " | Client step |
| `place`, `date` | place and printed date | Client step |
| `reference` | `0017/2026r1` — preview shows "assigned when the offer is generated" (AC-2.2) | never |
| `issuer` | the legal name of the deal's entity profile, on one line; blank prints nothing and is never missing (DD-57, AC-12.7) | never |
| `issuerAddress` | the profile's address lines, trimmed, blank ones skipped, joined with ", " on one line; none prints nothing, never missing (DD-57, AC-12.9, AC-12.12) — owner amendment | never |
| `currency` | deal currency | never |
| `validityDays` | the offer's validity (018 AC-3.5) | the field itself (bound both ways) |
| `deal`, `epics`, `phases`, `timeline`, `manDays` | 018 prefill values (AC-2.3) | ordinary field, prefilled once |

**Derived fields** (AC-4.5): `compute:` accepts numbers, field names, `+`, `-`, parentheses and
`sum(COLUMN)` over a table's printed rows — parsed by a hand-written recursive-descent parser,
never `eval`. A field whose every occurrence is in an off block counts 0 (`SALDO = 100 -
ACCONTO - RATE` with `rate` off). An empty input makes the result empty; a derived field is
shown read-only and is never missing; a result outside its kind's range (negative
percentage) is **invalid** (DD-18).

### Semantics the engine guarantees

- **Optional field** (AC-1.3): every occurrence is inside a `{{?…}}` naming that field.
- **Shown in the form** (AC-1.5): a field/list/table/block is shown at its first occurrence
  whose **block** conditions are all on (`?`/`!` conditions do not hide a field — an empty field
  must stay fillable), in that occurrence's step, unless `step:` overrides it. As built
  (`outline.ts`, DD-43): the opening's items go to the first contract section's step; a field
  used only by the cost table (description, unit, quantity, `each=`) is an item of the step that
  holds the table and is edited inside the Costs step's table; a field bound by `source:` to
  `client`, `clientAddress`, `contacts`, `place`, `date`, `reference`, `issuer` or `currency` is
  not an item (the wizard edits those in its own places), while `deal`, `epics`, `phases`,
  `timeline`, `manDays` and `validityDays` stay items; a declared but unused field is not an
  item; a step with no items is omitted even when it has sections.
- **Missing** (AC-3.3/3.5): a field is missing exactly when the resolver had to print it and it
  was empty — i.e. one occurrence has all conditions true, is not in a hand-edited section, and
  the value is empty. In a printed table row only the key column and the columns a cost line
  uses as unit or quantity are required (mockup rule).
- **Empty items/rows** (AC-1.7): never printed; order is the answers' order.
- **Dropping**: a sub-heading or section left with no printed content is dropped **by the
  resolver**, so `ResolvedOffer` holds only printed things; numbering follows (engine
  `numbering.ts`, DD-29 — never the renderer alone). The validator warns (`optional_heading_not_last`) when an optional
  sub-heading is followed by siblings, because literal cross-references ("par. 4.3") are not
  rewritten (Risk R10).
- **Printable text**: the engine maps text to what the PDF can print (WinAnsi + U+25A1 "□",
  drawn as a box; everything else "?") **before** the preview draws it, so the preview shows
  what the PDF prints (DD-22). The validator warns on characters that would print "?".

### Worked example (from the mockup's T1, converted)

```
@@salutation Spett.le
@@acceptance Il Cliente

Con riferimento alle discussioni intercorse, abbiamo il piacere di sottoporVi la nostra migliore offerta …

Il presente contratto viene stipulato tra WellD Sagl, … e **[CLIENTE]**, di seguito denominato «Cliente».

## DEFINIZIONI
@@step scope
**Collaudo:** verifica … descritto nel par. 2{{allegato_a:: e nell'Allegato A}}.

## OGGETTO DELLA FORNITURA
Oggetto della fornitura è **[OGGETTO_A_CORPO]**{{?DESCRIZIONE_IN_UNA_FRASE::: **[DESCRIZIONE_IN_UNA_FRASE]**}}.{{?FUNZIONALITÀ_O_DELIVERABLE:: La fornitura comprende:}}

- {{?FUNZIONALITÀ_O_DELIVERABLE::**[FUNZIONALITÀ_O_DELIVERABLE]**}}

## COSTI
@@step costs
@@costs position unit
@@line oggetto one_off | **[OGGETTO_A_CORPO]**, secondo quanto al par. 2, a corpo | unit=deal | qty=1
@@OPT_START voce2
@@line voce2 one_off | **[SECONDA_VOCE]**, a corpo | unit=? | qty=1
@@OPT_END
@@OPT_START sconto
@@line sconto discount | Scontistica accordata | unit=?
@@OPT_END
@@total **TOTALE**
@@OPT_START voce_scelta
@@line scelta option | □ **[VOCE_A_SCELTA_DEL_CLIENTE]** (barrare se desiderata) | unit=? | qty=1
@@OPT_END
@@end

**Note:**
…
@@OPT_START allegato_a
@@annex A Perimetro funzionale{{?VOCE_DI_STIMA:: e stime}}
@@subtitle [RIF]
…
@@OPT_END

@@field CLIENTE
source: client

@@field RIF
source: reference

@@list FUNZIONALITÀ_O_DELIVERABLE
label: Funzionalità o deliverable

@@field ACCONTO
label: Acconto (%)
kind: percentage
default: 50

@@field SALDO
label: Saldo (%)
kind: percentage
compute: 100 - ACCONTO - RATE

@@block voce2
label: Seconda voce di costo
explain: Una seconda voce o fase a corpo nella tabella costi.
```

## Engine contracts (shared copies; sketches, not code)

```ts
type StepKey = "client" | "scope" | "conditions" | "costs" | "annexes";
type FieldKind = "text" | "longtext" | "number" | "percentage" | "date" | "amount";
type SystemSource = "client" | "clientAddress" | "contacts" | "place" | "date" | "reference" | "issuer" | "issuerAddress"  // + issuerAddress: DD-57
  | "currency" | "validityDays" | "deal" | "epics" | "phases" | "timeline" | "manDays";   // § System values

// syntax.ts
parseTemplate(source: string): { ast: TemplateAst; problems: Problem[] };
interface Problem { line: number; severity: "error" | "warning"; code: ProblemCode; name?: string }
// ProblemCode: block_not_closed | unexpected_close | field_undeclared | label_missing |
//  declared_unused (warning) | choice_too_few_options | choice_option_unknown | no_costs_section |
//  costs_not_first | costs_not_closed | cost_line_invalid | cost_key_duplicate | name_duplicate |
//  table_column_unknown | column_in_two_tables | compute_invalid | compute_cycle | fills_unknown |
//  source_unknown | step_unknown | annex_designation_invalid | annex_designation_duplicate |
//  salutation_missing | too_many_sections | too_many_annexes | too_many_annex_sections |
//  heading_too_long | too_large | nesting_too_deep | reserved_character |
//  cost_line_after_last_total (DD-35) | percent_discount_multi_total (DD-39) |
//  non_printable_character (warning) | optional_heading_not_last (warning) |
//  declaration_invalid (DD-40: a malformed declaration; `name` = the offending key, e.g. "kind")
// Unknown `@@` words, a `{{…}}` whose head is not a condition and a `@@step` outside a section
// print as ordinary text with no problem (R20). First `@@salutation`/`@@acceptance`/
// `@@effort-annex` wins; an `@@effort-annex` value other than `on` is off.

// answers.ts — the context the engine reads (DD-41). The engine has no clock and no locale:
// the day and the document language come in here.
interface WizardContext {
  language: "en" | "it";            // the OFFER's language = the template's, never the UI's (AC-10.1)
  today: string;                    // "YYYY-MM-DD": `default: today`, the printed date when none is
                                    //   set, and the ±90-day window (DD-42)
  dealTitle: string; currency: "CHF" | "EUR"; dealAmountCents: number | null;
  issuerLegalName: string; placeOfIssue: string;
  issuerAddressLines: string[];     // DD-57: the entity profile's addressLines, as saved (0–5)
  clientLines: { it: string[]; en: string[] };
  contacts: { id: string; name: string }[];
  attachments: { id: string; fileName: string; sizeBytes: number }[];
  estimate: { state?: "ready" | "override" | "missing"; manDays: number; manDaysAi: number;
              epics: string[]; phases: { release: string; epics: string[] }[];
              timeline: { it: string; en: string }; releases: { name: string; manDays: number }[] } | null;
}
// = the context route's response (§ Wizard context) minus `estimate.annex` and `latestOffer`,
// plus `language`. Built by the browser from the route's `today` and the draft template's
// language; by crm-api from `loadContext`, its own UTC day and the template's language.

// outline.ts — what the wizard asks, per step (AC-1.2, AC-8.2; DD-33, DD-43)
// answers = null → the editor's outline: every item the text uses, nested under its block,
//   regardless of block state. answers given → the wizard's: only items shown (AC-1.5).
// Nesting: under the innermost enclosing block that is an item of the SAME step and comes
// earlier in the text; items inside a choice's option block are listed beside the choice, not
// nested. Wizard mode: the costTable item omits lines and totals inside an off block. A table
// column is `required` when a cost line uses it as unit or quantity; the key column's label and
// kind are the table's label and `text`.
outline(ast, answers: WizardAnswers | null): Outline;
// DD-58 — the fields the CRM supplies and the wizard never asks (AC-12.1, AC-12.9): declared fields bound to
// `issuer` or `issuerAddress` that the text uses (a `[NAME]` or a condition), in order of first use. The editor
// lists them as "supplied by the CRM"; `outline()` itself is unchanged (they stay non-items, OWN_PLACE_SOURCES).
suppliedFields(ast): { name: string; label: string | null; source: "issuer" | "issuerAddress" }[];
interface Outline {
  steps: { key: StepKey;
           sections: { key: string; heading: string; annex: string | null }[];  // the step's sections, text order
           items: OutlineItem[] }[];                                           // only non-empty steps
}
type OutlineItem =
  | { type: "field"; name: string; label: string; hint: string | null; example: string | null;
      kind: FieldKind; default: string | null; options: string[] | null;
      optional: boolean;            // AC-1.3: every occurrence inside a {{?…}} naming it
      derived: boolean;             // has `compute:` — shown read-only, never missing (AC-4.5)
      system: SystemSource | null;  // `source:` binding; edited where § System values says
      fills: { option: string; assigns: { name: string; label: string; value: string }[] }[];
      handEditedIn: string[] }      // section keys (AC-5.2 notice) — always [] when answers = null
  | { type: "list"; name: string; label: string; hint: string | null; optional: boolean; handEditedIn: string[] }
  | { type: "table"; name: string; label: string; hint: string | null; optional: boolean;
      columns: { name: string; label: string; kind: FieldKind; required: boolean }[]; handEditedIn: string[] }
  | { type: "block"; name: string; label: string; explain: string | null; default: boolean;
      fills: { name: string; label: string; value: string }[];   // the "Fills: …" hint (design D-15)
      children: OutlineItem[] }     // items whose first shown occurrence is inside it
  | { type: "choice"; name: string; label: string; default: string;
      options: { block: string; label: string; fills: { name: string; label: string; value: string }[] }[] }
  | { type: "costTable"; lines: { key: string; kind: CostKind; each: string | null; block: string | null }[];
      totals: string[] };           // total-row labels, in order

// answers.ts
interface WizardAnswers {
  v: 1;
  client: { lines: string[]; contactIds: string[]; place: string; date: string | null };
  fields: Record<string, string | number>;  // canonical: text as typed; number/percentage "12.5";
                                            // date "YYYY-MM-DD"; amount integer cents (number)
  prefilled: Record<string, string | number>; // last system prefill, to refresh untouched values
  blocks: Record<string, boolean>;            // choices: exactly one option true
  lists: Record<string, string[]>;
  tables: Record<string, { id: string; cells: Record<string, string | number> }[]>;
  costs: {
    lines: Record<string, { unitCents?: number | null; percentBp?: number | null; quantity?: number | null;
                            releases?: { description: string; unitCents: number | null }[] }>;
    extra: { id: string; description: string; kind: CostKind; unitCents: number | null;
             percentBp: number | null; quantity: number }[];
    columns: { position: boolean; unit: boolean }; showTotals: boolean;
  };
  handEdits: Record<string, { heading: string; body: string; sourceHeading: string }>;
  orphanedEdits: { heading: string; body: string }[];       // after a template change (DD-17)
  validityDays: number; aiAssisted: boolean; effortAnnex: boolean; attachmentIds: string[];
  lastStep: StepKey | "template" | "preview";
}
initialAnswers(ast, context): WizardAnswers;   // contactIds [], client.date null, lastStep "client";
                                               // a field stored only with a default or a prefill;
                                               // fills of default-on options/blocks applied
sampleContext(language): WizardContext;        // AC-8.5: fixed day 2026-01-15, CHF, one contact, two releases
sampleAnswers(ast, language): WizardAnswers;                   // AC-8.5
reconcileAnswers(ast, answers): { answers: WizardAnswers; dropped: string[] };   // AC-8.4, AC-6.5
                                               // dropped: fields, blocks, lists, tables ("TAB.COL"), "cost:<key>"
switchTemplate(ast, answers, context): WizardAnswers;          // keeps client + contacts (AC-6.5)
// The only way an answer changes with fills (decisions.md O3) — the UI calls these, never
// re-implements them; fills apply only on an actual off→on change / a different option:
setField(ast, answers, name, value): WizardAnswers;
setBlock(ast, answers, name, on): WizardAnswers;               // ignores a block that is a choice option
chooseOption(ast, answers, choiceName, option): WizardAnswers;
// What a person typed that the server refuses on PUT (DD-38): reserved characters anywhere
// (U+E000–U+E0FF, "⟦", "⟧", "⟪", "⟫") — except that the exact reference token "⟪REF⟫"
// (REFERENCE_TOKEN, DD-52) is allowed in `handEdits[*].body` and `orphanedEdits[*].body`: there
// the check runs on the value with every exact token removed (left to right, non-overlapping),
// so any other "⟪"/"⟫" (a lone one, "⟪ref⟫", "⟪⟪REF⟫⟫") is still `reserved_character`; in a
// heading, an answer or anywhere else the token itself is refused — and, with
// { options: true } (default), a text outside its options.
checkAnswers(ast, answers, check?: { options?: boolean }):
  { path: string; code: "reserved_character" | "not_an_option" }[];   // path e.g. "fields.ACCONTO"
// Template numbers (a default, a fill) are major units: "150.50" = 15 050 cents; a fill that does
// not fit its target's kind or options is skipped, never stored invalid.

// resolve.ts (DD-44, DD-45)
resolveOffer(ast, answers, context: WizardContext, options?: ResolveOptions): ResolvedOffer;
interface ResolveOptions {
  reference?: string | null;      // once assigned: `source: reference` prints it, no pending marker;
                                  // also fills "⟪REF⟫" in hand-edited bodies (DD-52)
  mode?: "markers" | "tokens";    // "tokens" = the hand-edit text (edit.ts only); default "markers"
}
// DD-52 — the reference token in a hand-edited section (markup.ts exports
// REFERENCE_TOKEN = "⟪REF⟫", U+27EA "R" "E" "F" U+27EB; resolve.ts, edit.ts and answers.ts import
// it, none re-spells it). A hand-edited body is split on the exact token, left to right,
// non-overlapping, on the RAW stored text — before `printable` (which maps "⟪"/"⟫" to "?" and is
// unchanged) and before any markup reading, so a preceding "\" does not escape it. Each piece goes
// through `printable` and "\r\n" → "\n" as today; each token becomes, in place:
//   - with `options.reference`: the reference, through `escapeValue` with the body assembled so
//     far as its line context (a table cell, list item, `**…**` run behave as for an answer);
//   - without it: the pending marker U+E002 label U+E003 — label = `printable` of the label of the
//     template's first `source: reference` field in declaration order, else "REF". Not an issue
//     (DD-44): nothing is added to `missing`, so generation's first pass is not blocked;
//   - in `mode: "tokens"`: the token as written.
// Every occurrence is filled (two tokens → the reference twice), in any hand-edited section
// whether or not its template text used `source: reference`, and whether or not the template
// declares one (the reference exists at every generation). Limits (AC-5.4) stay on the raw
// stored length. An orphaned edit is never resolved (DD-17), so its tokens never print. Template
// text and answers never yield a token: "⟪"/"⟫" are `reserved_character` in both, and even
// unchecked they would reach the output through `printable` as "?".
interface ResolvedOffer {
  language: "en" | "it";                             // = context.language
  salutation: string; acceptanceLabel: string | null;
  client: { lines: string[]; contacts: string[]; place: string;
            date: string | null };                   // the PRINTED date: the person's, else context.today —
                                                     // never null in practice (DD-16, DD-42)
  opening: string;                                   // 018 markup
  sections: ResolvedSection[];                       // contract, in order
  annexes: ResolvedAnnex[];
  costs: { rows: ResolvedCostRow[]; result: CostResult; columns: { position: boolean; unit: boolean };
           labels: { unit: string | null; quantity: string | null }; showTotals: boolean };  // see costs.ts
  effortAnnex: boolean; validityDays: number; aiAssisted: boolean; attachmentIds: string[];
  missing: Issue[];                                  // AC-3.3/3.4
  invalid: InvalidIssue[];                           // AC-3.5/3.6, cost and hand-edit errors included (DD-32)
  systemRead: SystemSource[];                        // DD-58: sources of system fields read while building PRINTED,
                                                     // non-hand-edited text (a use or a condition), sorted, unique
}
type InvalidIssue = Issue & { code: InvalidCode };
// A printed cost row: what computeCosts takes, plus a line's description (a "stripped" plain
// surface, DD-47). Total rows carry their label (stripped too).
type ResolvedCostRow = (Extract<CostRowIn, { type: "line" }> & { description: string })
                     | Extract<CostRowIn, { type: "total" }>;
interface ResolvedAnnex {
  designation: string; title: string;                // title: a "plain" surface (DD-47)
  subtitle: string | null;                           // "plain" surface
  intro: string;                                     // 018 markup between `@@annex` and its first `##` ("" if none)
  sections: ResolvedSection[];
}
// An annex prints only with a non-empty title and an intro or at least one printed section.
// One issue = one place the person must go. `name` is the focus target:
//   field "ACCONTO" · list/table "FUNZIONALITÀ_O_DELIVERABLE" · table cell "TABELLA#<rowId>.COL"
//   cost line "cost:<key>" · release-expanded "cost:<key>#<n>" · extra "cost:extra:<id>"
//   whole table "cost:*" · hand-edited section "section:<sectionKey>"
//   printed date "client:date" (label null, step "client", code date_out_of_range — DD-42)
// Field names start with [A-ZÀ-ÖØ-Þ] so the prefixes never collide. `label` is the template's
// label (a field's `label:`; a cost line's description with every [FIELD] replaced by its
// label and markup stripped, ≤ 80 chars; the section heading) — never an answer value; null
// for an extra line, for "cost:*" and for "client:date" (the UI supplies its own copy).
// Ranges (DD-18, as built): percentage 0–100; amount whole cents 0…MAX_CENTS; number any
// canonical decimal; a date field a real calendar date 1900–2200; validityDays 1–365; cost
// quantity 1–100 000; a discount percentage 0–10 000 bp; the printed date ±90 days (DD-42).
// `missing`/`invalid` list only surviving lines, in text order, one entry per name (+ code).
interface Issue { name: string; label: string | null; step: StepKey }
type InvalidCode =
  | "out_of_range" | "not_integer" | "not_a_number" | "date_out_of_range" | "not_an_option"  // answers (DD-38)
  | "discounts_exceed_span" | "discounts_exceed_one_off" | "discount_without_base"         // costs (DD-34/35)
  | "percent_discount_multi_total"                                                         // costs (DD-39)
  | "cost_total_too_large" | "too_many_cost_lines" | "no_counted_line"
  | "heading_too_long" | "section_too_long";                                               // hand edits (AC-5.4)
interface ResolvedSection {
  key: string;            // heading source text + occurrence index, e.g. "OGGETTO DELLA FORNITURA#0"
  heading: string; body: string; costs: boolean; step: StepKey;
  handEdited: boolean; uses: string[];               // field/list/table/block names it reads (AC-5.2)
}
// Missing values and the pending reference are emitted as reserved markers
// (U+E000 label U+E001 = missing, U+E002 … U+E003 = pending) that markup.ts parses into a
// run with mark "missing" | "pending" — in MARKUP surfaces (opening, section bodies, annex
// intros). PLAIN surfaces (DD-47) carry the same four characters unescaped: section headings,
// annex titles and subtitles ("plain": template text as written, values inserted unescaped)
// and cost descriptions, total labels and column labels ("stripped": template markup removed,
// so `**TOTALE**` arrives as `TOTALE`). A consumer splits a plain surface on U+E000–U+E003 and
// NEVER runs parseInline over it (a value "**x**" there must print literally — § Security). Answers and hand edits containing U+E000–U+E0FF or the
// hand-edit token brackets U+27E6 "⟦" / U+27E7 "⟧" are refused (422 answers_invalid, with the
// JSON path) — `reserved_character` in a template (labels included). The reference-token brackets
// U+27EA "⟪" / U+27EB "⟫" likewise, except an exact "⟪REF⟫" in a hand edit's body (DD-52).

// edit.ts — the text the hand-edit dialog starts from (AC-5.1; DD-30, DD-52)
resolveSectionForEdit(ast, answers, context, sectionKey: string):
  { heading: string; body: string;                   // offer markup, answers escaped as in resolveOffer
    tokens: { name: string; label: string }[] }      // what blocks a save, in text order
  | null;                                            // unknown key / section not printed
// Already hand-edited → returns the stored hand edit unchanged, tokens []. Otherwise every
// missing value is written as the visible token "⟦<label>⟧" (nothing else in the suite produces
// U+27E6/U+27E7, and they are not printable, so a token can never pass for document text).
// `source: reference` in the BODY (a markup surface) is written as the reference token "⟪REF⟫"
// (REFERENCE_TOKEN, DD-52) — not escaped, not raised, not in `tokens`: it is filled at
// generation, so it blocks nothing. In the HEADING (a plain surface; no seed does this) it stays
// a blocking "⟦<label>⟧", because a hand-edit heading never takes the reference token.
// The dialog refuses to save while the heading or body contains "⟦" or "⟧" — whether or not the
// field has been filled since: hand-edited text no longer follows the answers (AC-5.2), so a
// token left in it would be printed literally — or any "⟪"/"⟫" that is not part of an exact
// "⟪REF⟫" in the body. The server refuses the same (checkAnswers, above), so no token and no
// stray bracket can ever reach a PDF.
findTokens(text: string, where?: "body" | "heading"):          // default "body"
  { start: number; end: number; label: string }[];             // dialog error + caret
// One left-to-right pass, entries in text order: every "⟦…⟧" with its label; a lone "⟦" or "⟧"
// as a one-character entry with label ""; labels are unescaped. In "body" an exact "⟪REF⟫" is
// skipped (never an entry, same non-overlapping match as resolve.ts and checkAnswers) and every
// other "⟪" or "⟫" is a one-character entry with label ""; in "heading" every "⟪" and "⟫" is.
// Each field is listed once in `tokens`. The return type is exported as `SectionText`;
// `resolveSectionText` (resolve.ts) is its implementation, not for consumers. The dialog may
// show a note when the body contains REFERENCE_TOKEN (its copy is crm-ui's, T48).

// costs.ts — replaces the arithmetic of crm-api src/offers/costs.ts; returns errors, never throws
// (the legacy route keeps its 018 behaviour through a thin adapter that throws the first error)
type CostKind = "one_off" | "yearly" | "discount" | "option";
type CostRowIn =
  | { type: "line"; name: string;            // the Issue name: "cost:<key>", "cost:<key>#<n>", "cost:extra:<id>"
      kind: CostKind; unitCents: number | null; percentBp: number | null; quantity: number | null }
  | { type: "total"; label: string };
computeCosts(rows: CostRowIn[]): CostResult;
interface CostResult {
  rows: ( { type: "line"; name: string; position: number | null;   // null for discounts (018); options numbered (AC-4.7)
            discountCents: number | null;                           // a percentage discount's amount, once rounded
            totalCents: number | null }                             // null = incomplete (a value is missing)
        | { type: "total"; label: string; spanIndex: number;
            state: "ok" | "empty" | "incomplete"; totalCents: number | null } )[];
  oneOffCents: number | null;   // stored price (018 D-6): Σ one-off − Σ every discount; null while incomplete
  yearlyCents: number | null;   // Σ yearly; null while incomplete
  errors: { code: CostErrorCode; name: string }[];   // name = the line ("cost:…") or "cost:*"
}
// Rules — normative, pinned by vectors/costs.spans.json (DD-34, DD-35, DD-39):
//  C1 counted line = a one_off or yearly line present in the table (its block on). option lines
//     are priced and numbered but counted nowhere (AC-4.7).
//  C2 span k = the rows after total row k−1 (or the top) up to total row k.
//  C3 a percentage discount (percentBp ≠ null) exists only in a table with AT MOST ONE total
//     row (DD-39). Total rows are counted in `rows` as given — after block resolution, whatever
//     `showTotals` says (a display switch never changes whether an input is valid). Then
//     discount = roundHalfUp(Σ every one-off line total of the table × bp / 10 000), BigInt,
//     rounded once — 018's base exactly; with ≤ 1 total row and nothing but option lines after
//     it (DD-35) the whole table IS the discount's span. With two or more total rows every
//     percentage discount → percent_discount_multi_total at that discount (one entry each,
//     "cost:<key>" or "cost:extra:<id>"); it gets no amount (discountCents and totalCents null)
//     and is handled as C8 handles a missing value — its span "incomplete", C4/C5 skip that
//     span, C6 and oneOffCents/yearlyCents wait — except that this error, not `missing`, blocks
//     generation. No figure is ever computed from a refused input. (Supersedes the own-span
//     base of decisions.md rule 1 — decisions.md, last entry.)
//  C4 a percentage discount in a table (≤ 1 total row, C3) with no one-off line →
//     discount_without_base (at the discount): a percentage needs a base, and 0 % of nothing
//     printed as "– 0.00" is a figure with no meaning (ADR …-total-rows-and-option-lines
//     § Failure shape). Not evaluated for a discount C3 already refused.
//  C5 per span: Σ discounts ≤ Σ counted lines of the span, else discounts_exceed_span at the
//     span's first discount — no printed total is ever negative (decisions.md rule 2, read
//     against AC-4.6's own example, where a 50.00 discount in a yearly-only span is valid).
//     In a table with two or more total rows every discount is an amount (C3).
//  C6 document: Σ every discount ≤ Σ every one-off line, else discounts_exceed_one_off at the
//     last discount — the stored price is never negative (018's rule, AC-4.6 "price computed
//     as in 018"). For one span of one-off lines C5 and C6 are the same check.
//  C7 a total row whose span has no counted line: state "empty", totalCents null, printed
//     "–" (U+2013, WinAnsi) in the preview and the PDF; not an error (decisions.md rule 3).
//  C8 a counted line or discount with a missing value: its totalCents null (preview: the
//     missing run), its span "incomplete" (preview: an empty missing run, never a partial
//     sum); C4/C5 skip that span, C6 and oneOffCents/yearlyCents wait for all lines. The
//     value is already in `missing`, so generation is blocked anyway.
//  C9 no counted line in the whole table → no_counted_line ("cost:*"); more than 10 lines
//     counting option, release-expanded, table-expanded and extra lines → too_many_cost_lines
//     ("cost:*", AC-4.3); any figure above MAX_CENTS → cost_total_too_large (at the line).
//  Invariant (AC-4.6, last sentence; DD-39): oneOffCents and yearlyCents depend on the lines
//     only, never on where the total rows fall — an amount does not depend on spans, and a
//     percentage exists only where the whole table is one span.
// resolveOffer copies `errors` into ResolvedOffer.invalid (step "costs") — DD-32.
//
// vectors/costs.spans.json — run by both copies; each case = CostRowIn[] → CostResult:
//  · AC-4.6's example (amount discount in a yearly-only span; oneOffCents 95 000, R17);
//  · placement invariance: the same lines with an amount discount and the total rows moved
//    (0, 1, 2, 3 total rows) → identical oneOffCents/yearlyCents;
//  · ≤ 1 total row with a percentage: 1 000.00 · 500.00 · 10 % · TOTAL → 1 350.00 printed and
//    stored, equal to the legacy 018 computeCosts on the same input; also with no total row;
//  · ≥ 2 total rows with a percentage (the ADR's 1 000.00 · TOTAL A · 500.00 · 10 % · TOTAL B):
//    percent_discount_multi_total at the discount, its span "incomplete", oneOffCents null —
//    once for a template line ("cost:<key>"), once for an extra line ("cost:extra:<id>");
//  · a second total row inside an off block: the same percentage valid (one total row present);
//  · C4 discount_without_base (one total row, yearly only, a percentage); C5 and C6 each
//    failing alone; empty span → null / "–", no error; incomplete span skips its checks.
// Template-level vectors (syntax): `unit=10%` with two `@@total` rows (also when one of them
//  sits in an `@@OPT_START` block — the parser counts every declared `@@total`) →
//  percent_discount_multi_total at the discount's line; `unit=10%` with one → no problem;
//  `unit=?` with two → no problem (entered as an amount).
type CostErrorCode = "discounts_exceed_span" | "discounts_exceed_one_off" | "discount_without_base"
  | "percent_discount_multi_total"                                   // C3 (DD-39), as built
  | "cost_total_too_large" | "too_many_cost_lines" | "no_counted_line";
// Error order (pinned by vectors): too large, C3, C4, C5, C6, no_counted_line, too_many_cost_lines.
// MAX_CENTS = 1e13 and MAX_COST_LINES = 10 are exported by the engine (a crm-api test asserts
// they agree with offerSchemas).

// format.ts — the DOCUMENT's formatting (moved out of contractPdf.ts): formatAmount (7'000),
// shortDate (9.2.2026), formatPercent, formatNumber. Used by the PDF and the preview (DD-21).

// words.ts — the document's fixed words per offer language, moved out of contractPdf.ts's
// `t` table ("Allegato"/"Annex", "Allegati:", "Pos.", "Totale", index title, …). Document
// text in the OFFER's language, not UI copy — it never goes through strings.ts (AC-10.1).

// numbering.ts — the document's numbering, used by the PDF and the preview (AC-3.2, AC-9.5; DD-29, DD-46)
numberOffer(input: NumberingInput): NumberedOffer;
interface NumberingInput {                              // the printed structure only
  language: "en" | "it";                                // words.ts: "Allegato"/"Annex", annex title, index
  sections: { key: string; heading: string; body: string }[];   // body = 018 markup; its ### lines are the sub-headings
  annexes: { designation: string; title: string; sections: { key: string; heading: string; body: string }[] }[];
  effortAnnex: boolean;
  attachmentNames: string[];                            // the deal PDFs' file names, in order (the "Allegati:" lines)
}
// Built from a ResolvedOffer (an annex's subtitle and intro are not numbered: an intro's ###
// lines are drawn unnumbered) or, by the renderer, from a legacy 018 snapshot — one numbering
// for both. Every output string is upper-cased with toUpperCase and passed through printable,
// so it is PRINT-READY: a marker character in it has become "?" (DD-46). Text annex heading
// "<WORD> <DESIGNATION> – <TITLE>"; "Allegati:" lines use " - "; index targets are the section
// key, "annex:<designation>" or "annex:effort"; letters A…Z, AA, AB…, skipping used designations.
interface NumberedOffer {
  sections: { key: string; number: string;              // "2"
              heading: string;                          // "2. OGGETTO DELLA FORNITURA" (toUpperCase, never toLocale*)
              subheadings: string[] }[];                // "2.1 …", depth-first in markup order, list children included
  annexes: { designation: string;                       // "A", "SLA"
             heading: string;                           // "ALLEGATO A – PERIMETRO FUNZIONALE" (words.ts)
             sections: { key: string; number: string; heading: string; subheadings: string[] }[] }[];
  effortAnnexLetter: string | null;                     // next free letter, skipping text designations
  attachmentLetters: string[];                          // then the deal PDFs, same rule (DD-2)
  annexList: string[];                                  // the "Allegati:" lines, in order
  index: { label: string; target: string }[] | null;    // only when the effort-detail annex prints
}
```

`markup.ts` changes, kept backward compatible for the legacy templates and offers: backslash
escapes, the two marker kinds, nothing else. Today a backslash prints literally; after this a
backslash before a markup character escapes it — checked against production data before the
deploy (Risk R13).

## Data model

One migration, `crm-api/prisma/migrations/20261115120000_offer_wizard/migration.sql`. It
never touches `deal_offer` (AC-9.4).

```sql
CREATE TYPE "OfferTemplateFormat" AS ENUM ('sections', 'wizard');
CREATE TYPE "OfferDraftTarget"   AS ENUM ('new', 'edit', 'revision');

ALTER TABLE "offer_template"
  ADD COLUMN "format"      "OfferTemplateFormat" NOT NULL DEFAULT 'sections',
  ADD COLUMN "description" TEXT,                       -- ≤ 160, one line
  ADD COLUMN "uses"        TEXT[] NOT NULL DEFAULT '{}',-- ≤ 6 × ≤ 40
  ADD COLUMN "source"      TEXT,                       -- the wizard template text
  ADD COLUMN "seedKey"     TEXT,                       -- e.g. 'welld-ch-it-v1:T1'
  ALTER COLUMN "salutation"  DROP NOT NULL,
  ALTER COLUMN "opening"     DROP NOT NULL,
  ALTER COLUMN "sections"    DROP NOT NULL,
  ALTER COLUMN "costLines"   DROP NOT NULL,
  ALTER COLUMN "costColumns" DROP NOT NULL;

ALTER TABLE "offer_template" ADD CONSTRAINT "offer_template_format_content" CHECK (
  ("format" = 'sections' AND "salutation" IS NOT NULL AND "opening" IS NOT NULL
     AND "sections" IS NOT NULL AND "costLines" IS NOT NULL AND "costColumns" IS NOT NULL
     AND "source" IS NULL)
  OR ("format" = 'wizard' AND "source" IS NOT NULL AND char_length("source") <= 150000));

CREATE UNIQUE INDEX "offer_template_entity_seed_key"
  ON "offer_template" ("entity", "seedKey") WHERE "seedKey" IS NOT NULL;
-- unchanged: offer_template_entity_name_active_key UNIQUE (entity, lower(name)) WHERE archivedAt IS NULL

CREATE TABLE "offer_draft" (
  "dealId"             TEXT PRIMARY KEY REFERENCES "deal"("id") ON DELETE CASCADE,
  "templateId"         TEXT NOT NULL REFERENCES "offer_template"("id") ON DELETE RESTRICT,
  "templateVersion"    INTEGER NOT NULL,          -- the version the answers match
  "targetKind"         "OfferDraftTarget" NOT NULL DEFAULT 'new',
  "targetOfferId"      TEXT REFERENCES "deal_offer"("id") ON DELETE RESTRICT,
  "targetOfferVersion" INTEGER,
  "answers"            JSONB NOT NULL,            -- WizardAnswers; ≤ 512 KiB checked by the route
  "version"            INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "offer_draft_target" CHECK (("targetKind" = 'new') = ("targetOfferId" IS NULL)
                                    AND ("targetOfferId" IS NULL) = ("targetOfferVersion" IS NULL))
);
CREATE INDEX "offer_draft_templateId_idx" ON "offer_draft"("templateId");
```

- Existing rows default to `sections` and satisfy the CHECK (their columns are all set today).
- Prisma: `OfferTemplate`'s legacy fields become optional; the legacy code reads them only
  after checking `format === "sections"` (a typed narrowing helper, `legacyContent(row)`).
- Templates are never deleted (archive only) and offers only soft-deleted, so both FKs are
  `RESTRICT`. A deal is not deleted in the CRM today; `CASCADE` keeps a future delete simple.
- **Snapshot** (`deal_offer.snapshot`, JSON) of a wizard offer = the 018 `ContractSnapshot`
  plus, all optional so legacy snapshots stay valid:
  - `wizard: { templateVersion, answers }` — enough to reopen the wizard (AC-6.6) together with
    `template.id`; the template **source** is not stored (DD-20);
  - `textAnnexes: [{ designation, title, subtitle, intro, sections: [{ heading, body }] }]` (`intro`:
    018 markup drawn before the annex's first section, unnumbered — DD-45);
  - `costs.rows` (lines and total rows in order), `costs.labels` (`unit`, `quantity` or null),
    `OfferCostLine.kind` may be `option`;
  - `sections[].handEdited` (boolean, display only).
  `issuedOn` is the printed date (DD-16). The resolved texts are plain markup, as in 018 D-9.
- No data migration. Seeding and archival are lazy (§ API).
- Owner amendment: no schema change. `seedKey` takes two more value families per seed code —
  `welld-ch-it-v2:<code>` (the v2 text, DD-59) and `welld-ch-it-v1-kept:<code>` (a v1 row a person had
  edited, decided once and left as written, DD-60); the existing partial unique index
  `(entity, "seedKey")` covers them. The entity profile is unchanged (no new field, spec Non-goals).

## API contracts

All routes are in crm-api, behind the existing JWKS + live authz middleware. RFC 7807 errors;
`code` values are listed. "generating" = `deal:financials` + `deal:manage`, then the deal is
loaded (404 when it does not exist: deals are readable) and `assertInScope` runs (403
`out_of_scope`) **before** anything about a draft is read.

### Offer templates (extended)

```ts
// Response item (TemplateSchema) gains:
{ format: "sections" | "wizard";
  description: string | null; uses: string[];
  source: string | null;          // wizard only; legacy content members are null for wizard rows
  seeded: boolean }               // seedKey != null

// Wizard body (create adds `entity`):
WizardTemplateBody = z.object({
  name: requiredText(80), language: z.enum(["en", "it"]),
  description: z.string().max(160).regex(/^[^\n]*$/),
  uses: z.array(requiredText(40)).max(6),
  source: z.string().min(1).max(150_000),
}).strict()
```

| Route | Gate | Change |
|---|---|---|
| `GET /offer-templates?entity=&includeArchived=&formats=` | `deal:financials` | `formats` = `sections` (default) \| `wizard` \| `sections,wizard`. The default keeps the live (old) crm-ui working during the deploy window (Risk R4). When `wizard` is asked: runs `seedTemplatesIfEmpty` (018) then `seedWizardTemplates(entity)` (below). |
| `GET /offer-templates/{id}` | `deal:financials` | returns `source` for wizard rows |
| `POST /offer-templates` | writing | **wizard body only** (`format` implied): new templates are wizard templates (DD-9). `422 template_invalid` + `problems: [{ line, code, severity, name? }]` (errors only block); `409 template_name_taken`; activates the format for (entity, language) — supersession. |
| `POST /offer-templates/{id}/duplicate` | writing | copies the format; a wizard copy triggers supersession like a create |
| `PUT /offer-templates/{id}` | writing, If-Match | body by the row's format (legacy body for legacy rows, as 018); wizard: same 422; a language change runs supersession for the new language and the last-template guard for the old one |
| `POST /offer-templates/{id}/archive` | writing, If-Match | `409 last_template` when it is the only active template of its (entity, language) |
| `POST /offer-templates/{id}/restore` | writing, If-Match | a legacy row while an active wizard template exists for its (entity, language): `409 template_superseded` |

**Supersession (AC-9.2)** — in the same transaction as any write that leaves an active wizard
template for (entity, language), under the existing advisory lock
`crm-offer-templates:<entity>`: `UPDATE offer_template SET "archivedAt" = now(), version =
version + 1, "updatedBy" = $actor WHERE entity = $e AND language = $l AND format = 'sections'
AND "archivedAt" IS NULL`, **before** the insert (the active-name unique index would otherwise
refuse "Progetto a corpo" / "Formazione", which exist as legacy names). Never before a wizard
template exists for that language; welld_it and welld_ch English stay on the legacy dialog
until wellD adds their texts (AC-9.3).

**Wizard seed (AC-9.1; amended by DD-59/DD-60 for AC-12.5/12.6/12.11)** — the texts are the v2
texts (the issuer bound, keys `welld-ch-it-v2:<code>`); before inserting, the same locked
transaction upgrades, once, every v1 row still byte-identical to a shipped v1 text and marks every
other v1 row kept (§ Amendment, owner — DD-60); a code with a row under any of its three keys is
never inserted again. As first written: `seedWizardTemplates(entity)`: only `welld_ch`; under the same lock,
inserts each of the seven `WELLD_CH_IT_V1` seeds whose `seedKey` has **no row at all**
(archived included, so an archived seed is never resurrected), as `system:crm-api`, then
supersession for (welld_ch, it). The seeds are the mockup's texts converted to the grammar
above, with the conversions of DD-1, DD-5, DD-12, DD-24, and parse with zero errors (test).

### Wizard context

`GET /deals/{id}/offer-wizard/context` — generating. `Cache-Control: no-store`.

```ts
{ dealTitle: string; currency: "CHF" | "EUR"; dealAmountCents: number | null;
  issuerLegalName: string; placeOfIssue: string;
  issuerAddressLines: string[];                      // owner amendment (DD-57): the profile's addressLines as saved
  letterhead: boolean;                               // owner amendment (DD-54): the profile has a letterhead; never a link
  clientLines: { it: string[]; en: string[] };       // 018 clientLinesOf, country line per offer language
  contacts: { id: string; name: string }[];          // the deal company's
  attachments: { id: string; fileName: string; sizeBytes: number }[];  // stored PDFs of the deal
  estimate: { state: "ready" | "override" | "missing";
              manDays: number; manDaysAi: number;     // rounded half up (018)
              epics: string[]; phases: { release: string; epics: string[] }[];
              timeline: { it: string; en: string };   // 018 timelineTable markup
              releases: { name: string; manDays: number }[];
              annex: { it: Scope; en: Scope; itAi: Scope; enAi: Scope } | null };  // preview of Annex A
  latestOffer: { id: string; reference: string; sent: boolean; version: number; origin: Origin } | null;
  today: string }                                     // "YYYY-MM-DD", the server's UTC day — 018's issuedOn rule (DD-41)
```

The client block is returned per language because the country line is in the offer's
language (018 AC-1.2); the client picks by the template's language. The route knows no
template, so it does not return `language`: the browser builds the engine's `WizardContext`
from this response with `language` = the draft template's language (never `<html lang>`) and
`today` = this `today` (never the browser's clock), so the preview's defaults and date window
are the server's (DD-41).

### Offer draft

```ts
OfferDraftView = {
  dealId: string;
  template: { id: string; name: string; language: "en" | "it"; version: number; archived: boolean };
  templateVersion: number;                 // the answers' version; ≠ template.version ⇒ notice (AC-8.4)
  target: { kind: "new" } | { kind: "edit" | "revision"; offerId: string; offerVersion: number; reference: string };
  answers: WizardAnswers;
  version: number; updatedBy: PersonRef; updatedAt: string; createdAt: string;
}

// G1 / DD-27 — what the deal page needs, without `answers` (≤ 512 KiB)
OfferDraftSummary = {
  dealId: string;
  template: { id: string; name: string; language: "en" | "it"; archived: boolean };
  templateChanged: boolean;                // draft.templateVersion ≠ template.version (AC-8.4 hint)
  target: { kind: "new" } | { kind: "edit" | "revision"; offerId: string; offerVersion: number; reference: string };
  version: number;                         // = the ETag; Discard sends it as If-Match
  updatedBy: PersonRef; updatedAt: string; createdAt: string;
}
```

| Route | Headers | Body | Success | Errors |
|---|---|---|---|---|
| `GET /deals/{id}/offer-draft` | — | — | 200 `OfferDraftView`, `ETag` | 404 `draft_not_found` |
| `GET /deals/{id}/offer-draft/summary` (DD-27) | — | — | 200 `{ draft: OfferDraftSummary \| null }`; `ETag` only when a draft exists; `Cache-Control: no-store`. One query that never selects `answers`. No draft is **200 `{ draft: null }`**, not 404 (absence is the common answer on every deal page load) | 403 `forbidden` / `out_of_scope` (same body with or without a draft, AC-6.2), 404 `deal_not_found` |
| `POST /deals/{id}/offer-draft` | `If-None-Match: *` (428 without) | `{ templateId?, target?: { kind: "new" } \| { kind: "edit" \| "revision", offerId } }` — `templateId` required for `new` (or no target); **optional for `edit`/`revision`** (DD-28) | 201 view + `ETag`. Answers built **server-side**: `new` → `initialAnswers(ast, context)`. `edit`/`revision`: the template is `templateId`, or when omitted the snapshot's `template.id` (wizard offers only). Same template as the snapshot's → `reconcileAnswers` of the snapshot's answers (draft `templateVersion` = the snapshot's, so the AC-8.4 notice fires if the template moved); another template, or a legacy offer (AC-7.3) → `initialAnswers` + the offer's client lines, contacts, place and date (the `switchTemplate` rule, AC-6.5) | 409 `draft_exists` (+ `updatedBy`, `updatedAt`), 409 `estimate_not_ready` (AC-2.4), 409 `template_archived` (+ `templateId`; also when the omitted id resolves to an archived template — the UI then opens the Template step with the target set), 409 `template_format_mismatch`, 404 template/offer (a template of another entity is 404), 422 `template_required` (`new` without `templateId`; `edit`/`revision` of a legacy offer without it), 409 `offer_sent` (edit of a sent offer), 409 `offer_not_sent` (new/revision while the latest is unsent, 018 AC-7.1), 409 `offer_not_latest`, 409 `offer_legacy` (an 018-summary `OF-…` offer) |
| `PUT /deals/{id}/offer-draft` | `If-Match` | `{ templateVersion, target, answers }` (`templateId` cannot change here) | 200 view + `ETag`. A body deep-equal to the stored draft is a **no-op**: 200, same `version`, no write, `updatedAt` unchanged (DD-31) | 428, 409 `version_conflict`, 422 `answers_invalid` `{ path }` (zod: strict shape, caps below, reserved characters; and, when `templateVersion` = the template's version, a text value outside its field's `options` — AC-1.8, DD-38), 413 `draft_too_large` (> 512 KiB) |
| `POST /deals/{id}/offer-draft/template` | `If-Match` | `{ templateId }` | 200 view: `switchTemplate` keeps client lines, contacts, place, date (AC-6.5) | as POST + 428/409 |
| `DELETE /deals/{id}/offer-draft` | `If-Match` | — | 204 | 428, 409, 404 |
| `POST /deals/{id}/offer-draft/generate` | `If-Match` | — | 201 (`new`/`revision`) or 200 (`edit`) `OfferSchema`, `ETag` of the offer | 428, 409 `version_conflict`, 409 `template_changed` (draft `templateVersion` ≠ template), 409 `template_archived`, 409 `estimate_not_ready`, 409 `offer_not_sent` / `offer_sent` / `offer_not_latest` / `offer_changed` (edit CAS on `targetOfferVersion`), **422 `offer_incomplete`** (below — every missing value, invalid answer, cost error and hand-edit limit, DD-32), 422 018 codes that need the database (`contact_not_in_company`, `attachment_*`) |

`offer_incomplete` (DD-32) — exactly `resolveOffer(…).missing` / `.invalid` of the stored draft,
so the server refuses for the same reasons, under the same names, as the browser listed:

```ts
422 { type: "…/offer_incomplete", title: "The offer is not complete", status: 422, code: "offer_incomplete",
      missing: { name: string; label: string | null; step: StepKey }[],
      invalid: { name: string; label: string | null; step: StepKey; code: InvalidCode }[] }
// e.g. invalid: [{ name: "cost:sconto", label: "Scontistica accordata", step: "costs", code: "discounts_exceed_span" },
//                { name: "section:OGGETTO DELLA FORNITURA#0", label: "OGGETTO DELLA FORNITURA", step: "scope", code: "section_too_long" }]
```

Names and labels only, never a value (§ Security). The draft generate route no longer answers
the separate 422s `discounts_exceed_one_off`, `cost_total_too_large`, `too_many_cost_lines`,
`no_counted_line`, `section_too_long`, `heading_too_long`; the legacy `POST /deals/{id}/offers`
keeps them unchanged (AC-9.4).

Caps on `answers` (zod, all strict): `fields` ≤ 400 entries, text ≤ 20 000 chars; `lists` ≤ 50
items × ≤ 2 000 chars; `tables` ≤ 50 rows; `client.lines` 1–8 × ≤ 200 (018); `contactIds`
≤ 5; `attachmentIds` ≤ 5; `costs.extra` ≤ 10; `handEdits` heading ≤ 1 000 + body ≤ 100 000 in the draft schema (as built, confirmed by the owner 2026-11-15; the dialog and generation keep the DD-3 limits of 120 / 20 000, an over-long hand edit saves and is refused at generate as `heading_too_long` / `section_too_long`);
`validityDays` 1–365; `client.date` null or a real `YYYY-MM-DD` — shape only: the ±90-day
window is checked by the resolver as `invalid` `client:date` and blocks generation, it never
refuses an autosave (DD-42, DD-8). Reserved characters and options are checked with the
engine's `checkAnswers` (`{ options: false }` when the body's `templateVersion` is stale, DD-38).

**Generate, step by step** (one place: `offers/generation.ts`, shared with the legacy route):

1. `requireIfMatch`; load the draft (`draft_not_found`); `assertVersion`.
2. Load the template: active, `wizard`, same entity (else 404/409); `template.version ===
   draft.templateVersion` else `template_changed`.
3. Load the context exactly as `loadContext` does today (estimate gate, profile, company) — and,
   owner amendment (DD-61, AC-12.7), a profile whose `legalName` is blank after trim is refused
   like an absent one (409 `entity_profile_missing`, `{ entity }`), before any resolve or byte read — and
   build the `WizardContext` with `language` = the template's and `today` = the server's UTC
   day (DD-41).
4. `resolveOffer` without a reference (the pending reference is not an issue) → `missing`/
   `invalid` non-empty (cost errors, hand-edit limits and `client:date` included, DD-32,
   DD-42) ⇒ 422 `offer_incomplete`; structural limits the parser already bounds (sections
   1–15, annex rules) are asserted again, defensively.
5. Read the chosen PDFs and the letterhead (ADR 20261102 bounded read, unchanged).
6. Transaction, per-deal advisory lock (018): target checks — `new`/`revision`: 018 numbering
   and `offer_not_sent`; `edit`: the offer is the latest, unsent, and `version =
   targetOfferVersion`. Take the reference, **resolve again with `{ reference }`** (pure,
   milliseconds), number it with `numberOffer` (`attachmentNames` = the chosen PDFs' stored
   file names), build the snapshot (`issuedOn` = `ResolvedOffer.client.date`), render, `putObject`, insert/update the offer, then `DELETE FROM
   offer_draft WHERE "dealId" = $1 AND version = $expected` — zero rows ⇒ throw 409
   `version_conflict`, the transaction rolls back and the object is deleted (018 pattern).
7. After the commit: `announce` E9 as today; one log line `{ dealId, offerId, templateId,
   templateVersion, target }` — no content.

### Entity-profile letterhead link (existing route, owner amendment)

`GET /entity-profiles/{entity}/letterhead` — unchanged gate (`deal:financials`), unchanged answer
`{ url }` (60 s presigned GET, 404 when none), plus `Cache-Control: no-store` (DD-54). It is the
preview's only way to the bytes; the context never carries the link.

### Offers (existing routes)

- `OfferSchema` gains `origin: "summary" | "sections" | "wizard"` (018-summary `OF-…`,
  legacy contract, wizard). The UI picks the edit/revise path from it (AC-7.3).
- `GET /deals/{id}/offers/draft` (the legacy **prefill**, not an offer draft) and
  `POST /deals/{id}/offers` refuse a wizard template: 409 `template_format_mismatch`.
- `GET /deals/{id}/offers/{offerId}/form` and `PUT /deals/{id}/offers/{offerId}` refuse a
  wizard offer: 409 `offer_wizard` (it is edited through a draft).

## UI (crm-ui)

Built per `operai-ui/docs/building-pages.md` and `design-system.md`; every control from
`@operai/ui` (`PageHeader`, `Tabs`, `Field`, `RadioGroupField`, `CheckboxGroupField`,
`MoneyInput`, `DateInput`, `Combobox`, `Button`, `Banner`, `ConfirmDialog`, `FormDialog`,
`Drawer`, `StatePanel`, `Badge`, `DataTable`, `Icon`); copy in `strings.ts` (`en` + `it`);
token utilities only.

- **Route** `/crm/deals/$id/offer` — `OfferWizardPage`. Opens on `?step=` when present (design
  D-3), else on the draft's `lastStep` when a draft exists, else on the Template step with no
  draft (AC-1.1: nothing is stored until a template is chosen). `lastStep` is the step of the
  last **content** save, not of the last click (DD-31).
- **Steps** as `Tabs`: Template, Client, Scope, Conditions, Costs, Annexes, Preview — a step is
  listed only if `outline()` gives it items (AC-1.2); Back/Next and visited tabs move without
  losing anything (state is the answers, AC-1.6). Missing counts per tab.
- **Template step**: active wizard templates of the deal's entity grouped by language (name,
  description, uses — AC-1.1); below, "Classic templates" for languages that have none (open
  `GenerateOfferDialog`, DD-9); the estimate banner and disabled cards when
  `estimate.state === "missing"` (AC-2.4); the unsent-latest-offer banner offering "Edit it
  instead" (018 AC-7.1).
- **Client step**: client lines (1–8), contacts (≤ 5, `CheckboxGroupField` — DD-37), place, printed date
  ("the day of generation" or a date), reference shown as "assigned when the offer is
  generated" (AC-2.1, AC-2.2). A printed date more than 90 days from `today` is the issue
  `client:date` (`date_out_of_range`), shown and focused on this step (DD-42).
- **Step forms**: `FieldInput` by kind (`text` → input or select when `options`; `longtext` →
  textarea; `number`/`percentage` → decimal input; `date` → `DateInput`; `amount` →
  `MoneyInput` in the deal currency), label + hint + a visible "optional" tag (AC-1.3 wins
  over design-system INC-16, DD-36) and `*` + `aria-required` on required ones; `BlockSwitch`
  and `BlockChoice` (radio group, exactly one, AC-1.4); `ListFieldEditor` and
  `RepeatableTableEditor` (add, remove, move up/down — AC-1.7); derived fields read-only
  (AC-4.5); a notice under a field that a hand-edited section uses (AC-5.2). Every change goes
  through the engine's `setField`/`setBlock`/`chooseOption`, so fills follow O3 in one place.
- **Costs step**: the template's lines with description, unit, quantity, total (AC-4.1), unit
  and quantity cells bound to the same answer as their field (AC-4.2), extra lines add/remove
  (AC-4.3), columns and "show totals" switches, validity when no field is bound to it. A
  discount's amount/percentage toggle is shown only while the table has at most one total row
  present; with two or more it is an amount input with a hint naming the reason (DD-39). A
  stored percentage that became invalid (a block brought in a second total row, the template
  changed) keeps its value and is listed as invalid `percent_discount_multi_total`; the toggle
  stays shown on that line so the person can switch it to an amount.
- **Annexes step**: the template's annex-step items, the effort-detail annex switch and
  AI-assisted (when there is an estimate), the deal's PDFs (≤ 5).
- **Preview step**: the missing/invalid list straight from `ResolvedOffer.missing`/`.invalid`
  — cost errors and hand-edit limits included (DD-32); select → step + focus by the issue's
  `name` (field input, cost-line row `crm-wizard-cost-<key>`, the table, or the section's
  Edit text button) via `focusFirstInvalid`, AC-3.4/3.6; per section "Edit text" (`FormDialog`,
  heading + body from `resolveSectionForEdit` with "⟦Label⟧" tokens and a warning listing them,
  save refused while a token remains, DD-30; AC-5.1; the reference shows as "⟪REF⟫", which does
  not block the save and is explained by a note, DD-52), "Edited by hand" `Badge`, "Restore"
  (`ConfirmDialog` naming the section and saying the text written for it is lost, AC-5.3);
  Generate, `aria-disabled` with the counts while anything is missing or invalid (AC-3.5).
  A 422 `offer_incomplete` replaces both lists with the server's.
- **DocumentPreview**: renders `ResolvedOffer` as React elements (never HTML strings) on a
  page-like column: header block, sections and sub-headings with the numbers and annex
  letters of `numberOffer` (DD-29), cost table with `computeCosts` rows (positions, span
  totals, "–" for an empty span — DD-34) in document formatting (DD-21), annexes and the
  "Allegati:" list; missing fields as a highlighted run with the label (AC-3.3). Plain surfaces
  (headings, annex titles/subtitles, cost descriptions, total labels, column labels) are split
  on the four marker characters, never parsed as markup; a numbered heading or annex heading
  whose text carries a marker is composed from `numberOffer`'s number/designation and the split
  text (plain parts upper-cased with `toUpperCase` + `printable`, as the engine does), because
  `numberOffer`'s own strings have mapped the marker to "?" (DD-46, DD-47). Beside the
  form at ≥ 1 280 px, in a `Drawer` below (AC-3.1). Re-resolved 250 ms after the last change.
- **`useOfferDraft`** (hook): in-memory state only (AC-6.7); autosave 1 s after the last
  **content** change (at most 5 s while typing) — moving between steps schedules no save;
  each save carries the current step as `lastStep` (DD-31); one request in flight, the latest
  `ETag` each time; on
  409 it stops and shows "Someone else changed this draft — reload" (`Banner`, AC-6.3); on a
  network error it retries with backoff and shows "Not saved yet"; `beforeunload` prompt
  while a save is pending. On load with `templateVersion ≠ template.version` it runs
  `reconcileAnswers`, saves, and shows the template-changed notice with what was dropped and
  any orphaned hand edits to copy (AC-8.4).
- **OffersCard**: a draft row from `GET /offer-draft/summary` (DD-27) — template, target,
  "changed by X, date", Continue, Discard (`ConfirmDialog`, `DELETE` with `If-Match` = the
  summary's `version`; a 409 refetches the summary and says the draft changed) — fetched only
  when `/scope` reports `financials` and manage for the deal's entity (AC-6.4, AC-6.2; design
  G10: no new endpoint). Edit/New revision: `origin === "wizard"`
  → `POST offer-draft { target }` without `templateId` (DD-28; on 409 `template_archived` →
  the Template step with the target set); `origin === "sections"` → legacy dialog if the
  (entity, language) has no active wizard template, else the wizard on the Template step with
  `target` set (AC-7.1–7.3); an existing draft is offered first ("Continue it or discard it").
- **Settings › Templates**: format `Badge` (Wizard / Classic), description; Create and
  Duplicate open the wizard editor; legacy rows keep the 018 editor; archive/restore errors
  mapped (`last_template`, `template_superseded`).
- **Wizard template editor** (`TemplateEditorPage`, wizard branch): name, language,
  description, uses; the text (monospace textarea, soft-wrapped, with a `Line n, col m` status
  line instead of a line-number gutter — DD-37); beside it the outline from
  `outline(ast, null)` (steps → sections → items nested under blocks, kind, "optional",
  "derived", "Fills: …" — AC-8.2, DD-33) and the problems list with line numbers, select →
  caret to the line (AC-8.3); Save `aria-disabled` while there are errors; save with If-Match;
  a second **view** "Try the wizard" (`Tabs`, design D-2 — supersedes DD-25's full-screen
  dialog, DD-37) runs the wizard on the **unsaved** text with `sampleContext(language)` and
  `sampleAnswers`, with no draft and no API write (AC-8.5). The problems list has an en/it
  message for every `ProblemCode`, `declaration_invalid` included (DD-40).

- **Owner amendment (US-11, US-12)** — § Amendment (2026-11-15, owner): the letterhead layer and
  the bands above the paper (DD-55, DD-56), one attempt per opening owned by the page (DD-54), the
  address notice (DD-58), the blank-name reason in the existing `generateBlockedReason` chain
  (DD-61), the Try view reading the entity profile (DD-62) and the editor's "supplied by the CRM"
  list (DD-58).
- **Owner amendment OA-3 and security M-4** — § Amendment OA-3: the preview as real A4 pages (one
  flow, a rail of floats, the letterhead behind every page; DD-65…DD-72) replaces DD-55's single A4 box;
  Settings and the wizard gain the `letterhead_unusable` and new upload-reason messages (DD-76).

## Test strategy

Levels: **U** = unit (bun test in crm-api, vitest in crm-ui), **I** = crm-api integration
(test DB, real routes, fake storage), **C** = crm-ui component (vitest + Testing Library),
**E** = Playwright through the shell (`shell/e2e/crm-offer-wizard.spec.ts`). Engine unit tests
run in **both** apps from the same `engine/vectors/*.json` (template + answers + context →
expected `ResolvedOffer`), so the two copies are proven equal in behaviour as well as bytes.

| AC | Level | What proves it |
|---|---|---|
| AC-1.1 | I + C | `GET /offer-templates?formats=wizard` returns description/uses/format; Template step groups by language and shows name, description, uses, legacy group for uncovered languages; generate → `offer.language` = template language |
| AC-1.2 | U + C | `outline()` vectors: items per step in text order, empty step omitted, `sections` per step, `outline(ast, null)` lists items inside off blocks nested under them (DD-33); wizard shows only non-empty tabs |
| AC-1.3 | U + C | `parseTemplate` reads label/hint/kind/default/example; optional detection vectors (`optional`, `derived`, `fills` in the outline item); field renders the visible "optional" tag (DD-36) and never appears in `missing`; an `amount` field renders `MoneyInput` in the deal currency |
| AC-1.4 | U + C | defaults from declarations; switch renders label+explain at default; choice renders a radio group with exactly one selected, `default` honoured |
| AC-1.5 | U | field only inside an off block: not in outline, not missing; turning the block on makes it missing |
| AC-1.6 | C | fill step 2, jump to 4, back to 2 via tab and via Back: values intact |
| AC-1.7 | U + C | list/table reorder → resolved order; empty item/row not printed; editors add/remove/move |
| AC-1.8 | U + I + C | `options` parsed (≤ 20); the field renders a select of exactly those; `resolveOffer` reports a stored value outside them as invalid `not_an_option`; `PUT` with such a value and a current `templateVersion` → 422 `answers_invalid` `{ path: "fields.<NAME>" }`, with a stale `templateVersion` → accepted and the generate → 409 `template_changed` (DD-38) |
| AC-1.9 | U + C | `fills` vectors: choosing an option / switching a block on sets each filled field; the person's later edit stands; O3 (decisions.md): switching off or choosing another option keeps the current values and overwrites only the new option's fills; the outline's `fills` drives the "Fills: …" hint |
| AC-2.1 | I + C | context returns 018 client lines per language, contacts, place; Client step edits them and the preview follows |
| AC-2.2 | U + I | `source: reference` renders the pending marker in the preview; generated snapshot/PDF carry `0001/<year>` then `r1` (018 numbering reused) |
| AC-2.3 | I + U | `POST offer-draft` prefill equals 018 `buildDraft` values for the same deal (epics, phases, timeline, manDays incl. AI, deal amount, per-release split + remainder) — shared fixture with `draft.test.ts`; prefilled values editable (C) |
| AC-2.4 | I + C | no ready estimate and no override: `POST offer-draft` and generate → 409 `estimate_not_ready`; override → allowed with empty scope; Template step banner + disabled cards |
| AC-2.5 | U + I | `format.ts`/`costs.ts` vectors in CHF and EUR; generate on an EUR deal of welld_ch: every amount and `[VALUTA]` print EUR |
| AC-3.1 | C | fake timers: change → preview updated ≤ 1 s; narrow viewport shows the Drawer trigger. *OA-3:* C — a settled change re-lays the pages in the same commit (injected layout: the layout version changes with the resolution, never later); E — change → pages re-laid within 1 s (pages spec) |
| AC-3.2 | I + U | **parity**: for each of the seven seeds with `sampleAnswers` + a fixed context, the renderer's draw log (test hook recording every string drawn, in order) equals `documentText(resolveOffer(…), numberOffer(…), computeCosts(…))` after whitespace/line-wrap normalisation — section and sub-heading numbers, annex letters, cost positions, span totals and document words included (DD-29); `vectors/numbering.json` vectors pass in both apps; a renderer grep test finds no numbering arithmetic left in `contractPdf.ts`; shared-copy check green. *Changed AC (owner):* C — the letterhead `<img>` and every band are chrome (`aria-hidden` / `data-chrome`), absent from the preview's document text, which is identical with the letterhead `shown`, `none` and `failed`; the parity test is unchanged (the letterhead is not content). *Changed again (OA-3):* C — the page layer, the images and the rail carry no text (`aria-hidden`, empty), so the flow's `textContent` is identical paged and unpaged and with the letterhead `shown`, `none` and `failed`; the breaks' approximation under AC-11.11 is proven by the AC-11.11 rows; the parity test is unchanged (breaks, frame and letterhead are not content) |
| AC-3.3 | U + C | missing marker emitted with the label; preview renders the highlighted run |
| AC-3.4 | C | Preview list → selecting an item switches step and focuses the input (field, cost-line row, section Edit text — by `name`, DD-32) |
| AC-3.5 | C + I | Generate `aria-disabled` with both counts; for a draft with a missing field, an invalid percentage, an over-span discount and an over-long hand edit, API 422 `offer_incomplete` `missing`/`invalid` deep-equal `resolveOffer(...)` of the same draft in crm-ui's copy (DD-32); no offer row, no object, draft kept |
| AC-3.6 | U + C | `invalid` vectors: derived `SALDO` < 0 → `out_of_range`, fractional `qty` → `not_integer`, date out of range, a printed date 91 days from `context.today` → `client:date` `date_out_of_range` (90 days → none; DD-42), cost codes with `name` `cost:<key>`/`cost:*` and template labels (never values); a derived field is never in `missing`; selecting an invalid item focuses it |
| AC-4.1 | U + I | `vectors/costs.spans.json` (DD-34): amount and percent discounts, one rounding, `7'000`; a single span of one-off lines gives `OfferCosts` equal to the legacy `computeCosts` on the same input (018 fixture); renderer prints the rows and totals |
| AC-4.2 | U + C | a line with `unit=[TARIFFA]`/`qty=[GG]`: editing the field changes the line and vice versa (one answer) |
| AC-4.3 | C + I | add/remove extra lines; the 11th line → UI blocks, API 422 `too_many_cost_lines` |
| AC-4.4 | U | a line inside an off block is neither in rows nor in totals/price |
| AC-4.5 | U + C | `compute` vectors (SALDO, RATE off ⇒ 0, empty input ⇒ empty, never missing, negative ⇒ `invalid`); input read-only |
| AC-4.6 | U + I + C | `costs.spans.json`: **the AC's example** (one-off 1 000.00, yearly 500.00, total "TOTALE primo anno", yearly 200.00, discount 50.00, total "TOTALE successivo") → rows 1 500.00 and 150.00, `oneOffCents` 95 000, `yearlyCents` 70 000; **placement invariance** (the AC's last sentence): the same lines with the total rows moved give the same `oneOffCents`/`yearlyCents`; a percentage with ≤ 1 total row → base = the whole one-off sum, equal to the legacy 018 `computeCosts` (1 000.00 + 500.00, 10 % → 1 350.00); a percentage with ≥ 2 total rows → `percent_discount_multi_total` at the discount (template line and extra line), `oneOffCents` null (DD-39); per-span C5 (`discounts_exceed_span`) and document C6 (`discounts_exceed_one_off`) each failing alone; `discount_without_base`; empty span → `null`/"–", not an error; incomplete span skips its checks. Syntax: `unit=10%` with two `@@total` → problem `percent_discount_multi_total` on its line. I: generated `deal_offer.priceCents` = `oneOffCents` and the PDF prints each label and figure; a draft whose extra line is a percentage discount in a two-total table → 422 `offer_incomplete` with `invalid` `{ name: "cost:extra:<id>", code: "percent_discount_multi_total" }`, no offer; `POST /offer-templates` with a `10%` in a two-total table → 422 `template_invalid` + the problem. C: in a table with ≥ 2 total rows the discount input (template `?` line and an added discount line) offers an amount only |
| AC-4.7 | U + I | an `option` line after the last total: numbered (position after the counted lines, discounts unnumbered), priced, absent from every span total, `oneOffCents`, `yearlyCents` and `priceCents`; counts toward the 10-line cap; renderer prints "□" and the position; a counted line after the last total is the template error `cost_line_after_last_total` (DD-35) |
| AC-5.1 | C + U + I | `resolveSectionForEdit` vectors: answers escaped, missing values as "⟦Label⟧", `tokens` listed, an existing hand edit returned unchanged; `source: reference` in a body → "⟪REF⟫", absent from `tokens` (incl. inside `**…**` and a table cell, the T3 SLA shapes), in a heading → "⟦Label⟧" (DD-52); `findTokens`: "⟪REF⟫" in a body no entry, "⟪ref⟫", a lone "⟪", "⟪⟪REF⟫⟫" (two strays) and any "⟪REF⟫" in a heading are entries; "Edit text" opens that text with the warning; Save refused (field error + caret on the token) while "⟦"/"⟧" or a stray "⟪"/"⟫" remains, even for a field filled since, and allowed with "⟪REF⟫" in the body; `checkAnswers`/`PUT`: "⟦" in a hand edit, "⟪"/"⟫" in a field, a heading, or a body other than as an exact token → 422 `answers_invalid` with the path; "⟪REF⟫" in a hand edit's or orphaned edit's body → accepted (DD-30, DD-52) |
| AC-5.2 | U + C + I | with a hand edit, changing a field it uses leaves the section unchanged; badge in preview and steps; notice on the field names the section. DD-52 vectors: a hand-edited body with "⟪REF⟫" resolves without `reference` to the pending marker (label of the first `source: reference` field, else "REF") and adds nothing to `missing`; with `{ reference: "0007/2026" }` to the reference, escaped for its place (line start, table cell, bold run), every occurrence filled (two tokens → twice), also in a section whose template never used the reference and in a template with no `source: reference` field; `mode: "tokens"` keeps the token; a preceding "\" does not escape it; the resolved output never contains "⟪" or "⟫". I (generate): a T3 draft whose "Parametri del servizio" and "Condizioni generali" are hand-edited from `resolveSectionForEdit` → 201 and the snapshot text carries the assigned reference in both, a revision carries its `rN` reference |
| AC-5.3 | C | Restore asks for confirmation naming the section, then the wizard text returns |
| AC-5.4 | U + I | heading > 120 / body > 20 000 refused in the dialog; at generate they are `invalid` `heading_too_long`/`section_too_long` with `name: "section:<key>"` inside 422 `offer_incomplete` (DD-32) |
| AC-6.1 | C + I + E | hook saves after the debounce with If-Match; `PUT`/`GET` round trip; a `PUT` deep-equal to the stored draft → 200, same `version`, no write; clicking through every step with no edit issues **no** `PUT` and the next content save carries the current `lastStep` (DD-31); E: fill, reload, reopen on another context → identical answers and the step of the last edit |
| AC-6.2 | I + C | matrix: manage+financials in scope → 200; financials without manage, manage without financials, out of scope → 403 with the same body whether a draft exists or not; `GET /deals/{id}` and offers list contain no draft data; card hidden without financials |
| AC-6.3 | I + C + E | stale If-Match → 409, the other person's version intact; 428 without header; banner; E: two browser contexts — and one only navigating steps while the other saves gets no 409 (DD-31) |
| AC-6.4 | C + I | `GET /offer-draft/summary`: `{ draft: null }` without a draft; with one, template/target/`updatedBy`/`updatedAt`/`version`/`templateChanged` and no `answers` member (response bytes contain no answer value), `ETag` = `version`, `no-store`; same 403 body with or without a draft for financials-without-manage and out of scope (DD-27); draft row with author/time, Continue, Discard with confirmation, `DELETE` with the summary's version; stale Discard → 409 → refetch |
| AC-6.5 | U + I + C | `switchTemplate` keeps client lines/contacts and replaces the rest; confirmation shown |
| AC-6.6 | I | generate deletes the draft in the same transaction (a forced render failure keeps the draft and leaves no object); snapshot has `wizard.answers`; `POST offer-draft` from that offer reproduces them |
| AC-6.7 | C | static scan of `src/**/offerWizard*` and `lib/offerEngine/**` for `localStorage`, `sessionStorage`, `indexedDB`; runtime spies on `Storage.prototype` stay unused through a full wizard run |
| AC-7.1 | I | `POST offer-draft { target: { kind: "edit", offerId } }` **without `templateId`** on a wizard offer → the snapshot's template and reconciled answers, hand edits included (DD-28); with the snapshot's template archived → 409 `template_archived` `{ templateId }`; with another `templateId` → client lines/contacts/place/date kept, rest initial; edit draft → same reference, version+1, old PDF replaced; offer marked sent meanwhile → 409 `offer_sent`; stale offer version → 409 `offer_changed` |
| AC-7.2 | I | revision draft of a sent wizard offer without `templateId` → snapshot answers; generate → next `rN`, sent offer row and object untouched |
| AC-7.3 | I + C | legacy contract offer, no wizard template for its (entity, language): `/form` + legacy PUT work as before; with one: `POST offer-draft { target: edit, templateId }` prefills its client lines and contacts; without `templateId` → 422 `template_required`; UI picks the path from `origin` |
| AC-8.1 | I + C | wizard create/duplicate/edit/archive with gate (`out_of_scope` 403), If-Match (428/409), description/uses; editor form |
| AC-8.2 | U + C | `outline(ast, null)` vectors (every step → its sections → items, nested under blocks, `optional`/`derived`/`fills`, cost lines and total labels — DD-33); editor outline updates on text change |
| AC-8.3 | U + I + C | one vector per problem (unclosed `{{`/`@@OPT_START`, undeclared field, missing label, choice < 2, no costs section, each `declaration_invalid` cause — DD-40) with the right line; API 422 `template_invalid` + `problems`; Save disabled, list shown |
| AC-8.4 | I + U + C | template edited after an offer: offer snapshot and PDF unchanged; `reconcileAnswers` keeps existing names, drops others; draft opens with the notice; generate with stale version → 409 `template_changed` |
| AC-8.5 | C | editor "Preview in wizard" runs on unsaved text with sample answers; no draft request issued. *Changed AC (owner):* a request spy over a whole Try-view session sees only `GET /entity-profiles`, `GET /entity-profiles/{entity}/letterhead` and the bucket GET — no context, draft or template request (DD-62) |
| AC-9.1 | I + U | welld_ch listing seeds exactly seven active Italian wizard templates once (concurrent first reads); names/descriptions/uses as the mockup; each parses with zero errors; **fidelity**: printed text of each seed with fixed answers equals the committed golden text produced once from the mockup in a browser, modulo the documented deviations (DD-1, DD-5, DD-24); the golden answers (mockup state) are mapped to `WizardAnswers` through the catalog's renames (`rows.MODULO[].ORE` → `ORE_MODULO`, DD-48), main files and `variants/` alike |
| AC-9.2 | I | first wizard template of (entity, language) archives that language's legacy templates in the same transaction, not other languages, not before; legacy restore → 409 `template_superseded`; archiving the last → 409 `last_template`; welld_ch EN legacy still generates through the dialog |
| AC-9.3 | I + U | welld_it English wizard template created through the API, EUR deal, generated end to end — no code path is entity/language/currency specific (engine purity test, comments excluded: no `welld_` literal; a `"CHF"`/`"EUR"` value literal only in the two allowed places — `format.ts`'s per-currency separators and `sampleContext`'s fixed currency — DD-50) |
| AC-9.4 | I | migration leaves `deal_offer` untouched; an 018-summary offer and a legacy contract offer list, download and (legacy) edit as before; legacy renderer golden tests unchanged — after numbering and document words move to the engine (DD-29) |
| AC-9.5 | U + I | `numberOffer` vectors: text annex "A" → effort-detail annex "B", deal PDFs "C", "D"; text annex "SLA" → effort "A"; two text annexes in template order before the effort annex; index only with the effort annex, then listing the text annexes; annex sections numbered within the annex; I: the renderer's draw log prints the same headings ("ALLEGATO A – …") and "Allegati:" lines, each text annex from a new page |
| AC-9.6 | I | the AC-9.1 golden fidelity test: each seed's printed text with fixed answers equals the mockup's golden text except exactly the listed differences (header/acceptance/"Allegati:" drawn by the CRM, renderer section numbers, 018 annex heading style, T5 annex picker, deal currency for literal "CHF", no width hints) — the test's allow-list of normalisations is that list and nothing else. *Changed AC (owner), DD-63:* run with the profile `WellD Sagl` / `Via Pessina 9`·`CP 1920`·`CH-6901 Lugano` → equal to the golden with the old list only (the bindings sit exactly where the literals were); run with `wellD SA` / `Via Example 1`·`6900 Lugano` → equal after exactly the two new substitutions, with pinned counts per seed |
| AC-10.1 | C | `catalogGaps` parity for all new keys; `noHardcodedStrings` covers the new components; engine never translates template text (vector: Italian template, English UI → Italian document) |
| AC-11.1 | U + C + E | *Rewritten for OA-3 (DD-65, DD-71).* C (`DocumentPreview.letterhead.test.tsx`, layout injected: 3 pages): with `shown`, each of the 3 page boxes in the `aria-hidden` + `inert` page layer holds exactly one `<img alt="" aria-hidden="true" draggable="false">` with the SAME `blob:` src, and the page layer precedes the flow in DOM order; the flow's `textContent`, its `⟦Label⟧` runs and "Edited by hand" marks are identical with `shown` and `none`, and paged vs unpaged; the elements pagination adds are the rail's empty `aria-hidden` divs only (no heading, list, table, landmark); axe clean, no image in the accessibility tree. E (`crm-offer-wizard.spec.ts`, letterhead journey reworked): every page's image visible with `naturalWidth > 0`; a paragraph found by `getByText` and selectable |
| AC-11.2 | U + C + E | U (`geometry.test.ts`): `height = width × 297 / 210`, gap 16, at 488, 576, 794 and 1 200 px available. C: `shown` → the AC-11.2 caption exactly (en, it) and none of the other bands; images = pages. E: each page box's height / width = 297 / 210 ± 1 %; every gap between consecutive boxes ≥ 16 px; a long draft → ≥ 3 pages, one image per page; a one-line draft → one page |
| AC-11.3 | I + C + E | I: context `letterhead: false` without `letterheadKey`, `true` with one; no profile → 409 `entity_profile_missing`. C: `none` → no image, no link request, no bucket fetch, the "No letterhead is set for {legal name}…" band (en, it) followed by the new note (DD-72); the pages and the layout object are identical to `shown`'s for the same content and width. E (pages spec, the `none` profile simulated by intercepting the context response): A4 boxes with the frame, no image |
| AC-11.4 | C + I + E | C (`useLetterhead.test.ts`, as before): link 403/404/500/**409 `letterhead_unusable`**, bucket non-2xx / network error / > 5 MiB / not `%PDF-`, renderer throw → `failed`; 10 000 ms → `failed`; while pending, today's sentence + the new note; text renders and updates before anything settles; no alert or toast; counts, autosave and Generate as in a `none` run; no retry; remount → one new attempt. C (paged): the layout version does not change on `pending → shown` or `pending → failed`. I: a stored letterhead failing `checkLetterhead` → 409 on the link route (§ M-4 rows). E: the bucket URL aborted, and the link answering 409 → the failure band, pages with frames and no image, Generate enabled on a complete draft |
| AC-11.5 | C + E | C: class scan of page boxes and images — no `invert`, `brightness`, `opacity`, `mix-blend`, `grayscale` or `dark:`; page colours `paper-*` only; the stage `bg-ink-mid`. E (dark and light): every page's computed background equal across themes; every image `filter: none`, `opacity: 1`; the gap's computed colour differs between themes and from the paper; each page's border colour differs from the gap's |
| AC-11.6 | C | narrow viewport: the Drawer's preview renders pages at the Drawer's width (injected geometry), every image the same `src` as the pane's; close, reopen, widen until the pane takes over → link requested once, bucket fetched once, `renderLetterhead` called once in total |
| AC-11.7 | I + C + U + E | I: `GET /entity-profiles/{e}/letterhead` → `Cache-Control: no-store`, 403 without `deal:financials`. C: the bucket `fetch` is called with `cache: "no-store"`, `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "error"` and without an `Authorization` header; no `Storage.prototype` write, no `caches` use, no console call whose arguments contain the link (spies); no draft `PUT` body contains the link or `letterhead`. U (static, crm-ui): `renderLetterhead.ts` is the only file importing `pdfjs-dist`, passes `isEvalSupported: false`, and no file under `src/` contains `new Worker`, `workerSrc`, `wasmUrl`, `standardFontDataUrl` or `cMapUrl`; `shell/vercel.json` and `crm-ui/vercel.json` CSP strings unchanged (pinned copies). E: the request log of a wizard opening with a letterhead holds only the shell, crm-ui, crm-api, auth and the bucket origins. CSP violations: the L0 spike on a Vercel preview (recorded in decisions.md; the dev shell sends no CSP). *M-4:* the guard test also pins pdf.js `maxImageSize: 40_000_000` (DD-77) |
| AC-11.8 | C + I + E | C: 20 typed changes, list add/remove, step changes and a template switch, with the injected layout going 1 → 5 → 2 pages → one link request, one bucket fetch, one render, and every page image carries the same `src` throughout; a second opening → a second attempt. I: as before (the PDF embeds the letterhead read at generation, an earlier offer keeps its bytes). E: after an edit adds a page, in the first frame after the layout version changes every page image is `complete` with `naturalWidth > 0`, and no request to the link route or the bucket is made |
| AC-11.9 | C + E | C: edit and revision drafts draw pages and bands like `new`; `TryWizardView` draws the template's entity's letterhead on every page; `GET /entity-profiles` 403/500 → the failure band, no error banner, the Try view works. E: the revise journey sees an image on every page |
| AC-11.10 | U + C + E | U: `pageGeometry` frame = 120 / 110 / 71 / 71 × `width / 595.28` from the shared `FRAME` (the `offerPaper` shared copy, DD-67); `realize` vectors: every line's final top ≥ its page's frame top, its bottom ≤ the frame bottom. C: the flow invariant — a class scan of every element inside the flow finds no `overflow-*` other than visible, no `flex`, `grid`, `flow-root`, `inline-block`, `overflow-x-auto`, and no border or background class except on a hand-edited section and table cells. E (pages spec, at 1280, 1440 and in the Drawer at 1024): for every text node's line rects (`Range.getClientRects()`) and every table cell rect, the rect lies inside its page's frame rect (± 1 px) and never in a margin or a gap; a pixel sampled in each gap and margin row beside a hand-edited section and a split table is the gap's or the paper's colour; a fixture with a 120-character word and an 8-column table: the flow's `scrollWidth` equals its `clientWidth` |
| AC-11.11 | U + E | U (`placement.test.ts`): a vector per rule R1–R8 (2-, 3-, 5-line blocks; heading + text / table / unit / heading chains; header + first row; acceptance whole; forced annex page with and without the cursor at a page start; an over-tall paragraph; an over-tall row split at a line; a list item's marker) and 2 000 seeded random documents checking the invariants (order kept, each line once, ≥ 1 line per page, ≥ 1 page, a page over `B` only with `relaxed` set, legal breaks only unless `relaxed`, termination). E (pages spec, the seeded T1+T3 draft with sample answers and a hand-edited long section): the lines read page by page equal the unpaged reading order; every split block has ≥ 2 lines on each side; each heading's page holds the first line of what follows it; no row rect crosses a page; the acceptance block lies on one page; each text annex's and the effort annex's heading sits at its page's frame top (± 1 px); an empty draft → one page; no page without a line; after a change the pages are re-laid within 1 s (layout version timestamps) and an image is on every page at every sampled frame |
| AC-11.12 | C + E | C: the region is the only element with a `tabIndex`; nothing in the page layer or the rail is focusable; page layer `aria-hidden` + `inert`, rail `aria-hidden` and empty; no element with a role, heading, list or live region added per page; no page number. E: a sentence of the fixture paragraph that the layout splits (asserted: its first and last characters are on two pages) — `window.find(sentence)` is true; a `Range` from its first to its last character → `selection.toString() === sentence`; selecting the whole flow paged and unpaged gives the same string; axe on the paged region clean; one Tab from the region leaves it |
| AC-11.13 | U + E | U: for every available width from 120 to 1 600 px and root font 16 and 32 px, every type size ≥ `max(12, 0.75 × root)` and `width ≤ available − 2·inset`; root 12 px → still ≥ 12. E: 320 × 640 viewport, Drawer: region `scrollWidth ≤ clientWidth`, the smallest computed font size in the flow ≥ 12 px, the AC-11.10 frame check holds; 640 × 450 (the CSS-px layout of 1280 × 900 at 200 % zoom): the AC-11.10/11.11 checks hold and the page count is greater than at 1280; root font 32 px (`document.documentElement.style.fontSize`): every text ≥ 24 px, the checks hold; light and dark |
| AC-12.1 | U + C | U: `source: issuer` with no `label:` parses; never an `outline()` item in either mode; `suppliedFields(ast)` lists it in order of first use, a declared-but-unused one excluded; used in the opening, a section, a text annex and a cost description it resolves to the name (vectors, both copies). C: the editor outline shows it under "Supplied by the CRM" with its source's label; the wizard shows no input for it |
| AC-12.2 | U + I | U (resolve vectors, both copies): a name `a\|b *c* [d] _e_ \f {g}` prints literally in a paragraph, a bold run, a list item, a table cell (the row keeps its column count), a heading (plain, unparsed) and a cost description (stripped); a line break inside the name prints as one space; a non-WinAnsi character prints "?"; U+E000…U+E003, "⟦", "⟪REF⟫" in the name print "?" (no marker, no token, nothing in `missing`). I: after create and `PUT`, the draft's `answers` JSON never contains the legal name; a profile change does not touch the template row (`source`, `version`); for one draft and context, crm-ui's `resolveOffer` and the generated snapshot carry the same text with a hostile name |
| AC-12.3 | U + I | U: none of the seven seed texts contains "WellD Sagl"; each declares `EMITTENTE` `source: issuer`; «WellD» still present in T3 and T1+T3. I: the AC-9.6 fidelity run with `wellD SA` (DD-63) — counts of "wellD SA" per seed 2/2/5/2/2/2/5 (T1, T2, T3, T4, T5, T6, T1+T3), no "WellD Sagl" left |
| AC-12.4 | I | generate with name A, change the profile to B: the old offer's snapshot and PDF bytes unchanged; an edit draft of that unsent offer generates with B; a revision of a sent offer prints B and leaves the sent one unchanged; a section hand-edited while A was current still prints A after the change to B |
| AC-12.5 | I | `offerTemplates.seedUpgrade.test.ts`: a database with the seven v1 rows (key `welld-ch-it-v1:<code>`, text = `toV1(v2)` whose SHA-256 is in `V1_DIGESTS`), some archived, and a draft on one → the first `GET /offer-templates?formats=wizard` leaves each row with the v2 text, key `welld-ch-it-v2:<code>`, `version + 1`, `updatedBy` `system:crm-api`, `archivedAt` unchanged; row count unchanged, no row created or removed; the draft's summary says `templateChanged`, its answers kept after reconcile; a generated offer's snapshot unchanged; `formats=sections` never upgrades |
| AC-12.6 | I | a v1 row with an edited text → text, version and `updatedAt` unchanged, key moved to `welld-ch-it-v1-kept:<code>`; a template that took a seed's name (seed skipped) and a duplicate of a v1 seed (`seedKey` null) untouched; a second listing and a "restart" (fresh module state) write nothing; an edit after the upgrade survives later listings; a kept row edited back to the exact v1 text is still not upgraded; a template `PUT` racing the upgrade (two connections) → no lost update (the person's write wins or gets 409 on a stale `If-Match`) |
| AC-12.7 | U + C + I | U: blank and spaces-only `issuerLegalName` print "" and add nothing to `missing`/`invalid`. C: `issuerLegalName: "  "` → Generate `aria-disabled` with "Set the legal name of {entity label} in CRM Settings" (en/it), counts unchanged, bands name the entity label. I: profile damaged by raw SQL (`legalName = '  '`) → context 200 (the wizard opens), draft generate → 409 `entity_profile_missing`, no offer row, no object, draft kept; no profile → context 409 as today |
| AC-12.8 | U + C | U: `sampleContext` holds no "WellD"/"wellD" (purity test forbids `/welld/i` in engine code, comments stripped). C: Try view with a readable profile → the issuer field prints the profile's legal name; profiles unreadable or name blank → `sampleContext`'s name and the "samples" note; the view works |
| AC-12.9 | U + I | U: `source: issuerAddress` parses (unknown sources still `source_unknown`); not an item; in `suppliedFields`; value = lines in order, each trimmed, blank ones skipped, joined ", ", inner line breaks as one space; escaped like AC-12.2 in a table cell. I: the address is never in draft answers; an offer generated before an address change keeps it; an edit/revision prints the new one |
| AC-12.10 | U + I | U: T3 and T1+T3 contain no "Via Pessina 9, CP 1920, CH-6901 Lugano" and their Fornitore row reads `[EMITTENTE]{{?INDIRIZZO_EMITTENTE::, [INDIRIZZO_EMITTENTE]}}`. I: with `wellD SA` / `Via Example 1`·`6900 Lugano` the cell reads "wellD SA, Via Example 1, 6900 Lugano"; counts of "Lugano" in jurisdiction clauses and the place of issue unchanged (DD-63) |
| AC-12.11 | I | the AC-12.5 test over T3 and T1+T3 v1 texts carrying the literal address: one write per row (`version` + 1 once, not twice — name and address are one update) |
| AC-12.12 | U + C + I | U: address lines `[]` or `["  "]` → the T3 cell reads exactly "wellD SA" (no trailing ", "); an unconditional `[INDIRIZZO_EMITTENTE]` prints "" and adds nothing to `missing`; `systemRead` contains `issuerAddress` when the parties table prints and not when its annex/block is off or its section is hand-edited. C: the notice (en/it, `{entity}` = legal name) iff `systemRead` ∋ `issuerAddress` and the address is empty; Generate stays enabled. I: draft generate with no address → 201 |
| AC-12.13 | C | Try view: readable profile → its address in the cell; readable with no address → the AC-12.12 notice; unreadable → `sampleContext`'s address and the "samples" note |

Also: `matrix.test.ts` covers every new route; a parser fuzz test (random/huge/deeply nested
inputs complete in < 200 ms and return problems, never throw); markup escape vectors including
legacy texts.

**After OA-3 the mapping is total over 79 ACs** (75 + AC-11.10…11.13, checked against the spec's AC list on
2026-11-15): AC-3.1 and AC-3.2 carry OA-3 notes, the AC-11.1…11.6, 11.8 and 11.9 rows are rewritten for pages,
AC-11.10…11.13 are new. New test file kinds: pure pagination vectors in crm-ui (`paper/*.test.ts`) and the pages
e2e (`shell/e2e/crm-offer-wizard-pages.spec.ts`); everything that needs real line boxes is e2e (jsdom has no
layout, DD-73). No AC is unmappable; AC-11.11 is mapped under the readings of DD-79 (O12, O13).

**Security M-4 (not an AC; DD-74…DD-78).** U (`pdfBounds.test.ts`, fixtures built in the test, no committed
bomb): a Flate bomb in a page content stream (direct `/Length`) → `decoded_too_large`; the same bomb inside an
object stream → refused with `PDFDocument.load` never called (spy); an indirect `/Length` and a forged `endstream`
inside the data → still counted; `[/FlateDecode /FlateDecode]`; `[/ASCII85Decode /FlateDecode]`; an LZW bomb; a
RunLength bomb; a DCT image declaring 30 000 × 30 000 (dictionary) and one whose SOF is larger than its
dictionary → `image_too_large`; a codec image without `/Width` → `unbounded_stream`; 10 001 objects and 1 001
streams → `too_complex`; a truncated and a checksum-broken Flate stream under the caps → ok; the committed
`letterhead-a4.pdf` fixture and a pdf-lib-made letterhead with a logo image → ok, figures recorded; each refusal
in < 2 s with RSS growth < 128 MiB under Bun. I (`entityProfiles.letterhead.test.ts`): confirm with a bomb → 422
`letterhead_invalid` with the reason, upload object deleted, profile unchanged; confirm ok → the stored key differs
from the upload key, the stored bytes equal the checked bytes, the upload key is deleted, and a later write to the
upload key changes nothing stored; a bomb written straight under a stored key → link route 409
`letterhead_unusable` `{ entity, reason }`, nothing minted, `no-store`; two link calls → one `getObject` (memo);
wizard and legacy generate with that stored key → 409 before any render, no offer row, no object, the draft kept;
`matrix.test.ts` rows for the new 409s; the audit script on fake storage prints one line per profile and writes
nothing. C: `LetterheadCard` maps the four new reasons and the 409 (en, it); `offerFailure` maps the 409
(wizard and legacy dialog alike).

**After the owner amendment the mapping is total over 75 ACs** (53 + AC-11.1…11.9 + AC-12.1…12.13,
checked against the spec's AC list on 2026-11-15; AC-3.2, AC-8.5 and AC-9.6 carry their changed
rows). New level for US-11: the **E** rows run in Chromium through the shell; the CSP itself is
proven by the L0 spike on a Vercel preview, because the dev shell sends no CSP (R21).

The mapping is total: every AC of the spec — 53 after SA-1…SA-4, checked against the spec's
AC list on 2026-11-15 — has at least one test. (Before this amendment the table had 46 rows:
AC-1.8, 1.9, 3.6, 4.6, 4.7, 9.5 and 9.6, added to the spec by SA-1…SA-4, were unmapped. They
are mapped above.) No AC is unmappable.

## Risks

| # | Risk | Mitigation / early check |
|---|---|---|
| R1 | **Size** — engine, schema, two routers, renderer, a wizard, an editor, seven conversions | Batches, each green on its own: (1) engine + vectors in both apps; (2) migration, template routes, supersession, seeds; (3) draft routes + generation; (4) renderer extensions + parity test; (5) wizard UI; (6) editor UI + e2e. Batch 1 first: it is the riskiest and blocks the rest. |
| R2 | **Seed conversion fidelity** — 135 KB of contract text converted by hand | Golden texts produced once from the mockup in a browser (fixtures only, the mockup is not imported); zero-error parse test; the owner reviews the seven sample PDFs before release. |
| R3 | Engine copies drift | `check-shared-copies.ts` groups + workflow path filter extended (today it does not watch most copies); vectors run in both test suites. |
| R4 | **Deploy order** — crm-api (Railway) and crm-ui (Vercel) ship separately | crm-api first: the default `formats=sections` keeps the live UI on legacy templates and **does not seed**, so nothing is archived until the new crm-ui asks for wizard templates. A new crm-ui against an old crm-api gets 404s and shows `StatePanel` errors; never ship the UI first. |
| R5 | The owner refuses a proposed amendment (cost spans, `option`, `amount`, relaxed one-off rule) | Then T3/T6/T13 cannot print the mockup's totals: fallback is `showTotals` off for those three and `voce_scelta` dropped from T1 (the only seed with an option line, DD-49); engine code is unaffected except the removed kind. Ask before `/wellforge:tasks`. |
| R6 | Concurrent co-editing loses up to ~1 s of typing on a conflict | Accepted by AC-6.3 ("told to reload"); the banner says so. |
| R7 | The estimate changes between preview and generation (Annex A, prefills) | Same as 018: prefills are answers (stable); Annex A is recomputed at generation from the live estimate; documented. |
| R8 | Parser/resolver DoS through template or answers | Linear single-pass tokenizer (no backtracking regexes), nesting ≤ 8, template ≤ 150 000 chars, answers ≤ 512 KiB, fuzz test. |
| R9 | Non-developers write broken templates | Problems with line numbers, outline, preview with sample answers, Save blocked on errors. |
| R10 | Literal cross-references ("par. 4.3", "voci 1 e 2") go stale when an optional heading or line drops | Warning `optional_heading_not_last`; none of the seven references a droppable heading (checked); author's responsibility otherwise. |
| R11 | Supersession has no UI undo | Rollback = runbook SQL (restore legacy, archive wizard rows) in `infra/README.md`; refused through the API on purpose. |
| R12 | T6's monthly fee is a `yearly` line, so the offers list says "per year" | Documented; a `monthly` kind is a later, separate change (018 D-6). |
| R13 | `markup.ts` escapes change how a backslash prints in legacy texts | Before deploy: count templates/offer snapshots containing `\` followed by a markup char; legacy offers are never re-rendered unless edited. |
| R14 | Snapshot growth (answers + resolved texts, ~100 KB for T13) | Acceptable (JSONB); no listing reads the snapshot body beyond what it does today. |
| R15 | WinAnsi: authors paste characters the PDF cannot print | The preview shows the same "?" and the editor warns with the line. |
| R16 | A hand-edited section cannot carry the offer reference: the reference exists only at generation, so the edit text shows it as a token that must be replaced (DD-30) | **Closed by DD-52** (decisions.md "Orchestrator · R16", 2026-11-15): the trigger fired with the seeds as built (T3 and T1+T3 print `[RIF]` in two hand-editable SLA annex sections — "Parametri del servizio", a table cell, and "Condizioni generali", a list item inside `**…**`). The hand-edit text now carries the reference token "⟪REF⟫", filled at generation; built by T12b before T13 mirrors the engine, so it is not drift. Residual: a reference in a section HEADING still yields a blocking "⟦Label⟧" (no seed has one). |
| R17 | A discount in a yearly-only span lowers the **stored one-off price** (AC-4.6: price "computed as in 018" = Σ one-off − Σ every discount) while printed under a yearly total | Spec-mandated and pinned by the AC-4.6 vector; each of the mockup's four discount rows sits directly above a single plain "TOTALE" (checked in the mockup HTML), so no seed has a discount in a yearly span. Flagged for the owner's review of SA-1. |
| R18 | The engine copies grow by `numbering.ts`, `words.ts` and `edit.ts` | Same shared-copy groups and vectors; the renderer refactor is proven by the unchanged legacy goldens (AC-9.4). |
| R19 | The browser's `today` (from the context route at page load) and the server's at generation differ across a UTC midnight: a default date or the ±90-day edge can differ by one day (DD-41, DD-42) | The server's resolve decides; its 422 `offer_incomplete` replaces the browser's lists (DD-32). A page open across midnight is the only case. |
| R20 | An unknown `@@` word (a misspelt `@@totl`), a `{{…}}` whose head is not a condition and a `@@step` outside a section print as ordinary text with no problem (as built) | The editor's preview and "Try the wizard" show the stray text; a `directive_unknown` warning would be an engine change after T13, i.e. drift (DD-51) — revisit if authors hit it. |
| R21 | **pdf.js main-thread path** — the plan relies on pdf.js using a pre-imported worker module (`globalThis.pdfjsWorker`) instead of constructing a `Worker`, with no eval in the pinned version (5.7.284 removed `isEvalSupported` and contains no `eval`/`new Function`; L0) and no wasm, under the shell's CSP; not yet observed in this suite, and the dev shell sends no CSP | **L0 spike first** (blocks the UI tasks): the pinned version in the shell on a Vercel preview with the production CSP, a `securitypolicyviolation` listener, no `Worker` constructed (spy), both production letterheads rendered. Failure is soft (AC-11.4). Escalation if it cannot work: DD-53 option (a), server rasterisation, which needs the owner (it contradicts AC-11.7's wording). |
| R22 | **CRM bucket CORS without GET** — the letterhead fetch is the CRM's first browser `fetch` of a bucket object (downloads so far are `window.open`); MinIO allows every origin, so dev and e2e cannot catch it | L0 reads the production rule; if GET is absent, a person adds it (`PutBucketCors`, GET beside POST, the shell origin) and `infra/README.md` § crm-api records the rule, as refund's is. Release checklist item. |
| R23 | Main-thread parse + render pauses the page once per opening (one page, ≤ 5 MiB) | Starts after the preview's first paint (async chunk loads first); L0 measures both production letterheads; above 500 ms the render width drops from 1 600 to 1 240 px. *M-4 (DD-74):* the worst case is now bounded server-side — ≤ 32 MiB decoded, ≤ 8 MiB non-image (≈ 75 ms of inflate at the measured 2.3 ms/MiB) — instead of ≈ 5 GiB. |
| R24 | The preview draws a letterhead incompletely — a non-embedded font (`disableFontFace` with no standard-font data) or an image codec pdf.js would run as wasm | Approximation by the owner's choice (AC-3.2 changed, caption AC-11.2); L0 checks the two real letterheads; the PDF is unaffected. |
| R25 | A PDF renderer parsing a file in the person's page (the CVE-2024-4367 class) | Exact pin of a fixed 5.x, no eval in the pinned version (5.7.284 removed `isEvalSupported` and contains no `eval`/`new Function`; L0), no `'unsafe-eval'` in the CSP, canvas output only (no text, annotation or XFA layer), uploaders hold `deal:manage`, the file passed `checkLetterhead`; advisories for `pdfjs-dist` followed like any dependency. |
| R26 | Bundle weight — pdf.js + its worker module are about 0.5 MB gzip | Two lazy chunks, loaded only when an opening's first preview needs an existing letterhead; crm-ui's entry chunk unchanged (L0 records the sizes). |
| R27 | **Seed upgrade digests incomplete** — a dev database seeded with a v1 revision whose digest is not listed keeps the literal name | Safe failure (the row is marked kept and prints what it says); `scripts/seed-digests.ts` walks every revision of each seed file since T24; production never held v1 seeds (the feature is not on `main`, open question O8). |
| R28 | The printed supplier address becomes whatever the profile holds (spec O7) | Before release a person checks each entity's address lines; a profile without an address prints none and the preview says so (AC-12.12). |
| R29 | A parallel frontend fix (QE D14–D18) edits `crm-ui/src/strings/offerWizard.ts` and wizard step components | This amendment does not touch `PreviewStep`, `TemplateStep`, `StepForm`, `CostTableEditor`, `ValidityDaysInput` or the library `Drawer`; the shared strings file is merged key by key (§ Amendment, task hints). |
| R30 | **Float behaviour across engines** — the rail (DD-65) relies on CSS 2.1 float avoidance in Safari and Firefox, and the e2e runs Chromium only | Standard, long-stable CSS; the release checklist adds a manual pass in Safari and Firefox at 1280 and in the Drawer (every line inside its frame, a search across a break, copy across a break); a WebKit Playwright project is the escalation if they differ |
| R31 | The 12 px floor makes the preview show about twice the PDF's pages at the default 1280 layout (O11) | Accepted by spec O8; one constant; O11 gives the owner the measured consequence |
| R32 | **Two layouts per settled change** on a long offer (T1+T3: 30–60 preview pages) | Budget ≤ 100 ms for 30 pages, ≤ 200 ms for 60, measured by the pages e2e (long-task observer); above it, the debounce for documents over 30 pages rises to 500 ms (still ≤ 1 s, AC-3.1) |
| R33 | Breaks drift from the PDF's — DM Sans vs Helvetica widths, the browser's table column widths, the floor | Accepted (AC-3.2, AC-11.11: approximate; the caption says so). Levers, each a follow-up if the owner finds the drift too large: a Helvetica-metric font token in `@operai/ui`; the PDF's column widths moved into the shared engine |
| R34 | **The flow invariant is broken by a later change** — a `flex`, `grid` or `overflow` box inside the paper is pushed below every later float, or a painted block shows in a gap | The C class scan fails on any such class inside the flow; the pages e2e checks every line against its frame |
| R35 | **A production letterhead exceeds the caps** — after the deploy that entity's offers are refused (409) and its preview shows the failed band | DD-78: the audit runs against production before the crm-api deploy and blocks it; the caps are constants set ≥ 4 × the measured figures |
| R36 | Bun's `node:zlib` does not stop a streaming inflate promptly | The bomb tests assert time (< 2 s) and memory (RSS growth < 128 MiB) under Bun, not only the verdict; fallback `DecompressionStream("deflate")` with its reader cancelled at the cap |
| R37 | The verdict memo is per crm-api process | Each replica checks a key at most once (≤ one 5 MiB read + a bounded scan); keys never change (DD-75), so a memo is never stale |

## Security

**Security-sensitive: YES.** The feature handles financial data (prices, discounts) and
personal data (client contacts' names, client addresses), adds user-authored text that is
parsed and rendered in two places, and adds new write routes on a shared record. The
orchestrator should schedule an `owasp-reviewer` pass in parallel with QE (standard tier: no
regulated data beyond what CRM offers already hold).

Surfaces to review:
- **Authorization** — `/deals/{id}/offer-draft` (GET/POST/PUT/DELETE), `/offer-draft/summary`
  (DD-27: same gate, same 403 body with or without a draft, `{ draft: null }` only after the
  gate), `/offer-draft/template`,
  `/offer-draft/generate`, `/deals/{id}/offer-wizard/context`: `deal:financials` +
  `deal:manage` in scope, scope checked before the draft lookup (no existence leak, AC-6.2);
  template writes entity-scoped; cross-entity template id = 404; draft target offer must belong
  to the same deal.
- **Integrity** — If-Match on every draft/template write, generation pinned to the draft version
  and the template version, edit CAS on the offer version; draft deletion in the generating
  transaction.
- **Injection** — answers are escaped before entering markup (a value cannot create headings,
  tables or bold runs in a contract); on plain surfaces (headings, annex titles, cost
  descriptions, total and column labels) values are inserted **unescaped**, so the renderer and
  the preview must draw them as text and never run `parseInline` over them (DD-47 — review
  item for T25, T26, T44, T46); reserved marker characters refused; the preview renders
  React elements only (no `dangerouslySetInnerHTML`); the PDF prints text only; `compute`
  expressions parsed by a closed grammar, never `eval`/`new Function`; `fills` cannot target
  system values; the hand-edit token brackets "⟦" "⟧" are refused in answers and hand edits,
  so a token can never reach a PDF (DD-30); "⟪" "⟫" likewise, except the exact reference token
  "⟪REF⟫" in a hand edit's body, which the resolver replaces with the escaped reference — a
  server-made value, never a person's — before `printable`, and which `printable` would turn into
  "?REF?" if it ever slipped through (DD-52).
- **Resource exhaustion** — template size, nesting depth, answers size and per-collection caps,
  linear parsing, fuzz test; Hono body limit 512 KiB on the draft routes.
- **Data exposure** — context, draft and summary responses `Cache-Control: no-store`; no draft
  content or answers in logs or error bodies (`offer_incomplete` carries names and template
  labels only — an extra cost line's description is a value, so its label is `null`, DD-32);
  `POST offer-draft` without `templateId` reads the snapshot's template id only after the
  target offer is proven to belong to the deal (DD-28); no browser
  storage (AC-6.7); the editor preview uses sample data only.
- **Unchanged and still relied on** — ADR 20261102 bounded attachment read; ADR 20261101
  financial gating of offers and templates.

**Owner amendment (US-11, US-12) — still YES; added review surfaces** (owasp-reviewer, standard
tier; the letterhead is the entity's own document, the address is the company's, no personal data):
- **New byte path** — the browser fetches the letterhead from the CRM bucket through the 60 s
  presigned GET minted after `deal:financials` (`GET /entity-profiles/{entity}/letterhead`, now
  `no-store`); never proxied by crm-api (ADR 20260716); plain `fetch` so the JWT never reaches the
  bucket (`credentials:'omit'`, `referrerPolicy:'no-referrer'`, `redirect:'error'`, `cache:'no-store'`);
  5 MiB streaming cap and `%PDF-` check before parsing; the link and the bytes live in one closure
  and are never logged, stored, put in state that outlives the attempt or in an error message (AC-11.7).
- **New renderer** — `pdfjs-dist` pinned exactly; imported by one module, lazily; no eval in the pinned version (5.7.284 removed `isEvalSupported` and contains no `eval`/`new Function`; L0);
  no Worker, no wasm, no font/CMap/worker URL (pdf.js fetches nothing); canvas → PNG `blob:` → `<img alt="">`;
  document destroyed after the render. The reviewer confirms the CSP files are byte-unchanged (no
  `blob:` in `script-src`/`worker-src`, no `'unsafe-eval'`/`'wasm-unsafe-eval'`) and that no code path
  constructs a `Worker` or reaches another origin.
- **Profile values into the parser** — `issuer`/`issuerAddress` reach markup surfaces only through
  `escapeValue` and plain surfaces only through `plainValue` (never `parseInline`, DD-47), both after
  `printable`, so a pipe, asterisk, bracket, backslash, line break, marker character (U+E000–U+E0FF) or
  token bracket in a saved name or address can neither change structure nor forge a marker or
  "⟪REF⟫" (hostile-name vectors, AC-12.2).
- **Seed upgrade** — a `formats=wizard` read (`deal:financials`) triggers a write as `system:crm-api`
  under the entity lock (the existing DD-10 / security L-2 posture); it overwrites a row only when its
  text is byte-identical to a shipped seed (SHA-256), with `FOR UPDATE` + version CAS against a racing PUT.
- **Refusal** — a blank legal name refuses generation with the absent-profile 409 before any read (DD-61).

**Owner amendment OA-3 and security round 5 M-4 — still YES; review surfaces** (owasp-reviewer, standard tier,
scheduled in parallel with QE as before; no personal or regulated data added):
- **Decoded-size bound (M-4, F-2)** — `boundPdf` runs before any pdf-lib load at confirm, on the link route and at
  generation; the hostile fixtures (object-stream bomb, lying `/Length`, chained filters, LZW, oversized declared
  images, object and stream floods) are refused in bounded time and memory; the caps are constants (DD-74).
- **Immutable stored letterhead (F-4)** — copy on confirm: the stored key was never presigned for POST and holds
  exactly the checked bytes; the upload key is deleted (DD-75).
- **New refusal** — 409 `letterhead_unusable` `{ entity, reason }` on the link route and both generate routes: no
  link minted, nothing written, `no-store`; its log line holds entity and reason only, never key, link or bytes (DD-76).
- **Preview** — the page layer and the rail carry no text or data and are hidden from assistive technology; the
  `blob:` URL is reused, never refetched (AC-11.8); pdf.js `maxImageSize` (DD-77); the CSP files stay byte-unchanged.
- **Reported, not in scope** — F-3: the deal PDFs appended as annexes are still loaded by pdf-lib at generation
  without a decoded-size bound (an insider can exhaust crm-api's heap); `boundPdf` is reusable there. F-1: the PDF
  clips a table row taller than a page and loses its text (`contractPdf.ts:523-526`).

## Proposed spec amendments

The plan is written assuming these; each is also a delegated decision. They change the text
of approved ACs and need the owner's confirmation.

- **SA-1 (AC-4.1, AC-4.3; 018 AC-1.5, AC-3.3)** — total rows: a template may print several
  labelled total rows; each sums the one-off and yearly lines since the previous total row,
  minus that span's discounts (T3 "TOTALE primo anno", T6 "TOTALE primo periodo", T13 two
  totals). A new cost-line kind `option` (a line the client may tick, numbered and priced, never
  counted — T1 "voce a scelta"; T1+T3 has none, DD-49). "At least one `one_off` line" becomes "at least one
  `one_off` or `yearly` line" (T3/T6 without activation have none). Stored price and yearly
  figure unchanged (018 D-6). For a table with one total row and one-off lines only, the result
  is 018's exactly.
- **SA-2 (domain language: template field)** — kinds gain `amount` (money in the offer's
  currency); a text field may offer a fixed list of `options` (shown as a select) and an option
  or a block may fill other fields when chosen (T3 SLA profile, T4 price model).
- **SA-3 (AC-3.5)** — an *invalid* answer (a derived percentage below 0, a fractional quantity, a
  date out of range) blocks generation like a missing field and is listed with them.
- **SA-4 (AC-9.1)** — "their texts are the mockup's" holds for every printed sentence except:
  the page-1 header, acceptance block and "Allegati:" line are drawn by the CRM (O1); section
  numbers are the renderer's; the annex heading uses 018's style ("ALLEGATO A – …"); T5's free
  "Allegati" field becomes the deal-PDF picker; literal "CHF" next to an amount becomes the
  deal's currency; the mockup's table width hints are not kept.

## Delegated decisions

Taken on the owner's behalf on 2026-11-15, for review.

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| DD-1 | **O1 (header):** the CRM keeps drawing page 1 from the deal (018 AC-1.2): salutation (`@@salutation`), client block, A.c.a. with the chosen contacts, place and date, title with the reference; also the acceptance block (018 AC-1.4) and the "Allegati:" list. The mockup's lines for these are not template text. The mockup's two opening paragraphs become the template's opening. | Keep them as template text (the mockup's way) | One header for every offer and template, client data from the deal (AC-2.1), and the reference that only exists at generation (AC-2.2) is never typed into a text. Matches the spec's proposal. |
| DD-2 | **O1 (annexes and lettering):** the mockup's annexes are **text annexes** of the template, each with the designation its author writes (`A`, `SLA`, `DPA`). They come first, in template order; then 018's effort-detail annex, then the deal PDFs, both lettered with the next free letters (A, B, C… skipping designations in use). The effort-detail annex therefore becomes "Allegato B" when a text "Allegato A" is printed. The index is printed, as in 018 D-8, only with the effort-detail annex, and then lists the text annexes too. | Re-letter everything in order (breaks the template's own "Allegato A" references); effort detail always "A" (contradicts T1/T4/T13, whose text says "Allegato A"); print an index whenever any annex exists (changes every T3 offer) | Keeps the authors' references true and 018's behaviour intact when there is no text annex. |
| DD-3 | **O2 (limits):** checked against the seven texts. Kept: contract sections 1–15 (all have 9), heading ≤ 120, section body ≤ 20 000 (largest: 5 486, SLA annex § 5; enforced in the hand-edit dialog and at generate — the draft schema stores up to 1 000 / 100 000, decisions.md T30 entry, owner-confirmed 2026-11-15), opening ≤ 5 000 (≈ 300), client block 1–8, cost lines ≤ 10 including expansions and extras (largest template: 4 + T2's one per profile), contacts ≤ 5, PDFs ≤ 5 / 20 MiB. Changed: "≥ 1 one-off line" → "≥ 1 one-off or yearly line" (SA-1). Added: ≤ 5 text annexes, ≤ 30 sections per text annex (SLA has 15), template text ≤ 150 000 chars (largest: 46 881), nesting ≤ 8. | Apply 15 sections to the whole document (T13 has 29 with annexes); raise everything uniformly | Smallest change that fits all seven with headroom; the 018 limits that fit stay. |
| DD-4 | **Field metadata lives in the template text** as `@@field`/`@@block`/`@@choice`/`@@list`/`@@table` declarations; only name, language, description and uses are columns. | A side JSON edited with forms (renaming a field in the text orphans its label; two sources of truth); code config like the mockup (every change a release, against US-8) | One text = one pasteable artifact: wellD's English and Italian-entity versions (AC-9.3) are added by pasting a text; AC-8.3 can point at a line for a missing label. |
| DD-5 | **Syntax:** the 018 markup + the mockup's `[FIELD]`, `{{…::…}}`, `@@OPT_START/END`; explicit declarations instead of the mockup's heuristics; headings without numbers; `@@costs` block; `@@annex`; backslash escapes. Not adopted: `@@W` widths, `@@PAGEBREAK` (annexes start a page), `^^` (→ `@@subtitle`), `---`. | A new syntax (Handlebars-like); keep the heuristics | The constraint "extend the existing markup"; authors keep what they wrote; heuristics on Italian words would not work in English templates. |
| DD-6 | **Shared interpreter:** byte-identical copies in `crm-api/src/offers/engine/` and `crm-ui/src/lib/offerEngine/`, shared-copy groups, shared vectors; preview resolved in the browser. | Server-side preview endpoint; a shared package / workspace; putting it in `@operai/ui` (domain logic in the design system) | AC-3.1/3.2/8.5 with no round trip; the repo's existing pattern for deliberate copies. |
| DD-7 | **Draft storage:** `offer_draft`, PK `dealId`; whole-document `PUT` with If-Match, created with `If-None-Match: *`; autosave debounced 1 s; answers built server-side on create/switch; generation from the stored draft with its If-Match, draft deleted in the same transaction. | Per-field PATCH (merge rules, more routes); generation from a client body (could differ from what was saved); browser storage (forbidden, AC-6.7) | Simplest CAS that satisfies AC-6.1/6.3/6.6 and makes the generated document exactly the stored one. |
| DD-8 | **Template edited under a draft:** autosave is never refused for it; the client reconciles (keeps answers whose names still exist) and shows the notice; generation refuses a stale `templateVersion` (409 `template_changed`). | Pin the draft to the old version (the template has no history); refuse autosave | AC-8.4 and AC-3.2 together: the person sees the reconciled document before generating it. |
| DD-9 | **AC-9.2 mechanics:** legacy templates of an (entity, language) are archived in the transaction that first leaves an active wizard template for it (create, duplicate, restore, language change, seed); a legacy restore is refused while a wizard template is active; the last active template of an (entity, language) cannot be archived; new templates are always wizard templates; remaining legacy templates keep the 018 editor; the Template step offers legacy templates for languages with no wizard template, opening the 018 dialog. | Archive in the migration (before any wizard template exists for some languages — against AC-9.2); entity-wide switch (would strand welld_ch English) | Exactly "when that entity and language get their first wizard template, and not before", with no entity left unable to make an offer. |
| DD-10 | **Seeding:** lazy and idempotent per `seedKey` (archived rows count, so an archived seed is never re-created), `welld_ch` only, triggered only by `formats` including `wizard`, texts as code in `wizardSeeds.welldChIt.ts`. | Migration data; seeding on every read | 018's seeding posture; deploy-order safety (R4). |
| DD-11 | **AC-7.3:** "made with a template from before this spec" = `origin: "sections"`. 018-summary `OF-…` offers stay non-editable (unchanged). | Treat summary offers too | They were never editable (018 AC-7.1). |
| DD-12 | **Currency:** always the deal's (CHF or EUR) for every entity; template literal amounts are in the deal's currency (018's posture for fixed amounts); the seeds' literal "CHF" next to amounts become a `source: currency` field. | Per-template currency; converting amounts | AC-2.5 and AC-9.3; no FX in the CRM. |
| DD-13 | **Cost table:** total rows over spans and `option` lines (SA-1); the mockup's "TOTALE" rows keep their labels. T3/T13 canone and pacchetto ore are `yearly`, T6 canone, extra users and licences are `yearly`, activation lines `one_off`. | 018's single total (wrong for T3/T6/T13); classifying recurring lines as one-off (wrong stored price) | Reproduces the mockup's tables without changing what the stored price means. |
| DD-14 | **Field kinds:** add `amount`; `options` on text fields; `fills` on options and blocks; `compute` derived fields (SA-2, AC-4.5). | Amounts as plain numbers (no currency display); no presets (T3's hint "choosing the profile fills…" would be false) | Needed by the seven texts' labels and hints as written. |
| DD-15 | **System values by binding** (`source:`), named by the author in the template's language (`[CLIENTE]`, `[RIF]`). | Reserved English names; 018's `{name}` syntax alongside | One syntax; Italian authors keep their names. |
| DD-16 | **Printed date** is editable (AC-2.1): null = the day of generation (018), or a date within ±90 days; it is the snapshot's `issuedOn` and validity counts from it. An edited unsent offer with no date set is dated the day of the edit (018 AC-7.2). | A separate print-only date | One date on the document, one validity rule. |
| DD-17 | **Hand edits:** any contract or annex section (heading + body), costs section = its notes only (the table stays computed); keyed by heading source text + occurrence; after a template change an unmatched hand edit is kept in `orphanedEdits` for copying and dropped at generation. Opening and salutation are not hand-editable. | Key by position (silently moves to another section after an edit); allow the opening | AC-5.x name "sections"; safest mapping across template edits. |
| DD-18 | Invalid answers block generation like missing ones (SA-3). | Generate anyway | A contract with a negative balance or a fractional quantity must not be issued. |
| DD-19 | Template ≤ 150 000 chars, nesting ≤ 8, answers ≤ 512 KiB. | No caps | DoS bounds with 3× headroom over the largest seed. |
| DD-20 | The snapshot stores answers + template id/version + resolved texts, not the template source. | Store the source too | Reopening uses the current template (AC-8.4 path); the resolved texts already record what was sent. |
| DD-21 | The preview formats amounts, dates and numbers with the **document's** rules (`engine/format.ts`, `7'000`, `9.2.2026`), not the UI formatters; form inputs use the library's. | Library formatters in the preview | AC-3.2: the preview must read like the PDF. |
| DD-22 | Characters the PDF cannot print show as "?" in the preview too; "□" (U+25A1) is supported (drawn as a box) because the seeds use it. | Silent difference preview/PDF; replacing "□" in the seeds | AC-3.2 and AC-9.1. |
| DD-23 | Salutation and acceptance label come from the template only (no per-offer edit). | Keep 018's per-offer edit | The spec's wizard lists none; fewer knobs; a hand edit does not cover them, a template duplicate does. |
| DD-24 | T5's free "Allegati" field becomes the Annexes step's deal-PDF picker (018 AC-1.7 lists them); T2's "CHF / giorno · Giorni" headers are kept through `@@costlabels`. | Keep the free field (two annex lists) | One list of annexes, drawn by the CRM. |
| DD-25 | Editor preview runs on the unsaved text in a full-screen dialog with `sampleAnswers` — no deal, no draft, no storage. *(Presentation superseded by DD-37: a second editor view, not a dialog; the substance — unsaved text, sample answers, no write — stands.)* | Preview only saved templates | AC-8.5 "from the editor" while editing. |
| DD-26 | Steps use language-neutral keys; an item appears at its first occurrence whose blocks are on, unless `step:` overrides; the seeds encode the mockup's mapping (sections 1–3 scope, 4–5 conditions, 6–8 costs, 9 and annexes annexes). | Infer from section numbers like the mockup | Numbers are no longer in the text; AC-9.1 "steps are the mockup's". |
| DD-27 | **G1 — draft summary for the deal page:** `GET /deals/{id}/offer-draft/summary` → 200 `{ draft: OfferDraftSummary \| null }` (template id/name/language/archived, `templateChanged`, target with reference, `version`, `updatedBy/At`, `createdAt`; never `answers`), `ETag` when present, `no-store`, the generating gate before anything is read. Discard uses its `version`. | `GET /offer-draft?summary=1` (one path, two response schemas in OpenAPI); `HEAD` (no body for name/author); embedding the summary in the offers list (that list is readable with `deal:financials` alone — a holder without manage would learn the draft exists, against AC-6.2); fetching the full draft (≤ 512 KiB on every deal page load) | A separate sub-resource keeps one schema per route and the AC-6.2 gate; `{ draft: null }` instead of 404 because "no draft" is the normal answer on every deal page, and it keeps 404 meaning "no such deal". |
| DD-28 | **G2 — `templateId` on edit/revision:** optional for `edit`/`revision`; omitted → the snapshot's `template.id` (wizard offers); same template → reconcile the snapshot's answers; another template or a legacy offer → `initialAnswers` + the offer's client lines, contacts, place, date (one rule with `switchTemplate`, AC-6.5/7.3); legacy without `templateId` → 422 `template_required`; the snapshot's template archived → 409 `template_archived` `{ templateId }` and the UI goes to the Template step with the target set. | Expose `templateId` on `OfferSchema` (a list-wide field whose only reader is this call; the snapshot is already the authority); require `templateId` and refuse a different one (a second "switch" path to maintain); allow a draft on an archived template (generate refuses it anyway — the person would fill in steps they cannot generate) | The server already holds the snapshot; the UI sends what it knows (the offer), and the archived case reuses the AC-7.3 path instead of a new one. |
| DD-29 | **G3 — numbering in the engine:** `numbering.ts` (`numberOffer`) gives section and sub-heading numbers, text-annex headings, effort-detail/deal-PDF letters (AC-9.5, DD-2), the "Allegati:" list and the index; `costs.ts` gives cost positions; `words.ts` holds the document's fixed words per offer language. The renderer reads them for legacy and wizard snapshots alike; dropping of empty sections/sub-headings happens in the resolver. | Keep numbering in `contractPdf.ts` and re-implement it in the preview (two implementations of "par. 2", exactly what AC-3.2 forbids); preview without numbers (templates cite "par. 2"; the person cannot check a reference) | AC-3.2 holds by construction only if what both draw comes from one copy; the legacy goldens (AC-9.4) prove the renderer refactor changed nothing. |
| DD-30 | **G4 — hand-edit tokens:** `resolveSectionForEdit` writes each missing value and the pending reference as "⟦Label⟧" (U+27E6/U+27E7: visible, never typed, not printable); the dialog refuses to save while any token remains — even for a field filled since, because hand-edited text no longer follows the answers; answers and hand edits containing "⟦"/"⟧" are 422 `answers_invalid`; `reserved_character` covers them in templates. | «Label» as in the design (T1's own text writes «Cliente», so a token is indistinguishable from document text); keep the private-use markers (invisible in a textarea); refuse only tokens of still-missing fields (design S8 wording — a token of a field filled since would print literally); a literal `{reference}` token resolved at generation (a new hand-edit grammar for a case no seed has — R16) | A token must be unmistakable both to the person and to the check; the server refusal means no token can ever reach a PDF. *Amended by DD-52:* the pending reference in a section body is the reference token "⟪REF⟫", which does not block (the rejected "literal `{reference}` token" became necessary when R16 fired; DD-52 picks its spelling). |
| DD-31 | **G5 — `lastStep`:** stays in `answers`, but a step change alone schedules no save; it rides on the next content save. The server treats a `PUT` deep-equal to the stored draft as a no-op (200, same version, no write). Reopening lands on the step of the last content change (or `?step=`). | A separate unversioned `lastStep` column/PATCH (state changing under an unchanged ETag, a second write path); saving every step click (bumps `version`: two people reviewing would 409 each other for no content change); not persisting it (AC-6.1 "exactly as left" loses the place) | No spurious 409s, no second write path; the place kept is where the person last changed something, which is where they were working. |
| DD-32 | **G6 — one issue list:** `computeCosts` errors and hand-edit limits are entries of `ResolvedOffer.invalid` (step `costs` / the section's step) with a focus `name` (`cost:<key>`, `cost:extra:<id>`, `cost:*`, `section:<key>`) and the template's label (never a value; `null` for extra lines and `cost:*`); the draft generate route answers them inside 422 `offer_incomplete`, which is exactly `resolveOffer(…).missing/.invalid` of the stored draft. Only checks needing the database (`contact_not_in_company`, `attachment_*`) stay separate 422s. | UI synthesises cost errors while the server keeps separate 422 codes (two lists, one of which the UI could miss: Generate offered, then refused); a separate `costErrors` member (a third list on every surface) | AC-3.5 "refused … creates no offer" and AC-3.6 "lists every invalid answer" become one computation in both copies; the design's S10 cost banners collapse into the issues list. |
| DD-33 | **G7 — outline shape:** each item carries `optional`, `derived`, `system`, `options`, `fills` (per option for fields and choices, per block), `default`, `handEditedIn`; blocks nest their `children`; each step lists its `sections`; `outline(ast, null)` is the editor's (every item, regardless of block state), `outline(ast, answers)` the wizard's (only shown items, AC-1.5). | Two functions (`editorOutline`, `wizardOutline`) that can drift; let the UI walk the AST (the AST becomes a public contract of both copies) | One function, one shape, all the facts the two screens show (design D-15 "Fills:", the editor's "optional"/"derived"). |
| DD-34 | **Cost-table rules (decisions.md, folded into the engine and vectors):** a percentage discount's base is the whole one-off sum, as in 018, and a percentage discount exists only in a table with at most one total row, where the whole table is one span (DD-39 — supersedes this row's original own-span base); the discount check runs per span — read as Σ discounts ≤ Σ counted lines of the span, so no printed total is negative — **and** document-wide as 018's Σ discounts ≤ Σ one-off, so the stored price is never negative; a total row whose span has no counted line prints "–" and is not an error; a table with no counted line stays `no_counted_line`. Rules C1–C9 in `costs.ts`, pinned by `vectors/costs.spans.json`. | Per span against the span's **one-off** lines only (the literal wording of decisions.md rule 2: it refuses AC-4.6's own example — a 50.00 discount in a yearly-only span — so the spec wins); per span only (a yearly-only table with a discount would store a negative price); document-wide only (a span total could print negative); a percentage's base = its own span's one-off lines (the original DD-34: the stored price then depends on where the total rows fall — DD-39) | Each figure is summed over the scope its label names; for one span of one-off lines every rule collapses to 018's exactly (AC-4.6 last sentences). |
| DD-35 | **Cost-table edges the rules left open (derived here):** a percentage discount in a table with at most one total row (DD-39) and no one-off line is `discount_without_base`; a counted or discount line after the last total row is the template error `cost_line_after_last_total`; extra lines go immediately before the last total row; a span with a missing value is "incomplete" (no partial sum shown, its checks wait). | Print "– 0.00" for a baseless percentage (silent nonsense); let a counted line follow the last total (in the price, in no printed total); extras at the very end (after T1's option line, outside every total) | Closes the ADR's open "empty scope" and "percentage without base" failure shapes so the vectors can pin every case. |
| DD-36 | **G8 — "optional" is shown:** AC-1.3 requires an optional field to be marked "optional", so the wizard shows a visible "optional" tag (design D-7), and required fields keep `*` + `aria-required`. This departs from design-system INC-16 ("never write optional") for the wizard's template fields only. | Follow INC-16 (contradicts an approved AC) | The spec is the source of truth; the departure is recorded here and in design D-7 for the owner's review — a change to INC-16 or to AC-1.3 is the owner's, not this plan's. |
| DD-37 | **G9 — presentation deviations from this plan, accepted:** the editor's sample-answers preview is a second view ("Try the wizard", `Tabs`) instead of DD-25's full-screen dialog (design D-2); the editor has a `Line n, col m` status line and line numbers in the problems list instead of a line-number gutter (soft-wrapped 800-character paragraphs cannot share a gutter); contacts are picked with `CheckboxGroupField` instead of a `Combobox` (design D-6: ≤ 5 of the company's contacts, the same control as 018's dialog). | Keep the plan's presentation | Presentation is the designer's call; none changes a contract, an AC or a test level. |
| DD-38 | **AC-1.8 enforced on the server:** `PUT offer-draft` refuses (422 `answers_invalid` `{ path }`) a text value outside its field's `options` when the body's `templateVersion` equals the template's; with a stale `templateVersion` it is accepted (DD-8: autosave is never refused for a template edit) and `resolveOffer` reports it as invalid `not_an_option`, so generation refuses it either way. | Check only in the browser (AC-1.8 "cannot be … saved" would be false for any other client); refuse also on a stale version (breaks DD-8) | Found while re-checking the mapping: the plan's `PUT` validated shape only, and AC-1.8 (added by SA-2) had no test. |
| DD-39 | **A percentage discount is refused in a cost table with two or more total rows** (decisions.md, last entry; closes the open decision of ADR 20261115-offer-cost-table-total-rows-and-option-lines with its option (a)). Total rows are counted as present after block resolution, whatever `showTotals` says. Template level: a declared `unit=<n>%` in a costs table with two or more `@@total` rows (every declared `@@total`, in a block or not) is the error `percent_discount_multi_total` at the discount's line — Save refused, 422 `template_invalid` (AC-8.3). Answer level: a discount with a percentage (a template `?` line entered as a percentage, or a person's extra discount line, AC-4.3) in a table with two or more total rows present is `invalid` `percent_discount_multi_total` at `cost:<key>` / `cost:extra:<id>` (step `costs`), in `ResolvedOffer.invalid` and 422 `offer_incomplete` (DD-32); no amount is computed for it (C3). Not refused on `PUT offer-draft` (autosave is never refused for a computed condition, DD-8/DD-38). With one total row or none the base is the whole one-off sum, as in 018 (C3). The code name is the same in both lists, as `heading_too_long` already is. | **(b)** base every percentage on the whole one-off sum, whatever the total rows: the stored price is 018's, but a span total would subtract a share of lines outside its span, a figure its label does not state (the ADR's failure shape, moved from the stored price to the printed one). **(c)** keep the own-span base and amend AC-4.6's last sentence: accepts that 1 000.00 · TOTAL A · 500.00 · 10 % · TOTAL B stores 1 450.00 while the same lines with one TOTAL store 1 350.00 — the failure shape in the stored figure, and an approved AC weakened to fit the plan. Also rejected: allow a percentage while `showTotals` is off (a display switch would decide whether an input is valid); a static-only check (misses extra lines and `?` lines). | It costs the seven seeds nothing — every discount in the mockup is an amount ("come importo", each sitting directly above a single "TOTALE") — and it makes AC-4.6's "do not depend on where the total rows fall" true by construction (C-rules invariant), with no figure ever computed over a scope its label does not name. Revisit if a template needs a percentage discount alongside span totals: then the owner picks (b) or a per-span percentage printed with its base. |
| DD-40 | **`declaration_invalid` (post-engine):** a malformed declaration — unknown key, unknown `kind:`, a `default:` the kind cannot hold, > 20 / empty / duplicate `options`, malformed `fills` or `columns`, a repeated key, `label` > 80 / `hint` > 200 / `example` > 80 — is one new error code, with `name` = the offending key; a field needs `label` unless it has `source:`. crm-ui needs an en/it `templates.wizardEditor.problem.declaration_invalid` message (T14). | One code per cause (eight codes for one mistake class; the line and key already locate it); ignoring unknown keys (a typo such as `lable:` would silently drop the label) | The grammar's caps had no code to report under; a typo must be a line-numbered error (AC-8.3). |
| DD-41 | **`WizardContext.language` and `.today` (post-engine):** the engine has no clock and no locale, so the day and the document language come in the context. `language` is the template's language (crm-api: the template row; browser: the draft's template — never `<html lang>`, which would print English client lines and words in an Italian offer, against AC-10.1; corrects decisions.md "T5–T8", which said `<html lang>`). `today` is the server's UTC day (018's `issuedOn` rule): the context route returns it (`today`), the browser uses it, and crm-api uses its own clock at `POST`/generate. | The browser's clock (a wrong client clock would make the preview's default dates and the ±90-day check disagree with the server's for days); `Date.now()` inside the engine (two copies, two clocks, untestable vectors); a `?language=` on the context route (the route is read before a template is chosen) | One authority for the day; the preview and the server disagree only across a UTC midnight (R19). |
| DD-42 | **The printed-date window is the resolver's (post-engine):** `client.date` more than 90 days from `context.today` is `invalid` `{ name: "client:date", label: null, step: "client", code: "date_out_of_range" }`; it blocks generation (422 `offer_incomplete`) and is never a `PUT` refusal (the caps check only the shape) — a draft saved today must still autosave in four months (DD-8 posture). A reopened offer (edit/revision) whose stored date is now out of the window must be given a new date before it can be generated. **Owner review:** 90 days. | Refuse on `PUT` (the plan's original caps line: autosave would start failing on a calendar day with no edit); no window (back-dating a contract by years) | The check depends on the day, so it belongs where the day is an input — the resolver — and its answer reaches both lists. |
| DD-43 | **Outline placement, as built:** the opening's items go to the first contract section's step; nesting only under an earlier enclosing block that is an item of the same step; a choice's option contents are listed beside the choice; a cost-table-only field is an item of the table's step (rendered inside the table, T44); own-place `source:` fields are not items, estimate sources and `validityDays` are; an unused declaration is not an item; a step with no items is omitted even with sections; wizard mode hides cost lines/totals in off blocks; a table column is required when a cost line uses it as unit or quantity. | Nest under any enclosing block (a block of another step would hide a field from the step that asks for it); a "cost fields" pseudo-step | The rules the outline vectors pin; the wizard and the editor consume them, never re-derive them. |
| DD-44 | **`resolveOffer(ast, answers, context, options?)` with `{ reference?, mode? }`:** generation resolves first without a reference (the pending reference is not an issue, so it blocks nothing), then with `{ reference }` inside the transaction; `mode: "tokens"` is used only by `edit.ts`. | A provisional reference string (the plan's step 4: a fake value would pass through escaping and could be mistaken for a real one); a separate `resolveForEdit` resolver (two resolvers) | One resolver, three uses. |
| DD-45 | **Resolved structures, as built:** `ResolvedCostRow` = `CostRowIn` + a line's `description`; `ResolvedAnnex` gains `intro` (018 markup between `@@annex` and its first `##`) and prints only with a title and an intro or a section; `InvalidIssue = Issue & { code }`; `ResolvedOffer.client.date` is the printed date (person's, else `context.today`); `CostErrorCode` includes `percent_discount_multi_total`; `ResolvedSection.uses` lists every name a section reads (conditions included), for every section. The snapshot's `textAnnexes[]` gains `intro`, and the renderer draws it before the annex's first section (T25/T26/T31). | Fold the intro into a synthetic first section (it would be numbered "1." and shift every annex reference) | What the seven texts need (the SLA and DPA annexes open with text before their first section). |
| DD-46 | **`numberOffer` input, as built:** `{ language, sections, annexes, effortAnnex, attachmentNames }` — names instead of a count, because the "Allegati:" lines print each PDF's name; `language` selects `words.ts`. Its strings are print-ready (`toUpperCase` + `printable`): a marker character becomes "?", so the preview composes a heading that carries a marker itself (§ UI). An annex intro's `###` lines are not numbered. | Keep markers through `numberOffer` (it would then not be print-ready for the renderer); a count plus a separate name list (two inputs that can disagree) | The renderer prints only complete offers (generation refuses anything missing), so print-ready strings are right for it; the preview has the number and the text to compose from. |
| DD-47 | **Plain surfaces carry markers:** headings, annex titles and subtitles ("plain": template text as written, values unescaped) and cost descriptions, total labels and column labels ("stripped": template markup removed — the seeds' `**TOTALE**` arrives as `TOTALE`, bold is not carried, as in 018's cost table) hold U+E000–U+E003 unescaped. Consumers split on the four characters and never run `parseInline` (security: values there are unescaped). Applies to the renderer (T25, T26), the Costs step (T44) and the preview (T46). | Escape values on plain surfaces and let consumers parse them (bold in a heading has no 018 meaning; one more parse to keep equal in two places) | Smallest contract; the security rule is one sentence a reviewer can grep for. |
| DD-48 | **A field is a scalar or a column, never both:** T4's programme-table hours column is `ORE_MODULO` (label "Ore complessive") because `ORE` is also a scalar field. The catalog (`wizardSeeds/welldChIt.ts`, T24) exports each code's mockup→seed renames (`T4: rows.MODULO[].ORE → ORE_MODULO`); the T35 fidelity adapter applies them to the golden answers — no rename lives in a test. | Let a column double as a scalar (a line naming it would be ambiguous between "repeat per row" and "print the scalar") | The grammar's rule stands; the golden fixtures stay as captured. |
| DD-49 | **The seven seeds, as built (T18–T23):** one file per code, `wizardSeeds/welldChIt.<code>.ts` (export names as built: `welldChItT1Text`, `welldChItT2Text`, `welldChItT3Text`, `welldChItT1T3Text`, `T4_TEXT`, `T5_TEXT`, `T6_TEXT`; the catalog imports them); mockup `T13` = code `T1+T3` = file `T1T3`. Only T1 has an `option` line after its last total; T1+T3 has two totals and **no** option line, like the mockup and its golden (corrects SA-1, R5 and T23's task text). `REFERENTE_CLIENTE` is `source: contacts`; `VALIDITA_GIORNI` is `source: validityDays`; optional sub-headings are `{{block::### Title}}` or `@@OPT_START` around the `###`; the mockup's amount-only discounts are `unit=?` (one total, so a percentage is valid there, DD-39); T4 accepts an `optional_heading_not_last` warning (the mockup's order). **Owner review:** T2's TARIFFA label "CHF / giorno" stays verbatim (wrong for a EUR deal). | Rewrite the seeds to one export naming scheme now (touches five tested files for no behaviour); add an option line to T1+T3 (not in the mockup, AC-9.1) | AC-9.1/9.6: the mockup wins over the plan's paraphrase of it. |
| DD-50 | **Engine purity, as built:** no `welld_` literal; no `Intl`, `toLocale*`, `Date.now`, `new Date(`, `localStorage`, `eval(`, `new Function`, import outside the engine — checked on code with comments stripped (the files' comments say "no `Intl`"); `Date.UTC` (a pure function of its input, used for the ±90-day distance) is allowed; a `"CHF"`/`"EUR"` value literal is allowed only in `format.ts`'s per-currency separators (018's formatting) and `sampleContext`'s fixed currency. | A literal-free engine (the separators ARE per currency: AC-2.5 formatting, legacy goldens) | The AC-9.3 test checks what matters — no entity or currency branch of behaviour — without failing on comments and two named, legitimate uses. |
| DD-51 | **Engine freeze:** the crm-ui copy made by T13 is the engine as built at T13. After T13 any engine change is drift — amend this plan (a DD), re-sync tasks.md, then edit both copies in one commit with their vectors. T14 may touch both copies only to satisfy crm-ui's compiler or linter, without changing behaviour (every vector unchanged). | Let later tasks adjust the engine as they go (two copies drifting under feature pressure, AC-3.2 lost silently) | AC-3.2 holds by construction only while both copies are the same reviewed code. |
| DD-52 | **Reference token in hand-edited text (closes R16):** the exact string "⟪REF⟫" (U+27EA, `REF`, U+27EB; `REFERENCE_TOKEN` exported by `markup.ts`, never re-spelt) stands for the offer reference in a hand-edited section's BODY. `resolveSectionForEdit` writes it where `source: reference` occurs in a body, not escaped and not listed in `tokens` (in a heading the reference stays a blocking "⟦Label⟧"). `findTokens` (body) skips an exact token and reports any other "⟪"/"⟫" as a one-character entry; `findTokens(…, "heading")` reports every "⟪"/"⟫". `resolveOffer` splits a hand-edited body on the exact token (raw text, left to right, non-overlapping, before `printable` and before markup) and fills each occurrence: with `reference` the reference escaped for its place, without it the pending marker (label of the first `source: reference` field, else "REF"; not an issue, DD-44), in `mode: "tokens"` the token as written. Typed twice → filled twice; typed in any hand-edited section, or with a template that declares no reference field → filled (the reference exists at every generation); in a heading, an answer or a template → `reserved_character`. `checkAnswers` (the `PUT` check) adds "⟪"/"⟫" to the reserved characters and, in `handEdits[*].body`/`orphanedEdits[*].body` only, tests the value with exact tokens removed — so DD-30's "⟦"/"⟧" refusal is untouched and every other use of either bracket pair is still 422 `answers_invalid`; `syntax.ts`'s `reserved_character` gains "⟪"/"⟫". `printable` is unchanged (still maps both to "?"). | (a) Accept R16: the dialog warns and a hand edit drops the reference (the person must delete it, or type a reference that does not exist yet for a new offer and is wrong after a revision); (b) DD-30's own brackets with a reserved label, e.g. "⟦#⟧" (one bracket pair meaning "blocks" and "does not block" — the person cannot tell them apart, and DD-30's simple server rule "no ⟦ ⟧ anywhere" gains an exception); (c) an ASCII spelling — `[RIF]`, `{reference}`, `{{RIF}}` (collides with text a person may write — the seeds print "Rif. [RIF]" style text — and with the markup: `[`/`{` are escaped in answers, `{{` is a condition, so it would need its own escaping rules); (d) keep the private-use pending marker U+E002…U+E003 in the edit text (invisible in a textarea — rejected in DD-30 for the same reason); (e) assign the reference when the section is first hand-edited (the reference is assigned only inside the generation transaction, 018 numbering and DD-44; reserving early burns numbers and is wrong for a revision's `rN`); (f) a language-specific inner word or the template's field label as the token (the match would depend on the template and its language; a renamed field would orphan the token); (g) store a hand edit as text segments around a structured reference (a data-model and dialog change for one value) | The reference is a system value the person never types (AC-2.2); unlike an answer it cannot be "filled since", so DD-30's reason for blocking does not apply to it. A distinct, never-typed, non-printable bracket pair keeps both checks exact and both meanings visible; resolving on the raw text before `printable` lets the token survive the one mapping that would destroy it, while `printable` stays the backstop for any stray bracket. A fixed spelling makes the token portable across templates, languages and copied orphaned edits. Built before T13 (DD-51), so it is one change in one copy. |
| DD-53 | **Letterhead renderer (owner amendment, US-11):** `pdfjs-dist` (Apache-2.0), one exact 5.x version pinned in crm-ui (no caret; the current one at L0; the modern build, not `legacy/`), imported only by `crm-ui/src/lib/letterhead/renderLetterhead.ts` and only lazily (`import()` when an opening's first preview needs a letterhead that exists); never shared through Module Federation, never in `@operai/ui`. It runs on the **main thread**: the worker module is imported first, so pdf.js finds `globalThis.pdfjsWorker` and never constructs a `Worker`. Options: `data` (our capped bytes), `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, range/stream/auto-fetch off; no `workerSrc`, `standardFontDataUrl`, `cMapUrl` or `wasmUrl`, so the renderer fetches nothing and compiles no wasm. Page 1 is rendered once, 1 600 px wide, on a transparent canvas → PNG `Blob` → one `blob:` URL drawn as `<img>`; the canvas is released and the document destroyed. | (a) crm-api rasterises the letterhead (at confirm or lazily) and serves a PNG by presigned GET — no browser renderer, but a native canvas dependency (pdf.js + `@napi-rs/canvas`, or pdfium) in a Bun service on Railway, a second stored object and a backfill, a new byte-reading reason in crm-api (ADR 20261102's trigger), and against the approved text: AC-11.7 "drawn in the browser", § Constraints "adds a PDF renderer in the browser"; (b) a pdf.js `Worker` from crm-ui's origin — a dedicated worker must be same-origin with the shell's document, impossible for a remote; (c) a `blob:` worker or `'wasm-unsafe-eval'` — a CSP change, against AC-11.7 "as it stands"; (d) `<object>`/`<embed>`/`<iframe>` — `object-src 'none'`, `frame-src` falls back to `'self'`, the browser viewer's chrome, and it cannot sit behind real text; (e) pdf-lib — reads and embeds, does not rasterise | The only option inside the approved text and the shell's CSP. One page of ≤ 5 MiB once per opening, so the main-thread cost is a one-off (R23), measured in L0; pdf.js's own advice for the CVE-2024-4367 class is applied (no eval, canvas only). |
| DD-54 | **Letterhead delivery:** the wizard context gains `letterhead: boolean` (the profile has a `letterheadKey`), which decides AC-11.3 without a request. The bytes come through the EXISTING `GET /entity-profiles/{entity}/letterhead` (`deal:financials`, 60 s presigned GET), which gains `Cache-Control: no-store`. crm-ui fetches the link with plain `fetch` (`cache: "no-store"`, `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "error"`), stops reading past 5 MiB and checks `%PDF-`. `useLetterhead` (owned by the page: `OfferWizardPage` or `TryWizardView`) makes ONE attempt per opening, started by the first mounted preview (`request()`, idempotent), under one 10 s budget for link + bytes + module imports + render; no retry; unmount aborts it and revokes the URL. The link and bytes live only in the attempt's closure. | The link in the context response (it expires after 60 s, while a narrow-screen person may open the Drawer minutes later, and the page would keep a bearer link in state); a new `/deals/{id}/offer-wizard/letterhead` route (a second link-minting path for one object; the Try view has no deal); proxying the bytes through crm-api (ADR 20260716); letting pdf.js fetch the URL (range requests need more CORS-exposed headers, no size cap, no `no-store`); a cache across openings (AC-11.4 "tried again the next time", AC-11.8 "the letterhead at that time") | Reuses the gate, link mint and bucket path that Settings already uses; every failure is one state and nothing waits on it (AC-11.4). |
| DD-55 | ***Superseded by DD-65…DD-72 (OA-3, 2026-11-15).*** **Paper layout:** the paper (`<article>`) becomes a one-cell grid: the letterhead `<img alt="" aria-hidden="true" draggable={false}>` (`col-start-1 row-start-1 self-start w-full aspect-[210/297] select-none pointer-events-none`; no filter, opacity or `dark:` class) and the content wrapper (`col-start-1 row-start-1 min-w-0 p-6`, after it in the DOM, so it paints above) share the cell: the paper is at least one A4 tall at its width and longer content runs on plain paper (AC-11.2). The band leaves the paper and is drawn above it, beside the existing note, as chrome. No inset mirroring the PDF's frame. Pane and Drawer render the same tree at their own width (AC-11.6). | A CSS `background-image` or an absolute layer (no intrinsic height: a short draft's paper would not reach one A4); keeping the band inside the paper (it would sit on the letterhead's header graphics); insetting the text by `contractPdf.ts`'s `FRAME` (120/71 pt as a % of width: closer to the PDF, but a second copy of a renderer constant for a difference the owner accepted, O5); a scaled A4 box (design D-8: text must stay real and zoomable) | Real text over a decorative image with the text's DOM unchanged (AC-11.1); light in both themes because the paper tokens already are and the image is untouched (AC-11.5). |
| DD-56 | ***Amended by DD-72 (OA-3): the `shown` caption and the note after the other three sentences.*** **The one band:** chosen by the attempt's state — `pending` (no request yet, or loading) → today's `preview.letterhead(issuer)`; `shown` → `preview.letterheadShown`; `none` → `preview.letterheadNone(issuer)`; `failed` → `preview.letterheadFailed(issuer)` (copy as in AC-11.2/11.3/11.4, en + it). `{entity}` = the context's legal name, or `strings.badges.entity[entity]` when it is blank (AC-12.7) or the Try view could not read the profile. Plain text: no `Banner`, no toast, no `role="alert"`. | A `Banner` for the failure (AC-11.4: no dialog or toast for something the person cannot act on); a separate "loading" band (AC-11.4 keeps today's band while pending) | The spec's four strings, in one place. |
| DD-57 | **Engine (owner amendment; an authorised change after T13, DD-51 procedure: both copies, one commit, vectors):** `syntax.ts` — `SystemSource` and `SYSTEM_SOURCES` gain `"issuerAddress"`. `answers.ts` — `WizardContext.issuerAddressLines: readonly string[]`; `sampleContext` uses `"Fornitore di esempio SA"` / `"Sample Supplier Ltd"` and `["Via Esempio 2", "6900 Lugano"]` (no real company). `resolve.ts` `rawValue` — `issuer` → the name with every line break folded to one space, trimmed; `issuerAddress` → `issuerAddressLines` folded and trimmed per line, blank lines dropped, joined `", "`; `valueOf` — for these two sources a blank value is `{ kind: "text", text: "" }`, never a missing value. Escaping is the existing path (`escapeValue` on markup surfaces, `plainValue` on plain ones, both after `printable`). `outline.ts` — `OWN_PLACE_SOURCES` gains `"issuerAddress"`. Purity test: `/welld/i` joins the forbidden patterns. | A blank supplied value as missing (today's behaviour: a "⟦Label⟧" the person cannot fill, counted in AC-3.5 — AC-12.7/12.12 forbid it); one `issuer` source with a sub-field syntax (`issuer.address`, a grammar change for one value); joining the lines with line breaks (AC-12.9: one line, ", "); letting the author choose the separator (spec Non-goals) | The smallest engine change that makes US-12 hold in both copies; markup safety (AC-12.2) is proven by new vectors on the existing escape code, not new code. |
| DD-58 | **What the screens need from the engine:** `ResolvedOffer.systemRead` — the sources of system-bound fields the resolver read while building PRINTED, non-hand-edited text (an emitted `[NAME]` or an evaluated condition naming it), sorted and unique; the AC-12.12 notice is `systemRead.includes("issuerAddress") && address empty` (also in the Try view, AC-12.13). `suppliedFields(ast)` (outline.ts) — declared `issuer`/`issuerAddress` fields the text uses, in order of first use; the editor's outline view lists them under "Supplied by the CRM" (AC-12.1, AC-12.9). Vector runners in both apps gain optional `systemRead` and `supplied` expectations; base contexts gain `issuerAddressLines: []`. | A static "the template uses the address" check (warns while the SLA annex is off or its section hand-edited); the UI walking the AST (the AST becomes a contract of both copies); a `supplied` member on `Outline` (rewrites every outline vector for a list only the editor reads); listing `reference`/`currency` as supplied too (consistent, but beyond AC-12.1 — open question O10) | Exact conditions from the one interpreter, with no churn in existing vectors. |
| DD-59 | **Seeds v2:** each of the seven declares `@@field EMITTENTE` / `source: issuer`; T3 and T1+T3 also `@@field INDIRIZZO_EMITTENTE` / `source: issuerAddress`. Every "WellD Sagl" (2 per seed; 5 in T3 and T1+T3) becomes `[EMITTENTE]` — "con cui [EMITTENTE] («WellD») eroga" keeps «WellD» (AC-12.3); the parties row reads `\| **Fornitore** \| [EMITTENTE]{{?INDIRIZZO_EMITTENTE::, [INDIRIZZO_EMITTENTE]}} \| — \|`, so an empty address leaves "wellD SA" alone (AC-12.12) with the existing conditional text. Nothing else in the texts changes. The catalog's keys become `welld-ch-it-v2:<code>`; each seed also carries its v1 key and kept key, and `upgrade.ts` its `V1_DIGESTS`. The export keeps its name `WELLD_CH_IT_V1` (now holding the v2 texts): renaming it would touch eight files for no behaviour (DD-49's precedent). Italian field names, as the seeds' others (DD-15). | An engine-level "optional separator" (new grammar; `{{?…}}` already says it); writing the address unconditionally (", " left dangling, AC-12.12); also binding "Lugano" in the jurisdiction clauses or the place of issue (AC-12.10: not the issuer's address) | AC-12.3/12.10 exactly; the fidelity test proves nothing else moved (DD-63). |
| DD-60 | **One-time in-place upgrade (AC-12.5, 12.6, 12.11):** `wizardSeeds/upgrade.ts` `upgradeWizardSeeds(tx, entity)`, called by `seedWizardTemplates` inside the existing `inTemplateTransaction(entity, …)` (the entity's advisory lock) BEFORE the insert step: `SELECT … WHERE entity = $e AND "seedKey" IN (<v1 keys>) FOR UPDATE`; per row, `sha256(source)` ∈ `V1_DIGESTS[code]` → `UPDATE SET source = <v2>, "seedKey" = <v2 key>, version = version + 1, "updatedBy" = 'system:crm-api', "updatedAt" = now() WHERE id = $id AND version = $seen`; otherwise → `UPDATE SET "seedKey" = 'welld-ch-it-v1-kept:<code>' WHERE id = $id AND version = $seen` (no version bump: text and ETag unchanged). Never touches `archivedAt`, `name`, `description`, `uses`. The insert step then inserts only codes with no row under any of their three keys (fresh databases get v2 directly). Fast path outside the lock: no v1-keyed row and seven rows under v2/kept keys → return. `V1_DIGESTS` = SHA-256 of every revision of each seed file's text from the T24 commit to the last commit before this change (T2 and T4 have several: QE D4, D8), produced once by `crm-api/scripts/seed-digests.ts` (`git show` per revision) and committed with each revision's sha. Only `formats=wizard` listings run it (R4). | New keys inserting new rows (creates templates and collides with the seeds' names); seed text in a migration (DD-10); upgrading every v1 row (overwrites people, AC-12.6); comparing a normalised text (an edit that only changes spacing would be overwritten); keeping the v1 key on an edited row and re-checking it on every listing (a later edit back to the v1 text would be upgraded — AC-12.6 "takes effect once"); keeping full v1 texts as fixtures (≈ 140 KB of look-alike seeds) | Decided once per row in the transaction that decides it; a person's edit, a duplicate (no `seedKey`) and a name-taken seed are never touched; drafts get the AC-8.4 notice through the version bump. |
| DD-61 | **A blank legal name (AC-12.7):** the engine prints "" (DD-57); crm-ui adds a third reason to the existing `generateBlockedReason` chain in `OfferWizardPage` (estimate missing → template archived → `context.issuerLegalName.trim() === ""` → "Set the legal name of {entity label} in CRM Settings"), counts unchanged; crm-api's draft generate refuses it in step 3 with the absent-profile 409 `entity_profile_missing` `{ entity }` (helper `requireIssuerName` in `generation.ts`), before any resolve or byte read. Not on the context route (the wizard must open), not on draft `POST`/`PUT` (DD-8: autosave is never refused), not on the legacy `POST /deals/{id}/offers` (018 unchanged, AC-9.4; finding). | A missing-field entry (AC-12.7: not counted; nothing to focus); a new 409 code (AC-12.7 says "as for an absent profile"); refusing on the context route (the wizard would not open) | The refusal sits with the other context refusals, and the UI reason with the other non-answer reasons. |
| DD-62 | **Try view (AC-8.5, 11.9, 12.8, 12.13):** `TryWizardView` reads `GET /entity-profiles` once per mount (the editor's `deal:financials` gate) and builds `{ ...sampleContext(language), issuerLegalName, issuerAddressLines }` from the template's entity profile when it is readable and its name is not blank; otherwise `sampleContext`'s sample name and address and a note "The supplier's name and address are samples: the profile of {entity label} could not be read." (en/it). Letterhead: `useLetterhead({ entity, present: profile ? profile.letterhead !== null : null })` — `null` → the failure band. No other request. | Reading nothing and always showing samples (AC-12.8 asks for the profile's name); a dedicated `GET /entity-profiles/{entity}` (the list already exists, one consumer more) | The only CRM reads AC-8.5 now allows. |
| DD-63 | **Fidelity under US-12 (AC-9.6 changed):** `fidelity.test.ts` resolves each seed (and each `golden/variants/` case) twice: with `WellD Sagl` / `["Via Pessina 9", "CP 1920", "CH-6901 Lugano"]` it must equal the golden with the existing normalisations only — proof that the bindings stand exactly where the literals stood; with `wellD SA` / `["Via Example 1", "6900 Lugano"]` it must equal the golden after exactly two substitutions ("WellD Sagl" → "wellD SA", counts 2/2/5/2/2/2/5; the Pessina address → "Via Example 1, 6900 Lugano", count 1 in T3 and T1+T3, 0 elsewhere), «WellD» and every "Lugano" outside the parties row unchanged. A third T3 run with no address pins the cell "wellD SA". The golden fixtures are not edited (they are the mockup's capture); `conversion.*.test.ts` assertions on "WellD Sagl" become assertions on `[EMITTENTE]`. Test helper `toV1(v2)` (the inverse of DD-59) must hash into `V1_DIGESTS` for the last revision of each seed — proof the conversion changed nothing else. | Rewriting the golden texts (the mockup's capture would stop being the mockup's); one run with a new allow-list only (would not prove the binding sits at the literal's place) | AC-9.6 changed by exactly its two new bullets, provably. |
| DD-64 | **Sample PDFs and release items:** `crm-api/scripts/render-wizard-samples.ts` (T37) takes `--legal-name` and repeatable `--address-line`, defaulting to `sampleContext`'s sample values; the owner re-renders the seven with each entity's real profile values before release (spec O7). Release checklist: O7 (address lines per entity), R22 (CRM bucket CORS allows GET), L0 recorded. | Keep "WellD Sagl" hard-coded in the script (would review a text no offer prints) | The owner reviews what production will print. |
| DD-65 | **Pagination mechanism (OA-3, AC-11.1, 11.11, 11.12):** ONE continuous flow of real text (the elements the preview renders today) over a decorative page layer; where a page ends, a dead zone (rest of the frame + bottom margin + gap + next top margin) is kept free by a **rail of empty floats** at the start of the flow (`zₖ` width 0 / `Fₖ` width 100 %, both `float:left; clear:left`), which CSS 2.1 § 9.5 makes line boxes and tables move below. No text node is split, copied or wrapped by a break. § Amendment OA-3 › P. | Split the DOM into page elements (find, copy and screen readers see two paragraphs; structure added); clip windows over a copy of the flow per page (a split sentence exists, and is found and selected, twice); CSS multicol `column-height`/`column-wrap` (Chromium only, uneven `widows`/`orphans`); CSS Regions / `-moz-element()` / print `@page`; a hidden measuring copy; a PDF or canvas preview (declined by the owner) | The only shape found in which a sentence cut by a page break stays one selectable, searchable run (AC-11.12) with standard CSS in every engine. Trade-off: two layouts per settled change and a flow invariant (DD-70). |
| DD-66 | **Page geometry and type:** `W = min(794, available − 2·inset)`, `inset = min(16, available/20)`, `H = W·297/210`, frame = `FRAME`·(W/595.28), body `B = H − 230·s`, gap 16 px; each PDF type size *p* at `max(12, 0.75·rootFontPx, p·s)` px with an explicit `1.35×` px line-height; spacing, indent and cell padding = the PDF's points × `px(10)/10`; values as inline runtime `style` through `PaperTypeContext`; `font-body` kept; tables auto layout. | `cqw` font sizes in arbitrary classes (refused by the token lint, and the placement needs px anyway); scaling text with the page (refused by spec O8's floor); a fixed 12 px floor alone (ignores a doubled text size, AC-11.13) or `0.75rem` alone (under 12 px when the root font is set smaller); Helvetica metrics (a new `@operai/ui` font token, shell-first deploy); the PDF's column widths (a renderer rule into the shared engine) | Matches the PDF's proportions wherever the floor allows; the floor follows the person's settings; no library change. |
| DD-67 | **One copy of the paper constants:** `crm-api/src/offers/paper.ts` (PAGE, FRAME, the type sizes, LINE, the spacing points) imported by `contractPdf.ts` instead of its literals, and a byte-identical `crm-ui/src/lib/offerPaper/paper.ts`; shared-copies group `offerPaper`. | Literals copied into crm-ui (knowledge in two places — a renderer change would silently desync the preview's frame, AC-11.10); importing crm-api code into crm-ui (no shared package, DD-6) | The repo's existing pattern for deliberate copies; the frame is a spec value (AC-11.10) that must not drift between the two renderers. |
| DD-68 | **Break rules (`placeBreaks`, pure):** R1 fill to `B`; R2 widow/orphan as `contractPdf.ts:418-420` (no 2- or 3-line block splits); R3 keep-with-next (≥ `min(2,n)` lines, header + first row, a unit whole; chains); R4 a table breaks before a body row other than its first, rows never split, header **not** repeated; R5 acceptance block whole; R6 forced page before each text annex and the effort annex, never a blank page; R7 relaxation order on an empty page (R3 → R2 → R5 → split an over-tall row at a line boundary), ≥ 1 line per page; R8 each line once, in order, ≥ 1 page. | Mirroring the PDF's numbers exactly (its 3-line section-heading room; a preview at other sizes makes the number meaningless — the rule, not the number, is mirrored); repeating the table header (AC-11.1/11.11); clipping an over-tall row like the PDF (loses text, AC-11.11) | AC-11.11's list, each rule a vector; termination guaranteed. |
| DD-69 | **When and how the pages are laid out:** inputs = the settled resolution (existing 250 ms), the region's width, the root font size, `document.fonts` `loadingdone` — never the letterhead state, the D19 height or the scroll; the visible tree renders unpaged (stage height kept: no scroll clamp), `useLayoutEffect` measures `[data-flow]` items, places, realises and re-renders paged before paint; `scrollbar-gutter: stable`; ≤ 2 width-only re-layouts in a row. | Measuring a hidden copy (double DOM, drift); toggling the rail off by direct DOM writes (fights React); recomputing on a timer or `requestIdleCallback` (a frame of stale breaks on screen); laying out per keystroke (the debounce exists) | AC-3.1/11.11 timing with no visible intermediate state; the D19 hook and the pagination never feed each other. |
| DD-70 | **Realising breaks beyond the rail:** a break between rows of one table → `translateY(ΣD)` on the following rows' cells + `margin-bottom: ΣD` on the table (`border-collapse: separate`, rules on cells, the first row on a page draws its top rule); an over-tall row → a rail inside each of its cells; an element painting across a dead zone (hand-edited section rule, an over-tall row's cells) → `clip-path: path(...)` minus the bands; flow invariant: no BFC inside the flow but tables/cells, no painted block but the hand-edited section; tables lose `overflow-x-auto` and wrap anywhere; annexes lose `mt-8 border-t pt-4`. | Splitting a table into one table per page (adds tables: AC-11.1, AC-11.12); `display:block`/`flex` rows with ARIA roles (rewrites table semantics and layout); keeping horizontal scroll for wide tables (AC-11.10: wrap, never clip); drawing the hand-edited rule in the page layer (a second geometry to keep in sync) | Tables cannot be pushed line by line by floats (a table is a BFC); transforms leave the DOM and the text untouched. |
| DD-71 | **Page layer and the letterhead on every page:** N page boxes (`aria-hidden`, `inert`, `bg-paper`, `border-paper-rule`) on the stage's `bg-ink-mid`; while `shown` each box holds one `<img alt="" draggable={false} decoding="sync">` of the SAME `blob:` URL; `useLetterhead` keeps its decoded `HTMLImageElement` referenced for the opening; `pending`/`failed`/`none` draw the same boxes empty; geometry and breaks never read the state. | A CSS `background-image` per page (same decode, but the image is no longer an element the C tests and the e2e can count and check); one image stretched behind the whole stack (wrong: the letterhead is per page); re-rendering the PDF per page (AC-11.8) | One fetch, one render, one decoded bitmap for any page count; a page that appears is never blank (AC-11.8); dark theme untouched (AC-11.5). |
| DD-72 | **Bands and copy:** the band stays above the region (DD-56); `letterheadShown` = AC-11.2's caption (en, it); the note after the `pending`/`none`/`failed` sentences becomes the caption's second sentence ("Page breaks are approximate: the PDF is the authority." / "Le interruzioni di pagina sono approssimative: fa fede il PDF."), replacing "Layout and page breaks differ in the PDF."; no page number, count or list. | Dropping the note in those three states (they would no longer say the breaks are approximate); a separate caption line under the band (layout shift between states, design D-29) | One sentence about breaks in every state, worded as the spec's caption. |
| DD-73 | **Tests where layout exists:** jsdom has no layout, so the pagination's logic is pure and unit-tested (`pageGeometry`, `placeBreaks`, `realize`, `collectFlowItems` over stubbed rects; seeded random invariants); components are tested with an injected layout (counts, roles, strings, `textContent` identical paged and unpaged, requests); everything that needs real lines (frames, breaks, search, copy, widths, zoom) is e2e in Chromium through the shell, plus screenshots for the owner. | Asserting layout in jsdom (meaningless); visual-diff snapshots as the gate (brittle across fonts and OSes; kept as evidence only); a WebKit/Firefox Playwright project (not in the shell config today; a release manual check instead, R30) | Each layer tested where it can fail. |
| DD-74 | **Security M-4 — a decoded-size bound before any parse:** `pdfBounds.ts` `boundPdf()` run first by `checkLetterhead`: objects ≤ 10 000, streams ≤ 1 000, decoded total ≤ 32 MiB (non-image ≤ 8 MiB), image ≤ 40 MP each and 64 MP in total (declared; DCT also by SOF); streams decoded from their data start (filters self-delimiting, `/Length` never trusted), Flate by `node:zlib` streaming stopped at the cap, other filters by pdf-lib decoders pulled 64 KiB at a time, codecs by declared size; new reasons `too_complex`, `decoded_too_large`, `image_too_large`, `unbounded_stream`. | Checking after `PDFDocument.load` (pdf-lib inflates object streams in full on load: F-2); pdf-lib's `FlateStream` (a whole deflate block per call); `/Length`-bounded extents (a lying indirect length hides bytes pdf.js inflates); a ratio limit (a modest ratio over 5 MiB is still huge); a client-only bound (pdf.js has none for inflate); a worker in the browser (CSP change, ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote) | Bounds the browser's main thread AND crm-api's own heap with one check, at the one place a letterhead enters. |
| DD-75 | **Copy on confirm:** crm-api writes the bytes it checked under a fresh `letterheads/<entity>/<uuid>.pdf` key (never presigned for POST), stores it, deletes the upload key. | Storing the upload key (F-4: re-POSTable for 60 s after the start); S3 `CopyObject` then re-reading the copy (a second read, and a window between check and copy); an ETag-pinned GET (needs a column or a signed `If-Match` header) | The stored object is exactly what was checked and can never change — which also makes the verdict memo of DD-76 sound. |
| DD-76 | **Stored letterheads re-checked before use:** `usableLetterhead` / `assertLetterheadUsable` with a process-local verdict memo per key (≤ 64); the link route and both generate routes answer **409 `letterhead_unusable` `{ entity, reason }`** for a stored file that fails `checkLetterhead`, before minting a link or rendering; the preview shows the `failed` band; Settings and the wizard say to upload it again. | Checking only at upload (letterheads stored before this change, and F-4's window, are unchecked); refusing silently by falling back to the plain header at generation (changes the document without telling anyone); 422 (the request is fine, the stored state is not); a column recording the check (a migration for at most two rows) | Every path that hands a stored letterhead to a parser — crm-api's or the browser's — goes through the same check, at most once per object per process. |
| DD-77 | **Client defence in depth:** `renderLetterhead` passes pdf.js `maxImageSize: 40_000_000` (pinned by the guard test). | Nothing (pdf.js's default is no limit); a smaller cap (would drop a real 300 dpi logo from the preview) | The one bound pdf.js exposes; the server bound stays the control. |
| DD-78 | **Release audit:** read-only `crm-api/scripts/check-letterheads.ts` (entity, verdict, figures; never key or bytes) run against production before the crm-api deploy; a refusal blocks the deploy; `infra/README.md` release item. | Discovering it after the deploy (that entity's offers refused, R35); a migration that checks (needs bucket access inside a migration) | Production holds at most two letterheads; knowing their figures also justifies the caps. |
| DD-79 | **Readings of AC-11.11 built while the owner is asked (O12, O13):** "only the last page may be partly empty" = no page is blank and a page ends early only where a rule of AC-11.11 moves what follows; a row taller than a page's frame continues at a line boundary; the header row is not repeated. | The literal readings (unsatisfiable together with the keep rules and forced annex pages; or text lost like the PDF's clipping) | Satisfies every other clause of AC-11.11 and loses nothing; one constant or one rule to change if the owner reads it otherwise. |

## ADR candidates

Each is one decision with its rejected alternative; predicted paths use today's date.

1. **Offer templates are self-describing texts interpreted by one shared engine** —
   `docs/adr/20261115-offer-template-self-describing-text-shared-interpreter.md`. A template's
   wizard (fields, blocks, choices, steps, cost lines) is declared inside its markup text and
   interpreted by one pure engine copied byte-for-byte into crm-api and crm-ui; preview and PDF
   come from the same resolved structure; answers are escaped into markup. *Rejected:* metadata
   in a side JSON (drift), server-rendered preview (latency, no editor preview), a shared
   package (forbidden workspace).
2. **A wizard draft is server-held and generation reads the stored draft** —
   `docs/adr/20261115-offer-draft-server-held-generated-from-stored-state.md`. One draft per
   deal, whole-document If-Match autosave, generation pinned to the draft and template versions,
   draft deleted in the generating transaction. *Rejected:* generating from a client body,
   per-field PATCH, browser storage.
3. **Template formats supersede per (entity, language), transactionally** —
   `docs/adr/20261115-offer-template-format-supersession-per-entity-language.md`. The first
   active wizard template archives that language's legacy templates in the same transaction;
   legacy restore refused; last-template guard; format-filtered listing for deploy safety.
   *Rejected:* migration-time archival, an entity-wide switch, converting legacy templates (a
   spec non-goal).
4. **Cost tables print span totals and option lines; the stored price does not change** —
   `docs/adr/20261115-offer-cost-table-total-rows-and-option-lines.md` (only if SA-1 is
   accepted). *Rejected:* 018's single one-off total (cannot print a first-year total), treating
   recurring lines as one-off (falsifies the stored price).

5. **Amendment to ADR 20261115-offer-cost-table-total-rows-and-option-lines** (written
   2026-11-15 with three open points) — its "percentage base", "per-span check" and "empty
   scope" risks are now decided by DD-34/DD-35 (rules C1–C9), and its later open decision (a
   percentage discount with two or more total rows) by DD-39, option (a): refused. *Rejected:*
   per-span check against one-off lines only (refuses AC-4.6's example); document-wide check
   only; (b) a whole-sum base with span totals; (c) the own-span base with AC-4.6 amended.
   Amended in place (`docs/adr/20261115-offer-cost-table-total-rows-and-option-lines.md`,
   § Amended 2026-11-15, its open decision now "Decided — option (a)").
6. **Amendment to ADR 20261115-offer-template-self-describing-text-shared-interpreter** — the
   shared engine also owns the document's numbering, annex lettering and fixed document words,
   and the renderer only draws them (DD-29). *Rejected:* numbering in the renderer with a
   re-implementation in the preview (two implementations of what AC-3.2 says must be one).

7. **Amendment to ADR 20261115-offer-template-self-describing-text-shared-interpreter** — the
   engine's day and document language are inputs (`WizardContext.today`, `.language`): the day is
   the server's (returned by the context route to the browser), the language the template's; the
   browser clock and the UI language are never consulted (DD-41, DD-42). *Rejected:* the
   browser's clock; `Date.now()` in the engine; `<html lang>` as the document language.

8. **A third-party PDF renderer runs in the browser, inside the remote, on the main thread, under the
   CSP as it stands** (owner amendment, DD-53/DD-54) —
   `docs/adr/20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.md`. The preview's letterhead
   is page 1 of the profile's PDF, fetched by the browser through the existing presigned GET and drawn
   by `pdfjs-dist` on the main thread (no Worker, no eval, no wasm, nothing fetched by the renderer),
   once per opening, failing soft. *Rejected:* crm-api rasterising the letterhead (native canvas in a
   Bun service, a new byte-reading reason under ADR 20261102, contradicts AC-11.7), a pdf.js Worker
   (cross-origin from a remote) or a `blob:` worker (CSP change), `<object>`/`<iframe>`
   (`object-src 'none'`, cannot sit behind text), a PDF preview (declined by the owner).
9. **Seeded content is upgraded in place only while it is exactly what was seeded, and the decision
   is taken once per row** (DD-60) — `docs/adr/20261115-seeded-content-upgraded-in-place-only-when-unedited.md`.
   A new seed version replaces a seeded row's text when its SHA-256 equals a shipped text, moving its
   key; any other row is marked kept and never revisited; nothing is created, resurrected or archived.
   *Rejected:* new keys inserting new rows (creates templates, name clashes), seed text in a migration,
   upgrading regardless of edits (overwrites people), a normalised or fuzzy comparison (an edit that
   differs only in spacing would be overwritten).
10. **Amendment to ADR 20261115-offer-template-self-describing-text-shared-interpreter** (DD-57, DD-58) —
   a value the CRM supplies and the person cannot fill (`issuer`, `issuerAddress`) prints nothing when
   empty and is never a missing field; a refusal for it lives outside the engine (DD-61); the engine
   reports which system values printed text read (`systemRead`). *Rejected:* an empty supplied value as
   missing (a placeholder nobody can fill, counted against the person), a stand-in value, an
   engine-level "optional separator" grammar (the existing `{{?…}}` already says it).
11. **Amendment to ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote** (DD-71, DD-74, DD-77) —
   `docs/adr/20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.md` (amendment 2026-11-15). The letterhead
   is drawn behind every page from one render and one `blob:` URL; a main-thread renderer of a person's upload is
   acceptable only behind a server-side decoded-size bound checked before any parser runs — closing the ADR's own
   "neither is decided here" on the server bound; `maxImageSize` as defence in depth. *Rejected:* a client-only bound
   (pdf.js has none for inflate), a worker (a CSP change), relying on the 5 MiB file cap.
12. **A paginated HTML preview keeps one continuous flow: page gaps are floats, never cuts in the text** (DD-65,
   DD-67, DD-70) — `docs/adr/20261115-paginated-preview-one-flow-float-rail.md`. A page break in an HTML rendering
   must not split a text node or add structure, so search, copy and assistive technology see the document, not the
   pages; the paper's geometry is one shared constant file with the PDF renderer. *Rejected:* one element per page,
   clip windows over copies of the flow, multicol `column-wrap`, a hidden measuring copy.
13. **A PDF from a person is bounded by its decoded size before any parser inflates it, and a stored file is the
   bytes that were checked** (DD-74…DD-76, DD-78) — `docs/adr/20261115-uploaded-pdf-decoded-size-bound-before-parse.md`.
   Extends the bounded-read lineage of ADR 20260908 and ADR 20261102 (a byte cap bounds the input, not what a parser
   makes of it) and names its next caller (F-3: the annex PDFs read at generation). *Rejected:* checking after
   `PDFDocument.load` (it inflates object streams in full), trusting `/Length`, a ratio limit, a client-only bound,
   storing the upload key.

## Glossary candidates

- **Text annex** — an annex written in the template text, with a designation chosen by its
  author (Allegato A, SLA, DPA); distinct from the **effort-detail annex** (018's "Annex A",
  generated from the estimate). The glossary should name both: "Annex A" is now ambiguous.
- **Total row** — a labelled row of the cost table summing the lines above it since the
  previous total row.
- **Option line** — a cost line the client may tick; priced and numbered, never counted.
- **System value** — a template field bound to data the CRM knows (client, reference, date,
  currency, estimate figures).
- **Wizard step** — one of Template, Client, Scope, Conditions, Costs, Annexes, Preview.
- **Span** — the cost lines a total row sums: those since the previous total row (DD-34).
- **Hand-edit token** — "⟦Label⟧", what the hand-edit text shows for a value it still lacks (DD-30).
- **Reference token** — "⟪REF⟫", what hand-edited text writes for the offer reference; filled at
  generation, never blocks a save (DD-52).
- **Printed date** — the date on the offer: the person's choice within ±90 days of today, else
  the day of generation (DD-16, DD-42).

- **Issuer** — the wellD entity making the offer; its legal name and address are read from the entity
  profile through the system values `issuer` and `issuerAddress`, never written in a seeded text
  (owner amendment; spec domain language "issuer field", "issuer address field").
- **Supplied value** — a system value the CRM fills and the wizard never asks (`issuer`,
  `issuerAddress`); listed by the editor as "supplied by the CRM" (DD-58).
- **Kept seed** — a seeded template a person had edited before a seed upgrade; left as written,
  never upgraded later (DD-60).
- **Letterhead** (update to the existing entry, OA-3) — the glossary says the preview draws it behind "the first
  page"; it is now drawn behind **every page** of the wizard's preview (spec AC-11.1, AC-11.2).
- **Preview page** — one A4 page of the wizard's preview: the letterhead (or nothing) behind, the offer's text
  inside the PDF's frame; its breaks approximate the PDF's (AC-11.11). _Avoid:_ sheet; "PDF page" (the PDF's own).

Findings (not edits): the legacy `POST /deals/{id}/offers` still prints 018's plain header with a
blank legal name (damaged data); this amendment refuses it only on the wizard's draft generate
(DD-61) — a follow-up could share the refusal. The sample-PDF script and several renderer tests use
"WellD Sagl" as a fixture name; only the seeds and the engine must not (DD-63, DD-64).

Findings (not edits): crm-api's legacy prefill type `OfferDraft` (`src/offers/draft.ts`) and
route `GET /deals/{id}/offers/draft` use the glossary's "offer draft" for the 018 prefill; the
plan renames the type to `OfferPrefill` and documents the route as the legacy prefill.

### Isolated PDF check — 503 `pdf_check_busy` / `pdf_check_unavailable` (post-release note, 2026-11-16)

Added after the release of operai 0.4.0 (eval round 3, spec-fidelity finding): the isolation of the PDF checks
(ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse, amendment 2026-11-16, `isolatedPdfCheck.ts`) gave the routes
below two failure responses that this plan had not listed. Both are **503**, an RFC 7807 Problem with the `code` below;
neither is a verdict about the file — nothing was decided, nothing was written or deleted, and a retry is right. They are
distinct from the 503 of an unreachable authorization service, which carries no such code.

| `code` | When | What the person is told (`en`; `it` in `crm-ui/src/strings/common.ts`) |
|---|---|---|
| `pdf_check_busy` | both isolated checks are taken and the queue (6) is full | "The check of uploaded PDFs is busy. Try again in a moment." |
| `pdf_check_unavailable` | the check's process did not start, died or answered with something that is not a verdict (nothing is remembered about the file) | "The PDF could not be checked right now. Try again." |

| Route | Where the check runs |
|---|---|
| `POST /entity-profiles/{entity}/letterhead/confirm` | the uploaded letterhead (the upload is **kept**, not deleted: a refusal deletes it, a 503 does not) |
| `GET /entity-profiles/{entity}/letterhead` | the first use of a stored letterhead in this process (the link is not minted) |
| `POST /deals/{id}/attachments/{aid}/confirm` | a PDF attachment (the row stays `pending` for a retry) |
| `POST /deals/{id}/offers`, `PUT /deals/{id}/offers/{offerId}` | the stored letterhead and every chosen PDF annex before the render (nothing is written) |
| `POST /deals/{id}/offer-draft/generate` | the same, for the wizard (the draft is kept) |

**OpenAPI.** Each of the six routes documents its 503 with both codes (`pdfCheckErrors` in `crm-api/src/lib/http.ts`, replacing
`commonErrors[503]` there); every other route keeps "The authorization service is unavailable". `src/lib/pdfCheckOpenApi.test.ts`
pins both. **crm-ui.** `errorMessage` (`lib/errors.ts`) words the two codes from the strings module, so every placement that
shows it, or `offerFailure`, which falls back to it, speaks the person's language and never the server's English `detail`:
the Settings letterhead card (confirm and download), the deal's attachment card (confirm), the classic offer dialog, the
wizard's Preview step (a warning banner with Retry). The preview's own letterhead link attempt is not worded:
it settles as `failed` without reading the message (DD-54).

## Amendments

- 2026-11-15 (post-design, delegated): closed the design's contract gaps G1–G9 and folded in
  the cost-table rules of `decisions.md` — DD-27 draft summary route, DD-28 optional
  `templateId` for edit/revision, DD-29 numbering/lettering/document words in the shared
  engine, DD-30 hand-edit tokens "⟦Label⟧", DD-31 `lastStep` without spurious 409s, DD-32 cost
  errors and hand-edit limits inside `ResolvedOffer.invalid` and `offer_incomplete`, DD-33
  outline shape, DD-34/DD-35 span rules C1–C9 (decisions.md rule 2 read against AC-4.6's
  example), DD-36 visible "optional" tag (AC-1.3 wins over INC-16), DD-37 presentation
  deviations, DD-38 AC-1.8 checked on the server. The AC→test table gained the seven ACs
  SA-1…SA-4 added (AC-1.8, 1.9, 3.6, 4.6, 4.7, 9.5, 9.6). No spec change.
- 2026-11-15 (delegated, decisions.md last entry): DD-39 — a percentage discount is refused in
  a cost table with two or more total rows (template problem and `invalid` code
  `percent_discount_multi_total`); with one total row or none its base is the whole one-off
  sum, as in 018. DD-34, DD-35, rules C3–C5 (+ the placement invariant), the
  `costs.spans.json` cases, the grammar, the Costs step and the AC-4.6 row updated; the ADR's
  open decision closed with option (a). No spec change: AC-4.6 now holds as written.
- 2026-11-15 (post-engine, delegated): the engine (T2–T12) and the seven seeds (T18–T23) are
  built; the drift they reported (decisions.md "T5, T6, T7, T8", "T9, T10, T11, T12", "T19, T20,
  T23", "T21, T22") is folded in, checked against the engine's exports: DD-40
  `declaration_invalid`; DD-41 `WizardContext.language`/`.today` (the context route returns
  `today`; language is the template's — corrects decisions.md's `<html lang>`); DD-42 the
  ±90-day printed-date check `client:date` in the resolver, not on `PUT` (corrects the caps
  line); DD-43 outline placement; DD-44 `resolveOffer` options `{ reference, mode }` (generation
  resolves without a provisional reference); DD-45 `ResolvedCostRow`, `ResolvedAnnex.intro`,
  `InvalidIssue`, `percent_discount_multi_total` in `CostErrorCode`; DD-46 `numberOffer(…,
  attachmentNames)` with print-ready strings; DD-47 marker characters on plain surfaces —
  consumers split, never `parseInline`; DD-48 the `ORE_MODULO` column and the mockup→seed
  renames; DD-49 the seeds as built (only T1 has an option line); DD-50 engine purity
  allow-list (AC-9.3 test); DD-51 engine freeze after T13. Engine contracts, grammar, API
  (context `today`, caps, generate steps 3/4/6), UI, test table (AC-3.6, 8.3, 9.1, 9.3), Risks
  (R5, R19, R20), Security and SA-1's T1+T3 mention updated. No spec change; owner review items:
  the 90-day window (DD-42), T2's "CHF / giorno" label (DD-49), and R16, whose trigger the
  T3/T1+T3 SLA sections have fired (decide before T13 if the answer is an engine change).
- 2026-11-15 (R16, delegated, decisions.md "Orchestrator · R16"): DD-52 — the reference token
  "⟪REF⟫" in hand-edited section bodies, filled by `resolveOffer` (the reference, or the pending
  marker before it is assigned), not blocking in `resolveSectionForEdit`/`findTokens`, allowed by
  `checkAnswers` only as an exact token in a hand edit's body (every other "⟪"/"⟫", and DD-30's
  "⟦"/"⟧" everywhere, still refused). R16 closed; DD-30 annotated; engine contracts of
  `answers.ts` (checkAnswers), `resolve.ts` and `edit.ts`, the UI's Preview step, Security, the
  AC-5.1/AC-5.2 test rows and the glossary updated. Built by the new task T12b before T13 (not
  drift, DD-51). No spec change: AC-2.2 (the reference is never entered by the person) and
  AC-5.2 (a hand edit no longer follows the answers — the reference is not an answer) hold as
  written.
- 2026-11-15 (owner amendment OA-1/OA-2, **approved_by: delegated**): DD-53…DD-64 — the letterhead
  drawn behind the preview by `pdfjs-dist` in the browser (main thread, under the CSP as it stands),
  fetched once per opening through the existing presigned GET, failing soft; the issuer's legal name
  and the new `issuerAddress` system value from the entity profile, never missing, escaped like any
  value; the seven seeds v2 and a one-time in-place upgrade of unedited v1 rows; a blank legal name
  refused at generation. Components, ADRs kept, system values, engine contracts (`SystemSource`,
  `WizardContext.issuerAddressLines`, `ResolvedOffer.systemRead`, `suppliedFields`), data model note,
  context response, letterhead route, generate step 3, seed paragraph, UI, the AC→test table (22 new
  rows, AC-3.2/8.5/9.6 changed; 75 ACs), Risks R21–R29, Security, ADR candidates 8–10 and the glossary
  updated. Spec unchanged by the plan; open questions O8–O10 below.
- 2026-11-15 (owner amendment OA-3 + security round 5 M-4, **approved_by: delegated**): DD-65…DD-79 — the
  preview as real A4 pages (one continuous flow, a rail of floats for the page gaps, a page layer with the
  letterhead behind every page, the PDF's frame and break rules, pure placement tested by vectors and the rest
  e2e), one shared copy of the paper constants with the PDF renderer, and a decoded-size bound on letterheads
  before any parser runs, with copy on confirm, stored letterheads checked before use (409
  `letterhead_unusable`) and a release audit. DD-55 superseded, DD-56 amended; components, UI, the AC→test table
  (79 ACs; AC-11.10…11.13 new), Risks R23 and R30–R37, Security, ADR candidates 11–13 and the glossary updated.
  Findings F-1…F-4. Spec unchanged by the plan; open questions O11–O13 in § Amendment OA-3.


## Amendment (2026-11-15, owner) — the letterhead behind the preview, the issuer from the profile

> **Source:** spec § Amendments (2026-11-15, owner) — OA-1 → US-11 (AC-11.1…11.9), OA-2 → US-12
> (AC-12.1…12.13); changed AC-3.2, AC-8.5, AC-9.6. The owner approved the spec amendment and
> delegated this plan gate: **approved_by: delegated** (2026-11-15). Every choice below is a
> delegated decision (DD-53…DD-64, § Delegated decisions) for the owner's review. 75 ACs, all mapped
> (§ Test strategy). No spec change is proposed.

### Verified in the code before writing

- `GET /entity-profiles/{entity}/letterhead` exists (`crm-api/src/entity-profiles/entityProfiles.routes.ts`),
  gated `deal:financials`, answers `{ url }`: a 60 s presigned GET (`DOWNLOAD_URL_SECONDS`,
  `ResponseContentType: application/pdf`, attachment disposition), 404 when there is none, no
  `Cache-Control` header. crm-ui already calls it (`getLetterheadDownload`, `crmApi.ts:315`) and opens
  the link with `window.open` (`LetterheadCard.tsx`).
- `checkLetterhead` admits exactly one A4 page (±2 pt, a quarter-turn rotation allowed) that pdf-lib can
  embed: "first page only" is the whole letterhead.
- The wizard context (`offer-drafts/context.ts` `contextResponse`) has `issuerLegalName` but neither the
  address nor whether a letterhead exists; `loadProfile` answers 409 `entity_profile_missing` only when no
  row exists.
- **The CSP that governs crm-ui code is the shell's** (`shell/vercel.json`; crm-ui's own `vercel.json`
  applies only to its standalone page). It has no `worker-src`/`child-src` (workers fall back to
  `script-src`: `'self'` + the remotes' origins, no `blob:`), no `'unsafe-eval'`, no
  `'wasm-unsafe-eval'`; `img-src` allows `blob:` and `data:`; `connect-src` allows the bucket host
  `https://t3.storageapi.dev` and `https://crm.operai.welld.io`; `object-src 'none'`; no `frame-src`
  (→ `default-src 'self'`).
- crm-ui code runs in the shell's document but its chunks come from crm-ui's origin
  (`https://crm.operai.welld.io/assets/…`, cross-origin module loads, as every federated chunk). A
  dedicated `Worker` must be same-origin with the document, so a worker script served by crm-ui cannot
  be started from the shell's page; a `blob:` worker is refused by `script-src`.
- The CRM bucket takes browser POSTs (letterhead, attachments), so it has a CORS rule for the shell's
  origin; whether that rule allows `GET` is recorded nowhere (`infra/README.md` documents refund's
  rule, which lists GET "to keep a future fetch-based preview from breaking", not the CRM's).
- Engine: `source: issuer` → `context.issuerLegalName` (`resolve.ts` `rawValue`); a blank value is a
  **missing** value today (`valueOf`: `isBlank(raw)` → `missingValue`), which AC-12.7 forbids. Values
  reach markup surfaces through `escapeValue` (`escapeChars` escapes `\ [ * _ | {`; a table cell folds
  line breaks and `<br>`; line-start markers escaped) and plain surfaces through `plainValue`, both
  after `printable`. `OWN_PLACE_SOURCES` (`outline.ts`) keeps `issuer` out of the editor's outline,
  which AC-12.1 asks to list it. `sampleContext` names "WellD Sagl".
- Seeds: "WellD Sagl" appears 20 times — twice in T1, T2, T4, T5, T6 (opening, privacy clause), five
  times in T3 and T1+T3 (also the SLA intro, the parties row, the SLA definitions' "WellD Sagl
  («WellD»)"); the Pessina address only in the two parties rows (`welldChIt.T3.ts:172`,
  `welldChIt.T1T3.ts:266`).
- **The wizard is not on `main`**: no production database holds v1 seeds. Local/dev databases do (the
  owner's, migrated in fix round 3), and T2/T4 changed twice after seeding began (QE D4 `c93e824a`,
  D8 `6561ca70`), so a dev database may hold any of those revisions.

### L — the letterhead (US-11)

```ts
// crm-ui/src/lib/letterhead/renderLetterhead.ts — the ONLY importer of pdfjs-dist (DD-53). Sketch; the render
// call follows the pinned version's API (`canvas` or `canvasContext`).
export const LETTERHEAD_RENDER_WIDTH_PX = 1600;            // ≈ 193 dpi on A4; L0 may lower it to 1240 (R23)
export async function renderLetterhead(bytes: Uint8Array, signal: AbortSignal): Promise<Blob> {
  await import("pdfjs-dist/build/pdf.worker.min.mjs");      // sets globalThis.pdfjsWorker → no Worker is constructed
  const pdfjs = await import("pdfjs-dist");                 // both: lazy crm-ui chunks, served from crm-ui's origin
  const task = pdfjs.getDocument({
    data: bytes, disableFontFace: true, useSystemFonts: false,
    disableRange: true, disableStream: true, disableAutoFetch: true,
  });                                                       // no workerSrc / standardFontDataUrl / cMapUrl / wasmUrl
  signal.addEventListener("abort", () => void task.destroy(), { once: true });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const scale = LETTERHEAD_RENDER_WIDTH_PX / page.getViewport({ scale: 1 }).width;   // honours /Rotate
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: "rgba(0,0,0,0)" }).promise;     // transparent: the paper shows through
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"));
    canvas.width = 0; canvas.height = 0;
    return blob;
  } finally { await doc.destroy(); }
}

// crm-ui/src/lib/crmApi.ts (DD-54) — beside postToBucket; plain fetch: the bucket is not a trusted origin, no JWT
export const getLetterheadDownload = (entity: Entity, init?: Init) => getJson<{ url: string }>(letterheadPath(entity), init);
export async function fetchLetterheadBytes(url: string, signal: AbortSignal): Promise<Uint8Array>;
//  fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal });
//  !ok → throw; read the stream, abort past MAX_LETTERHEAD_BYTES = 5 * 1024 * 1024; first bytes "%PDF-" else throw

// crm-ui/src/components/offerWizard/useLetterhead.ts (DD-54, DD-56)
export type LetterheadState = "pending" | "shown" | "none" | "failed";
export interface LetterheadView { state: LetterheadState; src: string | null }   // src: the blob: URL, only when shown
export function useLetterhead(source: { entity: Entity; present: boolean | null }):
  { view: LetterheadView; request: () => void };
//  present false → "none" at once, no request; null (Try view: profile unreadable) → "failed" at once.
//  request(): first call starts the ONE attempt (link → bytes → renderLetterhead → URL.createObjectURL) under a
//  10 000 ms timer; any throw/abort/timeout → "failed" (the error's message is never read or logged); later
//  calls do nothing; no retry. Unmount: abort, clear the timer, URL.revokeObjectURL.
```

Wiring: `OfferWizardPage` calls `useLetterhead({ entity: deal.entity, present: context.letterhead })` once
per page mount (an "opening") and passes `letterhead` + `onNeedLetterhead` through `OfferWizard` to BOTH
`DocumentPreview`s (pane and Drawer); `DocumentPreview` calls `onNeedLetterhead()` in a mount effect (the
preview "first needed it": the first step after Template on a wide screen, the Drawer's first opening on a
narrow one). `TryWizardView` does the same for the template's entity (DD-62). `DocumentPreview` gains
`letterhead?: LetterheadView`, `onNeedLetterhead?: () => void`, `issuerLabel?: string` (default: the
context's legal name; the page passes the entity label when that is blank) and `issuerSample?: boolean`;
absent `letterhead` keeps today's band, so existing tests keep their meaning. Layout per DD-55 — **superseded by § Amendment OA-3 (DD-65…DD-71)**; bands per
DD-56; the address notice (DD-58) is a line of chrome under the band. The generated PDF is untouched:
generation keeps reading the letterhead it reads today (AC-11.8, ADR 20261102 unchanged — crm-api reads no
new bytes for the preview).

### I — the issuer (US-12)

Engine (DD-57, DD-58), both copies in one commit:

```ts
// resolve.ts — rawValue
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, " ").trim();
case "issuer":        return oneLine(context.issuerLegalName);
case "issuerAddress": return context.issuerAddressLines.map(oneLine).filter((line) => line !== "").join(", ");
// valueOf — before the "blank → missing" line:
if ((field.source === "issuer" || field.source === "issuerAddress") && isBlank(raw)) return { kind: "text", text: "" };
// systemRead: recorded (a Set) when the BUILD pass emits a system-bound field or evaluates a condition naming one;
// never in hand-edited sections (stored text), never in an off block or a false condition's body; sorted on output.
```

Context (crm-api `context.ts`): `wizardContextOf` and `contextResponse` add
`issuerAddressLines: profile.addressLines`; `contextResponse` adds `letterhead: profile.letterheadKey !== null`.
crm-ui `types.ts` `WizardContextResponse` and `OfferWizardPage`'s `wizardContextOf` map both. Generation
(`offerDrafts.routes.ts` generate, step 3): `requireIssuerName(inputs.profile, deal.entity)` (DD-61).

Seeds (DD-59) and the upgrade (DD-60):

```ts
// wizardSeeds/welldChIt.ts
export interface WizardSeed { …; seedKey: `welld-ch-it-v2:${WizardSeedCode}`;
  previousKey: `welld-ch-it-v1:${WizardSeedCode}`; keptKey: `welld-ch-it-v1-kept:${WizardSeedCode}` }
export const WELLD_CH_IT_V1: readonly WizardSeed[];         // name kept (DD-59); now the v2 texts and keys
// wizardSeeds/upgrade.ts
export const V1_DIGESTS: Readonly<Record<WizardSeedCode, readonly { sha256: string; commit: string }[]>>;
export async function upgradeWizardSeeds(tx: Tx, entity: Entity): Promise<{ upgraded: WizardSeedCode[]; kept: WizardSeedCode[] }>;
// seedWizardTemplates(entity): fast path → inTemplateTransaction(entity, tx => { upgradeWizardSeeds(tx, entity);
//   insert codes with no row under seedKey|previousKey|keptKey (archived included), name-taken skip as today;
//   supersedeLegacy only when inserting })
```

A database that never held v1 rows (production) inserts v2 directly; nothing is upgraded. One structured
log line per upgraded or kept row: `{ entity, code, outcome }` — no text.

### Task hints for `/wellforge:tasks` (re-sync), with touch globs

Order: L0 → (I1 ∥ I3) → I2 → I4 → L1 → L2 → L3 → E → D. Each green on its own.

| Hint | Owner | What | Touch |
|---|---|---|---|
| **L0 spike** (blocks L1–L3) | frontend | Pin `pdfjs-dist` exactly; prove the main-thread path in the shell on a Vercel preview with the production CSP (`securitypolicyviolation` listener, `Worker` constructor spy, both production letterheads rendered — downloaded by a person, never committed); record chunk sizes and render times; read the CRM bucket's CORS and, if GET is missing, have a person add it and document the rule in `infra/README.md` § crm-api; decisions.md entry. A failed spike stops the UI tasks and goes to the owner (R21). | `crm-ui/package.json`, `crm-ui/pnpm-lock.yaml`, `crm-ui/src/lib/letterhead/**`, `infra/README.md`, `specs/20261115-crm-offer-wizard/decisions.md` |
| **I1 engine** | backend | DD-57, DD-58 in both copies + vectors + both runners + purity `/welld/i` | `crm-api/src/offers/engine/{syntax,answers,resolve,outline}.ts`, `crm-api/src/offers/engine/*.test.ts`, `crm-api/src/offers/engine/vectors/*.json`, `crm-ui/src/lib/offerEngine/{syntax,answers,resolve,outline}.ts`, `crm-ui/src/lib/offerEngine/vectors/*.json`, `crm-ui/src/lib/offerEngine.vectors.test.ts` |
| **I3 seeds v2 + digests** | backend | DD-59, DD-63 (fidelity two runs, `toV1`), DD-64 script args; `scripts/seed-digests.ts` run once | `crm-api/src/offer-templates/wizardSeeds/**` (not `golden/**`), `crm-api/scripts/seed-digests.ts`, `crm-api/scripts/render-wizard-samples.ts` |
| **I2 context, generate, link** | backend | context fields, `requireIssuerName`, `no-store` on the link, OpenAPI schemas; crm-api tests that build a `WizardContext` gain `issuerAddressLines` (`parity.test.ts`, `generation.wizardSnapshot.test.ts`, `offerDrafts.generate.test.ts`) | `crm-api/src/offer-drafts/{context,offerDrafts.routes}.ts`, `crm-api/src/offer-drafts/*.test.ts`, `crm-api/src/offers/{generation.ts,parity.test.ts,generation.wizardSnapshot.test.ts}`, `crm-api/src/entity-profiles/**` |
| **I4 upgrade** | backend | DD-60 + `offerTemplates.seedUpgrade.test.ts` (AC-12.5, 12.6, 12.11) | `crm-api/src/offer-templates/wizardSeeds/upgrade.ts`, `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.seed*.test.ts` |
| **L1 fetch + hook** | frontend | `fetchLetterheadBytes`, `getLetterheadDownload(init)`, `useLetterhead` + tests (AC-11.4, 11.7, 11.8); the context type's two new members, and every crm-ui fixture that builds a context (grep `placeOfIssue:`: `OfferWizardPage.test.tsx`, `TemplateEditorWizard.test.tsx`, `DealSalesFlow.test.tsx`, `OfferTemplates.test.tsx`) | `crm-ui/src/lib/crmApi.ts`, `crm-ui/src/lib/types.ts`, `crm-ui/src/components/offerWizard/useLetterhead*.ts`, `crm-ui/src/pages/*.test.tsx` |
| **L2 preview** | frontend | DD-55, DD-56, address notice, strings (en + it) | `crm-ui/src/components/offerWizard/{DocumentPreview,OfferWizard}.tsx`, `crm-ui/src/components/offerWizard/{DocumentPreview,OfferWizard}*.test.tsx`, `crm-ui/src/strings/offerWizard.ts` |
| **L3 pages** | frontend | context mapping, hook wiring, blank-name reason (DD-61), Try view (DD-62), outline "Supplied by the CRM" | `crm-ui/src/pages/OfferWizardPage*.tsx`, `crm-ui/src/components/templateEditor/{TryWizardView,OutlineView}*.tsx`, `crm-ui/src/strings/templates.ts` |
| **E** | frontend | letterhead journey, failure journey, dark theme, revise journey sees it | `shell/e2e/crm-offer-wizard*.spec.ts`, `shell/e2e/helpers/**`, `shell/e2e/fixtures/letterhead-a4.pdf` |
| **D** | orchestrator | ADR candidates 8–10 (adr-writer), changesets (`@operai/crm-api`, `@operai/crm-ui`), T37 re-render for the owner | `docs/adr/20261115-*.md`, `.changeset/*.md` |

**Overlap with the parallel QE D14–D18 frontend fix** (it touches
`crm-ui/src/components/offerWizard/{ValidityDaysInput,CostTableEditor,StepForm,PreviewStep,TemplateStep}.tsx`,
crm-ui strings, maybe the library `Drawer`): this amendment touches **none** of those five components
(the blank-name reason goes through `OfferWizardPage`'s existing `generateBlockedReason`, the notice and the
bands into `DocumentPreview`) and not the `Drawer` (the paper is fluid, so AC-11.6 holds at any Drawer
width). The one shared file is `crm-ui/src/strings/offerWizard.ts`: L2 lands after the D14–D18 fix, or
adds its keys in its own block and rebases, never reorders the file. If that fix also edits
`OfferWizard.tsx`, L2 rebases on it.

### Open questions (for the owner; none blocks the tasks)

- **O8** The "earlier release" of AC-12.5/12.11 exists only in non-production databases (the wizard is
  not on `main`). The plan builds the upgrade as approved (DD-60, small and tested). If no shared
  environment holds v1 seeds, the owner may drop AC-12.5, 12.6 and 12.11 instead.
- **O9** A letterhead whose fonts are not embedded, or whose images need a wasm codec, can be drawn
  incompletely in the preview (R24). Accepted as part of "approximate"? (L0 checks the two real ones.)
- **O10** The editor lists only `issuer` and `issuerAddress` as "supplied by the CRM" (AC-12.1/12.9);
  `reference` and `currency` are also never asked. Add them later for consistency?
- O7 (the spec's: check each entity's address lines before release) is a release item (DD-64).


### L0 findings (2026-11-15, spike T59 — GO; corrections to DD-53 and its sketch)

- **Pinned `pdfjs-dist` 5.7.284** (newest 5.x, published 2026-04-27). Under the exact production CSP of
  `shell/vercel.json` (real header, local static server, crm-ui cross-origin): **0 CSP violations**, no
  Worker/SharedWorker, no WebAssembly, no fetch by pdf.js; welld_ch real letterhead 62 ms cold / 20 ms warm,
  1600×2260 PNG; longest task ≈ 100 ms (R23 threshold 500 ms); lazy chunks ≈ 471 kB gzip (R26).
- **`isEvalSupported` no longer exists** in 5.x (removed; the library contains no eval). Every mention of
  `isEvalSupported:false` in this plan (DD-53, R21, R25, § Security, the sketch) reads "no eval in the pinned
  version"; the AC-11.7 U check asserts the absence of eval/new Function in the pinned build instead of an option.
- **Render with an own alpha-enabled 2D context** (`canvasContext: canvas.getContext('2d')`): given only
  `canvas`, pdf.js opens it with `alpha: false` and a letterhead that paints no page fill renders opaque black.
- `verbosity: ERRORS` silences the "fake worker" console warning.
- Known edge (preview only, PDF unaffected): a PostScript-calculator function makes pdf.js try WebAssembly,
  refused by the CSP inside a try/catch with a JS fallback (one CSP report, no failure); JPX/JBIG2 images are
  skipped. Accepted under O9.
- O9 gap: welld_it has no letterhead in the dev bucket — render the production welld_it file before release.
- Not exercised: Vercel's own CORS headers on crm-ui `/assets/*` (assumed as for the existing chunks).
- R22: `infra/README.md` § offer-wizard rollout → Release checklist carries the bucket-CORS check and rule.


## Amendment OA-3 (2026-11-15, owner) — real A4 pages, and a decoded-size bound on letterheads

> **Source:** spec § Amendments, OA-3 (the owner chose **"Real A4 pages"**): AC-3.2, AC-11.1…11.6,
> AC-11.8, AC-11.9 changed; AC-11.10…11.13 added; O5 closed; spec O8 (the 12 CSS px text floor)
> accepted by the orchestrator under the owner's delegation (decisions.md, "Owner amendment OA-3").
> Folded in: **security round 5 finding M-4** (decisions.md, "Security round 5 fixes (frontend)"),
> a letterhead deflate bomb, routed to crm-api. The owner delegated this plan gate:
> **approved_by: delegated** (2026-11-15). Every choice below is a delegated decision
> (**DD-65…DD-79**, § Delegated decisions) for the owner's review. **79 ACs, all mapped** (§ Test
> strategy). **Supersedes:** DD-55 (paper layout) entirely; DD-56 in its caption and note strings;
> the "Layout per DD-55" wiring of § Amendment (owner) › L; the AC-11.1…11.9 test rows and R23's
> worst case. No spec change is made by the plan; two readings of AC-11.11 are proposed to the PO
> below (O12, O13).

### Verified in the code before writing (OA-3)

The spec's citations of `contractPdf.ts` predate commit 0d7b2169 (security I-7), which moved lines;
the numbers below are today's.

- **Page and frame.** `PAGE_W 595.28` × `PAGE_H 841.89` (`contractPdf.ts:81-82`; 841.89 / 595.28 =
  1.41428, 297 / 210 = 1.41429); `FRAME = { top: 120, bottom: 110, left: 71, right: 71 }` (`:83`);
  `LIMIT = PAGE_H − FRAME.bottom` (`:85`). The letterhead is drawn on **every** page by `newPage()`
  (`:322-332`, `drawPage` at `:327`), the plain header otherwise.
- **Type.** Body `SIZE = 10` pt, `LINE = 1.35` (`:93-94`), section heading `HEADING_SIZE = 10.5`
  (`:95`), title 11.5 (`:815`), tables 9.5 (`:499`), paragraph spacing `after = 0.6 × size`
  (`:434`), section gap `0.7 × SIZE` (`:573`), list `+0.3 × SIZE` (`:457`). Helvetica (standard
  font, `:792-797`).
- **Break rules.** `ensure(h)` starts a page when `y + h > LIMIT` (`:358-360`). Widow/orphan
  (`:418-420`): the first line of a block of ≥ 2 lines needs room for two, the second-to-last of a
  block of ≥ 3 needs room for two — so a 2- or 3-line block never splits. A `###` sub-heading
  keeps two lines after it (`:454`). A list item needs `min(lines, 2)` lines (`:469`) and its
  marker is drawn on its first line's page (`:471-473`). A section heading needs room for itself +
  3 lines, + 4 with the cost table (`:573-576`). **Tables:** rows are never split, the header row
  is kept with the first row **and repeated after a page break** (`:558-566`); **a row taller than
  the frame is clipped**, with a console warning, its excess text lost (`:523-526`). **The
  acceptance block** is kept on one page by `acceptance()` (`:622-643`, the `ensure` at `:627`);
  the line ~617 the caller pointed at is the "•" of `bulletLine()` (`:612-620`), which draws the
  "Allegati:" list, whose heading is kept with ≥ 3 lines (`:838-839`). Each text annex and the
  effort-detail annex start a new page (`:846`, `:858`). Page numbers are drawn last (`:886-893`).
  No rule applies to the page-1 header or the index.
- **Today's preview** (`DocumentPreview.tsx`): one continuous `<article>` — a one-cell grid with
  the A4 box (T65) and the content (`p-6`, `text-sm leading-relaxed`, `max-w-3xl`, DM Sans);
  tables inside `overflow-x-auto` wrappers; a hand-edited section draws `border-l-2`; annexes
  `mt-8 border-t pt-4`; the region is `relative overflow-auto overscroll-contain` with the D19
  height. T65 measured the box at **487.5 px wide** in the 1280 × 800 pane.
- **Styling rules that bind the design** (`operai-ui/eslint/design-tokens.ts`): arbitrary font
  sizes (`text-[N…]`) and colours are refused; inline `style` is allowed for runtime values that
  are not colours. `bg-ink-mid` exists in both themes (`#1c1c2a` dark, `#e8e8f4` light).
- **pdf-lib 1.17.1 inflates on load.** `PDFDocument.load` decodes every object stream
  (`/Type /ObjStm`) and cross-reference stream in full while parsing (`PDFParser.parseIndirectObject`
  → `ByteStream.fromPDFRawStream` → `decodePDFRawStream(…).decode()`), with its own JS
  `FlateStream`, whose `readBlock` inflates a whole deflate block per call. So **crm-api itself
  inflates a bomb** hidden in an object stream: in `checkLetterhead` at confirm
  (`entity-profiles/letterhead.ts:17-41`), and at every generation that embeds a stored letterhead
  (`generation.ts:229` → `renderContractPdf` → `embedPdf` at `:798`, twice: two layout passes, `:881-883`).
  **Finding F-2:** M-4 is also a server-side denial of service (crm-api heap), present since 018.
- **Finding F-3 (outside OA-3 and M-4):** the deal PDFs appended as annexes are loaded the same way
  at generation (`PDFDocument.load(bytes)`, `:874`), up to 5 files / 20 MiB — the same bomb
  class through a different upload. Reported, not planned (the bound of DD-74 is reusable).
- **Finding F-4 (TOCTOU):** the letterhead upload's POST policy lives `POST_EXPIRES_SECONDS = 60` s
  (`lib/storage.ts:52`). Within that minute the uploader can POST again to the same key after
  `confirm` checked it; the profile then points at bytes nobody checked.
- `pdfjs-dist` exposes a per-image pixel cap (`maxImageSize`, default −1 = none) but **no cap on
  inflated stream bytes**: the browser cannot bound M-4 itself.

### P — the paginated preview (US-11 after OA-3)

**Mechanism (DD-65): one continuous flow, a rail of empty floats for the page gaps, and a page layer
behind it.** The document stays ONE DOM tree of real text, exactly the elements the preview renders
today. Pages are a decorative layer behind it. Where a page ends, a **dead zone** — the rest of that
page's frame, its bottom margin, the gap, the next page's top margin — is kept free of text by
**floats placed at the start of the flow**: CSS 2.1 § 9.5 moves a line box that has no room beside a
float down to below it, and moves the border box of a table below a float it would overlap. A
paragraph cut by a page break is therefore still one `<p>` with one text run: its later lines are
simply laid out lower. Nothing is split, copied or inserted inside the text.

```
region  <div role=region tabIndex=0 aria-label="Document preview">          overflow-auto, overscroll-contain,
 │                                                                           scrollbar-gutter: stable; D19 height
 └─ stage  <div class="relative bg-ink-mid">  height = N·H + (N−1)·G + 2·inset (inline, runtime)
     ├─ page layer  <div aria-hidden="true" inert>                            painted first
     │    └─ N × <div class="absolute bg-paper border border-paper-rule">     left = inset, top = inset + k·(H+G), W × H
     │           └─ <img src={blob} alt="" draggable={false} decoding="sync"   only while the letterhead is `shown`;
     │                class="h-full w-full select-none pointer-events-none">   the SAME src on every page
     └─ flow  <article lang={language} class="absolute flow-root text-paper-ink font-body">
          │        left = inset + 71·s, top = inset + 120·s, width = W − 142·s (inline, runtime)
          ├─ rail (first children, aria-hidden, empty):  z₁ F₁ z₂ F₂ … z_{N−1} F_{N−1}
          │      zₖ: float:left; clear:left; width:0;    height = hₖ (px)  — the run of text before break k
          │      Fₖ: float:left; clear:left; width:100%; height = Dₖ (px)  — dead zone k
          └─ the document, as today: salutation, client lines, A.c.a., place and date, title, index,
             opening, sections, acceptance, "Allegati:", text annexes, effort-detail annex, appended-PDF lines
```

Geometry (DD-66, pure `pageGeometry(available, rootFontPx)`): `inset = min(16, available / 20)`;
`W = min(794, available − 2·inset)` (794 CSS px = 210 mm at 96 px/in; a wider pane centres the stack);
`s = W / 595.28`; `H = W · 297 / 210`; the frame `120·s / 110·s / 71·s / 71·s` from the shared
`FRAME` (DD-67); the page body `B = H − 230·s`; the gap `G = 16`. Type: each PDF size *p* (body 10,
sub-heading 10 bold, section and annex heading 10.5, title 11.5, table 9.5) is drawn at
`px(p) = max(12, 0.75 · rootFontPx, p · s)` — never under 12 CSS px (AC-11.13), and doubling the browser's text
size doubles the floor — with an explicit `line-height = 1.35 · px(p)` in px; vertical
spacing, list indent and cell padding use the PDF's point values × `k = px(10) / 10` (they grow with
the floored text, not with the page). Values reach elements as inline `style` through a
`PaperTypeContext` (runtime values; the token lint stays satisfied). Font: `font-body` (DM Sans), kept.

Consequence of the 12 px floor (spec O8, accepted): at the default 1280 × 800 layout (W ≈ 488 px,
`s` ≈ 0.82) body text is 12 px instead of 8.2 px — about 1.46 × the PDF's relative size — so a page
holds roughly half the PDF's text and the preview shows **about twice the PDF's page count**. Body
text is at the PDF's scale only from W ≥ 714 px (tables from 752 px), i.e. on wide screens. See O11.

**Pagination pipeline (DD-69)** — `usePagination` (crm-ui `components/offerWizard/paper/`):

1. **Inputs:** the settled resolution (the existing 250 ms debounce, no new one), the region's
   content width (a `ResizeObserver`, width only, coalesced per frame), the root font size, and
   `document.fonts` `loadingdone` (DM Sans arriving after the first layout). The letterhead state,
   the D19 height and the scroll position are **not** inputs.
2. **Measure on the real tree, never on a copy.** When the layout key (resolution identity, W, root
   font px, font epoch) changes, the flow renders **unpaged** (no rail, no row shifts, no clips) while
   the stage keeps its previous height, so the scroll offset is never clamped. In `useLayoutEffect`
   `collectFlowItems(flow)` reads the `[data-flow]` elements in document order (one forced layout),
   `placeBreaks(items, B)` chooses the breaks, `realize(...)` turns them into styles, and a state
   update re-renders paged. React flushes an update made in a layout effect before the browser
   paints, so the unpaged frame is never shown and the letterhead stays on every page throughout.
3. **Items** are marked on elements the preview already renders (one structural addition: a list
   item's own text sits in a `<div data-flow="text">` before its nested blocks):
   `data-flow="text"` (`p`, `h4`, `h5`, header lines, index entries, "Allegati:" lines,
   appended-PDF lines, a list item's own text), `data-flow="table"` / `"row"` (+ `data-flow-head` on
   the header row), `data-flow="unit"` (the acceptance block), `data-flow-keep="next"` (section,
   sub- and annex headings, the "Edited by hand" mark, the "Indice" and "Allegati:" titles, the
   effort annex's AI note), `data-flow-break="before"` (the first item of each text annex and of the
   effort-detail annex). A text item's line boxes are `top + i·L`, `n = round(height / L)` — exact,
   because every text element has an explicit px line-height and no inline box is taller than a line
   (the missing and pending runs pad horizontally only); an element whose height is not `n·L ± 0.5`
   is re-measured with `Range.getClientRects()` grouped by top (a development warning, never a
   failure).
4. **Budget:** change → pages re-laid ≤ 1 s (AC-3.1, AC-11.11): 250 ms debounce + measure + place +
   the paged layout. Target ≤ 100 ms of work for 30 pages, ≤ 200 ms for 60 (E, informative above
   100 ms; R32).
5. **Guards:** `scrollbar-gutter: stable` on the region so a scrollbar appearing does not change W;
   at most two width-driven re-layouts in a row without another input change (no ping-pong).

```ts
// crm-ui/src/components/offerWizard/paper/geometry.ts — pure (DD-66)
export interface TypeMetrics { fontPx: number; lineHeightPx: number }
export interface PageGeometry {
  width: number; height: number; scale: number; inset: number; gap: 16;
  frame: { top: number; bottom: number; left: number; right: number };   // px
  body: number;                                                           // B, px
  unit: number;                                                           // k: px per pt of spacing
  type: Record<"body" | "subheading" | "heading" | "title" | "table" | "note", TypeMetrics>;
}
export function pageGeometry(available: number, rootFontPx: number): PageGeometry;

// crm-ui/src/components/offerWizard/paper/placement.ts — pure, no DOM (DD-68)
export type FlowItem =
  | { kind: "text"; id: number; top: number; lineHeight: number; lines: number; keepNext: boolean; breakBefore: boolean }
  | { kind: "unit"; id: number; top: number; height: number; keepNext: boolean; breakBefore: boolean }
  | { kind: "table"; id: number; breakBefore: boolean;
      rows: readonly { top: number; height: number; head: boolean; lineHeight: number }[] };
// `top` in px from the flow's top in the UNPAGED layout
export interface Break {
  at: number;                       // unpaged y of the first line / row moved to the next page
  item: number;                     // FlowItem.id
  line?: number;                    // text: index of the first line moved
  row?: number;                     // table: index of the first row moved
  rowLine?: number;                 // an over-tall row split inside (R7)
  relaxed?: "keep" | "widow" | "unit" | "row";   // which rule had to give way, for the dev log and tests
}
export function placeBreaks(items: readonly FlowItem[], body: number): readonly Break[];  // pages = breaks.length + 1

// crm-ui/src/components/offerWizard/paper/collectFlowItems.ts — the only DOM reader (DD-69)
export function collectFlowItems(flow: HTMLElement): FlowItem[];   // [data-flow] in document order, unpaged layout, px from the flow's top

// crm-ui/src/components/offerWizard/paper/realize.ts — pure (DD-70)
export interface PagedLayout {
  pages: number;
  rail: readonly { run: number; dead: number }[];          // zₖ / Fₖ heights, px
  rowShift: ReadonlyMap<string, number>;                    // row key → translateY px (cumulative in its table)
  tableExtra: ReadonlyMap<string, number>;                  // table key → margin-bottom px (sum of its inner breaks)
  rowFirstOnPage: ReadonlySet<string>;                      // rows that draw their own top rule
  cellRail: ReadonlyMap<string, readonly { run: number; dead: number }[]>;  // over-tall row → rail inside each cell
  clip: ReadonlyMap<string, readonly { from: number; to: number }[]>;       // painted element → dead bands in its own box
  stageHeight: number;
}
export function realize(items: readonly FlowItem[], breaks: readonly Break[], geometry: PageGeometry): PagedLayout;
```

**Break rules of `placeBreaks` (DD-68)**, each pinned by vectors; contractPdf's line numbers where it
has the same rule:

- **R1** A page holds what fits: the bottom of its last line or row − the page's first line ≤ `B`.
- **R2** A text block breaks only after line *i* with *i* ≥ 2 and *n − i* ≥ 2 (`:418-420`): a 2- or
  3-line block never splits; a list item's marker is in its first line, so it stays with it.
- **R3** `keepNext`: the item goes to the page of the next item's leading part — the first
  `min(2, n)` lines of a text block, a table's header row and first body row, a unit whole; chained
  `keepNext` items (a heading, then the "Edited by hand" mark) travel together (`:454`, `:573-576`).
- **R4** A table breaks only before a body row other than its first; a row is never split; the
  header row is **not repeated** (the PDF repeats it, `:563-565`, but AC-11.1 says a break adds no
  table structure and AC-11.11 that every line appears exactly once).
- **R5** A unit (the acceptance block) never splits (`:627`).
- **R6** `breakBefore` starts a new page unless the cursor is already at a page's first line (no
  blank page; `:846`, `:858`).
- **R7** When nothing fits on an EMPTY page, the rules give way in this order: R3, then R2, then R5,
  then R4's "never split a row" — a row taller than `B` continues on the next page at a line
  boundary (a rail inside each of its cells, DD-70). Every page holds at least one line; a break is
  never inside a line. (Only below W ≈ 63 px — 126 px with doubled text — can one line exceed `B`;
  that line then crosses its frame. Outside AC-11.13's range.)
- **R8** Every line and row is on exactly one page, in order; an offer with no text has one page.

**Realising the breaks (DD-70).**

- A break at a line, or before a block or a table's first row → a rail pair (`zₖ`, `Fₖ`): `run` =
  the final-layout distance from the previous dead zone's end to the break, `dead` = from the break to
  the next page's frame top, `Dₖ = (inset + (k+1)·(H+G) + 120·s) − (break, final)`, cumulative sums
  included. The first line after it lands exactly on the frame top (the block's top margin stays on
  the previous page, as in the PDF).
- A break between two rows of one table → the cells of the following rows get
  `transform: translateY(Σ D)` and the table `margin-bottom: Σ D`; no rail float lies inside a table
  split this way. Tables use `border-collapse: separate; border-spacing: 0` with rules on the cells,
  so a moved row carries its own rules; the first row on a page draws its top rule.
- An over-tall row (R7) → a rail at the same offsets inside each of its cells (a cell is its own
  formatting context; all cells of a row share its line grid: same padding, same line height,
  top-aligned).
- An element that **paints** across a dead zone — a hand-edited section's left rule, the cells of an
  over-tall row — gets `clip-path: path(...)`, the union of its box minus the bands, so nothing is
  drawn in a margin or a gap (AC-11.10).
- **The flow invariant** (a static class scan in C): inside the flow, nothing but tables and table
  cells establishes a block formatting context — no `overflow` other than visible, no `flex`, `grid`,
  `flow-root`, `inline-block` block containers — and no block other than a hand-edited section paints
  a border or background. Today's `overflow-x-auto` table wrappers go; cells wrap anywhere
  (`wrap-anywhere`), so a long word or a wide table wraps inside the frame (AC-11.10). Annexes lose
  `mt-8 border-t pt-4`: the new page is the separator, as in the PDF.

**Page layer, letterhead, states, theme (DD-71).** The page boxes are `aria-hidden` and `inert`,
`bg-paper` with a `border-paper-rule` edge, on the stage's `bg-ink-mid` (the gap; the page edge stays
visible against it in both themes, AC-11.5). While `shown`, every box holds one `<img>` of the
**same** `blob:` URL — one fetch, one render, one decoded image for every page (AC-11.8). `useLetterhead`
additionally keeps its decoded `HTMLImageElement` referenced for the opening, so a page that appears
paints the decoded image in the same frame (`decoding="sync"`). `pending`, `failed` and `none` draw
the same boxes, empty; the geometry and the breaks never read the state (AC-11.3, AC-11.4: the
letterhead arriving moves nothing). The paper stays light in the dark theme (paper tokens, no
`dark:`/filter/opacity class on a box or an image).

**Bands and copy (DD-72).** The band stays above the region, as chrome (DD-56). `letterheadShown`
becomes the caption of AC-11.2 exactly — en "The letterhead is shown on every page. Page breaks are
approximate: the PDF is the authority.", it "La carta intestata è mostrata su ogni pagina. Le
interruzioni di pagina sono approssimative: fa fede il PDF." The note appended to the `pending`,
`none` and `failed` sentences, today "Layout and page breaks differ in the PDF.", becomes the
caption's second sentence: en "Page breaks are approximate: the PDF is the authority.", it "Le
interruzioni di pagina sono approssimative: fa fede il PDF." The other three sentences are unchanged
(AC-11.3, AC-11.4). No page number, page count or page list anywhere (spec Non-goals).

**Accessibility (part of DD-65/DD-71).** The region stays the one labelled, focusable, scrollable
element (AC-3.1); the flow is the only content in the accessibility tree; the page layer is
`aria-hidden` + `inert`, the rail `aria-hidden` and empty; pagination adds no role, landmark, heading,
list, table or live region; `aria-busy` only during the 250 ms debounce (the re-layout is synchronous).
Selecting or searching across a break meets only the paragraph's own text node: no character is
added (the appended-PDF lines and a placeholder's hidden "Missing:" prefix are copied as today —
neither comes from a break).

**D19, Drawer and narrow widths (DD-69).** `useFitToScrollport` keeps sizing the region's height from
its ancestors; the stage's height changes inside the region and is never observed by it; pagination
observes the region's width only — no feedback between the two. The Drawer renders the same component
at its own width (its region keeps `max-h-[80vh]`); its breaks differ from the pane's, as AC-11.13
allows. At 320 CSS px, `W ≤ available − 2·inset`, so nothing scrolls horizontally.

**Rejected mechanisms (DD-65).**

| Option | Why not |
|---|---|
| Split the DOM into page elements (a paragraph cut into two `<p>`) | Find-in-page does not match across block boundaries, a copy gains a line break, a screen reader announces two paragraphs, the page break adds structure — fails AC-11.1, AC-11.12 |
| Clip windows: each page shows a translated, clipped copy of the flow | The text is in the DOM once per page: a sentence split by a break is visible, findable and selectable in two copies; `inert` copies would hide exactly the part shown — fails AC-11.12 ("found as one sentence", nothing repeated) |
| CSS multi-column with `column-height` / `column-wrap` (Multicol level 2) | Chromium-only at the time of writing; `widows`/`orphans`/`break-*` in multicol differ across engines; the frame-shaped gaps need a second layer anyway |
| CSS Regions, `-moz-element()`, print `@page` | Abandoned, one engine, or print only |
| A hidden measuring copy of the flow | Doubles the DOM, and its layout can drift from the visible tree; the visible tree's own unpaged render is the measurement |
| A PDF preview, or text on a canvas | Declined by the owner; text must stay real (AC-11.1) |

**Main trade-off:** two layouts per settled change, and a strict flow invariant — the preview's own
markup is constrained by the pagination (no BFC inside the flow, no painted blocks that can split
except through `clip-path`), and tables need their own mechanism (row shifts).

**Not adopted, as levers for closer breaks** (each a revisit trigger in R33): Helvetica metrics (a
system font metric-compatible with Helvetica would need a new font token in `@operai/ui`, shipped by
the shell first, ADR 20261114); the PDF's table column widths (a renderer rule that would have to move
into the shared engine, DD-51 procedure); repeating the table header.

### B — the decoded-size bound on letterheads (security M-4, F-2, F-4)

**DD-74 — bound before any parse.** New `crm-api/src/entity-profiles/pdfBounds.ts`, pure (bytes in,
verdict out), run by `checkLetterhead` **before** `PDFDocument.load`:

```ts
export const PDF_BOUNDS = {
  maxDecodedBytes: 32 * 1024 * 1024,        // every stream, decoded, summed (images by declared size)
  maxNonImageDecodedBytes: 8 * 1024 * 1024, // content, fonts, object and xref streams, ICC, functions…
  maxObjects: 10_000,                       // "N G obj" headers found + each object stream's /N
  maxStreams: 1_000,
  maxImagePixels: 40_000_000,               // per image XObject, declared (DCT: also its JPEG SOF)
  maxTotalImagePixels: 64_000_000,
} as const;
export type BoundsReason = "too_complex" | "decoded_too_large" | "image_too_large" | "unbounded_stream";
export type BoundsVerdict =
  | { ok: true; decodedBytes: number; nonImageBytes: number; objects: number; streams: number; imagePixels: number }
  | { ok: false; reason: BoundsReason };
export async function boundPdf(bytes: Uint8Array, limits?: typeof PDF_BOUNDS): Promise<BoundsVerdict>;

// entity-profiles/letterhead.ts
export type LetterheadVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_pdf" | "page_count" | "not_a4" | "unembeddable" | BoundsReason };
```

How it counts, and why it cannot be fooled the way pdf-lib's own load can:
1. Every `N G obj` header in the raw bytes is found (as pdf.js's reconstruction would) and counted;
   each object is parsed with pdf-lib's exported `PDFObjectParser` (it reads a dictionary and slices a
   stream's raw bytes; it decodes nothing). An object stream adds its `/N` to the object count.
2. A stream is decoded **from its data start, not by its `/Length`**: every PDF filter is
   self-delimiting (FlateDecode's final block, LZW's EOD code, RunLength's 128, ASCIIHex `>`,
   ASCII85 `~>`), so a lying indirect `/Length` or an `endstream` forged inside the data cannot hide
   bytes the browser's pdf.js would still inflate.
3. **FlateDecode** through `node:zlib` streaming inflate (`createInflate`, `finishFlush:
   Z_SYNC_FLUSH`), counting output chunks and destroyed the moment a cap is crossed — never pdf-lib's
   `FlateStream`, which inflates a whole deflate block per call. LZW, RunLength, ASCIIHex and ASCII85
   through pdf-lib's decoders (`decodePDFRawStream`) pulled 64 KiB at a time (their blocks are
   bounded: LZW decodes 512 codes per call). Each stage's output feeds the next, counted at every stage
   (`[/FlateDecode /FlateDecode]` cannot double past the cap). A decode error counts what was produced
   and stops: only a cap refuses (a truncated or checksum-broken stream is not a bomb). An indirect
   `/Filter` or `/DecodeParms` is resolved through the header table; unresolvable → `unbounded_stream`.
4. Image codecs (DCTDecode, JPXDecode, JBIG2Decode, CCITTFaxDecode) are not decoded: an image XObject
   contributes `W × H × components × ⌈bpc / 8⌉` (components 4 when unknown) to the decoded total and
   `W × H` to the pixels, from its dictionary; for DCT the larger of the dictionary and the JPEG SOF
   header. A codec stream without `/Width` and `/Height` → `unbounded_stream`.
5. The first cap crossed refuses. Bun's zlib must honour the streaming stop: the bomb tests below
   assert time and memory, not only the verdict.

Caps are constants, justified by measurement in the task: each must be ≥ 4 × the larger of the two
production letterheads' figures (`check-letterheads.ts`, DD-78) and the committed fixture's. The 32 MiB
total admits a full-page 300 dpi RGB image (≈ 26 MB); the 8 MiB non-image cap bounds what pdf.js parses
as operators and fonts on the main thread (2.3 ms/MiB inflate, M-4 measurement: ≈ 75 ms for 32 MiB).

**DD-75 — copy on confirm.** After `checkLetterhead` passes on the bytes crm-api read at confirm,
crm-api writes **those same bytes** (`putObject`, `application/pdf`) under a fresh key of the same shape
(`letterheads/<entity>/<uuid>.pdf`, a uuid never given a POST policy), stores that key on the profile,
then deletes the upload key and (as today) the previous letterhead. A stored letterhead is then exactly
the checked bytes and immutable (closes F-4). `Storage.putObject`'s comment "server-authored bytes
only" becomes "bytes the server authored or checked". No migration; the key pattern is unchanged.

**DD-76 — a stored letterhead is used only once checked in this process.** New
`entity-profiles/letterheadUse.ts`:

```ts
export class LetterheadUnusableError extends ProblemError {}   // 409 letterhead_unusable { entity, reason }
/** The bytes of the entity's stored letterhead, checked by checkLetterhead (memoised per key), or throws 409. */
export async function usableLetterhead(storage: Storage, entity: Entity, key: string): Promise<Uint8Array>;
/** For the link route: checks (once per key) without keeping the bytes. */
export async function assertLetterheadUsable(storage: Storage, entity: Entity, key: string): Promise<void>;
```

A process-local verdict memo keyed by object key (≤ 64 entries; sound because keys are immutable — new
ones by DD-75, older ones because their 60 s POST policy expired long ago); confirm seeds it with `ok`
for the key it stores; refusals are memoised too.

- `GET /entity-profiles/{entity}/letterhead`: memo hit `ok` → sign as today; miss → `getObject(key,
  5 MiB)` → `checkLetterhead` → memo → sign, or **409 `letterhead_unusable` `{ entity, reason }`**, no
  link minted, `Cache-Control: no-store`, one log line `{ entity, reason }`.
- Generation, both routes (`prepareOffer`, `generation.ts:229`): the bytes it reads go through
  `usableLetterhead` before `renderContractPdf`; a refusal is the same 409 before any render — no offer
  row, no object, the wizard draft kept, the legacy dialog stays open.
- The wizard context's `letterhead: boolean` is unchanged (presence). The preview's one attempt gets the
  409 and shows the `failed` band (AC-11.4 "cannot be fetched"), no new state, no retry.
- Settings › Letterhead: the four new upload reasons share one message — en "This PDF is too complex
  to be used as a letterhead. Export it again as a plain PDF.", it "Questo PDF è troppo complesso per
  essere usato come carta intestata. Esportalo di nuovo come PDF semplice."; "Open" on a 409
  `letterhead_unusable` — en "This letterhead can no longer be used. Upload it again.", it "Questa carta
  intestata non può più essere usata. Caricala di nuovo." `lib/offerErrors.ts` `offerFailure` (shared by the wizard's
  Preview step and the legacy dialog, design S10) for 409 `letterhead_unusable` — en "The letterhead of {entity} can no longer be used. Upload it again in
  CRM Settings.", it "La carta intestata di {entity} non può più essere usata. Caricala di nuovo nelle
  Impostazioni CRM."

**DD-77 — client defence in depth.** `renderLetterhead` passes pdf.js `maxImageSize:
40_000_000` (the server's per-image cap; pdf.js skips a larger image, so the preview draws the
letterhead without it and the PDF is unaffected); `letterheadGuard.test.ts` pins the option. pdf.js has
no inflate cap, so the server bound is the control (ADR amendment, candidate 11).

**DD-78 — release audit.** `crm-api/scripts/check-letterheads.ts`, read-only: for each entity profile
with a letterhead, read it, run `checkLetterhead`, print `entity, ok|reason, decodedBytes,
nonImageBytes, objects, streams, imagePixels` — never the key or the bytes. A person runs it against
production **before** the crm-api deploy; a refusal blocks the deploy until the file is replaced (or
the cap is revisited with the owner), because after the deploy that entity's offers would be refused
(R35). `infra/README.md` § offer-wizard rollout gains the item.

API contract changes (OpenAPI updated with each):

| Route | Change |
|---|---|
| `POST /entity-profiles/{entity}/letterhead/confirm` | 422 `letterhead_invalid` `extras.reason` gains `too_complex`, `decoded_too_large`, `image_too_large`, `unbounded_stream`; on 200 the profile's `letterhead` is a fresh key's (the upload key is deleted) |
| `GET /entity-profiles/{entity}/letterhead` | + **409** `letterhead_unusable` `{ entity, reason: BoundsReason \| "not_pdf" \| "page_count" \| "not_a4" \| "unembeddable" }`, `no-store`, nothing minted |
| `POST /deals/{id}/offer-draft/generate`, `POST /deals/{id}/offers` | + **409** `letterhead_unusable` `{ entity, reason }`, before any render; nothing written |

### Proposed spec readings for the PO (not applied; the plan builds them and asks the owner)

- **O12 — AC-11.11 "only the last page may be partly empty".** Read literally, it contradicts the same
  AC's own rules: keeping a heading with its first lines, keeping the acceptance block whole, and
  starting each annex on a new page all leave the page before partly empty (as in the PDF). The plan
  reads it as: *"no page is blank or holds only a gap; a page ends before its frame is full only where a
  rule of this AC moves what follows to the next page; the last page may end anywhere."* Proposed
  wording for the spec, same meaning.
- **O13 — a table row taller than a page.** "A table row is not split" and "a block taller than a page
  continues on the next page" collide for a row taller than the page's frame — rare at the pane's
  width, ordinary at AC-11.13's 200 % zoom or doubled text (a narrow column puts a few words per
  line). The plan lets nothing be lost: such a row continues on the next page at a line boundary (R7).
  The PDF clips such a row and loses its text (`contractPdf.ts:523-526`, finding F-1, pre-existing).
  Proposed wording: *"a table row is not split between two pages unless it is taller than a page's
  frame, in which case it continues on the next page, cut between two lines."*
- The table header row is not repeated after a break in the preview (the PDF repeats it): follows from
  AC-11.1 and AC-11.11 as written; recorded, nothing to amend.

### Open questions (for the owner; none blocks the tasks)

The plan's earlier O8–O10 are plan-local and are **not** the spec's O8–O10; these continue that list.

- **O11 — the 12 px floor costs more than "narrow pages".** Spec O8 was accepted for readability "on
  narrow pages", but the floor binds on every page narrower than ≈ 714 px — including the inline pane of
  the default 1280 × 800 layout (≈ 488 px), where the preview will show about **twice** the PDF's pages,
  and every Drawer. Options: (a) keep 12 px (built); (b) a lower floor for the paper only (10 px puts
  body text at the PDF's scale from ≈ 595 px); (c) a wider pane. One constant; changing it later needs no
  other work.
- **O12, O13** — the two readings above.

### Task hints for `/wellforge:tasks` (re-sync, OA-3 + M-4), with touch globs

Order: (T69 ∥ T70) → T71 → T72; T69 → T73 → T74 → T75; T76 last. Each green on its own.

| Hint | Owner | What | Touch |
|---|---|---|---|
| **T69 paper constants** | backend | DD-67: `crm-api/src/offers/paper.ts` (PAGE, FRAME, SIZE, LINE, HEADING_SIZE, TITLE_SIZE, TABLE_SIZE, the spacing points) and a byte-identical `crm-ui/src/lib/offerPaper/paper.ts`; `contractPdf.ts` imports them instead of its literals (behaviour unchanged: parity, legacy goldens and the draw log byte-equal); a shared-copies group `offerPaper` + the workflow path filter | `crm-api/src/offers/{paper,contractPdf}.ts`, `crm-ui/src/lib/offerPaper/**`, `scripts/check-shared-copies.ts`, `.github/workflows/shared-copies.yml` |
| **T70 decoded-size bound** | backend | DD-74: `pdfBounds.ts` + `checkLetterhead` calls it first; the hostile fixtures built in the test (§ Test strategy, M-4 rows) | `crm-api/src/entity-profiles/{pdfBounds,letterhead}.ts`, `crm-api/src/entity-profiles/*.test.ts` |
| **T71 stored letterheads** | backend | DD-75, DD-76, DD-78: copy on confirm, `usableLetterhead` + memo, 409 `letterhead_unusable` on the link route and both generate routes, OpenAPI, matrix rows, the audit script, `infra/README.md` release item — deps T70 | `crm-api/src/entity-profiles/**`, `crm-api/src/offers/{generation,offers.routes}.ts`, `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offers/*.test.ts`, `crm-api/src/offer-drafts/*.test.ts`, `crm-api/src/lib/storage.ts` (comment only), `crm-api/src/**/matrix.test.ts`, `crm-api/scripts/check-letterheads.ts`, `infra/README.md` |
| **T72 M-4 in the UI** | frontend | DD-77 (`maxImageSize` + guard test), the Settings and wizard strings of DD-76 (en + it) and their error mapping — deps T71 | `crm-ui/src/lib/letterhead/**`, `crm-ui/src/lib/offerErrors*.ts`, `crm-ui/src/components/LetterheadCard.tsx`, `crm-ui/src/strings/{templates,offers,offerWizard}.ts`, `crm-ui/src/pages/OfferTemplates.test.tsx` |
| **T73 pagination core** | frontend | DD-66, DD-68, DD-70: `geometry.ts`, `placement.ts`, `realize.ts` + U vectors and the seeded random invariants; no React — deps T69 | `crm-ui/src/components/offerWizard/paper/**` |
| **T74 paginated preview** | frontend | DD-65, DD-69, DD-71, DD-72: `usePagination`, `collectFlowItems`, the `data-flow` marks, `PaperTypeContext`, the rail, row shifts, clips, the page layer with the letterhead on every page, the decoded image kept by `useLetterhead`, strings; **reworks T65** (DD-55's one A4 box and its tests) — deps T73 | `crm-ui/src/components/offerWizard/{DocumentPreview,MarkedText,OfferWizard}.tsx`, `crm-ui/src/components/offerWizard/{DocumentPreview,OfferWizard}*.test.tsx`, `crm-ui/src/components/offerWizard/useLetterhead*.ts`, `crm-ui/src/components/offerWizard/paper/**`, `crm-ui/src/strings/offerWizard.ts` |
| **T75 e2e pages** | frontend | new `crm-offer-wizard-pages.spec.ts` (AC-11.10…11.13, AC-11.11 invariants, search/copy across a break, widths, 200 % equivalent, doubled text, dark); **reworks T67's letterhead journeys** — one image per page instead of "exactly one image", each page box 297 / 210 instead of "paper taller than the image", the dark-theme pixel check per page — and adds the failure journey through a 409 `letterhead_unusable` (route intercept) — deps T74, T72 | `shell/e2e/crm-offer-wizard*.spec.ts`, `shell/e2e/helpers/**`, `shell/e2e/fixtures/**` |
| **T76 records** | orchestrator | ADR candidates 11–13 (adr-writer), the design.md § Preview pane re-sync (designer: it still describes DD-55's single A4 box and the old caption), glossary (the Letterhead entry still says "the first page of the wizard's preview"), changesets `@operai/crm-api` + `@operai/crm-ui`, AGENTS.md one-liners — deps T75 | `docs/adr/20261115-*.md`, `specs/20261115-crm-offer-wizard/design.md`, `.claude/context/glossary.md`, `.changeset/*.md`, `AGENTS.md` |

T58 gains deps T69…T76. **Landed tasks affected:** T65 (layout and tests superseded — reworked by
T74; its band states, the address notice and the Drawer sharing stay), T67 (letterhead journeys — reworked
by T75), T64 (`useLetterhead` keeps its decoded image — small, inside T74), T59's renderer (one option,
inside T72), T62's link route (extended by T71; its `no-store` stays).
