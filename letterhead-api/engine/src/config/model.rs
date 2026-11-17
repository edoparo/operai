//! `LetterheadConfig` v1: what a letterhead version stores (plan § Data model).
//!
//! A value of [`LetterheadConfig`] has passed [`super::validate_config`], or was read back from a version
//! that did. The derives are for storing it as JSON and reading it back; a config from a person is never
//! deserialised directly (serde's errors quote the text), it goes through the validator.

use serde::{Deserialize, Serialize};

/// The closed font list (AC-7.5): the suite's fonts and wellD's brand fonts, 13 files in all. Names are the
/// families' names as the configurator shows and the template looks them up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Font {
    #[serde(rename = "DM Sans")]
    DmSans,
    #[serde(rename = "DM Mono")]
    DmMono,
    #[serde(rename = "Syne")]
    Syne,
    #[serde(rename = "Ubuntu")]
    Ubuntu,
    #[serde(rename = "Noto Serif")]
    NotoSerif,
}

impl Font {
    pub const ALL: [Font; 5] = [
        Font::DmSans,
        Font::DmMono,
        Font::Syne,
        Font::Ubuntu,
        Font::NotoSerif,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Font::DmSans => "DM Sans",
            Font::DmMono => "DM Mono",
            Font::Syne => "Syne",
            Font::Ubuntu => "Ubuntu",
            Font::NotoSerif => "Noto Serif",
        }
    }

    pub fn parse(name: &str) -> Option<Font> {
        Font::ALL.into_iter().find(|f| f.name() == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Margins {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fonts {
    pub body: Font,
    pub heading: Font,
    /// Header and footer.
    pub frame: Font,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeadingLook {
    pub size: f64,
    pub bold: bool,
    /// Six hexadecimal digits, lower case, no `#`.
    pub color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodyLook {
    pub size: f64,
    pub line_spacing: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableLook {
    pub header_fill: String,
    pub borders: bool,
    pub border_color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BulletMarker {
    Bullet,
    Dash,
}

/// AC-5.9: the look of each block type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Look {
    /// Levels 1 to 3, in this order.
    pub headings: Vec<HeadingLook>,
    pub body: BodyLook,
    pub table: TableLook,
    pub bullet_marker: BulletMarker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Valign {
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogoPosition {
    Left,
    Center,
    Right,
}

/// A header or footer text in both languages (AC-5.8). Placeholders and literal escapes are read by
/// [`super::parse_text`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalText {
    pub it: String,
    pub en: String,
}

/// One line of a header or footer zone, with its own look (AC-5.2, A2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    pub text: LocalText,
    pub size: f64,
    pub bold: bool,
    pub color: String,
}

/// AC-5.6: a rule between the frame's text and the body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub show: bool,
    pub thickness_pt: f64,
    pub color: String,
}

/// A header or a footer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Frame {
    pub valign: Valign,
    pub rule: Rule,
    pub left: Vec<Line>,
    pub center: Vec<Line>,
    pub right: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Logo {
    /// The id of an uploaded asset, lower-case hyphenated UUID.
    pub asset: String,
    pub position: LogoPosition,
    pub height_mm: f64,
}

/// The header, footer, logo and background of one kind of page (AC-5.4, 5.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variant {
    pub header: Frame,
    pub footer: Frame,
    #[serde(default)]
    pub logo: Option<Logo>,
    /// The id of an uploaded asset (AC-7.7).
    #[serde(default)]
    pub background: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variants {
    pub default: Variant,
    #[serde(default)]
    pub first: Option<Variant>,
    #[serde(default)]
    pub last: Option<Variant>,
}

/// A letterhead version's configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LetterheadConfig {
    pub margins: Margins,
    pub fonts: Fonts,
    pub look: Look,
    pub variants: Variants,
}

impl LetterheadConfig {
    /// The ids of the assets this configuration uses, each once, in the order logo then background of the
    /// default, first and last variants. A save links a version to exactly these (AC-4.6).
    pub fn asset_ids(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = Vec::new();
        let variants = [
            Some(&self.variants.default),
            self.variants.first.as_ref(),
            self.variants.last.as_ref(),
        ];
        for variant in variants.into_iter().flatten() {
            let found = [
                variant.logo.as_ref().map(|l| l.asset.as_str()),
                variant.background.as_deref(),
            ];
            for id in found.into_iter().flatten() {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        ids
    }
}
