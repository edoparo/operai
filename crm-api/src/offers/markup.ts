/**
 * The offer text markup of specs/20261102-crm-offer-document AC-1.6, parsed into blocks the contract
 * renderer lays out. Pure: no I/O, never throws — anything it does not
 * understand degrades to a paragraph. Placeholders are NOT resolved here (the
 * draft does it, D-9): a leftover `{...}` prints literally.
 *
 *   paragraphs      blank-line separated; a single newline is a line break
 *   - item  • item  bullets
 *   1. item  a. item  ordered lists, printed as written; nested by two spaces
 *   **bold**  *italic*  __underline__   combinable
 *   ### Title       sub-heading (numbered by the renderer)
 *   | a | b |       table, first row = header, `|---|` ignored, <br> in a cell
 */

export interface Run {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

export interface ListItem {
  /** "•", "1.", "a." — as written for ordered lists. */
  readonly marker: string;
  /** Grows when a continuation line follows the item. */
  runs: Run[];
  readonly children: Block[];
}

/** One line of a table cell; a bullet line starts with `- ` or `• ` in the source. */
export interface CellLine {
  readonly bullet: boolean;
  readonly runs: readonly Run[];
}

export type Block =
  | { readonly type: "paragraph"; readonly runs: readonly Run[] }
  | { readonly type: "heading"; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: ListItem[] }
  | {
      readonly type: "table";
      readonly header: readonly (readonly CellLine[])[];
      readonly rows: readonly (readonly (readonly CellLine[])[])[];
    };

// ─── Inline runs ─────────────────────────────────────────────────────────────

type Marker = "bold" | "italic" | "underline";

interface Token {
  readonly marker: Marker;
  readonly start: number;
  readonly length: number;
  valid: boolean;
}

/** `**`, `__` and `*` runs; an unpaired or space-padded marker stays literal. */
export function parseInline(source: string): Run[] {
  const tokens: Token[] = [];
  for (let i = 0; i < source.length; ) {
    if (source.startsWith("**", i)) {
      tokens.push({ marker: "bold", start: i, length: 2, valid: false });
      i += 2;
    } else if (source.startsWith("__", i)) {
      tokens.push({ marker: "underline", start: i, length: 2, valid: false });
      i += 2;
    } else if (source[i] === "*") {
      tokens.push({ marker: "italic", start: i, length: 1, valid: false });
      i += 1;
    } else {
      i += 1;
    }
  }

  // Pair openers with closers per marker; an opener needs a non-space after it,
  // a closer a non-space before it (so "2 * 3" stays literal).
  const open = new Map<Marker, Token>();
  for (const token of tokens) {
    const before = source[token.start - 1];
    const after = source[token.start + token.length];
    const opener = open.get(token.marker);
    if (opener && before !== undefined && !/\s/.test(before)) {
      opener.valid = true;
      token.valid = true;
      open.delete(token.marker);
    } else if (!opener && after !== undefined && !/\s/.test(after)) {
      open.set(token.marker, token);
    }
  }

  const state = { bold: false, italic: false, underline: false };
  const runs: Run[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) runs.push({ text: buffer, ...state });
    buffer = "";
  };
  let next = 0;
  for (let i = 0; i < source.length; i += 1) {
    const token = tokens[next];
    if (token && token.start === i) {
      next += 1;
      if (token.valid) {
        flush();
        state[token.marker] = !state[token.marker];
        i += token.length - 1;
        continue;
      }
    }
    buffer += source[i];
  }
  flush();
  return runs;
}

/** Joins the continuation lines of one paragraph or item with a line break. */
const inlineLines = (lines: readonly string[]): Run[] => parseInline(lines.map((line) => line.trim()).join("\n"));

// ─── Tables ──────────────────────────────────────────────────────────────────

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isTableLine = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);

const isSeparatorRow = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-{2,}:?$/.test(cell));

function parseCell(source: string): CellLine[] {
  return source
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const bullet = /^(-|•)\s+/.test(line);
      return { bullet, runs: parseInline(bullet ? line.replace(/^(-|•)\s+/, "") : line) };
    });
}

function parseTable(lines: readonly string[]): Block | null {
  const rows = lines.map(splitRow).filter((cells) => !isSeparatorRow(cells));
  if (rows.length === 0) return null;
  const columns = Math.max(...rows.map((cells) => cells.length));
  const normalised = rows.map((cells) => Array.from({ length: columns }, (_, i) => parseCell(cells[i] ?? "")));
  return { type: "table", header: normalised[0]!, rows: normalised.slice(1) };
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

const LIST_ITEM = /^(\s*)(?:(-|•)|(\d+|[a-z])\.)\s+(.*)$/;

interface Frame {
  readonly indent: number;
  readonly list: Extract<Block, { type: "list" }>;
  readonly container: Block[];
}

/** Parses an offer text into blocks. Never throws. */
export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n");

  let paragraph: string[] = [];
  let stack: Frame[] = [];
  let lastItem: ListItem | null = null;
  let tableLines: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", runs: inlineLines(paragraph) });
    paragraph = [];
  };
  const closeList = () => {
    stack = [];
    lastItem = null;
  };
  const closeTable = () => {
    if (tableLines.length === 0) return;
    const table = parseTable(tableLines);
    if (table) blocks.push(table);
    tableLines = [];
  };

  for (const line of lines) {
    if (tableLines.length > 0 && !isTableLine(line)) closeTable();

    if (line.trim() === "") {
      closeParagraph();
      closeList();
      continue;
    }
    if (isTableLine(line)) {
      closeParagraph();
      closeList();
      tableLines.push(line);
      continue;
    }
    const heading = /^\s*###\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      blocks.push({ type: "heading", text: parseInline(heading[1]!.trim()).map((run) => run.text).join("") });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      closeParagraph();
      const indent = item[1]!.length;
      const ordered = item[2] === undefined;
      const marker = ordered ? `${item[3]}.` : "•";
      while (stack.length > 0 && stack[stack.length - 1]!.indent > indent) stack.pop();
      let top = stack[stack.length - 1];
      if (top && top.indent === indent && top.list.ordered !== ordered) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      if (!top || top.indent < indent) {
        const container: Block[] = top && lastItem ? lastItem.children : blocks;
        const list: Frame["list"] = { type: "list", ordered, items: [] };
        container.push(list);
        stack.push({ indent, list, container });
        top = stack[stack.length - 1]!;
      }
      lastItem = { marker, runs: parseInline(item[4]!.trim()), children: [] };
      top.list.items.push(lastItem);
      continue;
    }
    if (lastItem && stack.length > 0) {
      // A non-marker line right after an item continues it, with a line break.
      lastItem.runs.push(...parseInline(`\n${line.trim()}`));
      continue;
    }
    paragraph.push(line);
  }
  closeParagraph();
  closeTable();
  return blocks;
}
