---
spec: 029
evaluated: 2026-11-13
rubric: default-v2
score: 80.0
verdict: PASS
---
# Eval report: Push notifications

Previous eval: FAIL 73.0 at 5ee89091. All floors were met. The shortfall was: no run trace (trajectory 2), router scope added in
every remote (spec fidelity 3), and T12 still open.

What changed since then:
- Two `wellforge-run/v3` traces now exist (`.forge/runs/2026-11-11T16-39-32Z-…` and `2026-11-12T15-46-14Z-…-029-push-notifications.json`).
- `design.md` is `status: approved` (4404c06b).
- The router alignment and every router-lifecycle change were reverted out of 029 (710db1d1 reverts 86496298, 85fcb037, 9b394e13 and
  64722e10). The user decided this split at the escalation after extension round 3. E-1 is fixed by pinning projects-ui to
  `@tanstack/react-router` 1.170.17, which every other frontend already uses.
- D-7 is fixed (1f392e0c).
- QE PASS at 1f392e0c: full sweep, whole e2e suite 115/0.
- Security: final owasp review PASS with lows.

Evaluated at HEAD e9aa198b (branch `feat/029-push-notifications`, 50 commits over `main`), rigor production. The last code commit is
1f392e0c. Rubric: `default-v2`, resolved from the plugin-bundled copy
`/Users/matteocodogno/.claude/plugins/cache/wellforge/wellforge/2.62.1/config/eval-rubric.yml`. There is no `gates/configs/` or
`.wellforge-gates/` copy in this repo, and no `eval.md` override. `design.md` exists, so `design_fidelity` applies and the weight pool is 115.

Verification evidence used:
- `qe-report.md`: "QE verdict: PASS (post-split verification, measured at 1f392e0c)". The auth suite ran 842/0, notify-api 538/0, shell
  589, every other frontend green, and the whole e2e suite 115/0/0 flaky. The D-7 checks ran in real Chromium.
- I re-ran these myself at HEAD:
  - `shell` `push.test.ts`, `PushSettings.test.tsx`, `pushHandlers.test.ts` and `session.test.ts`: 250/250 passing.
  - `scripts/check-react-skew.test.mjs`: 10/10 passing.
  - `scripts/check-react-skew.mjs`: OK, one router version (1.170.17) across 10 frontends.
- I checked every commit hash cited in the two traces against `git log`. All exist, with the task id the trace gives.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | 37 of 37 ACs have an executed passing check at 1f392e0c (qe-report § "AC sweep (37 ACs)" plus the AC-to-test map). Live evidence: AC-1.1–1.8 states in real Chromium (§ Live, `states6.txt`, including AC-1.7 after an explicit sign-out); AC-4.3 by e2e; the D-1/AC-7.x dev-stack sanity check (45 × 200 mints, 40 notifications whose 40 inactive lookups pruned 40 devices with no 429). **Thin:** real OS delivery, suppression and the click (AC-2.1, 2.3, 4.1) have been observed only on Safari (T1 spike, 2026-11-11). Chrome, Edge and Firefox are covered by fakes (`push.channel.test.ts` decrypts the aes128gcm record; `pushHandlers.test.ts`). AC-6.5 is still "Go-live sign-off: pending — owner Matteo Codogno" (`docs/adr/0084-…md:108`). It is not violated, because push is off by default (AC-6.1). AC-7.7 has not been re-measured on the deployed pair. `qe-manual.md` does not exist yet. |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | The router scope is gone. `git diff main...HEAD` over all nine remotes and `operai-ui` touches only `projects-ui/package.json` (`^1.168.2` → `1.170.17`) and its lockfile. Contracts match the plan: payload keys `v,id,title,body,originApp,href`; verify, then one count; 300/600/20. All amendments are recorded in the spec and in both traces' `drift_events`. **Residual extras, none tied to an AC:** the projects-ui pin, which is documented as E-1 with its own changeset (`.changeset/projects-ui-router-pin.md`); the router check added to `scripts/check-react-skew.mjs` and `react-skew.yml`; `shell/e2e/tool-entry.spec.ts`; and e147e7c1 (dev `.envrc` wiring outside any task). None changes a feature contract. The pin realigns one app to the suite-wide version, and QE showed the rest of the tree is identical to `main` (§ D-6 classification). |
| Test quality | 20 | 4 | 3 | 16.0 | Strong core tests. The wire bytes are decrypted and checked to hold no plaintext. There is a log-hygiene assertion, and a suite-capacity contract test shown to fail on the pre-US-7 routers. The device-cap concurrency test runs on real Postgres. The 429s are byte-identical. D-7 has four new cases (`push.test.ts`, 1f392e0c): no database at boot, the aborted-upgrade fallback, release without a database, and Turn on creating the database. They assert that `databases()` is empty and that `exists` is false, so they would fail if `openStore(true)` came back on the read paths. **Gaps:** browser delivery and service-worker behaviour are tested only against fake `PushManager`/`ServiceWorkerGlobalScope`. The D-7 tests use a fake IndexedDB; only Chromium was checked live. D-1, D-4 and D-7 all escaped the suites that existed when each was introduced: D-7 came from T8 and was caught only by the whole-suite e2e in a later QE round. The QE-written `remote-history.spec.ts` was not committed (it now belongs to the router spec). |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | Idiomatic Effect plus RFC 7807 problems, and env validated with exit 1. Push is best effort and never awaited. Fan-out is bounded by a pool of 16. The activity memo is single-flight. There is one `tooManyRequests` builder. The sign-out hook is bounded to 2 s. The D-7 fix is small and well reasoned (`push.ts:166-217`): `databases()` where it exists, otherwise the version-change transaction is aborted so the new database is discarded, and only `writeStored` passes `create: true`. **Nits:** `initPush` still discards `onBeforeSignOut`'s unregister function (`push.ts:600`). That is safe only because the Set dedupes the same function and `ShellLayout` calls it once. The limiters are per process (R17, documented). Security lows L1 (moved to T12), L2–L4 (accepted) and the post-split two-tab boot race (fails toward off) are recorded in the trace. |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | `design.md` is `status: approved` (2026-11-12) and complete: flows F1–F10, a screens-and-states table, a reuse inventory (12 reused, 0 new) and an a11y section. QE reached every designed state live with the designed copy (§ Live "/account push section, all designed states"). It also checked `alertdialog` focus and Escape return, focus after retry and after failures, and 0 px horizontal overflow at 360 px and 320 px (O-1 no longer shows on the section). `operai-ui` is untouched. **Thin:** the design's second surface, the OS notification's content rules (title/body, `lang: 'en'`, `/push-icon.png`, tag = id, click target), has been observed only on Safari. On the other three browsers it is unit-tested only. The design was approved after implementation, not before T7–T9 (trace 1: "design.md (draft, ungated)"; approval commit 4404c06b at 11-12 16:51). |
| Trajectory | 10 | 4 | 2 | 8.0 | Both traces are `wellforge-run/v3`. Every cited commit exists with the right task id. They show the order product-owner → architect → adr-writer → designer → T1 (with the user) → T2–T11 → owasp round 0 and QE round 0 (FAIL), then spec and plan re-approved by the user → T14–T22 → owasp round 1 PASS and QE round 1 FAIL (D-4) → fix → QE round 2 BLOCKED (E-1) → fix → QE PASS → eval FAIL 73.0. Trace 2 continues with: L5 fix → owasp → QE FAIL (D-5) → user-granted extension round 3 → QE FAIL (D-6/7/8) → escalation exit "split" (Matteo Codogno, 2026-11-12) → revert plus D-7 fix → owasp PASS → QE PASS (one dispatch failed on an API 403 and was re-dispatched). Verification was never skipped, and the cap was exceeded only with a recorded user extension. **Not 5:** trace 1 was written after the fact (committed at fd2f35f5 together with the 73.0 eval). The design gate was passed after implementation. T10 needed two attempts. `rigor_recorded` is null. |
| **Total** | | | | **92 / 115 = 80.0/100** | |

**Verdict: PASS.** The weighted total is 80.0, which equals `pass_score` 80, and every applicable dimension is at or above its floor. The result sits exactly at the bar. It rests on spec fidelity being 4: with spec fidelity at 3 the total would be 88/115 = 76.5, a FAIL. I scored 4 because everything left over from the router work is a one-line version pin that realigns projects-ui with the suite, a CI guard and an e2e test. None of these changes a 029 contract or feature behaviour.

## Findings

- **AC satisfaction (4). These rubric conditions depend on T12:**
  - AC-2.1, AC-2.3, AC-4.1: delivery with Operai closed within 30 s, nothing shown with a visible tab, and the OS click, on Chrome, Edge and Firefox.
  - R3: the Edge host (`*.notify.windows.com`) observed in the allowlist. Today it is assumed.
  - AC-6.5: the ADR-0084 go-live sign-off with owner and date, plus L2–L4 recorded as accepted.
  - AC-7.7: the deployed auth + notify-api re-measure.
  - L1: the stored-href check against production `notification.link.href`.
  - D-7 on Firefox and Safari. This is design/test evidence, not an AC.

  If T12 records all of them green, this dimension goes to 5 (+7.0 raw). If any supported browser fails AC-2.1, 2.3 or 4.1, that AC is unmet, the dimension drops to 2 and the floor fails. That would be a FAIL whatever the total.
- **Spec fidelity (4).** What remains outside the ACs is the projects-ui pin, the router check in `check-react-skew.mjs` and the `tool-entry.spec.ts` e2e (all from 710db1d1), plus e147e7c1 (`notify-api/.envrc`, no task). Each is documented. To reach 5, the separate router spec should take over the pin and the guard, and e147e7c1 should be named in a task, for example T2's touch list, via a tasks re-sync.
- **Test quality (4).** Real delivery cannot be automated here; T12's manual record is the intended substitute. Commit QE's `remote-history.spec.ts` with the router spec. D-7 escaped the T8 tests because they never asserted on side effects at boot; the new tests now pin that.
- **Code quality (4).** Keep the unregister function returned by `onBeforeSignOut` in `initPush`, or comment that relying on the Set's dedupe is intended. The per-process limiter (R17) must be revisited before a second `auth` replica.
- **Design fidelity (4).** This goes to 5 when T12 records the OS-notification content (English title and body, icon, click target) on Chrome, Edge and Firefox. Next time, approve the design before frontend tasks start.
- **Trajectory (4).** Write the trace as the run goes, not afterwards, and record `rigor_recorded`.

**Score with T12 recorded green** (all rows above observed, no defect): AC satisfaction 5 (+7) gives 99/115 = **86.1**. If the OS-notification surface is observed on all four browsers, design fidelity also goes to 5 (+3), giving 102/115 = **88.7**. If T12 finds a delivery failure on a supported browser, the result is **FAIL** on the ac_satisfaction floor.

## Recommended next step

- **PASS. The spec may move to `done` once T12 is complete**, as tasks.md says: T13 depends on T12. No implementation task needs to go back through `/wellforge:implement`.
  1. T12, done by a person: the cross-browser checks in a new `qe-manual.md`, the Edge host, the AC-7.7 deployed-pair re-measure, the stored-href check, and the ADR-0084 sign-off with owner, date and the L2–L4 acceptance. The Meetings-exclusion answer, already decided in spec.md, goes into the ADR.
  2. Re-run `/wellforge:eval` after T12 so that T13 closes on the scored evidence (expected 86.1 to 88.7), then run `/wellforge:done 029-push-notifications`.
  3. The separate router spec takes over O-2, O-3, the projects-ui pin, the skew guard and QE's `remote-history.spec.ts`.
