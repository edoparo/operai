/**
 * Checks an uploaded letterhead (specs/20261102-crm-offer-document AC-2.5): a PDF pdf-lib can read, with
 * exactly one A4 page. Pure: bytes in, verdict out.
 */

import { PDFDocument } from "pdf-lib";

/** A4 in points, and how far a page may stray from it (printers and exporters round). */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const A4_TOLERANCE = 2;

export type LetterheadVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_pdf" | "page_count" | "not_a4" | "unembeddable" };

export async function checkLetterhead(bytes: Uint8Array): Promise<LetterheadVerdict> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return { ok: false, reason: "not_pdf" };
  }
  if (doc.getPageCount() !== 1) return { ok: false, reason: "page_count" };
  const page = doc.getPage(0);
  let { width, height } = page.getSize();
  // A page rotated a quarter turn is shown with its sides swapped.
  if (page.getRotation().angle % 180 !== 0) [width, height] = [height, width];
  const near = (value: number, target: number) => Math.abs(value - target) <= A4_TOLERANCE;
  if (!(near(width, A4_WIDTH) && near(height, A4_HEIGHT))) return { ok: false, reason: "not_a4" };
  // The renderer draws it as a background on every page: a page it cannot embed
  // (no content stream, say) would fail every offer, so refuse it here.
  try {
    // As the renderer does; the page is only written (and can only fail) on save.
    const scratch = await PDFDocument.create();
    await scratch.embedPdf(bytes);
    await scratch.save();
  } catch {
    return { ok: false, reason: "unembeddable" };
  }
  return { ok: true };
}
