//! What a signed-in person may do (task T14; AC-8.1, AC-8.2, AC-8.9).
//!
//! The person's token says who they are (`auth::person`); this module asks `auth` what they may do:
//!
//! - [`resolve`]: the client of `GET /authz/resolve` with its 30 s cache per `(sub, perm_epoch)`;
//! - [`scope`]: `has_capability`, `scope_for`, `in_scope`, ported from crm-api, and the table both are tested with;
//! - [`require_access`]: the layer of the person routes, after the person's token and before any handler: no
//!   `letterheads:access` is a 403 `forbidden`, an `auth` that cannot answer is a 503 `authz_unavailable`.
//!
//! The permissions of the catalog `auth/src/authz/catalogs/letterheads.ts` are two:
//!
//! | Capability | Grants |
//! | --- | --- |
//! | `letterheads:access` | the tool: read both entities' letterheads, their history and the preview |
//! | `letterhead:manage` | change a letterhead (save, restore, upload); scoped to the entity by a condition |
//!
//! A holder of access sees both entities (AC-8.2). Whether they may *change* one is [`Authz::can_manage`], which
//! is what the browser is told as `canManage` and what the write routes check again (the browser's idea is never
//! trusted).

pub mod resolve;
pub mod scope;

use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use letterhead_engine::content::Entity;

use self::resolve::{AuthzClient, Resolved};
use self::scope::{has_capability, in_scope, scope_for};
use crate::auth::person::{self, Person};
use crate::auth::service::{Denied, unauthorized};
use crate::routes::ApiError;

/// `letterheads:access`: the tool (AC-8.1).
pub const ACCESS: (&str, &str) = ("letterheads", "access");
/// `letterhead:manage`: change a letterhead, within the entity scope (AC-8.2).
pub const MANAGE: (&str, &str) = ("letterhead", "manage");

/// `Retry-After` of a 503: `auth` is being restarted, or a connection broke.
const UNAVAILABLE_RETRY_SECONDS: u64 = 2;

/// A verified person with what `auth` says they may do, put in the extensions of a request by
/// [`require_access`].
#[derive(Clone)]
pub struct Authz {
    pub person: Person,
    resolved: Arc<Resolved>,
}

impl Authz {
    /// The entities this person may change: both for an unconditioned grant, their own for an entity-conditioned
    /// one, none without `letterhead:manage`. Fails closed (see [`scope::scope_for`]).
    pub fn manage_scope(&self) -> Vec<Entity> {
        scope_for(
            &self.resolved.permissions,
            MANAGE.0,
            MANAGE.1,
            self.resolved.entity.as_deref(),
        )
    }

    /// Whether this person may change `entity`'s letterhead.
    pub fn can_manage(&self, entity: Entity) -> bool {
        in_scope(entity.as_str(), &self.manage_scope())
    }

    /// Whether the person holds `letterhead:manage` at all, for any entity. A save outside the scope of one that
    /// does is `out_of_scope`; one by a person who does not is `forbidden`.
    pub fn holds_manage(&self) -> bool {
        has_capability(&self.resolved.permissions, MANAGE.0, MANAGE.1)
    }
}

/// The layer of the person routes, behind the person's token: `auth` is asked what the person may do (from the
/// cache for up to 30 s), and a person without `letterheads:access` goes no further.
pub async fn require_access(
    State(client): State<Arc<AuthzClient>>,
    mut request: Request,
    next: Next,
) -> Response {
    // The layer in front of this one has verified and recorded both. Their absence is a wiring fault, and the
    // answer to it is the refusal, never a pass.
    let person = request.extensions().get::<Person>().cloned();
    let token = person::bearer(request.headers()).map(str::to_owned);
    let (Some(person), Some(token)) = (person, token) else {
        return unauthorized(Denied::NoCredential);
    };

    let resolved = match client.resolve(&person.sub, person.perm_epoch, &token).await {
        Ok(resolved) => resolved,
        Err(why) => {
            // Fail closed: no answer is no access. The operator gets the cause; nobody gets a stale grant.
            eprintln!(
                "authz: GET /authz/resolve failed ({why}): refusing the request (fail closed)"
            );
            return ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "authz_unavailable")
                .retry_after(UNAVAILABLE_RETRY_SECONDS)
                .into_response();
        }
    };
    if !has_capability(&resolved.permissions, ACCESS.0, ACCESS.1) {
        return ApiError::new(StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    request.extensions_mut().insert(Authz { person, resolved });
    next.run(request).await
}
