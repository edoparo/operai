# The golden corpus and the conformance runner (T9)

Specs: `specs/20261116-letterhead-service` (AC-1.3 to 1.6, 2.1, 4.5, 5.1, 5.4 to 5.8, 7.7). ADR:
`docs/adr/20261116-a-letterhead-version-pins-its-layout-and-old-layouts-stay-compiled-in.md`.

A letterhead version records the layout it was saved with, and a document rendered with it must have the same
pages, text and line positions for as long as the service exists. This directory is what makes that checkable.

```text
engine/tests/
  corpus/               the test binary (`--test corpus`): golden, pinning, rules, injection, conformance
  golden/
    assets/             logo, small logo, background (PNG) and band (SVG); the file name is the asset id
    letterheads/        LetterheadConfig v1, as the configurator sends it
    fixtures/           a request (content v1) and the letterhead it is rendered on
    layout-1/           the golden record of every fixture on layout 1, and `layout.lock`
    gen.py              writes assets/, letterheads/ and fixtures/ (the large ones are generated)
  conformance/
    pdfium.lock         the pinned pdfium: release, SHA-256 of each archive and of each library
    fetch-pdfium.sh     downloads it, verifies it, unpacks it into `.pdfium/` (git-ignored)
```

## The fixtures

| fixture | what it covers |
|---|---|
| `offer-it`, `offer-en` | a real offer, in each language, on the brand letterhead: first, middle and last page differ (AC-5.4, 5.5, 5.7, 5.8) |
| `offer-it-novariants` | the same offer with the variants off (AC-5.5) |
| `offer-it-background` | the same offer with a background image on every page (AC-7.7) |
| `every-block` | each block type once, in order (AC-1.5) |
| `one-page` | a one-page document uses the first-page variant (AC-5.5) |
| `breaks` | the page-break rules, long words, tables with rows taller than a page, on a letterhead with nothing in its margins (AC-1.6) |
| `inject` | the injection set in every position and in the entity data (AC-2.1, 2.4) |
| `glyphs` | characters inside and outside the bundled fonts (AC-7.5, 7.6) |
| `clusters-stretches` | combining marks, stretches that Unicode forbids breaking, and table headers as tall as a page or taller (AC-1.6, 2.1, 5.1; T38) |
| `overflow-footer`, `overflow-header` | a frame taller than its margin is refused (AC-5.3) |

A golden holds: the page count; for each page, its text and, for each line (the runs that share a baseline), its
baseline `y`, its left edge `x`, its right edge, and the left edge of each further run (cells side by side, the zones of a
footer); the placeholders left empty; the count of characters no font has. Positions are in pt, rounded to 0.001. A
position is compared with a slack of 0.01 pt (0.0035 mm: three orders of magnitude below anything that moves a line),
so that the last bit of a float on another platform does not fail the build; everything else is compared exactly.
For a refused fixture the record is the error code.

## Running

```sh
cd letterhead-api
cargo test -p letterhead-engine --test corpus                       # all of it
cargo test -p letterhead-engine --test corpus golden::              # the goldens
cargo test -p letterhead-engine --test corpus pinning::             # layout 2 beside layout 1 (AC-4.5)
cargo test -p letterhead-engine --test corpus rules::               # AC-1.5, 1.6, 5.x, 7.x read off the corpus
cargo test -p letterhead-engine --test corpus injection::           # property and fuzz tests (AC-2.1)
LETTERHEAD_FUZZ_CASES=3000 LETTERHEAD_FUZZ_SEED=7 cargo test -p letterhead-engine --test corpus random_typst
cargo test -p letterhead-engine --test corpus -- --ignored          # the known defects, which fail (see below)
```

CI runs `cargo test --workspace --locked`, which runs all of this, and then the conformance run on its own, with its
table in the job summary (`.github/workflows/letterhead-api.yml`).

## Re-recording goldens

Never automatic, and never in CI. When a golden fails, the build says which line of which page moved and by how
much. If that is not what you meant to do, fix the change. If it is, which one of these is it?

- **A new fixture, or a new layout** (a new `layouts/<n>/` and its corpus): the old goldens stay as they are.
  `LETTERHEAD_GOLDEN_RECORD=new cargo test -p letterhead-engine --test corpus golden::` writes the records that do not
  exist yet and checks the rest. Review the new files like code.
- **A changed look**: that is a **new layout**, never an edit of layout 1 (ADR, "Adding a layout"). Add the layout, record
  its corpus with `new`, make it the layout a save records. The layout-1 goldens do not change in that commit.
- **A defect of an existing layout, to be fixed for the versions saved with it**:
  `LETTERHEAD_GOLDEN_RECORD=all cargo test -p letterhead-engine --test corpus` overwrites the records that differ and
  `layout-<n>/layout.lock` (the template's SHA-256). This changes how every letterhead version saved with that layout lays
  out, the ADR says the owner must be told, and the commit must say so. The run prints a warning for each layout it changes.

Any other value of `LETTERHEAD_GOLDEN_RECORD` fails, and so does any value when `CI` is set.

`layout-<n>/layout.lock` pins the template's SHA-256 and the Typst version, because a golden corpus only sees what its
fixtures draw: an edit of a branch of the template that no fixture reaches would pass it.

## The conformance runner (AC-1.3, amendments A5 and A6)

For every fixture that renders, the preview and the PDF of one request are compared, the PDF read by pdfium
(`pdfium-render`, a pinned, checksummed binary; tests only): the page counts are equal; for each page the preview's text
equals the text pdfium extracts, whitespace normalised, **except** (A6) when the answer reports N > 0 unprintable
characters (AC-7.6: pdfium cannot read back a character drawn as the font's missing-glyph mark): then the PDF's text of a
page may be the preview's with characters left out, each one a character that page's fonts did not hold (the characters of
its `.notdef` glyphs), never changed, added or reordered, and the fewest such deletions over all the pages of the document
are at most N. A document that reports none is held to equality on every page. The page rasterised from the PDF (at the
preview's size, so its scale) and the preview image differ in no more than 0.5 % of their pixels, a pixel differing when no
pixel within 1 px of it in the other image is within 64/255 on every channel (both directions; a pixel counts if it differs
in either). The **positive control** applies the same metric to the preview moved by 1 pt (down, and right) and requires it
to *exceed* 0.5 % on pages of prose (1 200 characters or more), so that the metric is known to see a 1 pt divergence.

A second check, in the same test (pdfium may be bound once per process), is about combining marks: pdfium reads a few
marks out of order (U+0361, U+0315) and puts a space after others, which no engine can change, so a page with those cannot
be asked to *equal* the preview's text; but a cluster that is written twice or lost shows in the count of each character,
whatever its place and the whitespace. For every mark of U+0300 to U+036F (except U+0344, which the font sets as two
glyphs on two heights and pdfium reads as two characters whatever the PDF says), after a letter and in a table cell, and for
a soft hyphen, the characters of the PDF's text and of the preview's text are the same characters the same number of times.

```sh
sh letterhead-api/engine/tests/conformance/fetch-pdfium.sh      # once; refuses a binary whose digest differs
cargo test -p letterhead-engine --test corpus conformance:: -- --nocapture
LETTERHEAD_CONFORMANCE_VERBOSE=1 ...                            # one line per page
LETTERHEAD_CONFORMANCE_REPORT=report.md ...                     # append the table, in Markdown, to a file
LETTERHEAD_CONFORMANCE_DUMP=dir ...                             # write both texts of every page (raw) into dir
```

Without the library the test prints `CONFORMANCE SKIPPED, NOT PASSED` and passes; `LETTERHEAD_REQUIRE_PDFIUM=1` (set in CI)
makes that a failure. A library that is there and is not the pinned one is refused whatever the flags. It runs on Linux x64
and macOS (arm64, x64); there is no pinned build for another platform.

To move to a newer pdfium, change `PDFIUM_BUILD` and the digests in `pdfium.lock`, and the `pdfium_<build>` feature of
`pdfium-render` in `engine/Cargo.toml`, and read the new margins from the table.

## Defects the corpus found, and what fixed them (T38)

The corpus found three defects of the engine, reported with T9's verdict, each kept as a test that failed until it was
fixed. Layout 1 was not in production, so it was fixed in place (`layout.lock` and the goldens re-recorded; the goldens of
every other fixture did not move):

- `injection::ac_2_1_combining_marks_are_printed_once`: after a letter some marks make Typst cut the cluster into several
  text items that each carry the cluster's whole text, so the page text and the PDF's text had it twice. Fixed in
  `src/layout/clusters.rs`, once, on the laid-out document, so that preview, PDF and page text stay one document.
- `rules::ac_1_6_a_stretch_that_cannot_be_wrapped_is_broken_at_the_margin`: Unicode forbids a line break before `]`, `)`,
  `!`, `?`, `,`, `.`, `:`, `;`, `/` even after a space, and after `(`; a text of such words was one stretch that ran off the
  page. Fixed in the template (`safe-runs`): such a chain of words, when wider than its line, is set one box to a word.
- `rules::ac_1_6_a_table_header_row_taller_than_a_page_stays_inside_the_margins`: a header row as tall as a page was
  repeated on every page and kept whole. Fixed in the template: a header that leaves no room for a line of a row beside it
  is the first row of the table instead, not repeated, and may split like any row taller than a page.
