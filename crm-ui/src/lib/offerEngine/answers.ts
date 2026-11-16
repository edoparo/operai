/**
 * What a person answers in the offer wizard (specs/20261115-crm-offer-wizard AC-1.4, AC-1.9, AC-2.1, AC-2.3,
 * AC-6.5, AC-8.4, AC-8.5): the answers document, how it starts from a deal (`initialAnswers`) or from nothing
 * (`sampleAnswers`), how it follows a template that changed (`reconcileAnswers`) or was replaced
 * (`switchTemplate`), the one rule by which an option or a block fills other fields (decisions.md O3), and
 * the checks of what a person typed (reserved characters, text outside its options).
 *
 * Canonical values: text as typed; number and percentage as a canonical decimal text ("12.5"); a date as
 * "YYYY-MM-DD"; an amount as integer cents (a number). An empty value is an absent key. A derived field and a
 * field bound to the client block (`source:` other than the estimate values) are never stored.
 *
 * Every function returns new answers and leaves its input alone. There is no clock here: the day comes in
 * `WizardContext.today`. Template numbers (a default, a fill) are in major units — "150.50" is 15 050 cents.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.answers).
 */
// shared-copy:begin offerEngine.answers
import {
  type BlockDecl,
  type CostLineAst,
  type FieldDecl,
  type StepKey,
  type SystemSource,
  type TemplateAst,
} from "./syntax";
import { REFERENCE_TOKEN } from "./markup";

export type OfferLanguage = "en" | "it";

/** What the CRM knows about the deal, for one offer in one language (`GET …/offer-wizard/context` + the language and the day). */
export interface WizardContext {
  readonly language: OfferLanguage;
  /** "YYYY-MM-DD": the day the wizard runs; the value of a `default: today` date. */
  readonly today: string;
  readonly dealTitle: string;
  readonly currency: "CHF" | "EUR";
  readonly dealAmountCents: number | null;
  readonly issuerLegalName: string;
  /** The entity profile's address lines as saved (0–5): printed on one line by `source: issuerAddress` (DD-57). */
  readonly issuerAddressLines: readonly string[];
  readonly placeOfIssue: string;
  readonly clientLines: { readonly it: readonly string[]; readonly en: readonly string[] };
  readonly contacts: readonly { readonly id: string; readonly name: string }[];
  readonly attachments: readonly { readonly id: string; readonly fileName: string; readonly sizeBytes: number }[];
  readonly estimate: {
    readonly state?: "ready" | "override" | "missing";
    readonly manDays: number;
    readonly manDaysAi: number;
    readonly epics: readonly string[];
    readonly phases: readonly { readonly release: string; readonly epics: readonly string[] }[];
    readonly timeline: { readonly it: string; readonly en: string };
    readonly releases: readonly { readonly name: string; readonly manDays: number }[];
  } | null;
}

export type CostKind = CostLineAst["kind"];

export interface CostLineAnswer {
  unitCents?: number | null;
  percentBp?: number | null;
  quantity?: number | null;
  /** A `unit=perRelease` line: one entry per estimate release, the description editable. */
  releases?: { description: string; unitCents: number | null }[];
}

export interface WizardAnswers {
  v: 1;
  client: { lines: string[]; contactIds: string[]; place: string; date: string | null };
  fields: Record<string, string | number>;
  /** The last system prefill, to refresh values the person has not touched. */
  prefilled: Record<string, string | number>;
  /** Choices: exactly one option true. */
  blocks: Record<string, boolean>;
  lists: Record<string, string[]>;
  tables: Record<string, { id: string; cells: Record<string, string | number> }[]>;
  costs: {
    lines: Record<string, CostLineAnswer>;
    extra: {
      id: string;
      description: string;
      kind: CostKind;
      unitCents: number | null;
      percentBp: number | null;
      quantity: number;
    }[];
    columns: { position: boolean; unit: boolean };
    showTotals: boolean;
  };
  handEdits: Record<string, { heading: string; body: string; sourceHeading: string }>;
  /** Hand edits whose section the template no longer has (DD-17): kept to copy from, dropped at generation. */
  orphanedEdits: { heading: string; body: string }[];
  validityDays: number;
  aiAssisted: boolean;
  effortAnnex: boolean;
  attachmentIds: string[];
  lastStep: StepKey | "template" | "preview";
}

export const DEFAULT_VALIDITY_DAYS = 30;
const MAX_QUANTITY = 100_000;
/** The values the estimate gives, prefilled once into ordinary fields (AC-2.3). */
const ESTIMATE_SOURCES: readonly SystemSource[] = ["deal", "epics", "phases", "timeline", "manDays"];

// ─── The template, as the answers need it ───────────────────────────────────────

interface Shape {
  readonly fields: Map<string, FieldDecl>;
  readonly blocks: Map<string, BlockDecl>;
  readonly choiceOptions: Map<string, string>; // option block → its choice
  readonly choices: TemplateAst["choices"];
  readonly sectionKeys: Set<string>;
  readonly costLines: CostLineAst[];
  readonly costs: TemplateAst["sections"][number]["costs"];
}

function shapeOf(ast: TemplateAst): Shape {
  const choiceOptions = new Map<string, string>();
  for (const choice of ast.choices) for (const option of choice.options) if (!choiceOptions.has(option)) choiceOptions.set(option, choice.name);
  const sectionKeys = new Set<string>();
  const costs = ast.sections.find((section) => section.costs !== null)?.costs ?? null;
  for (const section of ast.sections) sectionKeys.add(section.key);
  for (const annex of ast.annexes) for (const section of annex.sections) sectionKeys.add(section.key);
  return {
    fields: new Map(ast.fields.map((field) => [field.name, field])),
    blocks: new Map(ast.blocks.map((block) => [block.name, block])),
    choiceOptions,
    choices: ast.choices,
    sectionKeys,
    costLines: costs ? costs.items.filter((item): item is CostLineAst => item.type === "line") : [],
    costs,
  };
}

/** A field whose value the answers hold: not derived, and not bound to what the client block or the system gives. */
function isStored(field: FieldDecl): boolean {
  if (field.compute) return false;
  return field.source === null || ESTIMATE_SOURCES.includes(field.source);
}

// ─── Values ──────────────────────────────────────────────────────────────────────

function canonicalDecimal(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)!;
  const whole = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const sign = match[1] === "-" && (whole !== "0" || fraction !== "") ? "-" : "";
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/** The template's text for a field → the canonical answer; null when it does not fit the field's kind. */
function toAnswer(field: FieldDecl, text: string, today: string | null): string | number | null {
  switch (field.kind) {
    case "amount": {
      const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
      return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
    }
    case "number":
    case "percentage":
      return /^-?\d{1,15}(\.\d{1,6})?$/.test(text) ? canonicalDecimal(text) : null;
    case "date":
      if (text === "today") return today;
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
    default:
      return field.options !== null && !field.options.includes(text) ? null : text;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setOrClear(fields: Record<string, string | number>, name: string, value: string | number | null): void {
  if (value === null || value === "") delete fields[name];
  else fields[name] = value;
}

/** Writes what a fill gives: a target that is not declared, derived or bound to the system is left alone, so is a value that does not fit. */
function applyFills(shape: Shape, answers: WizardAnswers, assigns: readonly { readonly name: string; readonly value: string }[]): void {
  for (const assign of assigns) {
    const target = shape.fields.get(assign.name);
    if (!target || !isStored(target) || target.source !== null) continue;
    if (assign.value === "") {
      delete answers.fields[assign.name];
      continue;
    }
    const value = toAnswer(target, assign.value, null);
    if (value !== null) answers.fields[assign.name] = value;
  }
}

function fillsOfOption(field: FieldDecl, option: string): readonly { readonly name: string; readonly value: string }[] {
  return field.fills.find((group) => group.option === option)?.assigns ?? [];
}

// ─── Cost lines of a deal ───────────────────────────────────────────────────────

const roundHalfUp = (value: number): number => Math.round(value + Number.EPSILON);

/**
 * The deal amount split across releases by expected man-days, in whole currency units: every line but the last
 * rounded half up to a multiple of 100 cents (never past what is left), the last takes the remainder. All zero
 * when the estimate has no man-days (specs/20261102-crm-offer-document D-13, same rule as the legacy prefill).
 */
function splitByManDays(totalCents: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (weights.length === 0 || !(sum > 0)) return weights.map(() => 0);
  let remaining = totalCents;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const units = roundHalfUp((totalCents * (weight / sum)) / 100);
    const cents = Math.min(units * 100, remaining);
    remaining -= cents;
    return cents;
  });
}

function costLineAnswers(shape: Shape, context: WizardContext): Record<string, CostLineAnswer> {
  const lines: Record<string, CostLineAnswer> = {};
  const manDays = context.estimate?.manDays ?? 0;
  for (const line of shape.costLines) {
    const entry: CostLineAnswer = {};
    if (line.unit.type === "deal") entry.unitCents = context.dealAmountCents;
    if (line.unit.type === "perRelease") {
      const releases = context.estimate?.releases ?? [];
      if (releases.length === 0) {
        entry.releases = [{ description: context.dealTitle, unitCents: context.dealAmountCents }];
      } else {
        const split =
          context.dealAmountCents === null
            ? releases.map(() => null)
            : splitByManDays(context.dealAmountCents, releases.map((release) => release.manDays));
        entry.releases = releases.map((release, index) => ({ description: release.name, unitCents: split[index] ?? null }));
      }
    }
    if (line.qty?.type === "manDays") entry.quantity = Math.min(Math.max(roundHalfUp(manDays), 1), MAX_QUANTITY);
    if (Object.keys(entry).length > 0) lines[line.key] = entry;
  }
  return lines;
}

// ─── Initial answers ─────────────────────────────────────────────────────────────

function systemValue(source: SystemSource, context: WizardContext): string {
  const estimate = context.estimate;
  switch (source) {
    case "deal":
      return context.dealTitle;
    case "epics":
      return (estimate?.epics ?? []).map((epic, index) => `${index + 1}. ${epic}`).join("\n");
    case "phases":
      return (estimate?.phases ?? []).map((phase) => `- ${phase.release}: ${phase.epics.join(", ")}`).join("\n");
    case "timeline":
      return estimate?.timeline[context.language] ?? "";
    case "manDays":
      return String(roundHalfUp(estimate?.manDays ?? 0));
    default:
      return "";
  }
}

/** The answers a person starts from: the deal's client block, the template's defaults and the estimate's values (AC-2.1, AC-2.3). */
export function initialAnswers(ast: TemplateAst, context: WizardContext): WizardAnswers {
  const shape = shapeOf(ast);
  const answers: WizardAnswers = {
    v: 1,
    client: { lines: [...context.clientLines[context.language]], contactIds: [], place: context.placeOfIssue, date: null },
    fields: {},
    prefilled: {},
    blocks: {},
    lists: {},
    tables: {},
    costs: {
      lines: costLineAnswers(shape, context),
      extra: [],
      columns: { position: shape.costs?.columns.position ?? false, unit: shape.costs?.columns.unit ?? false },
      showTotals: true,
    },
    handEdits: {},
    orphanedEdits: [],
    validityDays: DEFAULT_VALIDITY_DAYS,
    aiAssisted: false,
    effortAnnex: ast.effortAnnex,
    attachmentIds: [],
    lastStep: "client",
  };

  for (const field of ast.fields) {
    if (!isStored(field)) continue;
    if (field.source !== null) {
      const value = systemValue(field.source, context);
      if (value !== "") {
        answers.fields[field.name] = value;
        answers.prefilled[field.name] = value;
      }
    } else if (field.default !== null) {
      const value = toAnswer(field, field.default, context.today);
      if (value !== null) answers.fields[field.name] = value;
    }
  }
  for (const list of ast.lists) answers.lists[list.name] = [];
  for (const table of ast.tables) answers.tables[table.name] = [];
  for (const block of ast.blocks) if (!shape.choiceOptions.has(block.name)) answers.blocks[block.name] = block.default;
  for (const choice of ast.choices) chooseDefault(answers, choice);

  // what the defaults set: an option chosen by default, a block on by default, a choice's default option
  for (const field of ast.fields) {
    const chosen = answers.fields[field.name];
    if (typeof chosen === "string" && field.options !== null) applyFills(shape, answers, fillsOfOption(field, chosen));
  }
  for (const block of ast.blocks) if (answers.blocks[block.name] === true) applyFills(shape, answers, block.fills);
  return answers;
}

/** Exactly one option of a choice on: the default, or the first when there is none. */
function chooseDefault(answers: WizardAnswers, choice: TemplateAst["choices"][number]): void {
  const keep = choice.default !== null && choice.options.includes(choice.default) ? choice.default : choice.options[0];
  for (const option of choice.options) answers.blocks[option] = option === keep;
}

// ─── Changing an answer: the fills rule (decisions.md O3) ────────────────────────────

/**
 * Sets a field. Choosing an option that has fills sets each of its targets (AC-1.9); the targets of other
 * options, and everything else, keep their current values; choosing the option already chosen changes nothing.
 * A name that is not an editable field is ignored.
 */
export function setField(ast: TemplateAst, answers: WizardAnswers, name: string, value: string | number): WizardAnswers {
  const shape = shapeOf(ast);
  const field = shape.fields.get(name);
  const next = clone(answers);
  if (!field || !isStored(field)) return next;
  const before = next.fields[name];
  setOrClear(next.fields, name, value);
  if (typeof value === "string" && value !== "" && value !== before && field.options !== null) {
    applyFills(shape, next, fillsOfOption(field, value));
  }
  return next;
}

/** Switches a block. Switching it on sets what it fills; switching it off keeps every value. A block that is an option of a choice is changed with `chooseOption`. */
export function setBlock(ast: TemplateAst, answers: WizardAnswers, name: string, on: boolean): WizardAnswers {
  const shape = shapeOf(ast);
  const block = shape.blocks.get(name);
  const next = clone(answers);
  if (!block || shape.choiceOptions.has(name)) return next;
  const was = next.blocks[name] === true;
  next.blocks[name] = on;
  if (on && !was) applyFills(shape, next, block.fills);
  return next;
}

/** Chooses the option of a block choice: exactly one option is on, and the chosen one's fills are set unless it already was. */
export function chooseOption(ast: TemplateAst, answers: WizardAnswers, choiceName: string, option: string): WizardAnswers {
  const shape = shapeOf(ast);
  const choice = shape.choices.find((candidate) => candidate.name === choiceName);
  const next = clone(answers);
  if (!choice || !choice.options.includes(option)) return next;
  const was = next.blocks[option] === true;
  for (const other of choice.options) next.blocks[other] = other === option;
  if (!was) applyFills(shape, next, shape.blocks.get(option)?.fills ?? []);
  return next;
}

// ─── Following a template that changed ───────────────────────────────────────────────

/**
 * The answers against the current template (AC-8.4, AC-6.5): an answer whose item still exists is kept, one whose
 * item is gone is dropped and named, an item added since gets its default (a `default: today` date has no day to
 * take here, so it stays empty), a choice has exactly one option on, and a hand edit whose section is gone moves
 * to `orphanedEdits`. `dropped` names fields, blocks, lists and tables as written, a table column as `TABLE.COLUMN`
 * and a cost line as `cost:<key>`.
 */
export function reconcileAnswers(ast: TemplateAst, answers: WizardAnswers): { answers: WizardAnswers; dropped: string[] } {
  const shape = shapeOf(ast);
  const next = clone(answers);
  const dropped = new Set<string>();

  for (const name of Object.keys(next.fields)) {
    const field = shape.fields.get(name);
    if (!field || !isStored(field)) {
      delete next.fields[name];
      dropped.add(name);
    }
  }
  for (const name of Object.keys(next.prefilled)) {
    const field = shape.fields.get(name);
    if (!field || !isStored(field) || field.source === null) delete next.prefilled[name];
  }
  for (const field of ast.fields) {
    if (!isStored(field) || field.source !== null || field.default === null || field.name in next.fields) continue;
    const value = toAnswer(field, field.default, null);
    if (value !== null) next.fields[field.name] = value;
  }

  for (const name of Object.keys(next.blocks)) {
    if (!shape.blocks.has(name)) {
      delete next.blocks[name];
      dropped.add(name);
    }
  }
  for (const block of ast.blocks) {
    if (!(block.name in next.blocks)) next.blocks[block.name] = shape.choiceOptions.has(block.name) ? false : block.default;
  }
  for (const choice of ast.choices) {
    const on = choice.options.filter((option) => next.blocks[option] === true);
    if (on.length !== 1) chooseDefault(next, choice);
  }

  for (const name of Object.keys(next.lists)) {
    if (!ast.lists.some((list) => list.name === name)) {
      delete next.lists[name];
      dropped.add(name);
    }
  }
  for (const list of ast.lists) if (!(list.name in next.lists)) next.lists[list.name] = [];

  for (const name of Object.keys(next.tables)) {
    const table = ast.tables.find((candidate) => candidate.name === name);
    if (!table) {
      delete next.tables[name];
      dropped.add(name);
      continue;
    }
    for (const row of next.tables[name]!) {
      for (const column of Object.keys(row.cells)) {
        if (!table.columns.includes(column)) {
          delete row.cells[column];
          dropped.add(`${name}.${column}`);
        }
      }
    }
  }
  for (const table of ast.tables) if (!(table.name in next.tables)) next.tables[table.name] = [];

  for (const key of Object.keys(next.costs.lines)) {
    if (!shape.costLines.some((line) => line.key === key)) {
      delete next.costs.lines[key];
      dropped.add(`cost:${key}`);
    }
  }

  for (const [key, edit] of Object.entries(next.handEdits)) {
    if (!shape.sectionKeys.has(key)) {
      delete next.handEdits[key];
      next.orphanedEdits.push({ heading: edit.heading, body: edit.body });
    }
  }
  return { answers: next, dropped: [...dropped] };
}

/** Another template for the same deal (AC-6.5): the client block carries over, everything else starts again. */
export function switchTemplate(ast: TemplateAst, answers: WizardAnswers, context: WizardContext): WizardAnswers {
  const next = initialAnswers(ast, context);
  next.client = clone(answers.client);
  return next;
}

// ─── Sample answers (AC-8.5) ─────────────────────────────────────────────────────────

const SAMPLE_TODAY = "2026-01-15";

/** A made-up deal for previewing a template with no deal: nothing of it is real, and it never leaves the browser. */
export function sampleContext(language: OfferLanguage): WizardContext {
  return {
    language,
    today: SAMPLE_TODAY,
    dealTitle: language === "it" ? "Progetto di esempio" : "Sample project",
    currency: "CHF",
    dealAmountCents: 1_000_000,
    issuerLegalName: language === "it" ? "Fornitore di esempio SA" : "Sample Supplier Ltd",
    issuerAddressLines: ["Via Esempio 2", "6900 Lugano"],
    placeOfIssue: "Lugano",
    clientLines: {
      it: ["Cliente di esempio SA", "Via Esempio 1", "6900 Lugano", "Svizzera"],
      en: ["Sample Client Ltd", "Via Esempio 1", "6900 Lugano", "Switzerland"],
    },
    contacts: [{ id: "sample-contact", name: "Mario Rossi" }],
    attachments: [],
    estimate: {
      state: "ready",
      manDays: 40,
      manDaysAi: 30,
      epics: [language === "it" ? "Epic di esempio" : "Sample epic"],
      phases: [{ release: "Release 1", epics: [language === "it" ? "Epic di esempio" : "Sample epic"] }],
      timeline: { it: "| Fase | Durata |\n| Release 1 | 4 settimane |", en: "| Phase | Duration |\n| Release 1 | 4 weeks |" },
      releases: [
        { name: "Release 1", manDays: 20 },
        { name: "Release 2", manDays: 20 },
      ],
    },
  };
}

/** Every item the template asks for answered with a sample value, so the preview shows a complete document. */
export function sampleAnswers(ast: TemplateAst, language: OfferLanguage): WizardAnswers {
  const context = sampleContext(language);
  const shape = shapeOf(ast);
  const answers = initialAnswers(ast, context);
  answers.client.contactIds = context.contacts.slice(0, 1).map((contact) => contact.id);

  for (const field of ast.fields) {
    if (!isStored(field) || field.name in answers.fields) continue;
    let value: string | number;
    if (field.options !== null) value = field.options[0]!;
    else if (field.kind === "amount") value = 100_000;
    else if (field.kind === "number" || field.kind === "percentage") value = "10";
    else if (field.kind === "date") value = SAMPLE_TODAY;
    else value = field.example ?? field.label ?? field.name;
    answers.fields[field.name] = value;
  }
  for (const list of ast.lists) {
    if (answers.lists[list.name]!.length === 0) {
      answers.lists[list.name] = [1, 2].map((n) => `${list.label ?? list.name} ${n}`);
    }
  }
  for (const table of ast.tables) {
    if (answers.tables[table.name]!.length > 0) continue;
    answers.tables[table.name] = [1, 2].map((n) => {
      const cells: Record<string, string | number> = {};
      table.columns.forEach((column, index) => {
        const field = index === 0 ? undefined : shape.fields.get(column);
        if (index === 0) cells[column] = `${table.label ?? table.name} ${n}`;
        else if (field?.kind === "amount") cells[column] = 100_000;
        else if (field?.kind === "number" || field?.kind === "percentage") cells[column] = "10";
        else cells[column] = `${field?.label ?? column} ${n}`;
      });
      return { id: `row${n}`, cells };
    });
  }
  for (const line of shape.costLines) {
    const entry: CostLineAnswer = { ...answers.costs.lines[line.key] };
    if (line.unit.type === "entered") entry.unitCents = line.kind === "discount" ? 5_000 : line.kind === "option" ? 15_000 : 100_000;
    if (line.qty?.type === "entered") entry.quantity = 1;
    if (Object.keys(entry).length > 0) answers.costs.lines[line.key] = entry;
  }
  return answers;
}

// ─── Checks on what a person typed ───────────────────────────────────────────────────

export interface AnswerIssue {
  readonly path: string;
  readonly code: "reserved_character" | "not_an_option";
}

const RESERVED = /[-⟦⟧]/;
/** The reference-token brackets U+27EA / U+27EB: refused everywhere except as the exact token in a hand edit's body (DD-52). */
const REFERENCE_BRACKETS = /[⟪⟫]/;
const IDENTIFIER =/^[A-Za-zÀ-ÿ_][A-Za-z0-9À-ÿ_]*$/;
const WALK_ORDER = ["client", "fields", "prefilled", "lists", "tables", "costs", "handEdits", "orphanedEdits", "attachmentIds"];
const MAX_WALK_DEPTH = 16;

function child(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  if (IDENTIFIER.test(key)) return path === "" ? key : `${path}.${key}`;
  return `${path}[${JSON.stringify(key)}]`;
}

/**
 * What is wrong with the text in the answers, with its JSON path: a reserved character (U+E000–U+E0FF, "⟦", "⟧" —
 * they mean something to the engine and are never typed, AC-5.2, DD-30; likewise "⟪" and "⟫" except an exact
 * reference token in the `body` of a hand edit or an orphaned edit, DD-52: there the check runs on the value with
 * every exact token removed, left to right, so a doubled, lower-case or lone bracket is still refused) anywhere in a value, and, with
 * `options` (the default), a text value outside the options of its field (AC-1.8). An empty value is not an
 * option violation: it is missing. A server leaves `options` out for a draft saved against an older version of
 * the template (DD-38).
 */
export function checkAnswers(ast: TemplateAst, answers: WizardAnswers, check: { options?: boolean } = {}): AnswerIssue[] {
  const issues: AnswerIssue[] = [];
  // `kind`: where the walk is, so the one place the reference token may stand (a hand edit's or an orphaned edit's
  // body, DD-52) is known: "handEdits" / "orphanedEdits" at the top, "edit" for one edit, "body" for its body
  const visit = (value: unknown, path: string, depth: number, kind: string = ""): void => {
    if (typeof value === "string") {
      const text = kind === "body" ? value.split(REFERENCE_TOKEN).join("") : value;
      if (RESERVED.test(text) || REFERENCE_BRACKETS.test(text)) issues.push({ path, code: "reserved_character" });
    } else if (depth < MAX_WALK_DEPTH && Array.isArray(value)) {
      value.forEach((item, index) => visit(item, child(path, index), depth + 1, kind === "orphanedEdits" ? "edit" : ""));
    } else if (depth < MAX_WALK_DEPTH && value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        const next = kind === "handEdits" ? "edit" : kind === "edit" && key === "body" ? "body" : "";
        visit(item, child(path, key), depth + 1, next);
      }
    }
  };
  const record = answers as unknown as Record<string, unknown>;
  const keys = [...WALK_ORDER.filter((key) => key in record), ...Object.keys(record).filter((key) => !WALK_ORDER.includes(key))];
  for (const key of keys) visit(record[key], key, 0, key === "handEdits" || key === "orphanedEdits" ? key : "");

  if (check.options !== false) {
    for (const field of ast.fields) {
      const value = answers.fields[field.name];
      if (field.options !== null && typeof value === "string" && value !== "" && !field.options.includes(value)) {
        issues.push({ path: child("fields", field.name), code: "not_an_option" });
      }
    }
  }
  return issues;
}
// shared-copy:end offerEngine.answers
