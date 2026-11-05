---
spec: 023
evaluated: 2026-11-05
rubric: default-v2
score: 80.0
verdict: PASS
---
# Eval report: Access to Operai only by invitation, with a waiting list

This is a re-evaluation after the remediation of the earlier FAIL (64.3, AC-6.1). Every dimension
is scored again on the whole feature.

Rubric: `~/.claude/plugins/cache/wellforge/wellforge/2.56.0/config/eval-rubric.yml`, the
plugin-bundled copy (`version: default-v2`). The lookup found no `gates/configs/eval-rubric.yml`
and no `.wellforge-gates/...` copy. There is no `specs/023-signup-gate/eval.md` override.
`design.md` exists, so `design_fidelity` applies and the weight pool is 115.

Evidence base:
- The diff `9d0fbb9..HEAD`. 59e9b48 (`fix(deps)`, decided by the user) counts for trajectory only.
- What changed since the last eval: `9a89507..HEAD` is documentation and run-trace only (8bef6b8,
  18f9aa6, d306e99). No source or test file changed.
- Re-run in this eval: the auth feature suites (`src/signup`, `src/test-auth`, `src/invitations`,
  `src/admin`) on the isolated `_main` database gave **320 pass / 0 fail**.
- Taken from the closing QE without re-running: the full-gate numbers (auth 742/0, admin-ui 560,
  e2e failing set identical to the 9d0fbb9 baseline, access-requests.spec.ts 3/3).

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | **AC-6.1 is now met in content, not only in form.** `specs/004 spec.md:149-152` (AC-6.3 amendment) and `specs/006 spec.md:15-18` (Problem) plus `:316-324` (Non-goals) all state AC-1.1–1.4: a user is created for an allowed-domain email with a live pending invitation, or for the bootstrap admin. An allowed-domain email without one can only file an access request. An outside-domain email is refused with nothing recorded, even when it has an invitation. Each amendment cites specs/023 and ADR-0071. A search of `specs/` finds no remaining statement that an uninvited sign-in gives `employee`. `specs/007:428` ("every user gets `employee`") is still true of users. AC-6.2: SQL in `infra/README.md` § "Users who entered without an invitation". Code ACs are unchanged and re-run green: AC-1.1–1.5 and 1.8 go through the real `createOAuthUser` (`signupGate.test.ts:131-218`). AC-2.1–2.4 cover the races and the rejected/approved branches (`:243-322`). AC-3.1–3.10 (`accessRequests.routes.test.ts`). AC-4.x (`notifyAdmins.test.ts`). AC-5.1 (`createInvitation.ts`, invitations tests). **Not 5:** AC-1.6 is shown with a direct `internalAdapter.createSession` call (`signupGate.test.ts:220-229`), not through the OAuth re-entry path. AC-1.9 rests on e2e from the QE run. AC-6.x is checked only by reading documents. |
| Spec fidelity | 20 | 4 | 3 | 16.0 | The earlier drift in operator and agent docs is fixed. The `AGENTS.md` auth line and admin-ui line ("allowed-domain colleagues without an invitation", no longer inverted), `infra/README.md:1541-1543` and `.changeset/invitation-only-access.md` now match ADR-0071. The code follows the plan: four-step gate, the state table in `accessRequests.repo.ts`, the API contracts, the ADR-0072 binding. Small deviations left: (1) approve runs `validateInvitation` before the transaction, and the CAS is the first statement inside it (`accessRequests.routes.ts:175-219`). plan.md:117-120 puts the CAS first and the checks inside. The observable contract is the same: an already-decided request returns 409 first, and the race with a concurrent invite is caught by P2002 and returned as `pending_invitation_exists` (`:249-258`). (2) `encodeURIComponent` is applied to every admin-ui path (T14), a harmless hardening. (3) The new doc lines say "(or the bootstrap admin)" and do not repeat that the bootstrap admin must also be in an allowed domain (AC-1.4). ADR-0071 and the code (`signupGate.test.ts:205`) get this right. |
| Test quality | 20 | 4 | 3 | 16.0 | The tests would fail if the behaviour broke. They drive better-auth's real `createOAuthUser` and assert that no user, account, user_role or session row exists. They cover concurrent first sign-ins, concurrent approves, approve against reject, and the notify failure paths. Every admin-ui state and flow has a component test, including focus after a decision. Gaps unchanged since the last eval: AC-1.6 is not tested through `handleOAuthUserInfo`. `invitations.routes.test.ts:35` still pushes `operai.test` onto the shared `env.ALLOWED_SIGNUP_DOMAINS` and never removes it. |
| Code quality | 15 | 4 | 3 | 12.0 | Idiomatic Hono/zod-openapi code. RFC 7807 problems carry a `code` extension. `withAudit` takes an array entry. The gate fails closed. Notices are not awaited and never throw. Logs contain no email or name. Unchanged nits: the `SERVICE_TOKEN_TTL_SECONDS as 300` cast (`serviceToken.routes.ts:268`); `serializeInvitation` is imported from a routes module; the approve 409 cause is found with a second query; there is a non-null assertion after a re-read (`accessRequests.routes.ts:265`). |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md is complete: flows F1–F7, every list state, an a11y plan, and a reuse map (17 elements reused, 3 new). The build follows it: Pending filter by default, columns that depend on the filter, labelled row actions, a warning banner that persists with an Open Invitations action, focus moved to the results region, Approve disabled when the catalog fails (`AccessRequestsPage.tsx`). Still thin: deciding the last row on page 2 or later shows an empty state instead of going back a page; the focused results region uses `outline-none`, so it has no visible focus ring; design.md still says `status: draft`. |
| Trajectory | 10 | 4 | 2 | 8.0 | There are six v3 run traces. The newest, `2026-11-05T18-18-47Z`, records backend-dev for T15, then the owasp-reviewer, then QE, which FAILED the first fix because the specs/006 Non-goals had no outside-domain refusal. The fix round (18f9aa6) followed, then a QE PASS. The eval's finding became T15 in tasks.md (7c7e025) before any change was made. Earlier traces show security and QE review on every batch, an incorrectly ticked T10 being unticked, and a plan amendment made before the fix. Deductions remain: the T10 agent touched the other checkout's databases; earlier drift events are left `resolved: false`; the batch-1 QE passed the inverted T11 text that this eval had to catch. |
| **Total** | 115 | | | **92.0 / 115 → 80.0/100** | |

**Verdict: PASS.** 80.0 meets the pass score of 80, and every dimension is at or above its floor
(AC satisfaction is 4 against a floor of 4). The margin is zero. A drop of one point in any
dimension would turn this into a FAIL, so the findings below are worth doing.

## Findings

- **AC satisfaction (4).** AC-6.1 is fixed. The only thin evidence is AC-1.6, which is shown
  with a direct `createSession` call. A test that runs a returning user through
  `handleOAuthUserInfo` (or `createOAuthUser` on an existing account) would prove that the gate
  is not consulted on re-entry.
- **Spec fidelity (4).**
  - In `AGENTS.md`, `infra/README.md`, specs/004 and specs/006, write "the bootstrap admin
    (also allowed-domain)" so the domain rule for the bootstrap admin (AC-1.4) is explicit.
  - Optionally, note the approve check order in plan.md (validate, then CAS inside the
    transaction, with P2002 as the race backstop).
- **Test quality (4).** Scope the `operai.test` allowlist push in
  `invitations.routes.test.ts:35` with `beforeAll`/`afterAll`.
- **Code quality (4).** Replace the `as 300` cast with an `as const` source constant, and move
  `serializeInvitation` to a shared module.
- **Design fidelity (4).**
  - Go back a page when a decision empties the current page.
  - Give the results region a visible focus ring.
  - Set design.md to `approved`.
- **Operator note (owasp, low).** `infra/README.md` query (b) hardcodes `welld.ch`/`welld.it`.
  Keep it in sync with `ALLOWED_SIGNUP_DOMAINS`.

## Recommended next step

- PASS: the spec may move to `done`. The findings above are optional follow-ups and none of
  them blocks.
