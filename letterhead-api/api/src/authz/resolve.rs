//! The client of `auth`'s `GET /authz/resolve` and its cache (task T14; AC-8.1, AC-8.2).
//!
//! The port of `crm-api/src/authz/resolveClient.ts` and the cache half of `crm-api/src/auth/authz.middleware.ts`
//! (ADR 20260716-refund-api-authorization-enforcing-resource-server):
//!
//! - the caller's **own** already-verified bearer token is forwarded as it came; no credential of ours is
//!   introduced and nobody else's permissions can be asked for;
//! - the answer is cached per `(sub, perm_epoch)` for [`TTL`] at most. A change of the person's grants bumps
//!   `perm_epoch` in the next token they get (a cache miss), and the hard TTL bounds how long a token that
//!   was issued before the change keeps the old answer: a withdrawn grant acts within 30 s;
//! - **fail closed**: an `auth` that cannot be reached, answers with anything but 2xx, or answers with a body
//!   that is not a permission set, is [`Unavailable`] (the routes turn it into 503). It is never "allow", and a
//!   cache entry past its TTL is never used to paper over the outage;
//! - the token goes to `AUTH_BASE_URL` and nowhere else: a redirect is not followed.
//!
//! Nothing of the answer or the token is written anywhere. The log gets [`Unavailable::cause`], a closed word.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use reqwest::header::AUTHORIZATION;
use serde::Deserialize;
use url::Url;

use super::scope::Permission;

/// How long an answer is used without asking again.
pub const TTL: Duration = Duration::from_secs(30);
/// A hung `auth` must become the 503, not a hung request.
const TIMEOUT: Duration = Duration::from_secs(5);
/// A person's permission set is a few hundred bytes; an answer past this is not one.
const MAX_BODY_BYTES: usize = 256 * 1024;
/// Entries past which expired ones are swept out on the next insert.
const SWEEP_AT: usize = 1_000;
/// Entries past which nothing more is cached (the answer is still used for its request). Only a verified token
/// reaches the cache, so this is a bound on the people of the suite and their epochs, not a defence.
const MAX_ENTRIES: usize = 10_000;

/// What `auth` says a caller may do: the grants and the caller's own entity, a resource server's whole need.
#[derive(Debug, Clone, Deserialize)]
pub struct Resolved {
    pub sub: String,
    pub permissions: Vec<Permission>,
    /// The caller's own entity attribute, for `{ key: "entity", match: "user" }`.
    #[serde(default)]
    pub entity: Option<String>,
}

/// Why no answer could be had. The caller of a route sees one 503; the log gets the cause.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unavailable {
    /// `auth` did not answer in time.
    Timeout,
    /// `auth` could not be reached, or the connection broke.
    Network,
    /// Any answer that is not 2xx (a 3xx is not followed).
    Status(u16),
    /// A 2xx whose body is not a permission set of this caller.
    Body,
}

impl Unavailable {
    pub fn cause(self) -> &'static str {
        match self {
            Unavailable::Timeout => "timeout",
            Unavailable::Network => "network",
            Unavailable::Status(_) => "status",
            Unavailable::Body => "body",
        }
    }
}

impl fmt::Display for Unavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Unavailable::Status(code) => write!(f, "status {code}"),
            other => f.write_str(other.cause()),
        }
    }
}

struct Entry {
    resolved: Arc<Resolved>,
    expires: Instant,
}

pub struct AuthzClient {
    url: Url,
    http: reqwest::Client,
    ttl: Duration,
    /// Keyed by the pair itself, not by a joined string: no two pairs can collide.
    cache: Mutex<HashMap<(String, i64), Entry>>,
}

impl AuthzClient {
    /// `base` is `AUTH_BASE_URL`.
    pub fn new(base: &Url) -> Result<AuthzClient, reqwest::Error> {
        AuthzClient::with_timing(base, TTL, TIMEOUT)
    }

    fn with_timing(
        base: &Url,
        ttl: Duration,
        timeout: Duration,
    ) -> Result<AuthzClient, reqwest::Error> {
        // `${AUTH_BASE_URL}/authz/resolve`, whatever the trailing slash of the base.
        let joined = format!("{}/authz/resolve", base.as_str().trim_end_matches('/'));
        // The base was validated at startup as an http(s) URL; this only appends a path.
        let url = Url::parse(&joined).unwrap_or_else(|_| base.clone());
        let http = reqwest::Client::builder()
            .timeout(timeout)
            // The caller's token must go to the configured address and nowhere else.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("letterhead-api")
            .build()?;
        Ok(AuthzClient {
            url,
            http,
            ttl,
            cache: Mutex::new(HashMap::new()),
        })
    }

    fn cache(&self) -> MutexGuard<'_, HashMap<(String, i64), Entry>> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The caller's permissions: from the cache while the entry for `(sub, perm_epoch)` is younger than the TTL,
    /// else from `auth`, asked with `token` (the caller's own, which the caller's route has already verified).
    pub async fn resolve(
        &self,
        sub: &str,
        perm_epoch: i64,
        token: &str,
    ) -> Result<Arc<Resolved>, Unavailable> {
        let key = (sub.to_owned(), perm_epoch);
        let now = Instant::now();
        if let Some(entry) = self.cache().get(&key)
            && entry.expires > now
        {
            return Ok(Arc::clone(&entry.resolved));
        }

        let resolved = Arc::new(self.ask(sub, token).await?);

        let mut cache = self.cache();
        if cache.len() >= SWEEP_AT {
            let now = Instant::now();
            cache.retain(|_, entry| entry.expires > now);
        }
        if cache.len() < MAX_ENTRIES || cache.contains_key(&key) {
            cache.insert(
                key,
                Entry {
                    resolved: Arc::clone(&resolved),
                    expires: Instant::now() + self.ttl,
                },
            );
        }
        Ok(resolved)
    }

    async fn ask(&self, sub: &str, token: &str) -> Result<Resolved, Unavailable> {
        let mut response = self
            .http
            .get(self.url.clone())
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await
            .map_err(failure)?;
        let status = response.status();
        if !status.is_success() {
            return Err(Unavailable::Status(status.as_u16()));
        }
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(failure)? {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(Unavailable::Body);
            }
            body.extend_from_slice(&chunk);
        }
        // A 2xx that is not a permission set is an outage, not an empty set of grants. The answer is the
        // caller's own, so its `sub` is the token's: anything else is not what was asked for.
        let resolved: Resolved = serde_json::from_slice(&body).map_err(|_| Unavailable::Body)?;
        if resolved.sub != sub {
            return Err(Unavailable::Body);
        }
        Ok(resolved)
    }
}

fn failure(error: reqwest::Error) -> Unavailable {
    if error.is_timeout() {
        Unavailable::Timeout
    } else {
        Unavailable::Network
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::{
        Router,
        http::{HeaderMap, StatusCode, header},
        response::{IntoResponse, Redirect},
        routing::get,
    };
    use serde_json::json;

    use super::*;
    use crate::authz::scope::{Conditions, has_capability};

    /// A fake `auth`: the answer can be changed, and what it was asked is recorded.
    struct Fake {
        base: Url,
        status: Arc<Mutex<u16>>,
        body: Arc<Mutex<String>>,
        hits: Arc<AtomicUsize>,
        seen: Arc<Mutex<Vec<String>>>,
        elsewhere: Arc<AtomicUsize>,
    }

    fn answer(sub: &str) -> String {
        json!({ "sub": sub, "epoch": 3, "entity": "welld_it", "jobTitle": null,
                "permissions": [
                    { "resource": "letterheads", "action": "access", "conditions": null },
                    { "resource": "letterhead", "action": "manage",
                      "conditions": { "attributes": [{ "key": "entity", "match": "user" }] } }
                ] })
        .to_string()
    }

    impl Fake {
        async fn start(sub: &str) -> Fake {
            let status = Arc::new(Mutex::new(200u16));
            let body = Arc::new(Mutex::new(answer(sub)));
            let hits = Arc::new(AtomicUsize::new(0));
            let seen = Arc::new(Mutex::new(Vec::new()));
            let elsewhere = Arc::new(AtomicUsize::new(0));
            let (s, b, h, v, e) = (
                Arc::clone(&status),
                Arc::clone(&body),
                Arc::clone(&hits),
                Arc::clone(&seen),
                Arc::clone(&elsewhere),
            );
            let app = Router::new()
                .route(
                    "/authz/resolve",
                    get(move |headers: HeaderMap| {
                        let (s, b, h, v) = (
                            Arc::clone(&s),
                            Arc::clone(&b),
                            Arc::clone(&h),
                            Arc::clone(&v),
                        );
                        async move {
                            h.fetch_add(1, Ordering::SeqCst);
                            let auth = headers
                                .get(header::AUTHORIZATION)
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                                .to_owned();
                            v.lock().expect("lock").push(auth);
                            let code = *s.lock().expect("lock");
                            if code == 302 {
                                return Redirect::temporary("/elsewhere").into_response();
                            }
                            (
                                StatusCode::from_u16(code).expect("status"),
                                b.lock().expect("lock").clone(),
                            )
                                .into_response()
                        }
                    }),
                )
                .route(
                    "/elsewhere",
                    get(move || {
                        let e = Arc::clone(&e);
                        async move {
                            e.fetch_add(1, Ordering::SeqCst);
                            "{}"
                        }
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind");
            let port = listener.local_addr().expect("addr").port();
            tokio::spawn(async move { axum::serve(listener, app).await });
            Fake {
                base: Url::parse(&format!("http://127.0.0.1:{port}")).expect("url"),
                status,
                body,
                hits,
                seen,
                elsewhere,
            }
        }

        fn fail_with(&self, status: u16) {
            *self.status.lock().expect("lock") = status;
        }

        fn say(&self, body: &str) {
            *self.body.lock().expect("lock") = body.to_owned();
        }

        fn hits(&self) -> usize {
            self.hits.load(Ordering::SeqCst)
        }

        fn client(&self, ttl: Duration) -> AuthzClient {
            AuthzClient::with_timing(&self.base, ttl, Duration::from_secs(2)).expect("client")
        }
    }

    #[tokio::test]
    async fn an_answer_is_read_and_the_callers_own_token_is_what_is_sent() {
        let fake = Fake::start("u-1").await;
        let resolved = fake
            .client(TTL)
            .resolve("u-1", 3, "tok.en")
            .await
            .expect("answer");
        assert_eq!(resolved.sub, "u-1");
        assert_eq!(resolved.entity.as_deref(), Some("welld_it"));
        assert!(has_capability(
            &resolved.permissions,
            "letterheads",
            "access"
        ));
        assert!(matches!(
            resolved.permissions[0].conditions,
            Conditions::Unconditioned
        ));
        assert_eq!(*fake.seen.lock().expect("lock"), ["Bearer tok.en"]);
    }

    #[tokio::test]
    async fn the_answer_is_kept_per_sub_and_epoch_and_asked_for_again_only_when_one_changes() {
        let fake = Fake::start("u-1").await;
        let client = fake.client(TTL);
        client.resolve("u-1", 3, "t").await.expect("first");
        client.resolve("u-1", 3, "t").await.expect("second");
        assert_eq!(fake.hits(), 1, "the second request is from the cache");

        // A new epoch is a new person-state: a miss.
        client.resolve("u-1", 4, "t").await.expect("new epoch");
        assert_eq!(fake.hits(), 2);

        // The pair is the key, not a joined string: ("u-1", 34) is not ("u-13", 4).
        fake.say(&answer("u-13"));
        client.resolve("u-13", 4, "t").await.expect("another sub");
        assert_eq!(fake.hits(), 3);
        fake.say(&answer("u-1"));
        client.resolve("u-1", 34, "t").await.expect("another pair");
        assert_eq!(fake.hits(), 4);
    }

    #[tokio::test]
    async fn an_entry_past_its_ttl_is_asked_for_again_and_never_served_in_an_outage() {
        let fake = Fake::start("u-1").await;
        let client = fake.client(Duration::from_millis(80));
        client.resolve("u-1", 3, "t").await.expect("first");
        tokio::time::sleep(Duration::from_millis(120)).await;
        client.resolve("u-1", 3, "t").await.expect("after the ttl");
        assert_eq!(fake.hits(), 2);

        fake.fail_with(503);
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(
            client.resolve("u-1", 3, "t").await.err(),
            Some(Unavailable::Status(503)),
            "the stale entry does not cover for an outage"
        );
    }

    #[tokio::test]
    async fn a_failure_is_not_cached() {
        let fake = Fake::start("u-1").await;
        let client = fake.client(TTL);
        fake.fail_with(500);
        assert_eq!(
            client.resolve("u-1", 3, "t").await.err(),
            Some(Unavailable::Status(500))
        );
        fake.fail_with(200);
        client
            .resolve("u-1", 3, "t")
            .await
            .expect("recovered at once");
        assert_eq!(fake.hits(), 2);
    }

    #[tokio::test]
    async fn anything_that_is_not_a_permission_set_of_the_caller_is_an_outage() {
        let fake = Fake::start("u-1").await;
        let client = fake.client(TTL);
        for (what, body) in [
            ("not json", "nope".to_owned()),
            ("an empty object", "{}".to_owned()),
            ("no permissions", json!({ "sub": "u-1" }).to_string()),
            (
                "permissions that is not a list",
                json!({ "sub": "u-1", "permissions": {} }).to_string(),
            ),
            (
                "an entity that is a number",
                json!({ "sub": "u-1", "permissions": [], "entity": 4 }).to_string(),
            ),
            (
                "a grant without an action",
                json!({ "sub": "u-1", "permissions": [{ "resource": "x" }] }).to_string(),
            ),
            (
                "another person's answer",
                json!({ "sub": "u-2", "permissions": [] }).to_string(),
            ),
        ] {
            fake.say(&body);
            assert_eq!(
                client.resolve("u-1", 3, "t").await.err(),
                Some(Unavailable::Body),
                "{what}"
            );
        }
        // And an answer that is a set, with no grants and no entity, is a person who may do nothing, not an outage.
        fake.say(
            &json!({ "sub": "u-1", "epoch": 1, "permissions": [], "entity": null }).to_string(),
        );
        let nothing = client.resolve("u-1", 3, "t").await.expect("an empty set");
        assert!(nothing.permissions.is_empty() && nothing.entity.is_none());
    }

    #[tokio::test]
    async fn an_answer_larger_than_a_permission_set_can_be_is_refused() {
        let fake = Fake::start("u-1").await;
        let filler = "x".repeat(MAX_BODY_BYTES + 1);
        fake.say(&json!({ "sub": "u-1", "permissions": [], "entity": filler }).to_string());
        assert_eq!(
            fake.client(TTL).resolve("u-1", 3, "t").await.err(),
            Some(Unavailable::Body)
        );
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed_so_the_token_goes_nowhere_else() {
        let fake = Fake::start("u-1").await;
        fake.fail_with(302);
        assert_eq!(
            fake.client(TTL)
                .resolve("u-1", 3, "secret-token")
                .await
                .err(),
            Some(Unavailable::Status(307))
        );
        assert_eq!(fake.elsewhere.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_auth_that_is_down_or_too_slow_is_an_outage() {
        let base = {
            let free = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            let port = free.local_addr().expect("addr").port();
            Url::parse(&format!("http://127.0.0.1:{port}")).expect("url")
        };
        let down = AuthzClient::with_timing(&base, TTL, Duration::from_secs(2)).expect("client");
        assert_eq!(
            down.resolve("u-1", 3, "t").await.err(),
            Some(Unavailable::Network)
        );

        // Accepts and never answers.
        let silent = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let port = silent.local_addr().expect("addr").port();
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((stream, _)) = silent.accept().await {
                held.push(stream);
            }
        });
        let slow = AuthzClient::with_timing(
            &Url::parse(&format!("http://127.0.0.1:{port}")).expect("url"),
            TTL,
            Duration::from_millis(200),
        )
        .expect("client");
        assert_eq!(
            slow.resolve("u-1", 3, "t").await.err(),
            Some(Unavailable::Timeout)
        );
    }

    #[test]
    fn the_resolve_address_is_the_base_with_the_path_whatever_its_trailing_slash() {
        for base in [
            "http://auth:3001",
            "http://auth:3001/",
            "http://auth:3001//",
        ] {
            let client = AuthzClient::new(&Url::parse(base).expect("url")).expect("client");
            assert_eq!(
                client.url.as_str(),
                "http://auth:3001/authz/resolve",
                "{base}"
            );
        }
        let nested =
            AuthzClient::new(&Url::parse("https://x.example/auth/").expect("url")).expect("client");
        assert_eq!(nested.url.as_str(), "https://x.example/auth/authz/resolve");
    }

    #[test]
    fn the_cause_is_a_closed_word_and_the_status_is_a_number() {
        assert_eq!(Unavailable::Timeout.cause(), "timeout");
        assert_eq!(Unavailable::Network.cause(), "network");
        assert_eq!(Unavailable::Status(502).cause(), "status");
        assert_eq!(Unavailable::Body.cause(), "body");
        assert_eq!(Unavailable::Status(502).to_string(), "status 502");
    }
}
