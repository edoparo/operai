# 20261115 — A wizard template replaces the legacy templates of its entity and language in the transaction that makes it active, and never before

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's delegation of 2026-11-15 (specs/20261115-crm-offer-wizard, § Delegated decisions DD-9, DD-10, DD-11), pending the owner's review  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

Offer templates of specs/20261102-crm-offer-document are full contract texts (the legacy format). The wizard's templates are a different format, and they exist first for one entity and one language only: `welld_ch` in Italian (AC-9.1). Entities `welld_it` and `welld_ch` in English stay on the legacy dialog until wellD supplies their texts (AC-9.3), and AC-9.2 requires that no entity is ever left unable to make an offer: a legacy template is archived only when its entity and language get their first wizard template, and not before. The crm-api and crm-ui deploys are separate, so an old client must keep working against a new server (R4).

## Decision

We will add a `format` column to `offer_template` (`sections` | `wizard`; existing rows are `sections`). Any write that leaves an active wizard template for an (entity, language) — create, duplicate, restore, a language change, or a seed — archives that (entity, language)'s active legacy templates in the same transaction, under the existing advisory lock `crm-offer-templates:<entity>`, before its own insert.

1. A legacy template cannot be restored while an active wizard template exists for its (entity, language): `409 template_superseded`.
2. The last active template of an (entity, language) cannot be archived: `409 last_template`.
3. `GET /offer-templates` takes `formats` and defaults to `sections`, so an old client never receives a wizard row. Seeds are created only when `wizard` is asked for, and only for `welld_ch`, once per `seedKey`, archived rows included.
4. No migration archives anything. The migration adds columns and the constraint between `format` and the content columns, and leaves every row as it is.

## Failure shape

**A group that must always hold exactly one current member is changed by an act that touches one member and not the group.** Replacing a member then takes two writes, and between them, or when one of them is refused, the group holds two current members (a choice that is never made) or none (the thing the group exists to provide is gone). A migration that switches a whole set at once does the same thing against replacements that do not exist yet.

The same shape appears in its mirror-image positions:

- **Make current and make not current.** Every route that can make a member current must hold the invariant, and so must every route that can make it not current. In this decision that is create, duplicate, restore, a language change (which moves a member out of one group and into another, so both groups change), and archive (the guard on the way out). The routes most often missed are the reverse ones: restore and the language change.
- **Automatic and manual.** A seed, a migration or a script that retires a member a person owns is the same act as the person's own, and it needs the same guard. Automation is the path that retires a set in one step because it has no one to refuse it.
- **Constraint that fails at insert.** A unique index that refuses an insert because an old member still holds the name makes the error point at the wrong row: the new member looks like the duplicate, and the old one is the cause. Whatever order the decision uses (retire first, then insert) must be the order the code keeps when it is changed.
- **Old reader and new writer.** A new kind of member becomes visible to a reader that predates it. The list endpoint's default filter is the compatibility boundary; a reader that receives a kind it does not understand fails in a way that looks like a bug in the new kind. The deploy order is the mirror image: the reader must learn the new kind before the writer can create one.
- **Reverse path.** A reversal that exists only as the inverse of a forward act is a second switch. If it is reachable through the product, it must hold the same invariant as the forward act; if it is not, it must be a deliberate runbook act, as R11 records for this one.

Recognise it anywhere by: a route that sets a flag, publishes, restores, changes a language or a category, or seeds data, that does not go through the one function that enforces the group's invariant; a migration that changes a set in one statement while the replacements do not yet exist; a list that returns a new kind of row to any client without a format or version filter; a unique-name error that names the new row as the duplicate.

## Options considered

### Option A — Transactional supersession at activation, legacy restore refused, last-template guard, `formats` filter with a `sections` default, lazy seeding (chosen)

Described in Decision.

**Pros:**
- AC-9.2 holds exactly: the legacy templates of an (entity, language) are archived when, and only when, its first wizard template exists
- No entity is left without an offer path, and the other languages of the same entity are unaffected
- A deploy of crm-api before crm-ui is safe: the default filter keeps the live UI on legacy rows and nothing is seeded until the new UI asks (R4)
- One function, under one lock, serves every activation path

**Cons:**
- No UI undo: rollback is a runbook SQL statement (R11), refused by the API on purpose
- Two editors and two dialects remain in the product until every legacy row is gone
- The invariant is enforced in application code under the advisory lock, not by the database; a writer that bypasses the function can leave two active groups (see Consequences)

### Option B — Archive the legacy templates in the migration (rejected)

**Pros:**
- One step at deploy; no code path to maintain

**Cons:**
- Runs before any wizard template exists for some languages: `welld_it` and `welld_ch` English would be left with no active template, so they could not make offers (AC-9.2 is violated)

### Option C — An entity-wide switch (rejected)

**Pros:**
- One flag per entity; simple to reason about

**Cons:**
- Strands `welld_ch` English, which has no wizard text yet (AC-9.3); the switch would be taken before the texts that justify it exist

### Option D — Convert the legacy templates into wizard templates (rejected; a spec non-goal)

**Pros:**
- One format afterwards; no legacy dialog to keep

**Cons:**
- Legacy rows carry no declarations, so the conversion is a rewrite of text the owner has approved, and it is outside the spec

## Consequences

**Positive:**
- AC-9.2 is one rule that every writer uses, and the same rule covers an entity that gains its first wizard template in any language
- Adding an entity or language needs its texts and a Settings action, not a release (AC-9.3)
- The deploy window is safe in both orders that matter: crm-api first (the default filter), and a new crm-ui against an old crm-api fails visibly rather than silently (R4)

**Negative / trade-offs:**
- The rule is not in the database. A database trigger can express "no active legacy row while an active wizard row exists for the same (entity, language)" across rows, which a single unique index cannot; this decision does not add one. Until it does, every new writer that activates a template must call the shared function, and a test must fail when one does not.
- Undoing a supersession is a manual SQL act, and the wizard's rows are archived with it (R11)

**Risks:**
- **Wrong legacy row archived.** The archive statement is scoped by entity, language and `format = 'sections'`, and by `archivedAt IS NULL` (so it does not touch rows already archived). A future change to the scope would archive legacy templates of another language. Mitigation: the AC-9.2 integration test covers the other languages of the same entity and welld_ch English.
- **A legacy restore reintroduces a second active group.** Mitigation: restore is refused by the same guard, and tested.
- **Seed resurrection.** Mitigation: the seed check counts archived rows, so an archived seed is never created again.

## Compliance notes

- GDPR / data-protection impact: none. Template rows are configuration and hold no personal data.
- Data residency: compliant; same crm-api database.
- Audit trail: not required by this decision. Template rows keep `version`, `updatedBy` and `updatedAt` as today, and the supersession is a set of archive updates in one transaction. A reversal is a runbook act and is recorded there.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
