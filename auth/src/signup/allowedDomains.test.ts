import { describe, expect, test } from "bun:test";
import { isAllowedDomain, parseAllowedDomains } from "./allowedDomains";

const DOMAINS = ["welld.ch", "welld.it"];

describe("isAllowedDomain (specs/023 AC-1.8)", () => {
  const table: Array<[string, boolean]> = [
    ["Name@WellD.CH", true],
    ["a@welld.it", true],
    ["a@sub.welld.ch", false],
    ["a@welld.ch.example", false],
    ["a@xwelld.ch", false],
    ["welld.ch", false],
    ["a@b@welld.ch", true], // the part after the LAST @
    ["a@welld.ch@evil.com", false],
    ["", false],
    ["a@", false],
  ];
  for (const [email, expected] of table) {
    test(`${JSON.stringify(email)} -> ${expected}`, () => {
      expect(isAllowedDomain(email, DOMAINS)).toBe(expected);
    });
  }

  test("an empty list allows nobody", () => {
    expect(isAllowedDomain("a@welld.ch", [])).toBe(false);
  });
});

describe("parseAllowedDomains", () => {
  test("splits, trims and keeps a valid list", () => {
    expect(parseAllowedDomains("welld.ch, welld.it")).toEqual(["welld.ch", "welld.it"]);
  });
  for (const bad of ["", " ", "welld.ch,", ",welld.ch", "WellD.ch", "@welld.ch", "welld", "a b.ch", "welld.ch,,welld.it", "-x.ch", "x_y.ch"]) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => parseAllowedDomains(bad)).toThrow();
    });
  }
});
