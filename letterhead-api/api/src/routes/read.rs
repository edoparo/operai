//! The read routes of the configurator (task T14; AC-6.1, AC-8.2, AC-8.7, plan § Person routes, amendments
//! G2, G4, G9, G10):
//!
//! | Route | Answer |
//! | --- | --- |
//! | `GET /v1/catalog` | the closed lists and bounds the form offers, the literal-brace help and `defaultConfig` (G2) |
//! | `GET /v1/letterheads` | both entities: `{ activeVersion, canManage }` (G4, G10) |
//! | `GET /v1/letterheads/{entity}/versions` | the history, newest first: `[{ version, createdBy: { sub, name }, createdAt, changedSettings, restoredFrom }]` (G9) |
//! | `GET /v1/letterheads/{entity}/versions/{n}` | `{ version, layoutVersion, config }` |
//! | `GET /v1/assets/{id}` | the stored (sanitised) bytes of an asset, for the form's thumbnails |
//!
//! All of them are behind `auth::person` and `authz::require_access` (`letterheads:access`), which the router
//! puts in front: a holder of access sees both entities, their histories and their assets (AC-8.2). Nothing here
//! writes. Every answer is `Cache-Control: no-store` (the router's layer).
//!
//! What a refusal says never repeats the request: an entity, a version number or an id that does not exist is
//! answered by a code, not by the text that was sent (AC-3.6's rule, kept on these routes too).

use axum::{
    Json,
    extract::{Extension, State, rejection::PathRejection},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::SecondsFormat;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use letterhead_engine::assets::{self, Format};
use letterhead_engine::config::{Font, Placeholder, SETTING_NAMES, bounds, default_config};
use letterhead_engine::content::{Entity, Language, Style};
use letterhead_engine::layout::CURRENT_LAYOUT;

use super::{ApiError, AppState};
use crate::authz::{Authz, scope::in_scope};
use crate::storage::StorageError;

/// `Retry-After` of a 503: the database or the bucket could not answer now.
const UNAVAILABLE_RETRY_SECONDS: u64 = 2;

// ---------------------------------------------------------------------------------------------------------------
// The catalog

fn range(range: bounds::Range) -> Value {
    json!({ "min": range.min, "max": range.max })
}

/// `GET /v1/catalog`'s body. Everything the form needs to offer and to explain is here, read from the same
/// constants that the save validator uses, so the browser holds no rule of its own (design D-3):
///
/// - `fonts`, `placeholders` (`perPage`: filled by the layout, never by entity data), `styles`, `languages`,
///   `entities`;
/// - `bounds`: every numeric limit of AC-5.1, 5.2, 5.6, 5.9 and 7.4, in the unit its name says;
/// - `assets`: what an upload may be (AC-7.1, 7.3);
/// - `escapes`: what to type to print a literal brace or bracket (AC-6.2), as `{ type, prints }`;
/// - `settingNames`: the closed vocabulary of `changedSettings` (G9);
/// - `layoutVersion`: the layout a save made now is pinned to (ADR 20261116-a-letterhead-version-pins-its-layout);
/// - `defaultConfig`: a valid `LetterheadConfig` v1 to start an entity from, whose first save sends
///   `baseVersion: 0` (G2).
pub fn catalog_body() -> Value {
    let placeholders: Vec<Value> = Placeholder::ALL
        .iter()
        .map(|p| json!({ "name": p.name(), "perPage": p.is_page() }))
        .collect();
    let escapes: Vec<Value> = [("{{", "{"), ("}}", "}"), ("[[", "["), ("]]", "]")]
        .iter()
        .map(|(typed, printed)| json!({ "type": typed, "prints": printed }))
        .collect();
    let default_config = serde_json::to_value(default_config()).unwrap_or(Value::Null);
    json!({
        "layoutVersion": CURRENT_LAYOUT,
        "entities": Entity::ALL.iter().map(|e| e.as_str()).collect::<Vec<_>>(),
        "languages": Language::ALL.iter().map(|l| l.as_str()).collect::<Vec<_>>(),
        "fonts": Font::ALL.iter().map(|f| f.name()).collect::<Vec<_>>(),
        "placeholders": placeholders,
        "styles": Style::ALL.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        "escapes": escapes,
        "settingNames": SETTING_NAMES,
        "bounds": {
            "pageWidthMm": bounds::PAGE_WIDTH_MM,
            "pageHeightMm": bounds::PAGE_HEIGHT_MM,
            "marginMm": range(bounds::MARGIN_MM),
            "bodyMinWidthMm": bounds::BODY_MIN_WIDTH_MM,
            "bodyMinHeightMm": bounds::BODY_MIN_HEIGHT_MM,
            "maxLinesPerZone": bounds::MAX_LINES_PER_ZONE,
            "fitTestValueChars": bounds::FIT_TEST_VALUE_CHARS,
            "lineSizePt": range(bounds::LINE_SIZE_PT),
            "ruleThicknessPt": range(bounds::RULE_THICKNESS_PT),
            "headingLevels": bounds::HEADING_LEVELS,
            "headingSizePt": range(bounds::HEADING_SIZE_PT),
            "bodySizePt": range(bounds::BODY_SIZE_PT),
            "lineSpacing": range(bounds::LINE_SPACING),
            "logoHeightMm": range(bounds::LOGO_HEIGHT_MM),
        },
        "assets": {
            "formats": [Format::Png.as_str(), Format::Jpeg.as_str(), Format::Svg.as_str()],
            "maxBytes": assets::MAX_BYTES,
            "maxPixels": assets::MAX_PIXELS,
            "maxSvgElements": assets::MAX_SVG_ELEMENTS,
        },
        "defaultConfig": default_config,
    })
}

/// `GET /v1/catalog`
pub async fn catalog() -> Response {
    Json(catalog_body()).into_response()
}

// ---------------------------------------------------------------------------------------------------------------
// The letterheads

/// `GET /v1/letterheads`: `{ "welld_it": { "activeVersion": 3, "canManage": true }, "welld_ch": { "activeVersion":
/// null, "canManage": false } }`. Both entities are always there. `canManage` is the service's answer from the
/// resolved permissions, never the browser's (G4).
pub async fn list(State(app): State<AppState>, Extension(authz): Extension<Authz>) -> Response {
    let active = match app.repo.active_versions().await {
        Ok(active) => active,
        Err(_) => return unavailable(),
    };
    let scope = authz.manage_scope();
    let mut body = Map::new();
    for entity in Entity::ALL {
        let version = active.iter().find(|(e, _)| *e == entity).map(|(_, v)| *v);
        body.insert(
            entity.as_str().to_owned(),
            json!({
                "activeVersion": version,
                "canManage": in_scope(entity.as_str(), &scope),
            }),
        );
    }
    Json(Value::Object(body)).into_response()
}

// ---------------------------------------------------------------------------------------------------------------
// One entity's versions

/// The entity of a path, or the 422 `unknown_entity` of AC-4.9. A path that does not even decode is as unknown.
fn entity_of(path: Result<axum::extract::Path<String>, PathRejection>) -> Result<Entity, ApiError> {
    path.ok()
        .and_then(|axum::extract::Path(name)| Entity::parse(&name))
        .ok_or_else(|| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "unknown_entity"))
}

/// `GET /v1/letterheads/{entity}/versions`: every version of the entity, newest first. An entity with none
/// answers `[]`.
pub async fn versions(
    State(app): State<AppState>,
    path: Result<axum::extract::Path<String>, PathRejection>,
) -> Response {
    let entity = match entity_of(path) {
        Ok(entity) => entity,
        Err(error) => return error.into_response(),
    };
    let history = match app.repo.history(entity).await {
        Ok(history) => history,
        Err(_) => return unavailable(),
    };
    let rows: Vec<Value> = history
        .into_iter()
        .map(|entry| {
            json!({
                "version": entry.version,
                "createdBy": { "sub": entry.actor_sub, "name": entry.actor_name },
                "createdAt": entry.at.to_rfc3339_opts(SecondsFormat::Millis, true),
                "changedSettings": entry.changed_settings,
                "restoredFrom": entry.restored_from,
            })
        })
        .collect();
    Json(Value::Array(rows)).into_response()
}

/// A version number as the route takes it: digits only, no sign, no leading zero, one that fits an `i32`.
/// Anything else names no version.
fn version_number(text: &str) -> Option<i32> {
    let digits = !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    if !digits || text.starts_with('0') {
        return None;
    }
    text.parse::<i32>().ok()
}

/// `GET /v1/letterheads/{entity}/versions/{n}`: `{ version, layoutVersion, config }`, the configuration as it
/// was stored. 404 `letterhead_version_not_found` for a version that does not exist (AC-4.4), never another
/// entity's.
pub async fn version(
    State(app): State<AppState>,
    path: Result<axum::extract::Path<(String, String)>, PathRejection>,
) -> Response {
    let Ok(axum::extract::Path((entity_name, number))) = path else {
        return ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "unknown_entity").into_response();
    };
    let Some(entity) = Entity::parse(&entity_name) else {
        return ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "unknown_entity").into_response();
    };
    let not_found = || ApiError::new(StatusCode::NOT_FOUND, "letterhead_version_not_found");
    let Some(number) = version_number(&number) else {
        return not_found().into_response();
    };
    match app.repo.version(entity, number).await {
        Ok(Some(row)) => Json(json!({
            "version": row.version,
            "layoutVersion": row.layout_version,
            "config": row.config,
        }))
        .into_response(),
        Ok(None) => not_found().into_response(),
        Err(_) => unavailable(),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Assets

fn content_type(format: Format) -> &'static str {
    match format {
        Format::Png => "image/png",
        Format::Jpeg => "image/jpeg",
        Format::Svg => "image/svg+xml",
    }
}

/// `GET /v1/assets/{id}`: the stored bytes of a logo or a background, checked against their row (size and
/// SHA-256) by the storage. They are what upload kept (an SVG already rebuilt by the sanitiser), served as the
/// type their format says, with `nosniff`, and for an SVG a policy that lets a browser draw it and nothing
/// else, in case it is ever opened as a document.
pub async fn asset(
    State(app): State<AppState>,
    path: Result<axum::extract::Path<String>, PathRejection>,
) -> Response {
    let not_found = || ApiError::new(StatusCode::NOT_FOUND, "asset_not_found").into_response();
    let Some(id) = path
        .ok()
        .and_then(|axum::extract::Path(text)| Uuid::try_parse(&text).ok())
    else {
        return not_found();
    };
    let row = match app.repo.asset(id).await {
        Ok(Some(row)) => row,
        Ok(None) => return not_found(),
        Err(_) => return unavailable(),
    };
    let bytes = match app.storage.asset(&row).await {
        Ok(bytes) => bytes,
        Err(error) => return storage_error(error).into_response(),
    };
    let mut response = (StatusCode::OK, bytes.as_slice().to_vec()).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type(row.format)),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    response
}

// ---------------------------------------------------------------------------------------------------------------
// The refusals

/// 503 with `Retry-After`: the database could not answer now.
fn unavailable() -> Response {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "service_unavailable")
        .retry_after(UNAVAILABLE_RETRY_SECONDS)
        .into_response()
}

fn storage_error(error: StorageError) -> ApiError {
    match error {
        // The database and the bucket disagree, or the object is not what the row says: retrying will not mend it.
        StorageError::Missing | StorageError::Corrupt => {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "asset_unavailable")
        }
        StorageError::Unavailable => {
            ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "asset_unavailable")
                .retry_after(UNAVAILABLE_RETRY_SECONDS)
        }
    }
}

#[cfg(test)]
mod tests {
    use letterhead_engine::config::validate_config;

    use super::*;

    #[test]
    fn a_version_number_is_digits_with_no_sign_and_no_leading_zero() {
        assert_eq!(version_number("1"), Some(1));
        assert_eq!(version_number("42"), Some(42));
        assert_eq!(version_number("2147483647"), Some(i32::MAX));
        for bad in [
            "",
            "0",
            "01",
            "+1",
            "-1",
            "1.0",
            "1e3",
            " 1",
            "1 ",
            "0x1",
            "２",
            "2147483648",
            "٣",
            "99999999999999999999",
        ] {
            assert_eq!(version_number(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_catalog_lists_what_the_validator_knows_and_nothing_it_does_not() {
        let catalog = catalog_body();
        let names = |member: &str| -> Vec<String> {
            catalog[member]
                .as_array()
                .expect("a list")
                .iter()
                .map(|v| v.as_str().expect("text").to_owned())
                .collect()
        };
        assert_eq!(
            names("fonts"),
            ["DM Sans", "DM Mono", "Syne", "Ubuntu", "Noto Serif"]
        );
        assert_eq!(
            names("styles"),
            [
                "plain", "muted", "small", "right", "center", "title", "missing"
            ]
        );
        assert_eq!(names("languages"), ["it", "en"]);
        assert_eq!(names("entities"), ["welld_it", "welld_ch"]);
        assert_eq!(names("settingNames").len(), SETTING_NAMES.len());

        // AC-6.1: the closed set of placeholders, with the two that the layout fills.
        let placeholders: Vec<(String, bool)> = catalog["placeholders"]
            .as_array()
            .expect("a list")
            .iter()
            .map(|p| {
                (
                    p["name"].as_str().expect("name").to_owned(),
                    p["perPage"].as_bool().expect("flag"),
                )
            })
            .collect();
        assert_eq!(
            placeholders,
            [
                ("legal_name".to_owned(), false),
                ("address".to_owned(), false),
                ("vat".to_owned(), false),
                ("iban".to_owned(), false),
                ("contacts".to_owned(), false),
                ("page".to_owned(), true),
                ("pages".to_owned(), true),
            ]
        );

        // AC-6.2: the four escapes.
        let escapes: Vec<(String, String)> = catalog["escapes"]
            .as_array()
            .expect("a list")
            .iter()
            .map(|e| {
                (
                    e["type"].as_str().expect("type").to_owned(),
                    e["prints"].as_str().expect("prints").to_owned(),
                )
            })
            .collect();
        assert_eq!(
            escapes,
            [("{{", "{"), ("}}", "}"), ("[[", "["), ("]]", "]")]
                .map(|(a, b)| (a.to_owned(), b.to_owned()))
        );

        // The bounds are the validator's own constants.
        assert_eq!(
            catalog["bounds"]["marginMm"],
            json!({ "min": 5.0, "max": 100.0 })
        );
        assert_eq!(catalog["bounds"]["maxLinesPerZone"], 4);
        assert_eq!(catalog["bounds"]["fitTestValueChars"], 40);
        assert_eq!(catalog["bounds"]["headingLevels"], 3);
        assert_eq!(
            catalog["bounds"]["logoHeightMm"],
            json!({ "min": 5.0, "max": 40.0 })
        );
        assert_eq!(catalog["assets"]["maxBytes"], 2 * 1024 * 1024);
        assert_eq!(catalog["layoutVersion"], 1);
    }

    /// G2: the starting configuration the catalog hands out is one that the save rules accept as it is.
    #[test]
    fn the_default_config_of_the_catalog_passes_the_save_validation() {
        let catalog = catalog_body();
        let config = catalog["defaultConfig"].clone();
        assert!(config.is_object(), "{config}");
        let outcome = validate_config(&config);
        assert!(outcome.is_ok(), "{outcome:?}");
        // The shape the form edits: margins of 25 mm, Noto Serif and Ubuntu, a default variant with no logo.
        assert_eq!(config["margins"]["left"], 25.0);
        assert_eq!(config["fonts"]["body"], "Noto Serif");
        assert_eq!(config["fonts"]["heading"], "Ubuntu");
        assert_eq!(config["variants"]["default"]["logo"], Value::Null);
        assert_eq!(config["variants"]["first"], Value::Null);
        assert_eq!(
            config["variants"]["default"]["footer"]["left"][0]["text"]["it"],
            "{legal_name}"
        );
        assert_eq!(
            config["variants"]["default"]["footer"]["right"][0]["text"]["en"],
            "{page} / {pages}"
        );
    }
}
