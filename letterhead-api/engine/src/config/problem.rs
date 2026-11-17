//! The problems of a refused configuration or upload: plan amendment G3.

use serde::Serialize;

use crate::content::Language;

/// Why a value of a configuration is refused. The first fifteen are the vocabulary of amendment G3 (as
/// amended 2026-11-17, with `unbalanced_bracket`); the last three (`wrong_type`, `missing_member`,
/// `unknown_member`) say a configuration is not the shape the configurator sends. The form never produces
/// them, so the configurator shows its generic "this value was refused" for them (design § Copy,
/// `problem.refused`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    OutOfRange,
    NotANumber,
    BadColour,
    UnknownFont,
    UnknownPlaceholder,
    UnbalancedBrace,
    /// An unclosed `[` or a stray `]`: a conditional segment (AC-6.6), not a placeholder or literal brace.
    UnbalancedBracket,
    SegmentNoPlaceholder,
    SegmentNested,
    TooManyLines,
    LanguageMissing,
    BodyTooSmall,
    /// Found by the layout when it measures a frame (task T5), not by [`super::validate_config`].
    HeaderOverflow,
    /// As [`Reason::HeaderOverflow`].
    FooterOverflow,
    /// Found by the save route when an id is not an uploaded asset of the entity (task T15).
    AssetUnknown,
    WrongType,
    MissingMember,
    UnknownMember,
}

impl Reason {
    pub const ALL: [Reason; 18] = [
        Reason::OutOfRange,
        Reason::NotANumber,
        Reason::BadColour,
        Reason::UnknownFont,
        Reason::UnknownPlaceholder,
        Reason::UnbalancedBrace,
        Reason::UnbalancedBracket,
        Reason::SegmentNoPlaceholder,
        Reason::SegmentNested,
        Reason::TooManyLines,
        Reason::LanguageMissing,
        Reason::BodyTooSmall,
        Reason::HeaderOverflow,
        Reason::FooterOverflow,
        Reason::AssetUnknown,
        Reason::WrongType,
        Reason::MissingMember,
        Reason::UnknownMember,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Reason::OutOfRange => "out_of_range",
            Reason::NotANumber => "not_a_number",
            Reason::BadColour => "bad_colour",
            Reason::UnknownFont => "unknown_font",
            Reason::UnknownPlaceholder => "unknown_placeholder",
            Reason::UnbalancedBrace => "unbalanced_brace",
            Reason::UnbalancedBracket => "unbalanced_bracket",
            Reason::SegmentNoPlaceholder => "segment_no_placeholder",
            Reason::SegmentNested => "segment_nested",
            Reason::TooManyLines => "too_many_lines",
            Reason::LanguageMissing => "language_missing",
            Reason::BodyTooSmall => "body_too_small",
            Reason::HeaderOverflow => "header_overflow",
            Reason::FooterOverflow => "footer_overflow",
            Reason::AssetUnknown => "asset_unknown",
            Reason::WrongType => "wrong_type",
            Reason::MissingMember => "missing_member",
            Reason::UnknownMember => "unknown_member",
        }
    }
}

/// One refused value: `invalid_letterhead.problems[]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Problem {
    /// JSON Pointer into the `LetterheadConfig` (RFC 6901), for example `/margins/left` or
    /// `/variants/first/footer/left/1/text/en`. For a frame that does not fit, the frame itself.
    pub path: String,
    pub reason: Reason,
    /// The placeholder (`unknown_placeholder`), the brace (`unbalanced_brace`), the bracket (`unbalanced_bracket`) or the option
    /// (a bound, a colour, a font) concerned. Text the person typed, cut to [`MAX_NAME_CHARS`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The language of the text concerned (`language_missing`, and the problems of one language's text).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<Language>,
}

/// The longest `name` of a problem: what a person typed is echoed, but not without bound.
pub const MAX_NAME_CHARS: usize = 40;

/// `text` cut to [`MAX_NAME_CHARS`] characters.
pub(super) fn shown(text: &str) -> String {
    text.chars().take(MAX_NAME_CHARS).collect()
}
