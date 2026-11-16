import { describe, expect, it } from "bun:test";
import { MAX_TEMPLATE_CHARS, parseTemplate } from "./syntax";

/** specs/20261115-crm-offer-wizard R8: the parser runs in the browser on every change — linear, never throws. */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS = [
  "{{", "}}", "::", "{{?A::", "{{!A,B::", "{{blk::", "[", "]", "[FIELD]", "\\", "\\[", "\\|", "|", "\n", "\n\n", "\n## ", "## H\n",
  "@@OPT_START x\n", "@@OPT_START ?A,B\n", "@@OPT_END\n", "@@costs position unit\n", "@@line a one_off | d | unit=? | qty=1\n",
  "@@line b discount | d | unit=10%\n", "@@total T\n", "@@end\n", "@@annex A T\n", "@@annex\n", "@@subtitle s\n", "@@step costs\n",
  "@@field F\nlabel: l\n", "@@choice c\n", "@@salutation S\n", "@@effort-annex on\n", "☃", "", "⟦", "x", " ", "é", "𝄞", "@@", "#",
];

function randomText(random: () => number, pieces: number): string {
  let out = "";
  for (let i = 0; i < pieces; i++) out += FRAGMENTS[Math.floor(random() * FRAGMENTS.length)];
  return out;
}

function timed(source: string): number {
  const start = performance.now();
  const result = parseTemplate(source);
  const elapsed = performance.now() - start;
  expect(Array.isArray(result.problems)).toBe(true);
  expect(result.ast).toBeDefined();
  return elapsed;
}

describe("parseTemplate never throws and stays fast", () => {
  it("random text built from the grammar's own pieces", () => {
    const random = mulberry32(20261115);
    for (let i = 0; i < 300; i++) timed(randomText(random, 1 + Math.floor(random() * 200)));
  });

  it("random characters, huge", () => {
    const random = mulberry32(7);
    let source = "";
    while (source.length < MAX_TEMPLATE_CHARS) source += String.fromCharCode(Math.floor(random() * 0xffff));
    expect(timed(source.slice(0, MAX_TEMPLATE_CHARS))).toBeLessThan(200);
  });

  it("a huge input of the grammar's pieces just under the limit", () => {
    const random = mulberry32(99);
    let source = "";
    while (source.length < MAX_TEMPLATE_CHARS - 40) source += randomText(random, 50);
    expect(timed(source.slice(0, MAX_TEMPLATE_CHARS))).toBeLessThan(200);
  });

  it("deeply nested inline conditions on one line", () => {
    expect(timed("{{a::".repeat(MAX_TEMPLATE_CHARS / 5))).toBeLessThan(200);
    expect(timed("{{a::".repeat(30_000) + "}}".repeat(30_000))).toBeLessThan(200);
  });

  it("many `{{` with no `::` on a line (a quadratic scan would show here)", () => {
    expect(timed("{{".repeat(MAX_TEMPLATE_CHARS / 2))).toBeLessThan(200);
    expect(timed("{{ x ".repeat(MAX_TEMPLATE_CHARS / 5) + "::")).toBeLessThan(200);
  });

  it("deeply nested blocks, one per line", () => {
    expect(timed("@@OPT_START a\n".repeat(MAX_TEMPLATE_CHARS / 14))).toBeLessThan(200);
    expect(timed("@@OPT_START a\ntext\n".repeat(5_000) + "@@OPT_END\n".repeat(5_000))).toBeLessThan(200);
  });

  it("many sections, annexes, cost lines and declarations", () => {
    expect(timed("## H\n".repeat(MAX_TEMPLATE_CHARS / 5))).toBeLessThan(200);
    expect(timed("@@annex A T\n".repeat(MAX_TEMPLATE_CHARS / 12))).toBeLessThan(200);
    expect(timed("## C\n@@costs\n" + "@@line a one_off | d | unit=? | qty=1\n".repeat(4_000))).toBeLessThan(200);
    expect(timed("@@field F\nlabel: l\n\n".repeat(MAX_TEMPLATE_CHARS / 20))).toBeLessThan(200);
  });

  it("one huge line", () => {
    expect(timed("[A]".repeat(MAX_TEMPLATE_CHARS / 3))).toBeLessThan(200);
    expect(timed("\\".repeat(MAX_TEMPLATE_CHARS))).toBeLessThan(200);
    expect(timed("@@line " + "a | ".repeat(MAX_TEMPLATE_CHARS / 4))).toBeLessThan(200);
  });

  it("over the limit it refuses at once", () => {
    const result = parseTemplate("x".repeat(MAX_TEMPLATE_CHARS + 1));
    expect(result.problems).toEqual([{ line: 1, severity: "error", code: "too_large" }]);
  });

  it("empty input is a template with the structural problems only", () => {
    expect(parseTemplate("").problems.map((problem) => problem.code)).toEqual(["salutation_missing", "no_costs_section"]);
  });
});
