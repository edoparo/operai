//! Service authentication of the render routes (task T12; AC-3.1, AC-9.3).
//!
//! The only credential of `/v1/render/*` and `GET /v1/letterheads/status` is a scoped service JWT minted by
//! `auth` (`POST /system/service-token`). This is the port of `crm-api/src/auth/systemAuth.middleware.ts` and
//! checks the same things in the same way:
//!
//! - RS256 only, by the key set that `auth` publishes at `AUTH_JWKS_URL`, picked by the token's `kid`;
//! - `iss` is `AUTH_ISSUER`;
//! - `aud` is `SERVICE_AUDIENCE`, and never `AUTH_AUDIENCE`: a person's token has the other audience and no
//!   scope, so it is refused here, and a token that names both audiences is refused too. There is no
//!   person-token path on these routes;
//! - `scope` (space separated) holds `letterhead:render`;
//! - `sub` is a service principal (`system:<client>`).
//!
//! **No caller is named here.** `sub` is not looked up in a list: any service that `auth` has issued a
//! credential with this scope to can render, and a new caller is a client entry at `auth` and nothing in this
//! code or its environment (AC-9.3). That is the difference from crm-api's `allowedSubs`, which this service
//! deliberately does not have.
//!
//! Every failure answers the **same** 401, byte for byte ([`unauthorized`]): no hint of which check failed
//! reaches the caller. The operator gets the reason from the log line (`cause=`, a closed vocabulary), never
//! the token. Nothing of a presented credential is written anywhere.
//!
//! The key set is fetched lazily and kept: a token with a `kid` that is not held makes one refresh, and no more
//! than one every [`COOLDOWN`] however many such tokens arrive, so a flood of random `kid`s cannot turn this
//! service into a load generator against `auth`. Held keys are refreshed after [`MAX_AGE`]; if `auth` cannot be
//! reached they are used for up to [`STALE_MAX`] more (a rotated key is then still valid for that long, which is
//! far inside the lifetime of anything but the key itself), after which every token is refused.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::errors::ErrorKind;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use serde_json::Value;
use url::Url;

use crate::env::AuthConfig;
use crate::log::Facts;

/// The scope that `auth` gives a service that may render (plan § Data model, `auth`).
pub const RENDER_SCOPE: &str = "letterhead:render";
/// The prefix of every service principal's `sub`.
const SERVICE_SUB_PREFIX: &str = "system:";

/// A refresh of the key set at most this often, whatever arrives (the `cooldown` of jose's remote key set).
const COOLDOWN: Duration = Duration::from_secs(30);
/// Held keys are used without a refresh for this long.
const MAX_AGE: Duration = Duration::from_secs(10 * 60);
/// If a refresh fails, held keys are used for this long in all, then none.
const STALE_MAX: Duration = Duration::from_secs(60 * 60);
const JWKS_TIMEOUT: Duration = Duration::from_secs(5);
/// A key set larger than this is refused unread.
const MAX_JWKS_BYTES: usize = 256 * 1024;
/// A credential longer than this is refused unread (a real one is about a kilobyte).
const MAX_TOKEN_BYTES: usize = 16 * 1024;

/// The verified service identity (`sub`) of a request, put in its extensions by [`require`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller(pub String);

/// Why a credential was refused. The caller never sees which; the log does, by [`Denied::cause`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denied {
    NoCredential,
    /// Not three parts, not a JWT, an algorithm other than RS256, a claim missing or of the wrong type.
    Malformed,
    /// A `kid` that the key set of `auth` does not hold.
    UnknownKey,
    BadSignature,
    Expired,
    Issuer,
    /// Not `SERVICE_AUDIENCE`, or also `AUTH_AUDIENCE`.
    Audience,
    Scope,
    /// A `sub` that is not a service principal.
    Subject,
    /// The key set could not be had, and none is held that is young enough.
    KeysUnavailable,
}

impl Denied {
    pub fn cause(self) -> &'static str {
        match self {
            Denied::NoCredential => "no_credential",
            Denied::Malformed => "malformed",
            Denied::UnknownKey => "unknown_key",
            Denied::BadSignature => "bad_signature",
            Denied::Expired => "expired",
            Denied::Issuer => "issuer",
            Denied::Audience => "audience",
            Denied::Scope => "scope",
            Denied::Subject => "subject",
            Denied::KeysUnavailable => "keys_unavailable",
        }
    }
}

/// The one answer of every refusal. A constant: the six ways in which a credential can be wrong are the same
/// bytes (AC-3.1). It does not echo the request, its path or anything of the credential.
const UNAUTHORIZED_BODY: &str = r#"{"type":"https://httpstatuses.com/401","title":"Unauthorized","status":401,"code":"unauthorized","detail":"Valid credentials are required"}"#;

pub fn unauthorized(denied: Denied) -> Response {
    let mut response = (StatusCode::UNAUTHORIZED, UNAUTHORIZED_BODY).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/problem+json"),
    );
    headers.insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    response.extensions_mut().insert(Facts {
        outcome: Some("unauthorized"),
        cause: Some(denied.cause()),
        ..Facts::default()
    });
    response
}

/// The claims that this module reads. `aud` is a string or a list of strings, as RFC 7519 says.
#[derive(Deserialize)]
struct Claims {
    sub: String,
    aud: Audience,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, wanted: &str) -> bool {
        match self {
            Audience::One(one) => one == wanted,
            Audience::Many(many) => many.iter().any(|a| a == wanted),
        }
    }
}

pub struct ServiceAuth {
    issuers: [String; 2],
    service_audience: String,
    person_audience: String,
    keys: Jwks,
}

impl ServiceAuth {
    pub fn new(auth: &AuthConfig, service_audience: &str) -> Result<ServiceAuth, reqwest::Error> {
        ServiceAuth::with_timing(auth, service_audience, COOLDOWN, MAX_AGE, STALE_MAX)
    }

    fn with_timing(
        auth: &AuthConfig,
        service_audience: &str,
        cooldown: Duration,
        max_age: Duration,
        stale_max: Duration,
    ) -> Result<ServiceAuth, reqwest::Error> {
        // `Url` writes `http://host:3001` as `http://host:3001/`; `auth` writes `iss` without the slash.
        let issuer = auth.issuer.as_str().to_owned();
        let bare = issuer.trim_end_matches('/').to_owned();
        Ok(ServiceAuth {
            issuers: [bare, issuer],
            service_audience: service_audience.to_owned(),
            person_audience: auth.audience.clone(),
            keys: Jwks::new(auth.jwks_url.clone(), cooldown, max_age, stale_max)?,
        })
    }

    /// The `sub` of a valid service credential for rendering.
    pub async fn verify(&self, token: &str) -> Result<String, Denied> {
        if token.is_empty() || token.len() > MAX_TOKEN_BYTES {
            return Err(Denied::Malformed);
        }
        let header = decode_header(token).map_err(|_| Denied::Malformed)?;
        if header.alg != Algorithm::RS256 {
            return Err(Denied::Malformed);
        }
        let Some(kid) = header.kid.as_deref().filter(|kid| !kid.is_empty()) else {
            return Err(Denied::Malformed);
        };
        let key = self.keys.key(kid).await?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&self.issuers);
        validation.set_audience(&[self.service_audience.as_str()]);
        validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
        // No tolerance: `auth` mints from the same clock family, and jose here has none either.
        validation.leeway = 0;
        validation.validate_nbf = true;
        let data =
            decode::<Claims>(token, &key, &validation).map_err(|error| match error.kind() {
                ErrorKind::InvalidSignature => Denied::BadSignature,
                ErrorKind::ExpiredSignature | ErrorKind::ImmatureSignature => Denied::Expired,
                ErrorKind::InvalidIssuer => Denied::Issuer,
                ErrorKind::InvalidAudience => Denied::Audience,
                _ => Denied::Malformed,
            })?;
        let claims = data.claims;

        // A person's token carries `AUTH_AUDIENCE`. A token that carries both audiences is not a service
        // credential either.
        if claims.aud.contains(&self.person_audience) {
            return Err(Denied::Audience);
        }
        if !claims.sub.starts_with(SERVICE_SUB_PREFIX)
            || claims.sub.len() == SERVICE_SUB_PREFIX.len()
        {
            return Err(Denied::Subject);
        }
        if !claims
            .scope
            .as_deref()
            .is_some_and(|scope| scope.split(' ').any(|s| s == RENDER_SCOPE))
        {
            return Err(Denied::Scope);
        }
        Ok(claims.sub)
    }
}

/// The token of an `Authorization: Bearer <token>` header, if that is what it is.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// The middleware of the service routes: no handler runs without a verified service credential.
pub async fn require(
    State(auth): State<Arc<ServiceAuth>>,
    mut request: Request,
    next: Next,
) -> Response {
    let verdict = match bearer(request.headers()) {
        Some(token) => auth.verify(token).await,
        None => Err(Denied::NoCredential),
    };
    match verdict {
        Ok(sub) => {
            request.extensions_mut().insert(Caller(sub));
            next.run(request).await
        }
        Err(denied) => unauthorized(denied),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The key set of `auth`

type KeyMap = HashMap<String, Arc<DecodingKey>>;

#[derive(Default)]
struct Snapshot {
    keys: KeyMap,
    /// When `keys` was read. `None`: never.
    fetched: Option<Instant>,
    /// When a read was last tried, whatever came of it.
    attempted: Option<Instant>,
}

struct Jwks {
    url: Url,
    client: reqwest::Client,
    snapshot: Mutex<Snapshot>,
    /// One refresh at a time: the others wait for it and use what it brought.
    refreshing: tokio::sync::Mutex<()>,
    cooldown: Duration,
    max_age: Duration,
    stale_max: Duration,
}

impl Jwks {
    fn new(
        url: Url,
        cooldown: Duration,
        max_age: Duration,
        stale_max: Duration,
    ) -> Result<Jwks, reqwest::Error> {
        let client = reqwest::Client::builder()
            .timeout(JWKS_TIMEOUT)
            // The address is configuration; a redirect is not.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("letterhead-api")
            .build()?;
        Ok(Jwks {
            url,
            client,
            snapshot: Mutex::new(Snapshot::default()),
            refreshing: tokio::sync::Mutex::new(()),
            cooldown,
            max_age,
            stale_max,
        })
    }

    fn snapshot(&self) -> MutexGuard<'_, Snapshot> {
        self.snapshot.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The key, if it is held and young enough to be used without a refresh.
    fn fresh(&self, kid: &str) -> Option<Arc<DecodingKey>> {
        let snapshot = self.snapshot();
        let young = snapshot
            .fetched
            .is_some_and(|at| at.elapsed() < self.max_age);
        if young {
            snapshot.keys.get(kid).cloned()
        } else {
            None
        }
    }

    async fn key(&self, kid: &str) -> Result<Arc<DecodingKey>, Denied> {
        if let Some(key) = self.fresh(kid) {
            return Ok(key);
        }
        let _one_at_a_time = self.refreshing.lock().await;
        // The refresh that we waited for may have brought it.
        if let Some(key) = self.fresh(kid) {
            return Ok(key);
        }
        let may_try = self
            .snapshot()
            .attempted
            .is_none_or(|at| at.elapsed() >= self.cooldown);
        if may_try {
            let read = self.fetch().await;
            let mut snapshot = self.snapshot();
            let now = Instant::now();
            snapshot.attempted = Some(now);
            if let Some(keys) = read {
                snapshot.keys = keys;
                snapshot.fetched = Some(now);
            }
        }
        let snapshot = self.snapshot();
        match snapshot.fetched {
            Some(at) if at.elapsed() < self.stale_max => {
                snapshot.keys.get(kid).cloned().ok_or(Denied::UnknownKey)
            }
            _ => Err(Denied::KeysUnavailable),
        }
    }

    /// The key set, or `None` if it could not be read or is not one. Never an error with a message: a failure
    /// here is a 401 with `cause=keys_unavailable`, and the operator looks at `auth`.
    async fn fetch(&self) -> Option<KeyMap> {
        let mut response = self.client.get(self.url.clone()).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if body.len() + chunk.len() > MAX_JWKS_BYTES {
                return None;
            }
            body.extend_from_slice(&chunk);
        }
        parse_jwks(&body)
    }
}

/// The RSA signature keys of a JWK Set, by `kid`. A key of another type, one without a `kid`, one for
/// another algorithm than RS256 or another use than signing is left out; so is a key that cannot be read.
/// `None` only when the document is not a JWK Set.
fn parse_jwks(body: &[u8]) -> Option<KeyMap> {
    let document: Value = serde_json::from_slice(body).ok()?;
    let listed = document.get("keys")?.as_array()?;
    let mut keys = KeyMap::new();
    for jwk in listed {
        let text = |name: &str| jwk.get(name).and_then(Value::as_str);
        let rsa = text("kty") == Some("RSA");
        let for_rs256 = text("alg").is_none_or(|alg| alg == "RS256");
        let for_signing = text("use").is_none_or(|u| u == "sig");
        let (Some(kid), Some(n), Some(e)) = (text("kid"), text("n"), text("e")) else {
            continue;
        };
        if !(rsa && for_rs256 && for_signing) || kid.is_empty() {
            continue;
        }
        if let Ok(key) = DecodingKey::from_rsa_components(n, e) {
            keys.insert(kid.to_owned(), Arc::new(key));
        }
    }
    Some(keys)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use aws_lc_rs::rand::SystemRandom;
    use aws_lc_rs::rsa::{KeyPair, KeySize, PublicKeyComponents};
    use aws_lc_rs::signature::{KeyPair as _, RSA_PKCS1_SHA256};
    use base64::Engine as _;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;

    use super::*;

    const ISSUER: &str = "http://localhost:3001";
    const SERVICE_AUDIENCE: &str = "operai-service";
    const PERSON_AUDIENCE: &str = "operai-suite";

    fn b64(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_secs()
    }

    struct TestKey {
        pair: KeyPair,
        kid: String,
    }

    impl TestKey {
        fn new(kid: &str) -> TestKey {
            TestKey {
                pair: KeyPair::generate(KeySize::Rsa2048).expect("a test RSA key"),
                kid: kid.to_owned(),
            }
        }

        fn jwk(&self) -> Value {
            let parts = PublicKeyComponents::<Vec<u8>>::from(self.pair.public_key());
            json!({ "kty": "RSA", "alg": "RS256", "use": "sig", "kid": self.kid,
                    "n": b64(&parts.n), "e": b64(&parts.e) })
        }

        fn sign(&self, header: &Value, claims: &Value) -> String {
            let input = format!(
                "{}.{}",
                b64(header.to_string().as_bytes()),
                b64(claims.to_string().as_bytes())
            );
            let mut signature = vec![0; self.pair.public_modulus_len()];
            self.pair
                .sign(
                    &RSA_PKCS1_SHA256,
                    &SystemRandom::new(),
                    input.as_bytes(),
                    &mut signature,
                )
                .expect("sign");
            format!("{input}.{}", b64(&signature))
        }

        fn token(&self, claims: &Value) -> String {
            self.sign(
                &json!({ "alg": "RS256", "typ": "JWT", "kid": self.kid }),
                claims,
            )
        }
    }

    fn claims() -> Value {
        json!({ "iss": ISSUER, "sub": "system:letterhead-test-caller", "aud": SERVICE_AUDIENCE,
                "scope": "letterhead:render", "iat": now(), "exp": now() + 300, "jti": "1" })
    }

    /// A key-set server: the keys it serves can be changed, the status too, and the requests are counted.
    struct JwksServer {
        url: Url,
        served: Arc<Mutex<(u16, Vec<Value>)>>,
        hits: Arc<AtomicUsize>,
    }

    impl JwksServer {
        async fn start(keys: Vec<Value>) -> JwksServer {
            use axum::{Router, routing::get};
            let served = Arc::new(Mutex::new((200u16, keys)));
            let hits = Arc::new(AtomicUsize::new(0));
            let (state, counter) = (Arc::clone(&served), Arc::clone(&hits));
            let app = Router::new().route(
                "/auth/jwks",
                get(move || {
                    let (state, counter) = (Arc::clone(&state), Arc::clone(&counter));
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        let (status, keys) = state.lock().expect("lock").clone();
                        (
                            StatusCode::from_u16(status).expect("status"),
                            json!({ "keys": keys }).to_string(),
                        )
                    }
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind");
            let port = listener.local_addr().expect("addr").port();
            tokio::spawn(async move { axum::serve(listener, app).await });
            JwksServer {
                url: Url::parse(&format!("http://127.0.0.1:{port}/auth/jwks")).expect("url"),
                served,
                hits,
            }
        }

        fn serve(&self, status: u16, keys: Vec<Value>) {
            *self.served.lock().expect("lock") = (status, keys);
        }

        fn hits(&self) -> usize {
            self.hits.load(Ordering::SeqCst)
        }
    }

    fn auth_for(
        server: &JwksServer,
        cooldown: Duration,
        max_age: Duration,
        stale: Duration,
    ) -> ServiceAuth {
        let config = AuthConfig {
            issuer: Url::parse(ISSUER).expect("url"),
            jwks_url: server.url.clone(),
            base_url: Url::parse(ISSUER).expect("url"),
            audience: PERSON_AUDIENCE.to_owned(),
        };
        ServiceAuth::with_timing(&config, SERVICE_AUDIENCE, cooldown, max_age, stale)
            .expect("client")
    }

    fn auth(server: &JwksServer) -> ServiceAuth {
        auth_for(server, Duration::ZERO, MAX_AGE, STALE_MAX)
    }

    #[tokio::test]
    async fn a_service_credential_is_accepted_and_names_its_caller() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        let sub = auth(&server).verify(&key.token(&claims())).await;
        assert_eq!(sub.as_deref(), Ok("system:letterhead-test-caller"));
    }

    #[tokio::test]
    async fn the_audience_may_be_a_list_with_the_service_audience_in_it() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        let mut c = claims();
        c["aud"] = json!(["somebody-else", SERVICE_AUDIENCE]);
        assert!(auth(&server).verify(&key.token(&c)).await.is_ok());
    }

    #[tokio::test]
    async fn each_way_of_being_wrong_is_refused_with_its_own_cause() {
        let key = TestKey::new("k1");
        let other = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        let auth = auth(&server);
        let with = |name: &str, value: Value| {
            let mut c = claims();
            c[name] = value;
            key.token(&c)
        };
        let without = |name: &str| {
            let mut c = claims();
            c.as_object_mut().expect("object").remove(name);
            key.token(&c)
        };
        let cases: Vec<(&str, String, Denied)> = vec![
            ("expired", with("exp", json!(now() - 10)), Denied::Expired),
            (
                "not yet valid",
                with("nbf", json!(now() + 100)),
                Denied::Expired,
            ),
            (
                "other issuer",
                with("iss", json!("http://evil.example")),
                Denied::Issuer,
            ),
            (
                "other audience",
                with("aud", json!("somebody-else")),
                Denied::Audience,
            ),
            (
                "person audience",
                with("aud", json!(PERSON_AUDIENCE)),
                Denied::Audience,
            ),
            (
                "both audiences",
                with("aud", json!([SERVICE_AUDIENCE, PERSON_AUDIENCE])),
                Denied::Audience,
            ),
            ("no scope", without("scope"), Denied::Scope),
            (
                "other scope",
                with("scope", json!("notifications.push")),
                Denied::Scope,
            ),
            (
                "scope as a prefix",
                with("scope", json!("letterhead:render-all")),
                Denied::Scope,
            ),
            (
                "scope as a list",
                with("scope", json!(["letterhead:render"])),
                Denied::Malformed,
            ),
            (
                "a person's sub",
                with("sub", json!("0b8e5f0c-user")),
                Denied::Subject,
            ),
            (
                "an empty principal",
                with("sub", json!("system:")),
                Denied::Subject,
            ),
            ("no sub", without("sub"), Denied::Malformed),
            ("no exp", without("exp"), Denied::Malformed),
            ("no iss", without("iss"), Denied::Malformed),
            ("no aud", without("aud"), Denied::Malformed),
            (
                "signed by another key",
                other.token(&claims()),
                Denied::BadSignature,
            ),
            ("not a token", "not-a-jwt".to_owned(), Denied::Malformed),
            ("empty", String::new(), Denied::Malformed),
        ];
        for (what, token, expected) in cases {
            assert_eq!(auth.verify(&token).await, Err(expected), "{what}");
        }
    }

    #[tokio::test]
    async fn only_rs256_with_a_known_kid_is_accepted() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        let auth = auth(&server);
        // alg none, an unsigned token with a plausible body.
        let none = format!(
            "{}.{}.",
            b64(json!({ "alg": "none", "kid": "k1" }).to_string().as_bytes()),
            b64(claims().to_string().as_bytes())
        );
        assert_eq!(auth.verify(&none).await, Err(Denied::Malformed));
        // HS256 "signed" with the public modulus as the secret: the classic algorithm confusion.
        let confused = key.sign(
            &json!({ "alg": "HS256", "typ": "JWT", "kid": "k1" }),
            &claims(),
        );
        assert_eq!(auth.verify(&confused).await, Err(Denied::Malformed));
        // RS384 is another algorithm, though the same key.
        let rs384 = key.sign(
            &json!({ "alg": "RS384", "typ": "JWT", "kid": "k1" }),
            &claims(),
        );
        assert_eq!(auth.verify(&rs384).await, Err(Denied::Malformed));
        // No kid, an empty kid, and a kid the set does not hold.
        let no_kid = key.sign(&json!({ "alg": "RS256", "typ": "JWT" }), &claims());
        assert_eq!(auth.verify(&no_kid).await, Err(Denied::Malformed));
        let empty = key.sign(&json!({ "alg": "RS256", "kid": "" }), &claims());
        assert_eq!(auth.verify(&empty).await, Err(Denied::Malformed));
        let unknown = key.sign(&json!({ "alg": "RS256", "kid": "k9" }), &claims());
        assert_eq!(auth.verify(&unknown).await, Err(Denied::UnknownKey));
        // The header may name a key set of its own: it is not followed.
        let jku = key.sign(
            &json!({ "alg": "RS256", "kid": "k1", "jku": "http://evil.example/jwks", "jwk": key.jwk() }),
            &claims(),
        );
        assert!(
            auth.verify(&jku).await.is_ok(),
            "the header's own key set is ignored, not an error"
        );
        // A token of a kilobyte too many.
        assert_eq!(
            auth.verify(&"a".repeat(MAX_TOKEN_BYTES + 1)).await,
            Err(Denied::Malformed)
        );
    }

    #[tokio::test]
    async fn the_issuer_is_the_configured_one_with_or_without_a_trailing_slash() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        let auth = auth(&server);
        let mut c = claims();
        c["iss"] = json!("http://localhost:3001/");
        assert!(auth.verify(&key.token(&c)).await.is_ok());
        c["iss"] = json!("http://localhost:3001/extra");
        assert_eq!(auth.verify(&key.token(&c)).await, Err(Denied::Issuer));
    }

    #[tokio::test]
    async fn a_new_key_is_picked_up_by_one_refresh_and_a_known_one_costs_none() {
        let old = TestKey::new("k1");
        let new = TestKey::new("k2");
        let server = JwksServer::start(vec![old.jwk()]).await;
        let auth = auth(&server);
        assert!(auth.verify(&old.token(&claims())).await.is_ok());
        assert!(auth.verify(&old.token(&claims())).await.is_ok());
        assert_eq!(server.hits(), 1, "the second token needed no fetch");

        server.serve(200, vec![old.jwk(), new.jwk()]);
        assert!(auth.verify(&new.token(&claims())).await.is_ok(), "rotation");
        assert_eq!(server.hits(), 2);
    }

    #[tokio::test]
    async fn random_kids_cannot_make_more_than_one_fetch_per_cooldown() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        let auth = auth_for(&server, Duration::from_secs(3600), MAX_AGE, STALE_MAX);
        assert!(auth.verify(&key.token(&claims())).await.is_ok());
        for i in 0..20 {
            let stray = key.sign(
                &json!({ "alg": "RS256", "kid": format!("stray-{i}") }),
                &claims(),
            );
            assert_eq!(auth.verify(&stray).await, Err(Denied::UnknownKey));
        }
        assert_eq!(server.hits(), 1, "twenty unknown kids, one fetch in all");
    }

    #[tokio::test]
    async fn held_keys_survive_an_outage_for_a_while_and_then_not() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![key.jwk()]).await;
        // Young for no time at all, usable when stale for a long one.
        let auth = auth_for(
            &server,
            Duration::ZERO,
            Duration::ZERO,
            Duration::from_secs(3600),
        );
        assert!(auth.verify(&key.token(&claims())).await.is_ok());
        server.serve(503, vec![]);
        assert!(
            auth.verify(&key.token(&claims())).await.is_ok(),
            "auth is down: the key held is used"
        );

        let strict = auth_for(
            &server,
            Duration::ZERO,
            Duration::ZERO,
            Duration::from_millis(300),
        );
        server.serve(200, vec![key.jwk()]);
        assert!(strict.verify(&key.token(&claims())).await.is_ok());
        server.serve(503, vec![]);
        assert!(
            strict.verify(&key.token(&claims())).await.is_ok(),
            "still within the time that a held key may be used"
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(
            strict.verify(&key.token(&claims())).await,
            Err(Denied::KeysUnavailable),
            "too old to use when auth cannot be asked"
        );
    }

    #[tokio::test]
    async fn without_a_key_set_every_credential_is_refused() {
        let key = TestKey::new("k1");
        let server = JwksServer::start(vec![]).await;
        server.serve(500, vec![]);
        assert_eq!(
            auth(&server).verify(&key.token(&claims())).await,
            Err(Denied::KeysUnavailable)
        );
        // An address that nothing listens on.
        let mut dead = auth(&server);
        dead.keys.url = Url::parse("http://127.0.0.1:1/auth/jwks").expect("url");
        assert_eq!(
            dead.verify(&key.token(&claims())).await,
            Err(Denied::KeysUnavailable)
        );
    }

    #[test]
    fn a_key_set_keeps_only_rsa_signature_keys_with_a_kid() {
        let key = TestKey::new("k1");
        let mut other_use = key.jwk();
        other_use["use"] = json!("enc");
        other_use["kid"] = json!("enc-key");
        let mut other_alg = key.jwk();
        other_alg["alg"] = json!("RS512");
        other_alg["kid"] = json!("rs512-key");
        let mut no_kid = key.jwk();
        no_kid.as_object_mut().expect("object").remove("kid");
        let mut bare = key.jwk();
        bare.as_object_mut().expect("object").remove("alg");
        bare.as_object_mut().expect("object").remove("use");
        bare["kid"] = json!("bare");
        let set = json!({ "keys": [
            key.jwk(), other_use, other_alg, no_kid, bare,
            { "kty": "OKP", "crv": "Ed25519", "kid": "ed", "x": "AAAA" },
            { "kty": "RSA", "kid": "broken", "n": "!!", "e": "AQAB" },
            "not an object"
        ] });
        let keys = parse_jwks(set.to_string().as_bytes()).expect("a key set");
        let mut names: Vec<&String> = keys.keys().collect();
        names.sort();
        assert_eq!(names, ["bare", "k1"]);
        assert!(parse_jwks(b"not json").is_none());
        assert!(parse_jwks(br#"{"nokeys":[]}"#).is_none());
        assert!(parse_jwks(br#"{"keys":[]}"#).expect("empty").is_empty());
    }

    #[test]
    fn the_credential_is_the_bearer_header_and_nothing_else() {
        let get = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::AUTHORIZATION,
                HeaderValue::from_str(value).expect("header"),
            );
            bearer(&headers).map(str::to_owned)
        };
        assert_eq!(get("Bearer abc").as_deref(), Some("abc"));
        assert_eq!(get("bearer abc"), None);
        assert_eq!(get("Basic abc"), None);
        assert_eq!(get("abc"), None);
        assert_eq!(bearer(&HeaderMap::new()), None);
    }

    #[test]
    fn the_refusal_is_one_body_whatever_the_cause() {
        let all = [
            Denied::NoCredential,
            Denied::Malformed,
            Denied::UnknownKey,
            Denied::BadSignature,
            Denied::Expired,
            Denied::Issuer,
            Denied::Audience,
            Denied::Scope,
            Denied::Subject,
            Denied::KeysUnavailable,
        ];
        let mut causes = std::collections::HashSet::new();
        for denied in all {
            let response = unauthorized(denied);
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            let facts = response.extensions().get::<Facts>().expect("facts");
            assert_eq!(facts.outcome, Some("unauthorized"));
            assert!(causes.insert(facts.cause.expect("a cause")), "{denied:?}");
        }
        let parsed: Value = serde_json::from_str(UNAUTHORIZED_BODY).expect("json");
        assert_eq!(parsed["status"], 401);
    }
}
