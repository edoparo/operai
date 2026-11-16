/**
 * Preview ≡ PDF (specs/20261115-crm-offer-wizard T34; AC-3.2, AC-9.5, DD-29, DD-47): for each of the seven seeds, the
 * strings the renderer draws equal the document text the engine derives (`resolveOffer` + `numberOffer` +
 * `computeCosts`), after whitespace and line-wrap normalisation — section and sub-heading numbers, annex letters,
 * annex intros, cost positions, span totals and the fixed document words included. The preview draws the same text
 * from the same engine calls, so this one equality is the proof for both.
 */

import { describe, expect, it } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { WELLD_CH_IT_V1, type WizardSeedCode } from "../offer-templates/wizardSeeds/welldChIt";
import { costsOf, documentText, drawOrder, matchDrawLog, type DocPart } from "../test-support/documentText";
import "../test-support/world";
import { renderContractPdf, type DrawnText } from "./contractPdf";
import { sampleAnswers, sampleContext, setBlock, type WizardAnswers } from "./engine/answers";
import { numberOffer } from "./engine/numbering";
import { resolveOffer } from "./engine/resolve";
import { parseTemplate } from "./engine/syntax";
import { wizardSnapshotOf } from "./generation";
import type { Scope } from "./scope";

const REFERENCE = "0017/2026";
const PROFILE = { legalName: "wellD Sagl", addressLines: ["Via Pessina 9", "6900 Lugano"], vatNumber: "CHE-1", iban: "CH00" };
const MARKERS = /[-]/g;

const pdfWith = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) doc.addPage([595.28, 841.89]).drawText("x", { x: 50, y: 700, size: 12, font });
  return doc.save();
};

/** An effort detail with two releases, enough to fill the annex table. */
const EFFORT: Scope = {
  aiAssisted: true,
  releases: [
    { name: "Release 1", epics: [{ epic: "Login e profilo", manDaysTenths: 125 }, { epic: "Consumi", manDaysTenths: 80 }], manDaysTenths: 205 },
    { name: "Release 2", epics: [{ epic: "Segnalazioni", manDaysTenths: 60 }], manDaysTenths: 60 },
  ],
  manDaysTenths: 265,
};

type Variant = "defaults" | "everything" | "annexes";

async function run(code: WizardSeedCode, variant: Variant, mutate: (log: DrawnText[]) => void = () => undefined) {
  const seed = WELLD_CH_IT_V1.find((entry) => entry.code === code)!;
  const { ast } = parseTemplate(seed.source);
  const context = sampleContext("it");
  let answers: WizardAnswers = sampleAnswers(ast, "it");
  if (variant !== "defaults") {
    const choiceOptions = new Set(ast.choices.flatMap((choice) => choice.options));
    for (const block of ast.blocks) if (!choiceOptions.has(block.name)) answers = setBlock(ast, answers, block.name, true);
  }
  const resolved = resolveOffer(ast, answers, context, { reference: REFERENCE });
  expect(resolved.missing).toEqual([]);
  expect(resolved.invalid).toEqual([]);

  const withAnnexes = variant === "annexes";
  const effort = withAnnexes ? EFFORT : null;
  const attachments = withAnnexes
    ? [
        { id: "a1", fileName: "Capitolato tecnico.pdf", sizeBytes: 1000 },
        { id: "a2", fileName: "Allegato commerciale.pdf", sizeBytes: 2000 },
      ]
    : [];
  const snapshot = wizardSnapshotOf({
    template: { id: "tpl", name: seed.name },
    templateVersion: 1,
    answers,
    resolved,
    reference: REFERENCE,
    currency: context.currency,
    profile: PROFILE,
    annex: effort,
    attachments,
    preparedBy: "Ada",
  });

  const drawLog: DrawnText[] = [];
  await renderContractPdf(snapshot, { letterhead: await pdfWith(1), attachments: await Promise.all(attachments.map(() => pdfWith(1))) }, { drawLog });
  mutate(drawLog);

  // The numbering, from the resolved offer: markers split out of the plain surfaces first, as the renderer does.
  const numbered = numberOffer({
    language: resolved.language,
    sections: resolved.sections.map((section) => ({ key: section.key, heading: section.heading.replace(MARKERS, ""), body: section.body })),
    annexes: resolved.annexes.map((annex) => ({
      designation: annex.designation,
      title: annex.title.replace(MARKERS, ""),
      sections: annex.sections.map((section) => ({ key: section.key, heading: section.heading.replace(MARKERS, ""), body: section.body })),
    })),
    effortAnnex: effort !== null,
    attachmentNames: attachments.map((attachment) => attachment.fileName),
  });
  const parts = documentText({ resolved, numbered, costs: costsOf(resolved), reference: REFERENCE, currency: context.currency, effort });
  return { resolved, numbered, parts, drawLog, mismatch: matchDrawLog(parts, drawLog) };
}

const CODES = WELLD_CH_IT_V1.map((seed) => seed.code);
const texts = (parts: readonly DocPart[]) => parts.map((part) => part.text);

describe("preview ≡ PDF: the draw log equals the engine's document text (AC-3.2)", () => {
  for (const code of CODES) {
    for (const variant of ["defaults", "everything", "annexes"] as const) {
      it(`${code}, ${variant}`, async () => {
        const { mismatch, parts, drawLog } = await run(code, variant);
        expect(mismatch).toBeNull();
        // not vacuous: a real document was compared
        expect(parts.length).toBeGreaterThan(30);
        expect(drawLog.length).toBeGreaterThan(30);
      });
    }
  }
});

describe("what the equality covers (AC-3.2, AC-9.5)", () => {
  it("numbers: section and sub-heading numbers come from the engine and are drawn", async () => {
    const { parts, drawLog, numbered } = await run("T1", "everything");
    const headings = parts.filter((part) => part.role === "heading").map((part) => part.text);
    expect(headings.slice(0, 3)).toEqual(["1. DEFINIZIONI", "2. OGGETTO DELLA FORNITURA", "3. ATTIVITÀ E TEMPISTICHE"]);
    const subheadings = parts.filter((part) => part.role === "subheading").map((part) => part.text);
    expect(subheadings).toContain("4.1 TRASFERTE");
    expect(numbered.sections[3]!.subheadings[0]).toBe("4.1 TRASFERTE");
    for (const heading of [...headings, ...subheadings]) expect(drawLog.map((entry) => entry.text).join("\n")).toContain(heading);
  });

  it("annex letters and the list of annexes: a text annex, the effort detail, the deal PDFs (AC-9.5)", async () => {
    const { parts, drawLog } = await run("T1", "annexes");
    const listed = parts.filter((part) => part.region === "annexList").map((part) => part.text);
    expect(listed).toEqual([
      "Allegati:",
      "•", "Allegato A - Perimetro funzionale e stime",
      "•", "Allegato B - Dettaglio dell’impegno",
      "•", "Allegato C - Capitolato tecnico.pdf",
      "•", "Allegato D - Allegato commerciale.pdf",
    ]);
    const annexHeadings = parts.filter((part) => part.role === "annexHeading").map((part) => part.text);
    expect(annexHeadings).toEqual(["ALLEGATO A – PERIMETRO FUNZIONALE E STIME", "ALLEGATO B – DETTAGLIO DELL’IMPEGNO"]);
    const drawn = drawLog.map((entry) => entry.text);
    for (const heading of annexHeadings) expect(drawn).toContain(heading);
    // the index lists the sections, the text annex and the effort annex
    const index = parts.filter((part) => part.index).map((part) => part.text);
    expect(index.at(-2)).toBe("ALLEGATO A – PERIMETRO FUNZIONALE E STIME");
    expect(index.at(-1)).toBe("ALLEGATO B – DETTAGLIO DELL’IMPEGNO");
  });

  it("annex intros and the annex's own section numbers are drawn", async () => {
    const { parts, resolved } = await run("T1", "everything");
    const annex = resolved.annexes[0]!;
    expect(annex.intro).not.toBe("");
    const annexParts = parts.filter((part) => part.region === "annex");
    expect(annexParts[0]!.role).toBe("annexHeading");
    expect(annexParts.some((part) => part.role === "heading" && part.text.startsWith("1. "))).toBe(true);
    expect(annexParts.some((part) => part.role === "heading" && part.text.startsWith("2. "))).toBe(true);
  });

  it("cost table: positions, a span total, a dash for an empty span, an option line with its box", async () => {
    const { parts } = await run("T1", "everything");
    const cells = parts.filter((part) => part.cell && part.region === "body" && part.cell.table === 0);
    const row = (n: number) => cells.filter((part) => part.cell!.row === n).map((part) => part.text);
    expect(row(0)).toEqual(["Pos.", "Voce di costo", "CHF / unità", "Qt.", "Totale CHF"]);
    expect(row(1)[0]).toBe("1");
    const totals = cells.filter((part) => part.text.startsWith("TOTALE")).length;
    expect(totals).toBeGreaterThan(0);
    expect(texts(parts).some((text) => text.startsWith("□ "))).toBe(true);
  });

  it("document words in the offer's language: header, acceptance and the index title", async () => {
    const { parts } = await run("T3", "annexes");
    expect(texts(parts)).toEqual(expect.arrayContaining(["CONTRATTO DI FORNITURA – Rif. 0017/2026", "Per accettazione", "Luogo e data:", "Firma valida del Cliente:", "INDICE", "Allegati:"]));
  });

  it("a list marker is drawn after its item's text, in the document text's draw order", async () => {
    const { parts, drawLog } = await run("T1", "defaults");
    const item = parts.findIndex((part) => part.trailing);
    expect(item).toBeGreaterThan(-1);
    const ordered = drawOrder(parts);
    const at = ordered.findIndex((part) => part === parts[item]);
    expect(ordered[at - 1]!.text).toBe(parts[item + 1]!.text);
    expect(drawLog.length).toBeGreaterThan(0);
  });
});

describe("the test fails when the renderer's draw differs (test of the test)", () => {
  const find = (log: DrawnText[], text: string) => log.findIndex((entry) => entry.text.includes(text));

  it("a letter changed in a drawn heading", async () => {
    const { mismatch } = await run("T1", "everything", (log) => {
      const at = find(log, "OGGETTO DELLA FORNITURA");
      log[at] = { ...log[at]!, text: log[at]!.text.replace("OGGETTO", "OGGETT0") };
    });
    expect(mismatch).not.toBeNull();
  });

  it("a section number changed", async () => {
    const { mismatch } = await run("T1", "everything", (log) => {
      const at = find(log, "2. OGGETTO");
      log[at] = { ...log[at]!, text: log[at]!.text.replace("2.", "3.") };
    });
    expect(mismatch).not.toBeNull();
  });

  it("a line dropped", async () => {
    const { mismatch } = await run("T3", "defaults", (log) => {
      log.splice(find(log, "Firma valida"), 1);
    });
    expect(mismatch).not.toBeNull();
  });

  it("a line added", async () => {
    const { mismatch } = await run("T3", "defaults", (log) => {
      log.splice(find(log, "Firma valida"), 0, { page: 1, text: "extra" });
    });
    expect(mismatch).not.toBeNull();
  });

  it("two lines swapped", async () => {
    const { mismatch } = await run("T3", "defaults", (log) => {
      const at = find(log, "Luogo e data:");
      [log[at], log[at + 1]] = [log[at + 1]!, log[at]!];
    });
    expect(mismatch).not.toBeNull();
  });

  it("an annex letter changed", async () => {
    const { mismatch } = await run("T1", "annexes", (log) => {
      const at = find(log, "Allegato B - ");
      log[at] = { ...log[at]!, text: log[at]!.text.replace("Allegato B", "Allegato E") };
    });
    expect(mismatch).not.toBeNull();
  });

  it("a cost figure changed", async () => {
    const { mismatch } = await run("T1", "everything", (log) => {
      const at = find(log, "’000");
      log[at] = { ...log[at]!, text: log[at]!.text.replace("’000", "’001") };
    });
    expect(mismatch).not.toBeNull();
  });

  it("the unchanged draw passes", async () => {
    expect((await run("T3", "defaults")).mismatch).toBeNull();
  });
});
