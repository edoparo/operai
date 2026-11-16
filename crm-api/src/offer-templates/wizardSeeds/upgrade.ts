/**
 * The one-time upgrade of the first wizard seed set (specs/20261115-crm-offer-wizard T63; DD-60; AC-12.5, AC-12.6, AC-12.11).
 *
 * The first release stored the seven seeds under `welld-ch-it-v1:<code>` with "WellD Sagl" written into the text; the
 * current texts (`welld-ch-it-v2:<code>`) bind the issuer to the entity profile. This runs inside `seedWizardTemplates`'
 * transaction, which already holds the entity's template advisory lock, BEFORE any v2 seed is inserted, and decides every
 * row that still carries a first-set key, once:
 *
 *   - its text hashes (SHA-256 of the exact bytes, no normalisation) to a recorded first-set text of its code
 *     (`V1_DIGESTS`) → the v2 text, the v2 key, `version + 1` (a draft started from it then shows the AC-8.4 notice
 *     through the ordinary `templateVersion` comparison), written by the system;
 *   - any other text (a person edited it) → only the key changes, to the kept key: text, version and timestamps stay as
 *     they were, and a kept row is never looked at again, so a later edit back to the old text is never replaced.
 *
 *   - a row whose code ALREADY has a row under its v2 or kept key (security L-7: a rollback to the first release inserted v1
 *     rows beside the v2 ones) can take neither key; it only drops its seed key (`null`), text, version, state and
 *     timestamps unchanged, so it is a plain template and is never selected again.
 *
 * It never touches `name`, `description`, `uses`, `archivedAt` or `language`; it creates, archives, restores and deletes
 * nothing, so an archived row stays archived and an active one stays active, and it calls no supersession. A row with no
 * seed key (a duplicate, a template a person wrote, one that took a seed's name) is not selected at all.
 *
 * Idempotent by construction: after a run no row carries a first-set key, so a second run selects nothing.
 */

import { createHash } from "node:crypto";
import { Prisma } from "../../lib/generated/prisma/client";
import type { TemplateTx } from "../supersession";
import { V1_DIGESTS, type V1Digest } from "./v1Digests";
import { WELLD_CH_IT_V1, type WizardSeedCode } from "./welldChIt";

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const SEED_AUTHOR = "system:crm-api";
type Entity = "welld_ch" | "welld_it";

export interface UpgradeOutcome {
  readonly upgraded: WizardSeedCode[];
  readonly kept: WizardSeedCode[];
  /** First-set rows whose code already had a row under its v2 or kept key: left as plain templates (security L-7). */
  readonly released: WizardSeedCode[];
}

/** Every key a first-set row can carry. */
export const FIRST_SET_KEYS: readonly string[] = WELLD_CH_IT_V1.map((seed) => seed.previousKey);

/**
 * Decides every first-set row of the entity. `digests` is injectable for the tests only; production passes nothing.
 * Must be called inside `inTemplateTransaction` (it relies on its lock and takes the rows' own locks besides).
 */
export async function upgradeWizardSeeds(
  tx: TemplateTx,
  entity: Entity,
  digests: Readonly<Record<WizardSeedCode, readonly V1Digest[]>> = V1_DIGESTS,
): Promise<UpgradeOutcome> {
  const outcome: { upgraded: WizardSeedCode[]; kept: WizardSeedCode[]; released: WizardSeedCode[] } = { upgraded: [], kept: [], released: [] };
  // The row locks: whoever else holds one of these rows (an edit that does not take the entity lock) finishes first, and
  // the rows are read after that, so the version compared below is the committed one.
  await tx.$queryRaw`SELECT id FROM "offer_template" WHERE entity = ${entity}::"Entity" AND "seedKey" IN (${Prisma.join(FIRST_SET_KEYS)}) FOR UPDATE`;
  const rows = await tx.offerTemplate.findMany({
    where: { entity, seedKey: { in: [...FIRST_SET_KEYS] } },
    select: { id: true, seedKey: true, source: true, version: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  // Every seed key in use, read under the entity lock (the seeding is the only writer of `seedKey`), so a key checked
  // free here is still free at the write: the unique index on (entity, seedKey) can never be hit by this loop.
  const taken = new Set(
    (await tx.offerTemplate.findMany({ where: { entity, seedKey: { not: null } }, select: { seedKey: true } })).map((row) => row.seedKey),
  );
  for (const row of rows) {
    const seed = WELLD_CH_IT_V1.find((candidate) => candidate.previousKey === row.seedKey);
    if (!seed) continue;
    if (taken.has(seed.seedKey) || taken.has(seed.keptKey)) {
      // The code is already decided by another row (a rollback to the first release re-inserted v1 rows beside the v2
      // ones, then a roll forward): this row can take neither key. It gives up its seed key and nothing else, so it is
      // a plain template from now on, never selected again, and the listing does not fail on the unique index.
      const { count } = await tx.offerTemplate.updateMany({
        where: { id: row.id, version: row.version },
        data: { seedKey: null, updatedAt: row.updatedAt },
      });
      if (count !== 1) continue;
      taken.delete(seed.previousKey);
      outcome.released.push(seed.code);
      console.log(JSON.stringify({ event: "offer_template.seed_upgrade", entity, code: seed.code, outcome: "released" }));
      continue;
    }
    const untouched = row.source !== null && digests[seed.code].some((entry) => entry.sha256 === sha256Hex(row.source!));
    const { count } = untouched
      ? await tx.offerTemplate.updateMany({
          where: { id: row.id, version: row.version },
          data: { source: seed.source, seedKey: seed.seedKey, version: row.version + 1, updatedBy: SEED_AUTHOR },
        })
      : await tx.offerTemplate.updateMany({
          // the kept mark is not an edit: version, text and the row's timestamp stay exactly as they were
          where: { id: row.id, version: row.version },
          data: { seedKey: seed.keptKey, updatedAt: row.updatedAt },
        });
    // The row lock makes a lost race impossible; if it ever happened the row keeps its first-set key and is decided by the next read.
    if (count !== 1) continue;
    taken.delete(seed.previousKey);
    taken.add(untouched ? seed.seedKey : seed.keptKey);
    (untouched ? outcome.upgraded : outcome.kept).push(seed.code);
    console.log(JSON.stringify({ event: "offer_template.seed_upgrade", entity, code: seed.code, outcome: untouched ? "upgraded" : "kept" }));
  }
  return outcome;
}
