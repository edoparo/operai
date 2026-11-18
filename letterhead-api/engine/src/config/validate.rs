//! Save validation of a letterhead configuration (AC-5.1, 5.2, 5.6, 5.8, 5.9, 6.1, 6.6, 7.4, 7.5).
//!
//! Like the content validator, this reads a `serde_json::Value` and reports a JSON Pointer path and a
//! reason (amendment G3), never serde's own messages. Unlike it, the answer may name what the person typed
//! (a placeholder, a language): the configurator needs it (AC-6.1, 8.3), cut to a bounded length. All the
//! problems are listed, in document order; every array of a configuration is short and fixed, so the list is
//! bounded by the shape.
//!
//! What this does not check, because it needs more than the configuration: that a header or footer fits its
//! margin with 40-character values (`header_overflow`, `footer_overflow`: the layout measures it, T5) and
//! that an asset id is an uploaded asset of the entity (`asset_unknown`: the save route, T15). It does
//! check that an id is a UUID.

use serde_json::{Map, Value};

use super::bounds::{
    self, BODY_MIN_HEIGHT_MM, BODY_MIN_WIDTH_MM, HEADING_LEVELS, MAX_LINES_PER_ZONE,
    PAGE_HEIGHT_MM, PAGE_WIDTH_MM, Range,
};
use super::model::{
    BodyLook, BulletMarker, Font, Fonts, Frame, HeadingLook, LetterheadConfig, Line, LocalText,
    Logo, LogoPosition, Look, Margins, Rule, TableLook, Valign, Variant, Variants,
    default_title_look,
};
use super::problem::{Problem, Reason, shown};
use super::text::parse_text;
use crate::content::Language;

const ROOT: &[&str] = &["margins", "fonts", "look", "variants"];
const MARGINS: &[&str] = &["top", "bottom", "left", "right"];
const FONTS: &[&str] = &["body", "heading", "frame"];
const LOOK: &[&str] = &["headings", "title", "body", "table", "bulletMarker"];
const HEADING: &[&str] = &["size", "bold", "color"];
const BODY: &[&str] = &["size", "lineSpacing"];
const TABLE: &[&str] = &["headerFill", "borders", "borderColor"];
const VARIANTS: &[&str] = &["default", "first", "last"];
const VARIANT: &[&str] = &["header", "footer", "logo", "background"];
const FRAME: &[&str] = &["valign", "gapMm", "rule", "left", "center", "right"];
const RULE: &[&str] = &["show", "thicknessPt", "color"];
const LINE: &[&str] = &["text", "size", "bold", "color"];
const TEXT: &[&str] = &["it", "en"];
const LOGO: &[&str] = &["asset", "position", "heightMm"];

/// Validate a configuration sent by the configurator and build its typed, canonical form (colours and ids
/// in lower case). `Err` holds every problem found, at least one.
pub fn validate_config(value: &Value) -> Result<LetterheadConfig, Vec<Problem>> {
    let mut walker = Walker::default();
    let config = walker.config(value);
    if walker.problems.is_empty() {
        Ok(config)
    } else {
        Err(walker.problems)
    }
}

#[derive(Default)]
struct Walker {
    /// The JSON Pointer of the value being read.
    path: String,
    problems: Vec<Problem>,
}

/// A text that is empty or only spaces counts as empty (AC-5.8).
fn is_blank(text: &str) -> bool {
    text.trim().is_empty()
}

fn is_hex6(text: &str) -> bool {
    text.len() == 6 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `8-4-4-4-12` hexadecimal digits.
fn is_uuid(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8usize, 4, 4, 4, 12])
            .all(|(g, n)| g.len() == n && g.bytes().all(|b| b.is_ascii_hexdigit()))
}

impl Walker {
    // --- paths and problems ---------------------------------------------------------------------------

    /// Run `f` with `segment` appended to the path.
    fn at<T>(&mut self, segment: &str, f: impl FnOnce(&mut Self) -> T) -> T {
        let len = self.path.len();
        self.path.push('/');
        self.path.push_str(segment);
        let out = f(self);
        self.path.truncate(len);
        out
    }

    fn problem(&mut self, reason: Reason) {
        self.problems.push(Problem {
            path: self.path.clone(),
            reason,
            name: None,
            language: None,
        });
    }

    fn problem_named(&mut self, reason: Reason, name: &str) {
        self.problems.push(Problem {
            path: self.path.clone(),
            reason,
            name: Some(shown(name)),
            language: None,
        });
    }

    // --- one JSON value --------------------------------------------------------------------------------

    fn object<'v>(&mut self, value: &'v Value, allowed: &[&str]) -> Option<&'v Map<String, Value>> {
        let Some(object) = value.as_object() else {
            self.problem(Reason::WrongType);
            return None;
        };
        if object.keys().any(|k| !allowed.contains(&k.as_str())) {
            self.problem(Reason::UnknownMember);
        }
        Some(object)
    }

    /// A required member of `object`, read with `f` at its path. Missing: `missing_member`, and `f` is
    /// given nothing.
    fn member<'v, T>(
        &mut self,
        object: &'v Map<String, Value>,
        key: &str,
        f: impl FnOnce(&mut Self, &'v Value) -> T,
    ) -> Option<T> {
        self.at(key, |w| match object.get(key) {
            Some(value) => Some(f(w, value)),
            None => {
                w.problem(Reason::MissingMember);
                None
            }
        })
    }

    /// An optional, nullable member.
    fn nullable<'v, T>(
        &mut self,
        object: &'v Map<String, Value>,
        key: &str,
        f: impl FnOnce(&mut Self, &'v Value) -> Option<T>,
    ) -> Option<T> {
        match object.get(key) {
            None | Some(Value::Null) => None,
            Some(value) => self.at(key, |w| f(w, value)),
        }
    }

    fn number(&mut self, value: &Value, range: Range, name: &str) -> f64 {
        match value.as_f64() {
            Some(n) if range.contains(n) => n,
            Some(_) => {
                self.problem_named(Reason::OutOfRange, name);
                range.min
            }
            None => {
                self.problem_named(Reason::NotANumber, name);
                range.min
            }
        }
    }

    fn boolean(&mut self, value: &Value) -> bool {
        match value {
            Value::Bool(flag) => *flag,
            _ => {
                self.problem(Reason::WrongType);
                false
            }
        }
    }

    fn colour(&mut self, value: &Value, name: &str) -> String {
        match value.as_str() {
            Some(text) if is_hex6(text) => text.to_ascii_lowercase(),
            _ => {
                self.problem_named(Reason::BadColour, name);
                "000000".to_owned()
            }
        }
    }

    /// An enumerated text. A value outside the set is `out_of_range` (the form offers a select, so a
    /// refusal is a program fault, not a person's typing).
    fn choice<T: Copy>(&mut self, value: &Value, set: &[(&str, T)], name: &str) -> T {
        match value
            .as_str()
            .and_then(|s| set.iter().find(|(n, _)| *n == s))
        {
            Some((_, found)) => *found,
            None => {
                self.problem_named(Reason::OutOfRange, name);
                set[0].1
            }
        }
    }

    // --- the configuration ----------------------------------------------------------------------------

    fn config(&mut self, value: &Value) -> LetterheadConfig {
        let Some(object) = self.object(value, ROOT) else {
            // Not an object: one problem, not four missing parts.
            return placeholder_config();
        };

        let margins = self.member(object, "margins", |w, v| w.margins(v));
        let fonts = self.member(object, "fonts", |w, v| w.fonts(v));
        let look = self.member(object, "look", |w, v| w.look(v));
        let variants = self.member(object, "variants", |w, v| w.variants(v));

        // On a problem the pieces may be absent; the caller drops the result then.
        LetterheadConfig {
            margins: margins.unwrap_or(Margins {
                top: 0.0,
                bottom: 0.0,
                left: 0.0,
                right: 0.0,
            }),
            fonts: fonts.unwrap_or(Fonts {
                body: Font::NotoSerif,
                heading: Font::Ubuntu,
                frame: Font::Ubuntu,
            }),
            look: look.unwrap_or_else(placeholder_look),
            variants: variants.unwrap_or_else(placeholder_variants),
        }
    }

    fn margins(&mut self, value: &Value) -> Margins {
        let mut margins = Margins {
            top: 0.0,
            bottom: 0.0,
            left: 0.0,
            right: 0.0,
        };
        let Some(object) = self.object(value, MARGINS) else {
            return margins;
        };
        let mut valid = true;
        for (key, slot) in [
            ("top", &mut margins.top),
            ("bottom", &mut margins.bottom),
            ("left", &mut margins.left),
            ("right", &mut margins.right),
        ] {
            let before = self.problems.len();
            if let Some(n) = self.member(object, key, |w, v| w.number(v, bounds::MARGIN_MM, key)) {
                *slot = n;
            }
            valid &= self.problems.len() == before;
        }
        // AC-5.1: the body area must stay at least 100 x 150 mm. Judged only when every margin is itself
        // valid, and reported on both margins of the axis that is too small: either may be the one to lower.
        if valid {
            if PAGE_WIDTH_MM - margins.left - margins.right < BODY_MIN_WIDTH_MM {
                for key in ["left", "right"] {
                    self.at(key, |w| w.problem_named(Reason::BodyTooSmall, key));
                }
            }
            if PAGE_HEIGHT_MM - margins.top - margins.bottom < BODY_MIN_HEIGHT_MM {
                for key in ["top", "bottom"] {
                    self.at(key, |w| w.problem_named(Reason::BodyTooSmall, key));
                }
            }
        }
        margins
    }

    fn fonts(&mut self, value: &Value) -> Fonts {
        let mut fonts = Fonts {
            body: Font::NotoSerif,
            heading: Font::Ubuntu,
            frame: Font::Ubuntu,
        };
        let Some(object) = self.object(value, FONTS) else {
            return fonts;
        };
        for (key, slot) in [
            ("body", &mut fonts.body),
            ("heading", &mut fonts.heading),
            ("frame", &mut fonts.frame),
        ] {
            let found = self.member(object, key, |w, v| match v.as_str().and_then(Font::parse) {
                Some(font) => Some(font),
                None => {
                    w.problem_named(Reason::UnknownFont, key);
                    None
                }
            });
            if let Some(Some(font)) = found {
                *slot = font;
            }
        }
        fonts
    }

    fn look(&mut self, value: &Value) -> Look {
        let mut look = placeholder_look();
        let Some(object) = self.object(value, LOOK) else {
            return look;
        };
        if let Some(headings) = self.member(object, "headings", |w, v| w.headings(v)) {
            look.headings = headings;
        }
        // Optional, so that a configuration stored before the field existed is still valid: the title it had.
        if let Some(value) = object.get("title") {
            look.title = self.at("title", |w| {
                w.heading_look(value, bounds::TITLE_SIZE_PT, default_title_look())
            });
        }
        if let Some(body) = self.member(object, "body", |w, v| w.body_look(v)) {
            look.body = body;
        }
        if let Some(table) = self.member(object, "table", |w, v| w.table_look(v)) {
            look.table = table;
        }
        if let Some(marker) = self.member(object, "bulletMarker", |w, v| {
            w.choice(
                v,
                &[
                    ("bullet", BulletMarker::Bullet),
                    ("dash", BulletMarker::Dash),
                ],
                "bulletMarker",
            )
        }) {
            look.bullet_marker = marker;
        }
        look
    }

    fn headings(&mut self, value: &Value) -> Vec<HeadingLook> {
        let mut out = Vec::new();
        let Some(array) = value.as_array() else {
            self.problem(Reason::WrongType);
            return out;
        };
        if array.len() != HEADING_LEVELS {
            // One look per level: three, no more and no fewer.
            self.problem_named(Reason::OutOfRange, "headings");
            return out;
        }
        for (index, item) in array.iter().enumerate() {
            let look = self.at(&index.to_string(), |w| {
                let placeholder = HeadingLook {
                    size: bounds::HEADING_SIZE_PT.min,
                    bold: false,
                    color: "000000".to_owned(),
                };
                w.heading_look(item, bounds::HEADING_SIZE_PT, placeholder)
            });
            out.push(look);
        }
        out
    }

    /// One look of text: a size in `range`, bold, a colour. `look` is what stands in for a member that is
    /// wrong, so that the walk goes on and finds the other problems.
    fn heading_look(
        &mut self,
        value: &Value,
        range: bounds::Range,
        mut look: HeadingLook,
    ) -> HeadingLook {
        let Some(object) = self.object(value, HEADING) else {
            return look;
        };
        if let Some(size) = self.member(object, "size", |w, v| w.number(v, range, "size")) {
            look.size = size;
        }
        if let Some(bold) = self.member(object, "bold", |w, v| w.boolean(v)) {
            look.bold = bold;
        }
        if let Some(color) = self.member(object, "color", |w, v| w.colour(v, "color")) {
            look.color = color;
        }
        look
    }

    fn body_look(&mut self, value: &Value) -> BodyLook {
        let mut look = BodyLook {
            size: bounds::BODY_SIZE_PT.min,
            line_spacing: bounds::LINE_SPACING.min,
        };
        let Some(object) = self.object(value, BODY) else {
            return look;
        };
        if let Some(size) = self.member(object, "size", |w, v| {
            w.number(v, bounds::BODY_SIZE_PT, "size")
        }) {
            look.size = size;
        }
        if let Some(spacing) = self.member(object, "lineSpacing", |w, v| {
            w.number(v, bounds::LINE_SPACING, "lineSpacing")
        }) {
            look.line_spacing = spacing;
        }
        look
    }

    fn table_look(&mut self, value: &Value) -> TableLook {
        let mut look = TableLook {
            header_fill: "000000".to_owned(),
            borders: false,
            border_color: "000000".to_owned(),
        };
        let Some(object) = self.object(value, TABLE) else {
            return look;
        };
        if let Some(fill) = self.member(object, "headerFill", |w, v| w.colour(v, "headerFill")) {
            look.header_fill = fill;
        }
        if let Some(borders) = self.member(object, "borders", |w, v| w.boolean(v)) {
            look.borders = borders;
        }
        if let Some(color) = self.member(object, "borderColor", |w, v| w.colour(v, "borderColor")) {
            look.border_color = color;
        }
        look
    }

    // --- variants, frames, lines ----------------------------------------------------------------------

    fn variants(&mut self, value: &Value) -> Variants {
        let Some(object) = self.object(value, VARIANTS) else {
            return placeholder_variants();
        };
        let default = self
            .member(object, "default", |w, v| w.variant(v))
            .unwrap_or_else(placeholder_variant);
        let first = self.nullable(object, "first", |w, v| Some(w.variant(v)));
        let last = self.nullable(object, "last", |w, v| Some(w.variant(v)));
        Variants {
            default,
            first,
            last,
        }
    }

    fn variant(&mut self, value: &Value) -> Variant {
        let Some(object) = self.object(value, VARIANT) else {
            return placeholder_variant();
        };
        let header = self
            .member(object, "header", |w, v| w.frame(v))
            .unwrap_or_else(placeholder_frame);
        let footer = self
            .member(object, "footer", |w, v| w.frame(v))
            .unwrap_or_else(placeholder_frame);
        let logo = self.nullable(object, "logo", |w, v| w.logo(v));
        let background = self.nullable(object, "background", |w, v| w.asset_id(v));
        Variant {
            header,
            footer,
            logo,
            background,
        }
    }

    /// An asset id: syntax only (see the module doc).
    fn asset_id(&mut self, value: &Value) -> Option<String> {
        match value.as_str() {
            Some(id) if is_uuid(id) => Some(id.to_ascii_lowercase()),
            _ => {
                self.problem(Reason::AssetUnknown);
                None
            }
        }
    }

    fn logo(&mut self, value: &Value) -> Option<Logo> {
        let object = self.object(value, LOGO)?;
        let asset = self
            .member(object, "asset", |w, v| w.asset_id(v))
            .flatten()
            .unwrap_or_default();
        let position = self
            .member(object, "position", |w, v| {
                w.choice(
                    v,
                    &[
                        ("left", LogoPosition::Left),
                        ("center", LogoPosition::Center),
                        ("right", LogoPosition::Right),
                    ],
                    "position",
                )
            })
            .unwrap_or(LogoPosition::Left);
        let height_mm = self
            .member(object, "heightMm", |w, v| {
                w.number(v, bounds::LOGO_HEIGHT_MM, "heightMm")
            })
            .unwrap_or(bounds::LOGO_HEIGHT_MM.min);
        Some(Logo {
            asset,
            position,
            height_mm,
        })
    }

    fn frame(&mut self, value: &Value) -> Frame {
        let mut frame = placeholder_frame();
        let Some(object) = self.object(value, FRAME) else {
            return frame;
        };
        if let Some(valign) = self.member(object, "valign", |w, v| {
            w.choice(
                v,
                &[("top", Valign::Top), ("bottom", Valign::Bottom)],
                "valign",
            )
        }) {
            frame.valign = valign;
        }
        // Optional, so that a configuration stored before the field existed is still valid: the gap it had.
        if let Some(value) = object.get("gapMm") {
            frame.gap_mm = self.at("gapMm", |w| w.number(value, bounds::GAP_MM, "gapMm"));
        }
        if let Some(rule) = self.member(object, "rule", |w, v| w.rule(v)) {
            frame.rule = rule;
        }
        for (key, slot) in [
            ("left", &mut frame.left),
            ("center", &mut frame.center),
            ("right", &mut frame.right),
        ] {
            if let Some(lines) = self.member(object, key, |w, v| w.zone(v)) {
                *slot = lines;
            }
        }
        frame
    }

    fn rule(&mut self, value: &Value) -> Rule {
        let mut rule = Rule {
            show: false,
            thickness_pt: bounds::RULE_THICKNESS_PT.min,
            color: "000000".to_owned(),
        };
        let Some(object) = self.object(value, RULE) else {
            return rule;
        };
        if let Some(show) = self.member(object, "show", |w, v| w.boolean(v)) {
            rule.show = show;
        }
        if let Some(thickness) = self.member(object, "thicknessPt", |w, v| {
            w.number(v, bounds::RULE_THICKNESS_PT, "thicknessPt")
        }) {
            rule.thickness_pt = thickness;
        }
        if let Some(color) = self.member(object, "color", |w, v| w.colour(v, "color")) {
            rule.color = color;
        }
        rule
    }

    /// One zone: at most four lines (AC-5.2, A1).
    fn zone(&mut self, value: &Value) -> Vec<Line> {
        let Some(array) = value.as_array() else {
            self.problem(Reason::WrongType);
            return Vec::new();
        };
        if array.len() > MAX_LINES_PER_ZONE {
            // Reported once, on the zone; its lines are not read, so a zone of a million lines costs nothing.
            self.problem(Reason::TooManyLines);
            return Vec::new();
        }
        array
            .iter()
            .enumerate()
            .map(|(index, item)| self.at(&index.to_string(), |w| w.line(item)))
            .collect()
    }

    fn line(&mut self, value: &Value) -> Line {
        let mut line = Line {
            text: LocalText {
                it: String::new(),
                en: String::new(),
            },
            size: bounds::LINE_SIZE_PT.min,
            bold: false,
            color: "000000".to_owned(),
        };
        let Some(object) = self.object(value, LINE) else {
            return line;
        };
        if let Some(text) = self.member(object, "text", |w, v| w.local_text(v)) {
            line.text = text;
        }
        if let Some(size) = self.member(object, "size", |w, v| {
            w.number(v, bounds::LINE_SIZE_PT, "size")
        }) {
            line.size = size;
        }
        if let Some(bold) = self.member(object, "bold", |w, v| w.boolean(v)) {
            line.bold = bold;
        }
        if let Some(color) = self.member(object, "color", |w, v| w.colour(v, "color")) {
            line.color = color;
        }
        line
    }

    /// A text in both languages (AC-5.8): each is read for placeholders (AC-6.1, 6.2, 6.6), and one filled in
    /// with the other empty is refused, naming the empty language.
    fn local_text(&mut self, value: &Value) -> LocalText {
        let mut text = LocalText {
            it: String::new(),
            en: String::new(),
        };
        let Some(object) = self.object(value, TEXT) else {
            return text;
        };
        for (language, slot) in [(Language::It, 0usize), (Language::En, 1)] {
            let key = language.as_str();
            let read = self.member(object, key, |w, v| match v.as_str() {
                Some(s) => Some(s.to_owned()),
                None => {
                    w.problem(Reason::WrongType);
                    None
                }
            });
            let Some(Some(read)) = read else { continue };
            if slot == 0 {
                text.it = read;
            } else {
                text.en = read;
            }
        }
        for (language, content) in [(Language::It, &text.it), (Language::En, &text.en)] {
            if let Err(error) = parse_text(content) {
                self.at(language.as_str(), |w| {
                    w.problems.push(Problem {
                        path: w.path.clone(),
                        reason: error.reason,
                        name: error.name.clone(),
                        language: Some(language),
                    });
                });
            }
        }
        // Only when both are strings that were read: a text filled in one language and not in the other.
        if object.get("it").is_some_and(Value::is_string)
            && object.get("en").is_some_and(Value::is_string)
        {
            let (it_blank, en_blank) = (is_blank(&text.it), is_blank(&text.en));
            if it_blank != en_blank {
                let missing = if it_blank { Language::It } else { Language::En };
                self.at(missing.as_str(), |w| {
                    w.problems.push(Problem {
                        path: w.path.clone(),
                        reason: Reason::LanguageMissing,
                        name: None,
                        language: Some(missing),
                    });
                });
            }
        }
        text
    }
}

// Stand-ins that keep the walk going after a problem; a configuration with a problem is never returned.

fn placeholder_config() -> LetterheadConfig {
    LetterheadConfig {
        margins: Margins {
            top: 0.0,
            bottom: 0.0,
            left: 0.0,
            right: 0.0,
        },
        fonts: Fonts {
            body: Font::NotoSerif,
            heading: Font::Ubuntu,
            frame: Font::Ubuntu,
        },
        look: placeholder_look(),
        variants: placeholder_variants(),
    }
}

fn placeholder_look() -> Look {
    Look {
        headings: Vec::new(),
        title: default_title_look(),
        body: BodyLook {
            size: bounds::BODY_SIZE_PT.min,
            line_spacing: bounds::LINE_SPACING.min,
        },
        table: TableLook {
            header_fill: "000000".to_owned(),
            borders: false,
            border_color: "000000".to_owned(),
        },
        bullet_marker: BulletMarker::Bullet,
    }
}

fn placeholder_frame() -> Frame {
    Frame {
        valign: Valign::Top,
        gap_mm: bounds::DEFAULT_GAP_MM,
        rule: Rule {
            show: false,
            thickness_pt: bounds::RULE_THICKNESS_PT.min,
            color: "000000".to_owned(),
        },
        left: Vec::new(),
        center: Vec::new(),
        right: Vec::new(),
    }
}

fn placeholder_variant() -> Variant {
    Variant {
        header: placeholder_frame(),
        footer: placeholder_frame(),
        logo: None,
        background: None,
    }
}

fn placeholder_variants() -> Variants {
    Variants {
        default: placeholder_variant(),
        first: None,
        last: None,
    }
}
