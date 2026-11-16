/**
 * What the seven wizard texts need from the renderer (specs/20261115-crm-offer-wizard T26; AC-4.1, AC-4.6, AC-4.7,
 * AC-9.5, DD-13, DD-45, DD-47): total rows over spans, option lines with a box, optional column labels, and text
 * annexes. Everything is asserted on the draw log: the strings the renderer drew, in order, page by page.
 */

import { describe, expect, it } from "bun:test";
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, type PDFPage } from "pdf-lib";
import type { ContractSnapshot, OfferCosts } from "./contract";
import { renderContractPdf, type DrawnText } from "./contractPdf";
import type { ResolvedCostRow } from "./engine/resolve";

const pdfWith = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) doc.addPage([595.28, 841.89]).drawText("x", { x: 50, y: 700, size: 12, font });
  return doc.save();
};

const line = (name: string, description: string, kind: "one_off" | "yearly" | "discount" | "option", cents: number, quantity = 1): ResolvedCostRow => ({
  type: "line",
  name,
  description,
  kind,
  unitCents: cents,
  percentBp: null,
  quantity,
});
const total = (label: string): ResolvedCostRow => ({ type: "total", label });

/** The 018 stored members of a table whose printed rows are `rows`: the renderer reads `rows`. */
const costsOf = (rows: ResolvedCostRow[], over: Partial<OfferCosts> = {}): OfferCosts => ({
  currency: "CHF",
  columns: { position: true, unit: false },
  showTotal: true,
  lines: [],
  oneOffCents: 0,
  yearlyCents: 0,
  rows,
  ...over,
});

const wizard = (over: Partial<ContractSnapshot> = {}): ContractSnapshot => ({
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
  clientLines: ["Esempio SA"],
  contacts: [],
  opening: "Con riferimento.",
  sections: [
    { heading: "Oggetto", body: "Testo.", costs: false },
    { heading: "Costi", body: "- IVA esclusa.", costs: true },
  ],
  costs: costsOf([line("cost:a", "Sviluppo", "one_off", 100_000)]),
  acceptanceLabel: null,
  annex: null,
  attachments: [],
  aiAssisted: false,
  preparedBy: null,
  ...over,
});

const draw = async (snapshot: ContractSnapshot, attachments = 0) => {
  const drawLog: DrawnText[] = [];
  const bytes = await renderContractPdf(
    snapshot,
    { letterhead: null, attachments: await Promise.all(Array.from({ length: attachments }, () => pdfWith(1))) },
    { drawLog },
  );
  const doc = await PDFDocument.load(bytes);
  const texts = drawLog.map((entry) => entry.text);
  /** The strings of the cost table, from its header "Pos." to the last row before section 2's text. */
  const afterIndexOf = (text: string, from = 0) => texts.indexOf(text, from);
  return { drawLog, texts, doc, afterIndexOf, pageOf: (text: string) => drawLog.find((entry) => entry.text === text)?.page ?? 0 };
};

/** Rectangles a page's content stream draws (pdf-lib closes each with `h`): table cells, and the ballot box. */
const rectangles = (page: PDFPage): number => {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
  return streams
    .map((stream) => (stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") : ""))
    .join("\n")
    .split("\n")
    .filter((operator) => operator.trim() === "h").length;
};

describe("total rows over spans (AC-4.6, DD-13)", () => {
  it("prints each total row's own label and the sum of its span: 1 500 and 150", async () => {
    const rows = [
      line("cost:a", "Sviluppo", "one_off", 100_000),
      line("cost:b", "Canone", "yearly", 50_000),
      total("TOTALE primo anno"),
      line("cost:c", "Manutenzione", "yearly", 20_000),
      line("cost:d", "Sconto", "discount", 5_000),
      total("TOTALE successivo"),
    ];
    const { texts, afterIndexOf } = await draw(wizard({ costs: costsOf(rows, { oneOffCents: 95_000, yearlyCents: 70_000 }) }));
    const first = afterIndexOf("TOTALE primo anno");
    const second = afterIndexOf("TOTALE successivo");
    expect(first).toBeGreaterThan(0);
    expect(texts[first + 1]).toBe("1’500");
    expect(second).toBeGreaterThan(first);
    expect(texts[second + 1]).toBe("150");
    // positions: counted lines numbered 1, 2, 3; the discount carries none
    const body = texts.slice(texts.indexOf("Pos."), second + 2);
    expect(body).toEqual([
      "Pos.", "Voce di costo", "Totale CHF",
      "1", "Sviluppo", "1’000",
      "2", "Canone", "500",
      "TOTALE primo anno", "1’500",
      "3", "Manutenzione", "200",
      "Sconto", "- 50",
      "TOTALE successivo", "150",
    ]);
  });

  it("prints a dash for a span with no counted line", async () => {
    const rows = [line("cost:a", "Sviluppo", "one_off", 100_000), total("TOTALE"), line("cost:o", "Reportistica", "option", 390_000), total("TOTALE opzioni")];
    const { texts, afterIndexOf } = await draw(wizard({ costs: costsOf(rows, { oneOffCents: 100_000 }) }));
    const at = afterIndexOf("TOTALE opzioni");
    expect(at).toBeGreaterThan(0);
    expect(texts[at + 1]).toBe("–");
    expect(texts[afterIndexOf("TOTALE") + 1]).toBe("1’000");
  });

  it("prints no total row when the table's totals are off", async () => {
    const rows = [line("cost:a", "Sviluppo", "one_off", 100_000), total("TOTALE")];
    const { texts } = await draw(wizard({ costs: costsOf(rows, { showTotal: false, oneOffCents: 100_000 }) }));
    expect(texts).not.toContain("TOTALE");
  });

  it("draws a total label as plain text: no markup, no marker character (DD-47)", async () => {
    const rows = [line("cost:a", "Sviluppo", "one_off", 100_000), total("**TOT**x")];
    const { texts } = await draw(wizard({ costs: costsOf(rows) }));
    expect(texts).toContain("**TOT**x");
  });
});

describe("option lines (AC-4.7)", () => {
  const rows = [
    line("cost:a", "Sviluppo", "one_off", 100_000),
    line("cost:b", "Canone", "yearly", 50_000),
    total("TOTALE"),
    line("cost:o", "Modulo reportistica", "option", 390_000),
  ];

  it("prints the box, the position after the counted lines, and its own total; no total includes it", async () => {
    const { texts, afterIndexOf, doc } = await draw(wizard({ costs: costsOf(rows, { oneOffCents: 100_000, yearlyCents: 50_000 }) }));
    const totalAt = afterIndexOf("TOTALE");
    expect(texts[totalAt + 1]).toBe("1’500");
    // after the total: its position (3), the box and description, its total
    expect(texts.slice(totalAt + 2, totalAt + 5)).toEqual(["3", "□ Modulo reportistica", "3’900"]);
    expect(doc.getPageCount()).toBeGreaterThan(0);
    // the ballot box is drawn, never degraded to "?"
    expect(texts.join("")).not.toContain("?");
  });

  it("draws the box as a square, not as a glyph: one more rectangle than the same line as a counted line", async () => {
    const asOption = await draw(wizard({ costs: costsOf([line("cost:a", "Sviluppo", "one_off", 100_000), line("cost:o", "Opzione", "option", 5_000)]) }));
    const asCounted = await draw(wizard({ costs: costsOf([line("cost:a", "Sviluppo", "one_off", 100_000), line("cost:o", "Opzione", "yearly", 5_000)]) }));
    expect(rectangles(asOption.doc.getPages()[0]!) - rectangles(asCounted.doc.getPages()[0]!)).toBe(1);
  });

  it("an option line with unit and quantity columns prints its unit price and quantity", async () => {
    const withUnit = [line("cost:a", "Sviluppo", "one_off", 100_000), total("TOTALE"), line("cost:o", "Opzione", "option", 390_000, 2)];
    const { texts, afterIndexOf } = await draw(wizard({ costs: costsOf(withUnit, { columns: { position: true, unit: true } }) }));
    const at = afterIndexOf("□ Opzione");
    expect(texts.slice(at, at + 4)).toEqual(["□ Opzione", "3’900", "2", "7’800"]);
  });
});

describe("cost column labels (AC-9.5, DD-24)", () => {
  it("replaces the default unit and quantity headers with the template's", async () => {
    const snapshot = wizard({
      costs: costsOf([line("cost:a", "Consulenza", "one_off", 100_000, 3)], { columns: { position: false, unit: true }, labels: { unit: "CHF / giorno", quantity: "Giorni" } }),
    });
    const { texts } = await draw(snapshot);
    const at = texts.indexOf("Voce di costo");
    expect(texts.slice(at, at + 4)).toEqual(["Voce di costo", "CHF / giorno", "Giorni", "Totale CHF"]);
  });

  it("keeps the defaults when a label is null, and draws a label as plain text", async () => {
    const snapshot = wizard({
      costs: costsOf([line("cost:a", "Consulenza", "one_off", 100_000)], { columns: { position: false, unit: true }, labels: { unit: "**u**x", quantity: null } }),
    });
    const { texts } = await draw(snapshot);
    const at = texts.indexOf("Voce di costo");
    expect(texts.slice(at, at + 4)).toEqual(["Voce di costo", "**u**x", "Qt.", "Totale CHF"]);
  });
});

describe("text annexes (DD-45, AC-9.5)", () => {
  const annexed = (over: Partial<ContractSnapshot> = {}) =>
    wizard({
      annex: { aiAssisted: false, manDaysTenths: 100, releases: [{ name: "MVP", manDaysTenths: 100, epics: [{ epic: "Auth", manDaysTenths: 100 }] }] },
      textAnnexes: [
        {
          designation: "A",
          title: "Condizioni di servizio",
          subtitle: "Livelli di servizio",
          intro: "Premessa dell’allegato.\n\n### Obiettivi\n\nTesto degli obiettivi.",
          sections: [
            { heading: "Ambito", body: "Testo.\n\n### Dettaglio\n\nUno." },
            { heading: "Durata", body: "Due." },
          ],
        },
      ],
      ...over,
    });

  it("draws 'ALLEGATO A – …' from a new page, then the subtitle, the intro (its ### unnumbered) and the annex's own numbered sections", async () => {
    const { texts, drawLog, pageOf } = await draw(annexed());
    const heading = texts.indexOf("ALLEGATO A – CONDIZIONI DI SERVIZIO", texts.indexOf("Allegati:"));
    expect(heading).toBeGreaterThan(0);
    const page = drawLog[heading]!.page;
    // a new page: nothing of the contract is drawn on it before the heading, but the letterhead and the heading itself
    const before = drawLog.slice(0, heading).filter((entry) => entry.page === page).map((entry) => entry.text);
    expect(before).toEqual(["WellD Sagl", "Via Pessina 9", "WellD Sagl · Via Pessina 9"]);
    expect(page).toBeGreaterThan(pageOf("Per accettazione"));
    expect(texts.slice(heading + 1, heading + 10)).toEqual([
      "Livelli di servizio",
      "Premessa dell’allegato.",
      "OBIETTIVI",
      "Testo degli obiettivi.",
      "1. AMBITO",
      "Testo.",
      "1.1 DETTAGLIO",
      "Uno.",
      "2. DURATA",
    ]);
    // the effort-detail annex follows, lettered B, on its own page
    const effort = texts.indexOf("ALLEGATO B – DETTAGLIO DELL’IMPEGNO", heading);
    expect(effort).toBeGreaterThan(heading);
    expect(drawLog[effort]!.page).toBeGreaterThan(page);
    expect(texts.indexOf("ALLEGATO A – DETTAGLIO DELL’IMPEGNO")).toBe(-1);
  });

  it("lists both annexes in the index, with the pages they start on", async () => {
    const { drawLog, texts } = await draw(annexed());
    const indexAt = (label: string) => texts.indexOf(label);
    const textAnnex = drawLog.find((entry, i) => i > indexAt("INDICE") && entry.text === "ALLEGATO A – CONDIZIONI DI SERVIZIO")!;
    expect(textAnnex.page).toBe(1);
    const entryIndex = drawLog.indexOf(textAnnex);
    // label, leaders, page number
    const printedPage = Number(drawLog[entryIndex + 2]!.text);
    const bodyHeading = drawLog.find((entry, i) => i > entryIndex + 2 && entry.text === "ALLEGATO A – CONDIZIONI DI SERVIZIO")!;
    expect(printedPage).toBe(bodyHeading.page);
    const effortLabel = drawLog.findIndex((entry) => entry.text === "ALLEGATO B – DETTAGLIO DELL’IMPEGNO");
    expect(drawLog[effortLabel]!.page).toBe(1);
    const effortBody = drawLog.find((entry, i) => i > effortLabel + 2 && entry.text === "ALLEGATO B – DETTAGLIO DELL’IMPEGNO")!;
    expect(Number(drawLog[effortLabel + 2]!.text)).toBe(effortBody.page);
  });

  it("lists them under 'Allegati:' in order, then the deal PDFs lettered after them", async () => {
    const { texts } = await draw(annexed({ attachments: [{ id: "a", fileName: "uno.pdf", sizeBytes: 1 }] }), 1);
    const at = texts.indexOf("Allegati:");
    expect(texts.slice(at, at + 7)).toEqual(["Allegati:", "•", "Allegato A - Condizioni di servizio", "•", "Allegato B - Dettaglio dell’impegno", "•", "Allegato C - uno.pdf"]);
  });

  it("draws an annex title and subtitle as plain text, markers split out, never parsed (DD-47)", async () => {
    const { texts } = await draw(
      annexed({
        textAnnexes: [{ designation: "SLA", title: "**Ti**t", subtitle: "_s_u", intro: "", sections: [{ heading: "H", body: "x" }] }],
      }),
    );
    expect(texts).toContain("ALLEGATO SLA – **TI**T");
    expect(texts).toContain("_s_u");
    expect(texts.join("")).not.toMatch(/[-]/);
  });

  it("draws an annex with an intro and no section, and several annexes each from a new page", async () => {
    const { drawLog, texts } = await draw(
      annexed({
        textAnnexes: [
          { designation: "A", title: "Uno", subtitle: null, intro: "Solo premessa.", sections: [] },
          { designation: "DPA", title: "Due", subtitle: null, intro: "", sections: [{ heading: "S", body: "b" }] },
        ],
      }),
    );
    const one = drawLog.find((entry) => entry.text === "ALLEGATO A – UNO" && texts.indexOf(entry.text) >= 0 && drawLog.indexOf(entry) > texts.indexOf("Allegati:"))!;
    const two = drawLog.find((entry) => entry.text === "ALLEGATO DPA – DUE" && drawLog.indexOf(entry) > texts.indexOf("Allegati:"))!;
    expect(two.page).toBeGreaterThan(one.page);
    expect(texts).toContain("Solo premessa.");
  });
});
