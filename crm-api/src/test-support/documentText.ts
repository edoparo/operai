/**
 * The text a wizard offer prints, derived from the engine and nothing else (specs/20261115-crm-offer-wizard T34;
 * AC-3.2, AC-9.5, DD-29, DD-47): `resolveOffer` for what the template says, `numberOffer` for every number and
 * letter, `computeCosts` for positions and span totals, `words` for the fixed document words. It is the ORACLE of
 * the preview ≡ PDF proof (`offers/parity.test.ts`: the renderer's draw log must equal it) and the printed text of
 * the fidelity test (`wizardSeeds/fidelity.test.ts`). It reads nothing from the renderer.
 *
 * Plain surfaces (headings, annex titles and subtitles, cost descriptions, total labels, column labels) carry the
 * marker characters U+E000–U+E003 unescaped; they are SPLIT OUT here by `plain`, never run through `parseInline`
 * (DD-47). Markup surfaces (the opening, section bodies, annex intros) go through `parseMarkup`, as the renderer's do.
 *
 * The result is a flat list of parts in READING order. Two flags carry what only a renderer's drawing order knows:
 * `trailing` (a list item's marker, drawn after the item's text) and `bullet` (a table cell line's "•", drawn after
 * its first line); `drawOrder` applies the first.
 */

import { computeCosts, type CostResult, type CostRowIn } from "../offers/engine/costs";
import { formatAmount, formatPercent, shortDate } from "../offers/engine/format";
import { parseMarkup, type Block, type CellLine, type Run } from "../offers/engine/markup";
import type { NumberedOffer } from "../offers/engine/numbering";
import { BALLOT_BOX, printable } from "../offers/engine/printable";
import type { ResolvedOffer } from "../offers/engine/resolve";
import { words } from "../offers/engine/words";
import { formatManDays } from "../offers/pdf";
import type { Scope } from "../offers/scope";

/** Where in the document a part sits: what the CRM draws itself, and what the template wrote. */
export type DocRegion = "header" | "index" | "body" | "acceptance" | "annexList" | "annex" | "effort";

export interface DocPart {
  readonly text: string;
  readonly region: DocRegion;
  /** The part's own kind, for the consumers that tell headings and cells apart. */
  readonly role?: "heading" | "subheading" | "annexHeading" | "cell" | "marker" | "listText";
  /** A list item's marker: the renderer draws it AFTER the item's first text (see `drawOrder`). */
  readonly trailing?: true;
  /** A table cell line that starts with a "•", drawn after the line's first drawn line. */
  readonly bullet?: true;
  /** An index entry: the renderer draws leader dots and a page number after it. */
  readonly index?: true;
  /** A table cell: which table of the document, its row (0 = header) and its column. */
  readonly cell?: DocCell;
}

/** A cost table's cells also say what kind of row they sit in. */
export interface DocCell {
  readonly table: number;
  readonly row: number;
  readonly col: number;
  readonly cost?: "header" | "one_off" | "yearly" | "discount" | "option" | "total";
}

export interface DocumentTextInput {
  readonly resolved: ResolvedOffer;
  readonly numbered: NumberedOffer;
  readonly costs: CostResult;
  readonly reference: string;
  readonly currency: "CHF" | "EUR";
  /** The effort detail the offer carries, or null. */
  readonly effort: Scope | null;
}

const MARKER_CHARACTERS = /[-]/g;
/** A plain surface with its marker characters split out (DD-47). */
export const plainText = (text: string): string => text.replace(MARKER_CHARACTERS, "");

const textOfRuns = (runs: readonly Run[]): string => printable(runs.map((run) => run.text).join(""));

interface Labels {
  readonly labels: readonly string[];
  taken: number;
}

class Builder {
  readonly parts: DocPart[] = [];
  private tables = 0;

  constructor(
    readonly region: () => DocRegion,
  ) {}

  add(text: string, extra: Partial<DocPart> = {}): void {
    this.parts.push({ text, region: this.region(), ...extra });
  }

  blocks(blocks: readonly Block[], labels: Labels | null): void {
    for (const block of blocks) {
      if (block.type === "paragraph") {
        this.add(textOfRuns(block.runs));
      } else if (block.type === "heading") {
        this.add(labels?.labels[labels.taken++] ?? printable(block.text.toUpperCase()), { role: "subheading" });
      } else if (block.type === "list") {
        for (const item of block.items) {
          const text = textOfRuns(item.runs);
          if (text.replace(/\s/g, "") !== "") {
            this.add(printable(item.marker), { role: "marker", trailing: true });
            this.add(text, { role: "listText" });
          }
          this.blocks(item.children, labels);
        }
      } else {
        const table = this.tables++;
        const rows = [block.header, ...block.rows];
        rows.forEach((row, rowIndex) =>
          row.forEach((lines, col) => this.cellLines(lines, { table, row: rowIndex, col })),
        );
      }
    }
  }

  private cellLines(lines: readonly CellLine[], cell: DocCell): void {
    for (const line of lines) {
      const text = textOfRuns(line.runs);
      if (text.replace(/\s/g, "") === "") continue;
      this.add(text, { role: "cell", cell, ...(line.bullet ? { bullet: true as const } : {}) });
    }
  }

  /** One cell of a table the document builds itself (cost table, effort table): "" draws nothing. */
  cell(text: string, cell: DocCell): void {
    if (text !== "") this.add(printable(text), { role: "cell", cell });
  }

  nextTable(): number {
    return this.tables++;
  }
}

/** `computeCosts`' input from the printed rows — the same rows the renderer is given. */
const costRowsIn = (resolved: ResolvedOffer): CostRowIn[] =>
  resolved.costs.rows.map((row) =>
    row.type === "total"
      ? { type: "total" as const, label: row.label }
      : { type: "line" as const, name: row.name, kind: row.kind, unitCents: row.unitCents, percentBp: row.percentBp, quantity: row.quantity },
  );

export const costsOf = (resolved: ResolvedOffer): CostResult => computeCosts(costRowsIn(resolved));

export function documentText(input: DocumentTextInput): DocPart[] {
  const { resolved, numbered, costs, reference, currency, effort } = input;
  const t = words(resolved.language);
  let region: DocRegion = "header";
  const b = new Builder(() => region);

  // — page 1: salutation, client, contacts, place and date, title —
  b.add(resolved.salutation);
  for (const line of resolved.client.lines) b.add(line);
  if (resolved.client.contacts.length > 0) b.add(`${t.attn} ${resolved.client.contacts.join(", ")}`);
  const date = shortDate(resolved.client.date ?? "");
  b.add(resolved.client.place ? `${resolved.client.place}, ${date}` : date);
  b.add(t.title(reference));

  // — the index, only with the effort-detail annex —
  region = "index";
  if (numbered.index) {
    b.add(t.index);
    for (const entry of numbered.index) b.add(entry.label, { index: true });
  }

  region = "body";
  b.blocks(parseMarkup(resolved.opening), null);

  // — sections —
  resolved.sections.forEach((section, index) => {
    const number = numbered.sections[index]!;
    b.add(number.heading, { role: "heading" });
    if (section.costs) costTable(b, resolved, costs, currency);
    b.blocks(parseMarkup(section.body), { labels: number.subheadings, taken: 0 });
  });

  // — acceptance —
  region = "acceptance";
  b.add(t.acceptance);
  if (resolved.acceptanceLabel) b.add(resolved.acceptanceLabel);
  b.add(t.place);
  b.add(t.signature);

  // — the list of annexes —
  region = "annexList";
  if (numbered.annexList.length > 0) {
    b.add(t.annexes);
    for (const entry of numbered.annexList) {
      b.add("•", { role: "marker" });
      b.add(entry);
    }
  }

  // — text annexes, each from a new page, in template order —
  region = "annex";
  resolved.annexes.forEach((annex, index) => {
    const number = numbered.annexes[index]!;
    b.add(number.heading, { role: "annexHeading" });
    const subtitle = annex.subtitle === null ? "" : plainText(annex.subtitle).trim();
    if (subtitle !== "") b.add(subtitle);
    b.blocks(parseMarkup(annex.intro), null);
    annex.sections.forEach((section, at) => {
      const inner = number.sections[at]!;
      b.add(inner.heading, { role: "heading" });
      b.blocks(parseMarkup(section.body), { labels: inner.subheadings, taken: 0 });
    });
  });

  // — the effort-detail annex —
  region = "effort";
  if (effort && numbered.effortAnnexLetter) {
    b.add(t.annexHeading(numbered.effortAnnexLetter), { role: "annexHeading" });
    if (effort.aiAssisted) b.add(t.aiNote);
    const table = b.nextTable();
    const days = (tenths: number) => formatManDays(tenths, resolved.language);
    let row = 0;
    b.cell(t.release, { table, row, col: 0 });
    b.cell(t.epic, { table, row, col: 1 });
    b.cell(t.manDays, { table, row, col: 2 });
    for (const release of effort.releases) {
      row += 1;
      b.cell(release.name, { table, row, col: 0 });
      b.cell(days(release.manDaysTenths), { table, row, col: 2 });
      for (const epic of release.epics) {
        row += 1;
        b.cell(epic.epic, { table, row, col: 1 });
        b.cell(days(epic.manDaysTenths), { table, row, col: 2 });
      }
    }
    row += 1;
    b.cell(t.annexTotal, { table, row, col: 0 });
    b.cell(days(effort.manDaysTenths), { table, row, col: 1 });
  }
  return b.parts;
}

/** The cost table of the offer: header, then lines and total rows in order, positions and span totals from the engine. */
function costTable(b: Builder, resolved: ResolvedOffer, result: CostResult, currency: "CHF" | "EUR"): void {
  const t = words(resolved.language);
  const { columns, labels, showTotals } = resolved.costs;
  const table = b.nextTable();
  let row = 0;
  const header: string[] = [
    ...(columns.position ? [t.position] : []),
    t.item,
    ...(columns.unit ? [labels.unit != null ? plainText(labels.unit) : t.unit(currency), labels.quantity != null ? plainText(labels.quantity) : t.quantity] : []),
    t.amount(currency),
  ];
  header.forEach((text, col) => b.cell(text, { table, row, col, cost: "header" }));

  resolved.costs.rows.forEach((source, index) => {
    const out = result.rows[index]!;
    if (source.type === "total") {
      if (!showTotals) return;
      row += 1;
      const amount = out.type === "total" && out.state === "ok" && out.totalCents !== null ? formatAmount(out.totalCents, currency) : "–";
      b.cell(plainText(source.label), { table, row, col: 0, cost: "total" });
      b.cell(amount, { table, row, col: header.length - 1, cost: "total" });
      return;
    }
    if (out.type !== "line") return;
    row += 1;
    const discount = source.kind === "discount";
    const percent = discount && source.percentBp !== null;
    const description = plainText(source.description);
    const base = source.kind === "option" ? `${BALLOT_BOX} ${description}` : description;
    const shown = percent && !columns.unit ? `${base} (${formatPercent(source.percentBp!)})` : base;
    const cells: string[] = [
      ...(columns.position ? [out.position === null ? "" : String(out.position)] : []),
      shown,
      ...(columns.unit
        ? [
            percent ? formatPercent(source.percentBp!) : source.unitCents === null ? "" : `${discount ? "- " : ""}${formatAmount(source.unitCents, currency)}`,
            percent ? "" : String(source.quantity ?? 1),
          ]
        : []),
      `${discount ? "- " : ""}${formatAmount(out.totalCents ?? 0, currency)}`,
    ];
    cells.forEach((text, col) => b.cell(text, { table, row, col, cost: source.kind }));
  });
}

/**
 * The parts in the order a renderer DRAWS them: a trailing list marker comes after the text it belongs to. The
 * strings are the same; only this order differs from reading order.
 */
export function drawOrder(parts: readonly DocPart[]): DocPart[] {
  const out: DocPart[] = [];
  let held: DocPart[] = [];
  for (const part of parts) {
    if (part.trailing) {
      held.push(part);
      continue;
    }
    out.push(part);
    if (part.text.replace(/\s/g, "") !== "" && held.length > 0) {
      out.push(...held);
      held = [];
    }
  }
  return [...out, ...held];
}

// ─── Comparing with a renderer's draw log ────────────────────────────────────────────

/** One string a renderer drew (`contractPdf`'s test hook): the page and the text. */
export interface DrawnString {
  readonly page: number;
  readonly text: string;
}

const squash = (text: string): string => text.replace(/\s+/g, "");

/**
 * Compares the parts, in the order a renderer draws them, with its draw log after whitespace and line-wrap
 * normalisation: a part may be drawn as several lines (their concatenation, spaces removed, is compared), blank lines
 * are ignored, and the log's decor is taken out first — the page numbers "n/N" the renderer writes last, and an index
 * entry's leader dots and page number. Returns what differs first, or null when they are equal.
 */
export function matchDrawLog(parts: readonly DocPart[], log: readonly DrawnString[]): string | null {
  const entries = log.map((entry) => entry.text);

  // The page numbers: the last N entries are "1/N" … "N/N".
  const last = /^(\d+)\/(\d+)$/.exec(entries[entries.length - 1] ?? "");
  if (!last) return "the draw log does not end with the page numbers";
  const pages = Number(last[2]);
  const numbers = entries.splice(entries.length - pages);
  for (const [index, entry] of numbers.entries()) {
    if (entry !== `${index + 1}/${pages}`) return `page number ${index + 1} is "${entry}", expected "${index + 1}/${pages}"`;
  }

  let at = 0;
  const next = (): string | undefined => entries[at++];
  const ordered = drawOrder(parts).filter((part) => squash(part.text) !== "");
  // A table that breaks across pages repeats its header row before the first row on the new page.
  const headers = new Map<number, string>();
  for (const part of ordered) if (part.cell?.row === 0) headers.set(part.cell.table, (headers.get(part.cell.table) ?? "") + squash(part.text));
  let previous: DocPart | null = null;
  for (const [number, part] of ordered.entries()) {
    const startsRow = part.cell !== undefined && part.cell.row >= 1 && (previous?.cell?.table !== part.cell.table || previous.cell.row !== part.cell.row);
    const header = startsRow ? headers.get(part.cell!.table) : undefined;
    if (header) {
      let probe = at;
      let seen = "";
      while (seen.length < header.length && probe < entries.length) seen += squash(entries[probe++]!);
      const broke = at > 0 && log[at] !== undefined && log[at - 1] !== undefined && log[at]!.page > log[at - 1]!.page;
      if (seen === header && broke) at = probe;
    }
    previous = part;
    const want = squash(part.text);
    let got = "";
    let bulletSeen = false;
    let taken = 0;
    while (got.length < want.length) {
      const entry = next();
      if (entry === undefined) return `part ${number} "${part.text}": the draw log ended after "${got}"`;
      if (part.bullet && !bulletSeen && taken > 0 && entry === "•") {
        bulletSeen = true;
        continue;
      }
      taken += 1;
      got += squash(entry);
      if (!want.startsWith(got)) return `part ${number} "${part.text}": drew "${entry}" after "${got.slice(0, got.length - squash(entry).length)}"`;
    }
    if (got !== want) return `part ${number} "${part.text}": drew "${got}"`;
    if (part.bullet && !bulletSeen) {
      const bullet = next();
      if (bullet !== "•") return `part ${number} "${part.text}": no bullet after it, saw "${bullet ?? "(end)"}"`;
    }
    if (part.index) {
      let after = entries[at];
      if (after !== undefined && /^\.+$/.test(after)) {
        at += 1;
        after = entries[at];
      }
      if (after === undefined || !/^\d+$/.test(after)) return `part ${number} "${part.text}": no page number after the index entry, saw "${after ?? "(end)"}"`;
      at += 1;
    }
  }
  // Blank lines may remain; anything else is something the document text does not account for.
  const rest = entries.slice(at).filter((entry) => squash(entry) !== "");
  return rest.length > 0 ? `the renderer drew more than the document text: "${rest[0]}" (+${rest.length - 1})` : null;
}
