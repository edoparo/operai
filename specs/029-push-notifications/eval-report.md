---
spec: 029
evaluated: 2026-11-13
rubric: default-v2
score: 80.0
verdict: PASS
---
# Eval report: Push notifications

Previous eval: PASS 80.0 at e9aa198b (code at 1f392e0c), before T12. This report replaces it.

Evaluated at HEAD b0e348dc (branch `feat/029-push-notifications`, 63 commits over `main`), rigor production. The last code
commit is 1c722f18. Rubric `default-v2`, resolved from the plugin-bundled copy
`/Users/matteocodogno/.claude/plugins/cache/wellforge/wellforge/2.62.1/config/eval-rubric.yml`; there is no `gates/configs/` or
`.wellforge-gates/` copy and no `eval.md` override. `design.md` exists, so `design_fidelity` applies and the weight pool is 115.
T13 (the close) is open by design and is not scored against.

What changed since the previous eval:
- T12 recorded in `qe-manual.md` (6d99edc2, 5e0033ff, b91a1503, 1af41d5c, b0e348dc): browser checks A–G on Chrome, Edge,
  Firefox and Safari; go-live checks H (AC-7.7 deployed pair), I (stored hrefs, L1) and J (ADR-0084 sign-off).
- T12 found two defects. D-9 (AC-3.2, every browser): a device removed from another browser re-registered itself on its next
  load, because `reconcilePush` silently re-PUT a missing row, as plan, design and tasks had specified. D-10 (AC-4.1, Safari):
  clicking with no Operai tab opened nothing.
- Fix round (user-granted extension 4): 5015586c (D-9 fix + e2e), 4a2d3918 (comment), 1c722f18 (click hardening: same-origin
  filter, `focus()` resolving null opens a window), 816ea88a (plan/design/tasks amended for D-9). D-10 turned out to be
  Safari-on-`localhost` only and passes on the deployed preview (qe-manual.md:45-47).
- QE re-run PASS at b91a1503 (qe-report.md:611-700, commit 570dc266). Security re-review PASS WITH NOTES, 0 at medium or above
  and 3 lows decided by the user (trace `2026-11-13T15-30-00Z`, `security.notes`).
- ADR-0084 go-live sign-off given, Matteo Codogno, 2026-11-13 (`docs/adr/0084-web-push-encrypted-payloads-not-fcm.md:110`).

Verification I ran myself at HEAD:
- shell `push.test.ts`, `pushHandlers.test.ts`, `PushSettings.test.tsx`, `session.test.ts`, `pushSettingsModel`: 257/257 pass.
- I mutated 1c722f18 twice, restored with `git checkout`, and left the tree clean:
  - removing `if (!focused) return false` makes the two D-10 null/undefined cases fail;
  - reverting the same-origin filter makes the three foreign/unparseable/foreign-first cases fail.
  The new click tests are not vacuous. QE did the same for the D-9 e2e: on the pre-fix `push.ts` it fails with
  `Expected "Off", Received "On"` (qe-report.md:628).
- `git diff 1f392e0c..HEAD`: the only code changes since the previous eval are in `shell/src/lib/push.ts`,
  `shell/src/lib/pushSettingsModel.ts` (comment only) and `shell/src/sw/pushHandlers.ts`, plus their tests and one e2e. No backend
  code changed, so the backend evidence from the previous QE PASS at 1f392e0c still applies.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | All 37 ACs are met. Every row of T12 is now observed: AC-2.1 C, AC-2.3 E, AC-4.1/4.2 D, AC-5.1 F and AC-3.2 G on all four browsers, plus AC-1.1/1.2 B (qe-manual.md:15-22). D-9 is fixed (push.ts:549-552) and re-checked on every browser (qe-manual.md:53-54), with an e2e and two unit cases. D-10 passes on the deployed preview (qe-manual.md:19, 45-47). AC-6.5 is signed off with owner and date (ADR-0084:110). AC-7.7 passes on the deployed pair (row H, qe-manual.md:63) on top of the T17/T18 capacity tests. **Thin:** (1) AC-4.1 on Chrome, Edge and Firefox was observed at 15:04 (6d99edc2), before 1c722f18 (17:34) changed the click path. QE named this re-check as a residual risk (qe-report.md:658-661), and only Safari's background tab was re-run (1af41d5c). (2) Row H is a bare checkmark: no notification count and no log excerpt, and the earlier QE live run raised 40 notifications, under the AC's 100. (3) T12's done-when asked for the four browsers "on a deployed preview" (tasks.md:115), but Chrome, Edge and Firefox ran on the local dev stack (qe-manual.md:24). |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | The D-9 fix moves the code toward the spec: AC-3.2 now holds after a reload. The contract change was made through the drift rule (816ea88a amends plan.md § reconciliation, the AC-1.7 test row, R7, design.md and T8's done-when), and the trace records it in `drift_events`. 1c722f18 is hardening inside the existing click contract and adds no scope. **Residual extras, unchanged since the previous eval:** the projects-ui router pin and its changeset, the router check in `scripts/check-react-skew.mjs` / `react-skew.yml`, `shell/e2e/tool-entry.spec.ts` (all from 710db1d1), and e147e7c1 (`notify-api/.envrc`, no task). None changes a 029 contract. The trace does not record that the user re-approved the D-9 plan amendment, only that the extension round was granted. |
| Test quality | 20 | 4 | 3 | 16.0 | The core is as strong as before: the aes128gcm wire body is decrypted and holds no plaintext; log hygiene is asserted; the suite-capacity contract test fails on the pre-US-7 routers; the device cap is tested on real Postgres; the 429s are byte-identical. New this round: the D-9 e2e (`push-notifications.spec.ts`, 5015586c) asserts both the UI (`Off`, `No devices yet`) and the server (`listServerDevices` stays 0), and fails on the old code. The six new click cases (`pushHandlers.test.ts:286-333`) cover null/undefined `focus()`, foreign origin, unparseable url, a failing `matchAll` and foreign-first, and survive the mutations above. **Gaps:** the old unit test asserted the D-9 bug itself, because it was written to the plan, so only a human caught D-9. Browser delivery and service-worker behaviour are still tested only against fakes; that is inherent, and T12 is the substitute. |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | The D-9 change is a net deletion: a 13-line re-register branch becomes 3 lines (push.ts:549-552), with a comment stating the invariant ("Only the user's own Turn on registers a device"). `registerDevice` now has a single caller, the user-initiated enable (qe-report.md:640). `focusExistingWindow`/`isSameOrigin` (pushHandlers.ts:148-180) are small, never throw and fail toward opening a window. The same-origin filter is a strict security improvement (never focuses or posts to a foreign client). **Nits:** `initPush` still discards `onBeforeSignOut`'s unregister function (push.ts:593). Documented lows: notifications already shown are not closed on sign-out (follow-up bugfix), the cross-tab Turn on race (accepted), the empty `operai-push` database after release (accepted), and the per-process limiter (R17). |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | `design.md` is approved and complete (flows F1–F10, states table, reuse 12/0 new, a11y). It was amended for D-9 (the boot re-PUT and its failure state are gone, design.md "Amended 2026-11-13"). The OS-notification surface is now observed on all four browsers: English text with correct accents (C), the click target (D), no notification with a visible tab, and always shown on Safari (E). **Thin:** the design's raster icon (`/push-icon.png`, G5, design.md:116, 395) is not recorded on any browser, although T12's done-when lists "PNG icon renders" (tasks.md:115). The design specified the D-9 bug (silent re-PUT) and was approved after implementation (4404c06b). |
| Trajectory | 10 | 4 | 2 | 8.0 | Three orchestrate traces and one eval trace, all `wellforge-run/v3`. The third trace (`2026-11-13T15-30-00Z`) records architect 816ea88a → frontend-dev 5015586c/4a2d3918/1c722f18 → main-loop 5e0033ff/b91a1503 → QE PASS 570dc266 → owasp PASS WITH NOTES, plus the D-9 drift event, the env faults (Safari stale permission, E-2 ports) and extension round 4 granted 2026-11-13. Every cited commit exists. Verification was never skipped. **Not 5:** the fix cap of 2 was exceeded twice, both times with a recorded user extension. The last trace ends `result: partial` at 19:20, and the commits that closed D-10 and T12 (1af41d5c, b0e348dc) are in no trace. `rigor_recorded` is null. Inherited: trace 1 was written after the fact, and the design gate passed after implementation. |
| **Total** | | | | **92 / 115 = 80.0/100** | |

**Verdict: PASS.** The weighted total is 80.0, which equals `pass_score` 80, and every applicable dimension is at or above its
floor. AC satisfaction is exactly at its floor of 4. Nothing failed.

## Findings

- **AC satisfaction (4, not the 5 the previous eval projected).** That projection assumed T12 would be all green with no
  defect. T12 found D-9 and D-10, and the click fix (1c722f18) landed after the Chrome, Edge and Firefox click checks. Three
  things lift this to 5, and none needs code:
  1. Re-run check D (click with no tab, and with a background tab) on Chrome, Edge and Firefox at or after 1c722f18, ideally on
     the deployed preview, and record it in `qe-manual.md`.
  2. Add row H's figures: how many notifications were raised in what window, and the auth and notify-api log greps showing no
     refusal.
  3. Remove the stale "D-7 check (A) still to do on Safari" line (qe-manual.md:26), which contradicts row A.

  Owner: Matteo Codogno (human T12 record).
- **Spec fidelity (4).** Unchanged. The router remnants (pin, skew guard, `tool-entry.spec.ts`) belong to the separate router
  spec, and e147e7c1 should be named in a task. Optionally, note in the trace that the user accepted 816ea88a's plan
  amendment. Owner: architect / main loop.
- **Test quality (4).** D-9 shows that a test written to the plan cannot catch a plan that contradicts an AC. For the
  reconcile and device paths, add one e2e per AC that crosses two sessions; the D-9 e2e is that shape. Owner: frontend-dev,
  later work.
- **Code quality (4).** Keep or comment the unregister function from `onBeforeSignOut` in `initPush`. Close already-shown
  notifications on sign-out in the follow-up bugfix the user decided on. Revisit the per-process limiter before a second
  `auth` replica. Owner: frontend-dev / backend-dev, follow-up.
- **Design fidelity (4).** Record the icon rendering on each browser; this goes to 5 together with the AC re-check above.
  Owner: Matteo Codogno.
- **Trajectory (4).** Append the D-10 deployed-preview result and T12 completion to the trace, or let the close run's trace
  cover them, and set `rigor_recorded`. Owner: main loop at T13.

**With the cheap fixes above recorded** (D re-check on three browsers, row H figures, icon row): AC satisfaction 5 (+7.0) and
design fidelity 5 (+3.0) give 102/115 = **88.7**.

## Recommended next step

- **PASS. The spec may move to `done`**: T13, `/wellforge:done 029-push-notifications`. No task goes back through
  `/wellforge:implement`.
- The score sits exactly at the bar. Before or right after the close, I recommend the three `qe-manual.md` additions under
  AC satisfaction. They take minutes and remove the only evidence gaps.
- Follow-ups outside 029: the router spec (pin, skew guard, `remote-history.spec.ts`); the bugfix that closes shown
  notifications on sign-out; the E-2 port map in `remote-failure.spec.ts`.
