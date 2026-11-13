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
| A. No `operai-push` database before turning push on (D-7) | — | ✅ | ✅ | ✅ | pending (console check) |
| B. No permission prompt on load; Turn on → On + "This browser" row | AC-1.1, 1.2 | ✅ | ✅ | ✅ | ✅ (T1 spike) |
| B. Endpoint host accepted by the allowlist (R3) | AC-6.3 | ✅ | ✅ (Edge host accepted; exact host not recorded) | ✅ | ✅ `web.push.apple.com` |
| C. Notification shown with Operai closed, within ~30 s, text/accents correct | AC-2.1 | ✅ | ✅ | ✅ | ✅ (T1 spike) |
| D. Click opens `/notify` (new tab) / focuses the background tab | AC-4.1, 4.2 | ✅ | ✅ | ✅ | background tab ✅ · no tab ❌ **D-10** |
| E. No system notification with Operai visible; after 3 suppressed pushes delivery still works | AC-2.3 | ✅ | ✅ | ✅ | shows with Operai visible ✅ (expected, ADR-0085) |
| F. No push after explicit sign-out | AC-5.1 | ✅ | ✅ | ✅ | ✅ |
| G. Removing the device from another browser stops pushes | AC-3.2 | ✅* | ✅* | ✅* | ❌ **D-9** |

Verified by: Matteo Codogno, 2026-11-13, local dev stack (Chrome, Edge, Firefox).
Safari: verified by Matteo Codogno, 2026-11-11, T1 spike bench (delivery, click, Safari
always-show behaviour); D-7 check (A) still to do on Safari.

Safari run: Matteo Codogno, 2026-11-13, local dev stack (Safari, macOS). The site was first
shown as Blocked because `Notification.permission` was `denied` (stale permission from the T1
bench); resolved in Safari/macOS settings — the Blocked state itself behaved as designed.

Defects found on Safari (fix-round extension granted by the user, 2026-11-13):
- **D-9 (AC-3.2, all browsers):** a device removed from another browser re-registers itself on
  the removed browser's next load — `reconcilePush` silently re-PUT a subscription whose row was
  missing. *G passed on Chrome/Edge/Firefox only because the removed browser was not reloaded
  afterwards; G must be re-run on every browser after the fix.
- **D-10 (AC-4.1, Safari):** with no Operai tab open, clicking the push does not open Operai
  (with a background tab it focuses and navigates correctly).

Note: an initial Chrome failure (`getSubscription()` null) was an operator error, not a
product defect; the Chrome run was repeated and passed.

## Go-live checks (before `PUSH_ENABLED=true` in production)

| Check | Ref | Status |
|---|---|---|
| H. AC-7.7 on the deployed pair: auth deployed before notify-api, startup line `[system] limits per 600000 ms: …`, retired `SERVICE_TOKEN_RATE_*` removed; > 100 notifications in 10 min with no `allowance exhausted` / `invalid-credential limit reached` in auth and no `HTTP 429` in notify-api | AC-7.7, R11 | pending |
| I. No stored `notification.link.href` in production fails the new `isRelativeSuitePath` guard | security L1 | pending |
| J. ADR-0084 go-live sign-off: owner + date, no origin excluded, L2–L4 accepted, push services see metadata only | AC-6.5 | pending |
