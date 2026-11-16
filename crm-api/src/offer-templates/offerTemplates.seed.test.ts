/**
 * The seven wizard seeds (specs/20261115-crm-offer-wizard T24; AC-9.1, AC-9.2): lazy, idempotent, welld_ch only,
 * triggered only by `formats` including `wizard`, followed by supersession of the Italian legacy templates.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { parseTemplate } from "../offers/engine/syntax";
import { call, db, makeWizardTemplate, resetWorld } from "../test-support/world";
import { WELLD_CH_IT_V1, WELLD_CH_IT_V1_RENAMES } from "./wizardSeeds/welldChIt";

/** Name, description and uses as the mockup's `window.__WIZ__.templates` carries them (the mockup is not imported). */
const EXPECTED = [
  ["T1", "Progetto a corpo", "Progetti, MVP, PoC ed evolutive a prezzo fisso, con collaudo e garanzia di 6 mesi.", ["Sviluppo", "MVP e PoC", "Evolutive"]],
  ["T2", "Risorse a tempo", "Consulenza tecnica a giornate: T&M con tetto, accordo annuale FTE o pacchetto giornate prepagato.", ["T&M", "FTE", "Pacchetto giornate"]],
  ["T3", "Manutenzione e SLA", "Canone annuale con pacchetto ore e Allegato SLA completo, nei profili Base, Standard e Premium.", ["Canone", "Pacchetto ore", "Allegato SLA"]],
  ["T4", "Formazione", "Corsi, masterclass e workshop, a corpo o per partecipante, con il programma in allegato.", ["Corsi", "Workshop"]],
  ["T5", "Consulenza e assessment", "Analisi, audit e design review a corpo, con un deliverable documentale.", ["Assessment", "Analisi"]],
  ["T6", "Servizi a canone", "SaaS, infrastruttura gestita e rivendita di licenze, con Allegato DPA facoltativo.", ["SaaS", "Hosting", "Licenze"]],
  ["T1+T3", "Progetto a corpo con SLA", "Un solo contratto per progetto, garanzia e manutenzione, con Allegato SLA.", ["Sviluppo", "Canone", "Allegato SLA"]],
] as const;

const wizardRows = (entity = "welld_ch") => db.offerTemplate.findMany({ where: { entity: entity as "welld_ch", format: "wizard" }, orderBy: { name: "asc" } });
const read = (query: string) => call("GET", `/offer-templates?${query}`, { as: "admin" });

describe("the wizard seeds (AC-9.1, AC-9.2)", () => {
  beforeEach(resetWorld);

  it("the first wizard read of welld_ch creates exactly seven active Italian wizard templates, named and described as the mockup", async () => {
    const res = await read("entity=welld_ch&formats=wizard");
    expect(res.status).toBe(200);
    const items = res.json.items as { name: string; description: string; uses: string[]; language: string; format: string; seeded: boolean; archived: boolean; source: string }[];
    expect(items).toHaveLength(7);
    for (const [code, name, description, uses] of EXPECTED) {
      const found = items.find((item) => item.name === name);
      expect(found, code).toBeDefined();
      expect(found).toMatchObject({ description, uses, language: "it", format: "wizard", seeded: true, archived: false });
    }
    const rows = await wizardRows();
    expect(rows.map((row) => row.seedKey).sort()).toEqual(EXPECTED.map(([code]) => `welld-ch-it-v2:${code}`).sort());
    expect(rows.every((row) => row.createdBy === "system:crm-api" && row.updatedBy === "system:crm-api")).toBe(true);
  });

  it("archives the Italian legacy templates and leaves the English ones active (AC-9.2)", async () => {
    await read("entity=welld_ch&formats=wizard");
    const legacy = await db.offerTemplate.findMany({ where: { entity: "welld_ch", format: "sections" } });
    expect(legacy.length).toBeGreaterThan(0);
    for (const row of legacy) expect(row.archivedAt !== null, `${row.language} ${row.name}`).toBe(row.language === "it");
    expect(legacy.some((row) => row.language === "en" && row.archivedAt === null)).toBe(true);
  });

  it("five concurrent first reads still yield seven", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => read("entity=welld_ch&formats=wizard")));
    for (const res of results) expect(res.status).toBe(200);
    expect(await wizardRows()).toHaveLength(7);
    const active = await db.offerTemplate.count({ where: { entity: "welld_ch", archivedAt: null, language: "it" } });
    expect(active).toBe(7);
  });

  it("is idempotent: a second read changes nothing", async () => {
    await read("entity=welld_ch&formats=wizard");
    const before = await db.offerTemplate.findMany({ orderBy: { id: "asc" }, select: { id: true, version: true, archivedAt: true } });
    await read("entity=welld_ch&formats=sections,wizard");
    const after = await db.offerTemplate.findMany({ orderBy: { id: "asc" }, select: { id: true, version: true, archivedAt: true } });
    expect(after).toEqual(before);
  });

  it("an archived seed is not re-created, and the others stay", async () => {
    const first = (await read("entity=welld_ch&formats=wizard")).json.items as { id: string; name: string; version: number }[];
    const target = first.find((item) => item.name === "Formazione")!;
    const archived = await call("POST", `/offer-templates/${target.id}/archive`, { as: "admin", ifMatch: target.version });
    expect(archived.status).toBe(200);
    const again = (await read("entity=welld_ch&formats=wizard")).json.items as { name: string }[];
    expect(again).toHaveLength(6);
    expect(again.some((item) => item.name === "Formazione")).toBe(false);
    expect(await wizardRows()).toHaveLength(7);
  });

  it("a read without `formats` seeds nothing and archives nothing", async () => {
    const res = await read("entity=welld_ch");
    expect(res.status).toBe(200);
    expect(await wizardRows()).toHaveLength(0);
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch", archivedAt: { not: null } } })).toBe(0);
    expect((await read("entity=welld_ch&formats=sections")).status).toBe(200);
    expect(await wizardRows()).toHaveLength(0);
  });

  it("welld_it gets none", async () => {
    const res = await read("entity=welld_it&formats=wizard");
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(0);
    expect(await wizardRows("welld_it")).toHaveLength(0);
    // and its legacy defaults stay active
    expect(await db.offerTemplate.count({ where: { entity: "welld_it", archivedAt: null } })).toBeGreaterThan(0);
  });

  it("an active template that already has a seed's name does not fail the read: that seed waits, the rest are created", async () => {
    // a wizard template made by hand on a never-read entity (no legacy defaults were seeded beside it)
    await makeWizardTemplate({ name: "Formazione", language: "it" });
    const res = await read("entity=welld_ch&formats=wizard");
    expect(res.status).toBe(200);
    const names = (res.json.items as { name: string }[]).map((item) => item.name).sort();
    expect(names).toHaveLength(7);
    expect(names.filter((name) => name === "Formazione")).toHaveLength(1);
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch", seedKey: "welld-ch-it-v2:T4" } })).toBe(0);
  });
});

describe("the catalog", () => {
  it("lists the seven codes with their seed keys, in the mockup's order", () => {
    expect(WELLD_CH_IT_V1.map((seed) => seed.code)).toEqual(EXPECTED.map(([code]) => code));
    for (const seed of WELLD_CH_IT_V1) {
      expect(seed.seedKey).toBe(`welld-ch-it-v2:${seed.code}`);
    }
    expect(WELLD_CH_IT_V1.find((seed) => seed.code === "T1+T3")?.mockupId).toBe("T13");
  });

  it("each seed parses with zero errors and fits the template columns", () => {
    for (const seed of WELLD_CH_IT_V1) {
      const errors = parseTemplate(seed.source).problems.filter((problem) => problem.severity === "error");
      expect(errors, seed.code).toEqual([]);
      expect(seed.source.length, seed.code).toBeLessThanOrEqual(150_000);
      expect(seed.name.length).toBeLessThanOrEqual(80);
      expect(seed.description.length).toBeLessThanOrEqual(160);
      expect(seed.uses.length).toBeLessThanOrEqual(6);
    }
  });

  it("the renames name only fields the seed declares (DD-48)", () => {
    expect(WELLD_CH_IT_V1_RENAMES.T4).toEqual([{ table: "MODULO", from: "ORE", to: "ORE_MODULO" }]);
    for (const [code, renames] of Object.entries(WELLD_CH_IT_V1_RENAMES)) {
      const seed = WELLD_CH_IT_V1.find((candidate) => candidate.code === code)!;
      const { ast } = parseTemplate(seed.source);
      for (const rename of renames) {
        const table = ast.tables.find((candidate) => candidate.name === rename.table);
        expect(table?.columns, `${code} ${rename.table}`).toContain(rename.to);
        expect(table?.columns).not.toContain(rename.from);
      }
    }
  });
});
