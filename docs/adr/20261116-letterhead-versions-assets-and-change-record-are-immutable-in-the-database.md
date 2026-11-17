# 20261116 — Letterhead versions, their asset links, the assets they reference and the change record are immutable in the database, as Tier 1 of the two-tier audit model

**Date:** 2026-11-16  
**Status:** Accepted — approved plan of specs/20261116-letterhead-service (approved 2026-11-16); owner decisions O12 and O13.  
**Deciders:** Matteo Codogno (product owner)  
**Project:** operai

---

## Context

A letterhead version is the layout of every document rendered with it, and none is ever deleted (AC-4.6, owner O12). Every save and restore is recorded with who, when, which entity, which version and the names of the settings that changed, and that record "can be neither edited nor removed through the service" and is "immutable at the database level" (AC-4.7, owner O13: the choice between Tier 1 and Tier 2 of ADR 20260804-two-tier-audit-assurance-auth-audit-log-application-level was left to the plan). A version points at logo and background files (AC-4.6, 7.4, 7.7); if one of those could change or disappear, the version would silently mean something else, and AC-4.5 (same pages for the same version) would fail with no error.

## Decision

We will make `letterhead_version`, `letterhead_version_asset`, `letterhead_change` and every `letterhead_asset` that a version references immutable at the database level, with `BEFORE UPDATE OR DELETE` triggers that raise (Tier 1, the pattern of `refund-api`'s `RefundAuditEntry`), prove it with a real-Postgres test that attempts raw `UPDATE` and `DELETE` on each, and allow unreferenced uploads to be swept after 24 hours.

## Failure shape

**A record that is promised to be permanent is protected only by the absence of a way to change it, so the first path nobody listed changes it.** "No route edits it" holds against the application the author wrote. It does not hold against a migration, an ad hoc query in production, a restore, a future admin tool, a second service given database access, or a well-meant cleanup endpoint added later. The second half: **a permanent record whose meaning depends on something that is not permanent.** A version that references a logo by id is only as fixed as the logo. And a third: **a side effect that is itself a write**: a foreign-key action such as `ON DELETE SET NULL` is an `UPDATE`, so it either fails under the trigger or edits the record from underneath.

Where else this shape appears:

- **Update and delete, row and parent.** Both operations must be refused, and the children of a protected row must be protected too (a version's asset links, its change rows), because deleting a child changes what the parent means. Recognise it by a table that holds ids of another table with no foreign key, or with a cascading one.
- **Write and read.** The write side is the trigger and the grants; the read side is a copy. Anything that copies a protected row into a mutable place (a cache keyed by version, an export that later becomes the source of truth) reintroduces the failure.
- **The restore operation.** "Restore version 2" must create version 5, never edit 5 into 2 (AC-4.2). Any "revert", "undo" or "rollback" feature over a protected record has the same mirror shape.
- **Other stores with a promise of permanence:** the refund audit trail and mileage rates (Tier 1), the auth audit log (Tier 2, a recorded and weaker choice), a future audit of anything that is exported to a regulator.
- **What a row trigger does not cover:** `TRUNCATE`, `DROP TABLE`, and a superuser who disables triggers. The decision does not claim those; see Risks.

## Options considered

### Option A — Raising `BEFORE UPDATE OR DELETE` triggers, foreign keys `ON DELETE RESTRICT`, a real-Postgres refusal test (chosen)

**Pros:**
- Holds against every path to the database, not only the ones the application knows (the reason the refund ADR 20260716-immutable-financial-audit-trail-refund gave)
- The change record is the "audit" of AC-4.7 and the owner chose database-level assurance (O13)
- The pattern exists in the repo (`refund-api/prisma/migrations/20260716133804_init/migration.sql:129-142`), so a reviewer knows what to look for
- Cheap: no extra tables, no extra service

**Cons:**
- A mistake in a migration cannot be fixed by an `UPDATE`; it needs a new migration that drops and recreates the trigger, which is visible, and that is the point
- An unreferenced asset needs a rule of its own (below)

### Option B — Application-level immutability only: no route, an export-surface test and a static scan (Tier 2, rejected)

**Pros:**
- No trigger to maintain; the model of `auth`'s `audit_log`

**Cons:**
- Rejected by the owner's wording of AC-4.7 and O13, and unsuited here: the service stores configurations that decide the layout of offers sent to clients. Tier 2 was a recorded exception for one table in `auth`, justified there by its shape (a foreign key with `ON DELETE SET NULL` to `User`), not a default for new tables. A static scan is a tripwire, not a proof, as ADR 20260804 says of its own

### Option C — Immutability by convention plus periodic verification (a hash chain or a checksum job) (rejected)

**Cons:**
- Detects a change after the fact and cannot stop it. It adds a mechanism that the suite does not use anywhere else, for a guarantee the database can give directly

## Decision details

- **Tables (plan, Data model).** `letterhead_version` (PK `(entity, version)`, `layout_version`, `config` jsonb with asset ids, `created_by`, `created_at`, `restored_from`), `letterhead_version_asset` (PK `(entity, version, asset_id)`, FK to `letterhead_asset(id)` and to `letterhead_version` both `ON DELETE RESTRICT`), `letterhead_change` (FK to `letterhead_version` `ON DELETE RESTRICT`; `actor_sub`, `actor_name`, `changed_settings text[]`), `letterhead_asset` (server-chosen uuid, entity, kind, format sniffed from bytes, `sha256`, bytes up to 2 MiB, created by and at).
- **Triggers.** A `BEFORE UPDATE OR DELETE` trigger on each of the four tables that raises an exception. On `letterhead_asset` the trigger refuses `UPDATE` and `DELETE` of an asset that any `letterhead_version_asset` row references, and lets `DELETE` of an unreferenced one through.
- **The 24 h sweep.** An upload (`POST /v1/letterheads/{entity}/assets`) happens before a save references it, so an upload that is never saved leaves an unreferenced asset. A sweep may delete unreferenced assets, and their bucket objects, older than 24 hours. A save runs in one transaction under an advisory lock on the entity and inserts the version, its asset links and the change row; if the sweep deleted an asset between upload and save, the foreign key makes the save fail (not a version with a missing logo).
- **No foreign key to a person.** `created_by`, `actor_sub` and `actor_name` are plain columns with no foreign key to any user table. This avoids the trap recorded in ADR 20260804 (an FK-initiated `SET NULL` is an `UPDATE` and the trigger would abort it). The service has no database link to `auth`'s users.
- **No mutating route.** There is no `PUT`, `PATCH` or `DELETE` route anywhere in the service (AC-4.3, AC-4.6); a router-table test asserts it. The application keeps the omission as the first line, and the triggers are the second (the defence in depth the refund ADR names).
- **No cap.** There is no limit on the number of versions per entity and no cleanup of them (O12).
- **The "active" version is the highest.** Every save and restore creates the next version, active at once, so no pointer to "the active version" exists to be updated (plan, Architecture).
- **Grants.** The service's database role is the owner of the tables as in the other services; this decision does not add a separate role. The trigger is what refuses, not a privilege.
- **Change record contents.** Per save or restore: entity, version, action (`save` or `restore`), actor sub and name, time, the names of the changed settings (keys only, a diff of the configuration), and `restored_from` (AC-4.7). It never holds document content (AC-3.7).

## Evidence

- Pattern: `refund-api/prisma/migrations/20260716133804_init/migration.sql:129-142`, ADR 20260716-immutable-financial-audit-trail-refund, and the Tier 1 definition in ADR 20260804-two-tier-audit-assurance-auth-audit-log-application-level.
- Planned, not yet run: R-int against a real Postgres (compose): a raw `UPDATE` and a raw `DELETE` on a version, a version-asset row, a referenced asset and a change row are each rejected (AC-4.3, AC-4.6, AC-4.7); a router-table test shows no `PUT`, `PATCH` or `DELETE`; an unreferenced asset can be deleted by the sweep and a referenced one cannot; a save naming a swept asset fails.
- The test must run against real Postgres, not a mock, because the guarantee is a property of the database.

## Consequences

**Positive:**
- A version, its logos and its history cannot change, whatever path reaches the database
- AC-4.5 does not depend on a convention about assets
- The configurator's history (AC-8.7) can be trusted as complete

**Negative / trade-offs:**
- A wrongly saved version cannot be corrected, only superseded by a newer one; a wrongly uploaded and referenced logo stays in the bucket for good
- The bucket and database grow without bound, by design (O12)
- Test data in integration tests accumulates and cannot be deleted row by row; tests use a database created and dropped for the run

**Risks:**
- **Row triggers do not stop `TRUNCATE`, `DROP TABLE` or a superuser disabling the triggers.** The same limit as the refund trail. Mitigation: only the migration path and a person with the production database hold such rights, and Railway backups cover disaster recovery. A statement-level `TRUNCATE` trigger is cheap to add and is not part of this decision; it is a candidate if the owner wants it.
- **The sweep races a save.** Mitigation: the foreign key and the single transaction; the sweep only deletes assets older than 24 hours with no link.
- **A future migration forgets the triggers on a new table that is meant to be permanent** (the failure shape). Mitigation: the escalation trigger below, and the real-Postgres test is the place to add the table.
- **The same wording is applied to the bucket.** The triggers protect the database, not the objects; a logo object that is deleted from the bucket while a version references it would break renders. Mitigation: no route deletes assets, and only the sweep removes objects, only for unreferenced assets.

## Escalation triggers

This decision is revisited when any of these happens:

- a new table is added to `letterhead-api` that holds history, configuration or assets that versions depend on (it needs the same triggers and a test);
- someone needs to correct or remove a stored version (a legal request, a data-protection erasure that reaches a logo): the owner decides, and the path is a migration that is reviewed and recorded, never a loosened trigger;
- a second kind of caller is given database access to this database;
- a person's name or email in `actor_name` becomes subject to an erasure request (the record is immutable by design, so a pseudonymisation path would need an owner decision);
- the owner asks for protection against `TRUNCATE` and `DROP`.

## Compliance notes

- GDPR / data-protection impact: low to medium. The change record holds the account that acted (`actor_sub`, `actor_name`) and cannot be erased through the service. Both are business actors (people with `letterhead:manage`), not clients, and no document content is in the record. An erasure request that reached an actor's name would need an owner decision (see triggers).
- Data residency: compliant. The database is Railway's Postgres in `europe-west4` and the assets are in an EU bucket.
- Audit trail: required (AC-4.7). Tier 1, database-level immutable.

## Amendment (2026-11-17) — TRUNCATE is refused, and the database is migrated before serving (owner to confirm)

- **Decision.** A statement-level `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger raising `letterhead_immutable` is added on all four tables (`letterhead-api/api/migrations/20261117000001_refuse_truncate.sql`; the init migration is not edited), so `TRUNCATE ... CASCADE` from any of them is refused too. Row triggers do not fire on TRUNCATE, which needs only ordinary table rights, so a script or test reset could have emptied the record. Still not covered: `DROP`, and an owner or superuser who disables triggers; the Risks above narrow to these two.
- **Migrate path.** `letterhead-api migrate` applies the embedded migrations and runs in Railway `preDeploy`; `serve` never migrates and refuses to start on an unmigrated database, so the triggers exist before the first request.
- **Evidence.** Real-Postgres tests in `letterhead-api/api/src/db/tests.rs`; plan Amendment (2026-11-17) items 4 and 5.
