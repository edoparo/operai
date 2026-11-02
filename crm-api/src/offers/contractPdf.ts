/**
 * Renders a specs/020 contract offer on the entity's letterhead (US-1).
 *
 * pdf-lib with the standard Helvetica fonts only. The letterhead is embedded
 * once and drawn behind every contract and Annex A page; its baked-in page
 * number is painted over (D-2) and `n/N` is written there. Attachments are
 * appended unchanged, after Annex A, and are not counted in `N`.
 *
 * The document is laid out twice: the first pass finds the page of each
 * section, the second prints them in the index. The index has a fixed number of
 * lines, so both passes break pages identically. The renderer never computes
 * money: it prints what the snapshot says.
 */

import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from "pdf-lib";
import type { ContractSnapshot, OfferCostLine, OfferLanguage, RenderInputs } from "./contract";
import { parseMarkup, type Block, type CellLine, type ListItem, type Run } from "./markup";
import { formatManDays, winAnsi } from "./pdf";

/** An appended PDF that pdf-lib cannot read (encrypted, damaged); the route maps it to a 422. */
export class AttachmentUnreadableError extends Error {
  constructor(readonly fileName: string) {
    super(`Attachment "${fileName}" cannot be read as a PDF`);
    this.name = "AttachmentUnreadableError";
  }
}

// ─── Frame (measured on the supplied letterhead, A4 = 595.28 × 841.89 pt) ────
// Logo ends ~78 pt from the top; a grey rule sits 91 pt from the bottom with the
// footer under it; the baked-in "1/1" spans x 511–523, 32–43 pt from the bottom.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
export const FRAME: Readonly<Record<"top" | "bottom" | "left" | "right", number>> = { top: 120, bottom: 110, left: 71, right: 71 };
const BODY_W = PAGE_W - FRAME.left - FRAME.right;
const LIMIT = PAGE_H - FRAME.bottom; // lowest cursor position (from the top) a line may reach
/** Painted white over the letterhead's own page number (D-2). */
export const NUMBER_CORNER = { x: 480, y: 26, width: 60, height: 22 } as const;
const NUMBER_RIGHT = PAGE_W - 72; // the letterhead rule's right end
const NUMBER_BASELINE = 35.5;
/** Width reserved for the page numbers of the index. */
const NUMBER_COLUMN = 18;

const SIZE = 10;
const LINE = 1.35;
const HEADING_SIZE = 10.5;
const INK = rgb(0.13, 0.13, 0.13);
const SOFT = rgb(0.45, 0.45, 0.45);
const GRID = rgb(0.62, 0.62, 0.62);
const SHADE = rgb(0.9, 0.9, 0.9);
const WHITE = rgb(1, 1, 1);
const CELL_PAD = 4;

// ─── Texts ───────────────────────────────────────────────────────────────────

const TEXT = {
  it: {
    offer: "Offerta",
    title: (reference: string) => `CONTRATTO DI FORNITURA – Rif. ${reference}`,
    attn: "A.c.a.",
    index: "INDICE",
    acceptance: "Per accettazione",
    place: "Luogo e data:",
    signature: "Firma valida del Cliente:",
    annexes: "Allegati:",
    annex: "Allegato",
    annexTitle: "Dettaglio dell’impegno",
    annexHeading: (letter: string) => `ALLEGATO ${letter} – DETTAGLIO DELL’IMPEGNO`,
    aiNote: "L’impegno considera uno sviluppo assistito da AI.",
    manDays: "Giorni-uomo",
    release: "Release",
    epic: "Epic",
    total: "TOTALE",
    annexTotal: "Totale",
    position: "Pos.",
    item: "Voce di costo",
    unit: (currency: string) => `${currency} / unità`,
    quantity: "Qt.",
    amount: (currency: string) => `Totale ${currency}`,
    vat: "P. IVA",
  },
  en: {
    offer: "Offer",
    title: (reference: string) => `SUPPLY CONTRACT – Ref. ${reference}`,
    attn: "Attn.",
    index: "CONTENTS",
    acceptance: "Acceptance",
    place: "Place and date:",
    signature: "Valid signature of the Client:",
    annexes: "Annexes:",
    annex: "Annex",
    annexTitle: "Effort detail",
    annexHeading: (letter: string) => `ANNEX ${letter} – EFFORT DETAIL`,
    aiNote: "Effort assumes AI-assisted delivery.",
    manDays: "Man-days",
    release: "Release",
    epic: "Epic",
    total: "TOTAL",
    annexTotal: "Total",
    position: "Pos.",
    item: "Item",
    unit: (currency: string) => `${currency} / unit`,
    quantity: "Qty",
    amount: (currency: string) => `Total ${currency}`,
    vat: "VAT",
  },
} satisfies Record<OfferLanguage, unknown>;

// ─── Formatting ──────────────────────────────────────────────────────────────

/** `9.2.2026` — no leading zeros on day and month. */
export function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}

/** Whole units without cents, else two decimals; CHF `36’300.50`, EUR `36.300,50`. */
export function formatAmount(cents: number, currency: "CHF" | "EUR"): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100).toString();
  const [group, decimal] = currency === "CHF" ? ["’", "."] : [".", ","];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const fraction = absolute % 100;
  return `${sign}${grouped}${fraction === 0 ? "" : `${decimal}${String(fraction).padStart(2, "0")}`}`;
}

/** Basis points as a percentage, trailing zeros trimmed: 1000 → `10%`, 750 → `7.5%`. */
export const formatPercent = (bp: number): string => `${String(Number((bp / 100).toFixed(2)))}%`;

// ─── Text layout ─────────────────────────────────────────────────────────────

type Style = { readonly bold: boolean; readonly italic: boolean; readonly underline: boolean };

interface Seg {
  readonly text: string;
  readonly style: Style;
  readonly width: number;
}
interface Line {
  readonly segs: Seg[];
  readonly width: number;
}

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly boldItalic: PDFFont;
}

const fontFor = (fonts: Fonts, style: Pick<Style, "bold" | "italic">): PDFFont =>
  style.bold ? (style.italic ? fonts.boldItalic : fonts.bold) : style.italic ? fonts.italic : fonts.regular;

const sameStyle = (a: Style, b: Style): boolean => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;

const run = (text: string, bold = false): Run => ({ text, bold, italic: false, underline: false });

interface Piece {
  text: string;
  style: Style;
}
interface Chunk {
  /** Pieces that must stay on one line (no space between them). */
  pieces: Piece[];
  spaceBefore: boolean;
}

/** Word-wraps runs to `width`, mixing the four Helvetica faces. A "\n" is a hard break. */
function layoutRuns(runs: readonly Run[], width: number, size: number, fonts: Fonts): Line[] {
  const measure = (text: string, style: Style) => fontFor(fonts, style).widthOfTextAtSize(text, size);
  const spaceWidth = fonts.regular.widthOfTextAtSize(" ", size);
  const widths = new Map<string, number>();
  const charWidth = (char: string, style: Style): number => {
    const key = `${style.bold ? "b" : ""}${style.italic ? "i" : ""}${char}`;
    let found = widths.get(key);
    if (found === undefined) {
      found = measure(char, style);
      widths.set(key, found);
    }
    return found;
  };
  // Helvetica's narrowest glyph is about 0.22 em: a longer text certainly overflows, no measuring needed.
  const fitsLine = (pieces: readonly Piece[], limit: number): boolean => {
    let total = 0;
    for (const piece of pieces) {
      if (piece.text.length * 0.2 * size > limit) return false;
      total += measure(piece.text, piece.style);
      if (total > limit) return false;
    }
    return true;
  };

  // Tokenise into chunks: words glued across run boundaries ("**a**,") stay together.
  const paragraphs: Chunk[][] = [[]];
  let glued = false;
  for (const source of runs) {
    const style: Style = { bold: source.bold, italic: source.italic, underline: source.underline };
    source.text
      .split("\n")
      .forEach((part, partIndex) => {
        if (partIndex > 0) {
          paragraphs.push([]);
          glued = false;
        }
        const clean = winAnsi(part);
        const words = clean.split(/ +/);
        words.forEach((word, wordIndex) => {
          const spaced = wordIndex > 0 || (clean.startsWith(" ") && word === "");
          if (word === "") {
            if (spaced) glued = false;
            return;
          }
          if (wordIndex > 0) glued = false;
          const current = paragraphs[paragraphs.length - 1]!;
          const last = current[current.length - 1];
          if (glued && last) {
            last.pieces.push({ text: word, style });
          } else {
            current.push({ pieces: [{ text: word, style }], spaceBefore: current.length > 0 });
          }
          glued = true;
        });
        if (clean.endsWith(" ")) glued = false;
      });
  }

  const lines: Line[] = [];
  for (const chunks of paragraphs) {
    let segs: Seg[] = [];
    let lineWidth = 0;
    const flush = () => {
      lines.push({ segs, width: lineWidth });
      segs = [];
      lineWidth = 0;
    };
    const place = (pieces: readonly Piece[], leadingSpace: boolean) => {
      pieces.forEach((piece, index) => {
        const text = (index === 0 && leadingSpace ? " " : "") + piece.text;
        const previous = segs[segs.length - 1];
        if (previous && sameStyle(previous.style, piece.style)) {
          const merged = previous.text + text;
          segs[segs.length - 1] = { text: merged, style: previous.style, width: measure(merged, previous.style) };
        } else {
          segs.push({ text, style: piece.style, width: measure(text, piece.style) });
        }
        lineWidth = segs.reduce((sum, seg) => sum + seg.width, 0);
      });
    };
    for (const chunk of chunks) {
      let pieces = chunk.pieces;
      // A word wider than the line is cut at the character that overflows. The test is cheap
      // (a length bound first), and the cut is one running-width scan, so a 20 000-character
      // word costs linear time instead of re-measuring growing prefixes.
      while (!fitsLine(pieces, width)) {
        if (segs.length > 0) flush();
        const head = pieces[0]!;
        let cut = 0;
        let used = 0;
        while (cut < head.text.length) {
          const next = charWidth(head.text[cut]!, head.style);
          if (used + next > width) break;
          used += next;
          cut += 1;
        }
        cut = Math.max(cut, 1);
        place([{ text: head.text.slice(0, cut), style: head.style }], false);
        flush();
        pieces = [{ text: head.text.slice(cut), style: head.style }, ...pieces.slice(1)].filter((piece) => piece.text !== "");
        if (pieces.length === 0) break;
      }
      if (pieces.length === 0) continue;
      const chunkWidth = pieces.reduce((sum, piece) => sum + measure(piece.text, piece.style), 0);
      const space = segs.length > 0 && chunk.spaceBefore ? spaceWidth : 0;
      if (segs.length > 0 && lineWidth + space + chunkWidth > width) flush();
      place(pieces, segs.length > 0 && chunk.spaceBefore);
    }
    flush();
  }
  // A trailing break leaves no empty line; an explicit empty paragraph keeps one.
  return lines.length === 1 && lines[0]!.segs.length === 0 ? [] : lines;
}

// ─── Flow ────────────────────────────────────────────────────────────────────

/** Where a block's first line landed: its page and distance from the top. */
interface Placement {
  readonly page: PDFPage;
  readonly top: number;
}

interface PassResult {
  readonly sectionPages: number[];
  readonly annexPage: number;
  readonly pageCount: number;
  readonly letters: { readonly annex: string | null; readonly attachments: string[] };
}

type TextAlign = "left" | "right" | "center";

interface CellSpec {
  readonly lines: readonly { readonly runs: readonly Run[]; readonly bullet: boolean }[];
  readonly align?: TextAlign;
  readonly span?: number;
}
interface RowSpec {
  readonly cells: readonly CellSpec[];
  readonly header?: boolean;
  readonly bold?: boolean;
}

const asBold = (runs: readonly Run[]): Run[] => runs.map((source) => ({ ...source, bold: true }));
const cell = (text: string, align?: TextAlign, span?: number): CellSpec => ({
  lines: text === "" ? [] : [{ runs: [run(text)], bullet: false }],
  ...(align ? { align } : {}),
  ...(span ? { span } : {}),
});

class Flow {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** Distance from the top of the page to the next free line. */
  y = FRAME.top;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly letterhead: PDFEmbeddedPage | null,
    readonly snapshot: ContractSnapshot,
  ) {}

  // — pages —

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = FRAME.top;
    if (this.letterhead) {
      this.page.drawPage(this.letterhead, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    } else {
      this.plainLetterhead();
    }
  }

  /** The fallback without an uploaded letterhead (AC-2.4): issuer name, address and a footer rule. */
  private plainLetterhead(): void {
    const { issuer, language } = this.snapshot;
    const t = TEXT[language];
    this.page.drawText(winAnsi(issuer.legalName), { x: FRAME.left, y: PAGE_H - 52, size: 13, font: this.fonts.bold, color: INK });
    issuer.addressLines.slice(0, 3).forEach((line, index) => {
      this.page.drawText(winAnsi(line), { x: FRAME.left, y: PAGE_H - 66 - index * 10, size: 8.5, font: this.fonts.regular, color: SOFT });
    });
    this.page.drawLine({
      start: { x: FRAME.left, y: 91 },
      end: { x: PAGE_W - FRAME.right, y: 91 },
      thickness: 0.5,
      color: GRID,
    });
    const footer = [issuer.legalName, ...issuer.addressLines, issuer.vatNumber ? `${t.vat} ${issuer.vatNumber}` : null, issuer.iban ? `IBAN ${issuer.iban}` : null]
      .filter(Boolean)
      .join("  ·  ");
    for (const [index, line] of layoutRuns([run(footer)], BODY_W, 8, this.fonts).slice(0, 3).entries()) {
      this.drawLine(this.page, line, FRAME.left, 82 - index * 10, 8, SOFT);
    }
  }

  /** Starts a new page unless `height` still fits above the bottom limit. */
  ensure(height: number): void {
    if (this.pages.length === 0 || this.y + height > LIMIT) this.newPage();
  }

  // — drawing primitives —

  /** Draws one laid-out line with its baseline at `baseline` (pt from the BOTTOM of the page). */
  private drawLine(page: PDFPage, line: Line, x: number, baseline: number, size: number, color = INK): void {
    let cursor = x;
    for (const seg of line.segs) {
      const font = fontFor(this.fonts, seg.style);
      const text = seg.text;
      const lead = text.length - text.trimStart().length;
      page.drawText(text, { x: cursor, y: baseline, size, font, color });
      if (seg.style.underline) {
        const start = cursor + (lead > 0 ? font.widthOfTextAtSize(text.slice(0, lead), size) : 0);
        page.drawLine({
          start: { x: start, y: baseline - 1.5 },
          end: { x: cursor + seg.width, y: baseline - 1.5 },
          thickness: 0.5,
          color,
        });
      }
      cursor += seg.width;
    }
  }

  private baseline(top: number, size: number, lineHeight: number): number {
    return PAGE_H - (top + (lineHeight - size) / 2 + size * 0.85);
  }

  /** Lines of one text block placed at the cursor, breaking across pages line by line. */
  lines(lines: readonly Line[], options: { x?: number; width?: number; size?: number; align?: TextAlign; color?: typeof INK; keep?: number } = {}): Placement | null {
    let first: Placement | null = null;
    const size = options.size ?? SIZE;
    const x = options.x ?? FRAME.left;
    const width = options.width ?? BODY_W;
    const lineHeight = size * LINE;
    lines.forEach((line, index) => {
      // Widow/orphan control: never leave a single line of a longer block behind or ahead of a page break.
      const needed = index === 0 && lines.length > 1 ? lineHeight * 2 : index === lines.length - 2 && lines.length > 2 ? lineHeight * 2 : lineHeight;
      this.ensure(index === 0 ? Math.max(needed, (options.keep ?? 0) + lineHeight) : needed);
      const offset = options.align === "right" ? width - line.width : options.align === "center" ? (width - line.width) / 2 : 0;
      first ??= { page: this.page, top: this.y };
      this.drawLine(this.page, line, x + offset, this.baseline(this.y, size, lineHeight), size, options.color ?? INK);
      this.y += lineHeight;
    });
    return first;
  }

  paragraph(runs: readonly Run[], options: { x?: number; width?: number; size?: number; align?: TextAlign; after?: number; keep?: number } = {}): void {
    const size = options.size ?? SIZE;
    const laid = layoutRuns(runs, options.width ?? BODY_W, size, this.fonts);
    if (laid.length === 0) return;
    this.lines(laid, options);
    this.y += options.after ?? size * 0.6;
  }

  gap(height: number): void {
    this.y += height;
  }

  // — markup blocks —

  blocks(blocks: readonly Block[], section: number, state: { sub: number }, x = FRAME.left, width = BODY_W): void {
    for (const block of blocks) {
      if (block.type === "paragraph") {
        this.paragraph(block.runs, { x, width });
      } else if (block.type === "heading") {
        state.sub += 1;
        this.gap(3);
        this.paragraph([run(winAnsi(`${section}.${state.sub} ${block.text}`.toUpperCase()), true)], { x, width, keep: SIZE * LINE * 2 });
      } else if (block.type === "list") {
        this.list(block.items, section, state, x, width);
        this.y += SIZE * 0.3;
      } else {
        this.markupTable(block, x, width);
      }
    }
  }

  private list(items: readonly ListItem[], section: number, state: { sub: number }, x: number, width: number): void {
    const markerWidth = Math.max(14, ...items.map((item) => this.fonts.regular.widthOfTextAtSize(winAnsi(item.marker), SIZE) + 6));
    const textX = x + 4 + markerWidth;
    for (const item of items) {
      const laid = layoutRuns(item.runs, width - 4 - markerWidth, SIZE, this.fonts);
      this.ensure(SIZE * LINE * Math.min(laid.length, 2));
      const at = this.lines(laid, { x: textX, width: width - 4 - markerWidth });
      // The marker sits on the item's first line, which may have moved to a fresh page.
      const markerLine = layoutRuns([run(item.marker)], markerWidth, SIZE, this.fonts)[0];
      if (at && markerLine) this.drawLine(at.page, markerLine, x + 4, this.baseline(at.top, SIZE, SIZE * LINE), SIZE);
      this.y += SIZE * 0.15;
      if (item.children.length > 0) this.blocks(item.children, section, state, textX, width - 4 - markerWidth);
    }
  }

  // — tables —

  private markupTable(block: Extract<Block, { type: "table" }>, x: number, width: number): void {
    const columns = block.header.length;
    const text = (cellLines: readonly CellLine[]) => cellLines.reduce((sum, line) => sum + line.runs.reduce((n, r) => n + r.text.length, 0), 0);
    const weights = Array.from({ length: columns }, (_, index) =>
      Math.min(60, Math.max(8, ...[block.header, ...block.rows].map((row) => text(row[index] ?? [])))),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map((weight) => Math.max(40, (width * weight) / total));
    const scale = width / widths.reduce((sum, w) => sum + w, 0);
    const rows: RowSpec[] = [
      { cells: block.header.map((lines) => ({ lines: lines.map((l) => ({ ...l, runs: asBold(l.runs) })) })), header: true },
      ...block.rows.map((row) => ({ cells: row.map((lines) => ({ lines })) })),
    ];
    this.table(widths.map((w) => w * scale), rows, x);
    this.gap(SIZE * 0.6);
  }

  /** A ruled table; header shaded and repeated after a page break, rows never split. */
  table(widths: readonly number[], rows: readonly RowSpec[], x = FRAME.left, size = 9.5): void {
    const lineHeight = size * LINE;
    const frameHeight = LIMIT - FRAME.top;

    const measured = rows.map((row) => {
      let column = 0;
      const placed = row.cells.map((spec) => {
        const span = spec.span ?? 1;
        const cellWidth = widths.slice(column, column + span).reduce((sum, w) => sum + w, 0);
        const offset = widths.slice(0, column).reduce((sum, w) => sum + w, 0);
        column += span;
        const inner = cellWidth - 2 * CELL_PAD;
        const laid: { lines: Line[]; bullet: boolean }[] = [];
        for (const source of spec.lines) {
          const runs = row.bold || row.header ? asBold(source.runs) : source.runs;
          const bulletWidth = source.bullet ? 9 : 0;
          for (const [index, line] of layoutRuns(runs, inner - bulletWidth, size, this.fonts).entries()) {
            laid.push({ lines: [line], bullet: source.bullet && index === 0 });
          }
        }
        return { spec, offset, cellWidth, laid, bulletIndent: spec.lines.some((l) => l.bullet) ? 9 : 0 };
      });
      const lineCount = Math.max(1, ...placed.map((p) => p.laid.length));
      let height = lineCount * lineHeight + 2 * CELL_PAD;
      if (height > frameHeight) {
        console.warn("[contractPdf] a table row taller than a page was clipped");
        height = Math.floor((frameHeight - 2 * CELL_PAD) / lineHeight) * lineHeight + 2 * CELL_PAD;
      }
      return { row, placed, height, maxLines: Math.floor((height - 2 * CELL_PAD) / lineHeight) };
    });

    const header = measured[0]?.row.header ? measured[0] : null;
    const drawRow = (item: (typeof measured)[number]) => {
      const top = this.y;
      for (const placed of item.placed) {
        const left = x + placed.offset;
        this.page.drawRectangle({
          x: left,
          y: PAGE_H - top - item.height,
          width: placed.cellWidth,
          height: item.height,
          borderColor: GRID,
          borderWidth: 0.5,
          ...(item.row.header ? { color: SHADE } : {}),
        });
        placed.laid.slice(0, item.maxLines).forEach((entry, index) => {
          const line = entry.lines[0]!;
          const lineTop = top + CELL_PAD + index * lineHeight;
          const inner = placed.cellWidth - 2 * CELL_PAD - placed.bulletIndent;
          const shift = placed.spec.align === "right" ? inner - line.width : placed.spec.align === "center" ? (inner - line.width) / 2 : 0;
          const base = this.baseline(lineTop, size, lineHeight);
          this.drawLine(this.page, line, left + CELL_PAD + placed.bulletIndent + shift, base, size);
          if (entry.bullet) {
            this.page.drawText("•", { x: left + CELL_PAD, y: base, size, font: this.fonts.regular, color: INK });
          }
        });
      }
      this.y += item.height;
    };

    measured.forEach((item, index) => {
      const firstBody = header ? index === 1 : index === 0;
      // Keep the header with its first row, and never split a row.
      const needed = item.height + (index === 0 && header && measured[1] ? measured[1].height : 0) + (firstBody && header ? 0 : 0);
      if (this.pages.length === 0 || this.y + needed > LIMIT) {
        this.newPage();
        if (header && item !== header) drawRow(header);
      }
      drawRow(item);
    });
  }

  // — fixed blocks —

  indexLine(label: string, page: number): void {
    const size = SIZE;
    const lineHeight = size * LINE;
    this.ensure(lineHeight);
    const text = winAnsi(label);
    const number = String(page);
    const numberWidth = this.fonts.regular.widthOfTextAtSize(number, size);
    const labelWidth = this.fonts.regular.widthOfTextAtSize(text, size);
    const dot = this.fonts.regular.widthOfTextAtSize(".", size);
    const available = BODY_W - labelWidth - NUMBER_COLUMN - 8;
    const baseline = PAGE_H - (this.y + (lineHeight - size) / 2 + size * 0.85);
    this.page.drawText(text, { x: FRAME.left, y: baseline, size, font: this.fonts.regular, color: INK });
    if (available > dot * 3) {
      // Leaders end at one x for every line, so the page numbers form a right-aligned column.
      const count = Math.floor(available / dot);
      this.page.drawText(".".repeat(count), {
        x: FRAME.left + BODY_W - NUMBER_COLUMN - 4 - count * dot,
        y: baseline,
        size,
        font: this.fonts.regular,
        color: INK,
      });
    }
    this.page.drawText(number, { x: FRAME.left + BODY_W - numberWidth, y: baseline, size, font: this.fonts.regular, color: INK });
    this.y += lineHeight;
  }

  bulletLine(text: string): void {
    const laid = layoutRuns([run(text)], BODY_W - 18, SIZE, this.fonts);
    this.ensure(SIZE * LINE);
    const top = this.y;
    const page = this.page;
    this.page.drawText("•", { x: FRAME.left + 4, y: PAGE_H - (top + (SIZE * LINE - SIZE) / 2 + SIZE * 0.85), size: SIZE, font: this.fonts.regular, color: INK });
    void page;
    this.lines(laid, { x: FRAME.left + 18, width: BODY_W - 18 });
  }

  acceptance(): void {
    const { language, acceptanceLabel } = this.snapshot;
    const t = TEXT[language];
    const lineHeight = SIZE * LINE;
    // The whole block stays on one page: heading, optional label, two fill-in lines.
    this.ensure(lineHeight * (acceptanceLabel ? 2 : 1) + 8 + 2 * (lineHeight + 30));
    this.paragraph([run(t.acceptance, true)], { after: 2 });
    if (acceptanceLabel) this.paragraph([run(acceptanceLabel, true)], { after: 2 });
    for (const label of [t.place, t.signature]) {
      this.gap(14);
      const width = this.fonts.regular.widthOfTextAtSize(winAnsi(label), SIZE);
      const base = this.baseline(this.y, SIZE, lineHeight);
      this.page.drawText(winAnsi(label), { x: FRAME.left, y: base, size: SIZE, font: this.fonts.regular, color: INK });
      this.page.drawLine({
        start: { x: FRAME.left + width + 6, y: base - 1.5 },
        end: { x: FRAME.left + BODY_W, y: base - 1.5 },
        thickness: 0.5,
        color: GRID,
      });
      this.y += lineHeight + 14;
    }
  }

  annexTable(scope: NonNullable<ContractSnapshot["annex"]>): void {
    const { language } = this.snapshot;
    const t = TEXT[language];
    const days = (tenths: number) => formatManDays(tenths, language);
    const widths = [BODY_W * 0.3, BODY_W * 0.5, BODY_W * 0.2];
    const rows: RowSpec[] = [{ cells: [cell(t.release), cell(t.epic), cell(t.manDays, "right")], header: true }];
    for (const release of scope.releases) {
      rows.push({ bold: true, cells: [cell(release.name), cell(""), cell(days(release.manDaysTenths), "right")] });
      for (const epic of release.epics) {
        rows.push({ cells: [cell(""), cell(epic.epic), cell(days(epic.manDaysTenths), "right")] });
      }
    }
    rows.push({ bold: true, cells: [cell(t.annexTotal, "left", 2), cell(days(scope.manDaysTenths), "right")] });
    this.table(widths, rows);
  }

  // — cost table (AC-1.5) —

  costTable(): void {
    const { costs, language } = this.snapshot;
    const t = TEXT[language];
    const { currency, columns } = costs;
    const unitWidth = columns.unit ? 66 : 0;
    const qtyWidth = columns.unit ? 32 : 0;
    const posWidth = columns.position ? 30 : 0;
    const totalWidth = 82;
    const widths = [
      ...(columns.position ? [posWidth] : []),
      BODY_W - posWidth - unitWidth - qtyWidth - totalWidth,
      ...(columns.unit ? [unitWidth, qtyWidth] : []),
      totalWidth,
    ];
    const head: CellSpec[] = [
      ...(columns.position ? [cell(t.position)] : []),
      cell(t.item),
      ...(columns.unit ? [cell(t.unit(currency), "right"), cell(t.quantity, "right")] : []),
      cell(t.amount(currency), "right"),
    ];
    const rows: RowSpec[] = [{ cells: head, header: true }];
    let position = 0;
    for (const line of costs.lines) {
      // Discount lines carry no position and do not use up a number.
      if (line.kind !== "discount") position += 1;
      rows.push({ cells: this.costRow(line, columns, currency, position) });
    }
    if (costs.showTotal) {
      const spanned = widths.length - 1;
      rows.push({
        bold: true,
        cells: [cell(t.total, "left", spanned), cell(formatAmount(costs.oneOffCents, currency), "right")],
      });
    }
    this.table(widths, rows);
    this.gap(SIZE * 0.8);
  }

  private costRow(line: OfferCostLine, columns: { position: boolean; unit: boolean }, currency: "CHF" | "EUR", position: number): CellSpec[] {
    const discount = line.kind === "discount";
    const percent = discount && line.percentBp !== null;
    const description = percent && !columns.unit ? `${line.description} (${formatPercent(line.percentBp!)})` : line.description;
    const total = `${discount ? "- " : ""}${formatAmount(line.totalCents, currency)}`;
    return [
      ...(columns.position ? [cell(discount ? "" : String(position))] : []),
      cell(description),
      ...(columns.unit
        ? [
            cell(percent ? formatPercent(line.percentBp!) : line.unitCents === null ? "" : `${discount ? "- " : ""}${formatAmount(line.unitCents, currency)}`, "right"),
            cell(percent ? "" : String(line.quantity), "right"),
          ]
        : []),
      cell(total, "right"),
    ];
  }
}

// ─── The document ────────────────────────────────────────────────────────────

const letterOf = (index: number): string => String.fromCharCode(65 + index);

const annexLetters = (snapshot: ContractSnapshot) => {
  const annex = snapshot.annex ? letterOf(0) : null;
  const offset = annex ? 1 : 0;
  return { annex, attachments: snapshot.attachments.map((_, index) => letterOf(offset + index)) };
};

/** Lays out the contract and Annex A on `doc`; `sectionPages` (1-based) feed the index of the second pass. */
async function layout(doc: PDFDocument, snapshot: ContractSnapshot, letterhead: Uint8Array | null, known: PassResult | null): Promise<{ flow: Flow; result: PassResult }> {
  const t = TEXT[snapshot.language];
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const embedded = letterhead ? (await doc.embedPdf(letterhead))[0]! : null;
  const flow = new Flow(doc, fonts, embedded, snapshot);
  const letters = annexLetters(snapshot);
  const sectionPages: number[] = [];

  flow.newPage();

  // — page 1: salutation, client, contacts, place and date, title —
  flow.paragraph([run(snapshot.salutation)], { after: 0 });
  snapshot.clientLines.forEach((line, index) => flow.paragraph([run(line, index === 0)], { after: 0 }));
  flow.gap(SIZE * LINE);
  if (snapshot.contacts.length > 0) {
    flow.paragraph([run(`${t.attn} ${snapshot.contacts.join(", ")}`, true)], { after: 0 });
    flow.gap(SIZE * 0.6);
  }
  const date = shortDate(snapshot.issuedOn);
  flow.paragraph([run(snapshot.place ? `${snapshot.place}, ${date}` : date)], { align: "right", after: SIZE });
  flow.paragraph([run(t.title(snapshot.reference), true)], { size: 11.5, align: "center", after: SIZE * 1.4 });

  // — index, only with Annex A (D-8) —
  const annexHeading = letters.annex ? t.annexHeading(letters.annex) : null;
  if (annexHeading) {
    flow.paragraph([run(t.index, true)], { after: 4 });
    const entries = [
      ...snapshot.sections.map((section, index) => ({ label: `${index + 1}. ${section.heading.toUpperCase()}`, page: known?.sectionPages[index] ?? 0 })),
      { label: annexHeading, page: known?.annexPage ?? 0 },
    ];
    for (const entry of entries) flow.indexLine(entry.label, entry.page);
    flow.gap(SIZE);
  }

  flow.blocks(parseMarkup(snapshot.opening), 0, { sub: 0 });

  // — sections —
  for (const [index, section] of snapshot.sections.entries()) {
    const number = index + 1;
    flow.gap(SIZE * 0.7);
    // A heading never sits alone at the bottom of a page: it needs its first lines (or the table header and row).
    flow.ensure(HEADING_SIZE * LINE + SIZE * LINE * (section.costs ? 4 : 3));
    sectionPages[index] = flow.pages.length;
    flow.paragraph([run(`${number}. ${section.heading.toUpperCase()}`, true)], { size: HEADING_SIZE, after: 4 });
    if (section.costs) flow.costTable();
    flow.blocks(parseMarkup(section.body), number, { sub: 0 });
  }

  // — acceptance —
  flow.gap(SIZE);
  flow.acceptance();

  // — annexes list —
  if (letters.annex || snapshot.attachments.length > 0) {
    flow.ensure(SIZE * LINE * 3 + 8);
    flow.paragraph([run(t.annexes, true)], { after: 3, keep: SIZE * LINE });
    const entries = [
      ...(letters.annex ? [`${t.annex} ${letters.annex} - ${t.annexTitle}`] : []),
      ...snapshot.attachments.map((attachment, i) => `${t.annex} ${letters.attachments[i]} - ${attachment.fileName}`),
    ];
    for (const entry of entries) flow.bulletLine(entry);
  }

  // — Annex A —
  let annexPage = 0;
  if (snapshot.annex && letters.annex) {
    flow.newPage();
    annexPage = flow.pages.length;
    flow.paragraph([run(annexHeading!, true)], { size: HEADING_SIZE, after: 8 });
    if (snapshot.annex.aiAssisted) flow.paragraph([{ text: t.aiNote, bold: false, italic: true, underline: false }], { after: 8 });
    flow.annexTable(snapshot.annex);
  }

  return { flow, result: { sectionPages, annexPage, pageCount: flow.pages.length, letters } };
}

export async function renderContractPdf(snapshot: ContractSnapshot, inputs: RenderInputs): Promise<Uint8Array> {
  // Unreadable attachments fail first, before any layout work.
  const appended: PDFDocument[] = [];
  for (const [index, bytes] of inputs.attachments.entries()) {
    const fileName = snapshot.attachments[index]?.fileName ?? `attachment ${index + 1}`;
    try {
      appended.push(await PDFDocument.load(bytes));
    } catch {
      throw new AttachmentUnreadableError(fileName);
    }
  }

  const first = await layout(await PDFDocument.create(), snapshot, inputs.letterhead, null);
  const doc = await PDFDocument.create();
  const { flow, result } = await layout(doc, snapshot, inputs.letterhead, first.result);

  // Page numbers count the contract and Annex A pages only; the corner is painted over first (D-2).
  flow.pages.forEach((page, index) => {
    if (inputs.letterhead) {
      page.drawRectangle({ ...NUMBER_CORNER, color: WHITE, borderWidth: 0 });
    }
    const label = `${index + 1}/${result.pageCount}`;
    const width = flow.fonts.regular.widthOfTextAtSize(label, 8.5);
    page.drawText(label, { x: NUMBER_RIGHT - width, y: NUMBER_BASELINE, size: 8.5, font: flow.fonts.regular, color: SOFT });
  });

  for (const source of appended) {
    const copied = await doc.copyPages(source, source.getPageIndices());
    for (const page of copied) doc.addPage(page);
  }

  const issued = new Date(`${snapshot.issuedOn}T00:00:00Z`);
  doc.setTitle(winAnsi(`${TEXT[snapshot.language].offer} ${snapshot.reference}`));
  doc.setAuthor(winAnsi(snapshot.issuer.legalName));
  doc.setCreator("Operai CRM");
  doc.setProducer("Operai CRM");
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);
  return doc.save({ useObjectStreams: false });
}
