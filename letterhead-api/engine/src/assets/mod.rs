//! Asset ingestion (task T8; AC-2.3, 7.1, 7.2, 7.3): what bytes may become a logo, a background or an image
//! block.
//!
//! One entry point, [`ingest`], for every image the service takes from a caller:
//!
//! - the format comes from the bytes, never from a name or a declared type (AC-7.1): PNG, JPEG or SVG;
//! - at most [`MAX_BYTES`]; a raster of at most [`MAX_PIXELS`] decoded, judged from its header before
//!   anything is decoded (AC-7.3); an SVG of at most [`MAX_SVG_ELEMENTS`] elements;
//! - a raster is stored as it came, after its container is checked (PNG chunks and checksums, JPEG
//!   segments): a file that would fail to decode later is refused now, because a version that holds it
//!   would fail every render, for good (AC-4.3);
//! - an SVG is **rebuilt**, not filtered: it is read into a tree of allowlisted elements and attributes and
//!   written out again (see [`svg`]). Whatever is not on the list is gone, so what the engine's World later
//!   reads is only what this module wrote (the spike's F5: Typst resolves a relative `href` through the
//!   World, so the sanitiser is load-bearing).
//!
//! The reason of a refusal is one of [`Reason`], the vocabulary of amendment G3 for uploads.

use serde::{Deserialize, Serialize};

mod raster;
mod svg;

/// AC-7.3: a logo file, and an image of a block, is at most 2 MiB.
pub const MAX_BYTES: usize = 2 * 1024 * 1024;
/// AC-7.3: a raster of more decoded pixels than this is refused.
pub const MAX_PIXELS: u64 = 25_000_000;
/// AC-7.3: an SVG of more elements than this is refused. A `<use>` counts the elements it stands for.
pub const MAX_SVG_ELEMENTS: usize = 10_000;

/// The format of an accepted image (AC-7.1), as the database and the API name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Png,
    Jpeg,
    Svg,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpeg",
            Format::Svg => "svg",
        }
    }
}

/// Why an image is refused (`invalid_asset.reason`, amendment G3; `svg_not_allowed` is added to the list for
/// an SVG that holds something outside the allowlist that is not one of the specific faults).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// Not a PNG, JPEG or SVG, or one that is damaged or of a kind the service does not take.
    UnsupportedFormat,
    TooManyBytes,
    TooManyPixels,
    TooManyElements,
    SvgScript,
    SvgEventHandler,
    SvgForeignObject,
    /// A document-type or entity declaration.
    SvgDoctype,
    /// A reference to anything outside the file: an address, a path, a stylesheet, an import.
    SvgExternalReference,
    SvgNotAllowed,
}

impl Reason {
    pub const ALL: [Reason; 10] = [
        Reason::UnsupportedFormat,
        Reason::TooManyBytes,
        Reason::TooManyPixels,
        Reason::TooManyElements,
        Reason::SvgScript,
        Reason::SvgEventHandler,
        Reason::SvgForeignObject,
        Reason::SvgDoctype,
        Reason::SvgExternalReference,
        Reason::SvgNotAllowed,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Reason::UnsupportedFormat => "unsupported_format",
            Reason::TooManyBytes => "too_many_bytes",
            Reason::TooManyPixels => "too_many_pixels",
            Reason::TooManyElements => "too_many_elements",
            Reason::SvgScript => "svg_script",
            Reason::SvgEventHandler => "svg_event_handler",
            Reason::SvgForeignObject => "svg_foreign_object",
            Reason::SvgDoctype => "svg_doctype",
            Reason::SvgExternalReference => "svg_external_reference",
            Reason::SvgNotAllowed => "svg_not_allowed",
        }
    }
}

/// An accepted image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ingested {
    pub format: Format,
    /// The bytes to store and to serve to the engine: the input for a raster, the rebuilt file for an SVG.
    pub bytes: Vec<u8>,
    /// Pixel size of a raster; `None` for an SVG.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_SIGNATURE: [u8; 3] = [0xFF, 0xD8, 0xFF];

/// Judge the bytes of an image and produce what is to be stored.
pub fn ingest(input: &[u8]) -> Result<Ingested, Reason> {
    if input.len() > MAX_BYTES {
        return Err(Reason::TooManyBytes);
    }
    if input.starts_with(&PNG_SIGNATURE) {
        let (width, height) = raster::png(input)?;
        return Ok(raster_result(Format::Png, input, width, height));
    }
    if input.starts_with(&JPEG_SIGNATURE) {
        let (width, height) = raster::jpeg(input)?;
        return Ok(raster_result(Format::Jpeg, input, width, height));
    }
    let bytes = svg::sanitise(input)?;
    Ok(Ingested {
        format: Format::Svg,
        bytes,
        width: None,
        height: None,
    })
}

fn raster_result(format: Format, input: &[u8], width: u32, height: u32) -> Ingested {
    Ingested {
        format,
        bytes: input.to_vec(),
        width: Some(width),
        height: Some(height),
    }
}

#[cfg(test)]
mod tests;
