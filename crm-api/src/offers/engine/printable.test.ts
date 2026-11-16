import { describe, expect, it } from "bun:test";
import { winAnsi } from "../pdf";
import { printable } from "./printable";

/** specs/20261115-crm-offer-wizard AC-3.2/3.3, DD-22: the preview shows what the PDF prints. */
describe("printable", () => {
  it("keeps WinAnsi text as it is", () => {
    expect(printable("Offerta n. 12 – è già “pronta” € 1’000")).toBe("Offerta n. 12 – è già “pronta” € 1’000");
    expect(printable("a\nb")).toBe("a\nb");
  });

  it("keeps the ballot box □ (U+25A1), which the renderer draws as a box", () => {
    expect(printable("□ voce a scelta")).toBe("□ voce a scelta");
  });

  it("maps every other character the font cannot print to a single ?", () => {
    expect(printable("日本")).toBe("??");
    expect(printable("a✓b")).toBe("a?b"); // check mark
    expect(printable("a■b")).toBe("a?b"); // black square is not the ballot box
    expect(printable("x\u{1F600}y")).toBe("x?y"); // one code point, one ?
  });

  it("maps a tab to a space and other control characters to ?", () => {
    expect(printable("a\tb")).toBe("a b");
    expect(printable("a\rb\u0000")).toBe("a?b?");
  });

  it("maps the marker characters and the hand-edit token brackets to ? — they are never document text", () => {
    expect(printable("\uE000\uE001\uE002\uE003⟦⟧")).toBe("??????");
  });

  it("maps the reference-token brackets to ? too (DD-52): the token is split off before printable ever sees a body", () => {
    expect(printable("⟪")).toBe("?");
    expect(printable("⟫")).toBe("?");
    expect(printable("⟪REF⟫")).toBe("?REF?");
  });

  it("normalises to NFC first, so a decomposed letter prints as one", () => {
    expect(printable("é")).toBe("é");
  });

  it("agrees with the renderer's winAnsi on every character but □", () => {
    for (let code = 0; code < 0x3000; code += 1) {
      const char = String.fromCodePoint(code);
      if (code >= 0xd800 && code <= 0xdfff) continue;
      expect(printable(char)).toBe(code === 0x25a1 ? char : winAnsi(char));
    }
  });

  it("is idempotent", () => {
    const once = printable("a✓□é\t");
    expect(printable(once)).toBe(once);
  });
});
