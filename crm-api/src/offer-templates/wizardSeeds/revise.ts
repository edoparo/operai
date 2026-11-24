/**
 * Moving a seeded v2 template to a newer shipped revision of its text (2026-11-24; ADR 20261115-seeded-content-upgraded-in-
 * place-only-when-unedited). Runs inside `seedWizardTemplates`' transaction, which holds the entity's template lock,
 * AFTER the first-set upgrade and BEFORE any insert. Each row under a v2 key whose decided revision (`seedRevision`,
 * null = 1) is older than its seed's `revision` is decided once:
 *
 *   - its text hashes (SHA-256 of the exact bytes) to one of the seed's `previousRevisions` (or already IS the current
 *     text) → the current text, `version + 1` when the text changes (a draft started from it then shows the AC-8.4
 *     notice), `seedRevision` = current, written by the system;
 *   - any other text (a person edited it) → only `seedRevision` is set: text, version and timestamp stay as they were,
 *     and the row is never looked at again, so a later edit back to an old text is never replaced.
 *
 * It never touches the key, name, description, uses, state or language, and creates, archives or deletes nothing.
 * Idempotent: after a run every selected row carries the current revision.
 */

import { createHash } from "node:crypto";
import { Prisma } from "../../lib/generated/prisma/client";
import type { TemplateTx } from "../supersession";
import { WELLD_CH_IT_V1, type WizardSeed, type WizardSeedCode } from "./welldChIt";

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const SEED_AUTHOR = "system:crm-api";
type Entity = "welld_ch" | "welld_it";

/** The seeds with more than one shipped revision: the only ones a stored row can be behind on. */
export const REVISED_SEEDS: readonly WizardSeed[] = WELLD_CH_IT_V1.filter((seed) => seed.revision > 1);

/** The `where` of the rows still to decide; also the seeding's lock-free "anything to do?" count. */
export const behindWhere = (entity: Entity): Prisma.OfferTemplateWhereInput => ({
  entity,
  OR: REVISED_SEEDS.map((seed) => ({
    seedKey: seed.seedKey,
    OR: [{ seedRevision: null }, { seedRevision: { lt: seed.revision } }],
  })),
});

export interface ReviseOutcome {
  readonly revised: WizardSeedCode[];
  readonly kept: WizardSeedCode[];
}

export async function reviseWizardSeeds(tx: TemplateTx, entity: Entity): Promise<ReviseOutcome> {
  const outcome: { revised: WizardSeedCode[]; kept: WizardSeedCode[] } = { revised: [], kept: [] };
  if (REVISED_SEEDS.length === 0) return outcome;
  const keys = REVISED_SEEDS.map((seed) => seed.seedKey);
  // The rows' own locks: an edit that does not take the entity lock finishes first, so the version compared is committed.
  await tx.$queryRaw`SELECT id FROM "offer_template" WHERE entity = ${entity}::"Entity" AND "seedKey" IN (${Prisma.join(keys)}) FOR UPDATE`;
  const rows = await tx.offerTemplate.findMany({
    where: behindWhere(entity),
    select: { id: true, seedKey: true, source: true, version: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  for (const row of rows) {
    const seed = REVISED_SEEDS.find((candidate) => candidate.seedKey === row.seedKey);
    if (!seed) continue;
    const digest = row.source === null ? null : sha256Hex(row.source);
    const current = row.source === seed.source;
    const untouched = digest !== null && seed.previousRevisions.includes(digest);
    const { count } = current
      ? await tx.offerTemplate.updateMany({
          where: { id: row.id, version: row.version },
          data: { seedRevision: seed.revision, updatedAt: row.updatedAt },
        })
      : untouched
        ? await tx.offerTemplate.updateMany({
            where: { id: row.id, version: row.version },
            data: { source: seed.source, seedRevision: seed.revision, version: row.version + 1, updatedBy: SEED_AUTHOR },
          })
        : await tx.offerTemplate.updateMany({
            // the kept mark is not an edit: text, version and the row's timestamp stay exactly as they were
            where: { id: row.id, version: row.version },
            data: { seedRevision: seed.revision, updatedAt: row.updatedAt },
          });
    if (count !== 1) continue;
    const result = current || untouched ? "revised" : "kept";
    (result === "revised" ? outcome.revised : outcome.kept).push(seed.code);
    console.log(
      JSON.stringify({ event: "offer_template.seed_revision", entity, code: seed.code, revision: seed.revision, outcome: result }),
    );
  }
  return outcome;
}
