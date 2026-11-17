//! The PDF (AC-1.1, AC-1.4).

use typst::foundations::Smart;
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;

/// The identifier of every PDF of the service: a fixed one, so that the same document gives the same bytes
/// (AC-1.4). Without it Typst derives one from the document's title and author, which are empty here too, but
/// that is a default that a Typst upgrade may change.
const IDENT: &str = "letterhead";

/// The PDF of a document, or `None` if the export fails. No creation date, no producer string: nothing in the
/// file depends on the clock or on the machine.
pub fn pdf(document: &PagedDocument) -> Option<Vec<u8>> {
    let options = PdfOptions {
        ident: Smart::Custom(IDENT.to_owned()),
        creator: Smart::Custom(None),
        timestamp: None,
        ..PdfOptions::default()
    };
    typst_pdf::pdf(document, &options).ok()
}
