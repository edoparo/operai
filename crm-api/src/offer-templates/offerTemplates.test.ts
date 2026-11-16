import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, resetWorld, wizardBody } from "../test-support/world";
import { DEFAULT_TEMPLATES_IT } from "../offers/defaultTemplates";
import { DEFAULT_TEMPLATES_EN } from "../offers/defaultTemplates.en";
import { TemplateContentSchema } from "../offers/offerSchemas";

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;
const KNOWN = new Set(["deal", "issuer", "client", "currency", "epics", "phases", "timeline", "manDays", "validityDays", "release"]);
const placeholdersOf = (value: unknown): string[] =>
  [...JSON.stringify(value).matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();

describe("the seeded defaults (specs/20261102-crm-offer-document AC-2.3)", () => {
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

describe("offer templates (specs/20261102-crm-offer-document US-2)", () => {
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
  // specs/20261115-crm-offer-wizard DD-9: a new template is always a wizard template, so `create` posts a wizard
  // body; the legacy content of a row is exercised through `PUT` on a legacy row (a seeded one, or `legacyRow`).
  const create = (over: Record<string, unknown> = {}, as: "admin" | "salesCh" | "managerNoMoney" = "admin", entity = "welld_ch") =>
    call("POST", "/offer-templates", { as, body: wizardBody({ entity, name: "Custom", ...over }) });
  /** A legacy row as 018 created it, inserted directly: the API no longer creates one. */
  const legacyRow = async (over: Record<string, unknown> = {}) => {
    const { name, language, salutation, opening, sections, costLines, costColumns, showTotal, acceptanceLabel, annex } = content(over);
    const row = await db.offerTemplate.create({
      data: {
        entity: "welld_ch", name: name as string, language: language as "en" | "it", salutation: salutation as string,
        opening: opening as string, sections: sections as never, costLines: costLines as never, costColumns: costColumns as never,
        showTotal: showTotal as boolean, acceptanceLabel: acceptanceLabel as null, annex: annex as boolean,
        createdBy: "user-admin", updatedBy: "user-admin",
      },
    });
    return { id: row.id as string, version: row.version };
  };

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
    // straight in the database: the API refuses to archive the last template of an entity and language (T17)
    await list();
    await db.offerTemplate.updateMany({ where: { entity: "welld_ch" }, data: { archivedAt: new Date() } });
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
    await create({ name: "Keeper" }); // the last template of an entity and language cannot be archived (T17)
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
    const t = await legacyRow();
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
    await legacyRow({ name: "Other" });
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: content({ name: "other" }), ifMatch: 2 })).json.code).toBe("template_name_taken");
  });

  it("a stale write loses against a concurrent one (one winner)", async () => {
    const t = await legacyRow();
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
    // 018's content schema, now reached by `PUT` on a legacy row: 200 where a create answered 201
    const refused = async (over: Record<string, unknown>) => {
      const t = await legacyRow({ name: crypto.randomUUID().slice(0, 8) });
      return (await call("PUT", `/offer-templates/${t.id}`, { body: content({ name: crypto.randomUUID().slice(0, 8), ...over }), ifMatch: 1 })).status;
    };
    expect(await refused({ name: "" })).toBe(422);
    expect(await refused({ name: "x".repeat(81) })).toBe(422);
    expect(await refused({ sections: [] })).toBe(422);
    expect(await refused({ sections: [section] })).toBe(422);
    expect(await refused({ sections: [costs, costs] })).toBe(422);
    expect(await refused({ sections: [costs, ...Array.from({ length: 15 }, () => section)] })).toBe(422);
    expect(await refused({ sections: Array.from({ length: 14 }, () => section).concat(costs) })).toBe(200);
    expect(await refused({ sections: [{ ...costs, heading: "x".repeat(121) }] })).toBe(422);
    expect(await refused({ sections: [{ ...costs, body: "x".repeat(20_001) }] })).toBe(422);
    expect(await refused({ opening: "" })).toBe(422);
    expect(await refused({ opening: "x".repeat(5_001) })).toBe(422);
    expect(await refused({ costLines: [] })).toBe(422);
    expect(await refused({ costLines: Array.from({ length: 11 }, () => line) })).toBe(422);
    expect(await refused({ costLines: [{ ...line, kind: "yearly" }] })).toBe(422); // no one-off
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: { percentBp: 0 }, quantity: 1 }] })).toBe(422);
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: { percentBp: 10_001 }, quantity: 1 }] })).toBe(422);
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: { percentBp: 1_000 }, quantity: 1 }] })).toBe(200);
    expect(await refused({ costLines: [{ ...line, amount: { percentBp: 1_000 } }] })).toBe(422); // percent on a non-discount
    expect(await refused({ costLines: [line, { description: "d", kind: "discount", amount: "deal", quantity: 1 }] })).toBe(422);
    expect(await refused({ costLines: [{ ...line, kind: "yearly", amount: "perRelease" }, line] })).toBe(422);
    expect(await refused({ costLines: [{ ...line, amount: "perRelease" }] })).toBe(200);
    expect(await refused({ costLines: [{ ...line, quantity: 0 }] })).toBe(422);
    expect(await refused({ costLines: [{ ...line, quantity: 3 }] })).toBe(422); // no unit column
    expect(await refused({ costColumns: { position: false, unit: true }, costLines: [{ ...line, quantity: 100_000 }] })).toBe(200);
    expect(await refused({ costColumns: { position: false, unit: true }, costLines: [{ ...line, quantity: 100_001 }] })).toBe(422);
    expect(await refused({ costColumns: { position: false, unit: true }, costLines: [{ ...line, quantity: "manDays" }] })).toBe(200);
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

  it("refuses U+0000 in a path id, a legacy body member and a wizard body member with 422, never a 500 (QE D7)", async () => {
    const NUL = "\u0000";
    const enc = encodeURIComponent(`x${NUL}`);
    const t = await legacyRow();
    const wizard = (await create({ name: "Wiz" })).json;
    expect(wizard.version).toBe(1);
    const legacyBody = content({ name: "Leg2" });
    const wizardPut = (over: Record<string, unknown>) => ({ ...wizardBody({ name: "Wiz", ...over }), entity: undefined });
    // controls: the same bodies without a NUL are accepted, so a 422 below is the NUL and nothing else
    expect((await call("PUT", `/offer-templates/${wizard.id}`, { ifMatch: 1, body: wizardPut({}) })).status).toBe(200);
    expect((await call("PUT", `/offer-templates/${t.id}`, { ifMatch: 1, body: legacyBody })).status).toBe(200);
    const cases: [string, Promise<{ status: number; json: any }>][] = [
      ["GET :id", call("GET", `/offer-templates/${enc}`)],
      ["PUT :id", call("PUT", `/offer-templates/${enc}`, { ifMatch: 2, body: legacyBody })],
      ["POST :id/duplicate", call("POST", `/offer-templates/${enc}/duplicate`, { body: {} })],
      ["POST :id/archive", call("POST", `/offer-templates/${enc}/archive`, { ifMatch: 2 })],
      ["POST :id/restore", call("POST", `/offer-templates/${enc}/restore`, { ifMatch: 2 })],
      ["legacy name", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, name: `a${NUL}` } })],
      ["legacy salutation", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, salutation: `a${NUL}` } })],
      ["legacy opening", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, opening: `a${NUL}` } })],
      ["legacy section heading", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, sections: [{ heading: `h${NUL}`, body: "", costs: true }] } })],
      ["legacy section body", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, sections: [{ heading: "h", body: `b${NUL}`, costs: true }] } })],
      ["legacy cost line", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, costLines: [{ description: `d${NUL}`, kind: "one_off", amount: "deal", quantity: 1 }] } })],
      ["legacy acceptance label", call("PUT", `/offer-templates/${t.id}`, { ifMatch: 2, body: { ...legacyBody, acceptanceLabel: `a${NUL}` } })],
      ["wizard name", call("PUT", `/offer-templates/${wizard.id}`, { ifMatch: 2, body: wizardPut({ name: `a${NUL}` }) })],
      ["wizard source", call("PUT", `/offer-templates/${wizard.id}`, { ifMatch: 2, body: wizardPut({ source: `@@salutation S${NUL}` }) })],
      ["create name", create({ name: `a${NUL}` })],
      ["list entity", call("GET", `/offer-templates?entity=welld_ch${encodeURIComponent(NUL)}`)],
      ["list formats", call("GET", `/offer-templates?entity=welld_ch&formats=${enc}`)],
      ["list includeArchived", call("GET", `/offer-templates?entity=welld_ch&includeArchived=${enc}`)],
    ];
    const wrong: string[] = [];
    for (const [name, pending] of cases) {
      const res = await pending;
      if (res.status !== 422 || JSON.stringify(res.json).includes(NUL)) wrong.push(`${name}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
    const after = await db.offerTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect([after.version, after.name]).toEqual([2, "Leg2"]);
  });

  it("answers a deeply nested body with a 4xx in bounded time and still finds a NUL where a body is legitimately deep (QE D10)", async () => {
    const t = await legacyRow();
    const base = JSON.stringify(content({ name: "Deep" })).slice(0, -1);
    const withExtra = (extra: string) => `${base},"zz":${extra}}`;
    // controls: a NUL in a nest of ordinary depth is still a 422 naming its path; the same body without it is not refused for depth
    const nested = (depth: number, leaf: string) => "[".repeat(depth) + leaf + "]".repeat(depth);
    const ok = await call("PUT", `/offer-templates/${t.id}`, { ifMatch: 1, rawBody: withExtra(nested(3, '"x"')) });
    expect(ok.status).not.toBe(500);
    expect(ok.json?.detail ?? "").not.toContain("deep");
    const nul = await call("PUT", `/offer-templates/${t.id}`, { ifMatch: 1, rawBody: withExtra(nested(3, '"x\\u0000"')) });
    expect([nul.status, nul.json.field]).toEqual([422, "zz.0.0.0"]);
    // the defect: depth beyond what the stack allows was a RangeError (a 500) and, below it, quadratic path copying
    for (const depth of [1_000, 20_000, 200_000]) {
      const started = performance.now();
      const res = await call("PUT", `/offer-templates/${t.id}`, { ifMatch: 1, rawBody: withExtra(nested(depth, "")) });
      const ms = performance.now() - started;
      expect([depth, res.status >= 400 && res.status < 500]).toEqual([depth, true]);
      expect(res.json.status).toBe(res.status);
      expect(ms).toBeLessThan(2_000);
    }
    const after = await db.offerTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.version).toBe(1);
  });
});
