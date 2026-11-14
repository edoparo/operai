import { describe, expect, test } from "bun:test";
import { isAllowedDomain, isReservedTestDomain, parseAllowedDomains } from "./allowedDomains";

const DOMAINS = ["welld.ch", "welld.it"];

describe("isAllowedDomain (specs/20261105-signup-gate AC-1.8)", () => {
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

describe("isReservedTestDomain (specs/20261105-signup-gate plan.md amendment 2026-11-05)", () => {
  const table: Array<[string, boolean]> = [
    ["operai.test", true],
    ["a.b.example", true],
    ["x.invalid", true],
    ["app.localhost", true],
    ["localhost", true],
    ["OPERAI.TEST", true],
    ["operai.test.", true],
    ["welld.ch.", false],
    ["welld.ch", false],
    ["welld.it", false],
    ["test.ch", false],
    ["mytest", false],
    ["example.com", false],
  ];
  for (const [domain, expected] of table) {
    test(`${domain} -> ${expected}`, () => expect(isReservedTestDomain(domain)).toBe(expected));
  }
});

describe("trailing-dot domains (specs/20261105-signup-gate T14)", () => {
  test("the parser rejects a trailing-dot entry, so operai.test. cannot slip past the reserved check", () => {
    expect(() => parseAllowedDomains("welld.ch,operai.test.")).toThrow();
    expect(() => parseAllowedDomains("welld.ch.")).toThrow();
  });
});
