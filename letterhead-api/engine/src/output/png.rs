//! A preview page: a 64-colour paletted PNG at 1.5 pixels to the point (AC-1.2, AC-1.3; ADR 20261116-the-
//! preview-is-the-pdfs-own-compile...).
//!
//! An A4 page at 1.5 px/pt is 893 x 1263 pixels. Full-colour PNGs of such pages are 300 KiB each; the same
//! page with a palette of 64 colours is about 65 KiB, and the spike measured the same difference from the PDF
//! (0.435 % of pixels by the tolerant metric of AC-1.3) as the full-colour page. 16 colours were 0.74 % and
//! fail. The quantiser (see [`super::quantize`]) is deterministic, so two renders of one request give the same bytes.

use typst_layout::Page;
use typst_render::RenderOptions;

use super::quantize::{Indexed, quantize};

/// AC-1.2: the scale of a preview page.
pub const PREVIEW_PIXELS_PER_PT: f64 = 1.5;
/// The palette's size.
pub const PREVIEW_COLOURS: usize = 64;

/// A preview page's picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewImage {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Rasterise a page and encode it. `None` if the encoder fails (it does not, for an image of this kind).
pub fn preview_image(page: &Page) -> Option<PreviewImage> {
    let pixmap = typst_render::render(
        page,
        &RenderOptions {
            pixel_per_pt: PREVIEW_PIXELS_PER_PT.into(),
            render_bleed: false,
        },
    );
    let (width, height) = (pixmap.width(), pixmap.height());
    // A page has an opaque white ground, so premultiplied and straight alpha are the same here.
    let Indexed { palette, pixels } = quantize(pixmap.data(), PREVIEW_COLOURS);
    let mut png = Vec::new();
    {
        let mut encoder = ::png::Encoder::new(&mut png, width, height);
        encoder.set_color(::png::ColorType::Indexed);
        encoder.set_depth(::png::BitDepth::Eight);
        encoder.set_palette(palette.iter().flatten().copied().collect::<Vec<u8>>());
        encoder.set_compression(::png::Compression::Balanced);
        // Palette indices are not intensities: a filter only makes them harder to compress (10 % larger).
        encoder.set_filter(::png::Filter::NoFilter);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }
    Some(PreviewImage { png, width, height })
}
