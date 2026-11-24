/**
 * Unit tests for the receipt-number rules (T3, specs/20261118-refund-accounting-export;
 * AC-4.2, AC-4.8; plan "Receipt number rules").
 */

import { describe, expect, it } from "bun:test";
import { RECEIPT_CODE_PATTERN, formatReceiptNumber, initials, normaliseReceiptCode, parseReceiptNumber } from "./receiptNumber";

describe("initials from the name (AC-4.2)", () => {
  it("Matteo Codogno -> MC", () => {
    expect(initials("Matteo Codogno", "someone@welld.ch")).toBe("MC");
  });

  it("takes the first word and the LAST word: Anna Maria Rossi -> AR", () => {
    expect(initials("Anna Maria Rossi", "x@welld.ch")).toBe("AR");
  });

  it("strips diacritics: Élise Würth -> EW", () => {
    expect(initials("Élise Würth", "x@welld.ch")).toBe("EW");
    expect(initials("Zoë Brontë", "x@welld.ch")).toBe("ZB");
  });

  it("works on a decomposed (NFD) name as well as a composed (NFC) one", () => {
    expect(initials("Élise Würth", "x@welld.ch")).toBe("EW");
    expect(initials("Élise Würth", "x@welld.ch")).toBe("EW");
  });

  it("is upper-case whatever the case of the name", () => {
    expect(initials("matteo codogno", "x@welld.ch")).toBe("MC");
    expect(initials("MATTEO CODOGNO", "x@welld.ch")).toBe("MC");
  });

  it("copes with extra whitespace, tabs and a hyphenated or dotted name", () => {
    expect(initials("  Matteo \t  Codogno  ", "x@welld.ch")).toBe("MC");
    expect(initials("Jean-Luc Picard", "x@welld.ch")).toBe("JP");
    expect(initials("J. R. R. Tolkien", "x@welld.ch")).toBe("JT");
  });

  it("a surname-first name gives the 'wrong' initials, accepted (R15): Codogno Matteo -> CM", () => {
    expect(initials("Codogno Matteo", "x@welld.ch")).toBe("CM");
  });
});

describe("initials: the email fallback (AC-4.8)", () => {
  it("a one-word name gives no initials, so the email is used: Cher -> email", () => {
    expect(initials("Cher", "matteo.codogno@welld.ch")).toBe("MC");
    expect(initials("Cher", "zz@welld.ch")).toBe("ZZ");
  });

  it("a null, empty or blank name uses the email", () => {
    expect(initials(null, "matteo.codogno@welld.ch")).toBe("MC");
    expect(initials(undefined, "matteo.codogno@welld.ch")).toBe("MC");
    expect(initials("", "matteo.codogno@welld.ch")).toBe("MC");
    expect(initials("   ", "matteo.codogno@welld.ch")).toBe("MC");
  });

  it("matteo.codogno@... -> MC (first letter of the first two dot-separated parts)", () => {
    expect(initials(null, "matteo.codogno@welld.ch")).toBe("MC");
  });

  it("mcodogno@... -> MC (the first two letters)", () => {
    expect(initials(null, "mcodogno@welld.ch")).toBe("MC");
  });

  it("m.c@... -> MC", () => {
    expect(initials(null, "m.c@welld.ch")).toBe("MC");
  });

  it("uses only the first two parts of a longer local part", () => {
    expect(initials(null, "anna.maria.rossi@welld.ch")).toBe("AM");
  });

  it("a part without a letter does not count as a part: 1.matteo.codogno -> MC", () => {
    expect(initials(null, "1.matteo.codogno@welld.ch")).toBe("MC");
  });

  it("one letter-bearing part, other parts digits: take the first two letters of the local part", () => {
    expect(initials(null, "mcodogno.2@welld.ch")).toBe("MC");
  });

  it("x@... -> XX (padded with X)", () => {
    expect(initials(null, "x@welld.ch")).toBe("XX");
    expect(initials("Cher", "x@welld.ch")).toBe("XX");
  });

  it("a local part with no letter at all -> XX", () => {
    expect(initials(null, "123@welld.ch")).toBe("XX");
    expect(initials(null, "@welld.ch")).toBe("XX");
  });

  it("strips diacritics and upper-cases in the email as well: élise.würth@ -> EW", () => {
    expect(initials(null, "élise.würth@welld.ch")).toBe("EW");
  });

  it("a name with a letterless last word falls back to the email rather than guessing", () => {
    expect(initials("Matteo 123", "anna.rossi@welld.ch")).toBe("AR");
  });

  it("an address without an @ is read as a local part, and a +tag does not break it", () => {
    expect(initials(null, "matteo.codogno")).toBe("MC");
    expect(initials(null, "matteo.codogno+refunds@welld.ch")).toBe("MC");
  });

  it("always returns exactly two characters A-Z, whatever it is given", () => {
    const names: (string | null)[] = [null, "", "A", "Ab", "A B", "日本 語", "Øyvind Ås", "ß ß", "  "];
    const emails = ["", "@", "a@b", "ab@b", "a.b@b", "日本@b", "1.2@b", "...@b", "a..b@c"];
    for (const name of names) {
      for (const email of emails) {
        expect(initials(name, email)).toMatch(/^[A-Z]{2}$/);
      }
    }
  });
});

describe("formatReceiptNumber (AC-4.2)", () => {
  it("MC + 2026 + 14 -> MC26/014", () => {
    expect(formatReceiptNumber("MC", 2026, 14)).toBe("MC26/014");
  });

  it("pads the sequence to three digits", () => {
    expect(formatReceiptNumber("MC", 2026, 1)).toBe("MC26/001");
    expect(formatReceiptNumber("MC", 2026, 99)).toBe("MC26/099");
    expect(formatReceiptNumber("MC", 2026, 100)).toBe("MC26/100");
  });

  it("prints 1000 and above in full, unpadded and untruncated", () => {
    expect(formatReceiptNumber("MC", 2026, 1000)).toBe("MC26/1000");
    expect(formatReceiptNumber("MC", 2026, 12345)).toBe("MC26/12345");
  });

  it("takes the year of the expense date, two digits: 2025 -> 25, 2009 -> 09", () => {
    expect(formatReceiptNumber("XX", 2025, 1)).toBe("XX25/001");
    expect(formatReceiptNumber("XX", 2009, 1)).toBe("XX09/001");
  });

  it("composes with initials(): Matteo Codogno, 2026, 81 -> MC26/081", () => {
    expect(formatReceiptNumber(initials("Matteo Codogno", "m@welld.ch"), 2026, 81)).toBe("MC26/081");
  });

  it("a three-letter prefix (a receipt code, AC-4.4): LCX + 2026 + 40 -> LCX26/040, and 2027 restarts at 001", () => {
    expect(formatReceiptNumber("LCX", 2026, 40)).toBe("LCX26/040");
    expect(formatReceiptNumber("LCX", 2027, 1)).toBe("LCX27/001");
    expect(formatReceiptNumber("LCX", 2026, 1000)).toBe("LCX26/1000");
    expect(formatReceiptNumber("LCX", 2026, 99999)).toBe("LCX26/99999");
  });

  it("refuses a prefix that is not two or three letters A-Z, a bad year and a bad sequence", () => {
    expect(() => formatReceiptNumber("M", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("mc", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("mcc", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("MCCC", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("M C", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("M1", 2026, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("MC", 26, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("MC", 2026.5, 1)).toThrow(RangeError);
    expect(() => formatReceiptNumber("MC", 2026, 0)).toThrow(RangeError);
    expect(() => formatReceiptNumber("MC", 2026, -3)).toThrow(RangeError);
    expect(() => formatReceiptNumber("MC", 2026, 1.5)).toThrow(RangeError);
  });
});

describe("parseReceiptNumber (AC-4.5)", () => {
  it("reads two- and three-letter numbers", () => {
    expect(parseReceiptNumber("AB26/005")).toEqual({ prefix: "AB", yy: 26, seq: 5, text: "AB26/005" });
    expect(parseReceiptNumber("LCX26/040")).toEqual({ prefix: "LCX", yy: 26, seq: 40, text: "LCX26/040" });
    expect(parseReceiptNumber("MC26/12345")).toEqual({ prefix: "MC", yy: 26, seq: 12345, text: "MC26/12345" });
  });

  it("trims and upper-cases first, and returns the normalised text", () => {
    expect(parseReceiptNumber(" ab26/5 ")).toEqual({ prefix: "AB", yy: 26, seq: 5, text: "AB26/5" });
    expect(parseReceiptNumber("\tlcx26/040\n")).toEqual({ prefix: "LCX", yy: 26, seq: 40, text: "LCX26/040" });
  });

  it("reads the year as written, whatever it is: LG25/003 is year 25", () => {
    expect(parseReceiptNumber("LG25/003")).toEqual({ prefix: "LG", yy: 25, seq: 3, text: "LG25/003" });
  });

  it("a zero sequence is well-formed (a paper number AB26/000); the caller decides what it means", () => {
    expect(parseReceiptNumber("AB26/000")).toEqual({ prefix: "AB", yy: 26, seq: 0, text: "AB26/000" });
  });

  it("is null for what is not a receipt number", () => {
    for (const bad of ["AA99/9A", "ABCD26/001", "A26/001", "AB26/", "AB26/123456", "AB2026/001", "AB26-001", "AB 26/001", "", "   ", "26/001", "ÀB26/001", "AB２６/001", "ß26/001", "ßA26/001"]) {
      expect(parseReceiptNumber(bad)).toBeNull();
    }
    for (const notText of [null, undefined, 26, {}, ["AB26/005"]]) {
      expect(parseReceiptNumber(notText)).toBeNull();
    }
  });

  it("round-trips with formatReceiptNumber for a sequence of 1 or more", () => {
    for (const [prefix, year, seq] of [["MC", 2026, 14], ["LCX", 2026, 40], ["LCX", 2027, 1], ["XX", 2025, 12345]] as const) {
      const parsed = parseReceiptNumber(formatReceiptNumber(prefix, year, seq))!;
      expect(parsed).toMatchObject({ prefix, yy: year % 100, seq });
    }
  });
});

describe("RECEIPT_CODE_PATTERN and normaliseReceiptCode (AC-4.2)", () => {
  it("the pattern is two or three upper-case letters", () => {
    for (const ok of ["AB", "LCX", "ZZ"]) expect(RECEIPT_CODE_PATTERN.test(ok)).toBe(true);
    for (const bad of ["A", "ABCD", "ab", "A1", "A B", "", "AB\n"]) expect(RECEIPT_CODE_PATTERN.test(bad)).toBe(false);
  });

  it("is invalid unless two or three letters a-z: A, ABCD, A1, ÀB, 'A B', ßA, and what is not text", () => {
    for (const bad of ["A", "ABCD", "A1", "ÀB", "A B", "ßA", "ß", "ab-", "1AB", "AB!", "ÀBC", "ＡＢ", "ab\ncd"]) {
      expect(normaliseReceiptCode(bad)).toEqual({ kind: "invalid" });
    }
    for (const notText of [undefined, 12, true, {}, ["LCX"]]) {
      expect(normaliseReceiptCode(notText)).toEqual({ kind: "invalid" });
    }
  });

  it("trims and upper-cases a valid code", () => {
    expect(normaliseReceiptCode(" lcx ")).toEqual({ kind: "code", code: "LCX" });
    expect(normaliseReceiptCode("Lc")).toEqual({ kind: "code", code: "LC" });
    expect(normaliseReceiptCode("ABC")).toEqual({ kind: "code", code: "ABC" });
    expect(normaliseReceiptCode("\tab\n")).toEqual({ kind: "code", code: "AB" });
  });

  it("an empty string, only blanks and null clear the code", () => {
    expect(normaliseReceiptCode("")).toEqual({ kind: "clear" });
    expect(normaliseReceiptCode("   ")).toEqual({ kind: "clear" });
    expect(normaliseReceiptCode(null)).toEqual({ kind: "clear" });
  });

  it("every normalised code satisfies the pattern", () => {
    for (const input of ["ab", " abc ", "XY"]) {
      const r = normaliseReceiptCode(input);
      expect(r.kind === "code" && RECEIPT_CODE_PATTERN.test(r.code)).toBe(true);
    }
  });
});
