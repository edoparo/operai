---
spec: 029
evaluated: 2026-11-12
rubric: default-v2
score: 73.0
verdict: FAIL
---
# Eval report: Push notifications

Evaluated at HEAD 5ee89091 (branch `feat/029-push-notifications`, 40 commits over `main`), rigor production.
Rubric: `default-v2`, resolved from the plugin-bundled copy
`/Users/matteocodogno/.claude/plugins/cache/wellforge/wellforge/2.62.1/config/eval-rubric.yml`. There is no `gates/configs/` or
`.wellforge-gates/` copy in this repo and no `specs/029-push-notifications/eval.md` override.
`design.md` exists, so `design_fidelity` applies. The weight pool is 115 and the total is normalised over it.

Verification evidence used: `qe-report.md`, whose final verdict is PASS at 85fcb037 after rounds 0 to 2. The auth and notify-api suites last
ran at 313cafaf; no backend file changed after that. I re-ran the remount tests from 85fcb037 myself:
`notify-ui`, `crm-ui` and `projects-ui` `src/App.test.tsx`, 3 + 1 + 1 passing. Security: owasp-reviewer round 1 PASS (0 findings at medium or
above, 4 lows), as reported by the orchestrator. The targeted review of 86496298 and 85fcb037 was still running and is not part of this
eval.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | 37 of 37 ACs have a passing automated test (qe-report § AC to test map). Most also have live evidence: AC-7.x re-measured live (45 mints, about 350 lookups, 0 refusals; the 21st invalid request gets 429 and a valid request still passes); AC-1.x/3.x checked in the exploratory pass at `/account`; AC-2.3 checked on a real Chromium worker (s7); AC-4.3 by e2e plus `r3/ac43.mjs`; AC-5.1 by a live sign-out (97 ms). **Thin:** real OS delivery and the OS click (AC-2.1, 2.3, 4.1) are seen only on Safari (T1 spike, Matteo Codogno, 2026-11-11). Chrome, Edge and Firefox are covered only by fakes (`push.channel.test.ts:290` decrypts the aes128gcm record; `pushHandlers.test`). AC-6.5's ADR sign-off is "pending" (`docs/adr/0084-…md:108`); the guard holds because push is off by default (AC-6.1). The AC-7.7 deployed-pair re-measure is pending (T12). |
| Spec fidelity / no drift | 20 | 3 | 3 | 12.0 | Contracts match the plan: payload keys exactly `v,id,title,body,originApp,href` (`push.channel.ts:50-57`); verify the credential, then exactly one count (`serviceToken.routes.ts:212-256`); 300/600/20 defaults (`systemRateLimits.ts:75-79`). All five spec amendments went through the drift rule and were re-approved. **Drift:** 86496298 and 85fcb037 change router behaviour in every remote: 9 frontends, 18 files, `useState(() => createAppRouter(...))`, plus a dependency bump. None of the spec's ACs asks for this. It is documented, user-decided and has its own changeset (`router-per-mount-and-tanstack-alignment.md`). Also: e147e7c1 (VAPID fetch in `notify-api/.envrc`) belongs to no task; several tasks touched files outside their `touch:` lists (orchestrator-reported); `design.md` frontmatter is still `status: draft`. |
| Test quality | 20 | 4 | 3 | 16.0 | Strong. The wire bytes are decrypted with the subscriber key and checked to contain no plaintext (`push.channel.test.ts:290-313`). The log hygiene test checks that no endpoint, key or text is logged (`:247`). The suite-capacity contract test (`systemCapacity.contract.test.ts:90`) was shown to fail at the 21st request against the pre-US-7 routers (T17). Device-cap concurrency runs on real Postgres (T19). The D-4 tests were shown red with the fix blanked (qe-report round 2). The 429s are byte-identical (AC-7.6), and remount tests exist per remote. **Gaps:** browser delivery and service-worker behaviour are tested only against a fake `ServiceWorkerGlobalScope`/`PushManager` (the e2e uses an init-script fake). The original suites did not catch D-1 (round 0) or D-4 (round 1). `devices.repo.ts` line coverage is 73.9%. Two `router.*.test.tsx` flakes predate this branch. |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | Idiomatic: Effect plus RFC 7807 problems, and env validated with exit 1 (T2). Push is best effort and never awaited, inside a try/catch (`inApp.channel.ts`). Fan-out is bounded: a pool of 16 with queue bounds and a single count-only drop log (`sendPool.ts`). The activity memo is single-flight, keyed from send time, and remembers only `found` (`activityCheck.ts:41-53`). One `tooManyRequests` builder with a fixed `Retry-After` (`systemRateLimits.ts:104-117`). The sign-out hook has a 2 s budget (`session.ts` diff). `web-push` 3.6.7 is a real dependency. **Nits:** `initPush` discards `onBeforeSignOut`'s unregister function; this is harmless only because the `Set` dedupes the same function reference (`push.ts:559`). The limiters are per process (R17, documented). Four security lows: L1 is handled in T12; the user accepted L2 to L4. |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | `design.md` is complete: flows F1–F10, a Screens & states table, a component inventory (12 reused : 0 new), copy, and an Accessibility section with a focus table. QE reached all 10 states with the designed copy and checked the a11y rules (alertdialog, focus moves, live regions, heading order, row headers). D-4 (focus after the second removal) is fixed (8e1fd0a7) and tested. **Thin:** `design.md` was never moved out of `draft`. At 360 px with the sidebar expanded the push section overflows `<main>` by about 84 px (O-1, put down to pre-existing chrome). |
| Trajectory | 10 | 2 | 2 | 4.0 | **No run trace for 029 exists in `.forge/runs/`.** The newest trace is `2026-11-11T08-00-00Z-orchestrate-028-activities.json`, so the rubric's neutral floor applies. Git history is consistent with a correct order: spec, plan, design and tasks (439c1775), then T1–T11, then the QE round 0 FAIL (eeef1394), the re-approval (495ee117, 7ad0438d), T14–T22, QE round 1 (33ef66a2), the D-4 fix, QE round 2 BLOCKED, the E-1 fix and QE PASS (5ee89091). The orchestrator reports five drift amendments, two QE fix rounds and a user-led T1 spike. I did not verify these, and without a trace they cannot raise the score. |
| **Total** | | | | **84.0 / 115 = 73.0/100** | |

**Verdict: FAIL.** The weighted total is 73.0, below `pass_score` 80. No dimension is below its floor. The shortfall comes from evidence and process: no run trace, the T12 browser and ADR gate still open, and router scope added in every remote. No open functional defect was found.

## Findings

- **AC satisfaction (4, not 5). Depends on T12.** The automated proof is complete. Observed OS behaviour on the supported set is
  Safari only. These rubric conditions wait on T12:
  - AC-2.1, 2.3, 4.1: delivery with Operai closed within 30 s, suppression with a visible tab, and the OS click on Chrome, Edge and Firefox.
  - R3: the Edge host is in the allowlist. Today `*.notify.windows.com` is an assumption, not an observation.
  - AC-6.5: the ADR-0084 go-live sign-off, with owner and date.
  - AC-7.7: the deployed-pair re-measure.
  - The stored-href check.

  If T12 records these as observed, this dimension moves to 5 (+7.0 raw). If any browser fails, an AC is unmet and the floor fails.
- **Spec fidelity (3).** The router alignment and the per-mount router (86496298, 85fcb037) fixed an environment fault that was not a 029
  defect. They change behaviour in 9 apps that the spec does not cover. The user decided this, it is documented and it has its own
  changeset, so it is "documented drift" (3), not silent scope (2). To raise it to 4, land those two commits on `main` as their own
  `chore`/`fix` (or their own spec/PR) and rebase 029 on top. Also: fold e147e7c1 into a task or justify it, and move `design.md` to `approved`.
- **Test quality (4).** Nothing automated proves real browser delivery. That is inherent, and T12's manual record is the intended
  substitute. The pre-existing `router.inventory/meetings` flakes are outside this feature.
- **Code quality (4).** Minor nits only. Keep the unregister from `onBeforeSignOut` in `initPush`, or document that relying on the `Set`'s
  dedupe is intentional. The per-process limiter (R17) must be revisited before a second `auth` replica.
- **Design fidelity (4).** Approve `design.md`, or record why it stays draft. O-1 (360 px overflow with the sidebar expanded) belongs to the
  shell chrome; worth a ticket.
- **Trajectory (2).** The orchestrator recorded no `wellforge-run/v3` trace for 029, although 016, 021, 023, 024, 025 and 028 all have one.
  The orchestrator-reported history (five drift amendments, QE rounds 0 to 2, the scope decision) is exactly what a trace should hold. A
  trace that records the agents, the QE and owasp verdicts per round, the drift events and the user decisions would support a 4 (+4.0 raw).

What it takes to pass. These are arithmetic over the 115 pool:
- A trace, plus moving the router change out of the branch (spec fidelity 4): 92/115 = **80.0**. Just at the bar.
- A trace, plus T12 completed with every browser green (AC satisfaction 5): 95/115 = **82.6**. PASS.
- All three: 99/115 = **86.1**.

## Recommended next step

- **FAIL. Do not move the spec to `done`.** No implementation task needs to go back through `/wellforge:implement`, because there is no failing AC. The remaining work is evidence and process:
  1. The orchestrator writes the 029 run trace (`.forge/runs/…-orchestrate-029-push-notifications.json`, schema `wellforge-run/v3`), covering every round and decision.
  2. T12, done by a person: the Chrome, Edge and Firefox checks in `qe-manual.md`, the Edge host, the AC-7.7 deployed-pair re-measure, the stored-href check, and the ADR-0084 sign-off with owner and date.
  3. Optional, worth +4 raw: split 86496298 and 85fcb037 out to `main` on their own. Approve `design.md`.
  4. Fold in the outcome of the parallel security review of 86496298 and 85fcb037, then re-run `/wellforge:eval` before T13.
