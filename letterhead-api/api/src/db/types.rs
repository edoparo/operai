//! Rows, inputs and errors of the repository.

use chrono::{DateTime, Utc};
use letterhead_engine::assets::Format;
use letterhead_engine::content::Entity;
use uuid::Uuid;

/// What an uploaded asset is for. A logo goes in a header, a background under a whole page (AC-7.4, 7.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    Logo,
    Background,
}

impl AssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetKind::Logo => "logo",
            AssetKind::Background => "background",
        }
    }

    pub fn parse(name: &str) -> Option<AssetKind> {
        match name {
            "logo" => Some(AssetKind::Logo),
            "background" => Some(AssetKind::Background),
            _ => None,
        }
    }
}

/// An uploaded asset to record. `bytes` is the size of the stored (sanitised) file; the file itself is in the
/// bucket under `assets/<id>`.
#[derive(Debug, Clone)]
pub struct NewAsset {
    pub id: Uuid,
    pub entity: Entity,
    pub kind: AssetKind,
    pub format: Format,
    pub sha256: [u8; 32],
    pub bytes: i32,
    /// A raster's pixel size; `None` for an SVG.
    pub size_px: Option<(i32, i32)>,
    pub created_by: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRow {
    pub id: Uuid,
    pub entity: Entity,
    pub kind: AssetKind,
    pub format: Format,
    pub sha256: Vec<u8>,
    pub bytes: i32,
    pub size_px: Option<(i32, i32)>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

/// One saved state of an entity's letterhead.
#[derive(Debug, Clone, PartialEq)]
pub struct VersionRow {
    pub entity: Entity,
    pub version: i32,
    pub layout_version: i32,
    /// `LetterheadConfig` v1, as stored.
    pub config: serde_json::Value,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub restored_from: Option<i32>,
}

/// A line of the history (AC-8.7): a version and the record of who made it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    pub version: i32,
    pub layout_version: i32,
    pub action: String,
    pub actor_sub: String,
    pub actor_name: String,
    pub at: DateTime<Utc>,
    pub changed_settings: Vec<String>,
    pub restored_from: Option<i32>,
}

/// A save (AC-4.1): the next version of `entity`, if the person was looking at `base_version`.
#[derive(Debug, Clone)]
pub struct NewVersion {
    pub entity: Entity,
    /// The version the person was looking at; `0` for the first save of an entity.
    pub base_version: i32,
    pub layout_version: i32,
    pub config: serde_json::Value,
    /// The assets `config` uses, each once. They must exist and belong to `entity`.
    pub asset_ids: Vec<Uuid>,
    pub actor_sub: String,
    pub actor_name: String,
    /// Names from the closed vocabulary of amendment G9.
    pub changed_settings: Vec<String>,
}

/// A restore (AC-4.2): a new version with the configuration, layout and assets of an older one.
#[derive(Debug, Clone)]
pub struct RestoreVersion {
    pub entity: Entity,
    pub from_version: i32,
    pub base_version: i32,
    pub actor_sub: String,
    pub actor_name: String,
    pub changed_settings: Vec<String>,
}

/// Why a save or a restore did not happen. Nothing is written in any of these cases.
#[derive(Debug)]
pub enum SaveError {
    /// Another version was saved since the person looked (AC-4.8): `current` is the newest now.
    VersionConflict {
        current: i32,
    },
    /// An asset the configuration names is not there, or is another entity's (the foreign key refused it).
    AssetUnavailable,
    /// The version to restore does not exist.
    NotFound,
    Db(sqlx::Error),
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveError::VersionConflict { current } => {
                write!(f, "another version was saved: the newest is {current}")
            }
            SaveError::AssetUnavailable => f.write_str("an asset is not available to this entity"),
            SaveError::NotFound => f.write_str("the version to restore does not exist"),
            SaveError::Db(error) => write!(f, "database error: {error}"),
        }
    }
}

impl std::error::Error for SaveError {}

impl From<sqlx::Error> for SaveError {
    fn from(error: sqlx::Error) -> Self {
        SaveError::Db(error)
    }
}
