//! The names of the settings a save changed (amendment G9), for the change record (AC-4.7) and the
//! history (AC-8.7). Keys only: never a value.

use super::model::{LetterheadConfig, Variant};

/// The closed vocabulary, in the order a change list uses. The configurator has a copy key for each.
pub const SETTING_NAMES: [&str; 20] = [
    "margins",
    "fonts",
    "look.headings",
    "look.body",
    "look.table",
    "look.bulletMarker",
    "variants.default.header",
    "variants.default.footer",
    "variants.default.logo",
    "variants.default.background",
    "variants.first",
    "variants.first.header",
    "variants.first.footer",
    "variants.first.logo",
    "variants.first.background",
    "variants.last",
    "variants.last.header",
    "variants.last.footer",
    "variants.last.logo",
    "variants.last.background",
];

const DEFAULT: [&str; 4] = [
    "variants.default.header",
    "variants.default.footer",
    "variants.default.logo",
    "variants.default.background",
];
const FIRST: [&str; 4] = [
    "variants.first.header",
    "variants.first.footer",
    "variants.first.logo",
    "variants.first.background",
];
const LAST: [&str; 4] = [
    "variants.last.header",
    "variants.last.footer",
    "variants.last.logo",
    "variants.last.background",
];

fn variant_parts(
    old: &Variant,
    new: &Variant,
    names: [&'static str; 4],
    out: &mut Vec<&'static str>,
) {
    if old.header != new.header {
        out.push(names[0]);
    }
    if old.footer != new.footer {
        out.push(names[1]);
    }
    if old.logo != new.logo {
        out.push(names[2]);
    }
    if old.background != new.background {
        out.push(names[3]);
    }
}

/// An optional variant: switched on or off is one name (`variants.first`); present in both, its parts.
fn optional_variant(
    old: Option<&Variant>,
    new: Option<&Variant>,
    whole: &'static str,
    names: [&'static str; 4],
    out: &mut Vec<&'static str>,
) {
    match (old, new) {
        (None, None) => {}
        (Some(old), Some(new)) => variant_parts(old, new, names, out),
        _ => out.push(whole),
    }
}

/// The settings that differ between two configurations, in [`SETTING_NAMES`] order. Equal: empty.
pub fn changed_settings(old: &LetterheadConfig, new: &LetterheadConfig) -> Vec<&'static str> {
    let mut out = Vec::new();
    if old.margins != new.margins {
        out.push("margins");
    }
    if old.fonts != new.fonts {
        out.push("fonts");
    }
    if old.look.headings != new.look.headings {
        out.push("look.headings");
    }
    if old.look.body != new.look.body {
        out.push("look.body");
    }
    if old.look.table != new.look.table {
        out.push("look.table");
    }
    if old.look.bullet_marker != new.look.bullet_marker {
        out.push("look.bulletMarker");
    }
    variant_parts(
        &old.variants.default,
        &new.variants.default,
        DEFAULT,
        &mut out,
    );
    optional_variant(
        old.variants.first.as_ref(),
        new.variants.first.as_ref(),
        "variants.first",
        FIRST,
        &mut out,
    );
    optional_variant(
        old.variants.last.as_ref(),
        new.variants.last.as_ref(),
        "variants.last",
        LAST,
        &mut out,
    );
    out
}

/// The first save of an entity (`baseVersion: 0`) has no earlier version: everything it sets is new.
pub fn initial_settings(new: &LetterheadConfig) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = SETTING_NAMES[..10].to_vec();
    if new.variants.first.is_some() {
        out.push("variants.first");
    }
    if new.variants.last.is_some() {
        out.push("variants.last");
    }
    out
}
