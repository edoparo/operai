//! The image blocks of a validated request, judged by the asset rules before anything is rendered
//! (amendment 2026-11-17, 3g; AC-2.3, AC-7.1 to AC-7.3).
//!
//! [`validate_request`](super::validate_request) checks only that an image's `data` is base64 (AC-2.3: a
//! request that names an address is refused there). What the bytes *are* is decided here, by
//! [`crate::assets::ingest`], and the result replaces the caller's bytes in the request:
//!
//! - a PNG or JPEG whose container is sound is kept as it came;
//! - an SVG is *rebuilt* (allowlisted elements and attributes, written out again), and the request then
//!   holds the rebuilt file, never the caller's. What reaches a worker is therefore what this module
//!   produced (spike F5: Typst resolves a relative `href` through the World, so the caller's SVG must never
//!   get that far);
//! - anything else is refused, at the path of the block's `data`, with the asset reason (`svg_script`,
//!   `too_many_pixels`, ...). Up to [`MAX_PROBLEMS`] are listed. Nothing of the bytes is ever echoed.
//!
//! Pure, like the rest of the engine. The supervisor runs it after `validate_request` and before it takes a
//! worker, so a refused image costs no render.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use super::model::{Block, RenderRequest};
use super::validate::{MAX_PROBLEMS, Problem, Reason, Rejection};
use crate::assets::{self, Format};

/// Judge every image block of `request` and replace its `data` by the bytes the asset rules produced.
///
/// `Err` is [`Rejection::InvalidContent`] with one problem per refused image, in document order, at most
/// [`MAX_PROBLEMS`]. On `Err` the request is left as it was.
pub fn ingest_images(request: &mut RenderRequest) -> Result<(), Rejection> {
    let mut problems = Vec::new();
    let mut rebuilt: Vec<(usize, String)> = Vec::new();
    for (index, block) in request.blocks.iter().enumerate() {
        let Block::Image(image) = block else {
            continue;
        };
        let refused = |reason: Reason| Problem {
            path: format!("/blocks/{index}/data"),
            reason,
        };
        let Ok(bytes) = STANDARD.decode(&image.data) else {
            problems.push(refused(Reason::InvalidBase64));
            continue;
        };
        match assets::ingest(&bytes) {
            // A raster is judged and kept as it came: there is nothing to rebuild, and encoding it again
            // would only copy it.
            Ok(ingested) if ingested.format != Format::Svg => {}
            Ok(ingested) => rebuilt.push((index, STANDARD.encode(&ingested.bytes))),
            Err(reason) => problems.push(refused(Reason::Asset(reason))),
        }
        if problems.len() >= MAX_PROBLEMS {
            break;
        }
    }
    if !problems.is_empty() {
        problems.truncate(MAX_PROBLEMS);
        return Err(Rejection::InvalidContent(problems));
    }
    for (index, data) in rebuilt {
        if let Some(Block::Image(image)) = request.blocks.get_mut(index) {
            image.data = data;
        }
    }
    Ok(())
}
