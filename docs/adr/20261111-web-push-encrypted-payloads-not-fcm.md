# 20261111 — Push notifications use standard Web Push, with each payload encrypted by notify-api, not FCM

**Date:** 2026-11-11  
**Status:** Accepted (go-live signed off 2026-11-13, AC-6.5)  
**Deciders:** Matteo Codogno (owner; chose standard Web Push at the specs/20261111-push-notifications planning gate, 2026-11-11)  
**Project:** Operai  
**Relates to:** [ADR 20260714-notify-api-email-channel-service-trust](20260714-notify-api-email-channel-service-trust.md), [ADR 20261101-notify-api-resolves-email-notice-address-from-auth](20261101-notify-api-resolves-email-notice-address-from-auth.md), [ADR 20261104-meetings-ai-providers-eu-zero-retention](20261104-meetings-ai-providers-eu-zero-retention.md), [ADR 20261105-meetings-ai-providers-google-cloud-eu](20261105-meetings-ai-providers-google-cloud-eu.md), [ADR 20260607-jwt-in-memory-never-web-storage](20260607-jwt-in-memory-never-web-storage.md)

---

## Context

specs/20261111-push-notifications adds system notifications on the user's desktop (Chrome, Edge, Firefox and Safari on macOS) that arrive while Operai is closed (AC-2.1), for every notification raised for the user (AC-2.2). The push services that carry them are Google (Chrome), Microsoft (Edge), Mozilla (Firefox) and Apple (Safari), none of them EU-bound. AGENTS.md's data residency rule and ADR 20261104-meetings-ai-providers-eu-zero-retention's posture say user content must not leave the permitted jurisdiction in a readable form. The user first asked for Firebase Cloud Messaging with the full title and body. During planning on 2026-11-11 the user chose standard Web Push instead, because with FCM's HTTP v1 API the server hands the message to Google in clear.

## Decision

We will deliver push notifications as a third delivery channel of notify-api, beside `inApp` and `email`, using **standard Web Push**: RFC 8030 transport, RFC 8291 `aes128gcm` payload encryption performed by notify-api with each browser subscription's keys, and RFC 8292 VAPID, via the `web-push` library. The payload is the notification's English title and body, its origin app, a relative link and its id, and nothing else. Push is off unless `PUSH_ENABLED=true`; `PUSH_EXCLUDED_ORIGINS` excludes an origin app; notify-api POSTs only to allowlisted push-service hosts over `https`.

## Failure shape

Business content leaves our process for a third party's delivery network in a form that third party can read. The call succeeds and nothing fails, so neither end sees the leak: the API that accepts the message takes the body as plaintext, and any protection is a step someone has to remember to add. The shape recurs wherever a message is handed to an intermediary we do not run: a push or relay service, an email API, a webhook, an error reporter, a log shipper, a hosted queue. The question to ask is what that intermediary can read, not whether the call worked.

The symmetric cases are the ones that get missed:

- **Reading back.** Content a third party returns to us (delivery reports, webhook bodies, callback payloads) is the same flow in reverse and falls under the same rule as what we send.
- **Encrypted is not invisible.** Making the body unreadable to the intermediary does not stop its metadata (that a message went, to which device or account, when, how large) from crossing. A review that closes on "it is encrypted" has checked the body and not the metadata.
- **Whoever holds the key can read.** A credential or decryption key placed where the intermediary, or a client-side worker, can reach it moves the readable boundary without changing the transport. A service worker holding a long-lived token is this case.
- **Ciphertext is still a flow, and kept.** A residency rule that speaks of "content" must say whether ciphertext crossing a border counts. The intermediary may also keep ciphertext until delivery expires.

Recognise it by: a new third-party delivery call whose body is built from a notification or user field; a design that says "content stays in the EU" while the request body is plaintext; a rule about an intermediary that does not say what the intermediary can read.

## Options considered

### Option A — Standard Web Push, notify-api encrypts each payload (chosen)

**Pros:**
- Every push service carries ciphertext only (AC-6.3); only the recipient's browser can read the text
- No Google Cloud project, no Google credential and no Firebase SDK in the shell
- One mechanism for Chrome, Edge, Firefox and Safari, so no caller of `/system/notifications` changes
- The reference library does the RFC 8291 encryption

**Cons:**
- Push services still observe metadata (subscription endpoint, send time, size, the VAPID contact) and sit outside the EU
- The payload is limited to about 4 KB, so the body is truncated
- The VAPID private key is a new secret
- `web-push` on Bun is unproven (plan risk R1)

### Option B — Firebase Cloud Messaging, HTTP v1 (rejected)

**Pros:**
- A single, familiar API for Chrome delivery; the user's first choice

**Cons:**
- The server sends title and body to Google in clear, so business content reaches a processor outside the EU readable
- Needs a Firebase project, a service account credential and a new processor sign-off
- Does not reach Firefox or Safari, which use their own push services, so standard Web Push is needed for them anyway

### Option C — Content-free push; the service worker fetches the text on show (rejected)

**Pros:**
- The push itself carries no content; there is no encryption to get wrong

**Cons:**
- The service worker needs a credential to call notify-api, and ADR 20260607-jwt-in-memory-never-web-storage forbids persisting the JWT; a long-lived credential in the browser is a worse exposure than the metadata it protects
- Metadata still crosses, so the residual exposure is the same as Option A's
- The user asked for the full title and body

### Option D — Hand-written RFC 8291 encryption (rejected; kept as the fallback)

**Pros:**
- No dependency; full control of the bytes

**Cons:**
- Encryption is where hand-rolled code goes wrong (ECDH, HKDF, AES-GCM record framing), and the library is the reference implementation
- Kept as the fallback if `web-push` fails on Bun (plan R1), built on WebCrypto and `jose`, which the project already depends on

## Consequences

**Positive:**
- No push service can read business content; the readable copy exists only in notify-api's memory during the send and in the recipient's browser
- Push is a switch: off by default, with a per-origin exclusion that needs no code change
- The push-service allowlist is the only place notify-api makes a request to a client-supplied URL

**Negative / trade-offs:**
- notify-api stores each browser subscription's keys (`p256dh`, `auth`); the auth secret is never logged or returned
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are required when push is enabled; the private key is in 1Password and classed as a secret in `tools/env-doctor`
- Rotating the VAPID keys invalidates every subscription, since each was made against the old public key; each user must turn push on again in each browser (runbook in `infra/README.md`)
- The payload is capped at about 4 KB; the body is truncated with "…" so the JSON stays at or below 3 000 bytes UTF-8, and the full text is read in the notification center
- Push is always English (AC-2.5), even for a notification with an Italian variant

**Risks:**
- Push services observe metadata for every push sent (AC-6.3). This design cannot remove it; the go-live sign-off below accepts it.
- Meetings exclusion: decided 2026-11-12, none excluded (owner). `PUSH_EXCLUDED_ORIGINS` is the handle if the owner excludes it. Meetings content is the most sensitive in the suite (ADR 20261104-meetings-ai-providers-eu-zero-retention, ADR 20261105-meetings-ai-providers-google-cloud-eu).
- R1: `web-push` on Bun is checked first, by sending to a real Chrome subscription; the fallback is Option D.
- R2: Safari may revoke permission when a push arrives and nothing is shown; checked in the same spike.
- R3: Edge's push host may not match `*.notify.windows.com`; verified on real Edge, and the allowlist is one constant to correct.
- The host allowlist is the SSRF guard: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`, `https:` only. A look-alike host or an IP literal is refused with 422.

## Compliance notes

- GDPR / data-protection impact: medium. Each push service receives the subscription endpoint (a per-browser identifier), the send time, the size and the VAPID contact (`VAPID_SUBJECT`). It receives no title, body, name or email. The device label kept by notify-api describes the user's browser and is personal data.
- Data residency: needs review. Ciphertext and metadata leave the EU for push services operated outside it (Google, Microsoft, Mozilla, Apple). Content does not leave readable, which is the ADR 20261104-meetings-ai-providers-eu-zero-retention posture. The ciphertext crossing the border is an exception this ADR records, and the go-live sign-off must accept it.
- Audit trail: not required. There is no delivery log (specs/20261111-push-notifications non-goal); notify-api logs the device id and the push status only.

**Go-live sign-off (AC-6.5), required before `PUSH_ENABLED=true` in production:**

- Decision accepted: push services observe the metadata listed above for every push sent, and no content.
- **Go-live sign-off: given — Matteo Codogno, 2026-11-13.** Accepted: push services (Google, Microsoft, Mozilla, Apple) see ciphertext and delivery metadata only, never content, including outside the EU; no origin is excluded (Meetings included, `PUSH_EXCLUDED_ORIGINS` empty); security lows L2–L4 of specs/20261111-push-notifications accepted.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
