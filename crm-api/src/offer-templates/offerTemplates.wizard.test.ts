/**
 * Offer templates in the wizard format (specs/20261115-crm-offer-wizard T16; AC-1.1, AC-8.1, AC-8.3, AC-9.3):
 * the `formats` filter, the wizard body, the template text checked by the shared engine, and the writes' gates.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { WIZARD_SOURCE, call, db, makeWizardTemplate, resetWorld, wizardBody } from "../test-support/world";

const list = (query = "entity=welld_ch", as: "admin" | "salesCh" | "consultant" | "managerNoMoney" = "admin") =>
  call("GET", `/offer-templates?${query}`, { as });

/** A text with a costs table whose lines are `lines`, and `extra` after it. */
const costsText = (lines: string[], extra: string[] = []) =>
  ["@@salutation To", "", "Dear client.", "", "## COSTS", "@@costs", ...lines, "@@end", "", ...extra].join("\n");

const problemsOf = async (source: string) => {
  const res = await call("POST", "/offer-templates", { body: wizardBody({ name: crypto.randomUUID().slice(0, 8), source }) });
  return res;
};

describe("wizard templates: the formats filter (AC-1.1)", () => {
  beforeEach(resetWorld);

  it("lists legacy rows only without `formats`, wizard rows with `formats=wizard`, both with `sections,wizard`", async () => {
    await list("entity=welld_it"); // the first read of an entity seeds the legacy defaults (welld_it: no wizard seeds, T24)
    const wizard = await makeWizardTemplate({ entity: "welld_it", name: "Wizard one", description: "One line", uses: ["a", "b"] });

    const plain = (await list("entity=welld_it")).json.items as { id: string; format: string }[];
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((t) => t.format === "sections")).toBe(true);
    expect(plain.some((t) => t.id === wizard.id)).toBe(false);

    const only = (await list("entity=welld_it&formats=wizard")).json.items;
    expect(only).toHaveLength(1);
    expect(only[0]).toMatchObject({
      id: wizard.id,
      format: "wizard",
      name: "Wizard one",
      description: "One line",
      uses: ["a", "b"],
      source: WIZARD_SOURCE,
      seeded: false,
      salutation: null,
      opening: null,
      sections: null,
      costLines: null,
      costColumns: null,
    });

    const both = (await list("entity=welld_it&formats=sections,wizard")).json.items as { format: string }[];
    expect(new Set(both.map((t) => t.format))).toEqual(new Set(["sections", "wizard"]));
    expect(both).toHaveLength(plain.length + 1);
    expect((await list("entity=welld_it&formats=sections")).json.items).toHaveLength(plain.length);
  });

  it("a legacy row carries the new members as nothing: no description, no uses, no source, not seeded", async () => {
    const legacy = (await list()).json.items[0];
    expect(legacy).toMatchObject({ format: "sections", description: null, uses: [], source: null, seeded: false });
    expect(typeof legacy.salutation).toBe("string");
  });

  it("refuses a format it does not know", async () => {
    expect((await list("entity=welld_ch&formats=wizard,nope")).status).toBe(422);
    expect((await list("entity=welld_ch&formats=")).status).toBe(422);
  });

  it("marks a row with a seedKey as seeded, and GET by id returns the source with an ETag", async () => {
    const wizard = await makeWizardTemplate();
    await db.offerTemplate.update({ where: { id: wizard.id }, data: { seedKey: "welld-ch-it-v1:T9" } });
    const one = await call("GET", `/offer-templates/${wizard.id}`, { as: "salesCh" });
    expect(one.json).toMatchObject({ format: "wizard", seeded: true, source: WIZARD_SOURCE });
    expect(one.headers.get("ETag")).toBe('"1"');
  });

  it("is readable by deal:financials holders of either entity, and by no one else", async () => {
    await makeWizardTemplate();
    expect((await list("entity=welld_ch&formats=wizard", "salesCh")).status).toBe(200);
    expect((await list("entity=welld_it&formats=wizard", "salesCh")).status).toBe(200);
    expect((await list("entity=welld_ch&formats=wizard", "consultant")).status).toBe(403);
    expect((await list("entity=welld_ch&formats=wizard", "managerNoMoney")).status).toBe(403);
  });
});

describe("wizard templates: create, duplicate (AC-8.1, AC-9.3)", () => {
  beforeEach(resetWorld);

  it("creates a wizard template (format implied), with an ETag of version 1", async () => {
    const res = await call("POST", "/offer-templates", { body: wizardBody({ description: "", uses: [] }) });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      entity: "welld_ch",
      name: "Wizard",
      language: "it",
      format: "wizard",
      description: null,
      uses: [],
      source: WIZARD_SOURCE,
      seeded: false,
      version: 1,
      archived: false,
      updatedBy: { id: "user-admin" },
    });
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(await db.offerTemplate.count({ where: { format: "wizard" } })).toBe(1);
  });

  it("needs deal:financials and deal:manage over the entity: 403 out_of_scope for another entity", async () => {
    expect((await call("POST", "/offer-templates", { as: "salesCh", body: wizardBody() })).status).toBe(201);
    const other = await call("POST", "/offer-templates", { as: "salesCh", body: wizardBody({ entity: "welld_it" }) });
    expect(other.status).toBe(403);
    expect(other.json.code).toBe("out_of_scope");
    expect((await call("POST", "/offer-templates", { as: "managerNoMoney", body: wizardBody({ name: "x" }) })).status).toBe(403);
    expect((await call("POST", "/offer-templates", { as: "consultant", body: wizardBody({ name: "y" }) })).status).toBe(403);
    expect(await db.offerTemplate.count({ where: { entity: "welld_it" } })).toBe(0);
  });

  it("keeps names unique among the active templates of an entity, case-insensitively", async () => {
    await makeWizardTemplate({ name: "Same" });
    const clash = await call("POST", "/offer-templates", { body: wizardBody({ name: "SAME" }) });
    expect(clash.status).toBe(409);
    expect(clash.json).toMatchObject({ code: "template_name_taken", field: "name" });
    expect((await call("POST", "/offer-templates", { body: wizardBody({ name: "Same", entity: "welld_it" }) })).status).toBe(201);
  });

  it("takes only the wizard body: a legacy body, an unknown member and every limit are 422", async () => {
    const legacy = {
      entity: "welld_ch",
      name: "Old",
      language: "en",
      salutation: "To",
      opening: "Dear",
      sections: [{ heading: "Costs", body: "", costs: true }],
      costLines: [{ description: "Work", kind: "one_off", amount: "deal", quantity: 1 }],
      costColumns: { position: true, unit: false },
      showTotal: false,
      acceptanceLabel: null,
      annex: false,
    };
    expect((await call("POST", "/offer-templates", { body: legacy })).status).toBe(422);
    const refused = async (over: Record<string, unknown>) =>
      (await call("POST", "/offer-templates", { body: wizardBody({ name: crypto.randomUUID().slice(0, 8), ...over }) })).status;
    expect(await refused({ unknown: 1 })).toBe(422);
    expect(await refused({ name: "" })).toBe(422);
    expect(await refused({ name: "x".repeat(81) })).toBe(422);
    expect(await refused({ language: "fr" })).toBe(422);
    expect(await refused({ description: "two\nlines" })).toBe(422);
    expect(await refused({ description: "x".repeat(161) })).toBe(422);
    expect(await refused({ description: "x".repeat(160) })).toBe(201);
    expect(await refused({ uses: Array.from({ length: 7 }, (_, i) => `u${i}`) })).toBe(422);
    expect(await refused({ uses: Array.from({ length: 6 }, (_, i) => `u${i}`) })).toBe(201);
    expect(await refused({ uses: ["x".repeat(41)] })).toBe(422);
    expect(await refused({ uses: [" "] })).toBe(422);
    expect(await refused({ source: "" })).toBe(422);
    expect(await refused({ source: `${WIZARD_SOURCE}${"x".repeat(150_001)}` })).toBe(422);
    expect(await refused({ entity: "nope" })).toBe(422);
  });

  it("creates an English wizard template for welld_it, lists it, and has no entity or language branch (AC-9.3)", async () => {
    const created = await call("POST", "/offer-templates", {
      as: "salesCh",
      body: wizardBody({ entity: "welld_ch", name: "English fixed price", language: "en" }),
    });
    expect(created.status).toBe(201);
    const it = await call("POST", "/offer-templates", {
      body: wizardBody({ entity: "welld_it", name: "English project", language: "en", description: "Per project", uses: ["EUR"] }),
    });
    expect(it.status).toBe(201);
    expect(it.json).toMatchObject({ entity: "welld_it", language: "en", format: "wizard", seeded: false });
    const items = (await list("entity=welld_it&formats=wizard")).json.items;
    expect(items.map((t: { name: string }) => t.name)).toEqual(["English project"]);
  });

  it("duplicates a wizard template as a wizard template under a fresh name, never seeded", async () => {
    const original = await makeWizardTemplate({ name: "Fixed price", description: "d", uses: ["a"] });
    await db.offerTemplate.update({ where: { id: original.id }, data: { seedKey: "welld-ch-it-v1:T1" } });
    const one = await call("POST", `/offer-templates/${original.id}/duplicate`);
    expect(one.status).toBe(201);
    expect(one.json).toMatchObject({
      name: "Fixed price (copia)",
      format: "wizard",
      description: "d",
      uses: ["a"],
      source: WIZARD_SOURCE,
      seeded: false,
      version: 1,
      salutation: null,
    });
    expect((await call("POST", `/offer-templates/${original.id}/duplicate`)).json.name).toBe("Fixed price (copia) 2");
    expect((await call("POST", `/offer-templates/${original.id}/duplicate`, { as: "salesCh" })).status).toBe(201);
    const itOne = await call("POST", "/offer-templates", { body: wizardBody({ entity: "welld_it", name: "It one" }) });
    expect((await call("POST", `/offer-templates/${itOne.json.id}/duplicate`, { as: "salesCh" })).json.code).toBe("out_of_scope");
  });

  it("archives and restores a wizard template like any other (If-Match required)", async () => {
    const t = await makeWizardTemplate();
    await makeWizardTemplate({ name: "Keeper" }); // the last template of an entity and language cannot be archived (T17)
    expect((await call("POST", `/offer-templates/${t.id}/archive`)).status).toBe(428);
    const archived = await call("POST", `/offer-templates/${t.id}/archive`, { ifMatch: 1 });
    expect(archived.json).toMatchObject({ archived: true, version: 2, format: "wizard" });
    // (the seven seeds of T24 are listed too: the hand-made ones are what this test is about)
    const handMade = (await list("entity=welld_ch&formats=wizard")).json.items.filter((x: { seeded: boolean }) => !x.seeded);
    expect(handMade.map((x: { name: string }) => x.name)).toEqual(["Keeper"]);
    expect((await call("POST", `/offer-templates/${t.id}/restore`, { ifMatch: 2 })).json).toMatchObject({ archived: false, version: 3 });
  });
});

describe("wizard templates: edit (AC-8.1)", () => {
  beforeEach(resetWorld);

  const edit = (over: Record<string, unknown> = {}) => {
    const { entity: _entity, ...body } = wizardBody({ name: "Renamed", description: "New", uses: ["x"], ...over });
    return body;
  };

  it("replaces the content: 428 without If-Match, 409 when stale, a bumped version when current", async () => {
    const t = await makeWizardTemplate();
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: edit() })).status).toBe(428);
    const stale = await call("PUT", `/offer-templates/${t.id}`, { body: edit(), ifMatch: 7 });
    expect(stale.json).toMatchObject({ status: 409, code: "version_conflict", currentVersion: 1 });
    const saved = await call("PUT", `/offer-templates/${t.id}`, {
      body: edit({ source: `${WIZARD_SOURCE}\nMore text.\n` }),
      ifMatch: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ name: "Renamed", description: "New", uses: ["x"], version: 2, format: "wizard" });
    expect(saved.json.source).toContain("More text.");
    expect(saved.headers.get("ETag")).toBe('"2"');
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: edit(), ifMatch: 1 })).status).toBe(409);
    expect((await call("PUT", "/offer-templates/missing", { body: edit(), ifMatch: 1 })).status).toBe(404);
  });

  it("is gated like a create: 403 out_of_scope for another entity, 403 without the money or the deals", async () => {
    const itRow = await makeWizardTemplate({ entity: "welld_it" });
    expect((await call("PUT", `/offer-templates/${itRow.id}`, { as: "salesCh", body: edit(), ifMatch: 1 })).json.code).toBe("out_of_scope");
    expect((await call("PUT", `/offer-templates/${itRow.id}`, { as: "consultant", body: edit(), ifMatch: 1 })).status).toBe(403);
    expect((await call("PUT", `/offer-templates/${itRow.id}`, { as: "managerNoMoney", body: edit(), ifMatch: 1 })).status).toBe(403);
  });

  it("a stale write loses against a concurrent one (one winner)", async () => {
    const t = await makeWizardTemplate();
    const results = await Promise.all([
      call("PUT", `/offer-templates/${t.id}`, { body: edit({ name: "A" }), ifMatch: 1 }),
      call("PUT", `/offer-templates/${t.id}`, { body: edit({ name: "B" }), ifMatch: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("refuses a rename onto another active template's name", async () => {
    const t = await makeWizardTemplate({ name: "First" });
    await makeWizardTemplate({ name: "Other" });
    expect((await call("PUT", `/offer-templates/${t.id}`, { body: edit({ name: "other" }), ifMatch: 1 })).json.code).toBe("template_name_taken");
  });

  it("takes the body of the row's format: a wizard row refuses a legacy body, a legacy row a wizard body", async () => {
    const legacy = (await list()).json.items[0];
    const wizard = await makeWizardTemplate();
    const legacyBody = {
      name: "Legacy renamed",
      language: legacy.language,
      salutation: legacy.salutation,
      opening: legacy.opening,
      sections: legacy.sections,
      costLines: legacy.costLines,
      costColumns: legacy.costColumns,
      showTotal: legacy.showTotal,
      acceptanceLabel: legacy.acceptanceLabel,
      annex: legacy.annex,
    };
    expect((await call("PUT", `/offer-templates/${wizard.id}`, { body: legacyBody, ifMatch: 1 })).status).toBe(422);
    expect((await call("PUT", `/offer-templates/${legacy.id}`, { body: edit(), ifMatch: legacy.version })).status).toBe(422);
    // the legacy body still saves a legacy row, and the row stays legacy
    const saved = await call("PUT", `/offer-templates/${legacy.id}`, { body: legacyBody, ifMatch: legacy.version });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ format: "sections", name: "Legacy renamed", source: null });
  });

  it("422 template_invalid on a bad text leaves the row and its version as they were", async () => {
    const t = await makeWizardTemplate();
    const res = await call("PUT", `/offer-templates/${t.id}`, { body: edit({ source: "no costs here" }), ifMatch: 1 });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("template_invalid");
    const row = await db.offerTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ version: 1, name: "Wizard", source: WIZARD_SOURCE });
  });
});

describe("wizard templates: the text is checked by the shared engine (AC-8.3)", () => {
  beforeEach(resetWorld);

  const COSTS = ["@@line work one_off | Work | unit=deal | qty=1", "@@total **TOTAL**"];

  it("an unclosed block: 422 template_invalid with problems [{ line, code, severity }]", async () => {
    const res = await problemsOf(costsText(COSTS, ["@@OPT_START extra", "Some text.", ""]));
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ status: 422, code: "template_invalid" });
    expect(res.json.problems).toContainEqual({ line: 11, severity: "error", code: "block_not_closed", name: "extra" });
    expect(await db.offerTemplate.count({ where: { format: "wizard" } })).toBe(0);
  });

  it("an undeclared field", async () => {
    const res = await problemsOf(costsText(COSTS, ["Hello [CLIENTE_X]."]));
    expect(res.status).toBe(422);
    expect(res.json.problems).toContainEqual({ line: 11, severity: "error", code: "field_undeclared", name: "CLIENTE_X" });
  });

  it("a field with no label", async () => {
    const res = await problemsOf(costsText(COSTS, ["Hello [NOTE].", "", "@@field NOTE", "hint: only a hint"]));
    expect(res.status).toBe(422);
    expect(res.json.problems).toContainEqual({ line: 13, severity: "error", code: "label_missing", name: "NOTE" });
  });

  it("a choice with fewer than two options", async () => {
    const res = await problemsOf(
      costsText(COSTS, ["@@OPT_START one", "Option one.", "@@OPT_END", "", "@@choice PICK", "label: Pick", "options: one"]),
    );
    expect(res.status).toBe(422);
    expect(res.json.problems.map((p: { code: string }) => p.code)).toContain("choice_too_few_options");
  });

  it("no costs section", async () => {
    const res = await problemsOf("@@salutation To\n\nDear client.\n\n## SCOPE\nText.\n");
    expect(res.status).toBe(422);
    expect(res.json.problems).toContainEqual(expect.objectContaining({ code: "no_costs_section", severity: "error" }));
  });

  it("a 10% discount in a two-total table is percent_discount_multi_total", async () => {
    const res = await problemsOf(
      costsText([
        "@@line a one_off | Item | unit=? | qty=1",
        "@@total First",
        "@@line d discount | Discount | unit=10%",
        "@@total Second",
      ]),
    );
    expect(res.status).toBe(422);
    expect(res.json.problems).toContainEqual({ line: 9, severity: "error", code: "percent_discount_multi_total", name: "d" });
  });

  it("the same discount in a one-total table is fine, and a warning never blocks", async () => {
    const warned = costsText(
      ["@@line a one_off | Item | unit=? | qty=1", "@@line d discount | Discount | unit=10%", "@@total **TOTAL**"],
      ["@@field UNUSED", "label: Unused"],
    );
    const res = await problemsOf(warned);
    expect(res.status).toBe(201);
    expect(res.json.source).toBe(warned);
  });

  it("every problem names its line and severity, and never the text itself", async () => {
    const secret = "Confidential client wording";
    const res = await problemsOf(costsText(COSTS, [`${secret} [MISSING_ONE].`]));
    expect(res.status).toBe(422);
    for (const problem of res.json.problems) {
      expect(Object.keys(problem).sort()).toEqual(expect.arrayContaining(["code", "line", "severity"]));
    }
    expect(JSON.stringify(res.json)).not.toContain(secret);
  });
});
