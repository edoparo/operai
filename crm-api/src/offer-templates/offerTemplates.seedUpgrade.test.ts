/**
 * The one-time upgrade of the first set's seeds (specs/20261115-crm-offer-wizard T63; DD-60; AC-12.5, AC-12.6, AC-12.11,
 * AC-8.4): inside the lazy wizard seeding, under the entity's advisory lock and before any v2 seed is inserted, a v1
 * row whose text is byte-identical to a shipped v1 text becomes the v2 text; any other v1 row is marked kept; nothing is
 * created, resurrected, archived or deleted by it, and it takes effect once.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { sha256 } from "../../scripts/seed-digests";
import { readyDealWithProfiles, call, db, makeDraftTemplate, resetWorld } from "../test-support/world";
import { inTemplateTransaction } from "./supersession";
import { upgradeWizardSeeds } from "./wizardSeeds/upgrade";
import { toV1 } from "./wizardSeeds/toV1";
import { V1_DIGESTS } from "./wizardSeeds/v1Digests";
import { WELLD_CH_IT_V1, type WizardSeed } from "./wizardSeeds/welldChIt";

const SYSTEM = "system:crm-api";
const read = () => call("GET", "/offer-templates?entity=welld_ch&formats=wizard&includeArchived=true", { as: "admin" });
const seedOf = (code: string): WizardSeed => WELLD_CH_IT_V1.find((seed) => seed.code === code)!;
const rowsOf = (entity: "welld_ch" | "welld_it" = "welld_ch") =>
  db.offerTemplate.findMany({ where: { entity, format: "wizard" }, orderBy: { name: "asc" } });
const byCode = async (code: string) => (await db.offerTemplate.findMany({ where: { entity: "welld_ch", seedKey: { in: [`welld-ch-it-v2:${code}`, `welld-ch-it-v1:${code}`, `welld-ch-it-v1-kept:${code}`] } } }))[0]!;

/** A row as the first release stored it: the v1 text, the v1 key, written by the system. */
async function storeV1(seed: WizardSeed, over: Record<string, unknown> = {}, entity: "welld_ch" | "welld_it" = "welld_ch") {
  return db.offerTemplate.create({
    data: {
      entity,
      format: "wizard",
      name: seed.name,
      language: "it",
      description: seed.description,
      uses: [...seed.uses],
      source: toV1(seed.source),
      seedKey: seed.previousKey,
      createdBy: SYSTEM,
      updatedBy: SYSTEM,
      ...over,
    },
  });
}
const storeAllV1 = () => Promise.all(WELLD_CH_IT_V1.map((seed) => storeV1(seed)));

beforeEach(resetWorld);

describe("an untouched first-set row (AC-12.5, AC-12.11)", () => {
  it("takes the v2 text and key, version + 1, written by the system, and keeps name, card text, state and creator", async () => {
    const before = await storeAllV1();
    const res = await read();
    expect(res.status).toBe(200);
    const after = await rowsOf();
    expect(after).toHaveLength(7);
    for (const seed of WELLD_CH_IT_V1) {
      const was = before.find((row) => row.seedKey === seed.previousKey)!;
      const row = after.find((candidate) => candidate.id === was.id)!;
      expect(row.source, seed.code).toBe(seed.source);
      expect(row.seedKey, seed.code).toBe(seed.seedKey);
      expect(row.version, seed.code).toBe(was.version + 1);
      expect(row.updatedBy).toBe(SYSTEM);
      expect({ name: row.name, description: row.description, uses: row.uses, archivedAt: row.archivedAt, createdBy: row.createdBy, language: row.language }).toEqual({
        name: was.name,
        description: was.description,
        uses: was.uses,
        archivedAt: null,
        createdBy: SYSTEM,
        language: "it",
      });
    }
  });

  it("an archived row stays archived, an active one stays active, and nothing is created or removed", async () => {
    const archivedAt = new Date("2026-11-01T10:00:00Z");
    await Promise.all(WELLD_CH_IT_V1.map((seed) => storeV1(seed, seed.code === "T4" || seed.code === "T6" ? { archivedAt } : {})));
    await read();
    const after = await rowsOf();
    expect(after).toHaveLength(7);
    for (const row of after) {
      const archived = row.seedKey === "welld-ch-it-v2:T4" || row.seedKey === "welld-ch-it-v2:T6";
      expect(row.archivedAt?.toISOString() ?? null, row.seedKey ?? "").toBe(archived ? archivedAt.toISOString() : null);
      expect(row.version).toBe(2);
    }
    expect(after.find((row) => row.seedKey === "welld-ch-it-v2:T4")!.source).toBe(seedOf("T4").source);
  });

  it("an archived row does not bring a duplicate: no second template carries its name", async () => {
    await Promise.all(WELLD_CH_IT_V1.map((seed) => storeV1(seed, seed.code === "T4" ? { archivedAt: new Date() } : {})));
    await read();
    await read();
    expect((await rowsOf()).filter((row) => row.name === "Formazione")).toHaveLength(1);
  });

  it("matches ANY recorded revision of a code, not only the last", async () => {
    const t4 = seedOf("T4");
    const olderText = "an earlier revision of the first set, as an old release stored it\n";
    const older = await storeV1(t4, { source: olderText });
    const digests = { ...V1_DIGESTS, T4: [{ sha256: sha256(olderText), commit: "00000000" }, ...V1_DIGESTS.T4] };
    const outcome = await inTemplateTransaction("welld_ch", (tx) => upgradeWizardSeeds(tx, "welld_ch", digests));
    expect(outcome).toEqual({ upgraded: ["T4"], kept: [], released: [] });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: older.id } })).toMatchObject({ source: t4.source, seedKey: t4.seedKey, version: 2 });
  });

  it("is idempotent: a second read changes nothing, not even the timestamps", async () => {
    await storeAllV1();
    await read();
    const first = await rowsOf();
    await read();
    await call("GET", "/offer-templates?entity=welld_ch&formats=sections,wizard", { as: "admin" });
    expect(await rowsOf()).toEqual(first);
  });

  it("a read of an entity that never held the first set inserts the v2 texts directly, version 1, and upgrades nothing", async () => {
    await read();
    const rows = await rowsOf();
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.version === 1 && row.seedKey?.startsWith("welld-ch-it-v2:"))).toBe(true);
  });

  it("a partial first set: the rows present are upgraded, the missing codes are inserted as v2, none twice", async () => {
    await storeV1(seedOf("T1"));
    await storeV1(seedOf("T5"), { archivedAt: new Date() });
    await read();
    const rows = await rowsOf();
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.seedKey).sort()).toEqual(WELLD_CH_IT_V1.map((seed) => seed.seedKey).sort());
    expect((await byCode("T1")).version).toBe(2);
    expect((await byCode("T5")).version).toBe(2);
    expect((await byCode("T5")).archivedAt).not.toBeNull();
    expect((await byCode("T2")).version).toBe(1);
  });

  it("only formats=wizard runs it: a read for the classic templates leaves a first-set row alone", async () => {
    const row = await storeV1(seedOf("T1"));
    await call("GET", "/offer-templates?entity=welld_ch", { as: "admin" });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ seedKey: seedOf("T1").previousKey, version: 1 });
  });
});

describe("what a person wrote is never overwritten (AC-12.6, AC-12.11)", () => {
  it("an edited first-set row keeps its text, version and timestamps, and is marked kept", async () => {
    const t1 = seedOf("T1");
    const edited = await storeV1(t1, { source: `${toV1(t1.source)}\nUna riga aggiunta da una persona.\n`, updatedBy: "user-admin", version: 4 });
    await Promise.all(WELLD_CH_IT_V1.filter((seed) => seed.code !== "T1").map((seed) => storeV1(seed)));
    const before = await db.offerTemplate.findUniqueOrThrow({ where: { id: edited.id } });
    await read();
    const after = await db.offerTemplate.findUniqueOrThrow({ where: { id: edited.id } });
    expect(after.seedKey).toBe(t1.keptKey);
    expect({ ...after, seedKey: null }).toEqual({ ...before, seedKey: null });
  });

  it("a whitespace-only change is an edit: the comparison is exact, not normalised", async () => {
    const t2 = seedOf("T2");
    await storeV1(t2, { source: `${toV1(t2.source)} ` });
    await read();
    const row = await byCode("T2");
    expect(row.seedKey).toBe(t2.keptKey);
    expect(row.source).toBe(`${toV1(t2.source)} `);
  });

  it("the text of the CURRENT (v2) seed under a v1 key is not a first-set text: kept, not rewritten", async () => {
    const t3 = seedOf("T3");
    await storeV1(t3, { source: t3.source });
    await read();
    expect(await byCode("T3")).toMatchObject({ seedKey: t3.keptKey, version: 1, source: t3.source });
  });

  it("a kept row is decided once: editing it back to the first-set text later is never upgraded", async () => {
    const t1 = seedOf("T1");
    await storeV1(t1, { source: `${toV1(t1.source)}x` });
    await read();
    const kept = await byCode("T1");
    expect(kept.seedKey).toBe(t1.keptKey);
    const put = await call("PUT", `/offer-templates/${kept.id}`, {
      as: "admin",
      ifMatch: kept.version,
      body: { name: kept.name, language: "it", description: kept.description ?? "", uses: kept.uses, source: toV1(t1.source) },
    });
    expect(put.status).toBe(200);
    const edited = await db.offerTemplate.findUniqueOrThrow({ where: { id: kept.id } });
    await read();
    await read();
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(edited);
    expect(edited.source).toBe(toV1(t1.source));
  });

  it("a kept code is never inserted again, even when the person renamed the row so its seed name is free", async () => {
    const t4 = seedOf("T4");
    await storeV1(t4, { name: "Il mio corso", source: "scritto da una persona\n" });
    await read();
    const rows = await rowsOf();
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.name === "Formazione")).toHaveLength(0);
    expect(rows.filter((row) => row.seedKey?.endsWith(":T4"))).toHaveLength(1);
  });

  it("a duplicate with the first-set text (no seed key) and a template that took a seed's name are never touched", async () => {
    const t1 = seedOf("T1");
    const duplicate = await db.offerTemplate.create({
      data: { entity: "welld_ch", format: "wizard", name: "Progetto a corpo (copia)", language: "it", description: "copia", uses: [], source: toV1(t1.source), createdBy: "user-admin", updatedBy: "user-admin" },
    });
    const squatter = await db.offerTemplate.create({
      data: { entity: "welld_ch", format: "wizard", name: "Formazione", language: "it", description: null, uses: [], source: toV1(seedOf("T4").source), createdBy: "user-admin", updatedBy: "user-admin" },
    });
    await storeV1(t1);
    await read();
    await read();
    for (const row of [duplicate, squatter]) {
      expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    }
    expect((await rowsOf()).filter((row) => row.name === "Formazione")).toHaveLength(1);
    expect((await byCode("T1")).version).toBe(2);
  });

  it("welld_it holds no seed and nothing is done to a row carrying a first-set key there", async () => {
    const row = await storeV1(seedOf("T1"), {}, "welld_it");
    await call("GET", "/offer-templates?entity=welld_it&formats=wizard", { as: "admin" });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });
});

describe("a first-set row that coexists with a decided one for its code (security L-7)", () => {
  // The rollback -> roll-forward case: the previous release counts only v1 keys, so after an upgrade it inserts v1 rows
  // beside the v2 ones; the roll-forward then meets both. The listing must answer, and decide the stray once.
  it("a v1 row beside a v2 row of the same code: the read answers 200, the stray is released unchanged, the v2 row is untouched, and a second read changes nothing", async () => {
    expect((await read()).status).toBe(200);
    const v2Before = await db.offerTemplate.findMany({ where: { entity: "welld_ch", seedKey: { startsWith: "welld-ch-it-v2:" } }, orderBy: { seedKey: "asc" } });
    expect(v2Before).toHaveLength(7);
    const stray = await storeV1(seedOf("T1"), { archivedAt: new Date("2026-11-02T08:00:00Z") });
    const again = await read();
    expect(again.status).toBe(200);
    const after = await db.offerTemplate.findUniqueOrThrow({ where: { id: stray.id } });
    expect(after.seedKey).toBeNull();
    expect({ source: after.source, version: after.version, archivedAt: after.archivedAt, name: after.name, updatedAt: after.updatedAt }).toEqual({
      source: stray.source,
      version: stray.version,
      archivedAt: stray.archivedAt,
      name: stray.name,
      updatedAt: stray.updatedAt,
    });
    const v2After = await db.offerTemplate.findMany({ where: { entity: "welld_ch", seedKey: { startsWith: "welld-ch-it-v2:" } }, orderBy: { seedKey: "asc" } });
    expect(v2After).toEqual(v2Before);
    expect((await read()).status).toBe(200);
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: stray.id } })).toEqual(after);
    expect(await rowsOf()).toHaveLength(8);
  });

  it("a v1 row beside a KEPT row, and one beside both a kept and a v2 key, never fail the listing either", async () => {
    // T1 is kept (edited first-set row), T2 has v2 and kept both (one row each), and a stray v1 row exists for each
    await storeV1(seedOf("T1"), { source: `${toV1(seedOf("T1").source)}\n` });
    await storeV1(seedOf("T2"));
    expect((await read()).status).toBe(200);
    await db.offerTemplate.create({
      data: { entity: "welld_ch", format: "wizard", name: "Stray T1", language: "it", uses: [], source: toV1(seedOf("T1").source), seedKey: seedOf("T1").previousKey, archivedAt: new Date(), createdBy: SYSTEM, updatedBy: SYSTEM },
    });
    await db.offerTemplate.create({
      data: { entity: "welld_ch", format: "wizard", name: "Kept T2", language: "it", uses: [], source: "x", seedKey: seedOf("T2").keptKey, archivedAt: new Date(), createdBy: SYSTEM, updatedBy: SYSTEM },
    });
    await db.offerTemplate.create({
      data: { entity: "welld_ch", format: "wizard", name: "Stray T2", language: "it", uses: [], source: toV1(seedOf("T2").source), seedKey: seedOf("T2").previousKey, archivedAt: new Date(), createdBy: SYSTEM, updatedBy: SYSTEM },
    });
    expect((await read()).status).toBe(200);
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch", seedKey: { in: WELLD_CH_IT_V1.map((seed) => seed.previousKey) } } })).toBe(0);
    expect((await read()).status).toBe(200);
  });
});

describe("drafts on an upgraded template (AC-8.4, AC-12.5)", () => {
  it("get the template-changed notice and keep their answers; a kept template changes nothing for its drafts", async () => {
    const { deal } = await readyDealWithProfiles();
    // two first-set rows the draft wizard can use: one untouched, one edited
    const untouched = await makeDraftTemplate();
    const edited = await makeDraftTemplate();
    const t1 = seedOf("T1");
    const t2 = seedOf("T2");
    const source = toV1(t1.source);
    await db.offerTemplate.update({ where: { id: untouched.id }, data: { seedKey: t1.previousKey, source, name: t1.name } });
    await db.offerTemplate.update({ where: { id: edited.id }, data: { seedKey: t2.previousKey, name: t2.name } });
    const draft = await call("POST", `/deals/${deal.id}/offer-draft`, { as: "admin", body: { templateId: untouched.id }, headers: { "If-None-Match": "*" } });
    expect(draft.status).toBe(201);
    const before = await call("GET", `/deals/${deal.id}/offer-draft/summary`);
    expect(before.json.draft.templateChanged).toBe(false);
    const answers = (await call("GET", `/deals/${deal.id}/offer-draft`)).json.answers;

    await read();

    const after = await call("GET", `/deals/${deal.id}/offer-draft/summary`);
    expect(after.json.draft.templateChanged).toBe(true);
    expect((await call("GET", `/deals/${deal.id}/offer-draft`)).json.answers).toEqual(answers);
    expect((await db.offerTemplate.findUniqueOrThrow({ where: { id: untouched.id } })).version).toBe(2);
    // the edited one was kept: no version bump, so no notice for a draft made from it
    expect((await db.offerTemplate.findUniqueOrThrow({ where: { id: edited.id } })).version).toBe(1);
  });
});

describe("concurrency", () => {
  it("five concurrent first reads upgrade each row exactly once", async () => {
    await storeAllV1();
    const results = await Promise.all(Array.from({ length: 5 }, () => read()));
    for (const res of results) expect(res.status).toBe(200);
    const rows = await rowsOf();
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.version === 2 && row.seedKey?.startsWith("welld-ch-it-v2:"))).toBe(true);
  });

  it("an edit that lands while a read upgrades is never overwritten: the read decides under the row lock, the edit waits for it or follows it", async () => {
    const t1 = seedOf("T1");
    const row = await storeV1(t1);
    await Promise.all(WELLD_CH_IT_V1.filter((seed) => seed.code !== "T1").map((seed) => storeV1(seed)));
    const edit = call("PUT", `/offer-templates/${row.id}`, {
      as: "admin",
      ifMatch: 1,
      body: { name: row.name, language: "it", description: row.description ?? "", uses: row.uses, source: `${seedOf("T1").source}\n` },
    });
    const [list, put] = await Promise.all([read(), edit]);
    expect(list.status).toBe(200);
    const final = await db.offerTemplate.findUniqueOrThrow({ where: { id: row.id } });
    // either the edit won the lock (its text stands) or the upgrade did (the edit then met a stale ETag); never a lost edit
    if (put.status === 200) expect(final.source).toBe(`${seedOf("T1").source}\n`);
    else expect([409, 428]).toContain(put.status);
  });
});
