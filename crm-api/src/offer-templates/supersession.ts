/**
 * Supersession per (entity, language) (specs/20261115-crm-offer-wizard AC-9.2, DD-9; ADR
 * 20261115-offer-template-format-supersession-per-entity-language).
 *
 * The invariant: for an (entity, language) with an active wizard template, no legacy (`sections`) template is
 * active, and no write ever leaves the pair with no active template at all. The database cannot say it (it is
 * a rule across rows), so it lives HERE, in the few functions every writer of templates calls, under ONE
 * advisory lock per entity, `crm-offer-templates:<entity>`:
 *
 *   make a wizard template active  (create, duplicate, restore, a language change, a seed)
 *       → `supersedeLegacy(tx, …)` BEFORE the write (the active-name unique index would refuse a new
 *         "Formazione" while the legacy one is still active, and the error would blame the new row)
 *   make a legacy template active  (restore, duplicate, a language change)
 *       → `assertNotSuperseded(tx, …)`: refused while an active wizard template exists for the pair
 *   make a template not active     (archive, a language change out of the pair)
 *       → `assertNotLastActive(tx, …)`
 *
 * A new writer that activates or retires a template without going through these is a bug; the supersession
 * tests are the tripwire.
 */

import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import { conflict } from "../lib/problem";

export type TemplateTx = Prisma.TransactionClient;
type Entity = "welld_ch" | "welld_it";
type Language = "en" | "it";

/** The advisory lock every writer of an entity's templates holds (also the lazy seeding's). */
export const templateLockName = (entity: Entity): string => `crm-offer-templates:${entity}`;

export const lockTemplates = (tx: TemplateTx, entity: Entity) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${templateLockName(entity)}))`;

/** Runs `work` in a transaction that holds the entity's template lock from its first statement. */
export function inTemplateTransaction<T>(entity: Entity, work: (tx: TemplateTx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await lockTemplates(tx, entity);
    return work(tx);
  });
}

/** Archives the (entity, language)'s active legacy templates. Call it in the transaction of the write that leaves an active wizard template for the pair. */
export async function supersedeLegacy(
  tx: TemplateTx,
  entity: Entity,
  language: Language,
  actorId: string,
): Promise<number> {
  const { count } = await tx.offerTemplate.updateMany({
    where: { entity, language, format: "sections", archivedAt: null },
    data: { archivedAt: new Date(), version: { increment: 1 }, updatedBy: actorId },
  });
  return count;
}

/** A legacy template may not become active in a pair that has an active wizard template: 409 `template_superseded`. */
export async function assertNotSuperseded(tx: TemplateTx, entity: Entity, language: Language): Promise<void> {
  const wizard = await tx.offerTemplate.count({ where: { entity, language, format: "wizard", archivedAt: null } });
  if (wizard > 0) {
    throw conflict(
      "template_superseded",
      "This language has a wizard template; a classic template cannot be active beside it",
      { entity, language },
    );
  }
}

/**
 * The last active template of an (entity, language) cannot leave it (archived, or moved to another language):
 * 409 `last_template`. Only an ACTIVE template leaves anything; the caller skips an archived one.
 */
export async function assertNotLastActive(
  tx: TemplateTx,
  template: { readonly id: string; readonly entity: Entity; readonly language: Language },
): Promise<void> {
  const others = await tx.offerTemplate.count({
    where: { entity: template.entity, language: template.language, archivedAt: null, id: { not: template.id } },
  });
  if (others === 0) {
    throw conflict(
      "last_template",
      "This is the only active template for its entity and language; add another before archiving it",
      { entity: template.entity, language: template.language },
    );
  }
}
