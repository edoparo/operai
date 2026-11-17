//! Postgres: the schema's repository layer (task T10; AC-4.1, 4.2, 4.3, 4.6, 4.7, 4.8).
//!
//! - `api/migrations/*.sql`: plain SQL, embedded in the binary and run by `letterhead-api migrate` (Railway's
//!   `preDeploy`, compose's one-shot service, `mise run db:migrate`) through [`Repo::migrate`], which the tests
//!   call too; never edited once applied.
//! - [`Repo`]: every statement the service runs against its database, behind typed functions. Nothing else
//!   in the crate builds SQL.
//! - The database, not this layer, is what makes versions, their asset links, the assets they use and the
//!   change record immutable (ADR 20261116-letterhead-versions-assets-and-change-record-are-immutable-in-the-
//!   database). This layer has no function that updates or deletes any of them, and the tests try the raw
//!   statements to prove the triggers hold.
//! - A save and a restore are one transaction under an advisory lock on the entity: the version number, the
//!   asset links and the change record are written together or not at all, and two saves on the same base
//!   version cannot both succeed (AC-4.8).

// The routes that use this arrive with T12 to T16; until then only the tests call it.
#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "used by the routes of T12 to T16; only the tests call it before them"
    )
)]

mod repo;
mod types;

pub use repo::Repo;
pub use types::*;

#[cfg(test)]
mod tests;
