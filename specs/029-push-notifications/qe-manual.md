# QE manual — T12 go-live checks (specs/029)

Human checks that cannot be automated here. Each row records who performed it and when
(rigor-tiers: "a check a human performed is evidence").

Environment: local dev stack (`mise run dev`, notify-api with `PUSH_ENABLED=true`), macOS,
browsers installed with `brew install --cask google-chrome microsoft-edge firefox`, OS
notifications allowed per browser, Focus off. Notifications triggered with a self-raise
(`POST /notifications`) after a delay so that Operai could be closed.

## Browser checks (A–G)

| Check | AC | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|---|
| A. No `operai-push` database before turning push on (D-7) | — | ✅ | ✅ | ✅ | pending |
| B. No permission prompt on load; Turn on → On + "This browser" row | AC-1.1, 1.2 | ✅ | ✅ | ✅ | ✅ (T1 spike) |
| B. Endpoint host accepted by the allowlist (R3) | AC-6.3 | ✅ | ✅ (Edge host accepted; exact host not recorded) | ✅ | ✅ `web.push.apple.com` |
| C. Notification shown with Operai closed, within ~30 s, text/accents correct | AC-2.1 | ✅ | ✅ | ✅ | ✅ (T1 spike) |
| D. Click opens `/notify` (new tab) / focuses the background tab | AC-4.1, 4.2 | ✅ | ✅ | ✅ | ✅ (T1 spike) |
| E. No system notification with Operai visible; after 3 suppressed pushes delivery still works | AC-2.3 | ✅ | ✅ | ✅ | n/a — always shows (ADR-0085) |
| F. No push after explicit sign-out | AC-5.1 | ✅ | ✅ | ✅ | — |
| G. Removing the device from another browser stops pushes | AC-3.2 | ✅ | ✅ | ✅ | — |

Verified by: Matteo Codogno, 2026-11-13, local dev stack (Chrome, Edge, Firefox).
Safari: verified by Matteo Codogno, 2026-11-11, T1 spike bench (delivery, click, Safari
always-show behaviour); D-7 check (A) still to do on Safari.

Note: an initial Chrome failure (`getSubscription()` null) was an operator error, not a
product defect; the Chrome run was repeated and passed.

## Go-live checks (before `PUSH_ENABLED=true` in production)

| Check | Ref | Status |
|---|---|---|
| H. AC-7.7 on the deployed pair: auth deployed before notify-api, startup line `[system] limits per 600000 ms: …`, retired `SERVICE_TOKEN_RATE_*` removed; > 100 notifications in 10 min with no `allowance exhausted` / `invalid-credential limit reached` in auth and no `HTTP 429` in notify-api | AC-7.7, R11 | pending |
| I. No stored `notification.link.href` in production fails the new `isRelativeSuitePath` guard | security L1 | pending |
| J. ADR-0084 go-live sign-off: owner + date, no origin excluded, L2–L4 accepted, push services see metadata only | AC-6.5 | pending |
