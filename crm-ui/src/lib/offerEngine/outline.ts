/**
 * What the wizard asks for a template, per step (specs/20261115-crm-offer-wizard AC-1.2 to AC-1.5, AC-8.2;
 * DD-33). One function for both screens: `outline(ast, null)` is the editor's — every item the text uses, nested
 * under its block whatever the block's state — and `outline(ast, answers)` the wizard's — only what is shown now.
 *
 * Where an item goes: at its first occurrence in the text whose blocks are all on (the editor: its first
 * occurrence), in that occurrence's step unless the declaration says `step:`. A `?`/`!` condition does not hide
 * an item (an empty field must stay fillable); a block does. An item is nested under the innermost block that
 * encloses that occurrence, when that block is an item of the same step and comes earlier in the text; the
 * options of a choice are not items of their own — what sits inside one is listed beside the choice.
 *
 * What is not an item: a field that is declared and never used, and a field the client block or the system gives
 * (`source:` client, clientAddress, contacts, place, date, reference, issuer, issuerAddress, currency) — the wizard edits those
 * in its own places. A field used only by the cost table (a description, a unit, a quantity, `each=`) is an item
 * of the step that holds the table. A step with nothing to ask is left out.
 *
 * Pure; no I/O.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.outline).
 */
// shared-copy:begin offerEngine.outline
import type { WizardAnswers } from "./answers";
import {
  STEP_KEYS,
  type Cond,
  type CostKind,
  type FieldKind,
  type Inline,
  type StepKey,
  type SystemSource,
  type TemplateAst,
} from "./syntax";

export type OutlineItem =
  | {
      type: "field";
      name: string;
      label: string;
      hint: string | null;
      example: string | null;
      kind: FieldKind;
      default: string | null;
      options: string[] | null;
      /** Every use of it sits in a `{{?…}}` naming it (or only conditions name it): never missing (AC-1.3). */
      optional: boolean;
      /** Has `compute:`: shown read-only, never missing (AC-4.5). */
      derived: boolean;
      system: SystemSource | null;
      fills: { option: string; assigns: { name: string; label: string; value: string }[] }[];
      /** The hand-edited sections that read it (AC-5.2); always [] for the editor. */
      handEditedIn: string[];
    }
  | { type: "list"; name: string; label: string; hint: string | null; optional: boolean; handEditedIn: string[] }
  | {
      type: "table";
      name: string;
      label: string;
      hint: string | null;
      optional: boolean;
      columns: { name: string; label: string; kind: FieldKind; required: boolean }[];
      handEditedIn: string[];
    }
  | {
      type: "block";
      name: string;
      label: string;
      explain: string | null;
      default: boolean;
      fills: { name: string; label: string; value: string }[];
      children: OutlineItem[];
    }
  | {
      type: "choice";
      name: string;
      label: string;
      default: string;
      options: { block: string; label: string; fills: { name: string; label: string; value: string }[] }[];
    }
  | {
      type: "costTable";
      lines: { key: string; kind: CostKind; each: string | null; block: string | null }[];
      /** The total rows' labels, in order, without markup. */
      totals: string[];
    };

export interface Outline {
  steps: {
    key: StepKey;
    /** The step's sections in text order; annex = the designation of a text annex's section. */
    sections: { key: string; heading: string; annex: string | null }[];
    items: OutlineItem[];
  }[];
}

/** Sources the wizard edits in its own places (the Client step, the header), never as a template field. */
const OWN_PLACE_SOURCES: readonly SystemSource[] = ["client", "clientAddress", "contacts", "place", "date", "reference", "issuer", "issuerAddress", "currency"];

const COSTS = "@costs";

interface Occurrence {
  readonly step: StepKey;
  /** The section whose text holds it; null for the opening, an annex's head and the cost table. */
  readonly section: string | null;
  /** The blocks that must be on for it to be printed, outermost first. */
  readonly chain: readonly string[];
  readonly optional: boolean;
  readonly order: number;
}

interface Where {
  readonly step: StepKey;
  readonly section: string | null;
}

/** The text of inline nodes without markup, for a label. */
function plainText(nodes: readonly Inline[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.text.replace(/\\[\s\S]|\*\*|__|\*/g, (match) => (match[0] === "\\" ? match[1]! : ""));
    else if (node.type === "field") out += `[${node.name}]`;
    else out += plainText(node.children);
  }
  return out;
}

export function outline(ast: TemplateAst, answers: WizardAnswers | null): Outline {
  const fields = new Map(ast.fields.map((field) => [field.name, field]));
  const lists = new Map(ast.lists.map((list) => [list.name, list]));
  const tables = new Map(ast.tables.map((table) => [table.name, table]));
  const blocks = new Map(ast.blocks.map((block) => [block.name, block]));
  const choices = new Map(ast.choices.map((choice) => [choice.name, choice]));
  const choiceOf = new Map<string, string>();
  for (const choice of ast.choices) for (const option of choice.options) if (blocks.has(option) && !choiceOf.has(option)) choiceOf.set(option, choice.name);
  const columnOf = new Map<string, string>();
  for (const table of ast.tables) for (const column of table.columns.slice(1)) if (fields.has(column) && !columnOf.has(column)) columnOf.set(column, table.name);

  /** The item a name stands for: a field, a list or a table (a column is its table); null when it asks nothing. */
  const itemOf = (name: string): string | null => {
    const table = columnOf.get(name);
    if (table !== undefined) return table;
    const field = fields.get(name);
    if (field) return field.source !== null && OWN_PLACE_SOURCES.includes(field.source) ? null : name;
    return lists.has(name) || tables.has(name) ? name : null;
  };

  const occurrences = new Map<string, Occurrence[]>();
  let order = 0;
  const add = (item: string, where: Where, chain: readonly string[], optional: boolean): void => {
    const list = occurrences.get(item);
    const occurrence: Occurrence = { step: where.step, section: where.section, chain, optional, order: order++ };
    if (list) list.push(occurrence);
    else occurrences.set(item, [occurrence]);
  };
  const addBlock = (name: string, where: Where, chain: readonly string[]): void => {
    if (blocks.has(name)) add(choiceOf.get(name) ?? name, where, chain, false);
  };
  const registerCond = (cond: Cond, where: Where, chain: readonly string[]): void => {
    for (const name of cond.names) {
      if (cond.op === "on") addBlock(name, where, chain);
      else {
        const item = itemOf(name);
        if (item !== null) add(item, where, chain, true);
      }
    }
  };
  const onNames = (conds: readonly Cond[]): string[] => conds.filter((cond) => cond.op === "on").flatMap((cond) => cond.names);
  const anyNames = (conds: readonly Cond[]): string[] => conds.filter((cond) => cond.op === "any").flatMap((cond) => cond.names);

  const seenConds = new Set<Cond>();
  /** The conditions of the blocks open at an element: a block is an occurrence the first time it is seen. */
  const sight = (conds: readonly Cond[], where: Where): void => {
    const chain: string[] = [];
    for (const cond of conds) {
      if (!seenConds.has(cond)) {
        seenConds.add(cond);
        registerCond(cond, where, [...chain]);
      }
      if (cond.op === "on") chain.push(...cond.names);
    }
  };
  const walk = (nodes: readonly Inline[], where: Where, chain: readonly string[], any: readonly string[]): void => {
    for (const node of nodes) {
      if (node.type === "field") {
        const item = itemOf(node.name);
        if (item !== null) add(item, where, chain, any.includes(node.name) || any.includes(item));
      } else if (node.type === "cond") {
        registerCond(node.cond, where, chain);
        walk(
          node.children,
          where,
          node.cond.op === "on" ? [...chain, ...node.cond.names] : chain,
          node.cond.op === "any" ? [...any, ...node.cond.names] : any,
        );
      }
    }
  };
  const walkConds = (nodes: readonly Inline[], conds: readonly Cond[], where: Where): void => {
    walk(nodes, where, onNames(conds), anyNames(conds));
  };

  const openingStep: StepKey = ast.sections[0]?.step ?? "scope";
  const costsSection = ast.sections.find((section) => section.costs !== null);
  for (const line of ast.opening) {
    const where = { step: openingStep, section: null };
    sight(line.conds, where);
    walkConds(line.nodes, line.conds, where);
  }
  const walkSection = (section: TemplateAst["sections"][number]): void => {
    const where: Where = { step: section.step, section: section.key };
    sight(section.conds, where);
    walkConds(section.headingNodes, section.conds, where);
    const costs = section.costs;
    if (costs) {
      const here: Where = { step: section.step, section: null };
      add(COSTS, here, onNames(costs.conds), false);
      sight(costs.conds, here);
      if (costs.labels) {
        walkConds(costs.labels.unit, costs.conds, here);
        if (costs.labels.quantity) walkConds(costs.labels.quantity, costs.conds, here);
      }
      for (const item of costs.items) {
        sight(item.conds, here);
        if (item.type === "total") {
          walkConds(item.label, item.conds, here);
          continue;
        }
        walkConds(item.description, item.conds, here);
        const chain = onNames(item.conds);
        const any = anyNames(item.conds);
        for (const name of [item.each, item.unit.type === "field" ? item.unit.name : null, item.qty?.type === "field" ? item.qty.name : null]) {
          const target = name === null ? null : itemOf(name);
          if (target !== null) add(target, here, chain, any.includes(name!) || any.includes(target));
        }
      }
    }
    for (const line of section.body) {
      sight(line.conds, where);
      walkConds(line.nodes, line.conds, where);
    }
  };
  ast.sections.forEach(walkSection);
  for (const annex of ast.annexes) {
    const where: Where = { step: "annexes", section: null };
    sight(annex.conds, where);
    walkConds(annex.title, annex.conds, where);
    if (annex.subtitle) walkConds(annex.subtitle, annex.conds, where);
    for (const line of annex.intro) {
      sight(line.conds, where);
      walkConds(line.nodes, line.conds, where);
    }
    annex.sections.forEach(walkSection);
  }

  const isOn = (name: string): boolean => answers === null || answers.blocks[name] === true;

  // ── where each item goes ──
  interface Placed {
    readonly key: string;
    readonly step: StepKey;
    readonly occurrence: Occurrence;
    readonly all: readonly Occurrence[];
    item: OutlineItem;
    parent: string | null;
  }
  const placed = new Map<string, Placed>();
  const stepOverride = (key: string): StepKey | null =>
    fields.get(key)?.step ?? lists.get(key)?.step ?? tables.get(key)?.step ?? blocks.get(key)?.step ?? choices.get(key)?.step ?? null;

  const handEditedIn = (all: readonly Occurrence[]): string[] => {
    if (answers === null) return [];
    const sections: string[] = [];
    for (const occurrence of all) {
      if (occurrence.section !== null && occurrence.section in answers.handEdits && !sections.includes(occurrence.section)) sections.push(occurrence.section);
    }
    return sections;
  };
  const labelOf = (name: string): string => fields.get(name)?.label ?? name;
  const assigns = (list: readonly { name: string; value: string }[]) => list.map((assign) => ({ name: assign.name, label: labelOf(assign.name), value: assign.value }));
  const requiredColumns = new Set<string>();
  for (const line of costsSection?.costs?.items ?? []) {
    if (line.type !== "line") continue;
    if (line.unit.type === "field") requiredColumns.add(line.unit.name);
    if (line.qty?.type === "field") requiredColumns.add(line.qty.name);
  }

  for (const [key, all] of occurrences) {
    const chosen = all.find((occurrence) => occurrence.chain.every(isOn));
    if (!chosen) continue;
    const step = stepOverride(key) ?? chosen.step;
    const optional = all.every((occurrence) => occurrence.optional);
    let item: OutlineItem;
    const field = fields.get(key);
    const list = lists.get(key);
    const table = tables.get(key);
    const block = blocks.get(key);
    const choice = choices.get(key);
    if (key === COSTS) {
      const costs = costsSection!.costs!;
      const shown = (conds: readonly Cond[]) => onNames(conds).every(isOn);
      item = {
        type: "costTable",
        lines: costs.items
          .filter((entry) => entry.type === "line" && shown(entry.conds))
          .map((entry) => {
            const line = entry as Extract<typeof entry, { type: "line" }>;
            const blockNames = onNames(line.conds);
            return { key: line.key, kind: line.kind, each: line.each, block: blockNames.length > 0 ? blockNames[blockNames.length - 1]! : null };
          }),
        totals: costs.items.filter((entry) => entry.type === "total" && shown(entry.conds)).map((entry) => plainText((entry as Extract<typeof entry, { type: "total" }>).label)),
      };
    } else if (field) {
      item = {
        type: "field",
        name: key,
        label: field.label ?? key,
        hint: field.hint,
        example: field.example,
        kind: field.kind,
        default: field.default,
        options: field.options,
        optional,
        derived: field.compute !== null,
        system: field.source,
        fills: field.fills.map((group) => ({ option: group.option, assigns: assigns(group.assigns) })),
        handEditedIn: handEditedIn(all),
      };
    } else if (list) {
      item = { type: "list", name: key, label: list.label ?? key, hint: list.hint, optional, handEditedIn: handEditedIn(all) };
    } else if (table) {
      item = {
        type: "table",
        name: key,
        label: table.label ?? key,
        hint: table.hint,
        optional,
        columns: table.columns.map((column, index) =>
          index === 0
            ? { name: column, label: table.label ?? column, kind: "text" as FieldKind, required: true }
            : { name: column, label: labelOf(column), kind: fields.get(column)?.kind ?? "text", required: requiredColumns.has(column) },
        ),
        handEditedIn: handEditedIn(all),
      };
    } else if (block) {
      item = { type: "block", name: key, label: block.label ?? key, explain: block.explain, default: block.default, fills: assigns(block.fills), children: [] };
    } else if (choice) {
      item = {
        type: "choice",
        name: key,
        label: choice.label ?? key,
        default: choice.default ?? choice.options[0] ?? "",
        options: choice.options.map((option) => ({ block: option, label: blocks.get(option)?.label ?? option, fills: assigns(blocks.get(option)?.fills ?? []) })),
      };
    } else {
      continue;
    }

    // nested under the innermost block of the occurrence that is an item itself (a choice's option is not)
    let parent: string | null = null;
    for (let index = chosen.chain.length - 1; index >= 0; index--) {
      const name = chosen.chain[index]!;
      if (blocks.has(name) && !choiceOf.has(name)) {
        parent = name;
        break;
      }
    }
    placed.set(key, { key, step, occurrence: chosen, all, item, parent: parent === key ? null : parent });
  }

  // a parent counts when it is placed in the same step, earlier in the text: no cycle is possible
  const children = new Map<string, Placed[]>();
  const top = new Map<StepKey, Placed[]>();
  const byOrder = [...placed.values()].sort((a, b) => a.occurrence.order - b.occurrence.order);
  for (const entry of byOrder) {
    const parent = entry.parent === null ? undefined : placed.get(entry.parent);
    const nested = parent !== undefined && parent.step === entry.step && parent.occurrence.order < entry.occurrence.order && parent.item.type === "block";
    const bucket = nested ? (children.get(parent!.key) ?? children.set(parent!.key, []).get(parent!.key)!) : (top.get(entry.step) ?? top.set(entry.step, []).get(entry.step)!);
    bucket.push(entry);
  }
  const build = (entry: Placed): OutlineItem => {
    if (entry.item.type === "block") entry.item.children = (children.get(entry.key) ?? []).map(build);
    return entry.item;
  };

  // ── sections of each step ──
  const sectionsOf = new Map<StepKey, Outline["steps"][number]["sections"]>();
  const addSection = (section: TemplateAst["sections"][number], annex: string | null): void => {
    if (!onNames(section.conds).every(isOn)) return;
    const list = sectionsOf.get(section.step) ?? sectionsOf.set(section.step, []).get(section.step)!;
    list.push({ key: section.key, heading: section.heading, annex });
  };
  ast.sections.forEach((section) => addSection(section, null));
  for (const annex of ast.annexes) annex.sections.forEach((section) => addSection(section, annex.designation));

  const steps: Outline["steps"] = [];
  for (const key of STEP_KEYS) {
    const items = (top.get(key) ?? []).map(build);
    if (items.length === 0) continue;
    const sections = [...(sectionsOf.get(key) ?? [])];
    sections.sort((a, b) => sectionLine(ast, a.key) - sectionLine(ast, b.key));
    steps.push({ key, sections, items });
  }
  return { steps };
}

/** A section's line, to keep contract sections and annex sections in text order within a step. */
function sectionLine(ast: TemplateAst, key: string): number {
  for (const section of ast.sections) if (section.key === key) return section.line;
  for (const annex of ast.annexes) for (const section of annex.sections) if (section.key === key) return section.line;
  return 0;
}
/**
 * The fields the CRM supplies and the wizard never asks (AC-12.1, AC-12.9, DD-58): declared fields bound to `issuer` or
 * `issuerAddress` that the text uses — a `[NAME]` or a condition naming it, in the opening, a heading, a section, a
 * cost line or total, an annex — each once, in order of first use. The editor lists them as "supplied by the CRM".
 * `outline()` itself is unchanged: such a field is not an item (OWN_PLACE_SOURCES).
 */
export function suppliedFields(ast: TemplateAst): { name: string; label: string | null; source: "issuer" | "issuerAddress" }[] {
  const fields = new Map(ast.fields.map((field) => [field.name, field]));
  const found = new Map<string, { name: string; label: string | null; source: "issuer" | "issuerAddress" }>();
  const note = (name: string): void => {
    const field = fields.get(name);
    if (field && (field.source === "issuer" || field.source === "issuerAddress") && !found.has(name)) {
      found.set(name, { name, label: field.label, source: field.source });
    }
  };
  const conds = (list: readonly Cond[]): void => list.forEach((cond) => cond.names.forEach(note));
  const nodes = (list: readonly Inline[]): void => {
    for (const node of list) {
      if (node.type === "field") note(node.name);
      else if (node.type === "cond") {
        conds([node.cond]);
        nodes(node.children);
      }
    }
  };
  const lines = (list: readonly { conds: readonly Cond[]; nodes: readonly Inline[] }[]): void => {
    for (const line of list) {
      conds(line.conds);
      nodes(line.nodes);
    }
  };
  const section = (source: TemplateAst["sections"][number]): void => {
    conds(source.conds);
    nodes(source.headingNodes);
    const costs = source.costs;
    if (costs) {
      conds(costs.conds);
      if (costs.labels) {
        nodes(costs.labels.unit);
        if (costs.labels.quantity) nodes(costs.labels.quantity);
      }
      for (const item of costs.items) {
        conds(item.conds);
        nodes(item.type === "total" ? item.label : item.description);
      }
    }
    lines(source.body);
  };
  lines(ast.opening);
  ast.sections.forEach(section);
  for (const annex of ast.annexes) {
    conds(annex.conds);
    nodes(annex.title);
    if (annex.subtitle) nodes(annex.subtitle);
    lines(annex.intro);
    annex.sections.forEach(section);
  }
  return [...found.values()];
}
// shared-copy:end offerEngine.outline
