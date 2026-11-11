---
spec: 028
evaluated: 2026-11-11
rubric: default-v2
score: 80.0
verdict: PASS
---
# Eval report: Activities, one place for CRM and project activities and tasks (after the fix round)

Rubric: `default-v2`, from the plugin's bundled copy
`~/.claude/plugins/cache/wellforge/wellforge/2.60.0/config/eval-rubric.yml`. This repo has neither
`gates/configs/eval-rubric.yml` nor `.wellforge-gates/...`. There is no `specs/028-activities/eval.md`, so
no overrides apply. `design.md` exists, so `design_fidelity` applies and the total is normalised over
115 weight points.

This is a fresh eval at HEAD 546f6c70 on `feat/projects`. The previous verdict (FAIL 76.5, 5f32ab95) is
context only. Scope: the specs/028 work. The fix round is 01eb8abc, 89278f6f, 2b175d8d, af7758be,
813354fd, cc7aa0ee, fcf2fe42, 76d9729f, b7ca30c1, b9ef058d, f9301465, 6e1dd544 and 546f6c70. specs/025 on
the same branch is not judged. T14 lives on `feat/activities-contract` by design (ADR-0083). T23 is what
this eval gates.

I re-ran these myself at 546f6c70, in the foreground, never two activities-api suites at once:
- activities-api: `tsc --noEmit` clean. `bun test` 8 full runs, every one **616 pass / 0 fail**, with no
  hook timeout (D9 did not recur).
- crm-api: typecheck clean, 400/0 (+7 `LOCKED_CALL` tests).
- projects-api: typecheck clean, 598/0.
- crm-ui: `tsc -b` clean, lint clean, 230/230 (19 files).
- projects-ui: `tsc -b` clean, lint clean, 415/415 (22 files).

The e2e (18/18), the live API sweep, env-doctor, the secret scan and coverage are taken from
`qe-report.md` (PASS, measured at b9ef058d/f9301465). That is the only place they ran this round.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | qe-report.md maps 36 of 36 ACs to executed evidence. The previous AC-7.5 gap is closed: `tasks.routes.ts:171-188` drops a host that fails the label call after the probe. `tasks.test.ts:347-407` has six cases: 500, malformed, a 2.6 s timeout, the converse, both hosts down, and a host that stops being a reader (AC-7.4, unnamed). QE ran all six against `89278f6f^` and saw them fail. A single kind still answers 503 (`tasks.test.ts:450`, AC-8.2). AC-1.1 holds as amended: the owner accepted the notice-context narrowing (spec.md Amendments 2026-11-11, b7ca30c1), and `system.test.ts` 449-492 pins every branch. Thin: AC-2.1 to 2.5 are proven only on seeded test databases (the production import is the runbook/T14 step). The "accounted for" half of AC-2.5 is a runbook step. The new AC-7.5 path is proven by tests only; QE did no live fault injection. |
| Spec fidelity | 20 | 4 | 3 | 16.0 | The three undocumented drifts of the last eval are now resolved. (a) The completion `context` is recorded in plan.md § System routes (shape, validation, use limited to labels, the known narrowing) and in the ADR-0082 amendment (cc7aa0ee), and the spec records the owner accepting it (b7ca30c1). (b) The code now matches the plan's 2 s bound. `LOCKED_CALL = {timeoutMs: 2_000, budgetMs: 4_000}` (`crm-api/src/lib/activities.ts:43`) is passed at `estimateNotices.routes.ts:116`, the transaction timeout is 10 s, and plan § Risks states the real bound and the timeout-after-apply residual. (c) The UUID-versus-cuid ids are recorded in plan § Data model, Ids, and in AGENTS.md (fcf2fe42). The fix round added no new scope. Why not 5: one CRM behaviour (the `task_unblocked` deal label on the EstimAI path) no longer matches the original "a move, not a redesign" intent. It was settled by amending the spec after the fact, and the UUID choice was justified retroactively ("neither the code nor the commit records a reason", plan § Ids). |
| Test quality | 20 | 4 | 3 | 16.0 | Strong and regression-catching. `src/matrix.test.ts` covers host × rule × caller. Other coverage: the erase race, concurrent PUT, completion and mirror ordering, byte-identical 404. The AC-7.5 cases were seen failing before the fix. The lock-bound tests (`crm-api/src/lib/activities.test.ts:195-288`) check the per-attempt timeout, the 401 retry inside the budget, that no attempt starts once the budget is spent, and that the token exchange counts. `TasksPage.focus.test.tsx` now covers Delete and Cancel (af7758be). The tied-`createdAt` flake was fixed at its cause (2b175d8d). Gap G1 is pinned with `it.fails` in `MyTasksPage.projectsDown.qe.test.tsx`, so the test goes red when the gap closes. Why not 5: D9 is mitigated but its root cause is unproven (f9301465 sets `synchronous_commit=off` on test DBs; 41/41 in QE and 8/8 here, about 15% chance that is luck by QE's own arithmetic). Nothing pins the blocker tie order (N1, which can be nondeterministic on imported rows). The crm-api budget tests assert wall-clock bounds of 170 to 500 ms, which can flake under load. The import was not run against a post-T14 `crm_test`. |
| Code quality | 15 | 4 | 3 | 12.0 | Idiomatic and fails closed. The host registry is data (`activities/rules.ts`). The resolve client fails closed on anything but a valid 200. Erasure uses a tombstone plus an advisory lock. System writes are idempotent. Notices are best effort. People lookups fail soft (`lib/people.ts:23`). There are no invented dependencies. The lock-bound fix is careful: `within()` bounds the token exchange, and each attempt gets `min(2 s, remaining budget)`. Nits: the AC-7.5 fix attributes failures through mutable state on the session (`HostSession.lastFailure`, `access.ts:46`) rather than an error that carries its host. It is correct only because `loadHostsFor` loads hosts one after another (`view.ts:80-88`) and because the guard `kinds.includes(failed.kind)` rejects a stale value; a later `Promise.all` would break it silently. Blockers are ordered by `createdAt` only (`view.ts:61`, `blockers.ts:109`; N1). The blocker check before `complete` is check-then-write (ported from crm-api unchanged). |
| Design fidelity | 15 | 4 | 3 | 12.0 | design.md is complete and now `status: approved` (813354fd): flows F1–F9, states S1–S6 (loading, empty, error, maintenance, closed project), an a11y plan (`design.md:205-216`) and a reuse inventory. QE's rendered pass and the e2e cover the states, keyboard, focus after row actions (D6 closed, with tests), alertdialog, the `role=status` banner and `aria-disabled` plus `aria-describedby`. `TaskRow` and `PersonChips` are reused from `@operai/ui`. Unrealised design items, all deferred to follow-up specs by the owner: D8, light-theme Overdue and Blocked badges at about 4.31:1 (the design requires contrast in both themes, `design.md:216`); D7, PersonPicker Escape (the design's dialog Escape behaviour, `design.md:205`); E1, the shell sidebar at 360 px. All three live in library or shell components, not 028 code. The follow-up specs do not exist yet (no `specs/029+`). |
| Trajectory | 10 | 4 | 2 | 8.0 | Run trace `.forge/runs/2026-11-11T08-00-00Z-orchestrate-028-activities.json` (v3) shows dependency-ordered dev work, the architect's amendments, owasp rounds and QE history. In git the fix round runs in the right order: code fixes (01eb8abc, 89278f6f), then the documents, then the QE full sweep (6e1dd544), then the D9 fix (f9301465) re-verified by QE (546f6c70), then this eval. QE ran, and its "seen failing pre-fix" check is real verification. Why not 5: the trace stops at e41bf373 (`result: escalated-eval-fail`, `qe.last: BLOCKED`, `eval.dispatched: false`). This round's user decisions (extra round, narrowing accepted, G1/N1/D7/D8/E1 deferred, D9 accepted) are recorded only in git, spec.md and qe-report.md. |
| **Total** | 115 | | | **92 / 115 = 80.0/100** | |

**Verdict: PASS.** 80.0 equals the pass score of 80. Every dimension is above its floor (ac_satisfaction is at
its floor of 4). The margin is zero: any single dimension one anchor lower would fail.

## Findings

The author's own claims (task check-offs, outcome lines, "verified" notes in commit messages) were not
counted. Every score rests on code, tests I re-ran, or QE's executed and rendered evidence.

1. **AC satisfaction (4). Owner: backend-dev and ops.** The AC-2 family and the new AC-7.5 path have
   evidence from tests only. Before T14 merges, run the production import report (AC-2.3) and the runbook
   unpause check (AC-2.5). Optionally, inject the AC-7.5 fault live by making the CRM fail its resolve on
   a running stack.
2. **Spec fidelity (4). Owner: architect.** No action. The drift is documented and the owner accepted it.
   Watch for: a further implementation-time change to CRM copy or behaviour needs the same spec amendment
   *before* it merges, not after.
3. **Test quality (4). Owner: backend-dev.**
   - D9: if a `beforeEach/afterEach hook timed out` recurs in `scripts/import-*.test.ts`, follow QE's
     residual instruction (capture `pg_locks` and the postgres logs; do not raise the timeout).
   - N1: add a `[createdAt, blockerId]` order and a test with tied timestamps (follow-up spec).
   - Consider widening the wall-clock assertions in `crm-api/src/lib/activities.test.ts`, or driving them
     from a fake clock.
4. **Code quality (4). Owner: backend-dev.** Replace `HostSession.lastFailure` with a `ProblemError`
   subclass, or an `extras.host`, that carries the failing app. The retry loop would then stop depending on
   loads being sequential. Not blocking.
5. **Design fidelity (4). Owner: designer, then frontend-dev (operai-ui, shell).** Create the follow-up
   specs the owner decided on: D8 (badge token contrast), D7 (PersonPicker Escape), E1 (sidebar at 360 px)
   and G1 (My tasks silent when projects is down). Until they exist they are not tracked anywhere except
   qe-report.md.
6. **Trajectory (4). Owner: orchestrator.** Update the run trace with this fix round, the user's decisions
   and this eval.

## Recommended next step

PASS: the spec may move to `done` through T23, once the scoped OWASP re-review of this round (running in
parallel) is PASS, as T23 requires. Before the ADR-0083 contract step (T14), do the production import
report and the unpause check (finding 1). Open the follow-up specs for G1, N1, D7, D8 and E1.
