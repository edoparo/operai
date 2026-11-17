//! The write routes of the configurator (task T15; AC-4.1, AC-4.2, AC-4.7, AC-4.8, AC-5.2, AC-7.1 to AC-7.4,
//! AC-8.2, plan § Person routes and § Sequences "Save", amendments G2, G3, G9 and 2026-11-17 items 1, 2, 3j):
//!
//! | Route | Answer |
//! | --- | --- |
//! | `POST /v1/letterheads/{entity}/assets` | 201 `{ id, kind, format, width, height }`; 422 `invalid_asset` `{ reason }` |
//! | `POST /v1/letterheads/{entity}/versions` | `{ baseVersion, config }` -> 201 `{ version }`; 409 `version_conflict`; 422 `invalid_letterhead` `{ problems }` |
//! | `POST /v1/letterheads/{entity}/versions/{n}/restore` | `{ baseVersion }` -> 201 `{ version }`; 409 `version_conflict`; 404 |
//!
//! Every one of them is behind `auth::person` and `authz::require_access` (the router puts both in front) and
//! then checks the second, dedicated permission itself, before it reads anything of the request (AC-8.2): a
//! person without `letterhead:manage` is 403 `forbidden`, one who holds it for another entity is 403
//! `out_of_scope`, and neither changes anything. The browser's idea of what a person may do is never trusted.
//!
//! **A save** is refused in this order, each step cheaper than the next, and nothing is written until the last:
//! the shape of the request, the rules of the configuration (`config::validate_config`), the version the person
//! was looking at (cheap, from the database), that each asset is an uploaded asset of this entity and of the
//! right kind, and the fit of every header and footer in its margin with 40-character values (AC-5.2:
//! `layout::check_fit`). Then one transaction (`Repo::save`) takes the advisory lock, checks the base version
//! again, and writes the version with the *current* layout, its asset links and its change record.
//!
//! **A restore** copies version n's layout, configuration and assets and is not validated again: n was valid for
//! its own layout, and its assets are immutable (amendment 2026-11-17 item 3j). Its `changedSettings` is the
//! difference between the configuration of `baseVersion` and n's.
//!
//! **An upload** is `multipart/form-data` with the fields `kind` (`logo` or `background`) and `file`. The format
//! comes from the bytes (AC-7.1); what is stored is what `assets::ingest` returns (an SVG is rebuilt); the object
//! goes to the bucket before the row is written, so there is never a row without an object.
//!
//! What a refusal says is made by this crate (codes, JSON Pointers into our own schema, the closed reasons): no
//! answer repeats text of the request, a file name included (AC-3.6's rule, kept on the person routes too).
//!
//! The fit check compiles a few tiny documents and decodes the person's uploaded images, so it runs as a job of
//! the worker pool ([`fit_check`]: [`Job::fit`], interactive class), with the pool's deadline and memory cap, and
//! never on a thread of this process (T48, security review F2). The text it measures is the fit value and the
//! configuration's own texts, never a document, so AC-3.7 is not in question. A save that finds no place is 429
//! `busy` with `Retry-After`; one whose check runs past the deadline is 504 `render_timeout`.

use std::time::Duration;

use axum::{
    body::Body,
    extract::{Extension, Request, State, rejection::PathRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use uuid::Uuid;

use letterhead_engine::assets::{self, Format};
use letterhead_engine::config::{
    LetterheadConfig, Problem, Reason, changed_settings, initial_settings, validate_config,
};
use letterhead_engine::content::Entity;
use letterhead_engine::layout::{Assets, CURRENT_LAYOUT, layout};

use super::render::pool_error;
use super::{ApiError, AppState};
use crate::authz::Authz;
use crate::db::{AssetKind, AssetRow, NewAsset, NewVersion, RestoreVersion, SaveError};
use crate::pool::job::{Body as JobBody, Job};
use crate::storage::StorageError;

/// `Retry-After` of a 503 or a 429: the database or the bucket could not answer now, or the checks are busy.
const RETRY_SECONDS: u64 = 2;
/// How long a caller has to send its body.
const BODY_TIMEOUT: Duration = Duration::from_secs(15);
/// A save or a restore body: a configuration is a few KiB.
const JSON_BODY_MAX: usize = 1024 * 1024;
/// What an upload's body may hold beyond the file: the boundaries and the headers of two parts.
const UPLOAD_OVERHEAD: usize = 64 * 1024;
/// A body that goes past this is the "file too big" refusal, not a 413: the form says it in words.
const UPLOAD_BODY_MAX: usize = assets::MAX_BYTES + UPLOAD_OVERHEAD;
/// How much more of an oversized body is read and thrown away so the caller gets the answer.
const DRAIN_EXTRA: usize = 1024 * 1024;
/// The longest header block of one part of an upload.
const PART_HEAD_MAX: usize = 8 * 1024;
/// An upload has two fields; a few more are tolerated for counting, never read.
const PARTS_MAX: usize = 4;

// ---------------------------------------------------------------------------------------------------------------
// Who may change what

/// The entity of a write route, once the person is known to be allowed to change it. The order is the contract
/// (AC-8.2, AC-4.9): not a holder of `letterhead:manage` at all is `forbidden`, then an entity the service does
/// not have is `unknown_entity`, then an entity outside the person's scope is `out_of_scope`.
fn manage_entity(authz: &Authz, entity: Option<String>) -> Result<Entity, ApiError> {
    if !authz.holds_manage() {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "forbidden"));
    }
    let entity = entity
        .and_then(|name| Entity::parse(&name))
        .ok_or_else(|| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "unknown_entity"))?;
    if !authz.can_manage(entity) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "out_of_scope"));
    }
    Ok(entity)
}

/// The name on the change record: the token's `name` claim (G9), or the email when the token has none, so the
/// record always says who.
fn actor_name(authz: &Authz) -> String {
    authz
        .person
        .name
        .clone()
        .unwrap_or_else(|| authz.person.email.clone())
}

// ---------------------------------------------------------------------------------------------------------------
// The upload

/// `POST /v1/letterheads/{entity}/assets`
pub async fn upload(
    State(app): State<AppState>,
    Extension(authz): Extension<Authz>,
    path: Result<axum::extract::Path<String>, PathRejection>,
    request: Request,
) -> Result<Response, ApiError> {
    let entity = manage_entity(&authz, path.ok().map(|axum::extract::Path(name)| name))?;
    let boundary = boundary_of(request.headers()).ok_or_else(bad_request)?;
    let declared = declared_length(request.headers());
    let body = read_body(request.into_body(), declared, UPLOAD_BODY_MAX)
        .await
        .map_err(|unread| match unread {
            // A file that is too big is the upload's own refusal, in words the form has.
            Unread::TooLarge => invalid_asset(assets::Reason::TooManyBytes),
            other => other.error(),
        })?;
    let form = parse_multipart(&body, &boundary).ok_or_else(bad_request)?;
    drop(body);

    let ingested = tokio::task::spawn_blocking(move || assets::ingest(&form.file))
        .await
        .map_err(|_| internal("internal_error"))?
        .map_err(invalid_asset)?;
    // What is stored may be bigger than what came (a rebuilt SVG): the database holds 2 MiB at most.
    if ingested.bytes.len() > assets::MAX_BYTES {
        return Err(invalid_asset(assets::Reason::TooManyBytes));
    }
    let size_px = match (ingested.width, ingested.height) {
        (Some(w), Some(h)) => Some((
            i32::try_from(w).map_err(|_| internal("internal_error"))?,
            i32::try_from(h).map_err(|_| internal("internal_error"))?,
        )),
        _ => None,
    };
    let bytes = i32::try_from(ingested.bytes.len()).map_err(|_| internal("internal_error"))?;
    let id = Uuid::new_v4();
    app.storage
        .put(id, &ingested.bytes, content_type(ingested.format))
        .await
        .map_err(storage_error)?;
    let row = app
        .repo
        .insert_asset(NewAsset {
            id,
            entity,
            kind: form.kind,
            format: ingested.format,
            sha256: sha256(&ingested.bytes),
            bytes,
            size_px,
            created_by: authz.person.sub.clone(),
        })
        .await
        .map_err(|_| unavailable())?;
    Ok((
        StatusCode::CREATED,
        axum::Json(json!({
            "id": row.id.to_string(),
            "kind": row.kind.as_str(),
            "format": row.format.as_str(),
            "width": row.size_px.map(|(w, _)| w),
            "height": row.size_px.map(|(_, h)| h),
        })),
    )
        .into_response())
}

fn content_type(format: Format) -> &'static str {
    match format {
        Format::Png => "image/png",
        Format::Jpeg => "image/jpeg",
        Format::Svg => "image/svg+xml",
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).into()
}

fn invalid_asset(reason: assets::Reason) -> ApiError {
    ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_asset")
        .with("reason", Value::String(reason.as_str().to_owned()))
}

// ---------------------------------------------------------------------------------------------------------------
// The save

/// `POST /v1/letterheads/{entity}/versions`
pub async fn save(
    State(app): State<AppState>,
    Extension(authz): Extension<Authz>,
    path: Result<axum::extract::Path<String>, PathRejection>,
    request: Request,
) -> Result<Response, ApiError> {
    let entity = manage_entity(&authz, path.ok().map(|axum::extract::Path(name)| name))?;
    let body = read_json_body(request).await?;
    let (base_version, config_value) = envelope(&body, Some("config"))?;
    drop(body);

    // AC-5.1, 5.6, 5.8, 5.9, 6.1, 6.2, 6.6, 7.4, 7.5: the rules of the configuration.
    let config =
        validate_config(&config_value.unwrap_or(Value::Null)).map_err(invalid_letterhead)?;

    // AC-4.8: the cheap conflict check before the expensive ones; the transaction checks it again.
    let active = app
        .repo
        .active_version(entity)
        .await
        .map_err(|_| unavailable())?;
    let current = active.as_ref().map_or(0, |row| row.version);
    if current != base_version {
        return Err(conflict(current));
    }

    // AC-7.4, 7.7: every asset is an uploaded asset of this entity, and of the kind of the slot it fills.
    let ids = distinct_ids(&config);
    let rows = app
        .repo
        .assets_of_entity(entity, &ids)
        .await
        .map_err(|_| unavailable())?;
    let unknown = asset_problems(&config, &rows);
    if !unknown.is_empty() {
        return Err(invalid_letterhead(unknown));
    }
    let mut files = Assets::new();
    for row in &rows {
        let bytes = app.storage.asset(row).await.map_err(storage_error)?;
        files.insert(row.id.to_string(), bytes.as_slice().to_vec());
    }

    // AC-5.2: every frame fits its margin with the longest values.
    let overflow = fit_check(&app, &authz, CURRENT_LAYOUT, config.clone(), files).await?;
    if !overflow.is_empty() {
        return Err(invalid_letterhead_values(overflow));
    }

    // AC-4.7, G9: the names of what changed, from the version the person was looking at.
    let changed: Vec<String> = match &active {
        None => initial_settings(&config),
        Some(row) => {
            let before: LetterheadConfig =
                serde_json::from_value(row.config.clone()).map_err(|_| stored_unusable())?;
            changed_settings(&before, &config)
        }
    }
    .into_iter()
    .map(str::to_owned)
    .collect();

    let version = app
        .repo
        .save(NewVersion {
            entity,
            base_version,
            layout_version: i32::try_from(CURRENT_LAYOUT)
                .map_err(|_| internal("internal_error"))?,
            config: serde_json::to_value(&config).map_err(|_| internal("internal_error"))?,
            asset_ids: rows.iter().map(|row| row.id).collect(),
            actor_sub: authz.person.sub.clone(),
            actor_name: actor_name(&authz),
            changed_settings: changed,
        })
        .await
        .map_err(save_error)?;
    Ok(created(version))
}

/// The ids of the assets a configuration uses, each once. They are UUIDs: the validator checked the syntax.
fn distinct_ids(config: &LetterheadConfig) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = config
        .asset_ids()
        .into_iter()
        .filter_map(|id| Uuid::try_parse(id).ok())
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// `asset_unknown` for every use of an asset that is not an uploaded asset of the entity, or is of the other
/// kind: a logo slot holding a background, or the reverse. The path is the slot, never the id.
fn asset_problems(config: &LetterheadConfig, found: &[AssetRow]) -> Vec<Problem> {
    let mut problems = Vec::new();
    let variants = [
        ("default", Some(&config.variants.default)),
        ("first", config.variants.first.as_ref()),
        ("last", config.variants.last.as_ref()),
    ];
    for (name, variant) in variants {
        let Some(variant) = variant else { continue };
        let uses = [
            (
                format!("/variants/{name}/logo/asset"),
                variant.logo.as_ref().map(|logo| logo.asset.as_str()),
                AssetKind::Logo,
            ),
            (
                format!("/variants/{name}/background"),
                variant.background.as_deref(),
                AssetKind::Background,
            ),
        ];
        for (path, id, kind) in uses {
            let Some(id) = id else { continue };
            let usable = Uuid::try_parse(id)
                .ok()
                .and_then(|id| found.iter().find(|row| row.id == id))
                .is_some_and(|row| row.kind == kind);
            if !usable {
                problems.push(Problem {
                    path,
                    reason: Reason::AssetUnknown,
                    name: None,
                    language: None,
                });
            }
        }
    }
    problems
}

/// The fit check of a configuration on `layout_version`, as a job of the worker pool: the problems as the JSON
/// of `invalid_letterhead.problems[]` (none when every frame fits). The person's own place, the same name as the
/// preview's, in the interactive class: a save can neither starve a document's PDF nor take more than a person's
/// share of the queue.
pub(super) async fn fit_check(
    app: &AppState,
    authz: &Authz,
    layout_version: u32,
    config: LetterheadConfig,
    files: Assets,
) -> Result<Vec<Value>, ApiError> {
    let permit = app
        .pool
        .admit_interactive(&format!("person:{}", authz.person.sub))
        .map_err(pool_error)?;
    let job = Job::fit(layout_version, config, files);
    let output = permit.run(job).await.map_err(pool_error_of_fit)?;
    match output.body {
        JobBody::Fit(problems) => Ok(problems),
        // A fit check answers with its problems: anything else is a fault of the pool.
        _ => Err(internal("internal_error")),
    }
}

/// What the pool says of a fit check. A refusal is a fault here, as it was when the check ran in this process:
/// the layout is compiled in, and the configuration and its assets were just checked.
fn pool_error_of_fit(error: crate::pool::PoolError) -> ApiError {
    match error {
        crate::pool::PoolError::Refused(_) => internal("internal_error"),
        other => pool_error(other),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The restore

/// `POST /v1/letterheads/{entity}/versions/{n}/restore`
pub async fn restore(
    State(app): State<AppState>,
    Extension(authz): Extension<Authz>,
    path: Result<axum::extract::Path<(String, String)>, PathRejection>,
    request: Request,
) -> Result<Response, ApiError> {
    let (entity_name, number) = match path {
        Ok(axum::extract::Path((entity, number))) => (Some(entity), Some(number)),
        Err(_) => (None, None),
    };
    let entity = manage_entity(&authz, entity_name)?;
    let body = read_json_body(request).await?;
    let (base_version, _) = envelope(&body, None)?;
    drop(body);

    let not_found = || ApiError::new(StatusCode::NOT_FOUND, "letterhead_version_not_found");
    let from_number = number
        .as_deref()
        .and_then(version_number)
        .ok_or_else(not_found)?;
    let from = app
        .repo
        .version(entity, from_number)
        .await
        .map_err(|_| unavailable())?
        .ok_or_else(not_found)?;
    // A version saved by a newer binary has a layout this one does not hold: a copy of it could not be rendered.
    let known = u32::try_from(from.layout_version)
        .ok()
        .and_then(layout)
        .is_some();
    if !known {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unknown_layout",
        ));
    }

    let active = app
        .repo
        .active_version(entity)
        .await
        .map_err(|_| unavailable())?;
    let current = active.as_ref().map_or(0, |row| row.version);
    if current != base_version {
        return Err(conflict(current));
    }
    // `from` exists, so the entity has a version and `active` is one: the version the person was looking at.
    let active = active.ok_or_else(|| conflict(0))?;
    let before: LetterheadConfig =
        serde_json::from_value(active.config).map_err(|_| stored_unusable())?;
    let after: LetterheadConfig =
        serde_json::from_value(from.config).map_err(|_| stored_unusable())?;
    let changed = changed_settings(&before, &after)
        .into_iter()
        .map(str::to_owned)
        .collect();

    let version = app
        .repo
        .restore(RestoreVersion {
            entity,
            from_version: from_number,
            base_version,
            actor_sub: authz.person.sub.clone(),
            actor_name: actor_name(&authz),
            changed_settings: changed,
        })
        .await
        .map_err(save_error)?;
    Ok(created(version))
}

/// A version number as the path gives it: digits only, no sign, no leading zero, one that fits an `i32`.
fn version_number(text: &str) -> Option<i32> {
    let digits = !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    if !digits || text.starts_with('0') {
        return None;
    }
    text.parse::<i32>().ok()
}

// ---------------------------------------------------------------------------------------------------------------
// The bodies

/// 201 `{ "version": n }`.
fn created(version: i32) -> Response {
    (
        StatusCode::CREATED,
        axum::Json(json!({ "version": version })),
    )
        .into_response()
}

/// A save or restore body: a JSON object with `baseVersion` (a whole number from 0) and, for a save, `config`.
/// Anything else is `invalid_request`: the form never sends it, and nothing of it is repeated.
fn envelope(body: &[u8], config: Option<&str>) -> Result<(i32, Option<Value>), ApiError> {
    let invalid = || ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request");
    let Ok(Value::Object(mut members)) = serde_json::from_slice::<Value>(body) else {
        return Err(invalid());
    };
    let base = members
        .remove("baseVersion")
        .and_then(|value| value.as_i64())
        .and_then(|number| i32::try_from(number).ok())
        .filter(|number| *number >= 0)
        .ok_or_else(invalid)?;
    let config = match config {
        Some(name) => Some(members.remove(name).ok_or_else(invalid)?),
        None => None,
    };
    if !members.is_empty() {
        return Err(invalid());
    }
    Ok((base, config))
}

/// The declared `Content-Length`, if it is a valid one.
fn declared_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .parse()
        .ok()
}

/// Why a body was not read.
enum Unread {
    TooLarge,
    TimedOut,
    /// The connection broke while the caller was sending.
    Aborted,
}

impl Unread {
    fn error(self) -> ApiError {
        match self {
            Unread::TooLarge => ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large"),
            Unread::TimedOut => ApiError::new(StatusCode::REQUEST_TIMEOUT, "request_timeout"),
            Unread::Aborted => bad_request(),
        }
    }
}

async fn read_json_body(request: Request) -> Result<Vec<u8>, ApiError> {
    let declared = declared_length(request.headers());
    read_body(request.into_body(), declared, JSON_BODY_MAX)
        .await
        .map_err(Unread::error)
}

/// The body, at most `limit` bytes and within [`BODY_TIMEOUT`]. A body that says it is too big is not read; one
/// that turns out to be is read no further, and what is still coming is dropped within bounds.
async fn read_body(mut body: Body, declared: Option<u64>, limit: usize) -> Result<Vec<u8>, Unread> {
    if declared.is_some_and(|length| length > limit as u64) {
        tokio::spawn(drain(body, limit));
        return Err(Unread::TooLarge);
    }
    let capacity = declared.map_or(0, |length| length.min(limit as u64) as usize);
    let reading = async {
        let mut bytes: Vec<u8> = Vec::with_capacity(capacity);
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| Unread::Aborted)?;
            if let Ok(data) = frame.into_data() {
                if bytes.len() + data.len() > limit {
                    return Err(Unread::TooLarge);
                }
                bytes.extend_from_slice(&data);
            }
        }
        Ok(bytes)
    };
    let read = tokio::time::timeout(BODY_TIMEOUT, reading)
        .await
        .unwrap_or(Err(Unread::TimedOut));
    if matches!(read, Err(Unread::TooLarge)) {
        tokio::spawn(drain(body, limit));
    }
    read
}

/// Reads and throws away what a client is still sending, up to `limit` plus [`DRAIN_EXTRA`] and for at most
/// [`BODY_TIMEOUT`].
async fn drain(mut body: Body, limit: usize) {
    let reading = async {
        let mut seen = 0usize;
        while let Some(Ok(frame)) = body.frame().await {
            if let Ok(data) = frame.into_data() {
                seen += data.len();
                if seen > limit + DRAIN_EXTRA {
                    break;
                }
            }
        }
    };
    let _ = tokio::time::timeout(BODY_TIMEOUT, reading).await;
}

// ---------------------------------------------------------------------------------------------------------------
// multipart/form-data, read by hand

/// What an upload carries.
struct Form {
    kind: AssetKind,
    file: Vec<u8>,
}

/// The boundary of a `multipart/form-data` content type, if the type is one and the boundary is a legal one
/// (RFC 2046: one to 70 characters of a closed set, not ending in a space).
fn boundary_of(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::CONTENT_TYPE)?.to_str().ok()?;
    let mut parts = value.split(';');
    if !parts
        .next()?
        .trim()
        .eq_ignore_ascii_case("multipart/form-data")
    {
        return None;
    }
    for parameter in parts {
        let Some((name, value)) = parameter.split_once('=') else {
            continue;
        };
        if !name.trim().eq_ignore_ascii_case("boundary") {
            continue;
        }
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(value);
        let legal = (1..=70).contains(&value.len())
            && !value.ends_with(' ')
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b" '()+_,-./:=?".contains(&b));
        return legal.then(|| value.to_owned());
    }
    None
}

/// The first place of `needle` in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    let first = *needle.first()?;
    let mut from = 0;
    while let Some(offset) = haystack.get(from..)?.iter().position(|b| *b == first) {
        let at = from + offset;
        if haystack.get(at..at + needle.len()) == Some(needle) {
            return Some(at);
        }
        from = at + 1;
    }
    None
}

/// The two fields of an upload, or `None` for anything that is not exactly that: a missing or repeated field, a
/// field of another name, a part without a name, a body that is cut short. Strict on purpose: the form sends one
/// shape, and what is not it is not guessed at.
fn parse_multipart(body: &[u8], boundary: &str) -> Option<Form> {
    let delimiter = format!("--{boundary}").into_bytes();
    let mut separator = b"\r\n".to_vec();
    separator.extend_from_slice(&delimiter);

    let mut rest = body.strip_prefix(delimiter.as_slice())?;
    let mut kind: Option<AssetKind> = None;
    let mut file: Option<Vec<u8>> = None;
    let mut parts = 0;
    loop {
        // After a delimiter: optional padding, then `--` ends the body, or CRLF starts a part.
        let padding = rest
            .iter()
            .take_while(|b| **b == b' ' || **b == b'\t')
            .count();
        rest = &rest[padding..];
        if rest.starts_with(b"--") {
            break;
        }
        rest = rest.strip_prefix(b"\r\n")?;
        parts += 1;
        if parts > PARTS_MAX {
            return None;
        }
        let head_end = find(rest, b"\r\n\r\n")?;
        if head_end > PART_HEAD_MAX {
            return None;
        }
        let name = field_name(std::str::from_utf8(&rest[..head_end]).ok()?)?;
        let content = &rest[head_end + 4..];
        let end = find(content, &separator)?;
        let data = &content[..end];
        rest = &content[end + separator.len()..];
        match name.as_str() {
            "kind" if kind.is_none() => {
                kind = Some(AssetKind::parse(std::str::from_utf8(data).ok()?)?);
            }
            "file" if file.is_none() => file = Some(data.to_vec()),
            _ => return None,
        }
    }
    Some(Form {
        kind: kind?,
        file: file?,
    })
}

/// The `name` of a part's `Content-Disposition: form-data`, read with the quoting rules, so that a file name
/// that looks like a parameter is only a file name. A part with two names, or no disposition, has none.
fn field_name(head: &str) -> Option<String> {
    let mut name: Option<String> = None;
    let mut seen = false;
    for line in head.split("\r\n") {
        let (field, value) = line.split_once(':')?;
        if !field.trim().eq_ignore_ascii_case("content-disposition") {
            continue;
        }
        if seen {
            return None;
        }
        seen = true;
        let mut parameters = parameters(value).into_iter();
        if !parameters.next()?.0.eq_ignore_ascii_case("form-data") {
            return None;
        }
        for (key, value) in parameters {
            if key.eq_ignore_ascii_case("name") {
                if name.is_some() {
                    return None;
                }
                name = Some(value?);
            }
        }
    }
    name
}

/// `a; b="c;d"; e=f` as `[("a", None), ("b", Some("c;d")), ("e", Some("f"))]`: semicolons split outside quotes,
/// and a backslash in a quoted string escapes the next character.
fn parameters(text: &str) -> Vec<(String, Option<String>)> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut escaped = false;
    let mut pieces = Vec::new();
    for c in text.chars() {
        if escaped {
            current.push(c);
            escaped = false;
        } else if quoted && c == '\\' {
            escaped = true;
        } else if c == '"' {
            quoted = !quoted;
            current.push(c);
        } else if c == ';' && !quoted {
            pieces.push(std::mem::take(&mut current));
        } else {
            current.push(c);
        }
    }
    pieces.push(current);
    for piece in pieces {
        let piece = piece.trim();
        match piece.split_once('=') {
            Some((key, value)) => {
                let value = value.trim();
                let value = value
                    .strip_prefix('"')
                    .and_then(|v| v.strip_suffix('"'))
                    .unwrap_or(value);
                out.push((key.trim().to_owned(), Some(value.to_owned())));
            }
            None => out.push((piece.to_owned(), None)),
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------
// The refusals

fn bad_request() -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "bad_request")
}

fn internal(code: &'static str) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, code)
}

/// 503 with `Retry-After`: the database could not answer now.
fn unavailable() -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "service_unavailable").retry_after(RETRY_SECONDS)
}

/// A stored configuration that is not the shape this binary reads: a fault of the data, not of the request.
fn stored_unusable() -> ApiError {
    internal("stored_version_unusable")
}

fn storage_error(error: StorageError) -> ApiError {
    match error {
        // The database and the bucket disagree, or the object is not what the row says: retrying will not mend it.
        StorageError::Missing | StorageError::Corrupt => internal("asset_unavailable"),
        StorageError::Unavailable => {
            ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "asset_unavailable")
                .retry_after(RETRY_SECONDS)
        }
    }
}

/// 409 `version_conflict` (AC-4.8): somebody saved since the person looked. `currentVersion` is the newest now,
/// so the form can say "reload".
fn conflict(current: i32) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, "version_conflict")
        .with("currentVersion", Value::from(current))
}

/// 422 `invalid_letterhead` with `problems` (G3): paths into the configuration, reasons from the closed list.
fn invalid_letterhead(problems: Vec<Problem>) -> ApiError {
    ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_letterhead").with(
        "problems",
        serde_json::to_value(problems).unwrap_or(Value::Array(Vec::new())),
    )
}

/// [`invalid_letterhead`] for problems that a worker already wrote as JSON (a fit check's).
pub(super) fn invalid_letterhead_values(problems: Vec<Value>) -> ApiError {
    ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_letterhead")
        .with("problems", Value::Array(problems))
}

fn save_error(error: SaveError) -> ApiError {
    match error {
        SaveError::VersionConflict { current } => conflict(current),
        // The asset was there when the save looked and gone when it wrote (the 24 h sweep): no slot to name.
        SaveError::AssetUnavailable => invalid_letterhead(vec![Problem {
            path: String::new(),
            reason: Reason::AssetUnknown,
            name: None,
            language: None,
        }]),
        SaveError::NotFound => ApiError::new(StatusCode::NOT_FOUND, "letterhead_version_not_found"),
        SaveError::Db(_) => unavailable(),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;
    use letterhead_engine::config::default_config;

    use super::*;

    fn part(name: &str, extra: &str, data: &[u8]) -> Vec<u8> {
        let mut out =
            format!("Content-Disposition: form-data; name=\"{name}\"{extra}\r\n\r\n").into_bytes();
        out.extend_from_slice(data);
        out
    }

    fn form(boundary: &str, parts: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        for p in parts {
            out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            out.extend_from_slice(p);
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        out
    }

    fn standard() -> Vec<u8> {
        form(
            "XyZ",
            &[
                part("kind", "", b"logo"),
                part(
                    "file",
                    "; filename=\"a.png\"",
                    b"\x89PNG\r\n--Xy-not-the-delimiter",
                ),
            ],
        )
    }

    #[test]
    fn a_form_with_a_kind_and_a_file_is_read_with_the_bytes_untouched() {
        let parsed = parse_multipart(&standard(), "XyZ").expect("a form");
        assert_eq!(parsed.kind, AssetKind::Logo);
        assert_eq!(parsed.file, b"\x89PNG\r\n--Xy-not-the-delimiter");
    }

    #[test]
    fn the_order_of_the_fields_does_not_matter_and_an_empty_file_is_a_file() {
        let body = form(
            "b",
            &[part("file", "", b""), part("kind", "", b"background")],
        );
        let parsed = parse_multipart(&body, "b").expect("a form");
        assert_eq!(parsed.kind, AssetKind::Background);
        assert!(parsed.file.is_empty());
    }

    #[test]
    fn what_is_not_exactly_the_two_fields_is_not_a_form() {
        let kind = || part("kind", "", b"logo");
        let file = || part("file", "", b"x");
        let bad: Vec<(&str, Vec<u8>)> = vec![
            ("no file", form("b", &[kind()])),
            ("no kind", form("b", &[file()])),
            ("kind twice", form("b", &[kind(), kind(), file()])),
            ("file twice", form("b", &[kind(), file(), file()])),
            (
                "another field",
                form("b", &[kind(), file(), part("x", "", b"y")]),
            ),
            (
                "an unknown kind",
                form("b", &[part("kind", "", b"banner"), file()]),
            ),
            (
                "a kind with a space",
                form("b", &[part("kind", "", b"logo "), file()]),
            ),
            (
                "a part with no name",
                form(
                    "b",
                    &[
                        b"Content-Disposition: form-data\r\n\r\nx".to_vec(),
                        kind(),
                        file(),
                    ],
                ),
            ),
            (
                "a part with no disposition",
                form("b", &[b"X-Other: 1\r\n\r\nx".to_vec(), kind(), file()]),
            ),
            ("not even a form", b"hello".to_vec()),
            ("empty", Vec::new()),
            (
                "a preamble",
                [b"junk\r\n".to_vec(), form("b", &[kind(), file()])].concat(),
            ),
        ];
        for (what, body) in bad {
            assert!(parse_multipart(&body, "b").is_none(), "{what}");
        }
        // Cut short: no closing delimiter, a part that never ends, a header block that never ends.
        let whole = form("b", &[kind(), file()]);
        for cut in [whole.len() - 5, whole.len() - 12, 20, 3, 1] {
            assert!(
                parse_multipart(&whole[..cut], "b").is_none(),
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn a_file_name_that_looks_like_a_parameter_is_only_a_file_name() {
        let hostile = form(
            "b",
            &[
                part("kind", "", b"logo"),
                part("file", "; filename=\"x; name=\\\"kind\\\"\"", b"data"),
            ],
        );
        let parsed = parse_multipart(&hostile, "b").expect("a form");
        assert_eq!(parsed.file, b"data");
        // Two names are not read as one.
        let double = form(
            "b",
            &[
                part("kind", "; name=\"file\"", b"logo"),
                part("file", "", b"data"),
            ],
        );
        assert!(parse_multipart(&double, "b").is_none());
        // Two dispositions neither.
        let two = form(
            "b",
            &[
                b"Content-Disposition: form-data; name=\"kind\"\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nlogo".to_vec(),
                part("file", "", b"data"),
            ],
        );
        assert!(parse_multipart(&two, "b").is_none());
    }

    #[test]
    fn the_part_headers_are_read_without_regard_to_case_and_a_part_type_is_ignored() {
        let body = form(
            "b",
            &[
                b"content-disposition: FORM-DATA; NAME=kind\r\nContent-Type: text/plain\r\n\r\nlogo".to_vec(),
                b"Content-Type: image/jpeg\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.jpg\"\r\n\r\nPNGDATA".to_vec(),
            ],
        );
        let parsed = parse_multipart(&body, "b").expect("a form");
        assert_eq!(parsed.kind, AssetKind::Logo);
        assert_eq!(
            parsed.file, b"PNGDATA",
            "the declared type is not what decides the format (AC-7.1)"
        );
    }

    #[test]
    fn more_parts_than_the_form_has_are_refused_before_they_are_read() {
        let mut parts = vec![part("kind", "", b"logo"), part("file", "", b"x")];
        parts.extend((0..PARTS_MAX).map(|_| part("x", "", b"y")));
        assert!(parse_multipart(&form("b", &parts), "b").is_none());
    }

    #[test]
    fn a_boundary_is_read_from_the_content_type_and_only_a_legal_one() {
        let of = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(value).expect("header"),
            );
            boundary_of(&headers)
        };
        assert_eq!(
            of("multipart/form-data; boundary=abc").as_deref(),
            Some("abc")
        );
        assert_eq!(
            of("Multipart/Form-Data; charset=x; Boundary=\"a b'c\"").as_deref(),
            Some("a b'c")
        );
        for bad in [
            "multipart/form-data",
            "multipart/form-data; boundary=",
            "multipart/mixed; boundary=abc",
            "application/json; boundary=abc",
            "multipart/form-data; boundary=\"ends in space \"",
            &format!("multipart/form-data; boundary={}", "a".repeat(71)),
            "multipart/form-data; boundary=a\u{e9}",
        ] {
            assert_eq!(of(bad), None, "{bad}");
        }
        // A semicolon ends the boundary: what follows is another parameter.
        assert_eq!(
            of("multipart/form-data; boundary=a;b").as_deref(),
            Some("a")
        );
        assert_eq!(
            of(&format!("multipart/form-data; boundary={}", "a".repeat(70))).map(|b| b.len()),
            Some(70)
        );
        let mut headers = HeaderMap::new();
        assert_eq!(boundary_of(&headers), None);
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("multipart/form-data"),
        );
        assert_eq!(boundary_of(&headers), None);
    }

    #[test]
    fn find_finds_the_first_place_and_does_not_run_past_the_end() {
        assert_eq!(find(b"abcabc", b"bc"), Some(1));
        assert_eq!(find(b"abc", b"abcd"), None);
        assert_eq!(find(b"", b"a"), None);
        assert_eq!(find(b"aab", b"ab"), Some(1));
        assert_eq!(find(b"abc", b""), None);
    }

    #[test]
    fn an_envelope_is_an_object_with_a_whole_base_version_and_nothing_else() {
        let ok = |text: &str, config: Option<&str>| envelope(text.as_bytes(), config);
        assert_eq!(
            ok(r#"{"baseVersion":0,"config":{}}"#, Some("config"))
                .expect("ok")
                .0,
            0
        );
        assert_eq!(ok(r#"{"baseVersion":7}"#, None).expect("ok"), (7, None));
        for (text, config) in [
            (r#"{"baseVersion":-1}"#, None),
            (r#"{"baseVersion":1.5}"#, None),
            (r#"{"baseVersion":1.0}"#, None),
            (r#"{"baseVersion":"1"}"#, None),
            (r#"{"baseVersion":null}"#, None),
            (r#"{"baseVersion":2147483648}"#, None),
            (r#"{"baseVersion":1e3}"#, None),
            (r#"{}"#, None),
            (r#"[]"#, None),
            (r#"null"#, None),
            ("not json", None),
            ("", None),
            (r#"{"baseVersion":1,"extra":1}"#, None),
            (r#"{"baseVersion":1,"config":{}}"#, None),
            (r#"{"baseVersion":1}"#, Some("config")),
            (r#"{"config":{}}"#, Some("config")),
        ] {
            let error = ok(text, config).expect_err(text);
            assert_eq!(error.status(), StatusCode::UNPROCESSABLE_ENTITY, "{text}");
            assert_eq!(error.code(), "invalid_request", "{text}");
        }
    }

    #[test]
    fn a_version_number_is_digits_with_no_sign_and_no_leading_zero() {
        assert_eq!(version_number("1"), Some(1));
        assert_eq!(version_number("2147483647"), Some(i32::MAX));
        for bad in ["", "0", "01", "+1", "-1", "1.0", " 1", "2147483648", "٣"] {
            assert_eq!(version_number(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn an_asset_that_is_unknown_or_of_the_other_kind_is_named_by_its_slot_not_its_id() {
        let mut config = default_config();
        let logo = Uuid::new_v4();
        let background = Uuid::new_v4();
        let variant = &mut config.variants.default;
        variant.logo = Some(letterhead_engine::config::Logo {
            asset: logo.to_string(),
            position: letterhead_engine::config::LogoPosition::Left,
            height_mm: 10.0,
        });
        variant.background = Some(background.to_string());
        let row = |id: Uuid, kind: AssetKind| AssetRow {
            id,
            entity: Entity::WelldIt,
            kind,
            format: Format::Png,
            sha256: vec![0; 32],
            bytes: 1,
            size_px: Some((1, 1)),
            created_by: "x".into(),
            created_at: chrono::DateTime::UNIX_EPOCH,
        };
        let right = [
            row(logo, AssetKind::Logo),
            row(background, AssetKind::Background),
        ];
        assert!(asset_problems(&config, &right).is_empty());
        let swapped = [
            row(logo, AssetKind::Background),
            row(background, AssetKind::Logo),
        ];
        let paths: Vec<String> = asset_problems(&config, &swapped)
            .into_iter()
            .map(|p| p.path)
            .collect();
        assert_eq!(
            paths,
            [
                "/variants/default/logo/asset",
                "/variants/default/background"
            ]
        );
        let missing = asset_problems(&config, &[row(logo, AssetKind::Logo)]);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].path, "/variants/default/background");
        assert_eq!(missing[0].reason, Reason::AssetUnknown);
    }

    #[tokio::test]
    async fn a_body_is_read_up_to_its_limit_and_no_further() {
        let small = read_body(Body::from(vec![1u8; 10]), Some(10), 100).await;
        assert_eq!(small.ok().map(|b| b.len()), Some(10));
        let at_limit = read_body(Body::from(vec![0u8; 100]), None, 100).await;
        assert_eq!(at_limit.ok().map(|b| b.len()), Some(100));
        let over = read_body(Body::from(vec![0u8; 101]), None, 100).await;
        assert!(matches!(over, Err(Unread::TooLarge)));
        // A length that is declared too big is refused without reading, whatever follows.
        let declared = read_body(Body::from(vec![0u8; 5]), Some(101), 100).await;
        assert!(matches!(declared, Err(Unread::TooLarge)));
        drain(Body::from(vec![0u8; 1000]), 10).await;
        drain(Body::from(vec![0u8; 10 + DRAIN_EXTRA + 10]), 10).await;
    }

    /// A body that never yields, and one that breaks after its first bytes.
    struct Stuck;

    impl http_body::Body for Stuck {
        type Data = bytes::Bytes;
        type Error = std::convert::Infallible;

        fn poll_frame(
            self: std::pin::Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Result<http_body::Frame<bytes::Bytes>, Self::Error>>> {
            std::task::Poll::Pending
        }
    }

    struct Broken(bool);

    impl http_body::Body for Broken {
        type Data = bytes::Bytes;
        type Error = std::io::Error;

        fn poll_frame(
            mut self: std::pin::Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Result<http_body::Frame<bytes::Bytes>, Self::Error>>> {
            let first = !self.0;
            self.0 = true;
            std::task::Poll::Ready(Some(if first {
                Ok(http_body::Frame::data(bytes::Bytes::from_static(b"{\"a\"")))
            } else {
                Err(std::io::Error::other("connection reset"))
            }))
        }
    }

    #[tokio::test]
    async fn a_body_that_stops_coming_is_a_408_and_one_that_breaks_a_400() {
        tokio::time::pause();
        let reading = tokio::spawn(read_body(Body::new(Stuck), None, 100));
        tokio::time::advance(BODY_TIMEOUT + Duration::from_secs(1)).await;
        let timed_out = reading.await.expect("join").expect_err("timed out");
        assert_eq!(timed_out.error().status(), StatusCode::REQUEST_TIMEOUT);
        let broken = read_body(Body::new(Broken(false)), None, 100)
            .await
            .expect_err("broken");
        let error = broken.error();
        assert_eq!(error.status(), StatusCode::BAD_REQUEST);
        assert_eq!(error.code(), "bad_request");
    }

    /// AC-4.3, AC-4.6: the router has no verb that changes or deletes what was saved. This reads the table
    /// that `person_router` is written as, so a `put(`, `patch(` or `delete(` added to it fails here before it
    /// can be reached; `tests/write.rs` asks the running service the same.
    #[test]
    fn the_router_registers_only_get_and_post() {
        let source = include_str!("mod.rs");
        let code = source.split("#[cfg(test)]").next().unwrap_or(source);
        let table: String = code
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        let imported = table
            .split("routing::{")
            .nth(1)
            .and_then(|rest| rest.split('}').next())
            .expect("the routing import");
        let verbs: Vec<&str> = imported
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .collect();
        assert_eq!(
            verbs,
            ["get", "post"],
            "a route verb was added to the router"
        );
        for forbidden in ["put(", "patch(", "delete(", "routing::any", "MethodFilter"] {
            assert!(!table.contains(forbidden), "`{forbidden}` in the router");
        }
        assert!(table.matches(".route(").count() >= 9, "the table is read");
    }
}
