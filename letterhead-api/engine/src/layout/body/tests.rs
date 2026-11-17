//! Frame-level checks of the body (task T6). Run: `cargo test -p letterhead-engine layout::body`.
//!
//! Like the frame's, each reads the laid-out frames: lines with their baselines, the boxes of ink. A page's
//! text is the text of those frames in reading order, which is what the preview returns and what the PDF
//! holds (AC-1.3).

use base64::Engine as _;
use serde_json::{Value, json};

use crate::assets::Reason;
use crate::config::{BulletMarker, LetterheadConfig};
use crate::layout::inspect::{self, Ink, InkKind, Line};
use crate::layout::testing::*;
use crate::layout::{Compiled, LayoutError};

// The bare configuration: margins of 25 mm, no frames. The body is 160 x 247 mm.
const LEFT: f64 = 70.8661;
const RIGHT: f64 = 595.2756 - 70.8661;
const TOP: f64 = 70.8661;
const BOTTOM: f64 = 841.8898 - 70.8661;
const BODY_WIDTH: f64 = RIGHT - LEFT;
const BODY_HEIGHT: f64 = BOTTOM - TOP;

fn run(text: &str) -> Value {
    json!({ "text": text })
}

fn para(text: &str) -> Value {
    paragraph(text)
}

fn list(ordered: bool, items: &[String]) -> Value {
    json!({
        "type": "list",
        "ordered": ordered,
        "items": items.iter().map(|t| json!({ "runs": [run(t)] })).collect::<Vec<_>>(),
    })
}

fn cell(text: &str) -> Value {
    json!([{ "type": "paragraph", "runs": [run(text)] }])
}

fn table(columns: &[f64], header: Option<&[&str]>, rows: Vec<Vec<String>>) -> Value {
    let mut t = json!({
        "type": "table",
        "columns": columns,
        "rows": rows.iter().map(|r| r.iter().map(|c| cell(c)).collect::<Vec<_>>()).collect::<Vec<_>>(),
    });
    if let Some(header) = header {
        t["header"] = json!(header.iter().map(|c| cell(c)).collect::<Vec<_>>());
    }
    t
}

fn words(prefix: &str, count: usize) -> String {
    (0..count)
        .map(|j| format!("{prefix}w{j}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn render(config: &LetterheadConfig, blocks: Value) -> Compiled {
    compiled(config, &request("it", blocks))
}

fn bare(blocks: Value) -> Compiled {
    render(&bare_config(), blocks)
}

fn pages(c: &Compiled) -> usize {
    c.document.pages().len()
}

fn lines_of(c: &Compiled, page: usize) -> Vec<Line> {
    inspect::lines(&c.document.pages()[page - 1])
}

fn ink(c: &Compiled, page: usize) -> Vec<Ink> {
    inspect::ink(&c.document.pages()[page - 1])
}

fn all_text(c: &Compiled) -> String {
    (1..=pages(c))
        .flat_map(|p| lines_of(c, p).into_iter().map(|l| l.text))
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalised(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn squashed(text: &str) -> String {
    text.split_whitespace().collect()
}

fn assert_inside_body(c: &Compiled) {
    for page in 1..=pages(c) {
        for item in ink(c, page) {
            assert!(
                item.left >= LEFT - 0.01
                    && item.right <= RIGHT + 0.01
                    && item.top >= TOP - 0.5
                    && item.bottom <= BOTTOM + 0.5,
                "page {page}: {item:?} is outside the body"
            );
        }
    }
}

/// How many lines of each numbered paragraph (by the marker `<prefix><k>w`) are on each page.
fn lines_per_page(c: &Compiled, prefix: &str, count: usize) -> Vec<Vec<usize>> {
    let mut found = vec![vec![0; pages(c)]; count];
    for page in 1..=pages(c) {
        for line in lines_of(c, page) {
            for (k, row) in found.iter_mut().enumerate() {
                if line.text.contains(&format!("{prefix}{k}w")) {
                    row[page - 1] += 1;
                }
            }
        }
    }
    found
}

// ─── AC-1.5 every block, once, in order ─────────────────────────────────────

fn png_base64(width: u32, height: u32) -> String {
    base64::engine::general_purpose::STANDARD.encode(png(width, height, [31, 36, 48]))
}

fn every_block() -> Value {
    json!([
        { "type": "heading", "level": 1, "text": "BLK01 titolo uno" },
        { "type": "heading", "level": 2, "text": "BLK02 titolo due" },
        { "type": "heading", "level": 3, "text": "BLK03 titolo tre" },
        { "type": "paragraph", "runs": [
            { "text": "BLK04 normale, " },
            { "text": "grassetto, ", "bold": true },
            { "text": "corsivo, ", "italic": true },
            { "text": "sottolineato", "underline": true },
        ] },
        list(false, &["BLK05 primo".to_owned(), "BLK06 secondo".to_owned()]),
        list(true, &["BLK07 uno".to_owned(), "BLK08 due".to_owned()]),
        table(&[3.0, 1.0], Some(&["BLK09 voce", "BLK10 euro"]), vec![
            vec!["BLK11 canone".to_owned(), "BLK12 100".to_owned()],
            vec!["BLK13 setup".to_owned(), "BLK14 50".to_owned()],
        ]),
        { "type": "image", "data": png_base64(100, 40), "widthRatio": 0.25 },
        { "type": "paragraph", "runs": [{ "text": "BLK15 prima del salto" }] },
        { "type": "pageBreak" },
        { "type": "paragraph", "runs": [{ "text": "BLK16 dopo il salto" }] },
    ])
}

#[test]
fn ac_1_5_every_block_is_present_once_and_in_order() {
    let c = bare(every_block());
    let text = all_text(&c);
    let mut at = 0;
    for n in 1..=16 {
        let marker = format!("BLK{n:02}");
        assert_eq!(text.matches(&marker).count(), 1, "{marker} once: {text}");
        let found = text.find(&marker).unwrap();
        assert!(found >= at, "{marker} is out of order");
        at = found;
    }
    // The page break starts page 2; the image is an image.
    assert_eq!(pages(&c), 2);
    assert!(lines_of(&c, 2)[0].text.contains("BLK16"));
    assert_eq!(
        ink(&c, 1)
            .iter()
            .filter(|i| i.kind == InkKind::Image)
            .count(),
        1
    );
}

#[test]
fn ac_1_5_runs_keep_their_bold_italic_and_underline() {
    let c = bare(json!([every_block()[3].clone()]));
    let runs = &lines_of(&c, 1)[0].runs;
    let by = |t: &str| runs.iter().find(|r| r.text.contains(t)).unwrap().clone();
    assert_eq!(by("normale").weight, 400);
    assert_eq!(by("grassetto").weight, 700);
    // Italic is a face of its own in Noto Serif: the same text is not as wide in italic as upright.
    let upright = bare(json!([para("corsivo, ")]));
    let width_of = |c: &Compiled| lines_of(c, 1)[0].runs[0].width;
    assert!((by("corsivo").width - width_of(&upright)).abs() > 0.5);
    // Underlined text has a stroke under it.
    assert!(ink(&c, 1).iter().any(|i| i.kind == InkKind::Shape));
}

#[test]
fn ac_1_5_a_table_without_a_header_row_has_no_header_fill() {
    let c = bare(json!([table(
        &[1.0, 1.0],
        None,
        vec![vec!["a".into(), "b".into()]]
    )]));
    assert!(
        !ink(&c, 1)
            .iter()
            .any(|i| i.fill.as_deref() == Some("f1f1f4"))
    );
    let c = bare(json!([table(
        &[1.0, 1.0],
        Some(&["H1", "H2"]),
        vec![vec!["a".into(), "b".into()]]
    )]));
    assert!(
        ink(&c, 1)
            .iter()
            .any(|i| i.fill.as_deref() == Some("f1f1f4"))
    );
}

#[test]
fn ac_1_5_relative_column_widths_and_alignment() {
    let mut t = table(
        &[3.0, 1.0],
        Some(&["Voce", "Euro"]),
        vec![vec!["canone".into(), "100".into()]],
    );
    t["align"] = json!(["left", "right"]);
    let c = bare(json!([t]));
    let line = &lines_of(&c, 1)[1];
    let (left_cell, right_cell) = (&line.runs[0], &line.runs[1]);
    assert!(
        (left_cell.x - (LEFT + 0.25 + 5.0)).abs() < 0.6,
        "{left_cell:?}"
    );
    // The right column is a quarter of the width and its text is flush right inside its padding.
    assert!(
        (right_cell.x + right_cell.width - (RIGHT - 0.25 - 5.0)).abs() < 0.6,
        "{right_cell:?}"
    );
    // The first row's column edge is at three quarters of the table.
    let vertical: Vec<f64> = ink(&c, 1)
        .into_iter()
        .filter(|i| i.kind == InkKind::Shape && i.right - i.left < 1.5 && i.bottom - i.top > 5.0)
        .map(|i| i.left)
        .collect();
    assert!(
        vertical
            .iter()
            .any(|x| (x - (LEFT + 0.25 + (BODY_WIDTH - 0.5) * 0.75)).abs() < 1.0),
        "{vertical:?}"
    );
}

#[test]
fn ac_1_5_a_cell_holds_paragraphs_and_lists() {
    let t = json!({
        "type": "table", "columns": [1.0, 1.0],
        "header": [cell("H1"), cell("H2")],
        "rows": [[
            [{ "type": "paragraph", "runs": [run("CELL-A")] }, { "type": "list", "items": [{ "runs": [run("CELL-B")] }, { "runs": [run("CELL-C")] }] }],
            cell("CELL-D"),
        ]],
    });
    let text = all_text(&bare(json!([t])));
    for m in ["CELL-A", "CELL-B", "CELL-C", "CELL-D"] {
        assert_eq!(text.matches(m).count(), 1, "{m}");
    }
    assert!(text.contains('•'));
}

// ─── AC-1.6 where a page breaks ─────────────────────────────────────────────

#[test]
fn ac_1_6_no_ink_is_outside_the_body() {
    let long = "z".repeat(3000);
    let cells = |w: &str| {
        vec![
            w.to_owned(),
            format!("{w} {long}"),
            "IBAN CH9300762011623852957".to_owned(),
        ]
    };
    let blocks = json!([
        heading(1, &format!("Titolo {long}")),
        para(&format!("Paragrafo {long} fine")),
        list(false, &[format!("Voce {long}"), "altra voce".to_owned()]),
        list(true, &[format!("Voce {long}")]),
        table(&[1.0, 5.0, 1.0], Some(&["a", "b", "c"]), vec![cells("r1"), cells("r2")]),
        { "type": "image", "data": png_base64(400, 800) },
        { "type": "image", "data": png_base64(40, 40), "widthRatio": 1.0 },
    ]);
    let c = bare(blocks);
    assert!(pages(&c) >= 2);
    assert_inside_body(&c);
}

#[test]
fn ac_1_6_a_heading_is_never_the_last_thing_on_a_page() {
    // Fill a page with one-line paragraphs and put a heading and its paragraph after them. For some number of
    // fillers the heading would be the last line of page 1; it must go to page 2 with its paragraph.
    let mut moved = 0;
    for fillers in 26..44 {
        let mut blocks: Vec<Value> = (0..fillers).map(|k| para(&format!("FILL{k}"))).collect();
        blocks.push(heading(2, "HEADING"));
        blocks.push(para(&words("after", 40)));
        let c = bare(json!(blocks));
        for page in 1..=pages(&c) {
            let last = lines_of(&c, page).pop().unwrap();
            assert!(
                !last.text.contains("HEADING"),
                "{fillers} fillers: the heading ends page {page}"
            );
        }
        if pages(&c) >= 2 && lines_of(&c, 2)[0].text.contains("HEADING") {
            moved += 1;
        }
    }
    assert!(
        moved >= 1,
        "the rule was never needed: the test proves nothing"
    );
}

#[test]
fn ac_1_6_a_heading_before_a_table_or_a_list_stays_with_it() {
    for follower in ["table", "list"] {
        let mut moved = 0;
        for fillers in 26..44 {
            let mut blocks: Vec<Value> = (0..fillers).map(|k| para(&format!("FILL{k}"))).collect();
            blocks.push(heading(2, "HEADING"));
            blocks.push(if follower == "table" {
                table(
                    &[1.0, 1.0],
                    Some(&["H1", "H2"]),
                    (0..6)
                        .map(|n| vec![format!("c{n}"), format!("d{n}")])
                        .collect(),
                )
            } else {
                list(
                    false,
                    &(0..6).map(|n| format!("item {n}")).collect::<Vec<_>>(),
                )
            });
            let c = bare(json!(blocks));
            for page in 1..=pages(&c) {
                let last = lines_of(&c, page).pop().unwrap();
                assert!(
                    !last.text.contains("HEADING"),
                    "{follower}, {fillers} fillers: page {page}"
                );
            }
            if pages(&c) >= 2 && lines_of(&c, 2)[0].text.contains("HEADING") {
                moved += 1;
            }
        }
        assert!(moved >= 1, "{follower}: the rule was never needed");
    }
}

#[test]
fn ac_1_6_no_paragraph_leaves_one_line_alone_at_the_bottom_or_the_top_of_a_page() {
    let count = 70;
    let blocks: Vec<Value> = (0..count)
        .map(|k| para(&words(&format!("p{k}"), 14 + (k * 7) % 90)))
        .collect();
    let c = bare(json!(blocks));
    assert!(pages(&c) >= 6);
    let found = lines_per_page(&c, "p", count);
    let mut split = 0;
    for (k, per_page) in found.iter().enumerate() {
        let total: usize = per_page.iter().sum();
        assert!(total >= 1, "paragraph {k} is missing");
        if per_page.iter().filter(|&&n| n > 0).count() > 1 {
            split += 1;
        }
        if total >= 2 {
            for (page, &n) in per_page.iter().enumerate() {
                assert_ne!(
                    n,
                    1,
                    "paragraph {k} ({total} lines): one line alone on page {}",
                    page + 1
                );
            }
        }
    }
    assert!(
        split >= 3,
        "only {split} paragraphs were split by a page: the test proves little"
    );
}

#[test]
fn ac_1_6_no_list_item_leaves_one_line_alone_at_the_bottom_or_the_top_of_a_page() {
    let count = 60;
    let items: Vec<String> = (0..count)
        .map(|k| words(&format!("i{k}"), 12 + (k * 11) % 100))
        .collect();
    let c = bare(json!([list(false, &items)]));
    assert!(pages(&c) >= 4);
    let found = lines_per_page(&c, "i", count);
    let mut split = 0;
    for (k, per_page) in found.iter().enumerate() {
        let total: usize = per_page.iter().sum();
        assert!(total >= 1, "item {k} is missing");
        if per_page.iter().filter(|&&n| n > 0).count() > 1 {
            split += 1;
        }
        if total >= 2 {
            for (page, &n) in per_page.iter().enumerate() {
                assert_ne!(
                    n,
                    1,
                    "item {k} ({total} lines): one line alone on page {}",
                    page + 1
                );
            }
        }
    }
    assert!(split >= 2, "only {split} items were split by a page");
}

fn rows(count: usize) -> Vec<Vec<String>> {
    (0..count)
        .map(|n| vec![format!("R{n}x"), words(&format!("r{n}"), 6 + (n * 5) % 40)])
        .collect()
}

#[test]
fn ac_1_6_a_row_is_not_split_unless_it_is_taller_than_the_body() {
    let count = 120;
    let c = bare(json!([table(
        &[1.0, 4.0],
        Some(&["Voce", "Descrizione"]),
        rows(count)
    )]));
    assert!(pages(&c) >= 4);
    for n in 0..count {
        let on: Vec<usize> = (1..=pages(&c))
            .filter(|&p| {
                lines_of(&c, p).iter().any(|l| {
                    l.text.contains(&format!("R{n}x")) || l.text.contains(&format!("r{n}w"))
                })
            })
            .collect();
        assert_eq!(on.len(), 1, "row {n} is on pages {on:?}");
        // And every word of it is there once.
        let tokens: Vec<String> = all_text(&c).split_whitespace().map(str::to_owned).collect();
        for j in 0..(6 + (n * 5) % 40) {
            assert_eq!(
                tokens.iter().filter(|t| **t == format!("r{n}w{j}")).count(),
                1,
                "r{n}w{j}"
            );
        }
    }
}

#[test]
fn ac_1_6_the_header_row_is_repeated_on_every_page_the_table_continues_on() {
    let c = bare(json!([table(
        &[1.0, 4.0],
        Some(&["Voce", "Descrizione"]),
        rows(120)
    )]));
    assert!(pages(&c) >= 4);
    for page in 1..=pages(&c) {
        let first = &lines_of(&c, page)[0].text;
        assert!(
            first.starts_with("Voce") && first.contains("Descrizione"),
            "page {page}: {first}"
        );
    }
}

#[test]
fn ac_1_6_a_row_taller_than_the_body_continues_on_the_next_page_without_losing_a_line() {
    let tall = (0..1500)
        .map(|j| format!("t{j}"))
        .collect::<Vec<_>>()
        .join(" ");
    let t = table(
        &[1.0],
        Some(&["Voce"]),
        vec![
            vec!["PRIMA".to_owned()],
            vec![tall],
            vec!["ULTIMA".to_owned()],
        ],
    );
    let c = bare(json!([t]));
    assert!(pages(&c) >= 3, "{}", pages(&c));
    // The header is repeated where the row continues.
    for page in 1..=pages(&c) {
        assert!(
            lines_of(&c, page)[0].text.starts_with("Voce"),
            "page {page}"
        );
    }
    // Every word of the tall row is there exactly once and in order.
    let text = normalised(&all_text(&c));
    let mut at = 0;
    for j in 0..1500 {
        let word = format!(" t{j} ");
        let found = text[at..]
            .find(&word)
            .unwrap_or_else(|| panic!("t{j} is lost or out of order"));
        at += found + word.len() - 1;
    }
    assert_eq!(text.matches("PRIMA").count(), 1);
    assert_eq!(text.matches("ULTIMA").count(), 1);
    assert_inside_body(&c);
}

#[test]
fn ac_1_6_a_page_break_starts_a_page_and_never_produces_an_empty_one() {
    let brk = json!({ "type": "pageBreak" });
    let cases: Vec<(&str, Vec<Value>, usize)> = vec![
        ("one", vec![para("A"), brk.clone(), para("B")], 2),
        (
            "two in a row",
            vec![para("A"), brk.clone(), brk.clone(), para("B")],
            2,
        ),
        (
            "five in a row",
            vec![
                para("A"),
                brk.clone(),
                brk.clone(),
                brk.clone(),
                brk.clone(),
                brk.clone(),
                para("B"),
            ],
            2,
        ),
        ("first", vec![brk.clone(), para("A")], 1),
        ("last", vec![para("A"), brk.clone()], 1),
        ("only", vec![brk.clone()], 1),
        ("none", vec![], 1),
    ];
    for (name, blocks, expected) in cases {
        let c = bare(json!(blocks));
        assert_eq!(pages(&c), expected, "{name}");
        if name != "only" && name != "none" {
            for page in 1..=pages(&c) {
                assert!(
                    !lines_of(&c, page).is_empty(),
                    "{name}: page {page} is empty"
                );
            }
        }
    }
}

#[test]
fn ac_1_6_a_page_break_after_a_full_page_makes_no_empty_page() {
    // The break lands exactly where the page ends, for some number of fillers.
    for fillers in 26..44 {
        let mut blocks: Vec<Value> = (0..fillers).map(|k| para(&format!("FILL{k}"))).collect();
        blocks.push(json!({ "type": "pageBreak" }));
        blocks.push(para("DOPO"));
        let c = bare(json!(blocks));
        for page in 1..=pages(&c) {
            assert!(
                !lines_of(&c, page).is_empty(),
                "{fillers} fillers: page {page} is empty"
            );
        }
    }
}

#[test]
fn ac_1_6_a_word_that_fits_a_line_is_never_split() {
    // A word of 40 characters is narrower than the line: wherever the line ends, it moves to the next whole.
    let word = "abcdefghijklmnopqrstuvwxyzabcdefghijklmn";
    for lead in 0..60 {
        let text = format!("{} {word} fine", "a".repeat(lead));
        let c = bare(json!([para(&text)]));
        assert!(normalised(&all_text(&c)).contains(word), "{lead}");
    }
}

#[test]
fn ac_1_6_a_word_wider_than_the_line_is_broken_at_the_margin() {
    let long = "x".repeat(2000);
    let c = bare(json!([para(&format!("prima {long} dopo"))]));
    assert_inside_body(&c);
    let lines = lines_of(&c, 1);
    assert!(lines.len() > 5);
    // Lines are filled to within a piece of the margin; none is cut short at one piece.
    for line in &lines[1..lines.len() - 1] {
        assert!(line.right > RIGHT - 70.0, "{line:?}");
    }
    // The text is what was sent: nothing added, nothing lost.
    let joined: String = lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(joined.matches('x').count(), 2000);
    assert!(joined.contains("prima ") && joined.contains(" dopo"));
    assert!(!joined.contains('-') && !joined.contains('\u{200b}'));
}

#[test]
fn ac_1_6_a_word_wider_than_its_table_cell_is_broken_at_the_cell() {
    let iban = "CH93007620116238529571234567890123456789";
    let c = bare(json!([table(
        &[1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        None,
        vec![vec![
            "a".into(),
            "b".into(),
            iban.into(),
            "d".into(),
            "e".into(),
            "f".into()
        ],]
    )]));
    assert_inside_body(&c);
    // Cells are 75 pt wide; the IBAN needs several lines, in its own cell's x range.
    let in_cell: Vec<Line> = lines_of(&c, 1)
        .into_iter()
        .filter(|l| l.text.contains("CH93") || l.text.contains("5678"))
        .collect();
    assert!(!in_cell.is_empty());
    let cell_left = LEFT + 0.25 + (BODY_WIDTH - 0.5) / 6.0 * 2.0;
    let cell_right = cell_left + (BODY_WIDTH - 0.5) / 6.0;
    for run in lines_of(&c, 1)
        .iter()
        .flat_map(|l| l.runs.iter())
        .filter(|r| r.text.chars().all(|c| c.is_ascii_alphanumeric()) && r.text.len() > 3)
    {
        assert!(
            run.x >= cell_left - 0.6 && run.x + run.width <= cell_right + 0.6,
            "{run:?}"
        );
    }
    // The pieces of the IBAN, top to bottom in its cell, are the IBAN.
    let mut pieces: Vec<(f64, f64, String)> = lines_of(&c, 1)
        .iter()
        .flat_map(|l| l.runs.iter())
        .filter(|r| r.x >= cell_left - 0.6 && r.x + r.width <= cell_right + 0.6)
        .map(|r| (r.y, r.x, r.text.clone()))
        .collect();
    pieces.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let text: String = pieces.into_iter().map(|p| p.2).collect();
    assert_eq!(text.trim(), iban);
}

#[test]
fn ac_1_6_a_word_wider_than_a_list_item_is_broken_inside_its_item() {
    let long = "q".repeat(300);
    let c = bare(json!([list(true, &[format!("uno {long}")])]));
    assert_inside_body(&c);
    let marker = lines_of(&c, 1)[0].runs[0].clone();
    for line in lines_of(&c, 1) {
        for run in line.runs.iter().filter(|r| r.text.starts_with('q')) {
            assert!(run.x > marker.x + marker.width, "{run:?}");
        }
    }
}

#[test]
fn ac_1_6_a_long_word_in_a_heading_and_in_a_styled_run_is_broken_too() {
    let long = "m".repeat(500);
    let blocks = json!([
        heading(1, &format!("Titolo {long}")),
        { "type": "paragraph", "runs": [{ "text": long.clone(), "bold": true, "style": "title" }] },
    ]);
    assert_inside_body(&bare(blocks));
}

#[test]
fn ac_1_6_a_200_000_character_word_stays_inside_the_margins() {
    let long = "x".repeat(200_000);
    let c = bare(json!([para(&long)]));
    assert!(pages(&c) >= 30, "{}", pages(&c));
    assert_inside_body(&c);
    let total: usize = (1..=pages(&c))
        .map(|p| {
            lines_of(&c, p)
                .iter()
                .map(|l| l.text.matches('x').count())
                .sum::<usize>()
        })
        .sum();
    assert_eq!(total, 200_000, "no character is lost");
}

#[test]
fn ac_1_6_urls_and_hyphenated_words_break_where_typst_can_and_keep_their_text() {
    let url = format!("https://example.com/{}", "percorso/".repeat(80));
    let c = bare(json!([para(&format!("vedi {url} fine"))]));
    assert_inside_body(&c);
    let joined: String = lines_of(&c, 1)
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("");
    assert!(joined.contains(&url), "{joined}");
}

// ─── AC-2.1 text is data ─────────────────────────────────────────────────────

const INJECTION: [&str; 14] = [
    "#set page(width: 1cm)",
    "#read(\"/etc/hostname\")",
    "$x^2$",
    "*a*",
    "_a_",
    "`code`",
    "@label",
    "<label>",
    "\\",
    "{page} {legal_name}",
    "#image(\"/etc/passwd\") #plugin(\"x.wasm\") #eval(\"1\") #json(\"/data.json\") ]#panic(\"x\")[",
    "#import \"@preview/a:0.1.0\": *",
    "= not a heading\n- not a list",
    "// not a comment /* nor this */",
];

#[test]
fn ac_2_1_the_injection_set_is_printed_verbatim_wherever_text_goes() {
    let mut blocks = Vec::new();
    for s in INJECTION {
        let s = s.replace('\n', " ");
        blocks.push(heading(2, &s));
        blocks.push(para(&s));
        blocks.push(list(false, std::slice::from_ref(&s)));
        blocks.push(list(true, std::slice::from_ref(&s)));
        blocks.push(table(&[1.0], Some(&[&s]), vec![vec![s.clone()]]));
    }
    let c = bare(json!(blocks));
    // A line may break after a slash or a bracket, where Typst can: compare without any whitespace.
    let text = squashed(&all_text(&c));
    for s in INJECTION {
        let s = squashed(&s.replace('\n', " "));
        // Heading, paragraph, two lists, the table's header and its cell: six places.
        assert_eq!(text.matches(&s).count(), 6, "{s}");
    }
    for page in c.document.pages() {
        assert_eq!(page.frame.width().to_pt().round(), 595.0);
        assert_eq!(page.frame.height().to_pt().round(), 842.0);
    }
    assert!(c.accesses.iter().all(|a| a.served), "{:?}", c.accesses);
    assert!(!c.accesses.is_empty());
    assert!(
        c.accesses.iter().all(|a| a.path == "/data.json"),
        "{:?}",
        c.accesses
    );
    assert_inside_body(&c);
}

#[test]
fn ac_2_1_a_run_s_text_is_data_in_every_position() {
    let runs: Vec<Value> = INJECTION
        .iter()
        .map(|s| json!({ "text": s.replace('\n', " "), "bold": true, "underline": true }))
        .collect();
    let c = bare(json!([{ "type": "paragraph", "runs": runs }]));
    let text = squashed(&all_text(&c));
    for s in INJECTION {
        assert_eq!(
            text.matches(&squashed(&s.replace('\n', " "))).count(),
            1,
            "{s}"
        );
    }
}

#[test]
fn ac_2_4_a_placeholder_in_the_body_is_printed_as_typed() {
    let c = bare(json!([
        heading(1, "{legal_name} {page}"),
        para("{pages} {{x}} [VAT: {vat}]")
    ]));
    let text = all_text(&c);
    assert!(text.contains("{legal_name} {page}"));
    assert!(text.contains("{pages} {{x}} [VAT: {vat}]"));
}

// ─── AC-5.9 the look ─────────────────────────────────────────────────────────

fn styled_config() -> LetterheadConfig {
    let mut config = bare_config();
    config.look.headings[0].size = 22.0;
    config.look.headings[0].bold = false;
    config.look.headings[0].color = "112233".to_owned();
    config.look.headings[1].size = 16.0;
    config.look.headings[1].color = "445566".to_owned();
    config.look.headings[2].size = 9.0;
    config.look.headings[2].color = "778899".to_owned();
    config
}

#[test]
fn ac_5_9_each_heading_level_has_its_size_weight_and_colour() {
    let c = render(
        &styled_config(),
        json!([
            heading(1, "UNO"),
            heading(2, "DUE"),
            heading(3, "TRE"),
            para("corpo")
        ]),
    );
    let find = |t: &str| {
        lines_of(&c, 1)
            .into_iter()
            .find(|l| l.text == t)
            .unwrap()
            .runs[0]
            .clone()
    };
    let (one, two, three, body) = (find("UNO"), find("DUE"), find("TRE"), find("corpo"));
    assert_eq!(
        (one.size, one.weight, one.fill.as_deref()),
        (22.0, 400, Some("112233"))
    );
    assert_eq!(
        (two.size, two.weight, two.fill.as_deref()),
        (16.0, 700, Some("445566"))
    );
    assert_eq!(
        (three.size, three.weight, three.fill.as_deref()),
        (9.0, 700, Some("778899"))
    );
    assert_eq!(one.family, "Ubuntu");
    assert_eq!(body.family, "Noto Serif");
    assert_eq!(body.size, 10.5);
}

#[test]
fn ac_5_9_the_body_size_and_line_spacing_set_the_baseline_distance() {
    for (size, spacing) in [(8.0, 1.0), (10.5, 1.2), (14.0, 2.0)] {
        let mut config = bare_config();
        config.look.body.size = size;
        config.look.body.line_spacing = spacing;
        let c = render(&config, json!([para(&words("p", 120))]));
        let lines = lines_of(&c, 1);
        assert!(lines.len() >= 4);
        for pair in lines.windows(2).take(3) {
            let pitch = pair[1].y - pair[0].y;
            assert!(
                (pitch - size * 1.2 * spacing).abs() < 0.05,
                "{size} x {spacing}: pitch {pitch}"
            );
        }
        assert_eq!(lines[0].size, size);
    }
}

#[test]
fn ac_5_9_the_table_look_header_fill_borders_and_colour() {
    let t = table(
        &[1.0, 1.0],
        Some(&["H1", "H2"]),
        vec![vec!["a".into(), "b".into()], vec!["c".into(), "d".into()]],
    );
    let mut config = bare_config();
    config.look.table.header_fill = "abcdef".to_owned();
    config.look.table.border_color = "123456".to_owned();
    let c = render(&config, json!([t.clone()]));
    let boxes = ink(&c, 1);
    let fills: Vec<&Ink> = boxes
        .iter()
        .filter(|i| i.fill.as_deref() == Some("abcdef"))
        .collect();
    assert_eq!(fills.len(), 2, "one fill per header cell");
    let strokes = boxes
        .iter()
        .filter(|i| i.stroke.as_deref() == Some("123456"))
        .count();
    assert!(strokes >= 6, "{strokes}");
    // No borders: no stroke at all, and the fill is still there.
    config.look.table.borders = false;
    let c = render(&config, json!([t]));
    let boxes = ink(&c, 1);
    assert_eq!(boxes.iter().filter(|i| i.stroke.is_some()).count(), 0);
    assert_eq!(
        boxes
            .iter()
            .filter(|i| i.fill.as_deref() == Some("abcdef"))
            .count(),
        2
    );
}

#[test]
fn ac_5_9_the_list_marker_is_a_bullet_or_a_dash() {
    let items = ["uno".to_owned(), "due".to_owned()];
    let mut config = bare_config();
    let c = render(&config, json!([list(false, &items)]));
    assert!(all_text(&c).contains('•') && !all_text(&c).contains('–'));
    config.look.bullet_marker = BulletMarker::Dash;
    let c = render(&config, json!([list(false, &items)]));
    assert!(all_text(&c).contains('–') && !all_text(&c).contains('•'));
    // A numbered list is numbered, whatever the marker.
    let c = render(&config, json!([list(true, &items)]));
    assert!(all_text(&c).contains("1.") && all_text(&c).contains("2."));
}

#[test]
fn ac_5_9_the_fonts_of_the_letterhead_are_the_fonts_of_the_blocks() {
    let mut config = bare_config();
    config.fonts.body = crate::config::Font::DmMono;
    config.fonts.heading = crate::config::Font::Syne;
    let c = render(
        &config,
        json!([
            heading(1, "Titolo"),
            para("corpo"),
            list(false, &["voce".to_owned()])
        ]),
    );
    let families: Vec<String> = lines_of(&c, 1)
        .iter()
        .map(|l| l.runs.last().unwrap().family.clone())
        .collect();
    assert_eq!(families, vec!["Syne", "DM Mono", "DM Mono"]);
}

// ─── AC-1.7 named styles ─────────────────────────────────────────────────────

fn styled(kind: &str, style: &str) -> Value {
    let mut block = match kind {
        "heading" => heading(2, "SAMPLE"),
        "paragraph" => para("SAMPLE"),
        "list" => list(false, &["SAMPLE".to_owned()]),
        "table" => table(&[1.0], Some(&["HEAD"]), vec![vec!["SAMPLE".to_owned()]]),
        "image" => json!({ "type": "image", "data": png_base64(40, 20), "widthRatio": 0.3 }),
        _ => unreachable!(),
    };
    block["style"] = json!(style);
    block
}

fn sample(c: &Compiled) -> inspect::TextRun {
    lines_of(c, 1)
        .into_iter()
        .flat_map(|l| l.runs)
        .find(|r| r.text.contains("SAMPLE"))
        .unwrap()
}

#[test]
fn ac_1_7_every_style_on_every_block_type_renders_and_none_is_an_error() {
    for kind in ["heading", "paragraph", "list", "table", "image"] {
        for style in [
            "plain", "muted", "small", "right", "center", "title", "missing",
        ] {
            let c = bare(json!([styled(kind, style)]));
            assert_eq!(pages(&c), 1, "{kind} {style}");
            assert_inside_body(&c);
        }
    }
}

#[test]
fn ac_1_7_muted_small_title_and_missing_change_the_text() {
    for kind in ["paragraph", "list", "table"] {
        let plain = sample(&bare(json!([styled(kind, "plain")])));
        let muted = sample(&bare(json!([styled(kind, "muted")])));
        assert_eq!(muted.fill.as_deref(), Some("595c69"), "{kind}");
        assert_ne!(plain.fill, muted.fill);
        let small = sample(&bare(json!([styled(kind, "small")])));
        assert!(
            (small.size - plain.size * 0.85).abs() < 0.01,
            "{kind}: {}",
            small.size
        );
        let title = sample(&bare(json!([styled(kind, "title")])));
        assert_eq!(
            (title.size, title.weight, title.family.as_str()),
            (20.0, 700, "Ubuntu"),
            "{kind}"
        );
        let missing_doc = bare(json!([styled(kind, "missing")]));
        let missing = sample(&missing_doc);
        assert_eq!(missing.fill.as_deref(), Some("b35c00"), "{kind}");
        assert!(
            ink(&missing_doc, 1)
                .iter()
                .any(|i| i.fill.as_deref() == Some("fff3bf")),
            "{kind}: highlighted"
        );
        assert!(
            !ink(&bare(json!([styled(kind, "plain")])), 1)
                .iter()
                .any(|i| i.fill.as_deref() == Some("fff3bf"))
        );
    }
}

#[test]
fn ac_1_7_a_heading_takes_the_text_styles_on_top_of_its_level() {
    let plain = sample(&bare(json!([styled("heading", "plain")])));
    assert_eq!((plain.size, plain.weight), (12.0, 700));
    assert_eq!(
        sample(&bare(json!([styled("heading", "title")]))).size,
        20.0
    );
    assert_eq!(
        sample(&bare(json!([styled("heading", "muted")])))
            .fill
            .as_deref(),
        Some("595c69")
    );
    assert!((sample(&bare(json!([styled("heading", "small")]))).size - 12.0 * 0.85).abs() < 0.01);
}

#[test]
fn ac_1_7_right_and_center_align_a_paragraph_a_heading_and_an_image_and_a_list_s_items() {
    for kind in ["heading", "paragraph"] {
        let right = sample(&bare(json!([styled(kind, "right")])));
        assert!(
            (right.x + right.width - RIGHT).abs() < 0.6,
            "{kind}: {right:?}"
        );
        let centre = sample(&bare(json!([styled(kind, "center")])));
        assert!(
            ((centre.x + centre.width / 2.0) - (LEFT + RIGHT) / 2.0).abs() < 0.6,
            "{kind}: {centre:?}"
        );
    }
    let right = sample(&bare(json!([styled("list", "right")])));
    assert!((right.x + right.width - RIGHT).abs() < 0.6, "{right:?}");
    for (style, expected) in [
        ("right", RIGHT),
        ("center", (LEFT + RIGHT) / 2.0),
        ("plain", LEFT),
    ] {
        let c = bare(json!([styled("image", style)]));
        let image = ink(&c, 1)
            .into_iter()
            .find(|i| i.kind == InkKind::Image)
            .unwrap();
        let at = match style {
            "right" => image.right,
            "center" => (image.left + image.right) / 2.0,
            _ => image.left,
        };
        assert!((at - expected).abs() < 0.6, "{style}: {image:?}");
    }
}

#[test]
fn ac_1_7_a_style_with_no_effect_changes_nothing() {
    // `right` and `center` on a table, `title` and `missing` on an image: accepted, nothing happens.
    let plain = bare(json!([styled("table", "plain")]));
    for style in ["right", "center"] {
        let c = bare(json!([styled("table", style)]));
        assert_eq!(
            inspect::text_runs(&c.document.pages()[0]),
            inspect::text_runs(&plain.document.pages()[0]),
            "{style}"
        );
    }
    let plain = bare(json!([styled("image", "plain")]));
    for style in ["muted", "small", "title", "missing"] {
        let c = bare(json!([styled("image", style)]));
        assert_eq!(ink(&c, 1), ink(&plain, 1), "{style}");
    }
}

#[test]
fn ac_1_7_a_run_s_own_style_comes_first_and_the_block_s_style_is_added() {
    let c = bare(json!([{
        "type": "paragraph", "style": "small",
        "runs": [{ "text": "uno " }, { "text": "due", "style": "muted" }, { "text": " tre", "style": "title" }],
    }]));
    let runs = &lines_of(&c, 1)[0].runs;
    let by = |t: &str| runs.iter().find(|r| r.text.contains(t)).unwrap().clone();
    assert!((by("uno").size - 10.5 * 0.85).abs() < 0.01);
    assert_eq!(by("due").fill.as_deref(), Some("595c69"));
    assert!((by("due").size - 10.5 * 0.85).abs() < 0.01);
    // The run's own style wins where both set the same thing: `title` fixes the size at 20 pt.
    assert!((by("tre").size - 20.0).abs() < 0.01, "{}", by("tre").size);
}

// ─── images ──────────────────────────────────────────────────────────────────

fn image_ink(c: &Compiled) -> Ink {
    let mut images: Vec<Ink> = ink(c, 1)
        .into_iter()
        .filter(|i| i.kind == InkKind::Image)
        .collect();
    assert_eq!(images.len(), 1, "{images:?}");
    images.remove(0)
}

#[test]
fn an_image_is_the_full_width_unless_the_request_says_less() {
    let full = image_ink(&bare(
        json!([{ "type": "image", "data": png_base64(100, 40) }]),
    ));
    assert!(
        (full.right - full.left - BODY_WIDTH).abs() < 0.1,
        "{full:?}"
    );
    assert!((full.bottom - full.top - BODY_WIDTH * 0.4).abs() < 0.1);
    let half = image_ink(&bare(
        json!([{ "type": "image", "data": png_base64(100, 40), "widthRatio": 0.5 }]),
    ));
    assert!((half.right - half.left - BODY_WIDTH / 2.0).abs() < 0.1);
    assert!((half.left - LEFT).abs() < 0.1);
}

#[test]
fn an_image_taller_than_the_body_is_scaled_down_to_fit_it_keeping_its_proportions() {
    // 10 x 40: at the full width it would be 1 800 pt high.
    let tall = image_ink(&bare(
        json!([{ "type": "image", "data": png_base64(10, 40) }]),
    ));
    assert!(tall.bottom - tall.top <= BODY_HEIGHT, "{tall:?}");
    assert!(tall.bottom - tall.top > BODY_HEIGHT - 2.0);
    assert!(((tall.right - tall.left) / (tall.bottom - tall.top) - 0.25).abs() < 0.001);
    let c = bare(json!([{ "type": "image", "data": png_base64(10, 40) }]));
    assert_eq!(pages(&c), 1);
    assert_inside_body(&c);
}

#[test]
fn an_image_that_does_not_fit_the_rest_of_a_page_goes_to_the_next_whole() {
    let mut blocks: Vec<Value> = (0..30).map(|k| para(&format!("FILL{k}"))).collect();
    blocks.push(json!({ "type": "image", "data": png_base64(100, 80), "widthRatio": 0.8 }));
    let c = bare(json!(blocks));
    assert_eq!(pages(&c), 2);
    assert_eq!(
        ink(&c, 1)
            .iter()
            .filter(|i| i.kind == InkKind::Image)
            .count(),
        0
    );
    assert_eq!(
        ink(&c, 2)
            .iter()
            .filter(|i| i.kind == InkKind::Image)
            .count(),
        1
    );
}

#[test]
fn an_svg_image_is_drawn_from_its_bytes_and_a_jpeg_by_its_signature() {
    let svg = base64::engine::general_purpose::STANDARD.encode(band_svg());
    let c = bare(json!([{ "type": "image", "data": svg, "widthRatio": 0.5 }]));
    let mut images: Vec<&str> = c
        .accesses
        .iter()
        .map(|a| a.path.as_str())
        .filter(|p| p.starts_with("/img/"))
        .collect();
    images.dedup();
    assert_eq!(images, vec!["/img/0.svg"]);
    assert_eq!(image_ink(&c).kind, InkKind::Image);
}

#[test]
fn images_are_files_of_the_world_numbered_in_the_order_of_their_blocks() {
    let c = bare(json!([
        { "type": "image", "data": png_base64(10, 10), "widthRatio": 0.2 },
        para("tra le due"),
        { "type": "image", "data": png_base64(20, 10), "widthRatio": 0.2 },
    ]));
    let mut paths: Vec<&str> = c.accesses.iter().map(|a| a.path.as_str()).collect();
    paths.sort_unstable();
    paths.dedup();
    assert_eq!(paths, vec!["/data.json", "/img/0.png", "/img/1.png"]);
    assert!(c.accesses.iter().all(|a| a.served));
}

#[test]
fn an_image_that_the_asset_rules_refuse_is_refused_at_its_data_member() {
    let request = request(
        "it",
        json!([para("uno"), { "type": "image", "data": base64::engine::general_purpose::STANDARD.encode(b"not an image") }]),
    );
    assert_eq!(
        try_compile(&bare_config(), &request).err(),
        Some(LayoutError::Image {
            path: "/blocks/1/data".to_owned(),
            reason: Reason::UnsupportedFormat
        })
    );
    // An SVG with a script is refused, not drawn and not stripped.
    let script = br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
    let request = crate::layout::testing::request(
        "it",
        json!([{ "type": "image", "data": base64::engine::general_purpose::STANDARD.encode(script) }]),
    );
    assert_eq!(
        try_compile(&bare_config(), &request).err(),
        Some(LayoutError::Image {
            path: "/blocks/0/data".to_owned(),
            reason: Reason::SvgScript
        })
    );
}

#[test]
fn an_svg_that_reaches_for_a_file_gets_nothing() {
    // F5: Typst would resolve a relative href through the World. The asset rules refuse it first.
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="../img/0" width="10" height="10"/></svg>"#;
    let request = crate::layout::testing::request(
        "it",
        json!([{ "type": "image", "data": base64::engine::general_purpose::STANDARD.encode(svg) }]),
    );
    assert!(matches!(
        try_compile(&bare_config(), &request),
        Err(LayoutError::Image { .. })
    ));
}

#[test]
fn an_empty_paragraph_is_one_empty_line() {
    let c = bare(json!([para("sopra"), { "type": "paragraph", "runs": [] }, para("sotto")]));
    let lines = lines_of(&c, 1);
    assert_eq!(lines.len(), 2);
    // The gap holds the empty line: more than one line of distance and paragraph spacing.
    assert!(
        lines[1].y - lines[0].y > 2.0 * 10.5 * 1.2 + 9.0,
        "{} -> {}",
        lines[0].y,
        lines[1].y
    );
}

#[test]
fn a_table_with_many_columns_leaves_every_column_room_for_a_glyph() {
    let columns: Vec<f64> = (0..40).map(|_| 1.0).collect();
    let cells: Vec<String> = (0..40).map(|n| format!("{}", n % 10)).collect();
    let c = bare(json!([table(&columns, None, vec![cells])]));
    assert_inside_body(&c);
    assert_eq!(
        all_text(&c).matches(|ch: char| ch.is_ascii_digit()).count(),
        40
    );
}

// ─── the template places text as str and reads nothing a caller chose ───────

#[test]
fn the_template_calls_no_eval_no_plugin_and_no_read_of_a_caller_s_path() {
    let code: String = crate::layout::LAYOUT_1
        .template()
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    // Functions that run text as code, load code, or read a file or a program.
    for name in [
        "eval",
        "plugin",
        "read",
        "xml",
        "csv",
        "yaml",
        "toml",
        "cbor",
        "bytes",
        "import",
        "include",
        "sys.",
        "str.from-unicode",
        "raw",
        "cite",
        "bibliography",
    ] {
        let call = regex_free_call(&code, name);
        assert!(!call, "the template uses `{name}`");
    }
    // `json` reads the data file and nothing else; every image path comes from the data.
    assert_eq!(code.matches("json(").count(), 1);
    assert!(code.contains("json(\"/data.json\")"));
    for call in code
        .match_indices("image(")
        .filter(|(i, _)| {
            !code[..*i].ends_with(|c: char| c.is_alphanumeric() || c == '-' || c == '_')
        })
        .map(|(i, _)| &code[i..])
    {
        let argument = call["image(".len()..].split([',', ')']).next().unwrap();
        assert!(
            ["v.logo.path", "v.background", "b.path"].contains(&argument.trim()),
            "image({argument}) names a path that is not the data's"
        );
    }
}

/// Whether `name` appears as a call or a keyword: preceded by a character that cannot be part of a name, and
/// followed by `(` (or, for the keywords, by a space or a quote).
fn regex_free_call(code: &str, name: &str) -> bool {
    code.match_indices(name).any(|(i, _)| {
        let before = code[..i].chars().last();
        let after = code[i + name.len()..].chars().next();
        let boundary =
            before.is_none_or(|c| !(c.is_alphanumeric() || c == '-' || c == '_' || c == '.'));
        boundary && after.is_some_and(|c| c == '(' || c == '.' && name == "sys")
    })
}

// ─── the bound that spares a row its measuring is sound ──────────────────────

/// Rows whose height is near the body's, in columns of every width and with every kind of content: whatever
/// the template judges, no ink may leave the body and no word may be lost.
#[test]
fn a_row_that_is_nearly_a_page_tall_never_overflows_whichever_way_it_is_judged() {
    for (name, columns) in [
        ("narrow", vec![1.0, 1.0, 1.0, 10.0]),
        ("wide", vec![3.0, 1.0]),
    ] {
        for count in (24..=66).step_by(7) {
            let narrow_words = (0..count)
                .map(|j| format!("n{j}"))
                .collect::<Vec<_>>()
                .join(" ");
            let mut row = vec![vec![String::new(); columns.len()]; 1];
            row[0][0] = narrow_words.clone();
            let mut blocks = vec![table(
                &columns,
                Some(&["H"; 4][..columns.len()]),
                vec![row[0].clone(), row[0].clone()],
            )];
            // The same words as a list in a cell, and with hard breaks, and as a title.
            let items: Vec<Value> = (0..count / 2)
                .map(|j| json!({ "runs": [run(&format!("n{j} n{j}"))] }))
                .collect();
            let mut listed = json!({
                "type": "table", "columns": columns,
                "rows": [(0..columns.len()).map(|i| if i == 0 {
                    json!([{ "type": "list", "ordered": true, "items": items }])
                } else { cell("x") }).collect::<Vec<_>>()],
            });
            // (In a narrow column an item is a few points wide and its words are broken: not countable.)
            let lists = name == "wide";
            if lists {
                blocks.push(listed.clone());
                listed["style"] = json!("title");
                blocks.push(listed);
            }
            let broken = (0..count)
                .map(|j| format!("n{j}"))
                .collect::<Vec<_>>()
                .join("\n");
            blocks.push(table(
                &columns,
                None,
                vec![
                    (0..columns.len())
                        .map(|i| {
                            if i == 0 {
                                broken.clone()
                            } else {
                                "y".to_owned()
                            }
                        })
                        .collect(),
                ],
            ));
            let c = bare(json!(blocks));
            assert_inside_body(&c);
            let tokens: Vec<String> = all_text(&c).split_whitespace().map(str::to_owned).collect();
            for j in 0..count {
                // The first table has two rows and the last block one row: three rows of the words.
                assert_eq!(
                    tokens.iter().filter(|t| **t == format!("n{j}")).count(),
                    3 + usize::from(lists && j < count / 2) * 4,
                    "{name} {count}: n{j}"
                );
            }
        }
    }
}
