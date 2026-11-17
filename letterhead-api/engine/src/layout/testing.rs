//! Helpers shared by the layout's tests (cfg(test)).

use serde_json::{Value, json};

use super::{Assets, Compiled, LAYOUT_1, LayoutError, compile};
use crate::config::{
    Frame, LetterheadConfig, Line, LocalText, Logo, LogoPosition, Rule, Valign, default_config,
};
use crate::content::{RenderRequest, validate_request};

pub(super) const LOGO_ID: &str = "11111111-1111-4111-8111-111111111111";
pub(super) const BAND_ID: &str = "22222222-2222-4222-8222-222222222222";
pub(super) const LOGO2_ID: &str = "33333333-3333-4333-8333-333333333333";

/// A frame with nothing in it and no rule.
pub(super) fn empty_frame(valign: Valign) -> Frame {
    Frame {
        valign,
        rule: Rule {
            show: false,
            thickness_pt: 0.5,
            color: "e50339".to_owned(),
        },
        left: Vec::new(),
        center: Vec::new(),
        right: Vec::new(),
    }
}

pub(super) fn line(it: &str, en: &str, size: f64, bold: bool, color: &str) -> Line {
    Line {
        text: LocalText {
            it: it.to_owned(),
            en: en.to_owned(),
        },
        size,
        bold,
        color: color.to_owned(),
    }
}

pub(super) fn plain_line(text: &str) -> Line {
    line(text, text, 8.0, false, "595c69")
}

/// The default configuration with no text in any frame: what is drawn on a page is the body alone.
pub(super) fn bare_config() -> LetterheadConfig {
    let mut config = default_config();
    config.variants.default.header = empty_frame(Valign::Top);
    config.variants.default.footer = empty_frame(Valign::Top);
    config
}

pub(super) fn logo(asset: &str, position: LogoPosition, height_mm: f64) -> Logo {
    Logo {
        asset: asset.to_owned(),
        position,
        height_mm,
    }
}

/// A PNG of one flat colour.
pub(super) fn png(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        let pixels: Vec<u8> = (0..width * height).flat_map(|_| rgb).collect();
        writer.write_image_data(&pixels).expect("png data");
    }
    out
}

/// An SVG band down the left edge of an A4 page, as the background of the spike was.
pub(super) fn band_svg() -> Vec<u8> {
    br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect x="0" y="0" width="6" height="297" fill="#e50339"/></svg>"##.to_vec()
}

pub(super) fn assets() -> Assets {
    let mut assets = Assets::new();
    // 100 x 40 px: a logo 2.5 times as wide as it is high.
    assets.insert(LOGO_ID.to_owned(), png(100, 40, [229, 3, 57]));
    assets.insert(BAND_ID.to_owned(), band_svg());
    assets.insert(LOGO2_ID.to_owned(), png(40, 40, [31, 36, 48]));
    assets
}

pub(super) fn request_json(language: &str, entity_data: Value, blocks: Value) -> Value {
    json!({
        "contentVersion": 1,
        "entity": "welld_it",
        "language": language,
        "entityData": entity_data,
        "blocks": blocks,
    })
}

pub(super) fn request(language: &str, blocks: Value) -> RenderRequest {
    request_with(language, json!({}), blocks)
}

pub(super) fn request_with(language: &str, entity_data: Value, blocks: Value) -> RenderRequest {
    validate_request(&request_json(language, entity_data, blocks))
        .unwrap_or_else(|e| panic!("a fixture request is valid: {:?}", e.code()))
}

pub(super) fn paragraph(text: &str) -> Value {
    json!({ "type": "paragraph", "runs": [{ "text": text }] })
}

pub(super) fn heading(level: u8, text: &str) -> Value {
    json!({ "type": "heading", "level": level, "text": text })
}

/// `count` paragraphs of `words` words each.
pub(super) fn paragraphs(count: usize, words: usize) -> Value {
    let text = vec!["parola"; words].join(" ");
    Value::Array((0..count).map(|_| paragraph(&text)).collect())
}

pub(super) fn try_compile(
    config: &LetterheadConfig,
    request: &RenderRequest,
) -> Result<Compiled, LayoutError> {
    compile(&LAYOUT_1, config, &assets(), request)
}

pub(super) fn compiled(config: &LetterheadConfig, request: &RenderRequest) -> Compiled {
    try_compile(config, request).unwrap_or_else(|e| panic!("the fixture compiles: {e:?}"))
}

/// The text of every run of a page, joined with a space, for assertions on what a page says.
pub(super) fn page_text(compiled: &Compiled, page: usize) -> String {
    super::inspect::text_runs(&compiled.document.pages()[page - 1])
        .iter()
        .map(|run| run.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) const A4_WIDTH_PT: f64 = 595.2756;
pub(super) const A4_HEIGHT_PT: f64 = 841.8898;

pub(super) fn mm(value: f64) -> f64 {
    value * 72.0 / 25.4
}

/// The entity values of the reference letterhead (the brand's, with invented numbers).
pub(super) fn entity_data() -> Value {
    json!({
        "legalName": "WellD Sagl",
        "addressLines": ["Via Pessina 9", "6900 Lugano"],
        "contacts": "info@example.com",
        "vat": "CHE-123.456.789",
        "iban": "CH00 0000 0000 0000 0000 0",
    })
}

/// A footer of four lines, the first red and bold, the page number on the last line at the right: the brand's.
pub(super) fn brand_footer() -> Frame {
    Frame {
        valign: Valign::Bottom,
        rule: Rule {
            show: true,
            thickness_pt: 0.5,
            color: "e50339".to_owned(),
        },
        left: vec![
            line("{legal_name}", "{legal_name}", 10.0, true, "e50339"),
            plain_line("{address}"),
            plain_line("{contacts}"),
            line(
                "[CF/P.IVA {vat}]   [IBAN {iban}]",
                "[VAT {vat}]   [IBAN {iban}]",
                7.5,
                false,
                "595c69",
            ),
        ],
        center: Vec::new(),
        right: vec![line(
            "{page} / {pages}",
            "{page} / {pages}",
            8.0,
            false,
            "595c69",
        )],
    }
}

/// The brand's letterhead as the spike drew it: a logo and a full footer on the first page, a header with
/// the page number on the middle ones, a full footer again on the last, and a band behind the first page.
pub(super) fn brand_config() -> LetterheadConfig {
    use crate::config::{Margins, Variant};
    let mut config = default_config();
    config.margins = Margins {
        top: 32.0,
        bottom: 34.0,
        left: 25.4,
        right: 25.4,
    };
    let mut header = empty_frame(Valign::Top);
    header.rule.show = true;
    header.right = vec![line(
        "Offerta – pagina {page} di {pages}",
        "Offer – page {page} of {pages}",
        8.0,
        false,
        "595c69",
    )];
    let mut small_footer = empty_frame(Valign::Bottom);
    small_footer.right = vec![plain_line("{page} / {pages}")];
    config.variants.default = Variant {
        header,
        footer: small_footer,
        logo: None,
        background: None,
    };
    config.variants.first = Some(Variant {
        header: empty_frame(Valign::Top),
        footer: brand_footer(),
        logo: Some(logo(LOGO_ID, LogoPosition::Left, 12.7)),
        background: Some(BAND_ID.to_owned()),
    });
    config.variants.last = Some(Variant {
        header: config.variants.default.header.clone(),
        footer: brand_footer(),
        logo: None,
        background: None,
    });
    config
}
