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
 *
 * specs/20261115-crm-offer-wizard (T2) adds, and nothing else:
 *   \[ \* \_ \| \{ \\   a backslash before one of these is that character, literally; a
 *                    backslash before a line-start marker (`- • 1. a. ###`) makes the line plain
 *                    text — the resolver escapes every answer it inserts, so a value never becomes markup
 *   U+E000 label U+E001 / U+E002 label U+E003   a run with mark "missing" / "pending", its text
 *                    the label, literal inside (no emphasis, no escapes)
 * A backslash before anything else stays a literal backslash, as before.
 *
 * Shared with the CRM UI: byte-identical copy (scripts/check-shared-copies.ts, group offerEngine.markup).
 */
// shared-copy:begin offerEngine.markup

/**
 * The reference token (specs/20261115-crm-offer-wizard DD-52): U+27EA "R" "E" "F" U+27EB. A hand-edited body holds
 * it where the offer's reference belongs; generation fills it, and nothing else in the suite writes these brackets
 * (`printable` maps them to "?", a template or an answer containing one is `reserved_character`). The one place the
 * literal is spelled: `resolve.ts`, `edit.ts` and `answers.ts` import it.
 */
export const REFERENCE_TOKEN = "⟪REF⟫";

export interface Run {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  /** Only on a marker run: a value the person still has to give, or the reference assigned at generation. */
  readonly mark?: "missing" | "pending";
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

const MARK_OPEN = { "\uE000": ["\uE001", "missing"], "\uE002": ["\uE003", "pending"] } as const;
const ESCAPABLE = "[*_|{\\";

/**
 * The text with its escapes removed, plus which positions are literal (escaped, or inside a marker run)
 * and which marker runs it holds. A marker character without its partner is dropped.
 */
function unescape(source: string): { plain: string; literal: boolean[]; marks: Map<number, { end: number; mark: "missing" | "pending" }> } {
  let plain = "";
  const literal: boolean[] = [];
  const marks = new Map<number, { end: number; mark: "missing" | "pending" }>();
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    const open = MARK_OPEN[char as keyof typeof MARK_OPEN];
    if (open) {
      const close = source.indexOf(open[0], i + 1);
      if (close !== -1) {
        const start = plain.length;
        plain += char;
        literal.push(true);
        for (let j = i + 1; j < close; j += 1) {
          plain += source[j]!;
          literal.push(true);
        }
        plain += open[0];
        literal.push(true);
        marks.set(start, { end: plain.length - 1, mark: open[1] });
        i = close;
      }
      continue; // an opener without its closer is dropped
    }
    if (char === "\uE001" || char === "\uE003") continue; // a closer without its opener
    if (char === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1]!)) {
      plain += source[i + 1]!;
      literal.push(true);
      i += 1;
      continue;
    }
    plain += char;
    literal.push(false);
  }
  return { plain, literal, marks };
}

/** `**`, `__` and `*` runs; an unpaired or space-padded marker stays literal. */
export function parseInline(raw: string): Run[] {
  const { plain: source, literal, marks } = unescape(raw);
  const tokens: Token[] = [];
  for (let i = 0; i < source.length; ) {
    const mark = marks.get(i);
    if (mark) {
      i = mark.end + 1;
    } else if (literal[i]) {
      i += 1;
    } else if (source.startsWith("**", i) && !literal[i + 1]) {
      tokens.push({ marker: "bold", start: i, length: 2, valid: false });
      i += 2;
    } else if (source.startsWith("__", i) && !literal[i + 1]) {
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
    const mark = marks.get(i);
    if (mark) {
      flush();
      runs.push({ text: source.slice(i + 1, mark.end), ...state, mark: mark.mark });
      i = mark.end;
      continue;
    }
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

/** Positions of the `|` that delimit cells: not escaped (`\\|`), not inside a marker run. */
function pipePositions(line: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    const open = MARK_OPEN[char as keyof typeof MARK_OPEN];
    if (open) {
      const close = line.indexOf(open[0], i + 1);
      if (close !== -1) i = close;
    } else if (char === "\\" && i + 1 < line.length && ESCAPABLE.includes(line[i + 1]!)) {
      i += 1;
    } else if (char === "|") {
      positions.push(i);
    }
  }
  return positions;
}

const splitRow = (line: string): string[] => {
  const text = line.trim();
  const pipes = pipePositions(text);
  const first = pipes[0] === 0 ? 1 : 0;
  const end = pipes[pipes.length - 1] === text.length - 1 && text.length > first ? text.length - 1 : text.length;
  const cuts = pipes.filter((position) => position >= first && position < end);
  const cells: string[] = [];
  let from = first;
  for (const cut of cuts) {
    cells.push(text.slice(from, cut).trim());
    from = cut + 1;
  }
  cells.push(text.slice(from, end).trim());
  return cells;
};

const isTableLine = (line: string): boolean => {
  const text = line.trim();
  if (text.length < 2) return false;
  const pipes = pipePositions(text);
  return pipes[0] === 0 && pipes[pipes.length - 1] === text.length - 1 && pipes.length >= 2;
};

const isSeparatorRow = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-{2,}:?$/.test(cell));

function parseCell(source: string): CellLine[] {
  return source
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (/^\\[-•]/.test(line)) return { bullet: false, runs: parseInline(line.slice(1)) };
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
/** A backslash before a line-start marker: the line is plain text (the resolver escapes answers this way). */
const ESCAPED_LINE_START = /^(\s*)\\(?=[-•#]|\d+\.|[a-z]\.)/;

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
      lastItem.runs.push(...parseInline(`\n${line.replace(ESCAPED_LINE_START, "$1").trim()}`));
      continue;
    }
    paragraph.push(line.replace(ESCAPED_LINE_START, "$1"));
  }
  closeParagraph();
  closeTable();
  return blocks;
}
// shared-copy:end offerEngine.markup
