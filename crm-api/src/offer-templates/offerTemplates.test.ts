import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, resetWorld } from "../test-support/world";
import { DEFAULT_TEMPLATES_IT } from "../offers/defaultTemplates";
import { DEFAULT_TEMPLATES_EN } from "../offers/defaultTemplates.en";
import { TemplateContentSchema } from "../offers/offerSchemas";

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;
const KNOWN = new Set(["deal", "issuer", "client", "currency", "epics", "phases", "timeline", "manDays", "validityDays", "release"]);
const placeholdersOf = (value: unknown): string[] =>
  [...JSON.stringify(value).matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();

describe("the seeded defaults (specs/020 AC-2.3)", () => {
  it("are seven Italian and seven English templates, each valid under the template schema", () => {
    expect(DEFAULT_TEMPLATES_IT).toHaveLength(7);
    expect(DEFAULT_TEMPLATES_EN).toHaveLength(7);
    for (const template of [...DEFAULT_TEMPLATES_IT, ...DEFAULT_TEMPLATES_EN]) {
      const parsed = TemplateContentSchema.safeParse(template);
      expect(parsed.success, `${template.name}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
    expect(DEFAULT_TEMPLATES_EN.map((t) => t.name)).toEqual([
      "Fixed-price project",
      "One-off + prepaid SLA",
      "Training",
      "MVP without maintenance",
      "Change request with maintenance package",
      "Phased fixed price",
      "Consulting by the day",
    ]);
    expect(DEFAULT_TEMPLATES_EN.every((t) => t.language === "en" && t.salutation === "To")).toBe(true);
  });

  it("use only known placeholders, and each translation keeps its original's placeholders and structure", () => {
    DEFAULT_TEMPLATES_IT.forEach((it, index) => {
      const en = DEFAULT_TEMPLATES_EN[index]!;
      expect(new Set(placeholdersOf(it)).size).toBeGreaterThan(0);
      for (const name of placeholdersOf(it)) expect(KNOWN.has(name)).toBe(true);
      expect(new Set(placeholdersOf(en))).toEqual(new Set(placeholdersOf(it)));
      expect(en.sections.map((s) => s.costs)).toEqual(it.sections.map((s) => s.costs));
      expect(en.costLines.map((l) => [l.kind, l.amount, l.quantity])).toEqual(it.costLines.map((l) => [l.kind, l.amount, l.quantity]));
      expect(en.costColumns).toEqual(it.costColumns);
      expect([en.showTotal, en.annex, en.acceptanceLabel === null]).toEqual([it.showTotal, it.annex, it.acceptanceLabel === null]);
      // no Italian heading left behind
      expect(en.sections.map((s) => s.heading)).not.toContain("Costi");
    });
  });
});

describe("offer templates (specs/020 US-2)", () => {
  beforeEach(resetWorld);

  const list = async (entity = "welld_ch", extra = "", as: "admin" | "salesCh" = "admin") =>
    call("GET", `/offer-templates?entity=${entity}${extra}`, { as });
  const first = async (name: string, entity = "welld_ch") =>
    (await list(entity, "&includeArchived=true")).json.items.find((t: { name: string }) => t.name === name);
  const content = (over: Record<string, unknown> = {}) => ({
    name: "Custom",
    language: "en",
    salutation: "To",
    opening: "Dear client",
    sections: [{ heading: "Costs", body: "Notes", costs: true }],
    costLines: [{ description: "Work", kind: "one_off", amount: "deal", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: null,
    annex: false,
    ...over,
  });
  const create = (over: Record<string, unknown> = {}, as: "admin" | "salesCh" | "managerNoMoney" = "admin", entity = "welld_ch") =>
    call("POST", "/offer-templates", { as, body: { entity, ...content(over) } });

  it("seeds fourteen on the first read of an entity, once, even with concurrent first reads", async () => {
    const reads = await Promise.all(Array.from({ length: 6 }, () => list()));
    expect(reads.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch" } })).toBe(14);
    const items = reads[0]!.json.items;
    expect(items).toHaveLength(14);
    expect(items.filter((t: { language: string }) => t.language === "it")).toHaveLength(7);
    expect(items[0]).toMatchObject({ entity: "welld_ch", version: 1, archived: false, updatedBy: { id: "system:crm-api", status: "system" } });
    // the other entity is untouched until it is read
    expect(await db.offerTemplate.count({ where: { entity: "welld_it" } })).toBe(0);
    expect((await list("welld_it")).json.items).toHaveLength(14);
    // reading again inserts nothing
    await list();
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch" } })).toBe(14);
  });

  it("does not seed again once the entity has templates, even when all are archived", async () => {
    for (const t of (await list()).json.items) {
      await call("POST", `/offer-templates/${t.id}/archive`, { ifMatch: t.version });
    }
    expect((await list()).json.items).toHaveLength(0);
    expect((await list("welld_ch", "&includeArchived=true")).json.items).toHaveLength(14);
  });

  it("is readable by deal:financials holders of either entity, and by no one else", async () => {
    expect((await list("welld_it", "", "salesCh")).status).toBe(200);
    const id = (await list()).json.items[0].id;
    expect((await call("GET", `/offer-templates/${id}`, { as: "salesCh" })).headers.get("ETag")).toBe('"1"');
    expect((await call("GET", "/offer-templates?entity=welld_ch", { as: "consultant" })).status).toBe(403);
    expect((await call("GET", "/offer-templates?entity=welld_ch", { as: "managerNoMoney" })).status).toBe(403);
    expect((await call("GET", "/offer-templates?entity=nope")).status).toBe(422);
    expect((await call("GET", "/offer-templates/missing")).status).toBe(404);
  });

  it("creates a template; names are unique among the active ones of an entity, case-insensitively", async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ entity: "welld_ch", name: "Custom", version: 1, archived: false });
    expect(created.headers.get("ETag")).toBe('"1"');
    expect((await create({ name: "custom" })).json).toMatchObject({ status: 409, code: "template_name_taken" });
    // another entity may use it; an archived template frees its name
    expect((await create({}, "admin", "welld_it")).status).toBe(201);
    await call("POST", `/offer-templates/${created.json.id}/archive`, { ifMatch: 1 });
    expect((await create()).status).toBe(201);
    // ...and then restoring the old one would collide
    const restore = await call("POST", `/offer-templates/${created.json.id}/restore`, { ifMatch: 2 });
    expect(restore.json.code).toBe("template_name_taken");
  });

  it("writes need deal:manage over the entity (403 out_of_scope, the template being readable) and deal:financials", async () => {
    expect((await create({}, "salesCh", "welld_it")).json.code).toBe("out_of_scope");
    expect((await create({}, "salesCh")).status).toBe(201);
    expect((await create({ name: "x" }, "managerNoMoney")).status).toBe(403);
    const itTemplate = (await list("welld_it")).json.items[0];
    const body = content({ name: "Edited" });
    expect((await call("PUT", `/offer-templates/${itTemplate.id}`, { as: "salesCh", body, ifMatch: 1 })).json.code).toBe("out_of_scope");
    expect((await call("POST", `/offer-templates/${itTemplate.id}/archive`, { as: "salesCh", ifMatch: 1 })).json.code).toBe("out_of_scope");
    expect((await call("POST", `/offer-templates/${itTemplate.id}/duplicate`, { as: "salesCh" })).json.code).toBe("out_of_scope");
    expect((await call("PUT", `/offer-templates/${itTemplate.id}`, { as: "consultant", body, ifMatch: 1 })).status).toBe(403);
  });

  it("PUT replaces the content and needs If-Match: 428 without, 409 when stale, a bumped version when current", async () => {
    const t = (await create()).json;
    const edit = content({ name: "Custom v2", salutation: "Dear", annex: true });
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: edit })).status).toBe(428);
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: edit, ifMatch: 7 })).json).toMatchObject({ status: 409, code: "version_conflict", currentVersion: 1 });
    const saved = await call("PUT", `/offer-templates/${t.id}`, { body: edit, ifMatch: 1 });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ name: "Custom v2", salutation: "Dear", annex: true, version: 2 });
    expect(saved.headers.get("ETag")).toBe('"2"');
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: edit, ifMatch: 1 })).status).toBe(409);
    expect((await call("PUT", "/offer-templates/missing", { body: edit, ifMatch: 1 })).status).toBe(404);
    // renaming onto another active template's name
    await create({ name: "Other" });
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: content({ name: "other" }), ifMatch: 2 })).json.code).toBe("template_name_taken");
  });

  it("a stale write loses against a concurrent one (one winner)", async () => {
    const t = (await create()).json;
    const results = await Promise.all([
      call("PUT", `/offer-templates/${t.id}`, { body: content({ name: "A" }), ifMatch: 1 }),
      call("PUT", `/offer-templates/${t.id}`, { body: content({ name: "B" }), ifMatch: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("duplicates under a fresh name, again and again", async () => {
    const training = await first("Training");
    const one = await call("POST", `/offer-templates/${training.id}/duplicate`);
    expect(one.status).toBe(201);
    expect(one.json).toMatchObject({ name: "Training (copy)", version: 1, sections: training.sections, costLines: training.costLines });
    const two = await call("POST", `/offer-templates/${training.id}/duplicate`);
    expect(two.json.name).toBe("Training (copy) 2");
    const it = await first("Formazione");
    expect((await call("POST", `/offer-templates/${it.id}/duplicate`)).json.name).toBe("Formazione (copia)");
  });

  it("archived templates leave the list (unless asked for) and can be restored; If-Match is required", async () => {
    const t = await first("Training");
    expect((await call("POST", `/offer-templates/${t.id}/archive`)).status).toBe(428);
    const archived = await call("POST", `/offer-templates/${t.id}/archive`, { ifMatch: 1 });
    expect(archived.json).toMatchObject({ archived: true, version: 2 });
    expect((await list()).json.items.map((x: { name: string }) => x.name)).not.toContain("Training");
    expect((await list("welld_ch", "&includeArchived=true")).json.items.map((x: { name: string }) => x.name)).toContain("Training");
    const restored = await call("POST", `/offer-templates/${t.id}/restore`, { ifMatch: 2 });
    expect(restored.json).toMatchObject({ archived: false, version: 3 });
    expect((await list()).json.items.map((x: { name: string }) => x.name)).toContain("Training");
  });

  it("validates the limits", async () => {
    const section = { heading: "H", body: "", costs: false };
    const costs = { heading: "Costs", body: "", costs: true };
    const line = { description: "a", kind: "one_off", amount: "deal", quantity: 1 };
    const refused = async (over: Record<string, unknown>) => (await create({ name: crypto.randomUUID().slice(0, 8), ...over })).status;
    expect(await refused({ name: "" })).toBe(422);
    expect(await refused({ name: "x".repeat(81) })).toBe(422);
    expect(await refused({ sections: [] })).toBe(422);
    expect(await refused({ sections: [section] })).toBe(422);
    expect(await refused({ sections: [costs, costs] })).toBe(422);
    expect(await refused({ sections: [costs, ...Array.from({ length: 15 }, () => section)] })).toBe(422);
    expect(await refused({ sections: Array.from({ length: 14 }, () => section).concat(costs) })).toBe(201);
    expect(await refused({ sections: [{ ...costs, heading: "x".repeat(121) }] })).toBe(422);
    expect(await refused({ sections: [{ ...costs, body: "x".repeat(20_001) }] })).toBe(422);
    expect(await refused({ opening: "" })).toBe(422);
    expect(await refused({ opening: "x".repeat(5_001) })).toBe(422);
    expect(await refused({ costLines: [] })).toBe(422);
    expect(await refused({ costLines: Array.from({ length: 11 }, () => line) })).toBe(422);
    expect(await refused({ costLines: [{ ...line, kind: "yearly" }] })).toBe(422); // no one-off
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: { percentBp: 0 }, quantity: 1 }] })).toBe(422);
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: { percentBp: 10_001 }, quantity: 1 }] })).toBe(422);
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: { percentBp: 1_000 }, quantity: 1 }] })).toBe(201);
    expect(await refused({ costLines: [{ ...line, amount: { percentBp: 1_000 } }] })).toBe(422); // percent on a non-discount
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: "deal", quantity: 1 }] })).toBe(422);
    expect(await refused({ costLines: [{ ...line, kind: "yearly", amount: "perRelease" }, line] })).toBe(422);
    expect(await refused({ costLines: [{ ...line, amount: "perRelease" }] })).toBe(201);
    expect(await refused({ costLines: [{ ...line, quantity: 0 }] })).toBe(422);
    expect(await refused({ costLines: [{ ...line, quantity: 3 }] })).toBe(422); // no unit column
    expect(await refused({ costColumns: { position: false, unit: true }, costLines: [{ ...line, quantity: 100_000 }] })).toBe(201);
    expect(await refused({ costColumns: { position: false, unit: true }, costLines: [{ ...line, quantity: 100_001 }] })).toBe(422);
    expect(await refused({ costColumns: { position: false, unit: true }, costLines: [{ ...line, quantity: "manDays" }] })).toBe(201);
    expect(await refused({ costLines: [{ ...line, amount: { cents: -1 } }] })).toBe(422);
    expect(await refused({ language: "fr" })).toBe(422);
    expect(await refused({ unknown: 1 })).toBe(422);
  });

  it("an archived template is hidden from the dialog and refused by generate; offers keep their snapshot", async () => {
    // exercised end to end in offers.test.ts ("template_archived"); here: the list the dialog reads
    const t = await first("Training");
    await call("POST", `/offer-templates/${t.id}/archive`, { ifMatch: 1 });
    expect((await list()).json.items.some((x: { id: string }) => x.id === t.id)).toBe(false);
  });
});
