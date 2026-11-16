/**
 * The offer document's paper: page size, the frame the text may use, the type sizes and the spacing, in PDF points
 * (specs/20261115-crm-offer-wizard, DD-67, AC-11.10).
 *
 * `contractPdf.ts` draws the PDF from these values; the wizard's paginated preview (crm-ui) scales the same values
 * to CSS pixels, so the preview's page, margins and type cannot drift from the document the offer prints.
 * `crm-ui/src/lib/offerPaper/paper.ts` is a byte-identical copy; `scripts/check-shared-copies.ts` (group
 * `offerPaper`) fails when they differ. Pure constants: no imports, no logic. Change both files in one commit and
 * re-render the T37 samples to prove a PDF changed on purpose.
 */

/** A4 in points. The letterhead is measured on this page. */
export const PAGE = { width: 595.28, height: 841.89 } as const;

/** Where text may go: the distance from each page edge (the letterhead's logo above, its footer below). */
export const FRAME: Readonly<Record<"top" | "bottom" | "left" | "right", number>> = { top: 120, bottom: 110, left: 71, right: 71 };

/** Body text size, and the line height as a multiple of a text's size. */
export const SIZE = 10;
export const LINE = 1.35;
/** Section and annex headings. */
export const HEADING_SIZE = 10.5;
/** The offer's title line. */
export const TITLE_SIZE = 11.5;
/** Table text: the cost table, the effort annex, a table written in the text. */
export const TABLE_SIZE = 9.5;
/** Padding inside a table cell, on every side. */
export const CELL_PAD = 4;

/**
 * Spacing in points. A name ending `Ratio` is a multiple of the size of the text it follows; every other value is a
 * fixed number of points (a preview scales those by its page scale, floored by its text size).
 */
export const SPACING = {
  /** After a paragraph that names no other gap: this × the paragraph's type size. */
  paragraphAfterRatio: 0.6,
  /** Above a sub-heading line (`###`). */
  subHeadingBefore: 3,
  /** Above a numbered section's heading, and under it before its first block. */
  sectionBefore: SIZE * 0.7,
  sectionHeadingAfter: 4,
  /** Under a bullet or numbered list, and under each of its items. */
  listAfter: SIZE * 0.3,
  listItemAfter: SIZE * 0.15,
  /** A list marker sits this far in from the column; the item's text starts after the marker. */
  listIndent: 4,
  /** Under a table written in the text, and under the cost table. */
  tableAfter: SIZE * 0.6,
  costTableAfter: SIZE * 0.8,
  /** The text's indent inside a table cell that holds a bullet. */
  cellBulletIndent: 9,
  /** Under the client lines, and under the contact line. */
  clientAfter: SIZE * LINE,
  contactsAfter: SIZE * 0.6,
  /** Under the place-and-date line, and under the title. */
  dateAfter: SIZE,
  titleAfter: SIZE * 1.4,
  /** The index: under its title, and under its last line. */
  indexTitleAfter: 4,
  indexAfter: SIZE,
  /** Above the acceptance block; under its title and label; above and under each fill-in line; a fill-in line's room. */
  acceptanceBefore: SIZE,
  acceptanceTitleAfter: 2,
  acceptanceLineGap: 14,
  acceptanceLineHeight: 30,
  /** The list of annexes: under its title, and an entry's text indent and marker indent. */
  annexListTitleAfter: 3,
  bulletTextIndent: 18,
  bulletMarkerIndent: 4,
  /** An annex heading: under it when a subtitle follows, and when none does; under the subtitle and the effort annex's note. */
  annexHeadingAfterWithSubtitle: 3,
  annexHeadingAfter: 8,
  annexSubtitleAfter: 8,
} as const;

/**
 * The page number (D-2): printed on every page of the document, "N/M", at the letterhead rule's right end. The
 * letterhead has its own baked-in "1/1"; when one is used, `NUMBER_CORNER` (pt, from the page's bottom-left) is painted
 * in white over it first, in the PDF and in the preview alike.
 */
export const NUMBER_CORNER = { x: 480, y: 26, width: 60, height: 22 } as const;
/** The number's right edge, as a distance from the page's right edge, pt. */
export const NUMBER_RIGHT_INSET = 72;
/** The number's baseline, pt from the page's bottom. */
export const NUMBER_BASELINE = 35.5;
/** The number's type size, regular weight, in the soft ink. */
export const NUMBER_SIZE = 8.5;
