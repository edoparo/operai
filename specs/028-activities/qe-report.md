# QE report: specs/028-activities (production tier, full mode), full sweep after the eval fixes (2026-11-11)

## QE verdict: PASS   (activities-api test gate re-verified at f9301465 on feat/projects, 2026-11-11; every other row measured at b9ef058d, and `git diff b9ef058d..f9301465` touches only `activities-api/scripts/` test files)

The only open defect was D9 (intermittent 5 s hook timeout in the activities-api `bun test` gate). Commit f9301465 mitigates it and the gate was re-run 41 times with 0 failures (see D9 and
its probability argument). D9 is accepted as **mitigated, root cause unproven**, with a recorded residual. Every AC has executed evidence (36/36), every other gate is green, and the two
eval fixes (AC-7.5 degradation, the 2 s / 4 s lock bound) are verified, the first one seen failing on the pre-fix code. G1, N1, D7, D8 and E1 are recorded as **separate follow-up specs by the
owner's decision** and are not counted against this verdict.

Blocked rows: none that block the verdict. One rendered re-check could not be repeated (see "Not re-run / limits").

## Gate table

| Check | Threshold | Actual | Result |
|---|---|---|---|
| activities-api typecheck (re-run at f9301465) | clean | clean | ✓ |
| activities-api `bun test`, repeated (re-run at f9301465) | all pass, no flake | **41 of 41 full-suite runs: 616 pass / 0 fail, exit 0** (614 + the 2 new `crmSource.test.ts` cases; about 9 s each; no "timed out" in any log). Before the fix (b9ef058d): 1 failure in 35 of my runs, 1 in the eval's 9 (2 in 44; `import-crm-activities.test.ts` `beforeEach`, 5001 ms). The dev reports 0 in 32 after the fix (not re-observed by me). See D9 | ✓ (D9 mitigated, residual recorded) |
| activities-api line coverage | ≥ 80% | 96.52% lines, 94.61% funcs | ✓ |
| crm-api typecheck / test | clean / pass | clean / 400 pass, 0 fail (was 393: +7 `LOCKED_CALL` tests); 94.17% lines | ✓ |
| projects-api typecheck / test | clean / pass | clean / 598 pass, 0 fail; 96.32% lines | ✓ |
| auth typecheck / test | clean / pass | clean / 788 pass, 0 fail (the `prisma:error` lines are expected constraint-violation tests) | ✓ |
| notify-api typecheck / test | clean / pass | clean / 280 pass, 0 fail | ✓ |
| crm-ui lint, test, `tsc -b` | clean | clean, 230 pass (19 files; +2 Delete focus cases from af7758be), clean | ✓ |
| projects-ui lint, test, `tsc -b` (at b9ef058d) | clean | clean, 415 pass (22 files; +2 QE tests), clean | ✓ |
| notify-ui lint, test | clean | clean, 47 pass | ✓ |
| shell lint, test, `tsc -b` | clean | clean, 389 pass, clean | ✓ |
| operai-ui typecheck, lint, test | clean | clean, clean, 173 pass | ✓ |
| `mise run ui:check` build half (Storybook, shell/refund-ui/meetings-ui builds) | pass | **not re-run**: it rewrites the `dist/` the running `dev:preview` serves (you said do not rebuild). `git diff d572a087..HEAD` touches none of operai-ui, shell, refund-ui, meetings-ui, notify-ui, auth, notify-api; their last green build (d572a087) is current. Typecheck, lint and tests above were run | carried |
| `bun scripts/check-shared-copies.ts` | in sync | 6 groups in sync | ✓ |
| `mise run env:doctor` | pass | all checks passed (activities-api included) | ✓ |
| `mise run changeset:check` | OK | OK (activities-api.md, projects-tool.md, ui-task-row-person-chips.md) | ✓ |
| Secret scan (security floor) | 0 un-allowlisted | `betterleaks git . --log-opts="main..HEAD"`: no leaks found, exit 0 | ✓ |
| Dependency audit (security floor) | 0 critical | activities-api `bun audit`: 0 critical, 3 high (zod < 4.6.6, shared by every service), 5 moderate; unchanged | ✓ (floor) |
| Shell e2e `pnpm e2e activities- meetings-deal.spec.ts` (running stack) | pass | **18 passed, 0 failed (1.1 m)**: 5 CRM, 3 My tasks, 1 notify, 6 projects, 3 meetings-deal. Log `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/8f1fab41-2f74-410c-9a5d-dff3e3d5c8e0/scratchpad/e2e.log` | ✓ |
| AC coverage | every AC has executed evidence | 36/36 (map below) | ✓ |
| Live API sweep on the running stack (AC contract edges) | no 5xx, rules hold | 55 probes, 54 ok; the 1 "fail" was my probe's id normalisation (`instance` echoes the path); re-run with the id masked: DELETE and POST complete on an unreadable activity are byte-identical to a nonexistent one | ✓ |
| Design states (design.md) | all states present | unchanged since the last rendered pass (no UI product code changed since d572a087 except a test); the e2e above re-exercised in a real browser: Tasks card Open/Done/closed project/blocked, My tasks Pre-sales badge, CRM Tasks list, AC-1.5 maintenance and host-unavailable with Retry, `/notify` row tagged Projects. Previous rendered evidence carried (below) | ✓ (carried + e2e) |
| Accessibility (design.md) | keyboard + ARIA per design | carried from the rendered keyboard pass (D1, D6 closed); `TasksPage.focus.test.tsx` now also covers Delete (af7758be, 230 pass) | ✓ (carried) |
| Component reuse (design.md) | per inventory | unchanged: `TaskRow`, `PersonChips` from `@operai/ui`; nothing new built where reuse was specified | ✓ |

## Does the running stack carry the latest commits?

All four backends run as `bun run --hot src/index.ts`, started 09:46; the fixes were committed at 11:39 (crm-api) and 11:41 (activities-api). Bun `--hot`
reloads changed modules without a restart, so they should be live. I cannot prove it from outside: the AC-7.5 path needs a host that answers the cheap probe and
then fails the label call, and I did not stop or alter crm-api / projects-api. So: **AC-7.5 degradation and the lock bound are verified by tests (executed, below),
not by a live fault injection**. Everything else in the live sweep and the e2e ran against the running stack.

## Eval fixes, verified

| Change | Evidence |
|---|---|
| 89278f6f AC-7.5: `kind=all` degrades a host that fails after the probe | Six new `tasks.test.ts` cases (CRM 500 on the label call; garbage; timeout 2.6 s; the converse for projects; both hosts; a host that stops being a reader, unnamed per AC-7.4) plus the single-kind 503 case (AC-8.2). **Seen failing:** a detached worktree at `89278f6f^` (before the fix) with the new test and `test-support/hosts.ts` copied in: 32 pass, **6 fail** (all six new cases); at HEAD all pass. Worktree removed. Code review: `lastFailure` is only trusted when its host is still in `kinds`, a single kind still fails with its host, at most one retry per host, an empty `kinds` answers 200 naming both. |
| 01eb8abc crm-api `LOCKED_CALL` 2 s per attempt, 4 s budget, tx timeout 10 s | `crm-api/src/lib/activities.test.ts` (constant pinned; timeout per attempt; the 401 retry inside the budget; exhausted budget starts no attempt; slow token exchange counts), `estimate.test.ts`; 400 pass. One transaction per link, so a multi-deal estimate does not stack calls inside one 10 s transaction. |
| 2b175d8d blocker-order test | the fixture now writes through `newBlockerRows` (1 ms apart). Not the cause of D9 (different file). See N1 for the product-side half. |
| af7758be Delete focus test | `TasksPage.focus.test.tsx` in the 230. |
| Accepted notice-context narrowing | Code matches the Amendment: `activities-api/src/system/system.routes.ts` `targetOf`: a freed task of the completed task's company gets "Deal: <title>" only when its own `dealId` equals `context.dealId`, "Company: <name>" otherwise, "—" without a context; user-route completions untouched. `system.test.ts` 449-492 pin every branch and the 422s (nothing applied, `completionSeq` unchanged). |

## AC to evidence map (36 of 36)

Backend rows are `activities-api` unless named. Suites named were run in this pass (counts above). **Changed** marks rows with new or different evidence since the last PASS.

| AC | Executed evidence |
|---|---|
| 1.1 | `activities.test.ts`, `blockers.test.ts` (CRM block), `participants.test.ts`, `tasks.test.ts`, `matrix.test.ts`; crm-ui `ActivityItem.test.tsx`; e2e `activities-crm.spec.ts` (5/5 green). Narrowing per Amendment: verified against the code (above) |
| 1.2 | crm-api `estimates/estimate.test.ts` (task created with the estimate; failed put leaves neither, 503; commit failure deletes the task); `system.test.ts` PUT create-if-absent |
| 1.3 (**changed**) | `system.test.ts` completion/seq cases, `context` cases; crm-api `estimate.test.ts`, **`lib/activities.test.ts` (lock bound)**; `import-then-drive.test.ts` |
| 1.4 | `system.test.ts` meeting-mirror; crm-api `meeting-host/notices.test.ts`; `import-then-drive.test.ts`; e2e `meetings-deal.spec.ts` (3/3 green) |
| 1.5 | crm-ui `ActivityTimeline.test.tsx`, `TasksPage.activities.test.tsx`; e2e `activities-crm.spec.ts` maintenance and host-unavailable (green) |
| 2.1 / 2.2 / 2.3 / 2.4 | `scripts/import-crm-activities.test.ts`, `scripts/import-then-drive.test.ts` (both green; note D9 hits the first file) |
| 2.5 | `src/lib/maintenance.test.ts`; `src/qe.maintenance-ac25.test.ts` (data unchanged across the pause); crm-ui and projects-ui maintenance copy tests. The "complete and accounted for" half is the AC-2.3 evidence plus the `infra/README.md` runbook (not executable here) |
| 3.1 | `projects.test.ts`; live: default assignee = author, assignee off the team 422 `assignee_not_on_project`; `TaskFormDialog.test.tsx` |
| 3.2 | `projects.test.ts`, `rules.test.ts`, `matrix.test.ts`; live: non-manager create 403, assignee without manage cannot edit or delete (403) |
| 3.3 | `projects.test.ts`, `matrix.test.ts`; live: assignee completes and reopens without manage (200); e2e `activities-projects.spec.ts` |
| 3.4 | `tasks.test.ts`; `TasksCard.test.tsx`; e2e (open ordering, overdue) |
| 3.5 | `tasks.test.ts`, `matrix.test.ts`; live: a read-only user lists a closed project's tasks (200); e2e |
| 3.6 | `projects.test.ts`, `db.constraints.test.ts`; live: note and call on a project 422 `type_not_allowed`; e2e API case |
| 3.7 | `projects.test.ts`; live: team emptied, the task stays listed with its assignee, PATCH resending the unchanged assignee 200, reassigning to a non-member 422 |
| 3.8 | `projects.test.ts`; live: closed project create/edit/delete 409 `host_read_only`, complete and reopen 200; e2e |
| 4.1 | `blockers.test.ts`, `db.constraints.test.ts`; live: cycle 422 `blocker_cycle`, self 422 `blocker_is_self`, 11 blockers 422, 10 accepted (201), deleting a blocker removes it |
| 4.2 | `blockers.test.ts`; live: blocked task completion 409 `task_blocked`; `TaskRow.test.tsx`; e2e blocked journey |
| 4.3 | `blockers.test.ts`; live: both directions 422 `blocker_not_in_host` |
| 5.1 / 5.2 | `projects.test.ts`; live: unknown participant 422, 11 participants 422; `TaskFormDialog.test.tsx`; `PersonChips` focus tests |
| 6.1 / 6.2 / 6.3 | `projects.test.ts`, `blockers.test.ts`, `lib/notify.test.ts`; notify-api 280 and notify-ui 47 green; e2e `activities-notify.spec.ts` |
| 6.4 | `participants.test.ts`, `blockers.test.ts`, `notify.test.ts`; `errorLogging.test.ts` |
| 7.1 | `tasks.test.ts`; live: `kind=pre_sales` returns no operational row, default kind is pre_sales; e2e |
| 7.2 | `tasks.test.ts`; live: `kind=all&assignee=me` mixes both kinds in due order; `MyTasksPage.test.tsx`; e2e `activities-my-tasks.spec.ts` |
| 7.3 | `MyTasksPage.test.tsx`; e2e (done and not done from Projects, Open in CRM) |
| 7.4 | `tasks.test.ts` (both non-reader shapes); live: a user without CRM gets no pre-sales row and no `unavailable`, a single-kind pre_sales list is 404, never 503; e2e |
| 7.5 (**changed**) | `tasks.test.ts`: host down at the probe (existing) **and now host fails after the probe** (6 cases, seen failing pre-fix); `MyTasksPage.test.tsx` banner and Retry. Gap G1 below is the converse (projects host), not required by the AC |
| 8.1 | `matrix.test.ts`; `hosts/*.test.ts`; host-side `matrix.test.ts` in crm-api and projects-api |
| 8.2 | `projects.test.ts`, `hosts/client.test.ts`, crm-api `authz-outage.test.ts`; single-kind label-call failure is 503, never a list |
| 8.3 | `projects.test.ts`, `matrix.test.ts`; live: PATCH, DELETE and complete on an unreadable activity are byte-identical to a nonexistent id |
| 8.4 | `system.test.ts` erase block; `import-crm-activities.test.ts`; crm-api `contacts/contacts.test.ts` |

## Defects (by class)

**D9 (minor, test reliability, gate; MITIGATED and accepted at f9301465, 2026-11-11; root cause unproven). Class: load-sensitive database hook timeout in a test that provisions a database.**

*Re-verification (f9301465, test code only).* Fix: (1) `provisionCrmSource` sets `synchronous_commit = off` per database on the `import_src_*` source and the `*_test` target right after CREATE; (2) both import tests open
their connection at module level, outside the 5 s hooks; (3) new `scripts/test-support/crmSource.test.ts` pins the setting and the `*_test` / lower-case-tag refusals.
- Does it change what the tests prove? No. The setting only lets COMMIT return before the WAL flush; visibility, isolation, constraints, locks and atomicity are unchanged. AC-2.1 to 2.3 (copy, idempotence, found-vs-present counts, dry run)
  read their own writes in live sessions and never kill the server or check crash durability, the only thing the setting weakens. Eager connections only move setup out of a timed hook.
- Leak to non-test databases? No. Checked on the live server: `pg_db_role_setting` has exactly one row, `activities_test` = `synchronous_commit=off`; no dev database has it; no `import_src_*` database is left after 41 runs. The helper refuses a
  non-`*_test` target (pinned by the new test). It is a per-database setting, so it stays on `activities_test` after the run: acceptable, that database is disposable and truncated per test, and nothing there needs crash durability.
- Not proven: a stall from an exclusive-lock wait or a database create/drop checkpoint would not be shortened by this setting. The WAL-fsync hypothesis is plausible and the change is safe and cheap, not demonstrated.
- Evidence: **41 sequential foreground full runs of `direnv exec . bun test` in `activities-api`: 41 pass, 0 fail** (616 pass / 0 fail each, about 9 s, no "timed out" in any log; one `bun run typecheck` overlapped the second half, no database). Typecheck clean.
  Logs: `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/8f1fab41-2f74-410c-9a5d-dff3e3d5c8e0/scratchpad/d9/`.
- Probability: old rate about 2/44 = 4.5%. If nothing had changed, P(0 failures in my 41 runs) = 0.955^41 = 0.15 (3%: 0.29; 5%: 0.12); with the dev's 32 clean runs (73 runs) 0.955^73 = 0.035 (3%: 0.11). The counts alone are suggestive, not conclusive. The row is
  accepted as ✓ on the counts plus a mechanism that matches the symptom (a hook of many commits on a disk shared with checkpoints) plus a change with no downside for what the tests assert.
- Residual: D9 is mitigated, not proven fixed. If a `beforeEach/afterEach hook timed out` recurs in `scripts/import-*.test.ts`, do not raise the timeout or add a retry: read `docker compose logs postgres` around the failure (checkpoints, lock
  waits), look at `pg_locks` during the hook, and reopen D9 with that evidence.

*Original finding (b9ef058d).* `activities-api/scripts/import-crm-activities.test.ts`, first test of the first file of the run, `beforeEach` (`seedCrm()` + `resetTarget()`:
`TRUNCATE "activity","meeting_mirror_state" CASCADE` on `activities_test`, after the module-level `CREATE DATABASE import_src_*`). The hook hit its 5 s limit once in 35 of my full
runs (the first `--coverage` run, started right after a loop of runs and while the crm-ui and projects-ui vitest suites ran), and once in the eval's 9. Not reproduced in
the next 16 looped coverage runs, in 3 runs with vitest running alongside, or in 3 solo runs of the file (1.3 to 1.4 s each). This is the "1 failure I could not identify" of
eval finding 4: it is this hook. The root cause is not proven; my hypothesis is a lock or I/O stall on the shared Postgres (a `CREATE DATABASE` / `DROP DATABASE ... FORCE` forces a
checkpoint, and a `TRUNCATE ... CASCADE` needs an exclusive lock), which I could not confirm because the failure did not recur. Not a product fault, but a gate that goes red
about 1 run in 20 cannot be called passing, and a retry or a longer timeout would only hide it (not done).
Placements (same pattern): `scripts/import-then-drive.test.ts` provisions the same way (did not fail, same exposure); `crmSource.ts` `provisionCrmSource` is the shared helper. Missed earlier:
the eval's single red run had no log; this pass logged it.
Suggested fix: give the provisioning hooks an explicit generous timeout only after capturing `pg_locks` / `log_lock_waits` on a failing run to find the wait, or provision the source
database once per file in `beforeAll` and do the per-test reset with `DELETE` on the four small tables. Owner: backend-dev.

**Gap G1 (not an AC, design and spec gap; recorded as a separate follow-up spec by the owner's decision, not counted against the verdict).** `GET /tasks?kind=all` also answers `unavailable: ["projects"]` with only the
pre-sales rows when the *projects* host fails (pinned by `tasks.test.ts` since T9, and now also for the label call by 89278f6f). `MyTasksPage` only reads `unavailable.includes('crm')`,
so the page shows a silently short list, and with no pre-sales tasks it says "Nothing on your list" with no warning. AC-7.5 and design.md S4 cover only the CRM. QE tests
`projects-ui/src/pages/MyTasksPage.projectsDown.qe.test.tsx` (2, `it.fails`, committed b9ef058d) document the current behaviour and go red the day a warning is added; flip them to plain
`it` then. Placements: My tasks (the only `kind=all` consumer) ✗; project Tasks card and CRM lists use single-kind calls and fail loudly (503 banner) ✓. Not counted against the verdict.

**Note N1 (advisory, pre-existing; separate follow-up spec by the owner's decision, not counted against the verdict).** The blockers of a task are read ordered by `createdAt` only: `activities/view.ts:61` (`blockedBy`) and `activities/blockers.ts:109` (the `task_blocked` `extras.blockers`), where
participants already have a `userId` tiebreaker. Blockers written by the service are 1 ms apart, but imported ones keep the CRM's timestamps, and the old crm-api wrote a
task's blockers in one `createMany`, so they tie and the "Waiting on" order can differ between reads. crm-api ordered the same way, so this is not a regression of AC-1.1. A `[createdAt, blockerId]` order closes it. Missed earlier.

Previous defects D1 to D6: closed, unchanged. D7 (PersonPicker Escape), D8 (light-theme badge contrast) and E1 (shell sidebar at 360 px): separate follow-up specs by the owner's decision, not re-judged and not counted against the verdict.

## Environment faults and limits

- **Rendered re-check not repeated.** Early in the rendered pass I found `qe-028-admin@operai.test` holding only the `employee` role (the live API sweep minutes earlier ran as admin and
  passed; I did not find what reset it, possibly the e2e run). Restoring it needs a role grant to a persona, which the permission system denied; I did not work around it.
  The rendered evidence of the previous pass is carried (no UI product code changed since), and the 18 e2e journeys ran in a real browser. No defect is hidden by this: the only UI-side
  change since the last PASS is a test.
- Local Postgres user is `hercules`; suites ran through each service's `direnv` file with the `*_test` databases forced by the test preloads. No dev database was written by a unit suite.
- `direnv allow` was run once on a throwaway worktree path (removed) for the pre-fix reproduction.

## Tests added by QE

- `/Users/matteocodogno/LAB/aiscream/operai/projects-ui/src/pages/MyTasksPage.projectsDown.qe.test.tsx` (2 `it.fails`, gap G1), committed b9ef058d.
- Reviewed, not written by QE: `activities-api/scripts/test-support/crmSource.test.ts` (dev, f9301465).
- Carried: `activities-api/src/qe.maintenance-ac25.test.ts`, `scripts/import-then-drive.test.ts`, `src/qe.exploratory.test.ts`, `projects-ui/.../TaskFormDialog.a11y.qe.test.tsx`.
- Scratch (not committed): `probe.ts`, `probe2.ts` under `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/8f1fab41-2f74-410c-9a5d-dff3e3d5c8e0/scratchpad/`.

## Blocked

None.

## Security

Auth boundary, service scopes, personal data across services, cross-service erasure: an `owasp-reviewer` pass on the final tree (round 2) was recommended earlier and is still the route
before merge; this pass changed no auth or input handling beyond the label-call degradation (which never shows an unlabelled row) and the locked-call timeout. Reminder: regenerate the
`.betterleaksignore` fingerprints after any squash or rebase.

## Housekeeping

Live data left in the dev databases under `qe-028-*@operai.test` (this pass: a company with a deal, two projects and ~25 tasks tagged `mwc2s0y3`, a persona `qe-028-third-mwc2s0y3`). Scratch
databases from earlier passes remain (a destructive-SQL hook prevents an agent dropping them). `.playwright-mcp/` is git-ignored.
