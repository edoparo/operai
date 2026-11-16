# Golden fidelity fixtures (specs/20261115-crm-offer-wizard, T18; used by T35)

For each of the seven mockup templates, a fixed set of answers and the text the mockup prints
for them. They are the reference for AC-9.1 and AC-9.6: a seed's printed text with the same
answers must equal the golden text except for the six listed differences.

**Fixtures only.** The mockup (`WellD_OperAI_Wizard_Offerte.html`) is untracked and is never
imported, copied or committed; nothing here contains its HTML or scripts.

## Provenance

| | |
|---|---|
| Mockup version | 2026-11-14 (file `WellD_OperAI_Wizard_Offerte.html`, 1 975 971 bytes, modified 14 Nov 2026 16:32) |
| Captured | 2026-11-15 |
| Browser | Chromium 149.0.7827.55, headless, through Playwright 1.61.1 (viewport 1600 × 1000, `file://`) |
| Interface | the mockup's own `window.OfferWizard` API: `setData(answers)`, `missing()`, `goTo('fine')`, then the text of the preview sheet |

## Files

- `answers.<code>.json` — the mockup's complete state (`OfferWizard.getData()` shape, so
  `setData` replays it). Mockup field names are the keys: `tpl` is the mockup template id,
  `f` the scalar fields, `g` the optional blocks (true = kept), `lists` the repeatable lists,
  `rows` the repeatable table rows, `c` the cost-table figures typed in the table (keys are
  the mockup's internal `<block>:<row>:unit|qty|sconto`), `x` the extra cost rows.
- `text.<code>.txt` — what the mockup prints for those answers.
- `variants/answers.<code>-<name>.json` / `variants/text.<code>-<name>.txt` — same, for the
  cases a single file cannot cover (see Coverage).
- `capture.mjs` — regenerates (or `--check`s) every `text.*.txt` from the answers.

Codes: `T1 T2 T3 T4 T5 T6 T1+T3`. The mockup id of `T1+T3` ("Progetto a corpo con SLA") is
`T13`; its answers file says `"tpl": "T13"`.

All answers are complete: `OfferWizard.missing()` is empty and the sheet has no marked
(missing-value) run, for every file. A date is fixed (`2026-11-15`, printed `15.11.2026`) so
the capture is reproducible. Client, address, reference, names and figures are invented.

## Text format

One line per block of the printed sheet, in document order, whitespace collapsed:

- paragraph, heading, annex title and sub-title: its text; a line break inside a block
  (an address, a multi-line answer) is ` / `;
- list item: `- ` (bullet), `1. `, `2. ` … (numbered) or `a. `, `b. ` … (lettered) before the text;
- table: one line per row, `| cell | cell |`, header row first; an empty cell is empty;
- signature lines: their label (`Luogo e data:`), not the rule;
- not included: the logo and the fixed letterhead footer; bold, size and colour.

The first lines (addressee, "A.c.a.", place and date, title with reference), the acceptance
block (`Per accettazione`, `Luogo e data:`, `Firma valida del Cliente:`) and the `Allegati:`
line are the CRM's own in the new product (AC-9.6, first difference), so the comparison drops
or replaces them; everything else is compared.

## Coverage

- Every optional block of every template is kept in at least one file and dropped in at least
  one (blocks that exclude each other — `consuntivo`/`pacchetto`, `nota_corpo`/`nota_partecipante`,
  `rinnovo_tacito`/`no_rinnovo` — are split between the main file and a variant).
- Every optional field and list of every template is filled in at least one file and empty in
  at least one (`variants/*-minimal`: required fields only, blocks at the mockup's defaults),
  except T4's language and hours, which the mockup defaults.
- Cost tables: a per-line unit price and quantity, a repeated row driven by the rows table
  (T2, days × rate), a discount row, an extra row typed in the table, an option line after the
  total (T1), a one-off activation line (T3, T6), decimals (`12'500.50`).
- The SLA profile answers in T3 and T1+T3 are the values the mockup fills when the profile
  is chosen (`Standard` / `Premium`): response times S1–S4 and the hours of cover.

| Code | Main file keeps | Variants |
|---|---|---|
| T1 | all 8 blocks, every optional field | `minimal` |
| T2 | pacchetto, dati_critici, risorse_extra, sconto | `consuntivo`, `minimal` |
| T3 | attivazione, every optional field | `minimal` |
| T4 | allegato_a, conferma, attestato, cancellazione, ai_corso, sconto, nota_partecipante | `corpo` (nota_corpo, no attestato/cancellazione), `minimal` |
| T5 | sconto, scalato | `minimal` |
| T6 | licenza_uso, rivendita, utenze, attivazione, no_rinnovo, dpa | `rinnovo-tacito`, `minimal` |
| T1+T3 | allegato_a, ai, every optional field | `minimal` |

## Capture procedure

1. Put the mockup anywhere readable (it stays outside git).
2. From a folder with `@playwright/test` installed (the repo's `shell/`):
   `MOCKUP=/abs/path/WellD_OperAI_Wizard_Offerte.html node <repo>/crm-api/src/offer-templates/wizardSeeds/golden/capture.mjs`
   — add `--check` to compare instead of writing.
3. The script opens the mockup, replays each `answers.*.json` with `OfferWizard.setData`, refuses
   a file with a missing answer, goes to the last step and writes the sheet's text as above.

The answers were authored once against the mockup's field list (`OfferWizard.fields(id)`) and
checked for completeness the same way. Re-capturing against a newer mockup changes the golden
text; that is a deliberate review, never an automatic update.
