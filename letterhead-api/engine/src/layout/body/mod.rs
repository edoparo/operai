//! The document's blocks and the letterhead's look as data for the template (tasks T5 and T6; AC-1.5, AC-1.6,
//! AC-2.3, AC-5.9).
//!
//! The blocks are the validated request's, serialised as they are: text stays a JSON string, which the
//! template places as a `str` and Typst never reads as markup (US-2). Images are the one change. A block
//! carries its bytes in base64; they are decoded here, judged again by [`crate::assets::ingest`] (the engine
//! trusts no caller's bytes, AC-2.3), and become files of the World at `/img/<n>.<ext>`; the template is told
//! the path and the share of the body's width, and never the bytes.

use base64::Engine as _;
use serde_json::{Map, Value, json};

use super::LayoutError;
use crate::assets::{self, Reason};
use crate::config::Look;
use crate::content::Block;
use crate::world;

/// The look of the block types (AC-5.9).
pub(super) fn look(look: &Look) -> Value {
    json!({
        "headings": look.headings,
        "body": look.body,
        "table": look.table,
        "bullet": look.bullet_marker,
    })
}

fn internal(what: &str) -> LayoutError {
    LayoutError::Internal {
        detail: what.to_owned(),
    }
}

/// An image block's `data`, decoded and judged. The refusal's path is the member that held the bytes.
fn ingest(index: usize, data: &str) -> Result<assets::Ingested, LayoutError> {
    let refused = |reason: Reason| LayoutError::Image {
        path: format!("/blocks/{index}/data"),
        reason,
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| refused(Reason::UnsupportedFormat))?;
    assets::ingest(&bytes).map_err(refused)
}

/// The blocks, as the template reads them. The files of the images are added to `files`.
pub(super) fn blocks(
    blocks: &[Block],
    files: &mut Vec<(String, Vec<u8>)>,
) -> Result<Value, LayoutError> {
    let mut out = Vec::with_capacity(blocks.len());
    let mut images = 0;
    for (index, block) in blocks.iter().enumerate() {
        let mut value = serde_json::to_value(block).map_err(|_| internal("block"))?;
        if let Block::Image(image) = block {
            if images >= world::MAX_IMAGES {
                return Err(internal("more images than file names"));
            }
            let ingested = ingest(index, &image.data)?;
            let path = world::image_path(images, ingested.format);
            images += 1;
            files.push((path.clone(), ingested.bytes));
            let mut member = Map::new();
            member.insert("type".to_owned(), json!("image"));
            member.insert("path".to_owned(), json!(path));
            // The share of the body's width: the full width unless the request says less.
            member.insert("ratio".to_owned(), json!(image.width_ratio.unwrap_or(1.0)));
            if let Some(style) = image.style {
                member.insert("style".to_owned(), json!(style));
            }
            value = Value::Object(member);
        }
        out.push(value);
    }
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests;
