/**
 * The answers turned into the document (specs/20261115-crm-offer-wizard AC-1.5, AC-1.7, AC-2.2, AC-3.3, AC-4.2,
 * AC-4.5, AC-10.1; DD-5, DD-22, DD-29): `resolveOffer` reads the template tree and the answers and returns what
 * the preview draws and the PDF prints — the opening, the printed sections and annexes as 018 markup, the cost
 * table's rows, and what is still missing.
 *
 * Rules the resolver keeps:
 *
 *   conditions   an inline `{{…}}` or a block `@@OPT_START` prints its text when its condition holds: a block is
 *                on (`answers.blocks`), a field/list/table is filled (`?`) or none is (`!`).
 *   escaping     an answer is escaped before it enters markup — `\ [ * _ | {` anywhere, a line-start marker at a
 *                line start (and a cell start in a table row), newlines folded to what the line can hold — so a
 *                value never becomes markup (DD-5). It first goes through `printable` (DD-22), so the preview
 *                shows what the PDF prints. Template text goes through `printable` too.
 *   markers      a value the person still owes is `U+E000 label U+E001` ("missing"), the offer reference before
 *                it is assigned `U+E002 label U+E003` ("pending"); `markup.ts` reads them as marked runs. A plain
 *                surface (a heading, an annex title, a cost description) carries the same marker characters in
 *                its text — split them on the four characters, never run `parseInline` over a plain surface.
 *   lists/tables a line that names a list (or a column of a repeatable table) is printed once per non-empty
 *                item (row), in the answers' order; a list or table with nothing in it is missing once, where
 *                the line names it. Of a table row only the key column and the columns a cost line uses as unit
 *                or quantity are required.
 *   derived      a `compute:` field is computed from the answers; a field whose every use sits in an off block
 *                counts 0; an empty input makes the result empty; a derived field is never missing.
 *   dropping     a line left with no text (every part conditional and off), a sub-heading with nothing under it,
 *                a section or annex with nothing printed are not part of the result, so numbering follows what
 *                prints.
 *
 * Pure: no I/O, no clock (the day comes in `WizardContext.today`), no `Intl`. Never throws on a well-typed tree.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.resolve).
 */
// shared-copy:begin offerEngine.resolve
import type { OfferLanguage, WizardAnswers, WizardContext } from "./answers";
import { evaluateCompute } from "./compute";
import { computeCosts, MAX_CENTS, type CostResult, type CostRowIn } from "./costs";
import { formatAmount, formatNumber, shortDate } from "./format";
import { outline, type OutlineItem } from "./outline";
import { REFERENCE_TOKEN } from "./markup";
import { printable } from "./printable";
import type { BodyLine, Cond, CostLineAst, CostsAst, FieldDecl, FieldKind, Inline, ListDecl, SectionAst, StepKey, SystemSource, TableDecl, TemplateAst } from "./syntax";

/** One place the person must go: `name` is the focus target (a field, a list/table, `TAB#<rowId>.COL`, `cost:<key>`, `section:<key>`). */
export interface Issue {
  name: string;
  /** The template's label — never an answer's value; null for an extra cost line and for `cost:*`. */
  label: string | null;
  step: StepKey;
}

export type InvalidCode =
  | "out_of_range"
  | "not_integer"
  | "not_a_number"
  | "date_out_of_range"
  | "not_an_option"
  | "discounts_exceed_span"
  | "discounts_exceed_one_off"
  | "discount_without_base"
  | "percent_discount_multi_total"
  | "cost_total_too_large"
  | "too_many_cost_lines"
  | "no_counted_line"
  | "heading_too_long"
  | "section_too_long";

export type InvalidIssue = Issue & { code: InvalidCode };

/** A printed cost row: what `computeCosts` takes, and for a line its description (plain text, markers possible). */
export type ResolvedCostRow = (Extract<CostRowIn, { type: "line" }> & { description: string }) | Extract<CostRowIn, { type: "total" }>;

export interface ResolvedSection {
  /** The template's key: heading source text + "#" + occurrence index. */
  key: string;
  /** Plain text. */
  heading: string;
  /** 018 markup. */
  body: string;
  costs: boolean;
  step: StepKey;
  handEdited: boolean;
  /** Field, list, table and block names the section reads (AC-5.2). */
  uses: string[];
}

export interface ResolvedAnnex {
  designation: string;
  title: string;
  subtitle: string | null;
  /** The lines between the annex's start and its first section, as 018 markup ("" when none). */
  intro: string;
  sections: ResolvedSection[];
}

export interface ResolvedOffer {
  language: OfferLanguage;
  salutation: string;
  acceptanceLabel: string | null;
  /** `date` is the printed date: the person's, else `context.today`. */
  client: { lines: string[]; contacts: string[]; place: string; date: string | null };
  opening: string;
  sections: ResolvedSection[];
  annexes: ResolvedAnnex[];
  costs: {
    rows: ResolvedCostRow[];
    result: CostResult;
    columns: { position: boolean; unit: boolean };
    labels: { unit: string | null; quantity: string | null };
    showTotals: boolean;
  };
  effortAnnex: boolean;
  validityDays: number;
  aiAssisted: boolean;
  attachmentIds: string[];
  missing: Issue[];
  invalid: InvalidIssue[];
  /**
   * The sources of the system fields read while building PRINTED text that the wizard wrote — a field printed or a
   * condition naming one, in a section, an annex, a heading, a cost line — sorted and unique (DD-58). A section the
   * person edited by hand is stored text and reads nothing; neither does an off block or a condition that fails.
   * The screens use it to say "this offer prints the issuer's address" (AC-12.12, AC-12.13).
   */
  systemRead: SystemSource[];
}

/** The text of a section as the hand-edit dialog starts from it (edit.ts). */
export interface SectionText {
  heading: string;
  body: string;
  tokens: { name: string; label: string }[];
}

const MISSING_OPEN = "";
const MISSING_CLOSE = "";
const PENDING_OPEN = "";
const PENDING_CLOSE = "";
const TOKEN_OPEN = "⟦";
const TOKEN_CLOSE = "⟧";

/** Sources the Client step edits; an issue about one goes there. */
const ESTIMATE_SOURCES: readonly string[] = ["deal", "epics", "phases", "timeline", "manDays"];
const CLIENT_SOURCES: readonly string[] = ["client", "clientAddress", "contacts", "place", "date", "reference", "issuer", "issuerAddress", "currency"];

type Surface = "markup" | "plain" | "stripped";
type Mode = "markers" | "tokens";

interface Raised {
  kind: "missing" | "pending" | "invalid";
  name: string;
  /** null for an extra cost line and `cost:*`. */
  label: string | null;
  step: StepKey;
  code?: InvalidCode;
}

type Value = { kind: "text"; text: string; invalid?: Raised } | { kind: "missing"; raised: Raised } | { kind: "pending"; raised: Raised };

interface Scope {
  /** What a repeated line binds: a list item under the list's name, a table row's cells under the column names. */
  values: ReadonlyMap<string, string | number | undefined>;
  row: { table: TableDecl; id: string } | null;
  /** A repeated line whose list or table has nothing in it. */
  emptyList: ListDecl | null;
  emptyTable: TableDecl | null;
}

const ROOT: Scope = { values: new Map(), row: null, emptyList: null, emptyTable: null };

interface OutLine {
  text: string;
  raised: Raised[];
  heading: boolean;
}

/** A supplied value on one line (DD-57): every line break, and the blanks around it, becomes one space. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** The sources the CRM supplies and the wizard never asks: a blank one prints nothing and is never missing (AC-12.7, AC-12.12). */
const isSupplied = (source: string | null): boolean => source === "issuer" || source === "issuerAddress";

const isBlank = (value: string | number | null | undefined): boolean => value === undefined || value === null || String(value).trim() === "";

/** Template markup stripped for a plain label: `**x**` → `x`, `\*` → `*`. */
const stripMarkup = (text: string): string => text.replace(/\\([\s\S])|\*\*|__|\*/g, (_match, escaped: string | undefined) => escaped ?? "");

const escapeChars = (text: string): string => text.replace(/[\\[*_|{]/g, "\\$&");

/** The line of `buffer` being written. */
const currentLine = (buffer: string): string => buffer.slice(buffer.lastIndexOf("\n") + 1);

function lineKind(prefix: string): "plain" | "list" | "table" | "heading" {
  const text = prefix.trimStart();
  if (text.startsWith("|")) return "table";
  if (/^#{1,6}(\s|$)/.test(text)) return "heading";
  if (/^(?:[-•]|\d+\.|[a-z]\.)(\s|$)/.test(text)) return "list";
  return "plain";
}

/** True when nothing but blanks stands between the last unescaped pipe (or the line start) and the end of `prefix`. */
function atCellStart(prefix: string): boolean {
  let last = -1;
  for (let index = 0; index < prefix.length; index++) {
    const char = prefix[index]!;
    if (char === "\\") {
      index += 1;
    } else if (char === MISSING_OPEN || char === PENDING_OPEN) {
      const close = prefix.indexOf(char === MISSING_OPEN ? MISSING_CLOSE : PENDING_CLOSE, index + 1);
      if (close !== -1) index = close;
    } else if (char === "|") {
      last = index;
    }
  }
  return prefix.slice(last + 1).trim() === "";
}

/** A line start in a value: a backslash before a marker the markup would read. A cell start knows only the bullets. */
function escapeStart(line: string, cell: boolean): string {
  return line.replace(cell ? /^(\s*)(?=[-•])/ : /^(\s*)(?=[-•#]|\d+\.|[a-z]\.)/, "$1\\");
}

/**
 * An answer as markup: printable, trimmed, escaped (DD-5). The line it lands in (`prefix`) says what the line can
 * hold: a table row or a heading one line, a list item no blank line; a first line at a line or cell start has its
 * marker escaped.
 */
function escapeValue(text: string, prefix: string): string {
  const kind = lineKind(prefix);
  let value = printable(text).replace(/\r\n?/g, "\n").trim();
  if (kind === "table") value = value.replace(/<br\s*\/?>/gi, " ").replace(/\s*\n\s*/g, " ");
  else if (kind === "heading") value = value.replace(/\s*\n\s*/g, " ");
  else if (kind === "list") value = value.replace(/\n(?:[ \t]*\n)+/g, "\n");
  else value = value.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
  const lineStart = prefix.trim() === "";
  const cellStart = kind === "table" && atCellStart(prefix);
  return value
    .split("\n")
    .map((line, index) => {
      const escaped = escapeChars(line);
      if (index > 0) return escapeStart(escaped, false);
      if (kind === "table") return cellStart ? escapeStart(escaped, true) : escaped;
      return lineStart ? escapeStart(escaped, false) : escaped;
    })
    .join("\n");
}

const plainValue = (text: string): string => printable(text).replace(/\s*\n\s*/g, " ").trim();

function realDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

interface Present {
  empty: boolean;
  text: string;
}

/** A stored answer of a kind as the document prints it. */
function present(kind: FieldKind, raw: string | number | null | undefined, language: OfferLanguage, currency: "CHF" | "EUR"): Present {
  if (isBlank(raw)) return { empty: true, text: "" };
  const text = String(raw).trim();
  switch (kind) {
    case "number":
    case "percentage":
      return { empty: false, text: /^-?\d+(\.\d+)?$/.test(text) ? formatNumber(text, language) : text };
    case "amount": {
      const cents = typeof raw === "number" ? raw : /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
      return { empty: false, text: Number.isInteger(cents) ? formatAmount(cents, currency) : text };
    }
    case "date":
      return { empty: false, text: realDate(text) ? shortDate(text) : text };
    default:
      return { empty: false, text };
  }
}

const MAX_QUANTITY = 100_000;
/** Limits of a hand-edited section (specs/20261102-crm-offer-document AC-3.3, AC-5.4). */
const MAX_EDIT_HEADING = 120;
const MAX_EDIT_BODY = 20_000;
/**
 * What a unit may hold while it is built: the limit plus room for the characters `assemble` takes out again (blank
 * runs, trailing blanks, a dropped sub-heading). A unit that stays under this and prints over `MAX_EDIT_BODY` is
 * reported by its final length; one that reaches it stops being built (bounded work and memory, QE D1).
 */
const MAX_BUILD = MAX_EDIT_BODY + 1_000;
const MAX_BASIS_POINTS = 10_000;
const MAX_DATE_DISTANCE_DAYS = 90;

/** Why an answer of a kind is not acceptable, or null (AC-3.6, DD-18, DD-38). A derived field is checked as its kind too. */
function checkValue(kind: FieldKind, raw: string | number, options: readonly string[] | null): InvalidCode | null {
  const text = String(raw).trim();
  switch (kind) {
    case "number":
    case "percentage": {
      if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) return "not_a_number";
      const value = Number(text);
      return kind === "percentage" && (value < 0 || value > 100) ? "out_of_range" : null;
    }
    case "amount": {
      const value = typeof raw === "number" ? raw : /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
      if (Number.isNaN(value)) return "not_a_number";
      if (!Number.isInteger(value)) return "not_integer";
      return value < 0 || value > MAX_CENTS ? "out_of_range" : null;
    }
    case "date":
      return realDate(text) && text >= "1900-01-01" && text <= "2200-12-31" ? null : "date_out_of_range";
    default:
      return options !== null && !options.includes(String(raw)) ? "not_an_option" : null;
  }
}

/** Days since 1970-01-01 of a real `YYYY-MM-DD`: a function of its input, no clock. */
const dayNumber = (iso: string): number => {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};

export interface ResolveOptions {
  /** The offer's reference once assigned: `source: reference` prints it instead of the pending marker. */
  reference?: string | null;
  /** `tokens`: a missing value and the pending reference print as "⟦Label⟧" (the hand-edit dialog's text, DD-30). */
  mode?: Mode;
}

class Resolver {
  readonly ast: TemplateAst;
  readonly answers: WizardAnswers;
  readonly context: WizardContext;
  readonly reference: string | null;
  readonly mode: Mode;
  readonly fields: Map<string, FieldDecl>;
  readonly lists: Map<string, ListDecl>;
  readonly tables: Map<string, TableDecl>;
  readonly columnOf = new Map<string, TableDecl>();
  readonly itemStep = new Map<string, StepKey>();
  readonly inactive = new Set<string>();
  readonly requiredColumns = new Set<string>();
  readonly costsAst: CostsAst | null;
  private readonly derived = new Map<string, string | null>();
  private readonly deriving = new Set<string>();
  /** Characters the unit being built (a section, the opening, an annex's head) holds so far, and whether it hit `MAX_BUILD`. */
  private used = 0;
  private over = false;
  /** The sources of system fields read so far (DD-58); off while a hand-edited section's own conditions are decided. */
  private readonly read = new Set<SystemSource>();
  private recording = true;

  readonly missing = new Map<string, Issue>();
  readonly invalid = new Map<string, InvalidIssue>();
  /** The label of each cost line seen, by its key (for the errors `computeCosts` names). */
  readonly lineLabels = new Map<string, string>();
  readonly tokens: { name: string; label: string }[] = [];

  // Plain fields, not parameter properties: crm-ui compiles with `erasableSyntaxOnly` (T14, DD-51).
  constructor(ast: TemplateAst, answers: WizardAnswers, context: WizardContext, reference: string | null, mode: Mode) {
    this.ast = ast;
    this.answers = answers;
    this.context = context;
    this.reference = reference;
    this.mode = mode;
    this.fields = new Map(ast.fields.map((field) => [field.name, field]));
    this.lists = new Map(ast.lists.map((list) => [list.name, list]));
    this.tables = new Map(ast.tables.map((table) => [table.name, table]));
    for (const table of ast.tables) for (const column of table.columns) if (!this.columnOf.has(column)) this.columnOf.set(column, table);
    this.costsAst = ast.sections.find((section) => section.costs !== null)?.costs ?? null;
    for (const item of this.costsAst?.items ?? []) {
      if (item.type !== "line") continue;
      if (item.unit.type === "field") this.requiredColumns.add(item.unit.name);
      if (item.qty?.type === "field") this.requiredColumns.add(item.qty.name);
    }

    // where each item is asked, and which fields no shown occurrence reaches (they count 0 in a derived field)
    const shown = new Set<string>();
    const walk = (items: readonly OutlineItem[], step: StepKey, into: Set<string> | null): void => {
      for (const item of items) {
        if (item.type === "costTable") continue;
        if (into) into.add(item.name);
        else this.itemStep.set(item.name, step);
        if (item.type === "block") walk(item.children, step, into);
      }
    };
    for (const step of outline(ast, answers).steps) {
      walk(step.items, step.key, null);
      walk(step.items, step.key, shown);
    }
    const every = new Set<string>();
    for (const step of outline(ast, null).steps) walk(step.items, step.key, every);
    for (const name of every) if (!shown.has(name)) this.inactive.add(name);
  }

  // ─── Values ───────────────────────────────────────────────────────────────────

  private stepOf(name: string): StepKey {
    const known = this.itemStep.get(name);
    if (known !== undefined) return known;
    const source = this.fields.get(name)?.source;
    return source && CLIENT_SOURCES.includes(source) ? "client" : "scope";
  }

  private missingValue(name: string, label: string, stepName = name): Value {
    return { kind: "missing", raised: { kind: "missing", name, label, step: this.stepOf(stepName) } };
  }

  /** The printed date (DD-16): the person's, else the day the wizard runs. */
  printedDate(): string {
    return this.answers.client.date ?? this.context.today;
  }

  private contactNames(): string[] {
    const names: string[] = [];
    for (const id of this.answers.client.contactIds) {
      const contact = this.context.contacts.find((candidate) => candidate.id === id);
      if (contact) names.push(contact.name);
    }
    return names;
  }

  /** The stored (or system) answer of a field, not yet formatted. */
  private rawValue(field: FieldDecl): string | number | null | undefined {
    const { answers, context } = this;
    switch (field.source) {
      case "client":
        return answers.client.lines[0] ?? "";
      case "clientAddress":
        return answers.client.lines.slice(1).join(", ");
      case "contacts":
        return this.contactNames().join(", ");
      case "place":
        return answers.client.place;
      case "date":
        return this.printedDate();
      case "issuer":
        return oneLine(context.issuerLegalName);
      case "issuerAddress":
        return context.issuerAddressLines
          .map(oneLine)
          .filter((line) => line !== "")
          .join(", ");
      case "currency":
        return context.currency;
      case "validityDays":
        return String(answers.validityDays);
      default:
        return field.compute ? this.derivedValue(field) : answers.fields[field.name];
    }
  }

  private effectiveKind(field: FieldDecl): FieldKind {
    if (field.source === "date") return "date";
    if (field.source === "validityDays") return "number";
    return field.kind;
  }

  /** What a `compute:` expression gives, as a canonical decimal; null when an input is empty. */
  private derivedValue(field: FieldDecl): string | null {
    const cached = this.derived.get(field.name);
    if (cached !== undefined) return cached;
    if (this.deriving.has(field.name) || !field.compute) return null;
    this.deriving.add(field.name);
    const value = evaluateCompute(field.compute.expr, {
      value: (name) => {
        const input = this.fields.get(name);
        if (!input) return null;
        if (this.inactive.has(name)) return "0";
        const raw = this.rawValue(input);
        return isBlank(raw) ? null : raw!;
      },
      sum: (column) => this.sumOf(column),
    });
    this.deriving.delete(field.name);
    this.derived.set(field.name, value);
    return value;
  }

  /** The sum of a table column over its printed rows: an empty cell counts 0, anything not a decimal gives null. */
  private sumOf(column: string): string | null {
    const table = this.columnOf.get(column);
    if (!table || table.columns[0] === column) return null;
    let total = 0n;
    for (const row of this.printedRows(table)) {
      const cell = row.cells[column];
      if (isBlank(cell)) continue;
      const match = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(String(cell).trim());
      if (!match) return null;
      const scaled = BigInt(match[2]!) * 1_000_000n + BigInt((match[3] ?? "").padEnd(6, "0"));
      total += match[1] === "-" ? -scaled : scaled;
    }
    const abs = total < 0n ? -total : total;
    const fraction = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return `${total < 0n ? "-" : ""}${abs / 1_000_000n}${fraction === "" ? "" : `.${fraction}`}`;
  }

  printedRows(table: TableDecl): { id: string; cells: Record<string, string | number> }[] {
    return (this.answers.tables[table.name] ?? []).filter((row) => table.columns.some((column) => !isBlank(row.cells[column])));
  }

  private listItems(list: ListDecl): string[] {
    return (this.answers.lists[list.name] ?? []).filter((item) => !isBlank(item));
  }

  /** A system field was read by printed text: its source is listed in `systemRead`. */
  private noteRead(field: FieldDecl): void {
    if (this.recording && field.source !== null) this.read.add(field.source);
  }

  private fieldFilled(field: FieldDecl): boolean {
    this.noteRead(field);
    if (field.source === "reference") return true;
    return !present(this.effectiveKind(field), this.rawValue(field), this.context.language, this.context.currency).empty;
  }

  private filled(name: string, scope: Scope): boolean {
    if (scope.values.has(name)) return !isBlank(scope.values.get(name));
    const list = this.lists.get(name);
    if (list) return this.listItems(list).length > 0;
    const table = this.tables.get(name);
    if (table) return this.printedRows(table).length > 0;
    const field = this.fields.get(name);
    if (field) {
      const owner = this.columnOf.get(name);
      if (owner && owner.columns[0] !== name) return this.printedRows(owner).some((row) => !isBlank(row.cells[name]));
      return this.fieldFilled(field);
    }
    return this.answers.blocks[name] === true;
  }

  holds(cond: Cond, scope: Scope): boolean {
    if (cond.op === "on") return cond.names.every((name) => this.answers.blocks[name] === true);
    const any = cond.names.some((name) => this.filled(name, scope));
    return cond.op === "any" ? any : !any;
  }

  private holdsAll(conds: readonly Cond[], scope: Scope = ROOT): boolean {
    return conds.every((cond) => this.holds(cond, scope));
  }

  /** The value `[NAME]` stands for in a scope; null for a name the template never declared (printed as written). */
  private valueOf(name: string, scope: Scope): Value | null {
    const { language, currency } = this.context;
    const list = this.lists.get(name);
    const owner = this.columnOf.get(name);
    if (scope.values.has(name)) {
      const raw = scope.values.get(name);
      if (list) return { kind: "text", text: String(raw) };
      const table = scope.row!.table;
      const key = table.columns[0] === name;
      const where = { name: `${table.name}#${scope.row!.id}.${name}`, label: key ? (table.label ?? table.name) : (this.fields.get(name)?.label ?? name), stepName: table.name };
      if (isBlank(raw)) {
        if (key || this.requiredColumns.has(name)) return this.missingValue(where.name, where.label, where.stepName);
        return { kind: "text", text: "" };
      }
      const field = this.fields.get(name);
      if (key) return { kind: "text", text: String(raw) };
      return this.textValue(field?.kind ?? "text", raw!, field?.options ?? null, where.name, where.label, where.stepName);
    }
    if (list || owner) {
      if (list ? scope.emptyList === list : scope.emptyTable === owner) {
        return this.missingValue(list ? list.name : owner!.name, list ? (list.label ?? list.name) : (owner!.label ?? owner!.name));
      }
      // named outside a line it drives: its non-empty items, joined
      if (list) {
        const items = this.listItems(list);
        return items.length === 0 ? this.missingValue(list.name, list.label ?? list.name) : { kind: "text", text: items.join(", ") };
      }
      const cells = this.printedRows(owner!)
        .map((row) => row.cells[name])
        .filter((cell) => !isBlank(cell))
        .map((cell) => present(this.fields.get(name)?.kind ?? "text", cell, language, currency).text);
      return cells.length === 0 ? this.missingValue(owner!.name, owner!.label ?? owner!.name) : { kind: "text", text: cells.join(", ") };
    }
    const field = this.fields.get(name);
    if (!field) return null;
    const label = field.label ?? name;
    this.noteRead(field);
    if (field.source === "reference") {
      if (this.reference !== null) return { kind: "text", text: this.reference };
      return { kind: "pending", raised: { kind: "pending", name, label, step: this.stepOf(name) } };
    }
    const raw = this.rawValue(field);
    // a supplied value the CRM holds blank prints nothing: the person has nothing to fill in (AC-12.7, AC-12.12)
    if (isBlank(raw)) return field.compute || isSupplied(field.source) ? { kind: "text", text: "" } : this.missingValue(name, label);
    if (field.source !== null && !["date", "validityDays", ...ESTIMATE_SOURCES].includes(field.source)) return { kind: "text", text: String(raw).trim() };
    return this.textValue(this.effectiveKind(field), raw!, field.options, name, label, name, field.source === "validityDays");
  }

  /** A stored value as printed, with what is wrong with it (the answer is invalid, not missing). */
  private textValue(kind: FieldKind, raw: string | number, options: readonly string[] | null, name: string, label: string, stepName: string, days = false): Value {
    const { language, currency } = this.context;
    let code = checkValue(kind, raw, options);
    if (days && code === null) {
      const value = Number(String(raw).trim());
      code = !Number.isInteger(value) ? "not_integer" : value < 1 || value > 365 ? "out_of_range" : null;
    }
    const text = present(kind, raw, language, currency).text;
    if (code === null) return { kind: "text", text };
    return { kind: "text", text, invalid: { kind: "invalid", name, label, step: this.stepOf(stepName), code } };
  }

  // ─── Text ─────────────────────────────────────────────────────────────────────

  /** A new unit starts with an empty budget. */
  private startUnit(): void {
    this.used = 0;
    this.over = false;
  }

  /** `size` more characters in the unit: false (and the unit is over) when they would pass `MAX_BUILD`. */
  private charge(size: number): boolean {
    if (this.over) return false;
    if (this.used + size > MAX_BUILD) {
      this.over = true;
      return false;
    }
    this.used += size;
    return true;
  }

  /** Writes `piece` to the line being built unless the unit is over: the one place the output grows. */
  private append(buffer: { s: string }, piece: string): void {
    if (this.charge(piece.length)) buffer.s += piece;
  }

  private emit(value: Value, buffer: { s: string }, surface: Surface, raised: Raised[]): void {
    if (this.over) return;
    if (value.kind === "text") {
      if (value.invalid) raised.push(value.invalid);
      this.append(buffer, surface === "markup" ? escapeValue(value.text, currentLine(buffer.s)) : plainValue(value.text));
      return;
    }
    const label = printable(value.raised.label ?? "");
    if (this.mode === "tokens" && value.kind === "pending" && surface === "markup") {
      // the offer reference has no value until generation: a hand-edit text carries it as the reference token, which
      // is filled then and so blocks nothing (DD-52); only a plain surface (a heading) keeps the blocking token
      this.append(buffer, REFERENCE_TOKEN);
      return;
    }
    raised.push(value.raised);
    if (this.mode === "tokens") {
      this.append(buffer, TOKEN_OPEN + (surface === "markup" ? escapeChars(label) : label) + TOKEN_CLOSE);
    } else if (value.kind === "missing") {
      this.append(buffer, MISSING_OPEN + label + MISSING_CLOSE);
    } else {
      this.append(buffer, PENDING_OPEN + label + PENDING_CLOSE);
    }
  }

  private render(nodes: readonly Inline[], scope: Scope, surface: Surface, raised: Raised[], buffer: { s: string }): void {
    for (const node of nodes) {
      if (this.over) return;
      if (node.type === "text") {
        this.append(buffer, printable(surface === "stripped" ? stripMarkup(node.text) : node.text));
      } else if (node.type === "field") {
        const value = this.valueOf(node.name, scope);
        if (value === null) this.append(buffer, printable(`[${node.name}]`));
        else this.emit(value, buffer, surface, raised);
      } else if (this.holds(node.cond, scope)) {
        this.render(node.children, scope, surface, raised, buffer);
      }
    }
  }

  private text(nodes: readonly Inline[], scope: Scope, surface: Surface, raised: Raised[]): string {
    const buffer = { s: "" };
    this.render(nodes, scope, surface, raised, buffer);
    return surface === "markup" ? buffer.s : buffer.s.trim();
  }

  /** The first list or repeatable table a line names: the line is printed once per item or row of it. */
  private driverOf(nodes: readonly Inline[]): { list: ListDecl } | { table: TableDecl } | null {
    for (const node of nodes) {
      if (node.type === "field") {
        const list = this.lists.get(node.name);
        if (list) return { list };
        const table = this.columnOf.get(node.name);
        if (table) return { table };
      } else if (node.type === "cond") {
        const inner = this.driverOf(node.children);
        if (inner) return inner;
      }
    }
    return null;
  }

  private scopesOf(driver: { list: ListDecl } | { table: TableDecl }): Scope[] {
    if ("list" in driver) {
      const items = this.listItems(driver.list);
      if (items.length === 0) return [{ ...ROOT, emptyList: driver.list }];
      return items.map((item) => ({ ...ROOT, values: new Map([[driver.list.name, item]]) }));
    }
    const rows = this.printedRows(driver.table);
    if (rows.length === 0) return [{ ...ROOT, emptyTable: driver.table }];
    return rows.map((row) => ({
      values: new Map(driver.table.columns.map((column) => [column, row.cells[column]] as const)),
      row: { table: driver.table, id: row.id },
      emptyList: null,
      emptyTable: null,
    }));
  }

  /** A line with nothing but a list marker, a heading mark or empty table cells left on it. */
  private static blankRendered(text: string): boolean {
    return /^\s*(?:#{1,6}|[-•]|(?:\d+|[a-z])\.)?\s*$/.test(text) || /^\s*\|[\s|]*$/.test(text);
  }

  private bodyLines(lines: readonly BodyLine[]): OutLine[] {
    const out: OutLine[] = [];
    for (const line of lines) {
      if (this.over) break;
      if (!this.holdsAll(line.conds)) continue;
      if (line.nodes.every((node) => node.type === "text" && node.text.trim() === "")) {
        this.charge(1);
        out.push({ text: "", raised: [], heading: false });
        continue;
      }
      const dynamic = line.nodes.some((node) => node.type !== "text");
      const driver = this.driverOf(line.nodes);
      for (const scope of driver ? this.scopesOf(driver) : [ROOT]) {
        if (this.over) break;
        const raised: Raised[] = [];
        const text = this.text(line.nodes, scope, "markup", raised);
        if (dynamic && Resolver.blankRendered(text)) continue;
        this.charge(1);
        out.push({ text, raised, heading: /^\s*###(\s|$)/.test(text) });
      }
    }
    return out;
  }

  /** Sub-headings with nothing under them dropped, blank runs folded, the ends trimmed: the markup and what raised it. */
  private static assemble(lines: readonly OutLine[]): { body: string; raised: Raised[] } {
    const kept: OutLine[] = [];
    for (let index = 0; index < lines.length; ) {
      const line = lines[index]!;
      if (!line.heading) {
        kept.push(line);
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < lines.length && !lines[end]!.heading) end += 1;
      if (lines.slice(index + 1, end).some((inner) => inner.text.trim() !== "")) kept.push(...lines.slice(index, end));
      index = end;
    }
    const body = kept
      .map((line) => line.text)
      .join("\n")
      .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
      .replace(/^(?:[ \t]*\n)+/, "")
      .replace(/(?:\n[ \t]*)+$/, "");
    return { body, raised: kept.flatMap((line) => line.raised) };
  }

  commit(raised: readonly Raised[]): void {
    for (const entry of raised) {
      if (entry.kind === "invalid") {
        const key = `${entry.name}|${entry.code}`;
        if (!this.invalid.has(key)) this.invalid.set(key, { name: entry.name, label: entry.label, step: entry.step, code: entry.code! });
        continue;
      }
      if (entry.kind === "missing" && !this.missing.has(entry.name)) this.missing.set(entry.name, { name: entry.name, label: entry.label, step: entry.step });
      if (this.mode === "tokens" && entry.label !== null && !this.tokens.some((token) => token.name === entry.name)) this.tokens.push({ name: entry.name, label: entry.label });
    }
  }

  // ─── Sections ─────────────────────────────────────────────────────────────────

  usesOf(section: SectionAst): string[] {
    const names: string[] = [];
    const add = (name: string): void => {
      if (!names.includes(name)) names.push(name);
    };
    const nodes = (list: readonly Inline[]): void => {
      for (const node of list) {
        if (node.type === "field") add(node.name);
        else if (node.type === "cond") {
          node.cond.names.forEach(add);
          nodes(node.children);
        }
      }
    };
    const conds = (list: readonly Cond[]): void => list.forEach((cond) => cond.names.forEach(add));
    conds(section.conds);
    nodes(section.headingNodes);
    for (const line of section.body) {
      conds(line.conds);
      nodes(line.nodes);
    }
    return names;
  }

  /** A cost line's label for an issue: its description with every [FIELD] replaced by the field's label, no markup, at most 80 characters. */
  private costLabel(item: CostLineAst): string {
    const parts = (nodes: readonly Inline[]): string =>
      nodes
        .map((node) => {
          if (node.type === "text") return stripMarkup(node.text);
          if (node.type === "field") return this.fields.get(node.name)?.label ?? this.lists.get(node.name)?.label ?? this.tables.get(node.name)?.label ?? node.name;
          return parts(node.children);
        })
        .join("");
    return printable(parts(item.description)).replace(/\s+/g, " ").trim().slice(0, 80).trim();
  }

  private costIssue(kind: "missing" | "invalid", name: string, label: string | null, code?: InvalidCode): Raised {
    return { kind, name, label, step: "costs", ...(code ? { code } : {}) };
  }

  /** What is wrong with a value a person typed into a cost line (AC-3.6): fractional, negative, too big. */
  private checkEntered(raised: Raised[], name: string, label: string | null, value: { unitCents: number | null; percentBp: number | null; quantity: number | null; counts: boolean }): void {
    const bad = (code: InvalidCode): void => void raised.push(this.costIssue("invalid", name, label, code));
    if (value.unitCents !== null) {
      if (!Number.isInteger(value.unitCents)) bad("not_integer");
      else if (value.unitCents < 0 || value.unitCents > MAX_CENTS) bad("out_of_range");
    }
    if (value.percentBp !== null) {
      if (!Number.isInteger(value.percentBp)) bad("not_integer");
      else if (value.percentBp < 0 || value.percentBp > MAX_BASIS_POINTS) bad("out_of_range");
    }
    if (value.counts && value.quantity !== null) {
      if (!Number.isInteger(value.quantity)) bad("not_integer");
      else if (value.quantity < 1 || value.quantity > MAX_QUANTITY) bad("out_of_range");
    }
  }

  private costRows(costs: CostsAst, raised: Raised[]): ResolvedCostRow[] {
    const rows: ResolvedCostRow[] = [];
    for (const item of costs.items) {
      if (!this.holdsAll(item.conds)) continue;
      if (item.type === "total") {
        rows.push({ type: "total", label: this.text(item.label, ROOT, "stripped", raised) });
      } else if (item.unit.type === "perRelease") {
        const releases = this.answers.costs.lines[item.key]?.releases ?? [];
        if (releases.length === 0) raised.push(this.costIssue("missing", `cost:${item.key}`, this.costLabel(item)));
        releases.forEach((release, index) => {
          const description = plainValue(release.description);
          rows.push(this.costLine(item, `cost:${item.key}#${index + 1}`, ROOT, raised, { description, unitCents: release.unitCents }));
        });
      } else if (item.each !== null) {
        const table = this.tables.get(item.each);
        if (!table) continue;
        this.scopesOf({ table }).forEach((scope, index) => {
          if (scope.emptyTable) {
            const value = this.valueOf(table.name, scope);
            if (value && value.kind === "missing") raised.push(value.raised);
            return;
          }
          rows.push(this.costLine(item, `cost:${item.key}#${index + 1}`, scope, raised));
        });
      } else {
        rows.push(this.costLine(item, `cost:${item.key}`, ROOT, raised));
      }
    }
    this.addExtraLines(rows, raised);
    return rows;
  }

  /** The person's own lines go immediately before the last total row, at the end when there is none (AC-4.3). */
  private addExtraLines(rows: ResolvedCostRow[], raised: Raised[]): void {
    const extras = this.answers.costs.extra.map((extra): ResolvedCostRow => {
      const name = `cost:extra:${extra.id}`;
      const description = plainValue(extra.description);
      const percent = extra.kind === "discount" ? extra.percentBp : null;
      const unitCents = percent === null ? extra.unitCents : null;
      const counts = extra.kind !== "discount";
      if (description === "" || (unitCents === null && percent === null)) raised.push(this.costIssue("missing", name, null));
      this.checkEntered(raised, name, null, { unitCents, percentBp: percent, quantity: extra.quantity, counts });
      return { type: "line", name, kind: extra.kind, unitCents, percentBp: percent, quantity: counts ? extra.quantity : 1, description };
    });
    let at = rows.length;
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows[index]!.type === "total") {
        at = index;
        break;
      }
    }
    rows.splice(at, 0, ...extras);
  }

  /**
   * The number a field gives a cost line: an amount in cents or a count. Null when it has none — a missing field
   * is recorded, a value that is no number or not a whole count is an invalid answer (AC-4.2).
   */
  private fieldNumber(name: string, scope: Scope, raised: Raised[], as: "unit" | "qty"): number | null {
    const value = this.valueOf(name, scope);
    if (value === null) return null;
    if (value.kind !== "text") {
      raised.push(value.raised);
      return null;
    }
    if (value.invalid) raised.push(value.invalid);
    const field = this.fields.get(name);
    const raw = scope.values.has(name) ? scope.values.get(name) : field ? this.rawValue(field) : undefined;
    if (isBlank(raw)) return null;
    const number = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(number)) return null;
    if (as === "qty" && !value.invalid) {
      const table = scope.values.has(name) && scope.row ? scope.row.table : null;
      const code = !Number.isInteger(number) ? "not_integer" : number < 1 || number > MAX_QUANTITY ? "out_of_range" : null;
      if (code) {
        raised.push({
          kind: "invalid",
          name: table ? `${table.name}#${scope.row!.id}.${name}` : name,
          label: field?.label ?? name,
          step: this.stepOf(table ? table.name : name),
          code,
        });
      }
    }
    return number;
  }

  private costLine(item: CostLineAst, name: string, scope: Scope, raised: Raised[], over?: { description: string; unitCents: number | null }): ResolvedCostRow {
    const entry = this.answers.costs.lines[item.key] ?? {};
    const description = over ? over.description : this.text(item.description, scope, "stripped", raised);
    let unitCents: number | null = null;
    let percentBp: number | null = null;
    let enteredUnit = false;
    let enteredQuantity = false;
    switch (item.unit.type) {
      case "perRelease":
        unitCents = over?.unitCents ?? null;
        enteredUnit = true;
        break;
      case "entered":
      case "deal":
        enteredUnit = true;
        if (item.kind === "discount" && entry.percentBp !== null && entry.percentBp !== undefined) percentBp = entry.percentBp;
        else unitCents = entry.unitCents ?? null;
        break;
      case "field":
        unitCents = this.fieldNumber(item.unit.name, scope, raised, "unit");
        break;
      case "amount":
        unitCents = item.unit.cents;
        break;
      case "percent":
        percentBp = item.unit.bp;
        break;
    }
    let quantity: number | null = 1;
    switch (item.qty?.type) {
      case "entered":
      case "manDays":
        enteredQuantity = true;
        quantity = entry.quantity ?? null;
        break;
      case "field":
        quantity = this.fieldNumber(item.qty.name, scope, raised, "qty");
        break;
      case "literal":
        quantity = item.qty.value;
        break;
    }
    const label = this.costLabel(item);
    this.lineLabels.set(item.key, label);
    const counts = item.kind !== "discount";
    const unitMissing = enteredUnit && unitCents === null && percentBp === null;
    const quantityMissing = enteredQuantity && counts && quantity === null;
    if (unitMissing || quantityMissing || (item.unit.type === "perRelease" && description === "")) raised.push(this.costIssue("missing", name, label));
    this.checkEntered(raised, name, label, {
      unitCents: enteredUnit ? unitCents : null,
      percentBp: enteredUnit ? percentBp : null,
      quantity: enteredQuantity ? quantity : null,
      counts,
    });
    return { type: "line", name, kind: item.kind, unitCents, percentBp, quantity, description };
  }

  /**
   * A hand-edited body as printed (DD-52): split on the exact reference token on the RAW stored text — left to right,
   * non-overlapping, before `printable` and before any markup is read, so a backslash before the token does not
   * escape it — each piece printable, each token the reference (escaped like an answer, with the body so far as its
   * line), or, while there is none, the pending marker labelled as the template's first `source: reference` field
   * ("REF" with none). Nothing is raised: the reference exists at every generation. A body past the limit is already
   * an `invalid` issue and its text is never used, so its tokens are filled without a line context (bounded work).
   * An orphaned edit is never resolved (DD-17).
   */
  private editedBody(raw: string): string {
    const pieces = raw.split(REFERENCE_TOKEN).map((piece) => printable(piece).replace(/\r\n?/g, "\n"));
    if (pieces.length === 1) return pieces[0]!;
    const bounded = raw.length <= MAX_EDIT_BODY;
    let fill: string;
    if (this.mode === "tokens") {
      fill = REFERENCE_TOKEN;
    } else if (this.reference === null) {
      const field = this.ast.fields.find((candidate) => candidate.source === "reference");
      fill = PENDING_OPEN + printable(field ? (field.label ?? field.name) : "REF") + PENDING_CLOSE;
    } else {
      fill = "";
    }
    let body = pieces[0]!;
    for (let index = 1; index < pieces.length; index++) {
      const value = this.mode === "markers" && this.reference !== null ? escapeValue(this.reference, bounded ? currentLine(body) : "") : fill;
      body += value + pieces[index]!;
    }
    return body;
  }

  /**
   * One section, or null when it does not print: the wizard's text, or the person's own when the section was
   * edited by hand (`useEdits`) — verbatim, no field read, so a later answer cannot change it (AC-5.2).
   */
  section(
    source: SectionAst,
    withCosts: boolean,
    useEdits = true,
  ): { section: ResolvedSection; rows: ResolvedCostRow[]; costs: CostsAst | null; raised: Raised[] } | null {
    const edit = useEdits ? this.answers.handEdits[source.key] : undefined;
    // the conditions of a section the person edited by hand only decide whether stored text prints: no field is read (DD-58)
    const recording = this.recording;
    this.recording = recording && edit === undefined;
    const prints = this.holdsAll(source.conds);
    this.recording = recording;
    if (!prints) return null;
    this.startUnit();
    const raised: Raised[] = [];
    const costs = source.costs && this.holdsAll(source.costs.conds) ? source.costs : null;
    let heading: string;
    let body: string;
    let bodyRaised: Raised[] = [];
    if (edit) {
      heading = printable(edit.heading).trim();
      if (heading === "") return null;
      body = this.editedBody(edit.body);
      const where = { name: `section:${source.key}`, label: printable(source.heading), step: source.step };
      if (edit.heading.length > MAX_EDIT_HEADING) raised.push({ kind: "invalid", ...where, code: "heading_too_long" });
      if (edit.body.length > MAX_EDIT_BODY) raised.push({ kind: "invalid", ...where, code: "section_too_long" });
    } else {
      heading = this.text(source.headingNodes, ROOT, "plain", raised);
      // a heading the budget refused is reported below, never a reason to drop the section (QE D6)
      if (heading === "") {
        if (!this.over) return null;
        heading = printable(source.heading);
      }
      body = "";
    }
    const rows = costs && withCosts ? this.costRows(costs, raised) : [];
    if (!edit) {
      const assembled = Resolver.assemble(this.bodyLines(source.body));
      body = assembled.body;
      bodyRaised = assembled.raised;
      if (body === "" && costs === null && !this.over) return null; // over: reported below, not dropped (QE D6)
    }
    // what the wizard printed is bounded as it is built (QE D1); a hand edit has its own checks above (AC-5.4)
    if (this.over || (!edit && body.length > MAX_EDIT_BODY)) {
      raised.push({ kind: "invalid", name: `section:${source.key}`, label: printable(source.heading), step: source.step, code: "section_too_long" });
    }
    return {
      section: { key: source.key, heading, body, costs: costs !== null, step: source.step, handEdited: edit !== undefined, uses: this.usesOf(source) },
      rows,
      costs,
      raised: [...raised, ...bodyRaised],
    };
  }

  resolve(): ResolvedOffer {
    const { ast, answers, context } = this;
    const date = answers.client.date;
    if (date !== null && (!realDate(date) || Math.abs(dayNumber(date) - dayNumber(context.today)) > MAX_DATE_DISTANCE_DAYS)) {
      this.commit([{ kind: "invalid", name: "client:date", label: null, step: "client", code: "date_out_of_range" }]);
    }
    this.startUnit();
    const opening = Resolver.assemble(this.bodyLines(ast.opening));
    this.commit(opening.raised);
    if (this.over || opening.body.length > MAX_EDIT_BODY) {
      this.commit([{ kind: "invalid", name: "opening", label: null, step: ast.sections[0]?.step ?? "scope", code: "section_too_long" }]);
    }

    const sections: ResolvedSection[] = [];
    let costTable: { rows: ResolvedCostRow[]; costs: CostsAst } | null = null;
    for (const source of ast.sections) {
      const printed = this.section(source, true);
      if (!printed) continue;
      this.commit(printed.raised);
      sections.push(printed.section);
      if (printed.costs && costTable === null) costTable = { rows: printed.rows, costs: printed.costs };
    }

    const annexes: ResolvedAnnex[] = [];
    for (const annex of ast.annexes) {
      if (!this.holdsAll(annex.conds)) continue;
      const raised: Raised[] = [];
      this.startUnit();
      const title = this.text(annex.title, ROOT, "plain", raised);
      const subtitle = annex.subtitle ? this.text(annex.subtitle, ROOT, "plain", raised) : null;
      const intro = Resolver.assemble(this.bodyLines(annex.intro));
      if (this.over || intro.body.length > MAX_EDIT_BODY) {
        raised.push({ kind: "invalid", name: `annex:${annex.designation}`, label: null, step: "annexes", code: "section_too_long" });
      }
      const printedSections = annex.sections.map((source) => this.section(source, false)).filter((printed): printed is NonNullable<typeof printed> => printed !== null);
      if (title === "" || (intro.body === "" && printedSections.length === 0)) {
        // an annex that does not print says nothing, except that a unit over the limit is always reported (QE D6)
        this.commit([...raised, ...printedSections.flatMap((printed) => printed.raised)].filter((issue) => issue.kind === "invalid" && issue.code === "section_too_long"));
        continue;
      }
      this.commit([...raised, ...intro.raised]);
      for (const printed of printedSections) this.commit(printed.raised);
      annexes.push({ designation: annex.designation, title, subtitle: subtitle === "" ? null : subtitle, intro: intro.body, sections: printedSections.map((printed) => printed.section) });
    }

    const labelRaised: Raised[] = [];
    this.startUnit();
    const labels = costTable?.costs.labels;
    const costLabels = {
      unit: labels ? this.text(labels.unit, ROOT, "stripped", labelRaised) : null,
      quantity: labels?.quantity ? this.text(labels.quantity, ROOT, "stripped", labelRaised) : null,
    };
    this.commit(labelRaised);
    if (this.over) this.commit([{ kind: "invalid", name: "cost:labels", label: null, step: "costs", code: "section_too_long" }]);
    const rows = costTable?.rows ?? [];
    const result = computeCosts(rows);
    for (const error of costTable ? result.errors : []) {
      const line = /^cost:([a-z][a-z0-9_]*)(?:#\d+)?$/.exec(error.name);
      this.commit([{ kind: "invalid", name: error.name, label: line ? (this.lineLabels.get(line[1]!) ?? null) : null, step: "costs", code: error.code }]);
    }

    return {
      language: context.language,
      salutation: printable(ast.salutation),
      acceptanceLabel: ast.acceptanceLabel === null ? null : printable(ast.acceptanceLabel),
      client: {
        lines: answers.client.lines.map(printable),
        contacts: this.contactNames().map(printable),
        place: printable(answers.client.place),
        date: this.printedDate(),
      },
      opening: opening.body,
      sections,
      annexes,
      costs: { rows, result, columns: { ...answers.costs.columns }, labels: costLabels, showTotals: answers.costs.showTotals },
      effortAnnex: answers.effortAnnex,
      validityDays: answers.validityDays,
      aiAssisted: answers.aiAssisted,
      attachmentIds: [...answers.attachmentIds],
      missing: [...this.missing.values()],
      invalid: [...this.invalid.values()],
      systemRead: [...this.read].sort(),
    };
  }
}

/** The document the answers make (AC-3.2): what the preview draws and the PDF prints. */
export function resolveOffer(ast: TemplateAst, answers: WizardAnswers, context: WizardContext, options: ResolveOptions = {}): ResolvedOffer {
  return new Resolver(ast, answers, context, options.reference ?? null, options.mode ?? "markers").resolve();
}

/**
 * One section as the wizard would print it, ignoring any hand edit, with each missing value and the pending
 * reference written as "⟦Label⟧" and listed in `tokens` once, in text order (AC-5.1, DD-30). Null for a key the
 * template does not have or a section that does not print.
 */
export function resolveSectionText(ast: TemplateAst, answers: WizardAnswers, context: WizardContext, sectionKey: string): SectionText | null {
  const resolver = new Resolver(ast, answers, context, null, "tokens");
  const source = [...ast.sections, ...ast.annexes.flatMap((annex) => annex.sections)].find((candidate) => candidate.key === sectionKey);
  const printed = source ? resolver.section(source, false, false) : null;
  if (!printed) return null;
  resolver.commit(printed.raised);
  return { heading: printed.section.heading, body: printed.section.body, tokens: resolver.tokens };
}
// shared-copy:end offerEngine.resolve
