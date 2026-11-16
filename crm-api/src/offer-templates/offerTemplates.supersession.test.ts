/**
 * Supersession per (entity, language) (specs/20261115-crm-offer-wizard T17; AC-9.2, DD-9; ADR
 * 20261115-offer-template-format-supersession-per-entity-language): a wizard template replaces the legacy templates of its
 * entity and language in the transaction that makes it active, and never before; the last active template
 * of an (entity, language) cannot be archived; a superseded legacy template cannot be restored.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, estimai, estimaiNotice, makeCompany, makeDeal, makeWizardTemplate, offerBody, resetWorld, wizardBody } from "../test-support/world";

type Entity = "welld_ch" | "welld_it";
type Language = "it" | "en";

const list = (entity: Entity = "welld_ch", extra = "") => call("GET", `/offer-templates?entity=${entity}${extra}`);
/** Reads both entities once, as the Settings page does: the legacy defaults are seeded on first read. */
const seedBoth = async () => {
  await list("welld_ch");
  await list("welld_it");
};
const count = (entity: Entity, language: Language, format: "sections" | "wizard", active = true) =>
  db.offerTemplate.count({ where: { entity, language, format, ...(active ? { archivedAt: null } : { archivedAt: { not: null } }) } });
const legacyNamed = (entity: Entity, language: Language, name: string) =>
  db.offerTemplate.findFirstOrThrow({ where: { entity, language, name, format: "sections" } });
const wizard = (over: Record<string, unknown> = {}) => makeWizardTemplate(over);

describe("the first wizard template of an (entity, language) supersedes its legacy templates (AC-9.2)", () => {
  beforeEach(resetWorld);

  it("archives that language's legacy templates in the same transaction: not the other language, not the other entity", async () => {
    await seedBoth();
    expect(await count("welld_ch", "it", "sections")).toBe(7);
    const created = await call("POST", "/offer-templates", { body: wizardBody({ name: "Wizard it" }) });
    expect(created.status).toBe(201);

    expect(await count("welld_ch", "it", "sections")).toBe(0);
    expect(await count("welld_ch", "it", "sections", false)).toBe(7);
    const archived = await db.offerTemplate.findMany({ where: { entity: "welld_ch", language: "it", format: "sections" } });
    for (const row of archived) {
      expect(row).toMatchObject({ version: 2, updatedBy: "user-admin" });
      expect(row.archivedAt).not.toBeNull();
    }
    // the English templates of the same entity, and everything of the other entity, are untouched
    expect(await count("welld_ch", "en", "sections")).toBe(7);
    expect(await count("welld_it", "it", "sections")).toBe(7);
    expect(await count("welld_it", "en", "sections")).toBe(7);
    expect((await db.offerTemplate.findMany({ where: { entity: "welld_ch", language: "en" } })).every((r) => r.version === 1)).toBe(true);
    // what the legacy list now shows for the language is nothing; the wizard list shows the new template
    const legacyList = (await list("welld_ch")).json.items as { language: string }[];
    expect(legacyList.filter((t) => t.language === "it")).toHaveLength(0);
    // (T24: the wizard list also seeds welld_ch's seven templates; the hand-made one is what this checks)
    const handMade = (await list("welld_ch", "&formats=wizard")).json.items.filter((t: { seeded: boolean }) => !t.seeded);
    expect(handMade.map((t: { name: string }) => t.name)).toEqual(["Wizard it"]);
  });

  it("makes way for a new template named like one it archives: no name clash", async () => {
    await seedBoth();
    const clash = await call("POST", "/offer-templates", { body: wizardBody({ name: "Formazione" }) });
    expect(clash.status).toBe(201);
    expect(clash.json).toMatchObject({ name: "Formazione", format: "wizard" });
    const old = await legacyNamed("welld_ch", "it", "Formazione");
    expect(old.archivedAt).not.toBeNull();
  });

  it("archives nothing before there is a wizard template: a refused create leaves the legacy templates alone", async () => {
    await seedBoth();
    const refused = [
      await call("POST", "/offer-templates", { body: wizardBody({ source: "no costs here" }) }), // 422 template_invalid
      await call("POST", "/offer-templates", { body: wizardBody({ name: "" }) }), // 422
      await call("POST", "/offer-templates", { as: "salesCh", body: wizardBody({ entity: "welld_it" }) }), // 403
      await call("POST", "/offer-templates", { as: "managerNoMoney", body: wizardBody() }), // 403
    ];
    expect(refused.map((r) => r.status)).toEqual([422, 422, 403, 403]);
    expect(await count("welld_ch", "it", "sections")).toBe(7);
    expect(await count("welld_ch", "it", "sections", false)).toBe(0);
  });

  it("rolls the supersession back when the insert fails (a name taken by an active wizard template)", async () => {
    await seedBoth();
    await wizard({ name: "Shared", language: "en" });
    expect(await count("welld_ch", "en", "sections")).toBe(0);
    const clash = await call("POST", "/offer-templates", { body: wizardBody({ name: "shared", language: "it" }) });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe("template_name_taken");
    // the Italian legacy templates are still active: nothing happened
    expect(await count("welld_ch", "it", "sections")).toBe(7);
    expect((await legacyNamed("welld_ch", "it", "Formazione")).version).toBe(1);
  });

  it("a second wizard template of the same group archives nothing more", async () => {
    await seedBoth();
    await wizard({ name: "First" });
    const afterFirst = await db.offerTemplate.findMany({ where: { format: "sections" }, orderBy: { id: "asc" } });
    await wizard({ name: "Second" });
    const afterSecond = await db.offerTemplate.findMany({ where: { format: "sections" }, orderBy: { id: "asc" } });
    expect(afterSecond.map((r) => [r.id, r.version, r.archivedAt?.getTime() ?? null])).toEqual(
      afterFirst.map((r) => [r.id, r.version, r.archivedAt?.getTime() ?? null]),
    );
  });

  it("supersedes an entity with no read yet: a create on a fresh entity needs no legacy row to exist", async () => {
    const created = await call("POST", "/offer-templates", { body: wizardBody({ entity: "welld_it", language: "en" }) });
    expect(created.status).toBe(201);
    expect(await db.offerTemplate.count({ where: { entity: "welld_it", format: "sections" } })).toBe(0);
  });

  it("two concurrent creates leave the legacy templates archived once", async () => {
    await seedBoth();
    const results = await Promise.all([wizard({ name: "A" }), wizard({ name: "B" })]);
    expect(results).toHaveLength(2);
    const legacy = await db.offerTemplate.findMany({ where: { entity: "welld_ch", language: "it", format: "sections" } });
    expect(legacy.every((r) => r.archivedAt !== null && r.version === 2)).toBe(true);
  });
});

describe("every other way to make a wizard template active supersedes too (DD-9)", () => {
  beforeEach(resetWorld);

  /** The state a runbook rollback (R11) leaves: the wizard template archived, the legacy ones active again. */
  async function rolledBack() {
    await seedBoth();
    const w = await wizard({ name: "Rolled back" });
    await db.offerTemplate.updateMany({ where: { entity: "welld_ch", language: "it", format: "sections" }, data: { archivedAt: null } });
    await db.offerTemplate.update({ where: { id: w.id }, data: { archivedAt: new Date() } });
    expect(await count("welld_ch", "it", "sections")).toBe(7);
    return db.offerTemplate.findUniqueOrThrow({ where: { id: w.id } });
  }

  it("a duplicate of a wizard template", async () => {
    const w = await rolledBack();
    const copy = await call("POST", `/offer-templates/${w.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json).toMatchObject({ format: "wizard", archived: false });
    expect(await count("welld_ch", "it", "sections")).toBe(0);
    expect(await count("welld_ch", "en", "sections")).toBe(7);
  });

  it("a restore of a wizard template", async () => {
    const w = await rolledBack();
    const restored = await call("POST", `/offer-templates/${w.id}/restore`, { ifMatch: w.version });
    expect(restored.status).toBe(200);
    expect(await count("welld_ch", "it", "sections")).toBe(0);
    expect(await count("welld_ch", "en", "sections")).toBe(7);
  });

  it("a language change of an active wizard template supersedes the new language, and the old one keeps another template", async () => {
    await seedBoth();
    await wizard({ name: "Stays", language: "en", entity: "welld_it" });
    const moving = await wizard({ name: "Moves", language: "en", entity: "welld_it" });
    expect(await count("welld_it", "it", "sections")).toBe(7);
    const { entity: _entity, ...body } = wizardBody({ name: "Moves", language: "it" });
    const saved = await call("PUT", `/offer-templates/${moving.id}`, { body, ifMatch: 1 });
    expect(saved.status).toBe(200);
    expect(saved.json.language).toBe("it");
    expect(await count("welld_it", "it", "sections")).toBe(0);
    expect(await count("welld_it", "it", "sections", false)).toBe(7);
    // welld_ch is a different entity
    expect(await count("welld_ch", "it", "sections")).toBe(7);
  });

  it("a language change of an active template out of its only template 409 last_template, and changes nothing", async () => {
    await seedBoth();
    const only = await wizard({ name: "Only", language: "en", entity: "welld_it" });
    const { entity: _entity, ...body } = wizardBody({ name: "Only", language: "it" });
    const res = await call("PUT", `/offer-templates/${only.id}`, { body, ifMatch: 1 });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("last_template");
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: only.id } })).toMatchObject({ language: "en", version: 1 });
    expect(await count("welld_it", "it", "sections")).toBe(7);
  });

  it("an edit that keeps the language archives nothing, and an archived wizard template can change language freely", async () => {
    await seedBoth();
    const a = await wizard({ name: "A" });
    await wizard({ name: "B" });
    await call("POST", `/offer-templates/${a.id}/archive`, { ifMatch: 1 });
    const { entity: _entity, ...body } = wizardBody({ name: "A", language: "en" });
    // archived: it neither supersedes English nor leaves Italian without a template
    expect((await call("PUT", `/offer-templates/${a.id}`, { body, ifMatch: 2 })).status).toBe(200);
    expect(await count("welld_ch", "en", "sections")).toBe(7);
  });
});

describe("a superseded legacy template cannot come back (AC-9.2)", () => {
  beforeEach(resetWorld);

  it("restoring it is 409 template_superseded, and nothing changes", async () => {
    await seedBoth();
    await wizard({ name: "Wizard it" });
    const old = await legacyNamed("welld_ch", "it", "Formazione");
    const res = await call("POST", `/offer-templates/${old.id}/restore`, { ifMatch: old.version });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "template_superseded", language: "it" });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ version: old.version });
    expect((await db.offerTemplate.findUniqueOrThrow({ where: { id: old.id } })).archivedAt).not.toBeNull();
  });

  it("restoring a legacy template of a language with no wizard template is still fine", async () => {
    await seedBoth();
    await wizard({ name: "Wizard it" });
    const training = await legacyNamed("welld_ch", "en", "Training");
    await call("POST", `/offer-templates/${training.id}/archive`, { ifMatch: 1 });
    expect((await call("POST", `/offer-templates/${training.id}/restore`, { ifMatch: 2 })).status).toBe(200);
  });

  it("neither a duplicate of it, nor a language change into the language, brings an active legacy template back", async () => {
    await seedBoth();
    await wizard({ name: "Wizard it" });
    const old = await legacyNamed("welld_ch", "it", "Formazione");
    const copy = await call("POST", `/offer-templates/${old.id}/duplicate`);
    expect(copy.status).toBe(409);
    expect(copy.json.code).toBe("template_superseded");

    const training = await legacyNamed("welld_ch", "en", "Training");
    const body = {
      name: training.name,
      language: "it",
      salutation: training.salutation,
      opening: training.opening,
      sections: training.sections,
      costLines: training.costLines,
      costColumns: training.costColumns,
      showTotal: training.showTotal,
      acceptanceLabel: training.acceptanceLabel,
      annex: training.annex,
    };
    const move = await call("PUT", `/offer-templates/${training.id}`, { body, ifMatch: 1 });
    expect(move.status).toBe(409);
    expect(move.json.code).toBe("template_superseded");
    expect(await count("welld_ch", "it", "sections")).toBe(0);
    expect((await db.offerTemplate.findUniqueOrThrow({ where: { id: training.id } })).language).toBe("en");
  });

  it("a restore racing a wizard create never leaves a legacy and a wizard template both active", async () => {
    await seedBoth();
    const training = await legacyNamed("welld_ch", "en", "Training");
    await call("POST", `/offer-templates/${training.id}/archive`, { ifMatch: 1 });
    const results = await Promise.all([
      call("POST", `/offer-templates/${training.id}/restore`, { ifMatch: 2 }),
      call("POST", "/offer-templates", { body: wizardBody({ name: "Wizard en", language: "en" }) }),
    ]);
    expect(results[1]!.status).toBe(201);
    expect([200, 409]).toContain(results[0]!.status);
    expect(await count("welld_ch", "en", "wizard")).toBe(1);
    expect(await count("welld_ch", "en", "sections")).toBe(0);
  });
});

describe("the last active template of an (entity, language) cannot be archived (AC-9.2)", () => {
  beforeEach(resetWorld);

  it("409 last_template for the only wizard template, which stays active", async () => {
    await seedBoth();
    const only = await wizard({ name: "Only" });
    const res = await call("POST", `/offer-templates/${only.id}/archive`, { ifMatch: 1 });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "last_template", language: "it" });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: only.id } })).toMatchObject({ version: 1, archivedAt: null });
    // with another active one, it can go
    await wizard({ name: "Other" });
    expect((await call("POST", `/offer-templates/${only.id}/archive`, { ifMatch: 1 })).status).toBe(200);
  });

  it("applies to legacy templates too: archiving all but one is fine, the last is refused", async () => {
    await seedBoth();
    const english = await db.offerTemplate.findMany({ where: { entity: "welld_it", language: "en", archivedAt: null }, orderBy: { name: "asc" } });
    expect(english).toHaveLength(7);
    for (const row of english.slice(0, 6)) {
      expect((await call("POST", `/offer-templates/${row.id}/archive`, { ifMatch: 1 })).status).toBe(200);
    }
    const last = english[6]!;
    const res = await call("POST", `/offer-templates/${last.id}/archive`, { ifMatch: 1 });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("last_template");
    // the other language of the same entity is a different group
    expect(await count("welld_it", "it", "sections")).toBe(7);
  });

  it("the guard counts only the same entity and language", async () => {
    await seedBoth();
    const wCh = await wizard({ name: "Ch it" });
    await wizard({ name: "It it", entity: "welld_it" });
    // another entity's wizard template does not make this one removable
    expect((await call("POST", `/offer-templates/${wCh.id}/archive`, { ifMatch: 1 })).json.code).toBe("last_template");
  });

  it("two concurrent archives of the last two templates leave one active", async () => {
    await seedBoth();
    const a = await wizard({ name: "A" });
    const b = await wizard({ name: "B" });
    const results = await Promise.all([
      call("POST", `/offer-templates/${a.id}/archive`, { ifMatch: 1 }),
      call("POST", `/offer-templates/${b.id}/archive`, { ifMatch: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count("welld_ch", "it", "wizard")).toBe(1);
  });

  it("archiving an archived template is not a removal and stays allowed", async () => {
    await seedBoth();
    const a = await wizard({ name: "A" });
    await wizard({ name: "B" });
    await call("POST", `/offer-templates/${a.id}/archive`, { ifMatch: 1 });
    expect((await call("POST", `/offer-templates/${a.id}/archive`, { ifMatch: 2 })).status).toBe(200);
  });
});

describe("the welld_ch English legacy template still generates (AC-9.2)", () => {
  beforeEach(resetWorld);

  it("POST /deals/{id}/offers works with an English template after Italian is superseded", async () => {
    await seedBoth();
    await wizard({ name: "Wizard it" });
    expect(await count("welld_ch", "it", "sections")).toBe(0);

    await call("PUT", "/entity-profiles/welld_ch", {
      body: {
        legalName: "wellD SA",
        addressLines: ["Via Example 1", "6900 Lugano"],
        vatNumber: "CHE-123.456.789 MWST",
        iban: "CH00 0000 0000 0000 0000 0",
        offerTermsEn: "Payment within 30 days.",
        offerTermsIt: "Pagamento a 30 giorni.",
      },
    });
    const company = await makeCompany({ name: "Acme Super", entity: "welld_ch", legalName: "Acme SA", street: "Via Roma 1", postalCode: "6900", city: "Lugano", country: "CH" });
    const deal = await makeDeal(company.id, { stage: "qualified", title: "Grid analytics", amountCents: 9_000_050, entity: "welld_ch" });
    await call("POST", `/deals/${deal.id}/estimate`, { body: { technicalUserId: "user-tech" } });
    const estimate = [...estimai.estimates.values()].at(-1)!;
    estimate.content = {
      params: { aiGain: 0.3 },
      releases: [{ id: "r1", name: "Phase 1" }],
      acts: [{ id: "1", epic: "Auth", o: 10, ml: 10, p: 10, release: "Phase 1" }],
    };
    await estimaiNotice(deal.id);

    const body = await offerBody(deal.id, "welld_ch", "Training");
    const res = await call("POST", `/deals/${deal.id}/offers`, { body });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ language: "en" });
  });
});
