//! `LetterheadConfig` v1, its save validation, the placeholder parser, the starting configuration and the
//! change vocabulary (task T3; AC-5.1, 5.2, 5.6, 5.8, 5.9, 6.1, 6.2, 6.6, 7.4, 7.5).

pub mod bounds;
mod default;
mod diff;
mod model;
mod problem;
mod text;
mod validate;

pub use default::default_config;
pub use diff::{SETTING_NAMES, changed_settings, initial_settings};
pub use model::{
    BodyLook, BulletMarker, Font, Fonts, Frame, HeadingLook, LetterheadConfig, Line, LocalText,
    Logo, LogoPosition, Look, Margins, Rule, TableLook, Valign, Variant, Variants,
};
pub use problem::{MAX_NAME_CHARS, Problem, Reason};
pub use text::{Placeholder, TextError, Token, parse_text};
pub use validate::validate_config;

#[cfg(test)]
mod tests;
