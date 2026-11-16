/**
 * The `offer_wizard` migration (specs/20261115-crm-offer-wizard T15; plan.md § Data model): the format of a
 * template, the constraint between that format and the columns that hold its content, the `seedKey`
 * index and the draft table. Exercised at the database, through raw SQL, because the CHECKs and the
 * partial index are enforcement that Prisma's schema cannot express.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db, resetWorld } from "../test-support/world";
import { legacyContent } from "../offers/legacyContent";

const SECTIONS = JSON.stringify([{ heading: "Costs", body: "", costs: true }]);
const LINES = JSON.stringify([{ description: "Work", kind: "one_off", amount: "deal", quantity: 1 }]);
const COLUMNS = JSON.stringify({ position: true, unit: false });

let counter = 0;
const nextId = () => `tpl-${(counter += 1)}`;

/** A legacy row as it was written before the migration: none of the new columns named. */
async function insertPreMigrationRow(id = nextId()) {
  await db.$executeRawUnsafe(
    `INSERT INTO "offer_template"
       ("id","entity","name","language","salutation","opening","sections","costLines","costColumns","createdBy","updatedBy","updatedAt")
     VALUES ($1,'welld_ch',$2,'it','Spett.','Opening',$3::jsonb,$4::jsonb,$5::jsonb,'u','u',now())`,
    id,
    `legacy ${id}`,
    SECTIONS,
    LINES,
    COLUMNS,
  );
  return id;
}

/** A row with exactly the columns given, so the CHECK sees what the test says it sees. */
async function insertRow(columns: {
  format: "sections" | "wizard";
  legacy: boolean;
  source?: string | null;
  seedKey?: string | null;
  entity?: string;
}) {
  const id = nextId();
  await db.$executeRawUnsafe(
    `INSERT INTO "offer_template"
       ("id","entity","name","language","format","salutation","opening","sections","costLines","costColumns","source","seedKey","createdBy","updatedBy","updatedAt")
     VALUES ($1,$2::"Entity",$3,'it',$4::"OfferTemplateFormat",$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,'u','u',now())`,
    id,
    columns.entity ?? "welld_ch",
    `row ${id}`,
    columns.format,
    columns.legacy ? "Spett." : null,
    columns.legacy ? "Opening" : null,
    columns.legacy ? SECTIONS : null,
    columns.legacy ? LINES : null,
    columns.legacy ? COLUMNS : null,
    columns.source ?? null,
    columns.seedKey ?? null,
  );
  return id;
}

const refusedBy = async (constraint: string, run: () => Promise<unknown>) => {
  let message = "";
  try {
    await run();
  } catch (error) {
    message = `${(error as Error).message} ${JSON.stringify(error)}`;
  }
  expect(message, `expected the constraint ${constraint} to refuse the write`).toContain(constraint);
};

describe("the offer_wizard migration: templates (AC-8.1, AC-9.4)", () => {
  beforeEach(resetWorld);

  it("reads a row written before the migration back as a sections template with empty wizard columns", async () => {
    const id = await insertPreMigrationRow();
    const row = await db.offerTemplate.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ format: "sections", description: null, uses: [], source: null, seedKey: null });
    expect(row.salutation).toBe("Spett.");
  });

  it("accepts a wizard row with a source and no legacy content, and a sections row with its content", async () => {
    await insertRow({ format: "wizard", legacy: false, source: "## COSTI\n@@costs\n" });
    await insertRow({ format: "sections", legacy: true });
    expect(await db.offerTemplate.count()).toBe(2);
  });

  it("refuses a wizard row without a source", async () => {
    await refusedBy("offer_template_format_content", () => insertRow({ format: "wizard", legacy: false }));
  });

  it("refuses a wizard row whose source is longer than 150 000 characters", async () => {
    await refusedBy("offer_template_format_content", () =>
      insertRow({ format: "wizard", legacy: false, source: "x".repeat(150_001) }),
    );
    await insertRow({ format: "wizard", legacy: false, source: "x".repeat(150_000) });
  });

  it("refuses a sections row that carries a source", async () => {
    await refusedBy("offer_template_format_content", () => insertRow({ format: "sections", legacy: true, source: "text" }));
  });

  it("refuses a sections row missing any legacy column", async () => {
    await refusedBy("offer_template_format_content", () => insertRow({ format: "sections", legacy: false }));
    for (const column of ["salutation", "opening", "sections", "costLines", "costColumns"]) {
      const id = await insertPreMigrationRow();
      await refusedBy("offer_template_format_content", () =>
        db.$executeRawUnsafe(`UPDATE "offer_template" SET "${column}" = NULL WHERE "id" = $1`, id),
      );
    }
  });

  it("refuses to turn a sections row into a wizard row without giving it a source (and the reverse)", async () => {
    const id = await insertPreMigrationRow();
    await refusedBy("offer_template_format_content", () =>
      db.$executeRawUnsafe(`UPDATE "offer_template" SET "format" = 'wizard' WHERE "id" = $1`, id),
    );
    const wizard = await insertRow({ format: "wizard", legacy: false, source: "s" });
    await refusedBy("offer_template_format_content", () =>
      db.$executeRawUnsafe(`UPDATE "offer_template" SET "format" = 'sections' WHERE "id" = $1`, wizard),
    );
  });

  it("keeps a seedKey unique per entity, among rows that have one", async () => {
    await insertRow({ format: "wizard", legacy: false, source: "s", seedKey: "welld-ch-it-v1:T1" });
    await refusedBy("offer_template_entity_seed_key", () =>
      insertRow({ format: "wizard", legacy: false, source: "s", seedKey: "welld-ch-it-v1:T1" }),
    );
    // another entity may hold the same key; rows without a key never collide
    await insertRow({ format: "wizard", legacy: false, source: "s", seedKey: "welld-ch-it-v1:T1", entity: "welld_it" });
    await insertRow({ format: "wizard", legacy: false, source: "s" });
    await insertRow({ format: "wizard", legacy: false, source: "s" });
  });

  it("still keeps an active template name unique per entity, case-insensitively", async () => {
    const a = await insertPreMigrationRow("same");
    expect(a).toBe("same");
    await refusedBy("offer_template_entity_name_active_key", () =>
      db.$executeRawUnsafe(
        `INSERT INTO "offer_template" ("id","entity","name","language","format","source","createdBy","updatedBy","updatedAt")
         VALUES ('other','welld_ch','LEGACY SAME','it','wizard','s','u','u',now())`,
      ),
    );
  });
});

describe("the offer_wizard migration: the draft table (AC-6.1)", () => {
  beforeEach(resetWorld);

  async function world() {
    const company = await db.company.create({ data: { name: `Acme ${nextId()}`, status: "customer", entity: "welld_ch", ownerUserId: "u", createdBy: "u", updatedBy: "u" } });
    const deal = await db.deal.create({
      data: { companyId: company.id, title: "Platform", currency: "CHF", entity: "welld_ch", ownerUserId: "u", createdBy: "u", updatedBy: "u" },
    });
    const templateId = await insertRow({ format: "wizard", legacy: false, source: "s" });
    const offer = await db.dealOffer.create({
      data: {
        dealId: deal.id,
        number: 1,
        language: "it",
        priceCents: 100n,
        currency: "CHF",
        validityDays: 30,
        snapshot: {},
        objectKey: "k",
        sizeBytes: 1,
        createdBy: "u",
      },
    });
    return { dealId: deal.id, templateId, offerId: offer.id };
  }

  const insertDraft = (
    w: { dealId: string; templateId: string },
    target: { kind: "new" | "edit" | "revision"; offerId?: string | null; offerVersion?: number | null },
  ) =>
    db.$executeRawUnsafe(
      `INSERT INTO "offer_draft"
         ("dealId","templateId","templateVersion","targetKind","targetOfferId","targetOfferVersion","answers","createdBy","updatedBy","updatedAt")
       VALUES ($1,$2,1,$3::"OfferDraftTarget",$4,$5,'{}'::jsonb,'u','u',now())`,
      w.dealId,
      w.templateId,
      target.kind,
      target.offerId ?? null,
      target.offerVersion ?? null,
    );

  it("holds one draft per deal, of version 1, for a new offer", async () => {
    const w = await world();
    await insertDraft(w, { kind: "new" });
    const row = await db.$queryRawUnsafe<{ version: number; targetKind: string }[]>(
      `SELECT "version","targetKind" FROM "offer_draft" WHERE "dealId" = $1`,
      w.dealId,
    );
    expect(row).toEqual([{ version: 1, targetKind: "new" }]);
    await refusedBy("offer_draft_pkey", () => insertDraft(w, { kind: "new" }));
  });

  it("offer_draft_target refuses targetKind 'new' with an offer id, and an edit or revision without one", async () => {
    const w = await world();
    await refusedBy("offer_draft_target", () => insertDraft(w, { kind: "new", offerId: w.offerId, offerVersion: 1 }));
    await refusedBy("offer_draft_target", () => insertDraft(w, { kind: "edit" }));
    await refusedBy("offer_draft_target", () => insertDraft(w, { kind: "revision" }));
    // an offer id without its version, or a version without the id
    await refusedBy("offer_draft_target", () => insertDraft(w, { kind: "edit", offerId: w.offerId }));
    await refusedBy("offer_draft_target", () => insertDraft(w, { kind: "new", offerVersion: 1 }));
    await insertDraft(w, { kind: "edit", offerId: w.offerId, offerVersion: 1 });
  });

  it("refuses a draft of a deal or template that does not exist", async () => {
    const w = await world();
    await refusedBy("offer_draft_dealId_fkey", () => insertDraft({ ...w, dealId: "nope" }, { kind: "new" }));
    await refusedBy("offer_draft_templateId_fkey", () => insertDraft({ ...w, templateId: "nope" }, { kind: "new" }));
  });

  it("restricts deleting a template or an offer a draft points at", async () => {
    const w = await world();
    await insertDraft(w, { kind: "edit", offerId: w.offerId, offerVersion: 1 });
    await refusedBy("offer_draft_templateId_fkey", () =>
      db.$executeRawUnsafe(`DELETE FROM "offer_template" WHERE "id" = $1`, w.templateId),
    );
    await refusedBy("offer_draft_targetOfferId_fkey", () =>
      db.$executeRawUnsafe(`DELETE FROM "deal_offer" WHERE "id" = $1`, w.offerId),
    );
  });

  it("is deleted with its deal", async () => {
    const w = await world();
    await insertDraft(w, { kind: "new" });
    await db.$executeRawUnsafe(`DELETE FROM "deal_offer" WHERE "dealId" = $1`, w.dealId);
    await db.$executeRawUnsafe(`DELETE FROM "deal" WHERE "id" = $1`, w.dealId);
    expect(await db.$queryRawUnsafe(`SELECT 1 FROM "offer_draft"`)).toEqual([]);
  });
});

describe("legacyContent: the one door to a template's legacy columns", () => {
  beforeEach(resetWorld);

  it("returns the legacy content of a sections row", async () => {
    const id = await insertPreMigrationRow();
    const content = legacyContent(await db.offerTemplate.findUniqueOrThrow({ where: { id } }));
    expect(content).toMatchObject({ salutation: "Spett.", opening: "Opening", showTotal: false, annex: false });
    expect(content.sections).toEqual([{ heading: "Costs", body: "", costs: true }]);
    expect(content.costColumns).toEqual({ position: true, unit: false });
  });

  it("refuses a wizard row with a 409 template_format_mismatch, never a half-empty content", async () => {
    const id = await insertRow({ format: "wizard", legacy: false, source: "s" });
    const row = await db.offerTemplate.findUniqueOrThrow({ where: { id } });
    let thrown: unknown;
    try {
      legacyContent(row);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 409, code: "template_format_mismatch" });
  });
});

describe("the migration file", () => {
  const dir = join(import.meta.dir, "../../prisma/migrations");
  const name = readdirSync(dir).find((entry) => entry.endsWith("_offer_wizard"));
  const sql = name ? readFileSync(join(dir, name, "migration.sql"), "utf-8") : "";
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("exists, as the one migration of this feature", () => {
    expect(name).toBeDefined();
    expect(readdirSync(dir).filter((entry) => entry.includes("offer_wizard"))).toHaveLength(1);
  });

  it("never alters, updates or deletes deal_offer — it only points a foreign key at it (AC-9.4)", () => {
    expect(statements).not.toMatch(/ALTER\s+TABLE\s+"?deal_offer"?/i);
    expect(statements).not.toMatch(/UPDATE\s+"?deal_offer"?/i);
    expect(statements).not.toMatch(/DELETE\s+FROM\s+"?deal_offer"?/i);
    expect(statements).not.toMatch(/(DROP|TRUNCATE)[^;]*"?deal_offer"?/i);
    expect(statements).toMatch(/REFERENCES\s+"deal_offer"/);
  });

  it("changes no existing template row: no UPDATE, DELETE or DROP of data", () => {
    expect(statements).not.toMatch(/\bUPDATE\s+"?offer_template"?/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i);
  });
});
