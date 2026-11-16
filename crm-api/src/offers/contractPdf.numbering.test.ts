/**
 * The renderer reads the document's numbering, annex letters, cost positions and words from the shared engine
 * (specs/20261115-crm-offer-wizard T25; AC-3.2, AC-9.4, DD-29, DD-46, DD-47), and a test-only draw log lists every
 * string it draws. A legacy (018) snapshot must draw exactly what it drew before the refactor.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, type PDFPage } from "pdf-lib";
import type { ContractSnapshot } from "./contract";
import { renderContractPdf, type DrawnText } from "./contractPdf";

const pdfWith = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) doc.addPage([595.28, 841.89]).drawText("x", { x: 50, y: 700, size: 12, font });
  return doc.save();
};

const WIN_ANSI: Record<number, string> = { 0x92: "’", 0x95: "•", 0x96: "–", 0x91: "‘", 0x93: "“", 0x94: "”" };
const tjStrings = (page: PDFPage): string[] => {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
  const stream = streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "")).join("\n");
  return [...stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((match) =>
    (match[1]!.match(/../g) ?? []).map((hex) => WIN_ANSI[parseInt(hex, 16)] ?? String.fromCharCode(parseInt(hex, 16))).join(""),
  );
};

/** A legacy snapshot: no `wizard`, no `textAnnexes`, no `costs.rows`, no `handEdited`. */
const legacy = (over: Partial<ContractSnapshot> = {}): ContractSnapshot => ({
  kind: "contract",
  template: { id: "t", name: "T" },
  language: "it",
  reference: "0017/2026",
  issuedOn: "2026-02-09",
  validUntil: "2026-03-11",
  validityDays: 30,
  place: "Lugano",
  issuer: { legalName: "WellD Sagl", addressLines: ["Via Pessina 9"], vatNumber: null, iban: null },
  salutation: "Spettabile",
  clientLines: ["Esempio SA", "Via Roma 1"],
  contacts: ["Mario Rossi"],
  opening: "Con riferimento.",
  sections: [
    { heading: "Definizioni", body: "Testo.\n\n### Uno\n\nA.\n\n- voce\n\n### Due\n\nB.", costs: false },
    { heading: "Costi", body: "- IVA esclusa.", costs: true },
    { heading: "Condizioni", body: "### Foro\n\nLugano.", costs: false },
  ],
  costs: {
    currency: "CHF",
    columns: { position: true, unit: false },
    showTotal: true,
    lines: [
      { description: "Sviluppo", kind: "one_off", unitCents: 700_000, percentBp: null, quantity: 1, totalCents: 700_000 },
      { description: "Sconto", kind: "discount", unitCents: 5_000, percentBp: null, quantity: 1, totalCents: 5_000 },
      { description: "Canone", kind: "yearly", unitCents: 120_000, percentBp: null, quantity: 1, totalCents: 120_000 },
    ],
    oneOffCents: 695_000,
    yearlyCents: 120_000,
  },
  acceptanceLabel: null,
  annex: { aiAssisted: false, manDaysTenths: 100, releases: [{ name: "MVP", manDaysTenths: 100, epics: [{ epic: "Auth", manDaysTenths: 100 }] }] },
  attachments: [
    { id: "a", fileName: "uno.pdf", sizeBytes: 1 },
    { id: "b", fileName: "due.pdf", sizeBytes: 1 },
  ],
  aiAssisted: false,
  preparedBy: null,
  ...over,
});

const draw = async (snapshot: ContractSnapshot, attachments = snapshot.attachments.length) => {
  const drawLog: DrawnText[] = [];
  const bytes = await renderContractPdf(
    snapshot,
    { letterhead: null, attachments: await Promise.all(Array.from({ length: attachments }, () => pdfWith(1))) },
    { drawLog },
  );
  const doc = await PDFDocument.load(bytes);
  const pages = (page: number) => drawLog.filter((entry) => entry.page === page).map((entry) => entry.text);
  return { drawLog, doc, pages, bytes };
};

describe("the draw log of a legacy snapshot (AC-9.4)", () => {
  it("lists, page by page, the strings the renderer drew before it read the engine", async () => {
    const { pages } = await draw(legacy());
    // Captured from the renderer BEFORE the refactor (its text, extracted from the PDF).
    expect(pages(1)).toEqual([
      "WellD Sagl", "Via Pessina 9", "WellD Sagl · Via Pessina 9",
      "Spettabile", "Esempio SA", "Via Roma 1", "A.c.a. Mario Rossi", "Lugano, 9.2.2026",
      "CONTRATTO DI FORNITURA – Rif. 0017/2026",
      "INDICE",
      "1. DEFINIZIONI", ".".repeat(128), "1",
      "2. COSTI", ".".repeat(138), "1",
      "3. CONDIZIONI", ".".repeat(128), "1",
      "ALLEGATO A – DETTAGLIO DELL’IMPEGNO", ".".repeat(80), "3",
      "Con riferimento.",
      "1. DEFINIZIONI", "Testo.", "1.1 UNO", "A.", "voce", "•", "1.2 DUE", "B.",
      "2. COSTI", "Pos.", "Voce di costo", "Totale CHF", "1", "Sviluppo", "7’000", "Sconto", "- 50", "2", "Canone", "1’200", "TOTALE", "6’950",
      "IVA esclusa.", "•",
      "3. CONDIZIONI", "3.1 FORO", "Lugano.",
      "1/3",
    ].map((text) => text));
    expect(pages(2)).toEqual([
      "WellD Sagl", "Via Pessina 9", "WellD Sagl · Via Pessina 9",
      "Per accettazione", "Luogo e data:", "Firma valida del Cliente:",
      "Allegati:", "•", "Allegato A - Dettaglio dell’impegno", "•", "Allegato B - uno.pdf", "•", "Allegato C - due.pdf",
      "2/3",
    ]);
    expect(pages(3)).toEqual([
      "WellD Sagl", "Via Pessina 9", "WellD Sagl · Via Pessina 9",
      "ALLEGATO A – DETTAGLIO DELL’IMPEGNO", "Release", "Epic", "Giorni-uomo", "MVP", "10,0", "Auth", "10,0", "Totale", "10,0",
      "3/3",
    ]);
  });

  it("is faithful: its strings, page by page, are the strings the PDF holds, in order", async () => {
    const richer = legacy({
      sections: [{ heading: "Costi", body: "**Grassetto** e *corsivo* e __sottolineato__, poi testo.\n\n| a | b |\n|---|---|\n| 1 | **2** |", costs: true }],
      opening: "Una **riga** con più stili.",
    });
    const { doc, pages } = await draw(richer);
    // (the two deal PDFs at the end are appended unchanged, not drawn)
    doc.getPages().slice(0, doc.getPageCount() - 2).forEach((page, index) => {
      // The PDF holds one string per style run; the log one per line: the same characters in the same order.
      expect(pages(index + 1).join("")).toBe(tjStrings(page).join(""));
    });
  });
});

describe("numbering is read from the engine, not computed by the renderer (DD-29)", () => {
  const source = readFileSync(new URL("./contractPdf.ts", import.meta.url), "utf8");

  it("has no section, sub-heading or annex arithmetic left", () => {
    expect(source).not.toMatch(/fromCharCode/);
    expect(source).not.toMatch(/letterOf|annexLetters/);
    expect(source).not.toMatch(/state\.sub|\bsub:\s*0/);
    expect(source).not.toMatch(/\$\{(number|index \+ 1|section)\}[.\s]/);
    expect(source).not.toMatch(/\bposition \+= 1/);
    expect(source).toMatch(/numberOffer\(/);
    expect(source).toMatch(/computeCosts\(/);
  });

  it("never runs parseInline over a plain surface (DD-47)", () => {
    expect(source).not.toMatch(/parseInline/);
  });
});

describe("annex letters follow the engine for text annexes too (AC-9.5)", () => {
  const withTextAnnex = (designation: string) =>
    legacy({
      textAnnexes: [{ designation, title: "Condizioni di servizio", subtitle: null, intro: "", sections: [{ heading: "Ambito", body: "Testo." }] }],
    });

  it("a text annex A moves the effort annex to B and the deal PDFs to C and D", async () => {
    const { pages } = await draw(withTextAnnex("A"));
    const all = [1, 2, 3, 4].flatMap((page) => pages(page));
    expect(all).toContain("Allegato A - Condizioni di servizio");
    expect(all).toContain("Allegato B - Dettaglio dell’impegno");
    expect(all).toContain("Allegato C - uno.pdf");
    expect(all).toContain("Allegato D - due.pdf");
    expect(all).toContain("ALLEGATO B – DETTAGLIO DELL’IMPEGNO");
    expect(all).not.toContain("ALLEGATO A – DETTAGLIO DELL’IMPEGNO");
  });

  it("a text annex named SLA leaves the effort annex A", async () => {
    const { pages } = await draw(withTextAnnex("SLA"));
    const all = [1, 2, 3, 4].flatMap((page) => pages(page));
    expect(all).toContain("Allegato SLA - Condizioni di servizio");
    expect(all).toContain("Allegato A - Dettaglio dell’impegno");
    expect(all).toContain("Allegato B - uno.pdf");
  });
});

describe("plain surfaces are drawn as text (DD-47)", () => {
  it("a cost description `**x**` prints the four characters, and a marker character is split out, not drawn", async () => {
    const snapshot = legacy({
      costs: {
        currency: "CHF",
        columns: { position: true, unit: false },
        showTotal: false,
        lines: [
          { description: "**x**", kind: "one_off", unitCents: 100, percentBp: null, quantity: 1, totalCents: 100 },
          { description: "abcde", kind: "one_off", unitCents: 100, percentBp: null, quantity: 1, totalCents: 100 },
        ],
        oneOffCents: 200,
        yearlyCents: 0,
      },
    });
    const { drawLog } = await draw(snapshot);
    const texts = drawLog.map((entry) => entry.text);
    expect(texts).toContain("**x**");
    expect(texts).toContain("abcde");
    expect(texts.join("")).not.toMatch(/[-]/);
    expect(texts.join("")).not.toContain("?");
  });
});

describe("a legacy snapshot without the new members still renders", () => {
  it("renders and draws one log entry list per page", async () => {
    const { doc, drawLog } = await draw(legacy({ annex: null, attachments: [] }));
    expect(doc.getPageCount()).toBeGreaterThan(0);
    expect(drawLog.length).toBeGreaterThan(10);
  });
});
