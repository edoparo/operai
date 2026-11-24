/**
 * Revision 2 of the T1 and T1+T3 seeds (2026-11-24: the cost line has its own field, VOCE_DI_COSTO): on the first read
 * after the deploy, a v2 row whose text is still revision 1 byte for byte takes the new text (version + 1, written by
 * the system); an edited row keeps its text and is marked decided, never looked at again; the other seeds and every
 * new insert carry their revision (ADR 20261115-seeded-content-upgraded-in-place-only-when-unedited).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, resetWorld } from "../test-support/world";
import { firstV2Text } from "./wizardSeeds/revisions";
import { WELLD_CH_IT_V1, type WizardSeed } from "./wizardSeeds/welldChIt";

const SYSTEM = "system:crm-api";
const read = () => call("GET", "/offer-templates?entity=welld_ch&formats=wizard&includeArchived=true", { as: "admin" });
const seedOf = (code: string): WizardSeed => WELLD_CH_IT_V1.find((seed) => seed.code === code)!;
const rowOf = (seed: WizardSeed) => db.offerTemplate.findFirstOrThrow({ where: { entity: "welld_ch", seedKey: seed.seedKey } });

/** Every v2 seed as a database seeded before revision 2 holds it: revision-1 texts, no `seedRevision`. */
const storeBeforeRevision2 = (over: Partial<Record<string, Record<string, unknown>>> = {}) =>
  Promise.all(
    WELLD_CH_IT_V1.map((seed) =>
      db.offerTemplate.create({
        data: {
          entity: "welld_ch",
          format: "wizard",
          name: seed.name,
          language: "it",
          description: seed.description,
          uses: [...seed.uses],
          source: firstV2Text(seed),
          seedKey: seed.seedKey,
          createdBy: SYSTEM,
          updatedBy: SYSTEM,
          ...over[seed.code],
        },
      }),
    ),
  );

beforeEach(resetWorld);

describe("revision 2 of T1 and T1+T3", () => {
  it("the recorded revision-1 digest is the fixture's text, and only T1 and T1+T3 have a revision 2", () => {
    expect(WELLD_CH_IT_V1.filter((seed) => seed.revision > 1).map((seed) => seed.code)).toEqual(["T1", "T1+T3"]);
    for (const seed of WELLD_CH_IT_V1.filter((candidate) => candidate.revision > 1)) {
      expect(firstV2Text(seed)).not.toBe(seed.source);
      expect(seed.source).toContain("[VOCE_DI_COSTO]");
      expect(firstV2Text(seed)).not.toContain("VOCE_DI_COSTO");
    }
  });

  it("an untouched row takes the new text once, version + 1, by the system; the other seeds are left alone", async () => {
    const before = await storeBeforeRevision2();
    expect((await read()).status).toBe(200);
    for (const seed of WELLD_CH_IT_V1) {
      const was = before.find((row) => row.seedKey === seed.seedKey)!;
      const row = await rowOf(seed);
      if (seed.revision > 1) {
        expect(row.source, seed.code).toBe(seed.source);
        expect(row.version, seed.code).toBe(was.version + 1);
        expect(row.updatedBy).toBe(SYSTEM);
        expect(row.seedRevision).toBe(2);
      } else {
        expect(row.source, seed.code).toBe(was.source);
        expect(row.version, seed.code).toBe(was.version);
        expect(row.seedRevision).toBeNull();
      }
    }
    // A second read changes nothing.
    const t1 = await rowOf(seedOf("T1"));
    await read();
    expect((await rowOf(seedOf("T1"))).version).toBe(t1.version);
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch", format: "wizard" } })).toBe(7);
  });

  it("an edited row keeps its text, version and timestamp, is marked once and never replaced afterwards", async () => {
    const edited = `${firstV2Text(seedOf("T1"))}\nUna riga aggiunta da una persona.\n`;
    await storeBeforeRevision2({ T1: { source: edited, updatedBy: "user-admin", version: 3 } });
    const was = await rowOf(seedOf("T1"));
    await read();
    const row = await rowOf(seedOf("T1"));
    expect({ source: row.source, version: row.version, updatedBy: row.updatedBy, updatedAt: row.updatedAt }).toEqual({
      source: edited,
      version: 3,
      updatedBy: "user-admin",
      updatedAt: was.updatedAt,
    });
    expect(row.seedRevision).toBe(2);
    // The untouched T1+T3 still moved forward.
    expect((await rowOf(seedOf("T1+T3"))).source).toBe(seedOf("T1+T3").source);

    // Edited back to the old text by a person: decided already, so not replaced.
    await db.offerTemplate.update({ where: { id: row.id }, data: { source: firstV2Text(seedOf("T1")), version: 4 } });
    await read();
    expect((await rowOf(seedOf("T1"))).source).toBe(firstV2Text(seedOf("T1")));
  });

  it("a fresh seeding writes the current texts with their revision", async () => {
    await read();
    for (const seed of WELLD_CH_IT_V1) {
      const row = await rowOf(seed);
      expect(row.source, seed.code).toBe(seed.source);
      expect(row.seedRevision, seed.code).toBe(seed.revision);
    }
  });

  it("concurrent first reads revise each row exactly once", async () => {
    await storeBeforeRevision2();
    const results = await Promise.all(Array.from({ length: 5 }, () => read()));
    expect(results.every((res) => res.status === 200)).toBe(true);
    expect((await rowOf(seedOf("T1"))).version).toBe(2);
    expect((await rowOf(seedOf("T1+T3"))).version).toBe(2);
  });
});
