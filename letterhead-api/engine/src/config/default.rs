//! The starting configuration (amendment G2): what the configurator shows for an entity that has no
//! version yet, and what the first save (`baseVersion: 0`) starts from.

use super::bounds;
use super::model::{
    BodyLook, BulletMarker, Font, Fonts, Frame, HeadingLook, LetterheadConfig, Line, LocalText,
    Look, Margins, Rule, TableLook, Valign, Variant, Variants,
};

fn line(text: &str, size: f64, bold: bool, color: &str) -> Line {
    Line {
        // Placeholders only, so the text is the same in both languages.
        text: LocalText {
            it: text.to_owned(),
            en: text.to_owned(),
        },
        size,
        bold,
        color: color.to_owned(),
    }
}

fn rule(show: bool) -> Rule {
    Rule {
        show,
        thickness_pt: 0.5,
        color: "c9cad1".to_owned(),
    }
}

fn heading(size: f64, color: &str) -> HeadingLook {
    HeadingLook {
        size,
        bold: true,
        color: color.to_owned(),
    }
}

/// A valid `LetterheadConfig` v1: margins of 25 mm, Noto Serif for the body, Ubuntu for headings and the
/// frame, and a default variant with no logo and an empty header whose footer is the legal name and the
/// address on the left and "page / pages" on the right, level with the last line.
pub fn default_config() -> LetterheadConfig {
    let header = Frame {
        valign: Valign::Top,
        gap_mm: bounds::DEFAULT_GAP_MM,
        rule: rule(false),
        left: Vec::new(),
        center: Vec::new(),
        right: Vec::new(),
    };
    let footer = Frame {
        valign: Valign::Bottom,
        gap_mm: bounds::DEFAULT_GAP_MM,
        rule: rule(true),
        left: vec![
            line("{legal_name}", 9.0, true, "1f2430"),
            line("{address}", 8.0, false, "595c69"),
        ],
        center: Vec::new(),
        right: vec![line("{page} / {pages}", 8.0, false, "595c69")],
    };
    LetterheadConfig {
        margins: Margins {
            top: 25.0,
            bottom: 25.0,
            left: 25.0,
            right: 25.0,
        },
        fonts: Fonts {
            body: Font::NotoSerif,
            heading: Font::Ubuntu,
            frame: Font::Ubuntu,
        },
        look: Look {
            headings: vec![
                heading(15.0, "e50339"),
                heading(12.0, "1f2430"),
                heading(10.5, "595c69"),
            ],
            body: BodyLook {
                size: 10.5,
                line_spacing: 1.2,
            },
            table: TableLook {
                header_fill: "f1f1f4".to_owned(),
                borders: true,
                border_color: "c9cad1".to_owned(),
            },
            bullet_marker: BulletMarker::Bullet,
        },
        variants: Variants {
            default: Variant {
                header,
                footer,
                logo: None,
                background: None,
            },
            first: None,
            last: None,
        },
    }
}
