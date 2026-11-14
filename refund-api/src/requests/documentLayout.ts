/**
 * Drawing primitives shared by every refund document — the per-request
 * archive (`exportPdf.ts`) and the compiled monthly batch (`batches/pdf.ts`).
 *
 * The two documents serve opposite purposes and stay separate renderers (see
 * `exportPdf.ts`'s module doc), but they are the same FAMILY: same letterhead,
 * same metadata grid, same labels, rules and footer. Before this module the
 * batch PDF was a stack of bare text lines with raw ISO timestamps and
 * prefixed amounts, while the request PDF had the designed layout — a reader
 * holding both could not tell they came from the same system. Everything here
 * is ARRANGEMENT; colour, type scale and geometry stay in `documentTheme.ts`,
 * wording in `labels.ts`, number and date shape in `documentFormat.ts`.
 */

import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Letterhead } from "./letterhead";
import { COLOR, CONTENT_WIDTH, PAGE, TYPE } from "./documentTheme";

// ─── Embedded Unicode font ───────────────────────────────────────────────────
//
// The bundled Noto Sans in `batches/fonts`: names and motivi are free text,
// and pdf-lib's StandardFonts are WinAnsi-only and THROW on anything else
// (the OWASP A04 fix recorded in batches/pdf.ts). A custom font resolves an
// uncovered codepoint to `.notdef` instead, so rendering stays total.

const FONTS_DIR = import.meta.dir + "/../batches/fonts";

interface LoadedFontBytes {
  readonly regular: ArrayBuffer;
  readonly bold: ArrayBuffer;
}

let fontBytesPromise: Promise<LoadedFontBytes> | undefined;

/** Reads the bundled TTFs once per process — the files never change, so caching cannot affect determinism. */
function loadFontBytes(): Promise<LoadedFontBytes> {
  if (!fontBytesPromise) {
    fontBytesPromise = Promise.all([
      Bun.file(`${FONTS_DIR}/NotoSans-Regular.ttf`).arrayBuffer(),
      Bun.file(`${FONTS_DIR}/NotoSans-Bold.ttf`).arrayBuffer(),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  return fontBytesPromise;
}

/**
 * Font ROLES — callers ask for one, never for a file (documentTheme.ts's
 * asset-gap note: with Ubuntu/Noto Serif present only this mapping changes).
 */
export interface Fonts {
  readonly title: PDFFont;
  readonly label: PDFFont;
  readonly value: PDFFont;
  readonly prose: PDFFont;
}

export interface DocumentMeta {
  readonly title: string;
  readonly author: string;
  /** The ONLY clock the document carries — pdf-lib otherwise stamps wall-clock time (ADR 20260719-refund-batch-pdf-generation-pdf-lib decision 5). */
  readonly generatedAt: Date;
}

/** A new document with its metadata pinned and the role fonts embedded. */
export async function createDocument(meta: DocumentMeta): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setCreationDate(meta.generatedAt);
  doc.setModificationDate(meta.generatedAt);
  doc.setTitle(meta.title);
  doc.setProducer("wellD Operai refund-api");
  doc.setCreator("wellD Operai refund-api");
  doc.setAuthor(meta.author);

  const bytes = await loadFontBytes();
  const regular = await doc.embedFont(bytes.regular, { subset: true });
  const bold = await doc.embedFont(bytes.bold, { subset: true });
  return { doc, fonts: { title: bold, label: bold, value: regular, prose: regular } };
}

// ─── Geometry ────────────────────────────────────────────────────────────────

export const PAGE_WIDTH = PAGE.width;
export const PAGE_HEIGHT = PAGE.height;
export const MARGIN = PAGE.margin;
export const LINE_GAP = 13;
export const SECTION_GAP = 12;
export const INK = COLOR.ink;

export interface Cursor {
  page: PDFPage;
  y: number;
}

export function addPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

/** Advances to a new page if `needed` points would overflow the bottom margin. */
export function ensureSpace(doc: PDFDocument, cursor: Cursor, needed: number): void {
  if (cursor.y - needed < MARGIN) {
    cursor.page = addPage(doc);
    cursor.y = PAGE_HEIGHT - MARGIN;
  }
}

export function drawLine(doc: PDFDocument, cursor: Cursor, text: string, font: PDFFont, size: number): void {
  ensureSpace(doc, cursor, LINE_GAP);
  cursor.page.drawText(text, { x: MARGIN, y: cursor.y, size, font, color: INK });
  cursor.y -= LINE_GAP;
}

// ─── Text ────────────────────────────────────────────────────────────────────

/**
 * Greedy word-wrap measured in the ACTUAL font, not a character count. A word
 * longer than the line is emitted whole and overhangs rather than being cut.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** "Luigi Gambardella (luigi.gambardella@welld.ch)", or the address alone when no name was recorded. */
export function personLabel(name: string | null | undefined, email: string): string {
  return name && name.trim() !== "" ? `${name} (${email})` : email;
}

// ─── Primitives ──────────────────────────────────────────────────────────────

export function hairline(
  page: PDFPage,
  y: number,
  x: number = MARGIN,
  width: number = CONTENT_WIDTH,
  color: RGB = COLOR.hairline,
  thickness = 0.5,
): void {
  page.drawRectangle({ x, y, width, height: thickness, color });
}

/** Draws text whose RIGHT edge sits at `right` — what makes a money column line up. */
export function drawRight(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB = INK,
): void {
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color });
}

/** An uppercase field label. `label.medium`, muted. */
export function drawLabel(page: PDFPage, text: string, x: number, y: number, fonts: Fonts): void {
  page.drawText(text.toUpperCase(), { x, y, size: TYPE.label, font: fonts.label, color: COLOR.muted });
}

// ─── Letterhead ──────────────────────────────────────────────────────────────

/**
 * Wordmark left, issuing entity right, red rule under. Returns the y the
 * content starts at.
 *
 * The kit's `wordmark-red.svg` is not in this repository (documentTheme.ts);
 * "wellD" in brand red is a truthful placeholder until it is.
 */
export function drawLetterhead(page: PDFPage, y: number, fonts: Fonts, mark: Letterhead): number {
  page.drawText("wellD", { x: MARGIN, y: y - 11, size: 20, font: fonts.title, color: COLOR.brand });

  const right = MARGIN + CONTENT_WIDTH;
  let cy = y - 4;
  drawRight(page, mark.name, right, cy, fonts.label, TYPE.letterhead, INK);
  cy -= 11;
  for (const detail of [mark.address, mark.taxId, mark.contact]) {
    drawRight(page, detail, right, cy, fonts.value, TYPE.small, COLOR.muted);
    cy -= 9.5;
  }

  const ruleY = Math.min(cy, y - 24) - 4;
  hairline(page, ruleY, MARGIN, CONTENT_WIDTH, COLOR.brand, 1);
  return ruleY - SECTION_GAP - 4;
}

/**
 * Title left, optional `accessory` (a status chip) right, reference under.
 * Returns the y the next block starts at.
 */
export function drawTitleBlock(
  page: PDFPage,
  y: number,
  fonts: Fonts,
  title: string,
  reference: string,
  accessory?: (right: number, baseline: number) => void,
): number {
  page.drawText(title, { x: MARGIN, y: y - TYPE.title, size: TYPE.title, font: fonts.title, color: INK });
  accessory?.(MARGIN + CONTENT_WIDTH, y - TYPE.title);
  // Clear of the title's descenders — at 8pt the reference otherwise reads as
  // a subtitle glued to the headline rather than a separate fact.
  let cy = y - (TYPE.title + 15);
  page.drawText(reference, { x: MARGIN, y: cy, size: TYPE.small, font: fonts.value, color: COLOR.muted });
  cy -= SECTION_GAP + 10;
  return cy;
}

// ─── Metadata grid ───────────────────────────────────────────────────────────

export type MetadataEntry = readonly [label: string, value: string];

export interface MetadataColumn {
  readonly heading: string;
  readonly entries: readonly MetadataEntry[];
}

/**
 * Two grouped columns of label/value pairs — "what this is" left, "what has
 * happened to it" right — instead of a stack of same-shaped lines nothing can
 * be found in. Returns the y under the taller column.
 */
export function drawMetadataGrid(
  page: PDFPage,
  y: number,
  fonts: Fonts,
  left: MetadataColumn,
  right: MetadataColumn,
): number {
  const colWidth = (CONTENT_WIDTH - 24) / 2;
  const rightX = MARGIN + colWidth + 24;

  drawLabel(page, left.heading, MARGIN, y, fonts);
  drawLabel(page, right.heading, rightX, y, fonts);
  hairline(page, y - 5, MARGIN, colWidth);
  hairline(page, y - 5, rightX, colWidth);

  const drawColumn = (entries: readonly MetadataEntry[], x: number): number => {
    let cy = y - 18;
    for (const [label, value] of entries) {
      drawLabel(page, label, x, cy, fonts);
      cy -= 10;
      for (const wrapped of wrapText(value, fonts.value, TYPE.value, colWidth)) {
        page.drawText(wrapped, { x, y: cy, size: TYPE.value, font: fonts.value, color: INK });
        cy -= 11;
      }
      cy -= 4;
    }
    return cy;
  };

  return Math.min(drawColumn(left.entries, MARGIN), drawColumn(right.entries, rightX));
}

// ─── Footer ──────────────────────────────────────────────────────────────────

/**
 * Stamps every page with the document reference and "Page N of M", as a LAST
 * pass (the total is unknowable earlier). Uses each page's OWN width: a copied
 * receipt page may be any size.
 */
export function drawFooters(doc: PDFDocument, font: PDFFont, reference: string): void {
  const pages = doc.getPages();
  const total = pages.length;

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const pageLabel = `Page ${index + 1} of ${total}`;

    page.drawRectangle({ x: MARGIN, y: 34, width: width - MARGIN * 2, height: 0.5, color: COLOR.hairline });
    page.drawText(reference, { x: MARGIN, y: 22, size: TYPE.small, font, color: COLOR.muted });
    page.drawText(pageLabel, {
      x: width - MARGIN - font.widthOfTextAtSize(pageLabel, TYPE.small),
      y: 22,
      size: TYPE.small,
      font,
      color: COLOR.muted,
    });
  });
}
