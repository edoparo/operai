import { describe, expect, it } from "bun:test";
import { parseInline, parseMarkup } from "./markup";

const text = (runs: readonly { text: string }[]) => runs.map((r) => r.text).join("");

/** specs/20261102-crm-offer-document AC-1.6: the offer text markup. */
describe("parseMarkup", () => {
  it("splits paragraphs on blank lines and keeps a single newline as a line break", () => {
    const blocks = parseMarkup("one\ntwo\n\nthree");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(text((blocks[0] as unknown as { runs: { text: string }[] }).runs)).toBe("one\ntwo");
  });

  it("parses bullets with both markers", () => {
    const [list] = parseMarkup("- a\n• b");
    expect(list).toMatchObject({ type: "list", ordered: false });
    const items = (list as { items: { marker: string; runs: { text: string }[] }[] }).items;
    expect(items.map((i) => [i.marker, text(i.runs)])).toEqual([
      ["•", "a"],
      ["•", "b"],
    ]);
  });

  it("prints ordered markers as written, numeric and lettered", () => {
    const [numbered, lettered] = parseMarkup("1. x\n2. y\n\na. p\nb. q");
    expect((numbered as { items: { marker: string }[] }).items.map((i) => i.marker)).toEqual(["1.", "2."]);
    expect((lettered as { items: { marker: string }[] }).items.map((i) => i.marker)).toEqual(["a.", "b."]);
  });

  it("nests lists by two-space indentation and returns to the parent", () => {
    const [list] = parseMarkup("a. one\nb. two\n  a. inner\n  b. inner2\nc. three");
    const items = (list as { items: { marker: string; children: { items: { marker: string }[] }[] }[] }).items;
    expect(items.map((i) => i.marker)).toEqual(["a.", "b.", "c."]);
    expect(items[1]!.children).toHaveLength(1);
    expect(items[1]!.children[0]!.items.map((i) => i.marker)).toEqual(["a.", "b."]);
    expect(items[2]!.children).toHaveLength(0);
  });

  it("nests a bullet list under an ordered item", () => {
    const [list] = parseMarkup("1. top\n  - sub");
    const item = (list as { items: { children: { type: string; ordered: boolean }[] }[] }).items[0]!;
    expect(item.children[0]).toMatchObject({ type: "list", ordered: false });
  });

  it("continues a list item on a following plain line", () => {
    const [list] = parseMarkup("- first\nsecond line");
    const item = (list as { items: { runs: { text: string }[] }[] }).items[0]!;
    expect(text(item.runs)).toBe("first\nsecond line");
  });

  it("parses sub-headings without the marker and strips emphasis", () => {
    expect(parseMarkup("### Altre **condizioni**")).toEqual([{ type: "heading", text: "Altre condizioni" }]);
  });

  it("parses a table: first row is the header, the separator row is ignored, <br> breaks a cell", () => {
    const [table] = parseMarkup("| Funzione | Dettaglio |\n|---|---|\n| Login | - SSO<br>- Password |\n| Report | PDF |");
    const t = table as unknown as {
      type: string;
      header: { runs: { text: string }[] }[][];
      rows: { bullet: boolean; runs: { text: string }[] }[][][];
    };
    expect(t.type).toBe("table");
    expect(text(t.header[0]![0]!.runs)).toBe("Funzione");
    expect(t.rows).toHaveLength(2);
    const cellLines = t.rows[0]![1]!;
    expect(cellLines.map((l) => [l.bullet, text(l.runs)])).toEqual([
      [true, "SSO"],
      [true, "Password"],
    ]);
  });

  it("pads short table rows to the header width", () => {
    const [table] = parseMarkup("| a | b | c |\n| 1 |");
    expect((table as unknown as { rows: unknown[][] }).rows[0]).toHaveLength(3);
  });

  it("degrades malformed input to paragraphs and never throws", () => {
    for (const source of ["| not a table", "**unclosed bold", "* lone star", "###", "- ", "1.x", "\u0000\t\r\n", "||", "|---|"]) {
      expect(() => parseMarkup(source)).not.toThrow();
    }
    expect(parseMarkup("| not a table")[0]).toMatchObject({ type: "paragraph" });
    expect(parseMarkup("")).toEqual([]);
  });

  it("leaves unresolved placeholders literal", () => {
    const [p] = parseMarkup("Totale {manDays} giorni");
    expect(text((p as unknown as { runs: { text: string }[] }).runs)).toBe("Totale {manDays} giorni");
  });
});

describe("parseInline", () => {
  it("parses bold, italic and underline", () => {
    expect(parseInline("a **b** *c* __d__ e")).toEqual([
      { text: "a ", bold: false, italic: false, underline: false },
      { text: "b", bold: true, italic: false, underline: false },
      { text: " ", bold: false, italic: false, underline: false },
      { text: "c", bold: false, italic: true, underline: false },
      { text: " ", bold: false, italic: false, underline: false },
      { text: "d", bold: false, italic: false, underline: true },
      { text: " e", bold: false, italic: false, underline: false },
    ]);
  });

  it("combines runs", () => {
    const runs = parseInline("**bold __and underlined__ still bold**");
    expect(runs.map((r) => [r.text, r.bold, r.underline])).toEqual([
      ["bold ", true, false],
      ["and underlined", true, true],
      [" still bold", true, false],
    ]);
    expect(parseInline("***both***")).toEqual([{ text: "both", bold: true, italic: true, underline: false }]);
  });

  it("keeps unpaired and space-padded markers literal", () => {
    expect(text(parseInline("2 * 3 = 6"))).toBe("2 * 3 = 6");
    expect(text(parseInline("**open"))).toBe("**open");
    expect(parseInline("a ** b")[0]!.bold).toBe(false);
  });
});
