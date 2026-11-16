import { describe, expect, it } from "bun:test";
import { numberOffer, type NumberingInput } from "./numbering";
import vectors from "./vectors/numbering.json";

/** specs/20261115-crm-offer-wizard AC-9.5, AC-3.2; DD-29. */
describe("numberOffer", () => {
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      expect(numberOffer(vector.input as NumberingInput)).toEqual(vector.expect as never);
    });
  }

  const base = (overrides: Partial<NumberingInput>): NumberingInput => ({
    language: "it",
    sections: [],
    annexes: [],
    effortAnnex: false,
    attachmentNames: [],
    ...overrides,
  });

  it("upper-cases headings without any locale and maps what the PDF cannot print", () => {
    const result = numberOffer(
      base({ sections: [{ key: "S#0", heading: "straße città 日本", body: "### iğdır istanbul\nx" }] }),
    );
    expect(result.sections[0]).toMatchObject({ number: "1", heading: "1. STRASSE CITTÀ ??", subheadings: ["1.1 I?DIR ISTANBUL"] });
  });

  it("numbers a sub-heading inside a list item's nested blocks in markup order", () => {
    const result = numberOffer(base({ sections: [{ key: "S#0", heading: "S", body: "### Uno\n- a\n  - b\n\n### Due" }] }));
    expect(result.sections[0]!.subheadings).toEqual(["1.1 UNO", "1.2 DUE"]);
  });

  it("restarts the sub-heading count in every section", () => {
    const result = numberOffer(
      base({
        sections: [
          { key: "A#0", heading: "A", body: "### x\n\n### y" },
          { key: "B#1", heading: "B", body: "### z" },
        ],
      }),
    );
    expect(result.sections.map((section) => section.subheadings)).toEqual([["1.1 X", "1.2 Y"], ["2.1 Z"]]);
  });

  it("keeps every letter distinct however many files there are", () => {
    const names = Array.from({ length: 30 }, (_, index) => `f${index}.pdf`);
    const result = numberOffer(base({ effortAnnex: true, attachmentNames: names }));
    const letters = [result.effortAnnexLetter!, ...result.attachmentLetters];
    expect(new Set(letters).size).toBe(31);
    expect(letters.slice(0, 3)).toEqual(["A", "B", "C"]);
    expect(letters[26]).toBe("AA");
  });

  it("is pure: it imports only engine modules and uses no locale, clock or I/O", async () => {
    const source = await Bun.file(new URL("./numbering.ts", import.meta.url)).text();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const match of code.matchAll(/from "([^"]+)"/g)) expect(match[1]).toMatch(/^\.\//);
    expect(code).not.toMatch(/Intl\.|toLocale|Date\.now|new Date\(|Math\.random/);
  });
});
