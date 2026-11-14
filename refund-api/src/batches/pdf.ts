/**
 * Compiled-batch PDF renderer (T2, specs/20260719-refund-monthly-processing,
 * ADR 20260719-refund-batch-pdf-generation-pdf-lib; Unicode-font hardening — OWASP A04, specs/20260719-refund-monthly-processing QE/security
 * finding).
 *
 * A pure, deterministic function: `RefundBatchItem`-derived data in, a PDF
 * `Buffer` out. Built with `pdf-lib` (pure TypeScript, zero native modules,
 * no headless browser — ADR 20260719-refund-batch-pdf-generation-pdf-lib decision 1) directly from primitives (text
 * runs, rules, an embedded Unicode font) — no HTML/CSS layout engine.
 *
 * ONE FAMILY WITH THE REQUEST ARCHIVE (2026-11-14). This document used to be
 * a stack of bare text lines — raw ISO timestamps, prefixed amounts
 * (`CHF 1414,00`), no letterhead, no table — while the per-request archive
 * (`requests/exportPdf.ts`) had the designed layout. Both now draw through
 * `requests/documentLayout.ts` (letterhead, title block, metadata grid,
 * labels, rules, footer), `documentTheme.ts` (colour, type) and
 * `documentFormat.ts` (`1414,00 CHF`, `14.11.2026 09:20 (CET)`), so a reader
 * holding both can tell they come from the same system. The two renderers
 * still stay separate: a batch is a cross-employee SUMMARY and never embeds
 * receipts (AC-1.7); the archive is one request, self-contained.
 *
 * FONT CHOICE (OWASP A04 fix — chosen over character sanitization): the
 * standard 14 PDF fonts (Helvetica et al.) only support WinAnsi/CP1252 and
 * `pdf-lib` THROWS when asked to draw a character outside that charset.
 * `employee.owner.name` is an unprivileged, employee-controlled OAuth
 * display name with no charset validation — any emoji/CJK/Cyrillic/Arabic
 * name reaching this renderer previously crashed it, which (via
 * `pdfLink.ts`'s lazy-regenerate-on-miss) turned into a permanently
 * unreadable batch. The documents therefore embed Noto Sans (Regular + Bold,
 * `fonts/NotoSans-*.ttf`, SIL Open Font License 1.1 — see
 * `fonts/LICENSE_OFL.txt`) via `@pdf-lib/fontkit`, loaded by
 * `documentLayout.ts`: a fontkit-embedded font resolves any codepoint it does
 * not cover to its own `.notdef` glyph instead of throwing, so the renderer is
 * a total function of its Unicode input. Full CJK/emoji glyph coverage stays
 * out of scope (several MB per script); those names degrade to blank glyphs.
 *
 * DETERMINISM (ADR 20260719-refund-batch-pdf-generation-pdf-lib decision 5, ADR regenerable-cache posture): the only
 * "now" this module ever renders is the caller-supplied `generatedAt` — the
 * batch's stored `createdAt` — NEVER `Date.now()`; `createDocument` pins the
 * PDF's creation/modification dates to it. Employees, requests and
 * currencies are sorted into a stable, input-order-independent sequence so a
 * regenerated PDF (cache miss on `pdf-url`, or a resend) is byte-identical to
 * the one originally compiled and possibly already emailed. For the same
 * reason the document carries NO batch status: the status moves on
 * (compiled → paid/discarded) while a regenerated PDF must not, so the page
 * states what was compiled, and the app states what became of it.
 *
 * CONTENT (AC-1.6/1.7/1.9): a header (cutoff, generation timestamp,
 * generating accounting user, batch reference); a payout summary, one table
 * per currency with one row per employee; then one section per requesting
 * employee listing each included request with its approved amount, subtotaled
 * per currency — reusing `computeSubtotals` from `requests.service.ts` (007's
 * "never blended, never grouped by entity" rule, carried forward verbatim).
 * No total ever adds two currencies. $0-approved lines are included on the
 * same terms as any other (AC-1.9). This module never reads or references
 * `Attachment` rows — receipt files are never embedded (AC-1.7).
 */

import type { PDFDocument, PDFPage } from "pdf-lib";
import { computeSubtotals, type LineRow } from "../requests/requests.service";
import type { Subtotal } from "../requests/requests.schemas";
import { COLOR, CONTENT_WIDTH, TYPE } from "../requests/documentTheme";
import { formatMoney, formatPeriod, formatTimestamp } from "../requests/documentFormat";
import { entityLabel } from "../requests/labels";
import { letterheadFor } from "../requests/letterhead";
import {
  INK,
  MARGIN,
  PAGE_HEIGHT,
  SECTION_GAP,
  addPage,
  createDocument,
  drawFooters,
  drawLabel,
  drawLetterhead,
  drawLine,
  drawMetadataGrid,
  drawRight,
  drawTitleBlock,
  ensureSpace,
  hairline,
  personLabel,
  wrapText,
  type Cursor,
  type Fonts,
} from "../requests/documentLayout";

// ─── Object key (shared by the compile-time PutObject and the read-time mint) ──

/**
 * `refund/batches/{batchId}/compiled.pdf` — batch-scoped, non-guessable id,
 * no employee/PII in the key. Deliberately a SIBLING of, not nested under,
 * the `refund/{requestId}/…` receipt namespace, so a bucket lifecycle rule
 * scoped to unconfirmed receipt uploads (007 R4) can never catch a batch PDF
 * (ADR 20260719-refund-batch-pdf-generation-pdf-lib decision 3, plan.md Risk R8).
 */
export function batchPdfObjectKey(batchId: string): string {
  return `refund/batches/${batchId}/compiled.pdf`;
}

// ─── Input shape ─────────────────────────────────────────────────────────────

export interface BatchPdfOwner {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
}

export interface BatchPdfRequest {
  readonly id: string;
  /** When the request was approved — the fact the cutoff was tested against. Optional only for older callers/fixtures. */
  readonly decidedAt?: Date | null;
  readonly lines: readonly LineRow[];
}

export interface BatchPdfEmployee {
  readonly owner: BatchPdfOwner;
  readonly requests: readonly BatchPdfRequest[];
}

export interface BatchPdfInput {
  /** The batch's own id — also serves as its human-facing "batch reference" (AC-1.6; mirrors plan.md's `batchReference: "<id>"`). */
  readonly batchId: string;
  /** The cutoff the compile was run against (AC-1.1). */
  readonly cutoff: Date;
  /** The batch's stored `createdAt` — the ONLY "now" this renderer ever draws (see module doc). */
  readonly generatedAt: Date;
  /** The generating accounting user's identity (AC-1.6). */
  readonly generatedByEmail: string;
  readonly employees: readonly BatchPdfEmployee[];
}

// ─── Deterministic ordering helpers ─────────────────────────────────────────
//
// The renderer must not depend on the order the caller happened to hand it
// employees/requests in — a regenerated PDF (cache miss, resend) must be
// byte-identical to the original render regardless of any incidental query
// ordering difference (ADR 20260719-refund-batch-pdf-generation-pdf-lib decision 5).

function sortedEmployees(employees: readonly BatchPdfEmployee[]): readonly BatchPdfEmployee[] {
  return [...employees].sort((a, b) => {
    const byEmail = a.owner.email.localeCompare(b.owner.email);
    if (byEmail !== 0) return byEmail;
    return a.owner.userId.localeCompare(b.owner.userId);
  });
}

function sortedRequests(requests: readonly BatchPdfRequest[]): readonly BatchPdfRequest[] {
  return [...requests].sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Small derivations ───────────────────────────────────────────────────────

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** `14.11.2026` — the civil date in the document zone, from the same formatter as every timestamp. */
const formatDay = (date: Date): string => formatTimestamp(date).split(" ")[0]!;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const approvedOf = (subtotal: Subtotal): number => subtotal.approvedCents ?? 0;

// ─── Tables ──────────────────────────────────────────────────────────────────
//
// Fixed column grids summing to the content width, for the same reason as the
// request archive's: a header repeats on every page and a total sits under the
// last row, so the grid must be identical everywhere or the totals stop lining
// up with the figures they sum.

interface Column {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly align: "left" | "right";
}

interface Table {
  readonly columns: readonly Column[];
  readonly x: Readonly<Record<string, number>>;
}

function table(columns: readonly Column[]): Table {
  let x = MARGIN;
  const out: Record<string, number> = {};
  for (const column of columns) {
    out[column.key] = x;
    x += column.width;
  }
  return { columns, x: out };
}

const SUMMARY = table([
  { key: "index", label: "#", width: 18, align: "left" },
  { key: "employee", label: "Employee", width: CONTENT_WIDTH - 18 - 56 - 2 * 86, align: "left" },
  { key: "requests", label: "Requests", width: 56, align: "right" },
  { key: "requested", label: "Requested", width: 86, align: "right" },
  { key: "approved", label: "Approved", width: 86, align: "right" },
]);

const DETAIL = table([
  { key: "index", label: "#", width: 18, align: "left" },
  { key: "request", label: "Request", width: 150, align: "left" },
  { key: "period", label: "Period", width: CONTENT_WIDTH - 18 - 150 - 62 - 2 * 76, align: "left" },
  { key: "decided", label: "Approved on", width: 62, align: "left" },
  { key: "requested", label: "Requested", width: 76, align: "right" },
  { key: "approved", label: "Approved", width: 76, align: "right" },
]);

const colRight = (t: Table, key: string): number =>
  t.x[key]! + t.columns.find((c) => c.key === key)!.width;

function drawTableHeader(page: PDFPage, y: number, fonts: Fonts, t: Table): number {
  for (const column of t.columns) {
    if (column.align === "right") {
      drawRight(page, column.label.toUpperCase(), colRight(t, column.key), y, fonts.label, TYPE.label, COLOR.muted);
    } else {
      drawLabel(page, column.label, t.x[column.key]!, y, fonts);
    }
  }
  hairline(page, y - 5, MARGIN, CONTENT_WIDTH, COLOR.ink, 0.8);
  return y - 16;
}

interface Cell {
  readonly key: string;
  /** One or more wrapped lines; the row grows to the tallest cell. */
  readonly lines: readonly string[];
  readonly muted?: boolean;
}

/**
 * Draws one row, starting a new page (and repeating the header) rather than
 * orphaning it under the bottom margin.
 */
function drawRow(doc: PDFDocument, cursor: Cursor, fonts: Fonts, t: Table, cells: readonly Cell[]): void {
  const height = Math.max(14, ...cells.map((c) => c.lines.length * 11)) + 7;
  if (cursor.y - height < MARGIN + 40) {
    cursor.page = addPage(doc);
    cursor.y = drawTableHeader(cursor.page, PAGE_HEIGHT - MARGIN, fonts, t);
  }

  const top = cursor.y;
  for (const cell of cells) {
    const column = t.columns.find((c) => c.key === cell.key)!;
    const color = cell.muted ? COLOR.muted : INK;
    cell.lines.forEach((text, i) => {
      const y = top - i * 11;
      if (column.align === "right") {
        drawRight(cursor.page, text, colRight(t, cell.key), y, fonts.value, TYPE.value, color);
      } else {
        cursor.page.drawText(text, { x: t.x[cell.key]!, y, size: TYPE.value, font: fonts.value, color });
      }
    });
  }

  cursor.y = top - height + 7;
  hairline(cursor.page, cursor.y + 3);
  cursor.y -= 8;
}

/** A brand-ruled bold total row: the most prominent figures on the page, not the least. */
function drawTotalRow(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  t: Table,
  labelKey: string,
  label: string,
  requested: string,
  approved: string,
): void {
  ensureSpace(doc, cursor, 34);
  hairline(cursor.page, cursor.y + 8, MARGIN, CONTENT_WIDTH, COLOR.brand, 1);
  cursor.y -= 4;
  cursor.page.drawText(label, { x: t.x[labelKey]!, y: cursor.y, size: TYPE.value, font: fonts.title, color: INK });
  drawRight(cursor.page, requested, colRight(t, "requested"), cursor.y, fonts.title, TYPE.value);
  drawRight(cursor.page, approved, colRight(t, "approved"), cursor.y, fonts.title, TYPE.value);
  cursor.y -= SECTION_GAP + 10;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Renders a compiled batch's PDF as a `Buffer`. Pure and deterministic:
 * the same `BatchPdfInput` always produces byte-identical output (see module
 * doc). Never throws on an empty employee list — that state should never
 * reach this function in practice (compile refuses an empty candidate set,
 * AC-1.4), but the renderer stays total rather than partial.
 */
export async function renderBatchPdf(input: BatchPdfInput): Promise<Buffer> {
  const { doc, fonts } = await createDocument({
    title: `Refund batch ${input.batchId}`,
    author: input.generatedByEmail,
    generatedAt: input.generatedAt,
  });

  const employees = sortedEmployees(input.employees).map((employee) => {
    const requests = sortedRequests(employee.requests).map((request) => ({
      request,
      subtotals: computeSubtotals(request.lines),
    }));
    const lines = requests.flatMap(({ request }) => [...request.lines]);
    return { owner: employee.owner, requests, lines, subtotals: computeSubtotals(lines) };
  });
  const allLines = employees.flatMap((e) => e.lines);
  const requestCount = employees.reduce((n, e) => n + e.requests.length, 0);

  const page0 = addPage(doc);

  // ── 1. Letterhead + title ────────────────────────────────────────────────
  let y = drawLetterhead(page0, PAGE_HEIGHT - MARGIN, fonts, letterheadFor(allLines.map((l) => l.entity)));
  y = drawTitleBlock(page0, y, fonts, "Monthly refund batch", input.batchId);

  // ── 2. Metadata (AC-1.6: cutoff, generated, generated-by, reference) ─────
  y = drawMetadataGrid(
    page0,
    y,
    fonts,
    {
      heading: "Batch",
      entries: [
        ["Cutoff", formatTimestamp(input.cutoff)],
        ["Contents", `${plural(requestCount, "request", "requests")} · ${plural(employees.length, "employee", "employees")}`],
        ["Expense period", formatPeriod(allLines.map((l) => isoDay(l.date))) ?? "—"],
        // Every entity named, not the archive's "Multiple — see each line": this
        // document prints no lines to see.
        ["Entity", [...new Set(allLines.map((l) => entityLabel(l.entity)))].sort().join(", ") || "—"],
      ],
    },
    {
      heading: "Processing",
      entries: [
        ["Compiled", `${formatTimestamp(input.generatedAt)} ${personLabel(null, input.generatedByEmail)}`],
        ["Batch reference", input.batchId],
      ],
    },
  );
  y -= SECTION_GAP;

  const cursor: Cursor = { page: page0, y };

  if (employees.length === 0) {
    drawLine(doc, cursor, "No requests included in this batch.", fonts.value, TYPE.value);
  }

  // ── 3. Payout summary: one table per currency, one row per employee ──────
  // What payroll actually keys in. Never a grand total across currencies:
  // summing CHF and EUR would invent a number that does not exist.
  const currencies = [...new Set(allLines.map((l) => l.currency))].sort();
  for (const currency of currencies) {
    ensureSpace(doc, cursor, 70);
    drawLabel(cursor.page, `Payouts in ${currency}`, MARGIN, cursor.y, fonts);
    cursor.y -= 14;
    cursor.y = drawTableHeader(cursor.page, cursor.y, fonts, SUMMARY);

    let requestedTotal = 0;
    let approvedTotal = 0;
    let row = 0;
    for (const employee of employees) {
      const subtotal = employee.subtotals.find((s) => s.currency === currency);
      if (!subtotal) continue;
      row += 1;
      const requestsInCurrency = employee.requests.filter((r) => r.subtotals.some((s) => s.currency === currency));
      drawRow(doc, cursor, fonts, SUMMARY, [
        { key: "index", lines: [String(row)], muted: true },
        {
          key: "employee",
          lines: wrapText(personLabel(employee.owner.name, employee.owner.email), fonts.value, TYPE.value, SUMMARY.columns[1]!.width - 8),
        },
        { key: "requests", lines: [String(requestsInCurrency.length)] },
        { key: "requested", lines: [formatMoney(subtotal.requestedCents, currency)] },
        { key: "approved", lines: [formatMoney(approvedOf(subtotal), currency)] },
      ]);
      requestedTotal += subtotal.requestedCents;
      approvedTotal += approvedOf(subtotal);
    }
    drawTotalRow(
      doc, cursor, fonts, SUMMARY, "employee", `Total — ${currency}`,
      formatMoney(requestedTotal, currency), formatMoney(approvedTotal, currency),
    );
  }

  // ── 4. One section per employee: the requests behind each payout ─────────
  if (employees.length > 0) {
    ensureSpace(doc, cursor, 40);
    drawLabel(cursor.page, "Requests by employee", MARGIN, cursor.y, fonts);
    cursor.y -= 6;
    hairline(cursor.page, cursor.y, MARGIN, CONTENT_WIDTH, COLOR.brand, 1);
    cursor.y -= SECTION_GAP + 6;
  }

  for (const employee of employees) {
    ensureSpace(doc, cursor, 80);
    for (const text of wrapText(personLabel(employee.owner.name, employee.owner.email), fonts.title, TYPE.value + 1, CONTENT_WIDTH)) {
      cursor.page.drawText(text, { x: MARGIN, y: cursor.y, size: TYPE.value + 1, font: fonts.title, color: INK });
      cursor.y -= 13;
    }
    cursor.y -= 4;
    cursor.y = drawTableHeader(cursor.page, cursor.y, fonts, DETAIL);

    let row = 0;
    for (const { request, subtotals } of employee.requests) {
      row += 1;
      const period = formatPeriod(request.lines.map((l) => isoDay(l.date))) ?? "—";
      const decided = request.decidedAt ? formatDay(request.decidedAt) : "—";
      // A request in two currencies is two figures, stacked in its one row.
      const cells: Cell[] = [
        { key: "index", lines: [String(row)], muted: true },
        { key: "request", lines: [request.id] },
        { key: "period", lines: wrapText(period, fonts.value, TYPE.value, DETAIL.columns[2]!.width - 8) },
        { key: "decided", lines: [decided] },
        {
          key: "requested",
          lines: subtotals.length ? subtotals.map((s) => formatMoney(s.requestedCents, s.currency)) : ["—"],
        },
        {
          key: "approved",
          lines: subtotals.length ? subtotals.map((s) => formatMoney(approvedOf(s), s.currency)) : ["—"],
        },
      ];
      drawRow(doc, cursor, fonts, DETAIL, cells);
    }

    if (employee.subtotals.length === 0) {
      drawLine(doc, cursor, "No expense lines.", fonts.value, TYPE.value);
    }
    for (const subtotal of employee.subtotals) {
      drawTotalRow(
        doc, cursor, fonts, DETAIL, "request", `Subtotal — ${subtotal.currency}`,
        formatMoney(subtotal.requestedCents, subtotal.currency),
        formatMoney(approvedOf(subtotal), subtotal.currency),
      );
    }
    cursor.y -= 4;
  }

  // ── 5. Footer ────────────────────────────────────────────────────────────
  drawFooters(doc, fonts.value, input.batchId);

  return Buffer.from(await doc.save());
}
