//! The acceptance criteria that can be read off the corpus: what a render of a fixture must look like, whatever
//! its exact positions (those are the golden's business). AC-1.5, 1.6, 2.4, 5.3 to 5.5, 5.7, 5.8, 7.6, 7.7.

use letterhead_engine::content::{Block, CellBlock, Language, RenderRequest, Table};
use letterhead_engine::layout::CURRENT_LAYOUT;
use letterhead_engine::layout::inspect::{self, Ink, InkKind};
use letterhead_engine::render::Rendered;

use crate::common::*;

const LAYOUT: u32 = CURRENT_LAYOUT;

/// Two positions are the same position (see the golden's epsilon).
fn same(a: f64, b: f64) -> bool {
    (a - b).abs() <= POSITION_EPSILON_PT
}

fn same_lines(a: &[PageLine], b: &[PageLine]) -> Result<(), String> {
    if a.len() != b.len() {
        return Err(format!("{} lines against {}", a.len(), b.len()));
    }
    for (i, (l, r)) in a.iter().zip(b).enumerate() {
        if l.page != r.page || l.text != r.text || !same(l.y, r.y) || !same(l.x, r.x) {
            return Err(format!("line {i}: {l:?} against {r:?}"));
        }
    }
    Ok(())
}

fn text_of(rendered: &Rendered, page: usize) -> String {
    rendered.page_texts().swap_remove(page - 1)
}

/// The `n` and `m` of every `n<sep>m` in a text, `sep` being written between spaces or not: "2 / 4", "pagina 2 di 4".
fn numbers_around(text: &str, sep: &str) -> Vec<(usize, usize)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let sep_words: Vec<&str> = sep.split_whitespace().collect();
    let mut out = Vec::new();
    for window in words.windows(sep_words.len() + 2) {
        if window[1..=sep_words.len()] == sep_words[..]
            && let (Ok(n), Ok(m)) = (window[0].parse(), window[window.len() - 1].parse())
        {
            out.push((n, m));
        }
    }
    out
}

/// The pictures of a page that sit in the header zone: above the top margin (a logo).
fn images_above(rendered: &Rendered, page: usize, limit_pt: f64) -> Vec<Ink> {
    inspect::ink(&rendered.document().pages()[page - 1])
        .into_iter()
        .filter(|i| i.kind == InkKind::Image && i.bottom <= limit_pt + 0.5)
        .collect()
}

// ─── AC-1.5 ──────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn ac_1_5_a_fixture_that_uses_each_block_type_renders_every_block_once_and_in_order() {
    let rendered = rendered_ok(LAYOUT, "every-block");
    let config = letterhead(&fixture("every-block").letterhead);
    let texts = rendered.page_texts();
    let all = texts.join("\n");

    // Heading levels 1 to 3, a paragraph with its three kinds of run, both kinds of list, a table with a header
    // row, an image, a page break: each one's text once, and in the order sent.
    let in_order = [
        "B1 Heading one",
        "B2 Heading two",
        "B3 Heading three",
        "B4 Paragraph with bold, italic and underline runs.",
        "B5 first bullet",
        "B5 second bullet",
        "B6 first step",
        "B6 second step",
        "B7 Name",
        "B7 Note",
        "B7 Qty",
        "B7 alpha",
        "B7 first row",
        "B7 beta",
        "B7 second row",
        "B8 before the break",
        "B9 after the break",
    ];
    let flat = normalise(&all);
    let mut from = 0;
    for needle in in_order {
        assert_eq!(
            flat.matches(needle).count(),
            1,
            "{needle:?} must be on the pages exactly once"
        );
        let at = flat[from..]
            .find(needle)
            .unwrap_or_else(|| panic!("{needle:?} is out of order"));
        from += at + needle.len();
    }
    assert!(
        all.contains("• B5 first bullet"),
        "a bulleted list has bullets"
    );
    assert!(
        all.contains("1. B6 first step") && all.contains("2. B6 second step"),
        "a numbered list has numbers"
    );

    // The page break starts a new page: B9 is the first thing in the body of page 2, and B8 is on page 1.
    assert_eq!(rendered.page_count, 2);
    let body = body_lines(&rendered, &config);
    assert!(
        body.iter()
            .any(|l| l.page == 1 && l.text.contains("B8 before the break"))
    );
    let first_on_page_2 = body
        .iter()
        .find(|l| l.page == 2)
        .expect("page 2 has a body");
    assert_eq!(first_on_page_2.text, "B9 after the break");

    // The image is drawn once, in the body, between the table and the text after it.
    let top = mm(config.margins.top);
    let pictures: Vec<Ink> = inspect::ink(&rendered.document().pages()[0])
        .into_iter()
        .filter(|i| i.kind == InkKind::Image && i.top >= top)
        .collect();
    assert_eq!(
        pictures.len(),
        1,
        "the image block is drawn once: {pictures:?}"
    );
    let y_of = |marker: &str| {
        body.iter()
            .find(|l| l.text.contains(marker))
            .map(|l| l.y)
            .expect(marker)
    };
    assert!(
        pictures[0].top > y_of("B7 beta") && pictures[0].bottom < y_of("B8 before"),
        "the image sits between its neighbours"
    );
    assert!(pictures[0].left >= mm(config.margins.left) - 0.5);
    assert!(pictures[0].right <= A4_WIDTH_PT - mm(config.margins.right) + 0.5);
}

// ─── AC-1.6 ──────────────────────────────────────────────────────────────────────────────────────────────

/// What the request says, in reading order, as the text each piece must print.
#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Heading,
    Paragraph,
    ListItem,
    /// A cell of a table's header row (`row` is `None`) or of one of its rows.
    Cell {
        table: usize,
        row: Option<usize>,
    },
}

#[derive(Debug, Clone)]
struct Unit {
    kind: Kind,
    /// The text with whitespace removed.
    text: String,
    /// A page break comes right before this unit.
    after_break: bool,
    /// What the unit looks like in a failure message.
    label: String,
}

fn units_of(request: &RenderRequest) -> (Vec<Unit>, Vec<Table>) {
    let mut units = Vec::new();
    let mut tables = Vec::new();
    let mut pending_break = false;
    let push = |kind: Kind, text: String, units: &mut Vec<Unit>, pending: &mut bool| {
        if squash(&text).is_empty() {
            return;
        }
        units.push(Unit {
            label: text.chars().take(40).collect(),
            text: squash(&text),
            kind,
            after_break: std::mem::take(pending),
        });
    };
    let runs = |runs: &[letterhead_engine::content::Run]| {
        runs.iter().map(|r| r.text.as_str()).collect::<String>()
    };
    for block in &request.blocks {
        match block {
            Block::PageBreak => pending_break = true,
            Block::Image(_) => {}
            Block::Heading(h) => push(
                Kind::Heading,
                h.text.clone(),
                &mut units,
                &mut pending_break,
            ),
            Block::Paragraph(p) => push(
                Kind::Paragraph,
                runs(&p.runs),
                &mut units,
                &mut pending_break,
            ),
            Block::List(l) => {
                for item in &l.items {
                    push(
                        Kind::ListItem,
                        runs(&item.runs),
                        &mut units,
                        &mut pending_break,
                    );
                }
            }
            Block::Table(t) => {
                let table = tables.len();
                tables.push(t.clone());
                let cells = |row: Option<usize>,
                             cells: &[Vec<CellBlock>],
                             units: &mut Vec<Unit>,
                             pending: &mut bool| {
                    for cell in cells {
                        for part in cell {
                            match part {
                                CellBlock::Paragraph(p) => {
                                    push(Kind::Cell { table, row }, runs(&p.runs), units, pending)
                                }
                                CellBlock::List(l) => {
                                    for item in &l.items {
                                        push(
                                            Kind::Cell { table, row },
                                            runs(&item.runs),
                                            units,
                                            pending,
                                        );
                                    }
                                }
                            }
                        }
                    }
                };
                if let Some(header) = &t.header {
                    cells(None, header, &mut units, &mut pending_break);
                }
                for (r, row) in t.rows.iter().enumerate() {
                    cells(Some(r), row, &mut units, &mut pending_break);
                }
            }
        }
    }
    (units, tables)
}

/// How one unit was laid out: for each page it touches, how many lines of it are there.
#[derive(Debug, Default, Clone)]
struct Placed {
    /// `(page, baselines)`; baselines are distinct y values, 2 pt apart at least.
    pieces: Vec<(usize, Vec<f64>)>,
    /// The unit's first run is the first text of its page (what a page break before it makes).
    first_on_page: bool,
    /// The unit's last run on some page is the last text of that page.
    ends_a_page: bool,
}

impl Placed {
    fn add(&mut self, page: usize, y: f64) {
        match self.pieces.last_mut() {
            Some((p, ys)) if *p == page => {
                if !ys.iter().any(|v| (v - y).abs() < 2.0) {
                    ys.push(y);
                }
            }
            _ => self.pieces.push((page, vec![y])),
        }
    }

    fn pages(&self) -> Vec<usize> {
        self.pieces.iter().map(|(p, _)| *p).collect()
    }
}

fn is_marker(text: &str) -> bool {
    let t = text.trim();
    t == "•"
        || t == "–"
        || (t.ends_with('.') && t.len() > 1 && t[..t.len() - 1].chars().all(|c| c.is_ascii_digit()))
}

/// Walk the document's text, run by run, in reading order (the order of the frame), and give every run to the unit
/// it belongs to. `Err` is the first rule that failed to hold, in words: text that is not what comes next (a line
/// lost, repeated or moved), an empty page.
fn lay_units_on_pages(rendered: &Rendered, units: &[Unit]) -> Result<Vec<Placed>, String> {
    let mut placed = vec![Placed::default(); units.len()];
    let mut u = 0;
    let mut offset = 0;
    let skip_done = |u: &mut usize, offset: &mut usize| {
        while *u < units.len() && *offset >= units[*u].text.len() {
            *u += 1;
            *offset = 0;
        }
    };
    skip_done(&mut u, &mut offset);
    for (index, page) in rendered.document().pages().iter().enumerate() {
        let page_number = index + 1;
        let mut first_of_page = true;
        let mut last_unit = None;
        // How much of a repeated header row has been read on this page.
        let mut header_read = String::new();
        for run in inspect::text_runs(page) {
            let text = squash(&run.text);
            if text.is_empty() {
                continue;
            }
            let first = std::mem::replace(&mut first_of_page, false);
            if u >= units.len() {
                return Err(format!(
                    "page {page_number}: text {:?} after the last piece of the document",
                    run.text
                ));
            }
            let remaining = &units[u].text[offset..];
            if remaining.starts_with(&text) {
                if offset == 0 && first {
                    placed[u].first_on_page = true;
                }
                placed[u].add(page_number, run.y);
                last_unit = Some(u);
                offset += text.len();
                skip_done(&mut u, &mut offset);
                header_read.clear();
            } else if is_marker(&text) {
                // The bullet or number of a list item: a run of its own, not part of the item's text.
            } else if reads_repeated_header(units, u, offset, &text, &mut header_read) {
                // A table's header row, drawn again at the top of a page the table continues on (AC-1.6).
            } else {
                return Err(format!(
                    "page {page_number}: the run {:?} is not what comes next, {:?} ({:?}...)",
                    run.text,
                    units[u].label,
                    &remaining[..remaining.len().min(30)]
                ));
            }
        }
        match last_unit {
            Some(last) => placed[last].ends_a_page = true,
            None => {
                return Err(format!(
                    "page {page_number} has no text of the body: an empty page (AC-1.6)"
                ));
            }
        }
    }
    if u < units.len() {
        return Err(format!(
            "the document ends before {:?} (a line was lost)",
            units[u].label
        ));
    }
    Ok(placed)
}

/// Is `text` the next run of the header row of the table that unit `u` is in, when the table was started on an
/// earlier page? `read` is what of the header was read since the last piece of the body.
fn reads_repeated_header(
    units: &[Unit],
    u: usize,
    offset: usize,
    text: &str,
    read: &mut String,
) -> bool {
    let Kind::Cell { table, .. } = units[u].kind else {
        return false;
    };
    let in_table = |v: &&Unit, header: bool| matches!(v.kind, Kind::Cell { table: t, row } if t == table && (row.is_none() == header));
    let started = offset > 0 || units[..u].iter().any(|v| in_table(&v, false));
    let header: String = units
        .iter()
        .filter(|v| in_table(v, true))
        .map(|v| v.text.as_str())
        .collect();
    if !started || header.is_empty() {
        return false;
    }
    let candidate = format!("{read}{text}");
    if header.starts_with(&candidate) {
        *read = if candidate == header {
            String::new()
        } else {
            candidate
        };
        true
    } else {
        false
    }
}

fn body_rect(config: &letterhead_engine::config::LetterheadConfig) -> (f64, f64, f64, f64) {
    (
        mm(config.margins.left),
        mm(config.margins.top),
        A4_WIDTH_PT - mm(config.margins.right),
        A4_HEIGHT_PT - mm(config.margins.bottom),
    )
}

#[test]
fn ac_1_6_the_breaks_corpus_obeys_every_page_break_rule() {
    let fixture = fixture("breaks");
    let rendered = rendered_ok(LAYOUT, "breaks");
    let config = letterhead(&fixture.letterhead);
    let (units, tables) = units_of(&fixture.request);
    assert!(
        rendered.page_count >= 20,
        "the corpus must run over many pages, not {}",
        rendered.page_count
    );

    // Every piece of text of the request is on the pages, once and in order (no line is lost, none is repeated
    // other than a table's header), and no page is empty.
    let placed = lay_units_on_pages(&rendered, &units).unwrap_or_else(|why| panic!("{why}"));

    // A page break block starts a new page, and two in a row, or one at the start or the end, make no empty page
    // (an empty page fails above).
    for (unit, p) in units.iter().zip(&placed) {
        if unit.after_break {
            assert!(
                p.first_on_page,
                "{:?} follows a page break and must start a page",
                unit.label
            );
        }
    }

    // Nothing is drawn outside the margins: every piece of text and every shape is inside the body (A4, AC-5.1).
    // A long word is broken at the margin and never goes past it.
    let (left, top, right, bottom) = body_rect(&config);
    let tolerance = 1.0;
    for (index, page) in rendered.document().pages().iter().enumerate() {
        assert!(
            (page.frame.width().to_pt() - A4_WIDTH_PT).abs() < 0.01
                && (page.frame.height().to_pt() - A4_HEIGHT_PT).abs() < 0.01
        );
        for ink in inspect::ink(page) {
            assert!(
                ink.left >= left - tolerance
                    && ink.right <= right + tolerance
                    && ink.top >= top - tolerance
                    && ink.bottom <= bottom + tolerance,
                "page {}: {:?} is drawn outside the margins ({left:.1}..{right:.1} x {top:.1}..{bottom:.1})",
                index + 1,
                ink
            );
        }
    }

    // A heading is never the last thing on a page.
    let mut headings = 0;
    for (unit, p) in units.iter().zip(&placed) {
        if unit.kind == Kind::Heading {
            headings += 1;
            assert!(
                !p.ends_a_page,
                "heading {:?} is the last thing on page {}",
                unit.label,
                p.pages().last().expect("placed")
            );
        }
    }
    assert!(headings >= 20, "the corpus must have headings ({headings})");

    // A paragraph or a list item of more than one line never leaves one line alone at the bottom or the top of a
    // page: where it is split, each page has at least two lines of it.
    let mut split_paragraphs = 0;
    for (unit, p) in units.iter().zip(&placed) {
        if matches!(unit.kind, Kind::Paragraph | Kind::ListItem) && p.pieces.len() > 1 {
            split_paragraphs += 1;
            for (page, ys) in &p.pieces {
                assert!(
                    ys.len() >= 2,
                    "{:?} leaves {} line alone on page {page}",
                    unit.label,
                    ys.len()
                );
            }
        }
    }
    assert!(
        split_paragraphs >= 5,
        "the corpus must split paragraphs over pages ({split_paragraphs} do); it no longer tests the widow and orphan rule"
    );

    // A table row is not split between pages unless it is taller than a page; the header row is repeated on every
    // page the table continues on (judged while walking: a header's runs that were not the header's would have
    // failed there); a row taller than a page continues on the next without losing a line (nothing is lost, above).
    let mut taller_than_a_page = 0;
    let body_height = bottom - top;
    for (t, _) in tables.iter().enumerate() {
        let rows = units.iter().zip(&placed).filter_map(|(u, p)| match u.kind {
            Kind::Cell {
                table,
                row: Some(r),
            } if table == t => Some((r, u, p)),
            _ => None,
        });
        let mut by_row: std::collections::BTreeMap<usize, Vec<(&Unit, &Placed)>> =
            Default::default();
        for (r, u, p) in rows {
            by_row.entry(r).or_default().push((u, p));
        }
        for (r, cells) in by_row {
            let mut pages: Vec<usize> = cells.iter().flat_map(|(_, p)| p.pages()).collect();
            pages.sort_unstable();
            pages.dedup();
            // The most lines of any cell of the row, times the line pitch of the body, is the row's height.
            let lines = cells
                .iter()
                .map(|(_, p)| p.pieces.iter().map(|(_, ys)| ys.len()).sum::<usize>())
                .max()
                .unwrap_or(0);
            let pitch = 1.2 * config.look.body.line_spacing * config.look.body.size;
            let height = lines as f64 * pitch;
            if pages.len() > 1 {
                assert!(
                    height >= body_height * 0.9,
                    "table {t} row {r} is split between pages {pages:?} but is only {lines} lines ({height:.0} pt) tall"
                );
                if height > body_height {
                    taller_than_a_page += 1;
                }
            }
        }
    }
    assert!(
        taller_than_a_page >= 2,
        "the corpus must have rows taller than a page that continue on the next ({taller_than_a_page})"
    );

    // The long words of the corpus: broken over several lines, inside the margins (checked above), none of it lost
    // (checked by the walk). W01 is 300 characters of one letter: it cannot be on one line.
    let w01 = units
        .iter()
        .zip(&placed)
        .find(|(u, _)| u.label.starts_with("W01"))
        .expect("W01")
        .1;
    assert!(
        w01.pieces.iter().map(|(_, ys)| ys.len()).sum::<usize>() >= 3,
        "a 300-character word is broken at the margin"
    );
}

#[test]
fn ac_1_6_a_page_break_never_makes_an_empty_page_and_the_last_page_is_not_empty() {
    let rendered = rendered_ok(LAYOUT, "breaks");
    // `breaks` opens with a page break, has a pair of them four times over and ends with one.
    for (i, text) in rendered.page_texts().iter().enumerate() {
        assert!(!text.trim().is_empty(), "page {} is empty", i + 1);
    }
}

// ─── AC-5.3 ──────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn ac_5_3_a_frame_taller_than_its_margin_is_refused_never_drawn() {
    for (name, code) in [
        ("overflow-footer", "footer_overflow"),
        ("overflow-header", "header_overflow"),
    ] {
        let outcome = rendered(LAYOUT, fixture(name));
        assert_eq!(outcome.err().map(|e| e.code()), Some(code), "{name}");
    }
}

// ─── AC-5.4, 5.5, 5.7, 5.8 ───────────────────────────────────────────────────────────────────────────────

#[test]
fn ac_5_4_the_first_page_uses_the_first_variant_and_the_others_the_default() {
    let rendered = rendered_ok(LAYOUT, "offer-it");
    let config = letterhead("brand");
    assert_eq!(rendered.page_count, 4);
    let top = mm(config.margins.top);

    let first = text_of(&rendered, 1);
    assert!(
        first.contains("CF/P.IVA IT00000000000"),
        "page 1 has the first variant's four-line footer:\n{first}"
    );
    assert!(
        !first.contains("Offerta – pagina"),
        "the first variant's header is empty"
    );
    let logos = images_above(&rendered, 1, top);
    assert!(
        logos
            .iter()
            .any(|i| (i.bottom - i.top - mm(12.7)).abs() < 0.5),
        "page 1 has the first variant's 12.7 mm logo: {logos:?}"
    );

    for page in [2, 3] {
        let text = text_of(&rendered, page);
        assert!(
            text.contains(&format!("Offerta – pagina {page} di 4")),
            "page {page} has the default header"
        );
        assert!(
            !text.contains("CF/P.IVA"),
            "page {page} has the default footer, not the brand's"
        );
        let logos = images_above(&rendered, page, top);
        assert!(
            logos
                .iter()
                .any(|i| (i.bottom - i.top - mm(7.0)).abs() < 0.5),
            "page {page} has the default 7 mm logo"
        );
        assert!(
            logos
                .iter()
                .all(|i| (i.bottom - i.top - mm(12.7)).abs() > 0.5),
            "page {page} does not have the first page's logo"
        );
    }

    // Given no first-page variant, page 1 uses the default.
    let plain = rendered_ok(LAYOUT, "offer-it-novariants");
    let text = text_of(&plain, 1);
    assert!(
        text.contains("Offerta – pagina 1 di 4") && !text.contains("CF/P.IVA"),
        "no first variant: page 1 is the default:\n{text}"
    );
}

#[test]
fn ac_5_5_the_last_page_of_a_longer_document_uses_the_last_variant_and_never_moves_a_break() {
    let rendered = rendered_ok(LAYOUT, "offer-it");
    let last = text_of(&rendered, 4);
    assert!(
        last.contains("CF/P.IVA IT00000000000") && last.contains("Offerta – pagina 4 di 4"),
        "the last page has the last variant:\n{last}"
    );

    // A document of one page uses the first-page variant, never the last-page one: the last variant's header
    // says "Offerta – pagina", the first variant's header is empty.
    let one = rendered_ok(LAYOUT, "one-page");
    assert_eq!(one.page_count, 1);
    let text = text_of(&one, 1);
    assert!(
        text.contains("CF/P.IVA IT00000000000") && !text.contains("Offerta – pagina"),
        "one page, first variant:\n{text}"
    );

    // Enabling the first and last variants (and a band behind the first page) changes no page break: the body
    // of every page is where it was with the default variant alone.
    let with = body_lines(&rendered, &letterhead("brand"));
    let without = body_lines(
        &rendered_ok(LAYOUT, "offer-it-novariants"),
        &letterhead("brand-plain"),
    );
    same_lines(&with, &without).unwrap_or_else(|why| panic!("the variants moved the body: {why}"));
}

#[test]
fn ac_5_7_the_page_number_is_the_pages_own_and_the_total_is_the_documents() {
    for name in [
        "offer-it",
        "offer-en",
        "offer-it-novariants",
        "every-block",
        "one-page",
    ] {
        let rendered = rendered_ok(LAYOUT, name);
        let total = rendered.page_count;
        for page in 1..=total {
            let text = text_of(&rendered, page);
            // The footers of the corpus write "{page} / {pages}", the headers "pagina {page} di {pages}" or
            // "page {page} of {pages}". Whichever a page shows is its own number out of the document's total.
            let slash = numbers_around(&text, "/");
            assert!(
                slash.contains(&(page, total)),
                "{name} page {page}: no \"{page} / {total}\" in\n{text}"
            );
            for sep in ["di", "of"] {
                for (n, m) in numbers_around(&text, sep) {
                    assert_eq!(
                        (n, m),
                        (page, total),
                        "{name} page {page}: wrong number in the header"
                    );
                }
            }
        }
    }
}

#[test]
fn ac_5_8_the_same_request_in_english_prints_the_english_texts_with_the_same_breaks() {
    let it = rendered_ok(LAYOUT, "offer-it");
    let en = rendered_ok(LAYOUT, "offer-en");
    assert_eq!(fixture("offer-en").request.language, Language::En);
    assert_eq!(it.page_count, en.page_count);
    for page in [2, 3] {
        assert!(text_of(&it, page).contains(&format!("Offerta – pagina {page} di 4")));
        let english = text_of(&en, page);
        assert!(
            english.contains(&format!("Offer – page {page} of 4")),
            "{english}"
        );
        assert!(!english.contains("pagina"));
    }
    let first = text_of(&en, 1);
    assert!(
        first.contains("VAT IT00000000000") && !first.contains("CF/P.IVA"),
        "the English footer's fiscal line:\n{first}"
    );

    // Layout, margins, rules, logos and fonts are shared by both languages: the body is where it was.
    let config = letterhead("brand");
    same_lines(&body_lines(&it, &config), &body_lines(&en, &config))
        .unwrap_or_else(|why| panic!("the language moved the body: {why}"));
}

// ─── AC-7.7 ──────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn ac_7_7_a_background_is_drawn_first_across_the_page_and_never_moves_a_break() {
    // On every page: a picture of the whole page, first of everything the page draws (under it all).
    let rendered = rendered_ok(LAYOUT, "offer-it-background");
    for (index, page) in rendered.document().pages().iter().enumerate() {
        let ink = inspect::ink(page);
        let first = ink
            .first()
            .unwrap_or_else(|| panic!("page {} draws nothing", index + 1));
        assert_eq!(
            first.kind,
            InkKind::Image,
            "page {}: the background is drawn first",
            index + 1
        );
        assert!(
            // It may bleed a quarter of a millimetre past the page.
            first.left.abs() < 1.0
                && first.top.abs() < 1.0
                && (first.right - A4_WIDTH_PT).abs() < 1.0
                && (first.bottom - A4_HEIGHT_PT).abs() < 1.0,
            "page {}: the background covers the whole page, not {first:?}",
            index + 1
        );
    }
    // The brand's first variant has a band behind page 1 and nothing behind the others.
    let brand = rendered_ok(LAYOUT, "offer-it");
    let first_ink = |page: usize| {
        inspect::ink(&brand.document().pages()[page - 1])
            .into_iter()
            .next()
    };
    let band = first_ink(1).expect("page 1 draws");
    assert!(
        band.kind == InkKind::Image && (band.bottom - A4_HEIGHT_PT).abs() < 1.0,
        "the band covers page 1: {band:?}"
    );
    assert!(
        first_ink(2).is_none_or(|i| i.kind != InkKind::Image || i.bottom < A4_HEIGHT_PT - 1.0),
        "no background behind page 2"
    );

    // The background never moves a page break: the body is where it is without one.
    let config = letterhead("brand-background");
    let with = body_lines(&rendered, &config);
    let without = body_lines(
        &rendered_ok(LAYOUT, "offer-it-novariants"),
        &letterhead("brand-plain"),
    );
    same_lines(&with, &without)
        .unwrap_or_else(|why| panic!("the background moved the body: {why}"));
    // And the text drawn over it stays inside the margins.
    let (left, _, right, _) = body_rect(&config);
    for line in &with {
        assert!(line.x >= left - 0.5 && line.x < right, "{line:?}");
    }
}

// ─── AC-2.4, AC-7.6 ──────────────────────────────────────────────────────────────────────────────────────

#[test]
fn ac_2_4_a_placeholder_written_in_a_paragraph_is_printed_as_typed() {
    let rendered = rendered_ok(LAYOUT, "inject");
    let all = squash(&rendered.page_texts().join("\n"));
    assert!(
        all.contains(&squash("{page}")),
        "{{page}} in a paragraph is printed"
    );
    assert!(
        all.contains(&squash("{legal_name} [x] {{y}} [[z]]")),
        "{{legal_name}}, brackets and doubled braces are printed as typed"
    );
    for page in rendered.document().pages() {
        assert!(
            (page.frame.width().to_pt() - A4_WIDTH_PT).abs() < 0.01
                && (page.frame.height().to_pt() - A4_HEIGHT_PT).abs() < 0.01,
            "the page set-up is unchanged"
        );
    }
    // The entity data is text too: the legal name, which is full of the engine's syntax, is printed in the
    // first page's footer exactly as it was sent.
    assert!(
        squash(&text_of(&rendered, 1)).contains(&squash("#set page(width: 1cm) $x$ *a* {page}"))
    );
}

#[test]
fn ac_7_6_a_character_no_font_holds_is_counted_and_the_render_is_not_refused() {
    let rendered = rendered_ok(LAYOUT, "glyphs");
    // 漢 字 😀 ⨌ ᚠ: five characters outside the five families, drawn as the font's own mark.
    assert_eq!(rendered.unprintable_characters, 5);
    let text = text_of(&rendered, 1);
    assert!(
        text.contains("àèéìòù ÀÈÉÌÒÙ äöüß") && text.contains("€ CHF"),
        "the characters the fonts hold print"
    );
}

/// A word that is wider than its line is broken at the margin (AC-1.6, amendment A4). It was a defect, found by
/// the fuzz: the template broke "words", stretches between spaces, and Typst breaks lines by the Unicode rules
/// (UAX #14), under which no line may break before a closing bracket, `!`, `?`, `,`, `.`, `:`, `;` or `/`, *even
/// after a space* (LB13), nor after an opening bracket (LB14). A text whose every space is followed by one of
/// them is one stretch that cannot be wrapped, however short its words; when the stretch was wider than the
/// line, it was drawn past the right margin and off the page (80 closing brackets, a space, 80 more and a space
/// and 80 more ended at x = 979 pt on a page 595 pt wide). The template now cuts a text into chains of words
/// that Unicode may forbid breaking between, and sets each word of a chain that is wider than the line as a box.
#[test]
fn ac_1_6_a_stretch_that_cannot_be_wrapped_is_broken_at_the_margin() {
    use letterhead_engine::content::validate_request;
    use letterhead_engine::layout::{compile, layout as layout_of};
    let config = letterhead("bare");
    let (_, _, right, _) = body_rect(&config);
    // Each: the text of a paragraph, and of a heading, a list item and a table cell (the widths differ).
    let word = "]".repeat(80);
    let stretches = [
        format!("{word} {word} {word}"),
        "! ".repeat(200),
        "/ ".repeat(200),
        ") ".repeat(200),
        "( ".repeat(200),
        ", ".repeat(200),
        format!("a {word} b {word} c {word}"),
        format!("{} {}", "x".repeat(60), "?".repeat(300)),
        // A no-break space is a character of its word: a run of them cannot be broken either.
        "word\u{a0}".repeat(80),
        // A text with a line break in it: each line is a stretch of its own.
        format!("{word} {word}\n{word} {word}\n{word} {word}"),
    ];
    for text in &stretches {
        let run = serde_json::json!({ "text": text });
        let cell = serde_json::json!([{ "type": "paragraph", "runs": [run] }]);
        let request = validate_request(&serde_json::json!({
            "contentVersion": 1, "entity": "welld_it", "language": "it", "entityData": {},
            "blocks": [
                { "type": "paragraph", "runs": [run] },
                { "type": "heading", "level": 2, "text": text },
                { "type": "list", "items": [{ "runs": [run] }] },
                { "type": "table", "columns": [1, 2], "header": [cell, cell], "rows": [[cell, cell]] },
            ],
        }))
        .unwrap_or_else(|e| panic!("{}", e.code()));
        let compiled = compile(
            layout_of(LAYOUT).expect("layout"),
            &config,
            assets(),
            &request,
        )
        .expect("renders");
        for (n, page) in compiled.document.pages().iter().enumerate() {
            for ink in inspect::ink(page) {
                assert!(
                    ink.right <= right + 1.0,
                    "{:?}: page {}: text ends at x = {:.1} pt, past the right margin at {right:.1} pt",
                    &text[..text.len().min(30)],
                    n + 1,
                    ink.right
                );
            }
        }
        // And nothing is lost: the text is on the pages once, in order.
        let drawn = squash(
            &compiled
                .document
                .pages()
                .iter()
                .map(letterhead_engine::output::page_text)
                .collect::<Vec<_>>()
                .join("\n"),
        );
        assert_eq!(
            drawn.matches(&squash(text)).count(),
            7,
            "the stretch {:?} is printed once in the paragraph, heading, list item and each of the four cells",
            &text[..text.len().min(30)]
        );
    }
}

/// A table header row taller than a page stays inside the margins (AC-1.6, AC-5.1). It was a defect, found by
/// the fuzz: the header row is repeated on every page the table continues on and was kept whole, and nothing
/// stopped it being taller than a page itself: a header cell of 44 lines was drawn below the bottom margin, one of
/// 50 lines off the page. A header that leaves no room on a page for at least a line of a row beside it is now
/// not repeated and is set as the first row of the table, which may split between pages like any row taller than
/// a page, without losing a line. (No refusal code is needed: the document is laid out, as it is for a body row
/// taller than a page.)
#[test]
fn ac_1_6_a_table_header_row_taller_than_a_page_stays_inside_the_margins() {
    use letterhead_engine::content::validate_request;
    use letterhead_engine::layout::{compile, layout as layout_of};
    let config = letterhead("bare");
    let cell =
        |text: &str| serde_json::json!([{ "type": "paragraph", "runs": [{ "text": text }] }]);
    let (_, _, _, bottom) = body_rect(&config);
    // A page body holds 43 lines of the body text: from a header well inside a page, past the edge where it
    // is repeated, to one of three pages.
    for lines in [1, 20, 38, 39, 40, 41, 42, 43, 44, 45, 50, 86, 130] {
        for lead in [false, true] {
            let header: String = (0..lines).map(|i| format!("hdr{i:03}\n")).collect();
            let mut blocks = Vec::new();
            if lead {
                blocks.push(serde_json::json!({ "type": "heading", "level": 1, "text": "Before" }));
            }
            blocks.push(serde_json::json!({
                "type": "table", "columns": [1, 1],
                "header": [cell(&header), cell("side")],
                "rows": [[cell("row one"), cell("a")], [cell("row two"), cell("b")]],
            }));
            let request = validate_request(&serde_json::json!({
                "contentVersion": 1, "entity": "welld_it", "language": "it", "entityData": {},
                "blocks": blocks,
            }))
            .unwrap_or_else(|e| panic!("{}", e.code()));
            let compiled = compile(
                layout_of(LAYOUT).expect("layout"),
                &config,
                assets(),
                &request,
            )
            .expect("renders");
            for (n, page) in compiled.document.pages().iter().enumerate() {
                for ink in inspect::ink(page) {
                    assert!(
                        ink.bottom <= bottom + 1.0,
                        "{lines} lines (lead {lead}): page {}: drawn down to y = {:.1} pt, past the bottom margin at {bottom:.1} pt",
                        n + 1,
                        ink.bottom
                    );
                }
            }
            // Without losing a line: every line of the header is on the pages, once and in order, and so are
            // the rows.
            let text = compiled
                .document
                .pages()
                .iter()
                .map(letterhead_engine::output::page_text)
                .collect::<Vec<_>>()
                .join("\n");
            let mut at = 0;
            for line in (0..lines)
                .map(|i| format!("hdr{i:03}"))
                .chain(["row one", "row two"].map(String::from))
            {
                let found = text[at..].find(&line).unwrap_or_else(|| {
                    panic!("{lines} lines (lead {lead}): {line:?} is lost or out of order")
                });
                at += found + line.len();
            }
            // A header that is repeated is on each page of the table; one that is not, once.
            let times = text.matches("hdr000").count();
            assert!(
                (1..=compiled.document.pages().len()).contains(&times),
                "{lines} lines (lead {lead}): the header's first line is printed {times} times"
            );
        }
    }
}
