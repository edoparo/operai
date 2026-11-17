//! Every statement the service runs against its own database.
//!
//! There is no function here that updates or deletes a version, a version's asset links or a change row, and
//! the only `delete` is the sweep of assets that no version uses (AC-4.3, 4.6). The triggers in the migration
//! are the second line; a test (`no_function_changes_what_is_permanent`) keeps this file honest.

use std::time::Duration;

use letterhead_engine::assets::Format;
use letterhead_engine::content::Entity;
use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::types::{
    AssetKind, AssetRow, HistoryEntry, NewAsset, NewVersion, RestoreVersion, SaveError, VersionRow,
};

/// The migrations of `api/migrations`, embedded at build time.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// First key of the advisory lock that serialises the saves of one entity (the second is the entity's hash).
const LOCK_NAMESPACE: i32 = 0x4C48; // "LH"

/// The columns of `letterhead_asset` and `letterhead_version` that the row decoders below read, as literals
/// so that statements stay `'static` (sqlx 0.9 does not take built-up SQL).
macro_rules! asset_columns {
    () => {
        "id, entity, kind, format, sha256, bytes, width_px, height_px, created_by, created_at"
    };
}
macro_rules! version_columns {
    () => {
        "entity, version, layout_version, config, created_by, created_at, restored_from"
    };
}

/// The service's database.
#[derive(Debug, Clone)]
pub struct Repo {
    pool: PgPool,
}

fn decode_error(what: &str) -> sqlx::Error {
    sqlx::Error::Decode(format!("unexpected {what} in the database").into())
}

fn entity_of(row: &PgRow) -> Result<Entity, sqlx::Error> {
    let name: String = row.try_get("entity")?;
    Entity::parse(&name).ok_or_else(|| decode_error("entity"))
}

fn asset_from(row: &PgRow) -> Result<AssetRow, sqlx::Error> {
    let kind: String = row.try_get("kind")?;
    let format: String = row.try_get("format")?;
    let width: Option<i32> = row.try_get("width_px")?;
    let height: Option<i32> = row.try_get("height_px")?;
    Ok(AssetRow {
        id: row.try_get("id")?,
        entity: entity_of(row)?,
        kind: AssetKind::parse(&kind).ok_or_else(|| decode_error("asset kind"))?,
        format: match format.as_str() {
            "png" => Format::Png,
            "jpeg" => Format::Jpeg,
            "svg" => Format::Svg,
            _ => return Err(decode_error("asset format")),
        },
        sha256: row.try_get("sha256")?,
        bytes: row.try_get("bytes")?,
        size_px: width.zip(height),
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

fn version_from(row: &PgRow) -> Result<VersionRow, sqlx::Error> {
    Ok(VersionRow {
        entity: entity_of(row)?,
        version: row.try_get("version")?,
        layout_version: row.try_get("layout_version")?,
        config: row.try_get("config")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        restored_from: row.try_get("restored_from")?,
    })
}

/// A foreign-key refusal of an asset link means the asset is gone or is another entity's.
fn link_error(error: sqlx::Error) -> SaveError {
    let refused = error
        .as_database_error()
        .and_then(|e| e.constraint())
        .is_some_and(|name| name == "letterhead_version_asset_asset_fk");
    if refused {
        SaveError::AssetUnavailable
    } else {
        SaveError::Db(error)
    }
}

impl Repo {
    pub fn new(pool: PgPool) -> Repo {
        Repo { pool }
    }

    /// The pool, for tests that run the raw statements someone with access to the database could.
    #[cfg(test)]
    pub(super) fn pool_for_tests(&self) -> &PgPool {
        &self.pool
    }

    /// Connect, failing fast: the service does not start without its database.
    pub async fn connect(database_url: &str, max_connections: u32) -> Result<Repo, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await?;
        Ok(Repo::new(pool))
    }

    /// Apply the migrations that are not applied yet, and say how many there were. `letterhead-api migrate`
    /// (Railway's `preDeploy`, compose's one-shot service, `mise run db:migrate`) calls this; `serve` never does
    /// (amendment 2026-11-17, item 4). The migrations are embedded in the binary: a new file in `migrations/`
    /// makes `build.rs` rebuild it. Applying none is not an error: a second run is a no-op that returns 0.
    pub async fn migrate(&self) -> Result<usize, sqlx::migrate::MigrateError> {
        let pending = self.pending_migrations().await?;
        MIGRATOR.run(&self.pool).await?;
        Ok(pending)
    }

    /// How many of the embedded migrations the database has not applied yet. `serve` refuses to start while
    /// this is not 0: the routes read tables that a missing migration would not have made.
    pub async fn pending_migrations(&self) -> Result<usize, sqlx::Error> {
        let table: Option<String> =
            sqlx::query_scalar("select to_regclass('_sqlx_migrations')::text")
                .fetch_one(&self.pool)
                .await?;
        let applied: Vec<i64> = if table.is_some() {
            sqlx::query_scalar("select version from _sqlx_migrations where success")
                .fetch_all(&self.pool)
                .await?
        } else {
            Vec::new()
        };
        Ok(MIGRATOR
            .iter()
            .filter(|migration| !applied.contains(&migration.version))
            .count())
    }

    // --- assets ---------------------------------------------------------------------------------------

    pub async fn insert_asset(&self, asset: NewAsset) -> Result<AssetRow, sqlx::Error> {
        let (width, height) = match asset.size_px {
            Some((w, h)) => (Some(w), Some(h)),
            None => (None, None),
        };
        let row = sqlx::query(concat!(
            "insert into letterhead_asset (id, entity, kind, format, sha256, bytes, width_px, height_px, created_by) \
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ", asset_columns!(), ""
        ))
        .bind(asset.id)
        .bind(asset.entity.as_str())
        .bind(asset.kind.as_str())
        .bind(asset.format.as_str())
        .bind(asset.sha256.as_slice())
        .bind(asset.bytes)
        .bind(width)
        .bind(height)
        .bind(&asset.created_by)
        .fetch_one(&self.pool)
        .await?;
        asset_from(&row)
    }

    pub async fn asset(&self, id: Uuid) -> Result<Option<AssetRow>, sqlx::Error> {
        let row = sqlx::query(concat!(
            "select ",
            asset_columns!(),
            " from letterhead_asset where id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(asset_from).transpose()
    }

    /// The assets among `ids` that belong to `entity`, so a save can tell which of the ids it was given are
    /// unknown (and check each one's kind).
    pub async fn assets_of_entity(
        &self,
        entity: Entity,
        ids: &[Uuid],
    ) -> Result<Vec<AssetRow>, sqlx::Error> {
        let rows = sqlx::query(concat!(
            "select ",
            asset_columns!(),
            " from letterhead_asset where entity = $1 and id = any($2) order by created_at, id"
        ))
        .bind(entity.as_str())
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(asset_from).collect()
    }

    /// The assets a version uses.
    pub async fn version_assets(
        &self,
        entity: Entity,
        version: i32,
    ) -> Result<Vec<AssetRow>, sqlx::Error> {
        let rows = sqlx::query(
            "select a.id, a.entity, a.kind, a.format, a.sha256, a.bytes, a.width_px, a.height_px, a.created_by, a.created_at \
             from letterhead_version_asset va join letterhead_asset a on a.id = va.asset_id \
             where va.entity = $1 and va.version = $2 order by a.created_at, a.id",
        )
        .bind(entity.as_str())
        .bind(version)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(asset_from).collect()
    }

    /// Delete the assets older than `older_than_secs` that no version uses, and return their ids so the caller
    /// can delete their bucket objects (ADR 20261116-letterhead-versions-..., "the 24 h sweep"). A save that
    /// takes an asset while this runs wins: the database refuses the delete and the asset stays.
    pub async fn sweep_unreferenced_assets(
        &self,
        older_than_secs: f64,
    ) -> Result<Vec<Uuid>, sqlx::Error> {
        let candidates: Vec<Uuid> = sqlx::query_scalar(
            "select a.id from letterhead_asset a \
             where a.created_at < now() - make_interval(secs => $1::float8) \
               and not exists (select 1 from letterhead_version_asset va where va.asset_id = a.id) \
             order by a.created_at, a.id",
        )
        .bind(older_than_secs)
        .fetch_all(&self.pool)
        .await?;
        let mut deleted = Vec::new();
        for id in candidates {
            match sqlx::query("delete from letterhead_asset where id = $1")
                .bind(id)
                .execute(&self.pool)
                .await
            {
                Ok(result) if result.rows_affected() == 1 => deleted.push(id),
                Ok(_) => {}
                // A save linked it between the select and the delete: it is in use now, leave it.
                Err(error) if is_immutable_refusal(&error) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(deleted)
    }

    // --- versions -------------------------------------------------------------------------------------

    /// The active version of an entity: the highest (AC-4.1, 4.4). `None`: it has none.
    pub async fn active_version(&self, entity: Entity) -> Result<Option<VersionRow>, sqlx::Error> {
        let row = sqlx::query(concat!(
            "select ",
            version_columns!(),
            " from letterhead_version where entity = $1 order by version desc limit 1"
        ))
        .bind(entity.as_str())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(version_from).transpose()
    }

    pub async fn version(
        &self,
        entity: Entity,
        version: i32,
    ) -> Result<Option<VersionRow>, sqlx::Error> {
        let row = sqlx::query(concat!(
            "select ",
            version_columns!(),
            " from letterhead_version where entity = $1 and version = $2"
        ))
        .bind(entity.as_str())
        .bind(version)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(version_from).transpose()
    }

    /// The active version number of each entity that has one (`GET /v1/letterheads/status`).
    pub async fn active_versions(&self) -> Result<Vec<(Entity, i32)>, sqlx::Error> {
        let rows = sqlx::query(
            "select entity, max(version) as version from letterhead_version group by entity order by entity",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| Ok((entity_of(row)?, row.try_get("version")?)))
            .collect()
    }

    /// Every version of an entity, newest first, with the record of who made it (AC-8.7).
    pub async fn history(&self, entity: Entity) -> Result<Vec<HistoryEntry>, sqlx::Error> {
        let rows = sqlx::query(
            "select v.version, v.layout_version, c.action, c.actor_sub, c.actor_name, c.at, c.changed_settings, c.restored_from \
             from letterhead_version v join letterhead_change c on c.entity = v.entity and c.version = v.version \
             where v.entity = $1 order by v.version desc",
        )
        .bind(entity.as_str())
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(HistoryEntry {
                    version: row.try_get("version")?,
                    layout_version: row.try_get("layout_version")?,
                    action: row.try_get("action")?,
                    actor_sub: row.try_get("actor_sub")?,
                    actor_name: row.try_get("actor_name")?,
                    at: row.try_get("at")?,
                    changed_settings: row.try_get("changed_settings")?,
                    restored_from: row.try_get("restored_from")?,
                })
            })
            .collect()
    }

    /// Save the next version (AC-4.1). One transaction: the entity is locked, the person's base version is
    /// checked against the newest (AC-4.8), and the version, its asset links and its change record are
    /// written. Any failure writes nothing.
    pub async fn save(&self, input: NewVersion) -> Result<i32, SaveError> {
        let mut tx = self.pool.begin().await?;
        let next = next_version(&mut tx, input.entity, input.base_version).await?;

        sqlx::query(
            "insert into letterhead_version (entity, version, layout_version, config, created_by, restored_from) \
             values ($1, $2, $3, $4, $5, null)",
        )
        .bind(input.entity.as_str())
        .bind(next)
        .bind(input.layout_version)
        .bind(&input.config)
        .bind(&input.actor_sub)
        .execute(&mut *tx)
        .await?;

        let mut ids = input.asset_ids.clone();
        ids.sort_unstable();
        ids.dedup();
        for id in ids {
            sqlx::query(
                "insert into letterhead_version_asset (entity, version, asset_id) values ($1, $2, $3)",
            )
            .bind(input.entity.as_str())
            .bind(next)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(link_error)?;
        }

        insert_change(
            &mut tx,
            &Change {
                entity: input.entity,
                version: next,
                action: "save",
                actor_sub: &input.actor_sub,
                actor_name: &input.actor_name,
                changed_settings: &input.changed_settings,
                restored_from: None,
            },
        )
        .await?;
        tx.commit().await?;
        Ok(next)
    }

    /// Restore an older version (AC-4.2): the next version, with the older one's configuration, layout and
    /// assets. The older version and the history are untouched.
    pub async fn restore(&self, input: RestoreVersion) -> Result<i32, SaveError> {
        let mut tx = self.pool.begin().await?;
        let next = next_version(&mut tx, input.entity, input.base_version).await?;

        let copied = sqlx::query(
            "insert into letterhead_version (entity, version, layout_version, config, created_by, restored_from) \
             select entity, $3, layout_version, config, $4, version \
             from letterhead_version where entity = $1 and version = $2",
        )
        .bind(input.entity.as_str())
        .bind(input.from_version)
        .bind(next)
        .bind(&input.actor_sub)
        .execute(&mut *tx)
        .await?;
        if copied.rows_affected() != 1 {
            return Err(SaveError::NotFound);
        }

        sqlx::query(
            "insert into letterhead_version_asset (entity, version, asset_id) \
             select entity, $3, asset_id from letterhead_version_asset where entity = $1 and version = $2",
        )
        .bind(input.entity.as_str())
        .bind(input.from_version)
        .bind(next)
        .execute(&mut *tx)
        .await?;

        insert_change(
            &mut tx,
            &Change {
                entity: input.entity,
                version: next,
                action: "restore",
                actor_sub: &input.actor_sub,
                actor_name: &input.actor_name,
                changed_settings: &input.changed_settings,
                restored_from: Some(input.from_version),
            },
        )
        .await?;
        tx.commit().await?;
        Ok(next)
    }
}

/// An immutability refusal of the migration's triggers.
fn is_immutable_refusal(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|e| e.message().starts_with("letterhead_immutable"))
}

/// Lock the entity for this transaction and return the number its next version will have, if `base_version` is
/// still the newest.
async fn next_version(
    tx: &mut Transaction<'_, Postgres>,
    entity: Entity,
    base_version: i32,
) -> Result<i32, SaveError> {
    sqlx::query("select pg_advisory_xact_lock($1, hashtext($2))")
        .bind(LOCK_NAMESPACE)
        .bind(entity.as_str())
        .execute(&mut **tx)
        .await?;
    let current: i32 = sqlx::query_scalar(
        "select coalesce(max(version), 0) from letterhead_version where entity = $1",
    )
    .bind(entity.as_str())
    .fetch_one(&mut **tx)
    .await?;
    if current != base_version {
        return Err(SaveError::VersionConflict { current });
    }
    Ok(current + 1)
}

/// The change record of one save or restore.
struct Change<'a> {
    entity: Entity,
    version: i32,
    action: &'static str,
    actor_sub: &'a str,
    actor_name: &'a str,
    changed_settings: &'a [String],
    restored_from: Option<i32>,
}

async fn insert_change(
    tx: &mut Transaction<'_, Postgres>,
    change: &Change<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into letterhead_change (entity, version, action, actor_sub, actor_name, changed_settings, restored_from) \
         values ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(change.entity.as_str())
    .bind(change.version)
    .bind(change.action)
    .bind(change.actor_sub)
    .bind(change.actor_name)
    .bind(change.changed_settings)
    .bind(change.restored_from)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
