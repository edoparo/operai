//! Tests of the engine's outputs (task T7). Run: `cargo test -p letterhead-engine render::`.

use serde_json::{Value, json};

use super::*;
use crate::config::{Frame, Line, LocalText, Rule, Valign, default_config};
use crate::content::validate_request;
use crate::layout::{Assets, CURRENT_LAYOUT};
use crate::output::{PREVIEW_COLOURS, PageSelection};

const LOGO_ID: &str = "11111111-1111-4111-8111-111111111111";

fn version() -> LetterheadVersion {
    let mut config = default_config();
    config.margins.bottom = 30.0;
    config.variants.default.footer = Frame {
        valign: Valign::Bottom,
        rule: Rule {
            show: true,
            thickness_pt: 0.5,
            color: "e50339".to_owned(),
        },
        left: vec![line("{legal_name}"), line("{address}")],
        center: Vec::new(),
        right: vec![line("Pagina {page} di {pages}")],
    };
    LetterheadVersion {
        number: 7,
        layout_version: CURRENT_LAYOUT,
        config,
    }
}

fn line(text: &str) -> Line {
    Line {
        text: LocalText {
            it: text.to_owned(),
            en: text.to_owned(),
        },
        size: 8.0,
        bold: false,
        color: "595c69".to_owned(),
    }
}

fn assets() -> Assets {
    Assets::new()
}

fn request(blocks: Value) -> RenderRequest {
    validate_request(&json!({
        "contentVersion": 1,
        "entity": "welld_it",
        "language": "it",
        "entityData": { "legalName": "WellD Sagl", "addressLines": ["Via Pessina 9", "6900 Lugano"] },
        "blocks": blocks,
    }))
    .expect("a valid request")
}

/// `pages` pages: one paragraph on each, a page break between.
fn pages_of(pages: usize) -> Value {
    let mut blocks = Vec::new();
    for page in 1..=pages {
        if page > 1 {
            blocks.push(json!({ "type": "pageBreak" }));
        }
        blocks.push(
            json!({ "type": "heading", "level": 1, "text": format!("Pagina numero {page}") }),
        );
        blocks.push(json!({ "type": "paragraph", "runs": [{ "text": "Una riga di testo, con accenti: è à ù € e l’apostrofo." }] }));
    }
    json!(blocks)
}

fn rendered(pages: usize) -> Rendered {
    render(&request(pages_of(pages)), &version(), &assets()).expect("renders")
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn decode(png_bytes: &[u8]) -> (png::Info<'static>, Vec<u8>) {
    let mut reader = png::Decoder::new(std::io::Cursor::new(png_bytes))
        .read_info()
        .expect("a PNG");
    let mut data = vec![0; reader.output_buffer_size().expect("a size")];
    let frame = reader.next_frame(&mut data).expect("its pixels");
    data.truncate(frame.buffer_size());
    (reader.info().clone(), data)
}

// ─── AC-1.4 deterministic ────────────────────────────────────────────────────

#[test]
fn ac_1_4_two_renders_give_byte_identical_pdfs() {
    let a = rendered(4).pdf().unwrap();
    let b = rendered(4).pdf().unwrap();
    assert!(a.len() > 1000);
    assert_eq!(a, b);
}

#[test]
fn ac_1_4_two_renders_give_byte_identical_preview_pages_and_texts() {
    let a = rendered(3).preview(&PageSelection::All).unwrap();
    let b = rendered(3).preview(&PageSelection::All).unwrap();
    assert_eq!(a, b);
}

#[test]
fn ac_1_4_one_render_gives_the_same_pdf_however_often_it_is_asked_for() {
    let r = rendered(2);
    assert_eq!(r.pdf().unwrap(), r.pdf().unwrap());
    // The PDF does not depend on whether the pages were drawn first.
    let before = rendered(2).pdf().unwrap();
    let r = rendered(2);
    r.preview(&PageSelection::All).unwrap();
    assert_eq!(r.pdf().unwrap(), before);
}

#[test]
fn ac_1_4_the_pdf_carries_no_date_and_no_producer() {
    let pdf = rendered(1).pdf().unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    for name in [
        "/CreationDate",
        "/ModDate",
        "/Producer",
        "/Creator",
        "/Author",
    ] {
        assert!(!contains(&pdf, name.as_bytes()), "{name}");
    }
}

#[test]
fn ac_1_4_the_text_and_the_positions_are_the_same_twice() {
    let a = rendered(3);
    let b = rendered(3);
    assert_eq!(a.page_texts(), b.page_texts());
    for (x, y) in a.document().pages().iter().zip(b.document().pages()) {
        assert_eq!(
            crate::layout::inspect::lines(x),
            crate::layout::inspect::lines(y)
        );
    }
}

// ─── AC-1.1 the PDF ──────────────────────────────────────────────────────────

#[test]
fn ac_1_1_the_pdf_is_a4_with_one_page_per_page() {
    let pdf = rendered(3).pdf().unwrap();
    assert!(
        contains(&pdf, b"595.276 841.89")
            || contains(&pdf, b"595.2756 841.8898")
            || contains(&pdf, b"595.28 841.89"),
        "A4 media box"
    );
    assert!(contains(&pdf, b"/Count 3"), "three pages");
}

// ─── AC-1.2 the preview ──────────────────────────────────────────────────────

#[test]
fn ac_1_2_a_preview_page_is_893_by_1263_and_a_paletted_png_of_64_colours_at_most() {
    let pages = rendered(2).preview(&PageSelection::All).unwrap();
    assert_eq!(pages.len(), 2);
    for page in &pages {
        assert_eq!((page.width, page.height), (893, 1263));
        let (info, pixels) = decode(&page.png);
        assert_eq!((info.width, info.height), (893, 1263));
        assert_eq!(info.color_type, png::ColorType::Indexed);
        assert_eq!(info.bit_depth, png::BitDepth::Eight);
        let palette = info.palette.as_ref().expect("a palette");
        assert!(
            palette.len() / 3 <= PREVIEW_COLOURS,
            "{} colours",
            palette.len() / 3
        );
        assert!(pixels.iter().all(|&i| usize::from(i) < palette.len() / 3));
        // A4: 210 : 297 within a pixel.
        let ratio: f64 = 893.0 / 1263.0;
        assert!((ratio - 210.0 / 297.0).abs() < 1.0 / 1263.0);
        // A page of text on white: mostly the ground colour, and not only that.
        let ground = palette
            .chunks(3)
            .position(|c| c == [255, 255, 255])
            .expect("a white");
        let white = pixels.iter().filter(|&&p| usize::from(p) == ground).count();
        assert!(
            white > pixels.len() * 9 / 10 && white < pixels.len(),
            "{white}"
        );
        // And a preview page is small: this is why it is paletted.
        assert!(page.png.len() < 120_000, "{} bytes", page.png.len());
    }
}

#[test]
fn ac_1_2_a_page_comes_with_its_text_in_reading_order() {
    let pages = rendered(3).preview(&PageSelection::All).unwrap();
    let lines: Vec<&str> = pages[1].text.lines().collect();
    assert_eq!(lines[0], "Pagina numero 2");
    assert_eq!(
        lines[1],
        "Una riga di testo, con accenti: è à ù € e l’apostrofo."
    );
    // The footer is the page's last lines: the zones of one line are one row.
    assert_eq!(lines[2], "WellD Sagl");
    assert_eq!(lines[3], "Via Pessina 9, 6900 Lugano Pagina 2 di 3");
    assert_eq!(lines.len(), 4);
    assert_eq!(pages[0].number, 1);
}

#[test]
fn ac_1_2_pages_selects_only_those_pages_and_all_is_the_default() {
    let r = rendered(5);
    let two = r.preview(&PageSelection::parse("2").unwrap()).unwrap();
    assert_eq!(two.iter().map(|p| p.number).collect::<Vec<_>>(), vec![2]);
    assert!(two[0].text.contains("Pagina numero 2"));
    let some = r
        .preview(&PageSelection::parse("5, 1,3,3").unwrap())
        .unwrap();
    assert_eq!(
        some.iter().map(|p| p.number).collect::<Vec<_>>(),
        vec![1, 3, 5]
    );
    assert_eq!(r.preview(&PageSelection::default()).unwrap().len(), 5);
    // The page asked for is the page: its picture is the same as when all are asked for.
    let all = r.preview(&PageSelection::All).unwrap();
    assert_eq!(all[1], two[0]);
}

#[test]
fn ac_1_2_a_page_past_the_end_is_an_error() {
    let r = rendered(2);
    assert_eq!(
        r.preview(&PageSelection::parse("3").unwrap()).err(),
        Some(RenderError::PageOutOfRange)
    );
    assert_eq!(
        r.preview(&PageSelection::parse("1,2,3").unwrap()).err(),
        Some(RenderError::PageOutOfRange)
    );
    assert_eq!(RenderError::PageOutOfRange.code(), "invalid_pages");
}

#[test]
fn ac_1_2_the_pages_parameter_is_a_list_of_page_numbers() {
    for bad in ["", "0", "-1", "a", "1,,2", "1;2", "1.5", "301", "1,x", " "] {
        assert_eq!(PageSelection::parse(bad), None, "{bad:?}");
    }
    assert_eq!(
        PageSelection::parse("300"),
        Some(PageSelection::Pages(vec![300]))
    );
    assert_eq!(
        PageSelection::parse(" 2 , 1 "),
        Some(PageSelection::Pages(vec![1, 2]))
    );
}

#[test]
fn ac_1_2_a_pdf_is_not_needed_for_a_preview_nor_a_preview_for_a_pdf() {
    // Both are methods of the one rendered document and either can be asked for alone.
    let r = rendered(1);
    assert!(r.preview(&PageSelection::All).is_ok());
    assert!(rendered(1).pdf().is_ok());
}

// ─── AC-3.3 limits ───────────────────────────────────────────────────────────

#[test]
fn ac_3_3_a_document_of_300_pages_renders_and_one_of_301_is_refused() {
    let ok = render(&request(pages_of(300)), &version(), &assets()).expect("300 pages");
    assert_eq!(ok.page_count, 300);
    assert!(
        ok.preview(&PageSelection::parse("300").unwrap()).unwrap()[0]
            .text
            .contains("Pagina numero 300")
    );
    let err = render(&request(pages_of(301)), &version(), &assets()).err();
    assert_eq!(err, Some(RenderError::TooManyPages));
    assert_eq!(err.unwrap().code(), "too_many_pages");
}

// ─── AC-7.6, AC-6.4, AC-4.5 the rest of what the answer says ─────────────────

#[test]
fn ac_7_6_the_count_of_unprintable_characters_is_over_the_whole_document() {
    let blocks = json!([
        { "type": "paragraph", "runs": [{ "text": "漢字😀" }] },
        { "type": "pageBreak" },
        { "type": "paragraph", "runs": [{ "text": "ancora ⨌ ᚠ" }] },
    ]);
    let r = render(&request(blocks), &version(), &assets()).unwrap();
    assert_eq!(r.unprintable_characters, 5);
    // Not refused, and the text is what was sent.
    assert!(r.page_texts()[0].contains("漢字😀"));
    assert!(r.pdf().is_ok());
    assert_eq!(rendered(2).unprintable_characters, 0);
}

#[test]
fn ac_6_4_the_missing_placeholders_are_those_of_the_drawn_frames() {
    let mut v = version();
    v.config.variants.default.footer.left = vec![line("{legal_name} {vat}"), line("{iban}")];
    let r = render(&request(pages_of(1)), &v, &assets()).unwrap();
    assert_eq!(r.missing_placeholders, vec!["iban", "vat"]);
    assert!(r.pdf().is_ok());
}

#[test]
fn ac_4_5_the_answer_names_the_version_and_its_layout_and_an_unknown_layout_is_refused() {
    let r = rendered(1);
    assert_eq!(
        (r.letterhead_version, r.layout_version, r.page_count),
        (7, 1, 1)
    );
    let mut v = version();
    v.layout_version = 2;
    let err = render(&request(pages_of(1)), &v, &assets()).err();
    assert_eq!(
        err,
        Some(RenderError::Layout(
            crate::layout::LayoutError::UnknownLayout(2)
        ))
    );
}

#[test]
fn ac_5_3_a_frame_that_does_not_fit_is_refused_before_any_output() {
    let mut v = version();
    v.config.margins.bottom = 12.0;
    let err = render(&request(pages_of(1)), &v, &assets())
        .err()
        .expect("refused");
    assert_eq!(err.code(), "footer_overflow");
}

#[test]
fn ac_2_3_an_image_the_asset_rules_refuse_is_refused_at_its_member() {
    let blocks = json!([{ "type": "image", "data": "bm90IGFuIGltYWdl" }]);
    let err = render(&request(blocks), &version(), &assets())
        .err()
        .expect("refused");
    assert_eq!(err.code(), "invalid_content");
    assert_eq!(
        err,
        RenderError::Layout(crate::layout::LayoutError::Image {
            path: "/blocks/0/data".to_owned(),
            reason: crate::assets::Reason::UnsupportedFormat
        })
    );
}

#[test]
fn a_logo_in_the_letterhead_reaches_the_pdf_and_the_preview() {
    let mut v = version();
    v.config.variants.default.logo = Some(crate::config::Logo {
        asset: LOGO_ID.to_owned(),
        position: crate::config::LogoPosition::Left,
        height_mm: 12.0,
    });
    let mut a = Assets::new();
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 10, 10);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[200u8; 300])
            .unwrap();
    }
    a.insert(LOGO_ID.to_owned(), png_bytes);
    let with = render(&request(pages_of(1)), &v, &a).unwrap();
    let without = rendered(1);
    assert_ne!(with.pdf().unwrap(), without.pdf().unwrap());
    assert_ne!(
        with.preview(&PageSelection::All).unwrap()[0].png,
        without.preview(&PageSelection::All).unwrap()[0].png
    );
}
