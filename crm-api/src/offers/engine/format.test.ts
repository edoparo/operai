import { describe, expect, it } from "bun:test";
import { formatAmount, formatNumber, formatPercent, shortDate } from "./format";
import { words } from "./words";
import vectors from "./vectors/format.json";

/** specs/20261115-crm-offer-wizard AC-2.5, AC-3.2, AC-4.1, DD-21: the document's formatting, shared by the PDF and the preview. */
describe("vectors/format.json", () => {
  for (const v of vectors.formatAmount) {
    it(`formatAmount(${v.cents}, ${v.currency}) = ${v.expected}`, () => {
      expect(formatAmount(v.cents, v.currency as "CHF" | "EUR")).toBe(v.expected);
    });
  }
  for (const v of vectors.shortDate) {
    it(`shortDate(${JSON.stringify(v.date)}) = ${JSON.stringify(v.expected)}`, () => {
      expect(shortDate(v.date)).toBe(v.expected);
    });
  }
  for (const v of vectors.formatPercent) {
    it(`formatPercent(${v.bp}) = ${v.expected}`, () => {
      expect(formatPercent(v.bp)).toBe(v.expected);
    });
  }
  for (const v of vectors.formatNumber) {
    it(`formatNumber(${JSON.stringify(v.value)}, ${v.language}) = ${JSON.stringify(v.expected)}`, () => {
      expect(formatNumber(v.value, v.language as "en" | "it")).toBe(v.expected);
    });
  }
});

describe("document words (words.ts)", () => {
  it("has the same words in both offer languages", () => {
    expect(Object.keys(words("it")).sort()).toEqual(Object.keys(words("en")).sort());
  });

  it("keeps the renderer's fixed words", () => {
    expect(words("it").total).toBe("TOTALE");
    expect(words("en").total).toBe("TOTAL");
    expect(words("it").annexes).toBe("Allegati:");
    expect(words("en").annexes).toBe("Annexes:");
    expect(words("it").position).toBe("Pos.");
    expect(words("it").annexHeading("A")).toBe("ALLEGATO A – DETTAGLIO DELL’IMPEGNO");
    expect(words("en").annexHeading("B")).toBe("ANNEX B – EFFORT DETAIL");
    expect(words("it").title("0017/2026")).toBe("CONTRATTO DI FORNITURA – Rif. 0017/2026");
    expect(words("en").unit("EUR")).toBe("EUR / unit");
    expect(words("it").amount("CHF")).toBe("Totale CHF");
  });
});
