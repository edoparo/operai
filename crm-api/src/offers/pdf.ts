/**
 * Renders an offer PDF from its snapshot (specs/20261101-crm-sales-flow AC-4.1). Server-side with
 * `pdf-lib` and the standard Helvetica (ADR 20260719-refund-batch-pdf-generation-pdf-lib: pure TS, no headless browser).
 * Deterministic for a given snapshot except for the PDF's own metadata dates,
 * which are pinned to the offer's date.
 *
 * Helvetica is WinAnsi-encoded: a character outside it is replaced by "?"
 * (`winAnsi`), recorded as a known limit in plan.md § Risks.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Scope } from "./scope";

export type OfferLanguage = "en" | "it";

/** Everything the document prints; stored as the offer's `snapshot`. */
export interface OfferSnapshot {
  readonly language: OfferLanguage;
  readonly number: number;
  /** Offer reference printed on the document, e.g. "CRM-2026-ACME-3". */
  readonly reference: string;
  readonly issuedOn: string; // YYYY-MM-DD
  readonly validUntil: string; // YYYY-MM-DD
  readonly issuer: {
    readonly legalName: string;
    readonly addressLines: readonly string[];
    readonly vatNumber: string | null;
    readonly iban: string | null;
  };
  readonly client: {
    readonly name: string;
    readonly addressLines: readonly string[];
    readonly contact: string | null;
  };
  readonly title: string;
  readonly scope: Scope;
  readonly priceCents: number;
  readonly currency: "CHF" | "EUR";
  readonly terms: string | null;
  readonly preparedBy: string | null;
}

const TEXT = {
  en: {
    offer: "Offer",
    reference: "Reference",
    date: "Date",
    validUntil: "Valid until",
    to: "To",
    attention: "Attention",
    subject: "Subject",
    scope: "Scope and effort",
    aiNote: "Effort assumes AI-assisted delivery.",
    manDays: "Man-days",
    total: "Total effort",
    price: "Price",
    priceTotal: "Total",
    priceNote: "Fixed price, excluding VAT.",
    validity: (date: string) => `This offer is valid until ${date}.`,
    terms: "Terms",
    acceptance: "Acceptance",
    for: (name: string) => `For ${name}`,
    signature: "Date and signature",
    preparedBy: (name: string) => `Prepared by ${name}`,
    vat: "VAT",
    page: (n: number, of: number) => `Page ${n} of ${of}`,
    unassigned: "Other",
    noEpic: "General",
  },
  it: {
    offer: "Offerta",
    reference: "Riferimento",
    date: "Data",
    validUntil: "Valida fino al",
    to: "Spettabile",
    attention: "Alla c.a.",
    subject: "Oggetto",
    scope: "Ambito e impegno",
    aiNote: "L'impegno considera lo sviluppo assistito da AI.",
    manDays: "Giorni-uomo",
    total: "Impegno totale",
    price: "Prezzo",
    priceTotal: "Totale",
    priceNote: "Prezzo a corpo, IVA esclusa.",
    validity: (date: string) => `La presente offerta è valida fino al ${date}.`,
    terms: "Condizioni",
    acceptance: "Accettazione",
    for: (name: string) => `Per ${name}`,
    signature: "Data e firma",
    preparedBy: (name: string) => `Preparata da ${name}`,
    vat: "P. IVA",
    page: (n: number, of: number) => `Pagina ${n} di ${of}`,
    unassigned: "Altro",
    noEpic: "Generale",
  },
} as const;

/** Labels the scope builder needs, per language. */
export const scopeLabels = (language: OfferLanguage) => ({
  unassignedLabel: TEXT[language].unassigned,
  noEpicLabel: TEXT[language].noEpic,
});

// ─── Formatting ──────────────────────────────────────────────────────────────

/** dd.mm.yyyy, the suite's display format. */
export const displayDate = (isoDate: string): string => {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
};

/** CHF 85'000.50 / EUR 85.000,50 — integer minor units, never a float in between. */
export function formatPrice(cents: number, currency: "CHF" | "EUR"): string {
  const whole = Math.trunc(cents / 100).toString();
  const fraction = String(cents % 100).padStart(2, "0");
  const [group, decimal] = currency === "CHF" ? ["'", "."] : [".", ","];
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)}${decimal}${fraction}`;
}

export const formatManDays = (tenths: number, language: OfferLanguage): string => {
  const text = (tenths / 10).toFixed(1);
  return language === "it" ? text.replace(".", ",") : text;
};

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Replaces what Helvetica (WinAnsi) cannot draw, so rendering never throws. */
export function winAnsi(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (char === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) {
      out += char;
    } else if (char === "\t") {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.1, 0.1, 0.16);
const SOFT = rgb(0.38, 0.38, 0.5);
const RULE = rgb(0.8, 0.8, 0.88);

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN + 30) this.newPage();
  }

  text(value: string, options: { size?: number; bold?: boolean; color?: typeof INK; x?: number } = {}): void {
    const size = options.size ?? 10;
    this.ensure(size + 4);
    this.page.drawText(winAnsi(value), {
      x: options.x ?? MARGIN,
      y: this.y - size,
      size,
      font: options.bold ? this.bold : this.regular,
      color: options.color ?? INK,
    });
    this.y -= size + 4;
  }

  /** Word-wrapped paragraph within the margins. */
  paragraph(value: string, options: { size?: number; color?: typeof INK } = {}): void {
    const size = options.size ?? 10;
    const width = A4[0] - 2 * MARGIN;
    for (const rawLine of winAnsi(value).split("\n")) {
      let line = "";
      for (const word of rawLine.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.regular.widthOfTextAtSize(candidate, size) > width && line) {
          this.text(line, { size, ...(options.color ? { color: options.color } : {}) });
          line = word;
        } else {
          line = candidate;
        }
      }
      this.text(line, { size, ...(options.color ? { color: options.color } : {}) });
    }
  }

  /** A label/value row with the value right-aligned. */
  row(label: string, value: string, options: { bold?: boolean; indent?: number } = {}): void {
    const size = 10;
    this.ensure(size + 6);
    const font = options.bold ? this.bold : this.regular;
    const safeValue = winAnsi(value);
    this.page.drawText(winAnsi(label), { x: MARGIN + (options.indent ?? 0), y: this.y - size, size, font, color: INK });
    this.page.drawText(safeValue, {
      x: A4[0] - MARGIN - font.widthOfTextAtSize(safeValue, size),
      y: this.y - size,
      size,
      font,
      color: INK,
    });
    this.y -= size + 6;
  }

  rule(): void {
    this.ensure(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 4 },
      end: { x: A4[0] - MARGIN, y: this.y - 4 },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 10;
  }

  gap(height = 10): void {
    this.y -= height;
  }
}

export async function renderOfferPdf(snapshot: OfferSnapshot): Promise<Uint8Array> {
  const t = TEXT[snapshot.language];
  const doc = await PDFDocument.create();
  const issued = new Date(`${snapshot.issuedOn}T00:00:00Z`);
  doc.setTitle(winAnsi(`${t.offer} ${snapshot.reference} — ${snapshot.title}`));
  doc.setAuthor(winAnsi(snapshot.issuer.legalName));
  doc.setCreator("Operai CRM");
  doc.setProducer("Operai CRM");
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  // Letterhead
  w.text(snapshot.issuer.legalName, { size: 14, bold: true });
  for (const line of snapshot.issuer.addressLines) w.text(line, { size: 9, color: SOFT });
  if (snapshot.issuer.vatNumber) w.text(`${t.vat} ${snapshot.issuer.vatNumber}`, { size: 9, color: SOFT });
  w.gap(18);

  // Client
  w.text(t.to, { size: 9, color: SOFT });
  w.text(snapshot.client.name, { bold: true });
  for (const line of snapshot.client.addressLines) w.text(line);
  if (snapshot.client.contact) w.text(`${t.attention} ${snapshot.client.contact}`);
  w.gap(14);

  // Offer header
  w.text(`${t.offer} ${snapshot.reference}`, { size: 16, bold: true });
  w.row(t.date, displayDate(snapshot.issuedOn));
  w.row(t.validUntil, displayDate(snapshot.validUntil));
  w.row(t.subject, snapshot.title, { bold: true });
  w.gap(10);

  // Scope
  w.text(t.scope, { size: 12, bold: true });
  if (snapshot.scope.aiAssisted) w.text(t.aiNote, { size: 9, color: SOFT });
  w.row("", t.manDays, { bold: true });
  w.rule();
  for (const release of snapshot.scope.releases) {
    w.row(release.name, formatManDays(release.manDaysTenths, snapshot.language), { bold: true });
    for (const epic of release.epics) {
      w.row(epic.epic, formatManDays(epic.manDaysTenths, snapshot.language), { indent: 14 });
    }
  }
  w.rule();
  w.row(t.total, formatManDays(snapshot.scope.manDaysTenths, snapshot.language), { bold: true });
  w.gap(14);

  // Price
  w.text(t.price, { size: 12, bold: true });
  w.row(t.priceTotal, formatPrice(snapshot.priceCents, snapshot.currency), { bold: true });
  w.text(t.priceNote, { size: 9, color: SOFT });
  w.text(t.validity(displayDate(snapshot.validUntil)), { size: 9, color: SOFT });
  w.gap(10);

  // Terms
  if (snapshot.terms) {
    w.text(t.terms, { size: 12, bold: true });
    w.paragraph(snapshot.terms, { size: 9 });
    w.gap(10);
  }

  // Acceptance
  w.ensure(110);
  w.text(t.acceptance, { size: 12, bold: true });
  w.gap(20);
  const half = (A4[0] - 2 * MARGIN) / 2;
  const signY = w.y;
  for (const [index, name] of [snapshot.issuer.legalName, snapshot.client.name].entries()) {
    const x = MARGIN + index * half;
    w.page.drawText(winAnsi(t.for(name)), { x, y: signY - 10, size: 9, font: w.regular, color: INK });
    w.page.drawLine({ start: { x, y: signY - 50 }, end: { x: x + half - 24, y: signY - 50 }, thickness: 0.5, color: SOFT });
    w.page.drawText(winAnsi(t.signature), { x, y: signY - 62, size: 8, font: w.regular, color: SOFT });
  }
  w.y = signY - 72;
  if (snapshot.preparedBy) w.text(t.preparedBy(snapshot.preparedBy), { size: 8, color: SOFT });

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const footer = winAnsi(
      [snapshot.issuer.legalName, snapshot.issuer.iban ? `IBAN ${snapshot.issuer.iban}` : null, t.page(index + 1, pages.length)]
        .filter(Boolean)
        .join("  ·  "),
    );
    page.drawText(footer, { x: MARGIN, y: MARGIN - 20, size: 8, font: w.regular, color: SOFT });
  });

  return doc.save({ useObjectStreams: false });
}
