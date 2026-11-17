//! The engine's one entry point (task T7): a request, a letterhead version and its assets in; the document's
//! pages and its PDF out (AC-1.1, AC-1.2, AC-1.4, AC-3.3, AC-7.6).
//!
//! [`render`] compiles the request **once**. Everything it returns is read from that one laid-out document:
//! the page count, the placeholders that had no value, the count of characters the fonts lacked, the PDF
//! ([`Rendered::pdf`]) and the preview pages with their text ([`Rendered::preview`]). A caller that wants the
//! PDF does not rasterise, and a caller that wants a preview does not export a PDF.
//!
//! Pure like the rest of the engine: no clock, no file, no network. Dropping a [`Rendered`] drops the document;
//! the engine keeps nothing of it (AC-3.7). The memoisation cache of Typst (`comemo`) is process state outside
//! this crate: the worker evicts it after each job.

use typst_layout::PagedDocument;

use crate::config::LetterheadConfig;
use crate::content::RenderRequest;
use crate::layout::{self, Assets, LayoutError};
use crate::output::{self, PageSelection};

/// AC-3.3: a document of more pages than this is refused.
pub const MAX_PAGES: usize = 300;

/// A letterhead version as the engine needs it: its number, the layout it was saved with and its
/// configuration. The assets it uses come with the call.
#[derive(Debug, Clone, PartialEq)]
pub struct LetterheadVersion {
    pub number: i32,
    pub layout_version: u32,
    pub config: LetterheadConfig,
}

/// Why nothing was rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderError {
    /// The layout could not lay the document out: see [`LayoutError`].
    Layout(LayoutError),
    /// AC-3.3: more than [`MAX_PAGES`] pages. Nothing partial is returned.
    TooManyPages,
    /// A preview was asked for a page the document does not have.
    PageOutOfRange,
}

impl RenderError {
    /// The `code` of the RFC 7807 answer.
    pub fn code(&self) -> &'static str {
        match self {
            RenderError::Layout(error) => error.code(),
            RenderError::TooManyPages => "too_many_pages",
            RenderError::PageOutOfRange => "invalid_pages",
        }
    }
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for RenderError {}

impl From<LayoutError> for RenderError {
    fn from(error: LayoutError) -> RenderError {
        RenderError::Layout(error)
    }
}

/// One preview page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewPage {
    /// From 1.
    pub number: usize,
    /// A 64-colour paletted PNG, 893 x 1263 for A4 (AC-1.2).
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// The page's text in reading order.
    pub text: String,
}

/// A rendered document.
pub struct Rendered {
    document: PagedDocument,
    /// The number of the letterhead version the document was laid out with.
    pub letterhead_version: i32,
    pub layout_version: u32,
    pub page_count: usize,
    /// The placeholders that the drawn headers and footers used and that had no value, sorted (AC-6.4).
    pub missing_placeholders: Vec<&'static str>,
    /// How many characters of the document no font held, over every page (AC-7.6). Never which.
    pub unprintable_characters: usize,
}

impl Rendered {
    /// The PDF of the whole document (AC-1.1): the same bytes for the same request (AC-1.4).
    pub fn pdf(&self) -> Result<Vec<u8>, RenderError> {
        output::pdf(&self.document).ok_or_else(|| {
            RenderError::Layout(LayoutError::Internal {
                detail: "pdf export".to_owned(),
            })
        })
    }

    /// The preview pages asked for, each with its picture and its text (AC-1.2). A page past the end is
    /// [`RenderError::PageOutOfRange`].
    pub fn preview(&self, pages: &PageSelection) -> Result<Vec<PreviewPage>, RenderError> {
        let numbers = pages
            .resolve(self.page_count)
            .ok_or(RenderError::PageOutOfRange)?;
        numbers
            .into_iter()
            .map(|number| {
                let page = &self.document.pages()[number - 1];
                let image = output::preview_image(page).ok_or_else(|| {
                    RenderError::Layout(LayoutError::Internal {
                        detail: "png encoding".to_owned(),
                    })
                })?;
                Ok(PreviewPage {
                    number,
                    png: image.png,
                    width: image.width,
                    height: image.height,
                    text: output::page_text(page),
                })
            })
            .collect()
    }

    /// The text of every page, in reading order, without drawing anything.
    pub fn page_texts(&self) -> Vec<String> {
        self.document
            .pages()
            .iter()
            .map(output::page_text)
            .collect()
    }

    /// The laid-out document, for the frame-level checks of the golden corpus.
    pub fn document(&self) -> &PagedDocument {
        &self.document
    }
}

/// Lay `request` out on `version` and keep the document. `assets` holds the stored bytes of every asset the
/// version's configuration uses, by id.
///
/// Refused before any output is made: a layout this binary lacks, a frame that does not fit its margin
/// (AC-5.3), an image the asset rules refuse (AC-2.3), more than [`MAX_PAGES`] pages (AC-3.3).
pub fn render(
    request: &RenderRequest,
    version: &LetterheadVersion,
    assets: &Assets,
) -> Result<Rendered, RenderError> {
    let layout = layout::layout(version.layout_version)
        .ok_or(LayoutError::UnknownLayout(version.layout_version))?;
    let compiled = layout::compile(layout, &version.config, assets, request)?;
    let page_count = compiled.document.pages().len();
    if page_count > MAX_PAGES {
        return Err(RenderError::TooManyPages);
    }
    let unprintable_characters = compiled
        .document
        .pages()
        .iter()
        .map(layout::inspect::unprintable_characters)
        .sum();
    Ok(Rendered {
        document: compiled.document,
        letterhead_version: version.number,
        layout_version: version.layout_version,
        page_count,
        missing_placeholders: compiled.missing_placeholders,
        unprintable_characters,
    })
}

// The tests live under output/ with the rest of this task's files.
#[cfg(test)]
#[path = "output/render_tests.rs"]
mod tests;
