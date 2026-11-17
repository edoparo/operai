//! What a person writes is data, never code (US-2; AC-2.1, AC-2.2, AC-2.4): a property test over the injection
//! set of the spec, and a fuzz test over random Typst syntax, each in every place a text can go.
//!
//! The property, for a text `s` in a position (a heading, a run of a paragraph, a list item, a table cell, an
//! entity value, a line of the letterhead's own header or footer):
//!
//! 1. the render succeeds, or is refused for a reason that is about size (`footer_overflow`: a long value in a
//!    footer): it never fails inside the engine (`render_failed`) and never panics;
//! 2. **verbatim**: the page's text is the text of the same document with a harmless word in `s`'s place, with
//!    `s` in its place (whitespace aside). `*a*` is not made bold, `$x^2$` is not maths, `#read(...)` reads
//!    nothing: they are printed;
//! 3. **style and structure unchanged**: every page is A4, nothing is drawn outside the margins, and every
//!    (font, weight, slant, size, colour) used is one that the harmless word is drawn in (`*a*` as bold, `_a_` as
//!    italic, `#set text(size: 30pt)` as a bigger size, a raw block as the mono font, would each show here);
//! 4. **closed file system** (AC-2.2): the only file the World was asked for, and served, is `/data.json`.
//!
//! A text that the engine's own validation refuses (a control character, a brace in a letterhead's text) is
//! not rendered, and is counted: the test says how many of each it skipped, and fails if it skipped most.
//!
//! Fuzz: `LETTERHEAD_FUZZ_CASES` (default 300) random texts from a seed, `LETTERHEAD_FUZZ_SEED` (default fixed).
//! A failure prints the case's number, its seed and the text, so that it can be replayed.

use std::collections::BTreeSet;

use letterhead_engine::config::validate_config;
use letterhead_engine::content::validate_request;
use letterhead_engine::layout::inspect;
use letterhead_engine::layout::{self, CURRENT_LAYOUT, FRAME_EDGE_MM, LayoutError, compile};
use letterhead_engine::output::page_text;
use serde_json::{Value, json};

use crate::common::*;

/// What stands in a position in the document that every case is compared with.
const MARK: &str = "QQbenignQQ";
/// The furthest, in thousandths of a pt, that any frame text of any case was drawn past its margin sideways.
static WORST_OVERSHOOT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const BODY: &str = "corpo";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Position {
    Heading,
    Plain,
    Bold,
    Italic,
    Mixed,
    ListItem,
    TableHeader,
    TableCell,
    LegalName,
    AddressLine,
    Contacts,
    Vat,
    Iban,
    /// A line of the letterhead's own footer (configuration text, not a request's).
    FrameLine,
}

impl Position {
    const ALL: [Position; 14] = [
        Position::Heading,
        Position::Plain,
        Position::Bold,
        Position::Italic,
        Position::Mixed,
        Position::ListItem,
        Position::TableHeader,
        Position::TableCell,
        Position::LegalName,
        Position::AddressLine,
        Position::Contacts,
        Position::Vat,
        Position::Iban,
        Position::FrameLine,
    ];

    /// The text goes in the footer, not the body.
    fn in_footer(self) -> bool {
        matches!(
            self,
            Position::LegalName
                | Position::AddressLine
                | Position::Contacts
                | Position::Vat
                | Position::Iban
                | Position::FrameLine
        )
    }

    fn block(self, s: &str) -> Option<Value> {
        let run = |text: &str, bold: bool, italic: bool| {
            let mut r = json!({ "text": text });
            if bold {
                r["bold"] = json!(true);
            }
            if italic {
                r["italic"] = json!(true);
            }
            r
        };
        let cell = |text: &str| json!([{ "type": "paragraph", "runs": [{ "text": text }] }]);
        Some(match self {
            Position::Heading => json!({ "type": "heading", "level": 2, "text": s }),
            Position::Plain => json!({ "type": "paragraph", "runs": [run(s, false, false)] }),
            Position::Bold => json!({ "type": "paragraph", "runs": [run(s, true, false)] }),
            Position::Italic => json!({ "type": "paragraph", "runs": [run(s, false, true)] }),
            Position::Mixed => {
                json!({ "type": "paragraph", "runs": [run(s, false, false), run(" ", false, false), run(s, true, false), run(" ", false, false), run(s, false, true)] })
            }
            Position::ListItem => json!({ "type": "list", "items": [{ "runs": [{ "text": s }] }] }),
            Position::TableHeader => {
                json!({ "type": "table", "columns": [1], "header": [cell(s)], "rows": [[cell(BODY)]] })
            }
            Position::TableCell => {
                json!({ "type": "table", "columns": [1], "header": [cell(BODY)], "rows": [[cell(s)]] })
            }
            _ => return None,
        })
    }

    fn entity_data(self, s: &str) -> Value {
        match self {
            Position::LegalName => json!({ "legalName": s }),
            Position::AddressLine => json!({ "addressLines": [s] }),
            Position::Contacts => json!({ "contacts": s }),
            Position::Vat => json!({ "vat": s }),
            Position::Iban => json!({ "iban": s }),
            _ => json!({}),
        }
    }
}

fn line(text: &str) -> Value {
    json!({ "text": { "it": text, "en": text }, "size": 8, "bold": false, "color": "595c69" })
}

/// The `bare` letterhead, with a footer (for the positions that are in one) tall enough for any value.
fn config_for(position: Position, s: &str) -> Value {
    let mut config: Value = serde_json::from_str(
        &std::fs::read_to_string(data_dir().join("letterheads/bare.json")).expect("bare.json"),
    )
    .expect("json");
    if position.in_footer() {
        // A zone holds four lines at most (A1): the fifth value goes in the right zone.
        let (left, right) = if position == Position::FrameLine {
            (vec![line(s)], vec![])
        } else {
            (
                ["{legal_name}", "{address}", "{contacts}", "{vat}"]
                    .map(line)
                    .to_vec(),
                vec![line("{iban}")],
            )
        };
        config["margins"]["bottom"] = json!(60);
        config["variants"]["default"]["footer"] = json!({
            "valign": "bottom",
            "rule": { "show": false, "thicknessPt": 0.5, "color": "e50339" },
            "left": left, "center": [], "right": right,
        });
    }
    config
}

fn request_for(position: Position, s: &str) -> Value {
    let mut blocks = vec![json!({ "type": "paragraph", "runs": [{ "text": BODY }] })];
    blocks.extend(position.block(s));
    json!({
        "contentVersion": 1, "entity": "welld_it", "language": "it",
        "entityData": position.entity_data(s), "blocks": blocks,
    })
}

type Signature = BTreeSet<(String, u16, bool, i64, Option<String>)>;

/// What a document drew, as the tests need it.
struct Drawn {
    text: String,
    signature: Signature,
}

enum Outcome {
    /// The engine's own validation refused the text (a control character, a brace in a letterhead's text).
    Skipped,
    /// A frame did not fit its margin.
    Overflow,
    Drawn(Drawn),
}

fn draw(position: Position, s: &str) -> Result<Outcome, String> {
    // A letterhead's own text is a template: `{page}` is the page number there, by design, and `[...]` a
    // segment that disappears with a missing value (AC-6.1, AC-6.6). Its syntax is not what is being injected.
    if position == Position::FrameLine && s.contains(['{', '}', '[', ']']) {
        return Ok(Outcome::Skipped);
    }
    let config_json = config_for(position, s);
    let Ok(config) = validate_config(&config_json) else {
        return Ok(Outcome::Skipped);
    };
    let Ok(request) = validate_request(&request_for(position, s)) else {
        return Ok(Outcome::Skipped);
    };
    let layout = layout::layout(CURRENT_LAYOUT).expect("the current layout");
    let compiled = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        compile(layout, &config, assets(), &request)
    })) {
        Ok(Ok(compiled)) => compiled,
        Ok(Err(LayoutError::Overflow { .. })) => return Ok(Outcome::Overflow),
        Ok(Err(other)) => {
            return Err(format!(
                "the engine failed on it: {} ({other:?})",
                other.code()
            ));
        }
        Err(_) => return Err("the engine panicked on it".to_owned()),
    };

    // AC-2.2: the World was asked for /data.json and nothing else, and served it.
    let asked: BTreeSet<(&str, bool)> = compiled
        .accesses
        .iter()
        .map(|a| (a.path.as_str(), a.served))
        .collect();
    if asked != BTreeSet::from([("/data.json", true)]) {
        return Err(format!("the World was asked for {asked:?}"));
    }

    // The page set-up and the margins are unchanged.
    let (left, top, right, bottom) = (
        mm(config.margins.left),
        mm(config.margins.top),
        A4_WIDTH_PT - mm(config.margins.right),
        A4_HEIGHT_PT - mm(config.margins.bottom),
    );
    let mut signature = Signature::new();
    for (n, page) in compiled.document.pages().iter().enumerate() {
        if (page.frame.width().to_pt() - A4_WIDTH_PT).abs() > 0.01
            || (page.frame.height().to_pt() - A4_HEIGHT_PT).abs() > 0.01
        {
            return Err(format!(
                "page {} is not A4 ({} x {} pt)",
                n + 1,
                page.frame.width().to_pt(),
                page.frame.height().to_pt()
            ));
        }
        for ink in inspect::ink(page) {
            // The body keeps to the margins. A header or a footer keeps `edge` from the page's edge (the
            // template's own rule): a long unbreakable value in a zone has been measured to run a little past
            // the margin (see `WORST_OVERSHOOT`), which the spec does not forbid for a frame.
            let (min_x, max_x) = if position.in_footer() {
                (mm(FRAME_EDGE_MM), A4_WIDTH_PT - mm(FRAME_EDGE_MM))
            } else {
                (left, right)
            };
            let past_margin = (left - ink.left).max(ink.right - right).max(0.0);
            if position.in_footer() {
                WORST_OVERSHOOT.fetch_max(
                    (past_margin * 1000.0) as u64,
                    std::sync::atomic::Ordering::Relaxed,
                );
            }
            let outside_sideways = ink.left < min_x - 1.0 || ink.right > max_x + 1.0;
            let outside_body =
                ink.top < top - 1.0 || (!position.in_footer() && ink.bottom > bottom + 1.0);
            if outside_sideways || outside_body || ink.bottom > A4_HEIGHT_PT + 1.0 {
                return Err(format!(
                    "page {}: {:?} is drawn outside the margins",
                    n + 1,
                    ink
                ));
            }
        }
        for run in inspect::text_runs(page) {
            if squash(&run.text).is_empty() {
                continue;
            }
            signature.insert((
                run.family,
                run.weight,
                run.italic,
                (run.size * 100.0).round() as i64,
                run.fill,
            ));
        }
    }
    let text = compiled
        .document
        .pages()
        .iter()
        .map(page_text)
        .collect::<Vec<_>>()
        .join("\n");
    Ok(Outcome::Drawn(Drawn {
        text: squash(&text),
        signature,
    }))
}

/// The document with the harmless word in `position`: what every case is compared with.
fn benign(position: Position) -> &'static Drawn {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Vec<(Position, Drawn)>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| {
        Position::ALL
            .iter()
            .map(|&p| match draw(p, MARK) {
                Ok(Outcome::Drawn(d)) => (p, d),
                other => panic!(
                    "the harmless text in {p:?} must render, got {}",
                    match other {
                        Ok(Outcome::Skipped) => "skipped".to_owned(),
                        Ok(Outcome::Overflow) => "overflow".to_owned(),
                        Err(e) => e,
                        Ok(Outcome::Drawn(_)) => unreachable!(),
                    }
                ),
            })
            .collect()
    });
    &cache
        .iter()
        .find(|(p, _)| *p == position)
        .expect("a position")
        .1
}

/// Judge one text in one position. `Err` says what broke.
fn judge(position: Position, s: &str) -> Result<Option<&'static str>, String> {
    let reference = benign(position);
    let drawn = match draw(position, s)? {
        Outcome::Skipped => return Ok(Some("skipped")),
        Outcome::Overflow => {
            return if position.in_footer() {
                Ok(Some("overflow"))
            } else {
                Err("a body text was refused as a footer overflow".to_owned())
            };
        }
        Outcome::Drawn(drawn) => drawn,
    };
    // Verbatim.
    let expected = reference.text.replace(MARK, &squash(s));
    if drawn.text != expected {
        let at = drawn
            .text
            .chars()
            .zip(expected.chars())
            .position(|(a, b)| a != b)
            .unwrap_or(0);
        let around = |t: &str| {
            t.chars()
                .skip(at.saturating_sub(20))
                .take(50)
                .collect::<String>()
        };
        return Err(format!(
            "not printed as typed: from character {at} it printed {:?}, not {:?}",
            around(&drawn.text),
            around(&expected)
        ));
    }
    // Style and structure unchanged.
    let strange: Vec<_> = drawn.signature.difference(&reference.signature).collect();
    if !strange.is_empty() {
        return Err(format!(
            "drawn in a look the harmless text is not drawn in: {strange:?}"
        ));
    }
    Ok(None)
}

// ─── the injection set ───────────────────────────────────────────────────────────────────────────────────

/// AC-2.1's test set, and the spike's.
const SET: [&str; 28] = [
    "#set page(width: 1cm)",
    "#read(\"/etc/hostname\")",
    "$x^2$",
    "*a*",
    "_a_",
    "`raw` ```rust fn x(){}```",
    "@label",
    "<label>",
    "\\",
    "{page}",
    "#import \"/main.typ\": *",
    "#image(\"/etc/passwd\")",
    "#plugin(\"/x.wasm\")",
    "]#panic(\"x\")[",
    "#{ panic(\"x\") }",
    "//comment",
    "/* c */",
    "#eval(\"1+1\")",
    "#json(\"/data.json\")",
    "#set text(size: 30pt)",
    "#show: it => none",
    "#set page(margin: 0pt)",
    "= not a heading\n- not a list\n+ not a list",
    "#include \"/etc/passwd\"",
    "\\u{1F600} \\# \\$ \\*",
    "{legal_name} {{x}} [y] [[z]]",
    "#let x = 1; #x",
    "$ sum_(i=0)^n i $ and #text(red)[red]",
];

#[test]
fn ac_2_1_the_injection_set_is_printed_verbatim_in_every_position() {
    let mut failures = Vec::new();
    let mut skipped = 0;
    let mut rendered = 0;
    for position in Position::ALL {
        for s in SET {
            match judge(position, s) {
                Ok(Some("skipped")) => skipped += 1,
                Ok(_) => rendered += 1,
                Err(why) => failures.push(format!("{position:?} {s:?}: {why}")),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // Only the texts that hold a letterhead's own syntax (braces and brackets) are skipped, and only in the
    // letterhead's own text; every other text is rendered in every position.
    let syntax = SET
        .iter()
        .filter(|s| s.contains(['{', '}', '[', ']']))
        .count();
    assert_eq!(
        skipped, syntax,
        "exactly the {syntax} texts with a brace or a bracket are skipped, in the letterhead's text only"
    );
    assert_eq!(rendered, Position::ALL.len() * SET.len() - syntax);
}

#[test]
fn ac_2_1_a_text_of_the_engines_own_syntax_cannot_change_the_page_setup_or_read_a_file() {
    // The two that would do the most harm if they worked, said plainly: the page's width and a file read.
    for position in Position::ALL {
        for s in ["#set page(width: 1cm)", "#read(\"/etc/hostname\")"] {
            let drawn =
                match draw(position, s).unwrap_or_else(|e| panic!("{position:?} {s:?}: {e}")) {
                    Outcome::Drawn(drawn) => drawn,
                    _ => continue,
                };
            assert!(
                drawn.text.contains(&squash(s)),
                "{position:?}: {s:?} must be on the page as typed"
            );
        }
    }
}

// ─── fuzz ────────────────────────────────────────────────────────────────────────────────────────────────

/// SplitMix64: a small generator with no dependency, so that a failure is replayed from its seed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Pieces of the engine's syntax and of ordinary text, to be glued at random.
const TOKENS: &[&str] = &[
    "#",
    "$",
    "*",
    "_",
    "`",
    "```",
    "@",
    "<",
    ">",
    "\\",
    "[",
    "]",
    "{",
    "}",
    "{{",
    "}}",
    "[[",
    "]]",
    "//",
    "/*",
    "*/",
    "~",
    "--",
    "---",
    "...",
    "'",
    "\"",
    "= ",
    "== ",
    "- ",
    "+ ",
    "/ ",
    ": ",
    "|",
    "&",
    "%",
    "^",
    "(",
    ")",
    ";",
    ",",
    ".",
    "!",
    "?",
    "=",
    "-",
    "+",
    "\n",
    "\t",
    " ",
    "  ",
    "#set page(width: 1cm)",
    "#set text(size: 30pt)",
    "#set par(leading: 3pt)",
    "#show: x => x",
    "#let a = 1",
    "#panic(\"x\")",
    "#read(\"/etc/hostname\")",
    "#read(\"/data.json\")",
    "#image(\"/etc/passwd\")",
    "#include \"/main.typ\"",
    "#import \"@preview/x:0.1.0\": *",
    "#eval(\"1+1\")",
    "#plugin(\"/x.wasm\")",
    "#link(\"http://example.com\")[y]",
    "#[",
    "#{",
    "#(",
    "$ x^2 $",
    "<label>",
    "@label",
    "\\u{1F600}",
    "\\\\",
    "\\#",
    "{page}",
    "{pages}",
    "{legal_name}",
    "{address}",
    "[x {vat}]",
    "word",
    "Parole",
    "€",
    "à",
    "ß",
    "漢",
    "字",
    "😀",
    "ᚠ",
    "Ω",
    "—",
    "’",
    "NNN",
    "0",
    "42",
    "x",
];

/// A random text: some tokens, now and then one made long enough to run past a line, now and then a stretch of
/// random characters.
fn random_text(rng: &mut Rng) -> String {
    let s = random_text_unbounded(rng);
    // Twenty line breaks at most: a table's header row of a page's height is an edge of its own (see the report).
    let mut breaks = 0;
    s.chars()
        .map(|c| {
            if c == '\n' {
                breaks += 1;
                if breaks > 20 { ' ' } else { c }
            } else {
                c
            }
        })
        .collect()
}

fn random_text_unbounded(rng: &mut Rng) -> String {
    let mut s = String::new();
    for _ in 0..1 + rng.below(12) {
        match rng.below(20) {
            0 => s.push_str(&"x".repeat(150 + rng.below(400))),
            1 => s.push_str(&TOKENS[rng.below(TOKENS.len())].repeat(1 + rng.below(40))),
            2 | 3 => {
                for _ in 0..1 + rng.below(8) {
                    s.push(random_char(rng));
                }
            }
            _ => s.push_str(TOKENS[rng.below(TOKENS.len())]),
        }
        if rng.below(3) == 0 {
            s.push(' ');
        }
    }
    s
}

/// A printable character from many blocks of Unicode that is written left to right and is not a control (right
/// to left text is reordered by any renderer, so its logical order is not the page's reading order). Combining
/// marks, and the soft hyphen, are in: they attach to the character before them and were a defect (see
/// `ac_2_1_combining_marks_are_printed_once`). Not the variation selectors, joiners, emoji modifiers and tags,
/// which change the character before them into another.
fn random_char(rng: &mut Rng) -> char {
    loop {
        let code = match rng.below(8) {
            0 => 0x20 + rng.below(0x5F) as u32,     // ASCII
            1 => 0xA0 + rng.below(0x160) as u32,    // Latin-1 and Latin Extended-A
            2 => 0x2000 + rng.below(0x700) as u32,  // punctuation, symbols, arrows, maths
            3 => 0x3040 + rng.below(0x6000) as u32, // kana, CJK
            4 => 0x1F300 + rng.below(0x400) as u32, // emoji
            5 => 0x370 + rng.below(0x90) as u32,    // Greek, Cyrillic, Armenian
            6 => 0x300 + rng.below(0x70) as u32,    // combining diacritical marks
            _ => 0x1AB0 + rng.below(0x50) as u32,   // more combining marks
        };
        let bidi = (0x200E..=0x200F).contains(&code)
            || (0x202A..=0x202E).contains(&code)
            || (0x2066..=0x2069).contains(&code);
        // Variation selectors, joiners, emoji modifiers and tags change the character before them.
        let joins = [
            0xFE00..=0xFE0F,
            0x200B..=0x200D,
            0x1F3FB..=0x1F3FF,
            0xE0000..=0xE01EF,
        ]
        .iter()
        .any(|r| r.contains(&code));
        if let Some(c) = char::from_u32(code)
            && !c.is_control()
            && !bidi
            && !joins
            && code != 0x2028
            && code != 0x2029
        {
            return c;
        }
    }
}

fn env_number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[test]
fn ac_2_1_random_typst_syntax_in_every_position_is_printed_verbatim() {
    let seed = env_number("LETTERHEAD_FUZZ_SEED", 0x1E77_E4EA_D000_0001);
    let cases = env_number("LETTERHEAD_FUZZ_CASES", 300);
    let mut failures = Vec::new();
    let (mut skipped, mut overflowed, mut rendered) = (0, 0, 0);
    for case in 0..cases {
        // Each case has a seed of its own, so one can be replayed alone.
        let mut rng = Rng(seed.wrapping_add(case.wrapping_mul(0xD6E8_FEB8_6659_FD93)));
        let s = random_text(&mut rng);
        let position = Position::ALL[rng.below(Position::ALL.len())];
        match judge(position, &s) {
            Ok(Some("skipped")) => skipped += 1,
            Ok(Some(_)) => overflowed += 1,
            Ok(None) => rendered += 1,
            Err(why) => failures.push(format!(
                "case {case} (LETTERHEAD_FUZZ_SEED={seed}) {position:?} {s:?}: {why}"
            )),
        }
    }
    println!(
        "fuzz: {cases} cases from seed {seed}: {rendered} rendered and checked, {overflowed} refused as footer overflow, {skipped} refused by validation, frame text ran up to {:.3} pt past a side margin",
        WORST_OVERSHOOT.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1000.0
    );
    assert!(
        failures.is_empty(),
        "{} of {cases} cases failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(
        rendered * 2 >= cases as usize,
        "fewer than half of the cases were rendered ({rendered} of {cases}): the fuzz is not testing the engine"
    );
}

/// A combining mark after a letter is printed once (AC-2.1, AC-1.3). It was a defect, found by the fuzz: after a
/// letter, some marks make Typst draw the cluster as two text items that both carry the cluster's whole text, so
/// that the page text of the preview, and the text a PDF reader extracts, held the letter twice ("a" + U+0343 +
/// "b" was read back as "a" U+0343 "a" U+0343 "b"). It happened for U+0312 to U+0315, U+0334 to U+0338, U+0343,
/// U+0344 and U+0361 after any letter, and for other marks after some bases (U+0346 after e-acute, U+0354 after
/// wynn); and a soft hyphen at which a line ends, or at the end of a text, was written twice as well. The engine
/// now puts the glyphs of such a cluster in one item (`layout/clusters.rs`); the PDF side is checked in
/// `conformance.rs` (`marks_in_the_pdf`), by pdfium.
#[test]
fn ac_2_1_combining_marks_are_printed_once() {
    let mut failures = Vec::new();
    for code in 0x300u32..=0x36F {
        let mark = char::from_u32(code).expect("a mark");
        for position in [Position::Plain, Position::TableCell] {
            // One cluster; the same cluster typed twice (printed twice: it is not a glyph of the first); a
            // cluster of two marks; and one after a letter that has a mark already.
            for s in [
                format!("a{mark}z"),
                format!("a{mark}a{mark}z"),
                // (A text of nothing but U+034F, the grapheme joiner, which has no glyph, has nothing to print.)
                if code == 0x34F {
                    "a".to_owned()
                } else {
                    format!("{mark}{mark}")
                },
                format!("a{mark}\u{35f}\u{30f}\u{366}z"),
                format!("\u{ed}{mark}z"),
            ] {
                if let Err(why) = judge(position, &s) {
                    failures.push(format!("{position:?} {s:?} (U+{code:04X}): {why}"));
                }
            }
        }
    }
    // A soft hyphen at the end of a text is written twice as well (the fuzz found it in a footer: `'ǾϽ` + U+00AD).
    for position in [Position::Plain, Position::Contacts] {
        if let Err(why) = judge(position, "'ǾϽ\u{ad}") {
            failures.push(format!("{position:?} soft hyphen: {why}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures, the first: {}",
        failures.len(),
        failures[0]
    );
}
