//! Person authentication of the configurator's routes (task T14; AC-8.1, AC-8.2, AC-3.1's other half).
//!
//! The port of `crm-api/src/auth/jwt.middleware.ts`, and the mirror of [`super::service`]:
//!
//! - RS256 only, by the key set that `auth` publishes at `AUTH_JWKS_URL`, picked by the token's `kid`;
//! - `iss` is `AUTH_ISSUER`;
//! - `aud` is `AUTH_AUDIENCE`, and never also `SERVICE_AUDIENCE`: a service token has the other audience, so it
//!   is refused here exactly as a person's token is refused by the render routes, and a token that names both
//!   audiences is refused too. A `sub` that is a service principal (`system:...`) is refused as well;
//! - `sub` and `email` are present. `name` (for the history, G9) and `perm_epoch` (the cache key of the
//!   permissions) are read when they are there and are what they are meant to be.
//!
//! This is the identity layer only: it proves who is calling. What they may do is `authz`'s question, asked
//! of `auth` live, one layer further in.
//!
//! The refusal is [`super::service::unauthorized`]: the one 401, whatever the cause, so nothing tells a caller
//! which check failed. The key set is fetched and kept as in `service.rs` (a refresh for an unknown `kid`
//! at most once per cooldown, held keys used for a while when `auth` cannot be reached). That half is a copy of
//! `service.rs`'s `Jwks`, which is private to it and outside this task's files; one shared module is the
//! follow-up.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, header},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::errors::ErrorKind;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use serde_json::Value;
use url::Url;

use super::service::{Denied, unauthorized};
use crate::env::AuthConfig;

/// A refresh of the key set at most this often, whatever arrives.
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
/// The prefix of every service principal's `sub`.
const SERVICE_SUB_PREFIX: &str = "system:";
/// The longest display name that is kept. It ends up on the change record (G9) and on screen.
const MAX_NAME_CHARS: usize = 200;

/// The verified person of a request, put in its extensions by [`require`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    /// The account id. Identity and authorisation are always this, never the name or the email.
    pub sub: String,
    pub email: String,
    /// The `name` claim, for display on the history only (G9): trimmed, without control characters, cut at
    /// 200 characters; `None` when the token has none.
    pub name: Option<String>,
    /// The `perm_epoch` claim: half of the permission cache key. `0` when the token has none, which only
    /// means "epoch unknown" (the cache TTL still bounds it).
    pub perm_epoch: i64,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    aud: Audience,
    #[serde(default)]
    email: Option<Value>,
    #[serde(default)]
    name: Option<Value>,
    #[serde(default)]
    perm_epoch: Option<Value>,
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

/// A `name` claim as it is kept: trimmed, control characters dropped, at most [`MAX_NAME_CHARS`] characters.
fn display_name(claim: Option<&Value>) -> Option<String> {
    let text = claim?.as_str()?;
    let cleaned: String = text
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS * 2)
        .collect();
    let cut: String = cleaned.trim().chars().take(MAX_NAME_CHARS).collect();
    let name = cut.trim_end().to_owned();
    (!name.is_empty()).then_some(name)
}

pub struct PersonAuth {
    issuers: [String; 2],
    person_audience: String,
    service_audience: String,
    keys: Jwks,
}

impl PersonAuth {
    pub fn new(auth: &AuthConfig, service_audience: &str) -> Result<PersonAuth, reqwest::Error> {
        PersonAuth::with_timing(auth, service_audience, COOLDOWN, MAX_AGE, STALE_MAX)
    }

    fn with_timing(
        auth: &AuthConfig,
        service_audience: &str,
        cooldown: Duration,
        max_age: Duration,
        stale_max: Duration,
    ) -> Result<PersonAuth, reqwest::Error> {
        // `Url` writes `http://host:3001` as `http://host:3001/`; `auth` writes `iss` without the slash.
        let issuer = auth.issuer.as_str().to_owned();
        let bare = issuer.trim_end_matches('/').to_owned();
        Ok(PersonAuth {
            issuers: [bare, issuer],
            person_audience: auth.audience.clone(),
            service_audience: service_audience.to_owned(),
            keys: Jwks::new(auth.jwks_url.clone(), cooldown, max_age, stale_max)?,
        })
    }

    /// The person behind a valid person credential.
    pub async fn verify(&self, token: &str) -> Result<Person, Denied> {
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
        let verifier = self.keys.verifier(kid).await?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&self.issuers);
        validation.set_audience(&[self.person_audience.as_str()]);
        validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
        // No tolerance: `auth` mints from the same clock family, and jose in crm-api has none either.
        validation.leeway = 0;
        validation.validate_nbf = true;
        let data = decode::<Claims>(token, &verifier, &validation).map_err(|error| match error
            .kind()
        {
            ErrorKind::InvalidSignature => Denied::BadSignature,
            ErrorKind::ExpiredSignature | ErrorKind::ImmatureSignature => Denied::Expired,
            ErrorKind::InvalidIssuer => Denied::Issuer,
            ErrorKind::InvalidAudience => Denied::Audience,
            _ => Denied::Malformed,
        })?;
        let claims = data.claims;

        // A service credential carries `SERVICE_AUDIENCE`. A token that carries both audiences is not a
        // person's either.
        if claims.aud.contains(&self.service_audience) {
            return Err(Denied::Audience);
        }
        if claims.sub.is_empty() || claims.sub.starts_with(SERVICE_SUB_PREFIX) {
            return Err(Denied::Subject);
        }
        let Some(email) = claims
            .email
            .as_ref()
            .and_then(Value::as_str)
            .filter(|email| !email.is_empty())
        else {
            return Err(Denied::Malformed);
        };
        let perm_epoch = claims
            .perm_epoch
            .as_ref()
            .and_then(Value::as_i64)
            .unwrap_or(0);
        Ok(Person {
            sub: claims.sub,
            email: email.to_owned(),
            name: display_name(claims.name.as_ref()),
            perm_epoch,
        })
    }
}

/// The token of an `Authorization: Bearer <token>` header, if that is what it is.
pub fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// The middleware of the person routes: no handler runs without a verified person's credential.
pub async fn require(
    State(auth): State<Arc<PersonAuth>>,
    mut request: Request,
    next: Next,
) -> Response {
    let verdict = match bearer(request.headers()) {
        Some(token) => auth.verify(token).await,
        None => Err(Denied::NoCredential),
    };
    match verdict {
        Ok(person) => {
            request.extensions_mut().insert(person);
            next.run(request).await
        }
        Err(denied) => unauthorized(denied),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The key set of `auth` (a copy of `service.rs`'s; see the module's note)

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

    /// The verifying key, if it is held and young enough to be used without a refresh.
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

    async fn verifier(&self, kid: &str) -> Result<Arc<DecodingKey>, Denied> {
        if let Some(held) = self.fresh(kid) {
            return Ok(held);
        }
        let _one_at_a_time = self.refreshing.lock().await;
        // The refresh that we waited for may have brought it.
        if let Some(held) = self.fresh(kid) {
            return Ok(held);
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

    /// The key set, or `None` if it could not be read or is not one.
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

/// The RSA signature keys of a JWK Set, by `kid`. A key of another type, one without a `kid`, one for another
/// algorithm than RS256 or another use than signing is left out; so is a key that cannot be read. `None` only
/// when the document is not a JWK Set.
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
        if let Ok(decoding) = DecodingKey::from_rsa_components(n, e) {
            keys.insert(kid.to_owned(), Arc::new(decoding));
        }
    }
    Some(keys)
}

#[cfg(test)]
mod tests {
    use aws_lc_rs::rand::SystemRandom;
    use aws_lc_rs::rsa::{KeyPair, KeySize, PublicKeyComponents};
    use aws_lc_rs::signature::{KeyPair as _, RSA_PKCS1_SHA256};
    use base64::Engine as _;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;

    use super::*;

    const ISSUER: &str = "http://localhost:3001";
    const PERSON_AUDIENCE: &str = "operai-suite";
    const SERVICE_AUDIENCE: &str = "operai-service";

    fn b64(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_secs()
    }

    struct Signer {
        pair: KeyPair,
        kid: String,
    }

    impl Signer {
        fn new(kid: &str) -> Signer {
            Signer {
                pair: KeyPair::generate(KeySize::Rsa2048).expect("a test RSA pair"),
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

    /// The claims of a person's token as `auth` mints them (`definePayload`).
    fn claims() -> Value {
        json!({ "iss": ISSUER, "sub": "0b8e5f0c-user", "aud": PERSON_AUDIENCE,
                "email": "ada@welld.example", "name": "Ada Lovelace", "perm_epoch": 7,
                "iat": now(), "exp": now() + 300 })
    }

    /// A key-set server for the tests of the claims (the key-set logic is the copy of `service.rs`'s, which
    /// tests it in full).
    async fn serve_keys(keys: Vec<Value>) -> Url {
        use axum::{Router, routing::get};
        let app = Router::new().route(
            "/auth/jwks",
            get(move || {
                let keys = keys.clone();
                async move { json!({ "keys": keys }).to_string() }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move { axum::serve(listener, app).await });
        Url::parse(&format!("http://127.0.0.1:{port}/auth/jwks")).expect("url")
    }

    async fn auth_with(signer: &Signer) -> PersonAuth {
        let config = AuthConfig {
            issuer: Url::parse(ISSUER).expect("url"),
            jwks_url: serve_keys(vec![signer.jwk()]).await,
            base_url: Url::parse(ISSUER).expect("url"),
            audience: PERSON_AUDIENCE.to_owned(),
        };
        PersonAuth::with_timing(
            &config,
            SERVICE_AUDIENCE,
            Duration::ZERO,
            MAX_AGE,
            STALE_MAX,
        )
        .expect("client")
    }

    #[tokio::test]
    async fn a_person_credential_is_accepted_and_names_the_person() {
        let signer = Signer::new("k1");
        let auth = auth_with(&signer).await;
        let person = auth
            .verify(&signer.token(&claims()))
            .await
            .expect("a person");
        assert_eq!(
            person,
            Person {
                sub: "0b8e5f0c-user".into(),
                email: "ada@welld.example".into(),
                name: Some("Ada Lovelace".into()),
                perm_epoch: 7,
            }
        );
    }

    #[tokio::test]
    async fn the_audience_may_be_a_list_with_the_person_audience_in_it() {
        let signer = Signer::new("k1");
        let auth = auth_with(&signer).await;
        let mut c = claims();
        c["aud"] = json!(["somebody-else", PERSON_AUDIENCE]);
        assert!(auth.verify(&signer.token(&c)).await.is_ok());
    }

    #[tokio::test]
    async fn each_way_of_being_wrong_is_refused_with_its_own_cause() {
        let signer = Signer::new("k1");
        let other = Signer::new("k1");
        let auth = auth_with(&signer).await;
        let with = |name: &str, value: Value| {
            let mut c = claims();
            c[name] = value;
            signer.token(&c)
        };
        let without = |name: &str| {
            let mut c = claims();
            c.as_object_mut().expect("object").remove(name);
            signer.token(&c)
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
            // AC-3.1, the other half: a service token on a person route.
            (
                "the service audience",
                with("aud", json!(SERVICE_AUDIENCE)),
                Denied::Audience,
            ),
            (
                "both audiences",
                with("aud", json!([PERSON_AUDIENCE, SERVICE_AUDIENCE])),
                Denied::Audience,
            ),
            (
                "a service principal under the person audience",
                with("sub", json!("system:crm-api")),
                Denied::Subject,
            ),
            ("an empty sub", with("sub", json!("")), Denied::Subject),
            ("no sub", without("sub"), Denied::Malformed),
            ("no email", without("email"), Denied::Malformed),
            (
                "an empty email",
                with("email", json!("")),
                Denied::Malformed,
            ),
            (
                "an email that is not text",
                with("email", json!(5)),
                Denied::Malformed,
            ),
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
    async fn a_real_service_token_is_not_a_person() {
        let signer = Signer::new("k1");
        let auth = auth_with(&signer).await;
        let service = json!({ "iss": ISSUER, "sub": "system:letterhead-test-caller",
                              "aud": SERVICE_AUDIENCE, "scope": "letterhead:render",
                              "iat": now(), "exp": now() + 300, "jti": "1" });
        assert_eq!(
            auth.verify(&signer.token(&service)).await,
            Err(Denied::Audience)
        );
    }

    #[tokio::test]
    async fn only_rs256_with_a_known_kid_is_accepted() {
        let signer = Signer::new("k1");
        let auth = auth_with(&signer).await;
        let none = format!(
            "{}.{}.",
            b64(json!({ "alg": "none", "kid": "k1" }).to_string().as_bytes()),
            b64(claims().to_string().as_bytes())
        );
        assert_eq!(auth.verify(&none).await, Err(Denied::Malformed));
        let confused = signer.sign(
            &json!({ "alg": "HS256", "typ": "JWT", "kid": "k1" }),
            &claims(),
        );
        assert_eq!(auth.verify(&confused).await, Err(Denied::Malformed));
        let no_kid = signer.sign(&json!({ "alg": "RS256", "typ": "JWT" }), &claims());
        assert_eq!(auth.verify(&no_kid).await, Err(Denied::Malformed));
        let unknown = signer.sign(&json!({ "alg": "RS256", "kid": "k9" }), &claims());
        assert_eq!(auth.verify(&unknown).await, Err(Denied::UnknownKey));
        assert_eq!(
            auth.verify(&"a".repeat(MAX_TOKEN_BYTES + 1)).await,
            Err(Denied::Malformed)
        );
    }

    #[tokio::test]
    async fn the_name_and_the_epoch_are_read_for_what_they_are_and_never_refuse_a_token() {
        let signer = Signer::new("k1");
        let auth = auth_with(&signer).await;
        let make = |name: Option<Value>, epoch: Option<Value>| {
            let mut c = claims();
            let object = c.as_object_mut().expect("object");
            object.remove("name");
            object.remove("perm_epoch");
            if let Some(name) = name {
                object.insert("name".into(), name);
            }
            if let Some(epoch) = epoch {
                object.insert("perm_epoch".into(), epoch);
            }
            signer.token(&c)
        };

        let bare = auth.verify(&make(None, None)).await.expect("accepted");
        assert_eq!((bare.name, bare.perm_epoch), (None, 0));
        let odd = auth
            .verify(&make(Some(json!(12)), Some(json!("7"))))
            .await
            .expect("accepted");
        assert_eq!((odd.name, odd.perm_epoch), (None, 0));
        let blank = auth
            .verify(&make(Some(json!("  \t ")), None))
            .await
            .expect("accepted");
        assert_eq!(blank.name, None);
        let padded = auth
            .verify(&make(Some(json!("  Ada\u{7} Lovelace\n")), Some(json!(0))))
            .await
            .expect("accepted");
        assert_eq!(padded.name.as_deref(), Some("Ada Lovelace"));
        let long = auth
            .verify(&make(Some(json!("é".repeat(500))), None))
            .await
            .expect("accepted");
        assert_eq!(
            long.name.as_deref().map(|n| n.chars().count()),
            Some(MAX_NAME_CHARS)
        );
    }

    #[test]
    fn a_key_set_keeps_only_rsa_signature_keys_with_a_kid() {
        let signer = Signer::new("k1");
        let mut other_use = signer.jwk();
        other_use["use"] = json!("enc");
        other_use["kid"] = json!("enc-key");
        let set = json!({ "keys": [
            signer.jwk(), other_use,
            { "kty": "OKP", "crv": "Ed25519", "kid": "ed", "x": "AAAA" },
            "not an object"
        ] });
        let keys = parse_jwks(set.to_string().as_bytes()).expect("a key set");
        let names: Vec<&String> = keys.keys().collect();
        assert_eq!(names, ["k1"]);
        assert!(parse_jwks(b"not json").is_none());
    }

    #[test]
    fn the_credential_is_the_bearer_header_and_nothing_else() {
        let get = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::AUTHORIZATION,
                axum::http::HeaderValue::from_str(value).expect("header"),
            );
            bearer(&headers).map(str::to_owned)
        };
        assert_eq!(get("Bearer abc").as_deref(), Some("abc"));
        assert_eq!(get("bearer abc"), None);
        assert_eq!(get("Basic abc"), None);
        assert_eq!(bearer(&HeaderMap::new()), None);
    }
}
