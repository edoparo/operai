import { describe, expect, it } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildScope } from "./scope";
import type { EstimateDocument } from "../lib/estimai";
import { formatManDays, formatPrice, scopeLabels, winAnsi } from "./pdf";

/**
 * `pdf.ts` is what the offer renderers and the draft builder share: the scope labels, the price and man-day text, and the
 * filter that keeps a string drawable in Helvetica (eval of specs/20261115-crm-offer-wizard: the file showed 18 % functions, 40 % lines
 * because its dead 018 summary renderer was never called; the renderer is removed and these are its live paths).
 */

describe("scopeLabels: the names the scope builder falls back on, per language", () => {
  it("gives the English and the Italian pair, and the two differ", () => {
    expect(scopeLabels("en")).toEqual({ unassignedLabel: "Other", noEpicLabel: "General" });
    expect(scopeLabels("it")).toEqual({ unassignedLabel: "Altro", noEpicLabel: "Generale" });
  });

  it("is what a document prints for work with no release and no epic (the labels reach the scope, not just the object)", () => {
    const estimate: EstimateDocument = {
      id: "e",
      name: "E",
      content: { params: {}, releases: [], acts: [{ id: "a1", epic: "", ml: 10, release: "missing" }] },
    };
    const it = buildScope(estimate, { aiAssisted: false, ...scopeLabels("it") });
    expect(it.releases.map((r) => r.name)).toEqual(["Altro"]);
    expect(it.releases[0]!.epics.map((e) => e.epic)).toEqual(["Generale"]);
    const en = buildScope(estimate, { aiAssisted: false, ...scopeLabels("en") });
    expect(en.releases.map((r) => r.name)).toEqual(["Other"]);
    expect(en.releases[0]!.epics.map((e) => e.epic)).toEqual(["General"]);
  });
});

describe("formatPrice: integer cents in, the currency's own separators out", () => {
  it("groups thousands with the currency's mark and keeps two decimals", () => {
    expect(formatPrice(0, "CHF")).toBe("CHF 0.00");
    expect(formatPrice(99_999, "CHF")).toBe("CHF 999.99");
    expect(formatPrice(100_000, "CHF")).toBe("CHF 1'000.00");
    expect(formatPrice(100_000, "EUR")).toBe("EUR 1.000,00");
    expect(formatPrice(123_456_789, "CHF")).toBe("CHF 1'234'567.89");
    expect(formatPrice(123_456_789, "EUR")).toBe("EUR 1.234.567,89");
  });

  it("pads the cents of a whole amount and of a single cent", () => {
    expect(formatPrice(100, "EUR")).toBe("EUR 1,00");
    expect(formatPrice(1, "EUR")).toBe("EUR 0,01");
    expect(formatPrice(1_010, "CHF")).toBe("CHF 10.10");
  });
});

describe("formatManDays: tenths of a day, one decimal, the language's decimal mark", () => {
  it("prints a whole and a fractional figure with one decimal", () => {
    expect(formatManDays(0, "en")).toBe("0.0");
    expect(formatManDays(5, "en")).toBe("0.5");
    expect(formatManDays(100, "en")).toBe("10.0");
    expect(formatManDays(1_234, "en")).toBe("123.4");
  });

  it("uses the comma in Italian and only there", () => {
    expect(formatManDays(5, "it")).toBe("0,5");
    expect(formatManDays(1_234, "it")).toBe("123,4");
    expect(formatManDays(100, "it")).not.toContain(".");
  });
});

describe("winAnsi: a string the standard Helvetica can draw, whatever the input", () => {
  it("keeps newlines and turns a tab into a space", () => {
    expect(winAnsi("a\nb")).toBe("a\nb");
    expect(winAnsi("a\tb")).toBe("a b");
  });

  it("composes a decomposed accent before judging it, so a typed 'é' survives either way", () => {
    expect(winAnsi("é")).toBe("é");
    expect(winAnsi("Città")).toBe("Città");
  });

  it("replaces one character, not one UTF-16 unit, with one question mark (an emoji is one)", () => {
    expect(winAnsi("a😀b")).toBe("a?b");
  });

  it("replaces control characters and the unassigned part of the C1 range", () => {
    expect(winAnsi("a\u0000b\u0007c\u007fd\u0081e")).toBe("a?b?c?d?e");
  });

  it("keeps the WinAnsi punctuation that sits outside Latin-1 (euro, dashes, typographic quotes, ellipsis)", () => {
    const kept = "€ – — ‘ ’ “ ” … • ™ Š š Ž ž Œ œ Ÿ";
    expect(winAnsi(kept)).toBe(kept);
  });

  it("is what makes drawing safe: Helvetica refuses the raw text and accepts the filtered one", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = "Zürich 北京 ✓ 😀 € “ok”";
    expect(() => font.widthOfTextAtSize(text, 10)).toThrow();
    expect(() => font.widthOfTextAtSize(winAnsi(text), 10)).not.toThrow();
    // every code point the filter lets through, from the whole Basic Multilingual Plane's first blocks
    let every = "";
    for (let code = 0; code < 0x2200; code++) if (code < 0xd800 || code > 0xdfff) every += String.fromCodePoint(code);
    const safe = winAnsi(every).replace(/\n/g, " ");
    expect(() => font.widthOfTextAtSize(safe, 10)).not.toThrow();
  });
});
