/**
 * The offer template text (specs/20261115-crm-offer-wizard § Template text — the extended offer markup),
 * read into a tree and its structural problems (AC-8.3, AC-9.5, AC-4.6, AC-4.7). Pure: no I/O, never
 * throws, linear in the text (a template is at most 150 000 characters, nesting at most 8).
 *
 * What this file reads (the declarations `@@field`/`@@list`/`@@table`/`@@block`/`@@choice` are collected raw
 * here and interpreted by the declarations half of this file):
 *
 *   opening          the lines before the first `##`, plus `@@salutation`, `@@acceptance`, `@@effort-annex`
 *   sections         `## HEADING`, `@@step <step>`; a section whose first block is `@@costs … @@end`
 *   annexes          `@@annex <DESIGNATION> <title>`, `@@subtitle <text>`, then its own `##` sections
 *   conditions       inline `{{block::text}}` `{{?A,B::text}}` `{{!A,B::text}}` (nestable, per line) and block
 *                    `@@OPT_START <cond>` … `@@OPT_END`, which may wrap lines, cost lines, sections or annexes
 *   field use        `[NAME]`
 *
 * Block conditions are not nested in the tree: every line, cost item, section and annex carries `conds`, the
 * conditions of every block open at that line. A block may therefore cross a section boundary, and an element
 * is printed exactly when all its conditions hold.
 *
 * Anything the reader does not understand degrades to ordinary text (markup.ts reads it); there is no
 * problem code for an unknown `@@` word, so it prints as written.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.syntax).
 */
// shared-copy:begin offerEngine.syntax
import { computeRefs, parseCompute, type ComputeExpr } from "./compute";
import { printable } from "./printable";

export type StepKey = "client" | "scope" | "conditions" | "costs" | "annexes";
export const STEP_KEYS: readonly StepKey[] = ["client", "scope", "conditions", "costs", "annexes"];

export const MAX_TEMPLATE_CHARS = 150_000;
export const MAX_NESTING = 8;
export const MAX_SECTIONS = 15;
export const MAX_ANNEXES = 5;
export const MAX_ANNEX_SECTIONS = 30;
export const MAX_HEADING = 120;
export const MAX_SALUTATION = 100;

export type ProblemCode =
  | "block_not_closed" | "unexpected_close" | "field_undeclared" | "label_missing" | "declared_unused"
  | "choice_too_few_options" | "choice_option_unknown" | "no_costs_section" | "costs_not_first"
  | "costs_not_closed" | "cost_line_invalid" | "cost_key_duplicate" | "name_duplicate" | "table_column_unknown"
  | "column_in_two_tables" | "compute_invalid" | "compute_cycle" | "fills_unknown" | "source_unknown"
  | "step_unknown" | "annex_designation_invalid" | "annex_designation_duplicate" | "salutation_missing"
  | "too_many_sections" | "too_many_annexes" | "too_many_annex_sections" | "heading_too_long" | "too_large"
  | "nesting_too_deep" | "reserved_character" | "cost_line_after_last_total" | "percent_discount_multi_total"
  | "non_printable_character" | "optional_heading_not_last" | "declaration_invalid";

export interface Problem {
  readonly line: number;
  readonly severity: "error" | "warning";
  readonly code: ProblemCode;
  readonly name?: string;
}

/** `on`: the block is on · `any`: at least one of the fields is filled (`?`) · `none`: none is filled (`!`). */
export interface Cond {
  readonly op: "on" | "any" | "none";
  readonly names: readonly string[];
}

export type Inline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "field"; readonly name: string }
  | { readonly type: "cond"; readonly cond: Cond; readonly children: Inline[] };

/** One source line of a body: the conditions of every block open at it, and its text. A blank line has no nodes. */
export interface BodyLine {
  readonly line: number;
  readonly conds: readonly Cond[];
  readonly nodes: Inline[];
}

export type CostKind = "one_off" | "yearly" | "discount" | "option";

export type CostUnit =
  | { readonly type: "entered" }
  | { readonly type: "deal" }
  | { readonly type: "perRelease" }
  | { readonly type: "field"; readonly name: string }
  | { readonly type: "amount"; readonly cents: number }
  | { readonly type: "percent"; readonly bp: number };

export type CostQty =
  | { readonly type: "entered" }
  | { readonly type: "manDays" }
  | { readonly type: "field"; readonly name: string }
  | { readonly type: "literal"; readonly value: number };

export interface CostLineAst {
  readonly type: "line";
  readonly line: number;
  readonly conds: readonly Cond[];
  readonly key: string;
  readonly kind: CostKind;
  /** The repeatable table the line repeats for (`each=`). */
  readonly each: string | null;
  readonly description: Inline[];
  readonly unit: CostUnit;
  /** null for a discount; a line with no `qty=` has the literal 1. */
  readonly qty: CostQty | null;
}

export interface CostTotalAst {
  readonly type: "total";
  readonly line: number;
  readonly conds: readonly Cond[];
  readonly label: Inline[];
}

export interface CostsAst {
  readonly line: number;
  readonly conds: readonly Cond[];
  readonly columns: { readonly position: boolean; readonly unit: boolean };
  readonly labels: { readonly line: number; readonly unit: Inline[]; readonly quantity: Inline[] | null } | null;
  readonly items: (CostLineAst | CostTotalAst)[];
}

export interface SectionAst {
  /** Heading source text + "#" + occurrence index in the whole text, e.g. "OGGETTO DELLA FORNITURA#0". */
  readonly key: string;
  readonly heading: string;
  readonly headingNodes: Inline[];
  readonly line: number;
  readonly conds: readonly Cond[];
  readonly step: StepKey;
  readonly costs: CostsAst | null;
  readonly body: BodyLine[];
}

export interface AnnexAst {
  readonly line: number;
  readonly conds: readonly Cond[];
  readonly designation: string;
  readonly title: Inline[];
  readonly subtitle: Inline[] | null;
  readonly subtitleLine: number | null;
  /** Lines between the annex's start and its first section. */
  readonly intro: BodyLine[];
  readonly sections: SectionAst[];
}

export type DeclarationKind = "field" | "list" | "table" | "block" | "choice";

/** A declaration as written: `key: value` lines (split at the first colon), never interpreted here. */
export interface RawDeclaration {
  readonly kind: DeclarationKind;
  readonly name: string;
  readonly line: number;
  readonly entries: { readonly line: number; readonly key: string; readonly value: string }[];
}

export type FieldKind = "text" | "longtext" | "number" | "percentage" | "date" | "amount";
export const FIELD_KINDS: readonly FieldKind[] = ["text", "longtext", "number", "percentage", "date", "amount"];

/** What the system knows (`source:`), named by the template author. */
export type SystemSource =
  | "client" | "clientAddress" | "contacts" | "place" | "date" | "reference" | "issuer" | "issuerAddress" | "currency"
  | "validityDays" | "deal" | "epics" | "phases" | "timeline" | "manDays";
export const SYSTEM_SOURCES: readonly SystemSource[] = [
  "client", "clientAddress", "contacts", "place", "date", "reference", "issuer", "issuerAddress", "currency",
  "validityDays", "deal", "epics", "phases", "timeline", "manDays",
];

export interface FieldDecl {
  readonly name: string;
  readonly line: number;
  readonly label: string | null;
  readonly hint: string | null;
  readonly example: string | null;
  readonly kind: FieldKind;
  /** As written; `today` for a date. */
  readonly default: string | null;
  readonly options: string[] | null;
  /** Choosing an option sets these fields (AC-1.9). */
  readonly fills: { readonly option: string; readonly assigns: { readonly name: string; readonly value: string }[] }[];
  readonly source: SystemSource | null;
  readonly compute: { readonly line: number; readonly source: string; readonly expr: ComputeExpr } | null;
  readonly step: StepKey | null;
}

export interface ListDecl {
  readonly name: string;
  readonly line: number;
  readonly label: string | null;
  readonly hint: string | null;
  readonly step: StepKey | null;
}

export interface TableDecl {
  readonly name: string;
  readonly line: number;
  readonly label: string | null;
  readonly hint: string | null;
  /** The first column is the table's own name (the row key); the others are declared fields. */
  readonly columns: string[];
  readonly step: StepKey | null;
}

export interface BlockDecl {
  readonly name: string;
  readonly line: number;
  readonly label: string | null;
  readonly explain: string | null;
  readonly default: boolean;
  readonly fills: { readonly name: string; readonly value: string }[];
  readonly step: StepKey | null;
}

export interface ChoiceDecl {
  readonly name: string;
  readonly line: number;
  readonly label: string | null;
  readonly options: string[];
  /** null: the first option. */
  readonly default: string | null;
  readonly step: StepKey | null;
}

export interface TemplateAst {
  readonly salutation: string;
  readonly acceptanceLabel: string | null;
  readonly effortAnnex: boolean;
  readonly opening: BodyLine[];
  readonly sections: SectionAst[];
  readonly annexes: AnnexAst[];
  readonly declarations: RawDeclaration[];
  /** Every `@@OPT_START` as written, with its line. */
  readonly optBlocks: { readonly line: number; readonly cond: Cond }[];
  readonly fields: FieldDecl[];
  readonly lists: ListDecl[];
  readonly tables: TableDecl[];
  readonly blocks: BlockDecl[];
  readonly choices: ChoiceDecl[];
}

// ─── Inline text ─────────────────────────────────────────────────────────────

const FIELD_NAME = "[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9_]{0,39}";
const FIELD_USE = new RegExp(`\\[(${FIELD_NAME})\\]`, "y");
const FIELD_NAME_ONLY = new RegExp(`^${FIELD_NAME}$`);
const COND_HEAD = /^[?!]?[A-Za-zÀ-ÿ0-9_]+(,[A-Za-zÀ-ÿ0-9_]+)*$/;
const MAX_HEAD = 200;

/** `name`, `?A,B`, `!A,B` → the condition; null when the text is not one. */
function parseCond(head: string): Cond | null {
  if (head.length > MAX_HEAD || !COND_HEAD.test(head)) return null;
  const op = head[0] === "?" ? "any" : head[0] === "!" ? "none" : "on";
  const names = (op === "on" ? head : head.slice(1)).split(",");
  if (op === "on" && names.length !== 1) return null;
  return { op, names };
}

interface Reporter {
  add(line: number, code: ProblemCode, name?: string, severity?: "error" | "warning"): void;
}

/**
 * The text of one line as nodes. `depth` is the blocks already open: inline conditions share the nesting
 * limit with them; past it the condition is flattened into its parent (reported once per line).
 */
function parseInline(text: string, line: number, depth: number, report: Reporter): Inline[] {
  const root: Inline[] = [];
  const stack: { nodes: Inline[]; cond: Cond | null }[] = [{ nodes: root, cond: null }];
  let buf = "";
  let colon = -2; // index of the next "::" at or after the last search, -1 = none left
  let tooDeep = false;
  let openConds = 0; // frames of `stack` that hold a real condition

  const flush = () => {
    if (buf === "") return;
    const nodes = stack[stack.length - 1]!.nodes;
    const last = nodes[nodes.length - 1];
    if (last && last.type === "text") nodes[nodes.length - 1] = { type: "text", text: last.text + buf };
    else nodes.push({ type: "text", text: buf });
    buf = "";
  };
  const close = () => {
    flush();
    const frame = stack.pop()!;
    if (frame.cond) openConds--;
    if (frame.cond) stack[stack.length - 1]!.nodes.push({ type: "cond", cond: frame.cond, children: frame.nodes });
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") {
      buf += text.slice(i, i + 2);
      i += 2;
    } else if (ch === "{" && text[i + 1] === "{") {
      if (colon !== -1 && colon < i + 2) colon = text.indexOf("::", i + 2);
      const cond = colon > 0 && colon - (i + 2) <= MAX_HEAD ? parseCond(text.slice(i + 2, colon)) : null;
      if (cond) {
        flush();
        if (depth + openConds >= MAX_NESTING) {
          if (!tooDeep) report.add(line, "nesting_too_deep");
          tooDeep = true;
          stack.push({ nodes: stack[stack.length - 1]!.nodes, cond: null });
        } else {
          stack.push({ nodes: [], cond });
          openConds++;
        }
        i = colon + 2;
      } else {
        buf += "{{";
        i += 2;
      }
    } else if (ch === "}" && text[i + 1] === "}" && stack.length > 1) {
      close();
      i += 2;
    } else if (ch === "[") {
      FIELD_USE.lastIndex = i;
      const match = FIELD_USE.exec(text);
      if (match) {
        flush();
        stack[stack.length - 1]!.nodes.push({ type: "field", name: match[1]! });
        i += match[0].length;
      } else {
        buf += ch;
        i += 1;
      }
    } else {
      buf += ch;
      i += 1;
    }
  }
  while (stack.length > 1) {
    const frame = stack[stack.length - 1]!;
    if (frame.cond) report.add(line, "block_not_closed", frame.cond.names[0]);
    close();
  }
  flush();
  return root;
}

/** Split at unescaped pipes; `\|` stays in its part for the markup to read. */
function splitPipes(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      part += text.slice(i, i + 2);
      i += 1;
    } else if (ch === "|") {
      parts.push(part.trim());
      part = "";
    } else {
      part += ch;
    }
  }
  parts.push(part.trim());
  return parts;
}

// ─── Cost lines ──────────────────────────────────────────────────────────────

const COST_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const COST_KINDS: readonly string[] = ["one_off", "yearly", "discount", "option"];

function parseUnit(text: string): CostUnit | null {
  if (text === "?") return { type: "entered" };
  if (text === "deal") return { type: "deal" };
  if (text === "perRelease") return { type: "perRelease" };
  const field = /^\[(.+)\]$/.exec(text);
  if (field) return FIELD_NAME_ONLY.test(field[1]!) ? { type: "field", name: field[1]! } : null;
  const amount = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (amount) return { type: "amount", cents: Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) };
  const percent = /^(\d{1,3})(?:\.(\d{1,2}))?%$/.exec(text);
  if (percent) {
    const bp = Number(percent[1]) * 100 + Number((percent[2] ?? "").padEnd(2, "0"));
    return bp <= 10_000 ? { type: "percent", bp } : null;
  }
  return null;
}

function parseQty(text: string): CostQty | null {
  if (text === "?") return { type: "entered" };
  if (text === "manDays") return { type: "manDays" };
  const field = /^\[(.+)\]$/.exec(text);
  if (field) return FIELD_NAME_ONLY.test(field[1]!) ? { type: "field", name: field[1]! } : null;
  if (/^\d{1,6}$/.test(text) && Number(text) >= 1) return { type: "literal", value: Number(text) };
  return null;
}

// ─── The reader ──────────────────────────────────────────────────────────────

const DIRECTIVE = /^@@([A-Za-z_-]+)(?:[ \t]+(.*))?$/;
const HEADING = /^##[ \t]+(\S.*)$/;
const RESERVED = /[-⟦⟧]/;
/** The reference-token brackets U+27EA / U+27EB (DD-52): a template never holds one, not even the exact token. */
const REFERENCE_BRACKETS = /[⟪⟫]/;
const NON_ASCII = /[^\x20-\x7e]/;
const DESIGNATION = /^[A-Z0-9]{1,8}$/;
const DECLARATIONS: readonly string[] = ["field", "list", "table", "block", "choice"];

function emptyAst(): TemplateAst {
  return { salutation: "", acceptanceLabel: null, effortAnnex: false, opening: [], sections: [], annexes: [], declarations: [], optBlocks: [], fields: [], lists: [], tables: [], blocks: [], choices: [] };
}

function countChar(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

interface Frame {
  readonly cond: Cond;
  readonly line: number;
}

export function parseTemplate(source: string): { ast: TemplateAst; problems: Problem[] } {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const report: Reporter = {
    add(line, code, name, severity = "error") {
      const key = `${line}|${code}|${name ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      problems.push(name === undefined ? { line, severity, code } : { line, severity, code, name });
    },
  };
  const finish = (ast: TemplateAst) => {
    problems.sort((a, b) => a.line - b.line);
    return { ast, problems };
  };

  if (source.length > MAX_TEMPLATE_CHARS) {
    report.add(1, "too_large");
    return finish(emptyAst());
  }

  const lines = source.split(/\r\n|\r|\n/);

  let salutation: string | null = null;
  let acceptanceLabel: string | null = null;
  let effortAnnex: boolean | null = null;
  const opening: BodyLine[] = [];
  const sections: SectionAst[] = [];
  const annexes: AnnexAst[] = [];
  const declarations: RawDeclaration[] = [];
  const optBlocks: { line: number; cond: Cond }[] = [];

  const frames: Frame[] = [];
  let overflow = 0;
  let snap: readonly Cond[] = [];
  const resnap = () => {
    snap = frames.map((frame) => frame.cond);
  };

  // current position in the text
  let section: { ast: { -readonly [K in keyof SectionAst]: SectionAst[K] }; hasContent: boolean } | null = null;
  let annex: { -readonly [K in keyof AnnexAst]: AnnexAst[K] } | null = null;
  let contractStep: StepKey = "scope";
  const headingCount = new Map<string, number>();
  const designations = new Set<string>();
  let costsSeen = false;
  let decl: RawDeclaration | null = null;

  // the cost table being read
  interface CostsState {
    ast: { -readonly [K in keyof CostsAst]: CostsAst[K] };
    framesAtStart: number;
    keys: Set<string>;
  }
  let costs: CostsState | null = null;

  const body = (): BodyLine[] => (section ? section.ast.body : annex ? annex.intro : opening);
  const markContent = () => {
    if (section) section.hasContent = true;
  };

  const finishCosts = (unclosed: boolean) => {
    const state = costs!;
    costs = null;
    if (unclosed) report.add(state.ast.line, "costs_not_closed");
    while (frames.length > state.framesAtStart) {
      const frame = frames.pop()!;
      report.add(frame.line, "block_not_closed", frame.cond.names[0]);
    }
    resnap();
    const items = state.ast.items;
    const totals = items.filter((item) => item.type === "total").length;
    let lastTotal = -1;
    items.forEach((item, index) => {
      if (item.type === "total") lastTotal = index;
    });
    items.forEach((item, index) => {
      if (item.type !== "line") return;
      if (lastTotal >= 0 && index > lastTotal && item.kind !== "option") report.add(item.line, "cost_line_after_last_total", item.key);
      if (totals >= 2 && item.kind === "discount" && item.unit.type === "percent") report.add(item.line, "percent_discount_multi_total", item.key);
    });
  };

  for (let n = 0; n < lines.length; n++) {
    const ln = n + 1;
    const raw = lines[n]!;

    const reserved = RESERVED.test(raw) || REFERENCE_BRACKETS.test(raw);
    if (reserved) report.add(ln, "reserved_character");

    // a declaration runs to a blank line or the next `@@` line
    if (decl) {
      if (raw.trim() === "") {
        decl = null;
        continue;
      }
      if (!raw.startsWith("@@")) {
        const colon = raw.indexOf(":");
        const entry = colon < 0 ? { line: ln, key: raw.trim(), value: "" } : { line: ln, key: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() };
        decl.entries.push(entry);
        continue;
      }
      decl = null;
    }

    if (!reserved && NON_ASCII.test(raw)) {
      const nfc = raw.normalize("NFC");
      if (countChar(printable(nfc), "?") > countChar(nfc, "?")) report.add(ln, "non_printable_character", undefined, "warning");
    }

    const text = raw.trimEnd();
    const directive = DIRECTIVE.exec(text);
    const word = directive ? directive[1]! : null;
    const arg = directive ? (directive[2] ?? "").trim() : "";
    const heading = HEADING.exec(text);

    // ── inside a cost table ──
    if (costs) {
      const state: CostsState = costs;
      if (heading || word === "annex") {
        finishCosts(true);
        // fall through: the heading or annex is read as usual
      } else if (text.trim() === "") {
        continue;
      } else if (word === "end") {
        finishCosts(false);
        continue;
      } else if (word === "OPT_START") {
        openBlock(arg, ln);
        continue;
      } else if (word === "OPT_END") {
        if (overflow > 0) overflow--;
        else if (frames.length > state.framesAtStart) frames.pop();
        else report.add(ln, "unexpected_close");
        resnap();
        continue;
      } else if (word === "line") {
        readCostLine(state, arg, ln);
        continue;
      } else if (word === "total") {
        const label = parseInline(arg, ln, frames.length + overflow, report);
        if (arg === "") report.add(ln, "cost_line_invalid");
        else state.ast.items.push({ type: "total", line: ln, conds: snap, label });
        continue;
      } else if (word === "costlabels") {
        const parts = splitPipes(arg);
        if (arg === "" || parts[0] === "" || parts.length > 2) report.add(ln, "cost_line_invalid");
        else {
          state.ast.labels = {
            line: ln,
            unit: parseInline(parts[0]!, ln, frames.length + overflow, report),
            quantity: parts[1] ? parseInline(parts[1], ln, frames.length + overflow, report) : null,
          };
        }
        continue;
      } else {
        report.add(ln, "cost_line_invalid");
        continue;
      }
    }

    // ── structure ──
    if (heading) {
      const title = heading[1]!.trim();
      if (title.length > MAX_HEADING) report.add(ln, "heading_too_long");
      const occurrence = headingCount.get(title) ?? 0;
      headingCount.set(title, occurrence + 1);
      const inAnex = annex !== null;
      if (inAnex) {
        if (annex!.sections.length >= MAX_ANNEX_SECTIONS) report.add(ln, "too_many_annex_sections");
      } else if (sections.length >= MAX_SECTIONS) {
        report.add(ln, "too_many_sections");
      }
      const ast: SectionAst = {
        key: `${title}#${occurrence}`,
        heading: title,
        headingNodes: parseInline(title, ln, frames.length + overflow, report),
        line: ln,
        conds: snap,
        step: inAnex ? "annexes" : contractStep,
        costs: null,
        body: [],
      };
      section = { ast, hasContent: false };
      if (inAnex) annex!.sections.push(ast);
      else sections.push(ast);
      continue;
    }

    if (word !== null) {
      switch (word) {
        case "salutation":
          if (salutation === null) {
            salutation = arg;
            if (arg === "" || arg.length > MAX_SALUTATION) report.add(ln, "salutation_missing");
          }
          continue;
        case "acceptance":
          if (acceptanceLabel === null) {
            acceptanceLabel = arg;
            if (arg.length > MAX_SALUTATION) report.add(ln, "heading_too_long");
          }
          continue;
        case "effort-annex":
          if (effortAnnex === null) effortAnnex = arg === "on";
          continue;
        case "step":
          if (section) {
            if ((STEP_KEYS as readonly string[]).includes(arg)) {
              section.ast.step = arg as StepKey;
              if (!annex) contractStep = arg as StepKey;
            } else {
              report.add(ln, "step_unknown", arg);
            }
            continue;
          }
          break;
        case "annex": {
          const match = /^(\S+)(?:[ \t]+(\S.*))?$/.exec(arg);
          const designation = match ? match[1]! : "";
          const title = match?.[2]?.trim() ?? "";
          if (!DESIGNATION.test(designation) || title === "") report.add(ln, "annex_designation_invalid");
          else if (designations.has(designation)) report.add(ln, "annex_designation_duplicate");
          else designations.add(designation);
          if (title.length > MAX_HEADING) report.add(ln, "heading_too_long");
          if (annexes.length >= MAX_ANNEXES) report.add(ln, "too_many_annexes");
          annex = { line: ln, conds: snap, designation, title: parseInline(title, ln, frames.length + overflow, report), subtitle: null, subtitleLine: null, intro: [], sections: [] };
          annexes.push(annex);
          section = null;
          continue;
        }
        case "subtitle":
          if (annex && annex.sections.length === 0 && section === null && annex.subtitle === null) {
            annex.subtitle = parseInline(arg, ln, frames.length + overflow, report);
            annex.subtitleLine = ln;
            continue;
          }
          break;
        case "OPT_START":
          markContent();
          openBlock(arg, ln);
          continue;
        case "OPT_END":
          if (overflow > 0) overflow--;
          else if (frames.length > 0) frames.pop();
          else report.add(ln, "unexpected_close");
          resnap();
          continue;
        case "end":
          report.add(ln, "unexpected_close");
          continue;
        case "line":
        case "total":
        case "costlabels":
          report.add(ln, "cost_line_invalid");
          continue;
        case "costs": {
          const placed = section !== null && annex === null && !section.hasContent && section.ast.costs === null && !costsSeen;
          if (!placed) report.add(ln, "costs_not_first");
          costsSeen = true;
          const columns = { position: false, unit: false };
          for (const token of arg.split(/\s+/).filter(Boolean)) {
            if (token === "position" || token === "unit") columns[token] = true;
            else report.add(ln, "cost_line_invalid");
          }
          const ast = { line: ln, conds: snap, columns, labels: null, items: [] } as CostsState["ast"];
          costs = { ast, framesAtStart: frames.length, keys: new Set() };
          if (placed) section!.ast.costs = ast;
          if (section) section.hasContent = true;
          continue;
        }
        default:
          if (DECLARATIONS.includes(word)) {
            decl = { kind: word as DeclarationKind, name: arg, line: ln, entries: [] };
            declarations.push(decl);
            continue;
          }
      }
    }

    // ordinary text
    if (text.trim() !== "") markContent();
    body().push({ line: ln, conds: snap, nodes: parseInline(raw, ln, frames.length + overflow, report) });
  }

  if (costs) finishCosts(true);
  while (frames.length > 0) {
    const frame = frames.pop()!;
    report.add(frame.line, "block_not_closed", frame.cond.names[0]);
  }
  if (salutation === null) report.add(1, "salutation_missing");
  if (!costsSeen) report.add(1, "no_costs_section");

  const base = {
    salutation: salutation ?? "",
    acceptanceLabel,
    effortAnnex: effortAnnex ?? false,
    opening,
    sections,
    annexes,
    declarations,
    optBlocks,
  };
  return finish({ ...base, ...interpretDeclarations(base, report) });

  function openBlock(arg: string, ln: number): void {
    const cond = parseCond(arg);
    if (!cond) report.add(ln, "field_undeclared", arg === "" ? undefined : arg.slice(0, 80));
    optBlocks.push({ line: ln, cond: cond ?? { op: "on", names: [arg] } });
    if (frames.length + overflow >= MAX_NESTING) {
      report.add(ln, "nesting_too_deep");
      overflow++;
      return;
    }
    frames.push({ cond: cond ?? { op: "on", names: [arg] }, line: ln });
    resnap();
  }

  function readCostLine(state: CostsState, arg: string, ln: number): void {
    const parts = splitPipes(arg);
    const tokens = (parts[0] ?? "").split(/\s+/).filter(Boolean);
    const key = tokens[0];
    const invalid = () => report.add(ln, "cost_line_invalid", key);
    const kind = tokens[1];
    const each = tokens[2];
    if (
      !key || !COST_KEY.test(key) || !kind || !COST_KINDS.includes(kind) || tokens.length > 3 ||
      (each !== undefined && !(each.startsWith("each=") && FIELD_NAME_ONLY.test(each.slice(5)))) ||
      parts.length < 3 || parts[1] === ""
    ) {
      invalid();
      return;
    }
    let unit: CostUnit | null = null;
    let qty: CostQty | null | undefined;
    for (const param of parts.slice(2)) {
      const match = /^(unit|qty)\s*=\s*(\S.*)$/.exec(param);
      if (!match) return invalid();
      if (match[1] === "unit") {
        if (unit !== null) return invalid();
        unit = parseUnit(match[2]!.trim());
        if (unit === null) return invalid();
      } else {
        if (qty !== undefined) return invalid();
        qty = parseQty(match[2]!.trim());
        if (qty === null) return invalid();
      }
    }
    const isDiscount = kind === "discount";
    if (unit === null || (isDiscount && qty !== undefined) || (unit.type === "percent" && !isDiscount)) {
      invalid();
      return;
    }
    if (state.keys.has(key)) {
      report.add(ln, "cost_key_duplicate", key);
      return;
    }
    state.keys.add(key);
    state.ast.items.push({
      type: "line",
      line: ln,
      conds: snap,
      key,
      kind: kind as CostKind,
      each: each === undefined ? null : each.slice(5),
      description: parseInline(parts[1]!, ln, frames.length + overflow, report),
      unit,
      qty: isDiscount ? null : (qty ?? { type: "literal", value: 1 }),
    });
  }
}
// ─── Declarations ────────────────────────────────────────────────────────────

const MAX_LABEL = 80;
const MAX_HINT = 200;
const MAX_EXAMPLE = 80;
const MAX_OPTIONS = 20;

const ALLOWED_KEYS: Record<DeclarationKind, readonly string[]> = {
  field: ["label", "hint", "example", "kind", "default", "options", "fills", "source", "compute", "step"],
  list: ["label", "hint", "step"],
  table: ["label", "hint", "columns", "step"],
  block: ["label", "explain", "default", "fills", "step"],
  choice: ["label", "options", "default", "step"],
};

type Entry = RawDeclaration["entries"][number];

interface Declared {
  readonly fields: FieldDecl[];
  readonly lists: ListDecl[];
  readonly tables: TableDecl[];
  readonly blocks: BlockDecl[];
  readonly choices: ChoiceDecl[];
}

function splitList(value: string, separator: string): string[] {
  return value.split(separator).map((part) => part.trim());
}

/** `FIELD = value` → the pair; null when malformed. */
function parseAssign(value: string): { name: string; value: string } | null {
  const eq = value.indexOf("=");
  if (eq < 0) return null;
  const name = value.slice(0, eq).trim();
  return FIELD_NAME_ONLY.test(name) ? { name, value: value.slice(eq + 1).trim() } : null;
}

function validDefault(kind: FieldKind, value: string): boolean {
  switch (kind) {
    case "number":
    case "percentage":
      return /^-?\d{1,15}(\.\d{1,6})?$/.test(value);
    case "amount":
      return /^\d{1,13}(\.\d{1,2})?$/.test(value);
    case "date":
      return value === "today" || /^\d{4}-\d{2}-\d{2}$/.test(value);
    default:
      return true;
  }
}

/**
 * The five kinds of declaration read into their types, and every problem about them and about the names the
 * text uses (AC-8.3). A declaration that repeats an earlier name is reported and dropped.
 */
function interpretDeclarations(
  ast: Pick<TemplateAst, "opening" | "sections" | "annexes" | "declarations" | "optBlocks">,
  report: Reporter,
): Declared {
  const declared: Declared = { fields: [], lists: [], tables: [], blocks: [], choices: [] };
  const names = new Map<string, DeclarationKind>(); // field, list, table
  const blockNames = new Map<string, DeclarationKind>(); // block, choice
  const fills: { line: number; option: string | null; target: string; from: string }[] = [];
  const fieldFillOptions: { line: number; option: string; options: string[] | null }[] = [];
  const columnLines = new Map<string, number>(); // table → its `columns:` line
  const computeLines = new Map<string, number>();
  const choiceLines = new Map<string, { options: number; default: number }>();

  for (const decl of ast.declarations) {
    const registry = decl.kind === "block" || decl.kind === "choice" ? blockNames : names;
    if (registry.has(decl.name)) {
      report.add(decl.line, "name_duplicate", decl.name);
      continue;
    }
    registry.set(decl.name, decl.kind);

    // keys: known for the kind, once each (`fills` repeats)
    const entries = new Map<string, Entry>();
    const fillEntries: { option: string | null; entry: Entry }[] = [];
    for (const entry of decl.entries) {
      const word = entry.key.split(/\s+/)[0] ?? "";
      if (!ALLOWED_KEYS[decl.kind].includes(word)) {
        report.add(entry.line, "declaration_invalid", entry.key.slice(0, 40));
      } else if (word === "fills") {
        const option = entry.key.slice(5).trim();
        if ((decl.kind === "field") === (option === "")) report.add(entry.line, "declaration_invalid", "fills");
        else fillEntries.push({ option: option === "" ? null : option, entry });
      } else if (entries.has(word) || entry.key !== word) {
        report.add(entry.line, "declaration_invalid", word);
      } else {
        entries.set(word, entry);
      }
    }
    const text = (key: string, max: number | null): string | null => {
      const entry = entries.get(key);
      if (!entry) return null;
      if (max !== null && entry.value.length > max) report.add(entry.line, "declaration_invalid", key);
      return entry.value === "" ? null : entry.value;
    };
    const stepOf = (): StepKey | null => {
      const entry = entries.get("step");
      if (!entry) return null;
      if ((STEP_KEYS as readonly string[]).includes(entry.value)) return entry.value as StepKey;
      report.add(entry.line, "step_unknown", entry.value);
      return null;
    };
    const label = text("label", MAX_LABEL);
    const hasSource = decl.kind === "field" && entries.has("source");
    if (label === null && !hasSource) report.add(decl.line, "label_missing", decl.name);

    switch (decl.kind) {
      case "field": {
        const kindEntry = entries.get("kind");
        let kind: FieldKind = "text";
        if (kindEntry) {
          if ((FIELD_KINDS as readonly string[]).includes(kindEntry.value)) kind = kindEntry.value as FieldKind;
          else report.add(kindEntry.line, "declaration_invalid", "kind");
        }
        let options: string[] | null = null;
        const optionsEntry = entries.get("options");
        if (optionsEntry) {
          const list = splitList(optionsEntry.value, "|");
          if (kind !== "text" || list.length > MAX_OPTIONS || list.some((o) => o === "") || new Set(list).size !== list.length) {
            report.add(optionsEntry.line, "declaration_invalid", "options");
          } else {
            options = list;
          }
        }
        const defaultEntry = entries.get("default");
        let defaultValue: string | null = null;
        if (defaultEntry) {
          if (!validDefault(kind, defaultEntry.value) || (options !== null && !options.includes(defaultEntry.value))) {
            report.add(defaultEntry.line, "declaration_invalid", "default");
          } else if (defaultEntry.value !== "") {
            defaultValue = defaultEntry.value;
          }
        }
        let source: SystemSource | null = null;
        const sourceEntry = entries.get("source");
        if (sourceEntry) {
          if ((SYSTEM_SOURCES as readonly string[]).includes(sourceEntry.value)) source = sourceEntry.value as SystemSource;
          else report.add(sourceEntry.line, "source_unknown", sourceEntry.value);
        }
        let compute: FieldDecl["compute"] = null;
        const computeEntry = entries.get("compute");
        if (computeEntry) {
          const expr = parseCompute(computeEntry.value);
          if (!expr || !["number", "percentage", "amount"].includes(kind)) report.add(computeEntry.line, "compute_invalid", decl.name);
          else compute = { line: computeEntry.line, source: computeEntry.value, expr };
        }
        const optionFills: FieldDecl["fills"] = [];
        for (const { option, entry } of fillEntries) {
          const assign = parseAssign(entry.value);
          if (!assign) {
            report.add(entry.line, "declaration_invalid", "fills");
            continue;
          }
          fieldFillOptions.push({ line: entry.line, option: option!, options });
          fills.push({ line: entry.line, option, target: assign.name, from: decl.name });
          const group = optionFills.find((g) => g.option === option);
          if (group) group.assigns.push(assign);
          else optionFills.push({ option: option!, assigns: [assign] });
        }
        declared.fields.push({
          name: decl.name, line: decl.line, label, hint: text("hint", MAX_HINT), example: text("example", MAX_EXAMPLE),
          kind, default: defaultValue, options, fills: optionFills, source, compute, step: stepOf(),
        });
        break;
      }
      case "list":
        declared.lists.push({ name: decl.name, line: decl.line, label, hint: text("hint", MAX_HINT), step: stepOf() });
        break;
      case "table": {
        const columnsEntry = entries.get("columns");
        let columns = [decl.name];
        if (columnsEntry) {
          const list = splitList(columnsEntry.value, ",");
          if (list.length === 0 || list.some((c) => c === "")) report.add(columnsEntry.line, "declaration_invalid", "columns");
          else columns = list;
          columnLines.set(decl.name, columnsEntry.line);
        }
        declared.tables.push({ name: decl.name, line: decl.line, label, hint: text("hint", MAX_HINT), columns, step: stepOf() });
        break;
      }
      case "block": {
        const defaultEntry = entries.get("default");
        let on = false;
        if (defaultEntry) {
          if (defaultEntry.value === "on" || defaultEntry.value === "off") on = defaultEntry.value === "on";
          else report.add(defaultEntry.line, "declaration_invalid", "default");
        }
        const blockFills: BlockDecl["fills"] = [];
        for (const { entry } of fillEntries) {
          const assign = parseAssign(entry.value);
          if (!assign) report.add(entry.line, "declaration_invalid", "fills");
          else {
            blockFills.push(assign);
            fills.push({ line: entry.line, option: null, target: assign.name, from: decl.name });
          }
        }
        declared.blocks.push({ name: decl.name, line: decl.line, label, explain: text("explain", null), default: on, fills: blockFills, step: stepOf() });
        break;
      }
      case "choice": {
        const optionsEntry = entries.get("options");
        const options = optionsEntry ? splitList(optionsEntry.value, "|").filter((o) => o !== "") : [];
        const defaultEntry = entries.get("default");
        choiceLines.set(decl.name, { options: optionsEntry?.line ?? decl.line, default: defaultEntry?.line ?? decl.line });
        declared.choices.push({
          name: decl.name, line: decl.line, label, options, default: defaultEntry && defaultEntry.value !== "" ? defaultEntry.value : null, step: stepOf(),
        });
        break;
      }
    }
  }

  const fieldByName = new Map(declared.fields.map((field) => [field.name, field]));
  const blockByName = new Map(declared.blocks.map((block) => [block.name, block]));

  // fills: the option is one the field offers; the target is a declared field with no source of its own
  for (const { line, option, options } of fieldFillOptions) {
    if (options === null || !options.includes(option)) report.add(line, "fills_unknown", option);
  }
  for (const fill of fills) {
    const target = fieldByName.get(fill.target);
    if (!target || target.source !== null) report.add(fill.line, "fills_unknown", fill.target);
  }

  // choices: two options at least, each a declared block, a default among them
  for (const choice of declared.choices) {
    const where = choiceLines.get(choice.name)!;
    if (choice.options.length < 2) report.add(choice.line, "choice_too_few_options", choice.name);
    for (const option of choice.options) if (!blockByName.has(option)) report.add(where.options, "choice_option_unknown", option);
    if (choice.default !== null && !choice.options.includes(choice.default)) report.add(where.default, "choice_option_unknown", choice.default);
  }

  // tables: the first column is the table; the others are declared fields, each in one table
  const columnOwner = new Map<string, string>();
  const tableColumns = new Set<string>();
  for (const table of declared.tables) {
    const at = columnLines.get(table.name) ?? table.line;
    table.columns.forEach((column, index) => {
      if (index === 0) {
        if (column !== table.name) report.add(at, "table_column_unknown", column);
        return;
      }
      if (!fieldByName.has(column)) report.add(at, "table_column_unknown", column);
      else if (columnOwner.has(column) && columnOwner.get(column) !== table.name) report.add(at, "column_in_two_tables", column);
      else {
        columnOwner.set(column, table.name);
        tableColumns.add(column);
      }
    });
  }

  // derived fields: names declared, sums over table columns, no cycle
  const edges = new Map<string, string[]>();
  for (const field of declared.fields) {
    if (!field.compute) continue;
    computeLines.set(field.name, field.compute.line);
    const refs = computeRefs(field.compute.expr);
    for (const name of refs.names) if (!fieldByName.has(name)) report.add(field.compute.line, "field_undeclared", name);
    for (const column of refs.sums) if (!tableColumns.has(column)) report.add(field.compute.line, "table_column_unknown", column);
    edges.set(field.name, refs.names.filter((name) => fieldByName.get(name)?.compute));
  }
  for (const name of cyclicNodes(edges)) report.add(computeLines.get(name)!, "compute_cycle", name);

  // uses in the text
  const fieldUses: { name: string; line: number }[] = [];
  const condFieldUses: { name: string; line: number }[] = [];
  const blockUses: { name: string; line: number }[] = [];
  const walk = (nodes: readonly Inline[], line: number): void => {
    for (const node of nodes) {
      if (node.type === "field") fieldUses.push({ name: node.name, line });
      else if (node.type === "cond") {
        for (const name of node.cond.names) (node.cond.op === "on" ? blockUses : condFieldUses).push({ name, line });
        walk(node.children, line);
      }
    }
  };
  const walkLines = (lines: readonly BodyLine[]) => lines.forEach((l) => walk(l.nodes, l.line));
  const walkSection = (section: SectionAst) => {
    walk(section.headingNodes, section.line);
    walkLines(section.body);
    const table = section.costs;
    if (!table) return;
    if (table.labels) {
      walk(table.labels.unit, table.labels.line);
      if (table.labels.quantity) walk(table.labels.quantity, table.labels.line);
    }
    for (const item of table.items) {
      if (item.type === "total") {
        walk(item.label, item.line);
        continue;
      }
      walk(item.description, item.line);
      if (item.each) fieldUses.push({ name: item.each, line: item.line });
      if (item.unit.type === "field") fieldUses.push({ name: item.unit.name, line: item.line });
      if (item.qty?.type === "field") fieldUses.push({ name: item.qty.name, line: item.line });
    }
  };
  walkLines(ast.opening);
  ast.sections.forEach(walkSection);
  for (const annex of ast.annexes) {
    walk(annex.title, annex.line);
    if (annex.subtitle) walk(annex.subtitle, annex.subtitleLine ?? annex.line);
    walkLines(annex.intro);
    annex.sections.forEach(walkSection);
  }
  for (const { line, cond } of ast.optBlocks) {
    for (const name of cond.names) (cond.op === "on" ? blockUses : condFieldUses).push({ name, line });
  }

  const known = (name: string) => names.has(name);
  for (const use of [...fieldUses, ...condFieldUses]) if (!known(use.name)) report.add(use.line, "field_undeclared", use.name);
  for (const use of blockUses) if (!blockByName.has(use.name)) report.add(use.line, "field_undeclared", use.name);

  // declared and never used (a warning)
  const used = new Set<string>([...fieldUses, ...condFieldUses].map((use) => use.name));
  for (const field of declared.fields) {
    if (field.compute) {
      const refs = computeRefs(field.compute.expr);
      refs.names.forEach((name) => used.add(name));
      refs.sums.forEach((name) => used.add(name));
    }
  }
  const usedBlocks = new Set(blockUses.map((use) => use.name));
  const usedTables = new Set<string>();
  for (const table of declared.tables) {
    if (table.columns.some((column) => used.has(column)) || used.has(table.name)) usedTables.add(table.name);
  }
  for (const field of declared.fields) {
    const owner = columnOwner.get(field.name);
    if (!used.has(field.name) && !(owner !== undefined && usedTables.has(owner))) report.add(field.line, "declared_unused", field.name, "warning");
  }
  for (const list of declared.lists) if (!used.has(list.name)) report.add(list.line, "declared_unused", list.name, "warning");
  for (const table of declared.tables) if (!usedTables.has(table.name)) report.add(table.line, "declared_unused", table.name, "warning");
  for (const block of declared.blocks) if (!usedBlocks.has(block.name)) report.add(block.line, "declared_unused", block.name, "warning");

  // an optional sub-heading with siblings after it: the numbers after it shift when it drops
  const checkHeadings = (section: SectionAst) => {
    const headings: { line: number; optional: boolean }[] = [];
    for (const line of section.body) {
      const inline = isSubheading(line.nodes);
      if (inline === null) continue;
      const optional = inline || line.conds.some((cond) => !section.conds.includes(cond));
      headings.push({ line: line.line, optional });
    }
    headings.slice(0, -1).forEach((heading) => {
      if (heading.optional) report.add(heading.line, "optional_heading_not_last", undefined, "warning");
    });
  };
  ast.sections.forEach(checkHeadings);
  ast.annexes.forEach((annex) => annex.sections.forEach(checkHeadings));

  return declared;
}

/** `### …` as a line's whole content: false = written plain, true = wrapped in an inline condition, null = not one. */
function isSubheading(nodes: readonly Inline[]): boolean | null {
  const first = nodes[0];
  if (!first) return null;
  if (first.type === "text") return /^###[ \t]/.test(first.text) ? false : null;
  if (first.type === "cond" && nodes.length === 1) return isSubheading(first.children) === null ? null : true;
  return null;
}

/** The nodes that sit on a cycle of the graph (or point at themselves): iterative Tarjan, linear. */
function cyclicNodes(edges: ReadonlyMap<string, readonly string[]>): string[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic: string[] = [];
  let counter = 0;
  for (const root of edges.keys()) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const targets = edges.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next++]!;
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter++);
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(target)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!.node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1 || (edges.get(frame.node) ?? []).includes(frame.node)) cyclic.push(...component);
      }
    }
  }
  return cyclic;
}
// shared-copy:end offerEngine.syntax
