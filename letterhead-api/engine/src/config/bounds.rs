//! The closed sets and numeric bounds of a letterhead configuration (AC-5.1, 5.2, 5.6, 5.9, 7.4, 7.5).
//!
//! One place, read by the validator, by the catalog route (`GET /v1/catalog`, which sends them to the
//! configurator so that the browser holds no rule of its own) and by the layout's fit check.

use serde::Serialize;

/// An inclusive range.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

impl Range {
    pub const fn new(min: f64, max: f64) -> Range {
        Range { min, max }
    }

    pub fn contains(self, value: f64) -> bool {
        value >= self.min && value <= self.max
    }
}

/// A4, in millimetres.
pub const PAGE_WIDTH_MM: f64 = 210.0;
pub const PAGE_HEIGHT_MM: f64 = 297.0;

/// AC-5.1: each margin, in mm.
pub const MARGIN_MM: Range = Range::new(5.0, 100.0);
/// AC-5.1: the body area left by the margins is at least this wide and this high, in mm.
pub const BODY_MIN_WIDTH_MM: f64 = 100.0;
pub const BODY_MIN_HEIGHT_MM: f64 = 150.0;

/// AC-5.2 (A1): lines in one zone of a header or footer.
pub const MAX_LINES_PER_ZONE: usize = 4;
/// AC-5.2: a header or footer must fit its margin with every placeholder replaced by a value this long.
pub const FIT_TEST_VALUE_CHARS: usize = 40;
/// AC-5.2 (A2): the size of one line of a header or footer, in pt.
pub const LINE_SIZE_PT: Range = Range::new(6.0, 14.0);
/// AC-5.6: the thickness of a rule, in pt. The spec names a thickness and no bounds; these keep a rule a
/// hairline-to-thick line that fits the margin it is drawn in (plan decision, to confirm).
pub const RULE_THICKNESS_PT: Range = Range::new(0.1, 5.0);

/// The distance between a header or footer and the body, in mm (the `gapMm` of a frame). The spec names no
/// bounds (a product-owner request after AC-5.6); 0 lets a frame touch the body, and 40 is as far as the
/// tallest logo (40 mm, `LOGO_HEIGHT_MM`) is high. Like the other mm bounds it is a closed range of any
/// number, with no step.
pub const GAP_MM: Range = Range::new(0.0, 40.0);
/// What a frame's gap is when a stored configuration has none: the 3 mm that layout 1 drew before the gap
/// was configurable, so that every configuration stored earlier renders as it did.
pub const DEFAULT_GAP_MM: f64 = 3.0;

/// AC-5.9: headings have this many levels, each with its own look.
pub const HEADING_LEVELS: usize = 3;
/// AC-5.9: heading size, body size and line spacing.
pub const HEADING_SIZE_PT: Range = Range::new(8.0, 24.0);
pub const BODY_SIZE_PT: Range = Range::new(8.0, 14.0);
pub const LINE_SPACING: Range = Range::new(1.0, 2.0);

/// AC-7.4: the height of a logo, in mm.
pub const LOGO_HEIGHT_MM: Range = Range::new(5.0, 40.0);
