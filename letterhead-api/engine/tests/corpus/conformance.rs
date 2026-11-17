//! The conformance runner (AC-1.3, amendment A5; ADR 20261116-the-preview-is-the-pdfs-own-compile...).
//!
//! For every fixture that renders, the preview and the PDF of one request are compared, the PDF being read by an
//! independent engine, pdfium (`pdfium-render`, a pinned and checksummed binary, tests only):
//!
//! 1. the page count is the same;
//! 2. for every page, the preview's text equals the text pdfium extracts from the PDF's page, every run of
//!    whitespace normalised to one space. (Except for the characters no font holds, as AC-1.3 allows since
//!    amendment A6: the PDF draws the font's missing-glyph mark for them and holds no character, so pdfium
//!    cannot give them back. Only for a document whose answer reports N > 0 unprintable characters (AC-7.6): the
//!    PDF's text of a page may be the preview's with characters left out, each one a character that page's font
//!    did not hold, never changed, added or reordered, and the fewest deletions over all the pages are at most N.
//!    A document that reports none is held to equality on every page.)
//! 3. the page rasterised from the PDF and the preview image differ in no more than 0.5 % of their pixels. A
//!    pixel differs when no pixel within 1 px of it in the other image is within 64/255 on every channel (the
//!    "AA-tolerant" metric of A5, applied in both directions; the count is of pixels that differ in either
//!    direction). pdfium draws at the preview's size and so at its scale (893 x 1263, 1.5 px/pt);
//! 4. **positive control.** The same metric is applied to the preview moved by 1 pt, which must exceed the
//!    limit on every page of prose (1 200 characters or more): a metric that cannot tell a 1 pt shift from no
//!    shift would pass anything. (A page of a few lines has too few edges for any shift to reach 0.5 % of the
//!    page; it is not asked to.)
//!
//! The run is one test: pdfium holds global state and the bindings may be made once per process, so the whole
//! corpus goes through one thread, in one pass. It prints a table with the measured differences per fixture,
//! because the limit leaves little room (T7 measured 0.4577 %): read it as a margin, not as a pass.
//!
//! Where pdfium is: `tests/conformance/fetch-pdfium.sh` unpacks the pinned build into `tests/conformance/.pdfium/`,
//! or point `LETTERHEAD_PDFIUM_LIBRARY` at the library. The library must be the pinned one (`pdfium.lock`): any other
//! is refused, so a number measured here is always a number for the same pdfium. Without a library the runner
//! says so and skips, unless `LETTERHEAD_REQUIRE_PDFIUM=1` (set in CI), which makes a missing library a failure.
//! `LETTERHEAD_CONFORMANCE_REPORT=<file>` appends the table, in Markdown, to a file.

use std::collections::{BTreeSet, HashMap};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use letterhead_engine::layout::CURRENT_LAYOUT;
use letterhead_engine::output::PageSelection;
use pdfium_render::prelude::*;
use sha2::{Digest, Sha256};

use crate::common::*;

/// AC-1.3: the share of pixels that may differ, in per cent.
const MAX_DIFFERING_PERCENT: f64 = 0.5;
/// AC-1.3 (A5): two pixels are alike when every channel is within 64/255.
const CHANNEL_TOLERANCE: i32 = 64;
/// A page with at least this many characters of text is a page of prose, with enough edges for a 1 pt shift to
/// reach the limit; the positive control is asked of those pages. (Ink is no measure of it: a background
/// image or a band is ink that a shift does not change.)
const CONTROL_MIN_TEXT_CHARS: usize = 1200;
/// The control is run on this many pages of prose per fixture (the first ones): it is a control of the metric,
/// not a second measurement, and a debug build takes seconds for each.
const CONTROL_PAGES_PER_FIXTURE: usize = 3;

const REQUIRE_VAR: &str = "LETTERHEAD_REQUIRE_PDFIUM";
const LIBRARY_VAR: &str = "LETTERHEAD_PDFIUM_LIBRARY";
const REPORT_VAR: &str = "LETTERHEAD_CONFORMANCE_REPORT";
/// A directory to write both texts of every page into (raw, as pdfium and the preview give them), to read a text
/// difference.
const DUMP_VAR: &str = "LETTERHEAD_CONFORMANCE_DUMP";

// ─── finding the pinned pdfium ───────────────────────────────────────────────────────────────────────────

fn conformance_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/conformance")
}

fn lock() -> HashMap<String, String> {
    let path = conformance_dir().join("pdfium.lock");
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        .collect()
}

fn platform() -> Option<(&'static str, &'static str)> {
    // (the platform's key in the lock, the library's file name)
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some(("linux_x64", "libpdfium.so")),
        ("macos", "aarch64") => Some(("mac_arm64", "libpdfium.dylib")),
        ("macos", "x86_64") => Some(("mac_x64", "libpdfium.dylib")),
        _ => None,
    }
}

fn sha256_of(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The pinned library, or why there is none. A library that is there and is not the pinned one is a failure
/// whatever the flags.
fn pinned_library() -> Result<PathBuf, String> {
    let (key, file) = platform().ok_or_else(|| {
        format!(
            "no pinned pdfium for {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    let path = match std::env::var(LIBRARY_VAR) {
        Ok(path) if !path.is_empty() => PathBuf::from(path),
        _ => conformance_dir().join(".pdfium/lib").join(file),
    };
    if !path.exists() {
        return Err(format!(
            "pdfium is not at {}: run `sh {}` (or set {LIBRARY_VAR})",
            path.display(),
            conformance_dir().join("fetch-pdfium.sh").display()
        ));
    }
    let lock = lock();
    let pinned = lock
        .get(&format!("PDFIUM_LIBRARY_SHA256_{key}"))
        .unwrap_or_else(|| panic!("pdfium.lock has no PDFIUM_LIBRARY_SHA256_{key}"));
    let actual = sha256_of(&path);
    assert_eq!(
        &actual,
        pinned,
        "{} is not the pinned pdfium {}: its SHA-256 is {actual}. Conformance numbers are only comparable for one build; run fetch-pdfium.sh",
        path.display(),
        lock.get("PDFIUM_BUILD").map_or("?", String::as_str)
    );
    Ok(path)
}

// ─── images and the metric ───────────────────────────────────────────────────────────────────────────────

/// An 8-bit RGB image.
#[derive(Clone)]
struct Image {
    width: usize,
    height: usize,
    rgb: Vec<u8>,
}

fn decode_preview(png_bytes: &[u8]) -> Image {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().expect("preview png header");
    let mut buffer = vec![0; reader.output_buffer_size().expect("png buffer size")];
    let info = reader.next_frame(&mut buffer).expect("preview png data");
    let channels = info.color_type.samples();
    assert_eq!(info.bit_depth, png::BitDepth::Eight);
    let rgb = buffer[..info.buffer_size()]
        .chunks_exact(channels)
        .flat_map(|px| [px[0], px[1], px[2]])
        .collect();
    Image {
        width: info.width as usize,
        height: info.height as usize,
        rgb,
    }
}

fn rasterise(page: &PdfPage, width: usize, height: usize) -> Image {
    let config = PdfRenderConfig::new().set_target_size(width as Pixels, height as Pixels);
    let bitmap = page
        .render_with_config(&config)
        .expect("pdfium renders the page");
    assert_eq!(
        (bitmap.width() as usize, bitmap.height() as usize),
        (width, height)
    );
    let rgba = bitmap.as_rgba_bytes();
    let rgb = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|px| {
            // The page's ground is opaque white in both renderers; alpha is composed over white regardless.
            let a = u32::from(px[3]);
            [0, 1, 2].map(|c| ((u32::from(px[c]) * a + 255 * (255 - a)) / 255) as u8)
        })
        .collect();
    Image { width, height, rgb }
}

/// Every channel of two pixels within the tolerance.
#[inline]
fn alike(a: &[u8; 3], b: &[u8; 3]) -> bool {
    (i32::from(a[0]) - i32::from(b[0])).abs() <= CHANNEL_TOLERANCE
        && (i32::from(a[1]) - i32::from(b[1])).abs() <= CHANNEL_TOLERANCE
        && (i32::from(a[2]) - i32::from(b[2])).abs() <= CHANNEL_TOLERANCE
}

/// The pixels of `a` that no pixel within 1 px of the same place in `b` is alike.
fn unmatched(a: &Image, b: &Image) -> Vec<bool> {
    let (w, h) = (a.width, a.height);
    let mut out = vec![false; w * h];
    let (pixels_a, pixels_b) = (a.rgb.as_chunks::<3>().0, b.rgb.as_chunks::<3>().0);
    for (i, (pa, pb)) in pixels_a.iter().zip(pixels_b).enumerate() {
        // Most pixels are alike where they stand: no neighbourhood to look at.
        if alike(pa, pb) {
            continue;
        }
        let (x, y) = (i % w, i / w);
        let mut found = false;
        'search: for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) {
            for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                if alike(pa, &pixels_b[ny * w + nx]) {
                    found = true;
                    break 'search;
                }
            }
        }
        out[i] = !found;
    }
    out
}

/// The share of pixels, in per cent, that differ in either direction.
fn differing_percent(a: &Image, b: &Image) -> f64 {
    assert_eq!((a.width, a.height), (b.width, b.height));
    let ab = unmatched(a, b);
    let ba = unmatched(b, a);
    let count = ab.iter().zip(&ba).filter(|(x, y)| **x || **y).count();
    100.0 * count as f64 / (a.width * a.height) as f64
}

/// The preview moved by 1 pt = 1.5 px: the average of the picture moved by 1 px and by 2 px, as a rasteriser
/// blends for a half-pixel offset. What comes in at the edge is white.
fn shifted_down(image: &Image) -> Image {
    let stride = image.width * 3;
    let white = vec![255u8; stride];
    let row = |y: isize| -> &[u8] {
        if y < 0 {
            &white
        } else {
            &image.rgb[y as usize * stride..(y as usize + 1) * stride]
        }
    };
    let mut rgb = Vec::with_capacity(image.rgb.len());
    for y in 0..image.height as isize {
        rgb.extend(
            row(y - 1)
                .iter()
                .zip(row(y - 2))
                .map(|(a, b)| (u16::from(*a) + u16::from(*b)).div_ceil(2) as u8),
        );
    }
    Image {
        rgb,
        ..image.clone()
    }
}

fn shifted_right(image: &Image) -> Image {
    let stride = image.width * 3;
    let mut rgb = Vec::with_capacity(image.rgb.len());
    for row in image.rgb.chunks_exact(stride) {
        for x in 0..image.width {
            for c in 0..3 {
                let at = |dx: usize| {
                    x.checked_sub(dx)
                        .map_or(255u16, |sx| u16::from(row[sx * 3 + c]))
                };
                rgb.push((at(1) + at(2)).div_ceil(2) as u8);
            }
        }
    }
    Image {
        rgb,
        ..image.clone()
    }
}

/// The characters of a page that are drawn as the font's missing-glyph mark (`.notdef`): the text of each glyph
/// that is glyph 0.
fn lacking_characters(page: &typst_layout::Page) -> BTreeSet<char> {
    fn walk(frame: &typst::layout::Frame, out: &mut BTreeSet<char>) {
        for (_, item) in frame.items() {
            match item {
                typst::layout::FrameItem::Group(group) => walk(&group.frame, out),
                typst::layout::FrameItem::Text(text) => {
                    for glyph in text.glyphs.iter().filter(|g| g.id == 0) {
                        if let Some(chars) = text
                            .text
                            .get(glyph.range.start as usize..glyph.range.end as usize)
                        {
                            out.extend(chars.chars());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = BTreeSet::new();
    walk(&page.frame, &mut out);
    out
}

/// The fewest deletions that turn `preview` into `pdf`: only a character of `lacking` may be deleted, each costs
/// one, and then the whitespace is normalised again (a run of spaces is one, none at either end). `None` if no
/// such deletions do it, that is if a character was changed, added or reordered, or one the font holds was left
/// out. Both texts are whitespace-normalised already.
fn deletions_needed(preview: &str, pdf: &str, lacking: &BTreeSet<char>) -> Option<usize> {
    let a: Vec<char> = preview.chars().collect();
    let b: Vec<char> = pdf.chars().collect();
    let m = b.len();
    const NO: usize = usize::MAX;
    // cost[space][j]: the fewest deletions so that what is kept of a[..i] is b[..j] with whitespace normalised;
    // `space` is whether the last thing kept is a space (or nothing yet: a leading space is not kept).
    let mut cost = [vec![NO; m + 1], vec![NO; m + 1]];
    cost[1][0] = 0;
    for &c in &a {
        let mut next = [vec![NO; m + 1], vec![NO; m + 1]];
        for space in 0..2 {
            for j in 0..=m {
                let here = cost[space][j];
                if here == NO {
                    continue;
                }
                if lacking.contains(&c) {
                    next[space][j] = next[space][j].min(here + 1);
                }
                if c == ' ' {
                    // A space after a space collapses into it; one when the PDF's text is over is trimmed.
                    if space == 1 || j == m {
                        next[space][j] = next[space][j].min(here);
                    }
                    if space == 0 && j < m && b[j] == ' ' {
                        next[1][j + 1] = next[1][j + 1].min(here);
                    }
                } else if j < m && b[j] == c {
                    next[0][j + 1] = next[0][j + 1].min(here);
                }
            }
        }
        cost = next;
    }
    let best = cost[0][m].min(cost[1][m]);
    (best != NO).then_some(best)
}

/// What pdfium reads back from the PDF of `blocks`, the preview's page texts, and the count of unprintable
/// characters of the answer.
fn pdf_and_preview_text(
    pdfium: &Pdfium,
    layout: u32,
    blocks: serde_json::Value,
) -> (String, String, usize) {
    let request = letterhead_engine::content::validate_request(&serde_json::json!({
        "contentVersion": 1, "entity": "welld_it", "language": "it", "entityData": {}, "blocks": blocks,
    }))
    .unwrap_or_else(|e| panic!("{}", e.code()));
    let rendered =
        letterhead_engine::render::render(&request, &version(layout, letterhead("bare")), assets())
            .unwrap_or_else(|e| panic!("{}", e.code()));
    let pdf = rendered.pdf().expect("pdf");
    let document = pdfium
        .load_pdf_from_byte_slice(&pdf, None)
        .expect("pdfium opens the PDF");
    let pdf_text: String = document
        .pages()
        .iter()
        .map(|page| page.text().expect("pdfium text").all())
        .collect::<Vec<_>>()
        .join("\n");
    (
        pdf_text,
        rendered.page_texts().join("\n"),
        rendered.unprintable_characters,
    )
}

/// A combining mark is in the text of the PDF once (AC-2.1, AC-1.3; T38). pdfium reads some marks out of order
/// (it puts U+0361 and U+0315 after the next letter) and puts a space after others, so the text of a page with a
/// mark cannot always be *equal* to the preview's; but a cluster written twice, or lost, shows in the count of each
/// character, whatever its place and the whitespace. So: for every mark of the block of combining diacritical
/// marks, after a letter and in a table cell, and for a soft hyphen (which pdfium reads as U+0002 where a line
/// ends), the characters of the PDF's text and those of the preview's text, whitespace aside, are the same
/// characters the same number of times, except for as many characters left out as the answer reports unprintable
/// (AC-1.3, A6).
fn marks_in_the_pdf(pdfium: &Pdfium, layout: u32) -> Vec<String> {
    use std::collections::BTreeMap;
    let counts = |text: &str| {
        let mut counts: BTreeMap<char, usize> = BTreeMap::new();
        for c in text.chars().filter(|c| !c.is_whitespace()) {
            *counts
                .entry(if c == '\u{2}' { '\u{ad}' } else { c })
                .or_default() += 1;
        }
        counts
    };
    let paragraph =
        |text: String| serde_json::json!({ "type": "paragraph", "runs": [{ "text": text }] });
    let mut blocks = Vec::new();
    for code in 0x300u32..=0x36F {
        // U+0344 is the one mark left out, and it is deprecated (Unicode: write U+0308 U+0301). Noto Serif sets it
        // as two glyphs, on two heights, after some letters, and PDF has no way to say that two glyphs are one
        // character that pdfium reads once: ActualText is read by pdfium in addition to the glyphs' own text,
        // and a glyph with no text is read as its own code. The preview's text has it once (see
        // `ac_2_1_combining_marks_are_printed_once`); pdfium's has it twice, whatever the engine writes.
        if code == 0x344 {
            continue;
        }
        let mark = char::from_u32(code).expect("a mark");
        let cell =
            serde_json::json!([{ "type": "paragraph", "runs": [{ "text": format!("c{mark}d") }] }]);
        blocks.push(paragraph(format!(
            "m{code:04X} a{mark}z q{mark}r e{mark} end"
        )));
        blocks.push(
            serde_json::json!({ "type": "table", "columns": [1, 1], "rows": [[cell, cell]] }),
        );
    }
    for text in [
        "m0000 a\u{ad}",
        "pre\u{ad}fix and suffix\u{ad}",
        "'ǾϽ\u{ad}",
    ] {
        blocks.push(paragraph(text.to_owned()));
    }
    let mut failures = Vec::new();
    // One document per page-worth, so that a failure names a few marks and not all of them.
    for chunk in blocks.chunks(24) {
        let (pdf, preview, unprintable) =
            pdf_and_preview_text(pdfium, layout, serde_json::Value::Array(chunk.to_vec()));
        let (pdf_raw, preview_raw) = (pdf, preview);
        let (pdf, preview) = (counts(&pdf_raw), counts(&preview_raw));
        let mut left_out = 0;
        for (c, wanted) in &preview {
            let got = pdf.get(c).copied().unwrap_or(0);
            if got < *wanted {
                left_out += wanted - got;
            }
        }
        for (c, got) in &pdf {
            let wanted = preview.get(c).copied().unwrap_or(0);
            if *got > wanted {
                failures.push(format!(
                    "layout {layout}: U+{:04X} is in the PDF's text {got} times, in the preview's {wanted} (in a document of {})",
                    *c as u32,
                    chunk.len()
                ));
            }
        }
        if left_out > unprintable {
            failures.push(format!(
                "layout {layout}: the PDF's text lacks {left_out} characters of the preview's, the answer reports {unprintable} unprintable ({:?})",
                preview_raw.lines().take(3).collect::<Vec<_>>()
            ));
        }
        if unprintable == 0 && preview != pdf {
            let differ: Vec<String> = preview
                .keys()
                .chain(pdf.keys())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .filter(|c| preview.get(c) != pdf.get(c))
                .map(|c| {
                    format!(
                        "U+{:04X} preview {:?} PDF {:?}",
                        *c as u32,
                        preview.get(c),
                        pdf.get(c)
                    )
                })
                .collect();
            failures.push(format!(
                "layout {layout}: the PDF's characters are not the preview's, with none unprintable: {} (PDF {:?})",
                differ.join(", "),
                pdf_raw.lines().filter(|l| l.contains(|c| c > '\u{2ff}' || c == '\u{2}')).collect::<Vec<_>>()
            ));
        }
    }
    failures
}

#[test]
fn the_text_rule_for_unprintable_characters_is_the_one_of_amendment_a6() {
    let lacking: BTreeSet<char> = ['😀', '漢'].into_iter().collect();
    // Deletions of lacking characters: counted, and a space that is left doubled is free.
    assert_eq!(deletions_needed("漢字 😀 ⨌ ᚠ", "字 ⨌ ᚠ", &lacking), Some(2));
    assert_eq!(deletions_needed("a 😀 b", "a b", &lacking), Some(1));
    assert_eq!(deletions_needed("same", "same", &lacking), Some(0));
    // A character changed, added, reordered, or deleted although the font holds it, or a space deleted on its own.
    assert_eq!(deletions_needed("abc", "abd", &lacking), None);
    assert_eq!(deletions_needed("abc", "abcd", &lacking), None);
    assert_eq!(deletions_needed("abc", "acb", &lacking), None);
    assert_eq!(deletions_needed("abc", "ac", &lacking), None);
    assert_eq!(deletions_needed("a b", "ab", &lacking), None);
    assert_eq!(deletions_needed("a 😀 b", "ab", &lacking), None);
}

// ─── the run ─────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct FixtureResult {
    name: String,
    pages: usize,
    text_failures: Vec<String>,
    /// The characters of the document that no font holds, as the answer reports them (AC-7.6): N.
    unprintable: usize,
    /// The fewest characters left out of the PDF's text over the pages, which AC-1.3 allows up to N.
    deletions: usize,
    /// The largest difference over the pages, with the page it is on.
    worst: (f64, usize),
    /// The smallest difference of the control over the pages it was run on, vertical and horizontal.
    control_vertical: Option<(f64, usize)>,
    control_horizontal: Option<(f64, usize)>,
    /// How many pages the control was run on.
    prose_pages: usize,
    /// One line per page, for `LETTERHEAD_CONFORMANCE_VERBOSE=1`.
    per_page: Vec<String>,
}

fn minimum(current: Option<(f64, usize)>, value: f64, page: usize) -> Option<(f64, usize)> {
    match current {
        Some((m, p)) if m <= value => Some((m, p)),
        _ => Some((value, page)),
    }
}

fn conform(pdfium: &Pdfium, layout: u32) -> Vec<FixtureResult> {
    let mut results = Vec::new();
    for fixture in fixtures() {
        let Ok(rendered) = rendered(layout, fixture) else {
            continue; // a refusal has no pages: the golden holds its code
        };
        let mut result = FixtureResult {
            name: fixture.name.clone(),
            pages: rendered.page_count,
            unprintable: rendered.unprintable_characters,
            ..FixtureResult::default()
        };
        let previews = rendered.preview(&PageSelection::All).expect("preview");
        let pdf = rendered.pdf().expect("pdf");
        let document = pdfium
            .load_pdf_from_byte_slice(&pdf, None)
            .unwrap_or_else(|e| panic!("pdfium cannot open the PDF of {}: {e:?}", fixture.name));

        // 1. one page count.
        if document.pages().len() as usize != rendered.page_count
            || previews.len() != rendered.page_count
        {
            result.text_failures.push(format!(
                "page count: engine {}, preview {}, PDF (pdfium) {}",
                rendered.page_count,
                previews.len(),
                document.pages().len()
            ));
            results.push(result);
            continue;
        }

        for (index, preview) in previews.iter().enumerate() {
            let page_number = index + 1;
            let page = document
                .pages()
                .get(index as PdfPageIndex)
                .expect("pdfium page");

            // 2. the text of the preview is the text of the PDF.
            let raw_pdf_text = page.text().expect("pdfium text").all();
            if let Ok(dir) = std::env::var(DUMP_VAR) {
                // For reading a difference: the two texts as they are, before the whitespace is normalised.
                let base = Path::new(&dir).join(format!("{}-p{page_number}", fixture.name));
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::fs::write(base.with_extension("pdfium.txt"), &raw_pdf_text);
                let _ = std::fs::write(base.with_extension("preview.txt"), &preview.text);
            }
            let (pdf_text, preview_text) = (normalise(&raw_pdf_text), normalise(&preview.text));
            // AC-1.3 as amended (A6): equality, unless the answer reports unprintable characters, and then
            // only deletions of characters the page's fonts lack, at most N over the whole document (checked
            // after the last page).
            let text_ok = if pdf_text == preview_text {
                true
            } else if rendered.unprintable_characters > 0 {
                let lacking = lacking_characters(&rendered.document().pages()[index]);
                match deletions_needed(&preview_text, &pdf_text, &lacking) {
                    Some(deleted) => {
                        result.deletions += deleted;
                        true
                    }
                    None => false,
                }
            } else {
                false
            };
            if !text_ok {
                let at = pdf_text
                    .chars()
                    .zip(preview_text.chars())
                    .position(|(x, y)| x != y)
                    .unwrap_or(0);
                let around = |s: &str| {
                    s.chars()
                        .skip(at.saturating_sub(25))
                        .take(60)
                        .collect::<String>()
                };
                result.text_failures.push(format!(
                    "page {page_number}: text differs at character {at}: PDF {:?} against preview {:?}",
                    around(&pdf_text),
                    around(&preview_text)
                ));
            }

            // 3. the pixels.
            let preview_image = decode_preview(&preview.png);
            assert_eq!(
                (preview_image.width as u32, preview_image.height as u32),
                (preview.width, preview.height)
            );
            let pdf_image = rasterise(&page, preview_image.width, preview_image.height);
            let percent = differing_percent(&preview_image, &pdf_image);
            if percent >= result.worst.0 {
                result.worst = (percent, page_number);
            }
            let mut row = format!(
                "{} page {page_number}: {} chars, differs {percent:.4} %",
                fixture.name,
                preview_text.chars().count()
            );

            // 4. the positive control: the preview moved by 1 pt must not pass.
            if preview_text.chars().count() >= CONTROL_MIN_TEXT_CHARS
                && result.prose_pages < CONTROL_PAGES_PER_FIXTURE
            {
                result.prose_pages += 1;
                let vertical = differing_percent(&shifted_down(&preview_image), &pdf_image);
                let horizontal = differing_percent(&shifted_right(&preview_image), &pdf_image);
                result.control_vertical = minimum(result.control_vertical, vertical, page_number);
                result.control_horizontal =
                    minimum(result.control_horizontal, horizontal, page_number);
                row += &format!(", 1 pt down {vertical:.4} %, 1 pt right {horizontal:.4} %");
            }
            result.per_page.push(row);
        }
        if result.deletions > result.unprintable {
            result.text_failures.push(format!(
                "the PDF's text leaves out {} characters over the document, the answer reports {} unprintable (AC-1.3, A6)",
                result.deletions, result.unprintable
            ));
        }
        results.push(result);
    }
    results
}

fn table(results: &[FixtureResult], layout: u32, build: &str) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "AC-1.3 conformance, layout {layout}, pdfium {build}: tolerant pixel difference (limit {MAX_DIFFERING_PERCENT} %), text, 1 pt control"
    );
    let _ = writeln!(
        out,
        "| fixture | pages | text | max difference % (page) | control 1 pt down: min % (page) | control 1 pt right: min % (page) | control pages |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|---|");
    for r in results {
        let fmt =
            |c: Option<(f64, usize)>| c.map_or("n/a".to_owned(), |(v, p)| format!("{v:.4} ({p})"));
        let _ = writeln!(
            out,
            "| {} | {} | {} | {:.4} ({}) | {} | {} | {} |",
            r.name,
            r.pages,
            match (r.text_failures.is_empty(), r.unprintable, r.deletions) {
                (false, ..) => "DIFFERS".to_owned(),
                (true, _, 0) => "equal".to_owned(),
                (true, n, d) => format!(
                    "equal but for {d} characters left out (answer reports {n} unprintable)"
                ),
            },
            r.worst.0,
            r.worst.1,
            fmt(r.control_vertical),
            fmt(r.control_horizontal),
            r.prose_pages
        );
    }
    let worst = results.iter().map(|r| r.worst.0).fold(0.0, f64::max);
    let _ = writeln!(
        out,
        "max over the corpus: {worst:.4} % (limit {MAX_DIFFERING_PERCENT} %, margin {:.4} points)",
        MAX_DIFFERING_PERCENT - worst
    );
    out
}

#[test]
fn ac_1_3_the_preview_and_the_pdf_agree_for_every_fixture_by_an_independent_engine() {
    let library = match pinned_library() {
        Ok(path) => path,
        Err(why) => {
            assert!(
                std::env::var(REQUIRE_VAR).as_deref() != Ok("1"),
                "{REQUIRE_VAR}=1 and the conformance runner cannot run: {why}"
            );
            eprintln!("CONFORMANCE SKIPPED, NOT PASSED: {why}. CI sets {REQUIRE_VAR}=1.");
            return;
        }
    };
    let build = lock().get("PDFIUM_BUILD").cloned().unwrap_or_default();
    let bindings = Pdfium::bind_to_library(&library)
        .unwrap_or_else(|e| panic!("load {}: {e:?}", library.display()));
    let pdfium = Pdfium::new(bindings);

    let mut failures = Vec::new();
    for layout in 1..=CURRENT_LAYOUT {
        let results = conform(&pdfium, layout);
        let report = table(&results, layout, &build);
        println!("{report}");
        if std::env::var("LETTERHEAD_CONFORMANCE_VERBOSE").is_ok_and(|v| v == "1") {
            for row in results.iter().flat_map(|r| &r.per_page) {
                println!("{row}");
            }
        }
        if let Ok(path) = std::env::var(REPORT_VAR) {
            use std::io::Write as _;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .expect("open the report file");
            let _ = writeln!(file, "{report}");
        }
        assert!(
            results.len() >= 8,
            "the corpus has {} rendering fixtures: the runner is not looking at it",
            results.len()
        );

        failures.extend(marks_in_the_pdf(&pdfium, layout));
        for r in &results {
            for why in &r.text_failures {
                failures.push(format!("layout {layout}, {}: {why}", r.name));
            }
            if r.worst.0 > MAX_DIFFERING_PERCENT {
                failures.push(format!(
                    "layout {layout}, {}: page {} differs in {:.4} % of its pixels, above {MAX_DIFFERING_PERCENT} %",
                    r.name, r.worst.1, r.worst.0
                ));
            }
            for (direction, control) in [
                ("down", r.control_vertical),
                ("right", r.control_horizontal),
            ] {
                if let Some((smallest, page)) = control
                    && smallest <= MAX_DIFFERING_PERCENT
                {
                    failures.push(format!(
                        "layout {layout}, {}: the positive control (preview 1 pt {direction}) differs in only {smallest:.4} % on page {page}, a page of prose: the metric would not catch a 1 pt divergence",
                        r.name
                    ));
                }
            }
        }
        let with_control = results
            .iter()
            .filter(|r| r.control_vertical.is_some())
            .count();
        if with_control < 5 {
            failures.push(format!("layout {layout}: only {with_control} fixtures have a page of prose for the positive control"));
        }
    }
    assert!(
        failures.is_empty(),
        "conformance failed:\n  {}",
        failures.join("\n  ")
    );
}
