---
spec: 023
evaluated: 2026-11-05
rubric: default-v2
score: 64.3
verdict: FAIL
---
# Eval report: Access to Operai only by invitation, with a waiting list

Rubric: `~/.claude/plugins/cache/wellforge/wellforge/2.56.0/config/eval-rubric.yml` (plugin-bundled copy,
`version: default-v2`). The lookup found no `gates/configs/eval-rubric.yml` and no
`.wellforge-gates/...` copy, and there is no `specs/023-signup-gate/eval.md` override.
`design.md` exists, so `design_fidelity` applies and the weight pool is 115.

Evidence base: diff `9d0fbb9..HEAD`. 59e9b48 (`fix(deps)`) is judged as trajectory only.
I re-ran two suites in this eval:
- auth feature suites (`src/signup`, `src/test-auth`, `src/invitations`, `env.startup`,
  `signin`, `authz/audit`, `auth.config`) on the isolated `_main` DB: **274 pass / 0 fail**.
- admin-ui `AccessRequestsPage`, `ApproveAccessRequestModal`, `accessRequestConflict` and
  `InvitationsPage` tests: **53 pass**.

The full-gate numbers (auth 742/0, e2e set identical to the 9d0fbb9 baseline, access-requests.spec.ts 3/3)
come from the closing QE and run trace `2026-11-05T16-26-58Z`. I did not re-run them.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | **2** | 4 | 14.0 | Code ACs: strong. AC-1.1–1.5 and AC-1.8 are tested through the real `createOAuthUser` (`signupGate.test.ts:131-218`, including T-INT-1/2 and unverified-email/bootstrap edge cases). AC-2.1–2.4 cover the race and the rejected/approved branches (`:243-322`). AC-3.1–3.10 have the CAS race, approve-vs-reject, the three 409 codes, email-failed, audit rows and a route-table assertion (`accessRequests.routes.test.ts:118-347`). AC-3.8 `:324`, AC-4.1–4.3 in `notifyAdmins.test.ts`, AC-5.1 in `createInvitation.ts:85` plus the invitations tests, AC-6.2 SQL in `infra/README.md:1539-1569`. **AC-6.1 is met only on the surface.** The amendments point to 023 but describe the wrong rule. `specs/004 spec.md:149-151` now says the `employee` default applies to anyone "holding a valid invitation **or whose email domain is in `ALLOWED_SIGNUP_DOMAINS`**". `specs/006 spec.md:15-17` says "entry is by invitation **or an allowed email domain**". Under 023, an uninvited person in an allowed domain does NOT become a user (AC-1.2). So a spec in `specs/` still describes an uninvited path that gives `employee`, which is the very contradiction US-6 exists to remove. |
| Spec fidelity | 20 | 3 | 3 | 12.0 | The code follows the plan closely: four-step gate (`signupGate.ts:64-84`), plan.md's state table (`accessRequests.repo.ts:48-115`), API contracts (`accessRequests.routes.ts`), ADR-0072 binding (`systemAuth.middleware.ts:53`). Drift: (1) operator- and agent-facing docs state a different admission rule from the approved spec. `AGENTS.md` auth line: "creates a user only for an invitation holder **or** an `ALLOWED_SIGNUP_DOMAINS` email". `AGENTS.md` admin-ui line: access requests "from people **outside** the allowed domains" (inverted; they come from people inside). Also `infra/README.md:1541-1542` and `.changeset/invitation-only-access.md`. ADR-0071 is correct. (2) Approve validates before the CAS (`accessRequests.routes.ts:182-219`), where the plan put the CAS first and the checks inside the transaction. Harmless because the unique index and the CAS backstop it. (3) T14 applied `encodeURIComponent` to every admin-ui path, not just access-request ids. Harmless hardening. |
| Test quality | 20 | 4 | 3 | 16.0 | The tests would fail if the behaviour broke. They drive better-auth's real `createOAuthUser` inside the endpoint context, assert that no user/account/user_role/session row exists, cover concurrent first sign-ins (one row, one set of notices), concurrent approves and approve-vs-reject, and notify 500/mint/network/admin-lookup failures. Each admin-ui state and flow has a component test (`AccessRequestsPage.test.tsx:98-353`), including focus after a decision. Gaps: AC-1.6 is tested by calling `createSession` directly (`signupGate.test.ts:221-230`), not the planned `handleOAuthUserInfo` sign-in, so "hook not consulted on re-entry" is inferred rather than shown. `invitations.routes.test.ts:35` pushes `operai.test` onto the shared `env` and never undoes it (drift event unresolved). AC-6.1's "review" check was a grep, which is how the inverted amendment text got through. |
| Code quality | 15 | 4 | 3 | 12.0 | Idiomatic Hono/zod-openapi, RFC 7807 problems with a `code` extension, `withAudit` extended to arrays (`audit.ts:85-109`). Fail-closed gate, notices not awaited and never throwing, logs free of email/name, control-character stripping (`notifyAdmins.ts:27-32`). No invented APIs: the abort contract is pinned by tests. Nits: `SERVICE_TOKEN_TTL_SECONDS as 300` cast (`serviceToken.routes.ts:268`, QE suggested `as const`, unresolved); `serializeInvitation` imported from a routes module; the approve 409 cause is found again with a second query; non-null assertions after re-reads. |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md is thorough: F1–F7, every list state, an a11y plan and a reuse map of 17 reused elements to 3 new ones. The build follows it: default Pending filter, columns that depend on the filter, labelled row buttons, a warning banner that persists and has an "Open Invitations" action, focus moved to the results region after a decision, Cancel returning focus, Approve disabled when the catalog fails while Reject still works (`AccessRequestsPage.tsx:252-442`). Tab test ids are now explicit (`UsersSubNav.tsx:13-16`) and the invite 422 goes to the email field (`InvitationsPage.tsx:254`, `UsersPage.tsx:330`). Thin: deciding the last row on page > 1 shows an empty state instead of stepping back a page; the focusable results region uses `outline-none`, so the programmatic focus target has no visible ring; design.md frontmatter still says `status: draft`. |
| Trajectory | 10 | 4 | 2 | 8.0 | Five v3 run traces cover batches 1–3, T10/T13 and T14/T12. Each batch had an owasp-reviewer and QE pass. The coordinator caught the T10 agent ticking an unmet box and unchecked it (d8da8ea). The plan was amended before the fix (f69d132, then T13). The e2e was measured against a recorded 9d0fbb9 baseline. Low findings were turned into T14. The closing QE FAIL on CVEs was handled by a separate, user-decided chore (59e9b48) and then re-gated. Deductions: the T10 agent touched the other checkout's shared DBs and added scaffolding grants that broke 4 auth tests (env_faults); several drift events are left `resolved: false`; the batch-1 QE passed T11's inverted doc text. |
| **Total** | 115 | | | **74.0 / 115 → 64.3/100** | |

**Verdict: FAIL.** 64.3 is below the pass score of 80, and AC satisfaction (2) is under its floor of 4. Without the AC-6.1 defect the total would be about 82.6 (ac=5), so this one documentation defect decides the verdict.

## Findings

- **AC satisfaction (2, below floor 4): AC-6.1 is met on the surface only.** Both amendments
  exist and cite specs/023 and ADR-0071, but they state the admission rule wrongly:
  - `specs/004-auth-roles-permissions/spec.md:149-151`: "one holding a valid invitation or whose
    email domain is in `ALLOWED_SIGNUP_DOMAINS`" receives the `employee` default.
  - `specs/006-user-invitations/spec.md:15-17`: "entry is by invitation or an allowed email
    domain, and others file an access request". Out-of-domain people cannot file one (AC-1.3).

  The code is correct. The next feature built from these specs would assume that an allowed
  domain is enough, which US-6 exists to prevent. To clear the floor: reword both amendments
  to "only a person holding a live pending invitation (verified email) or the bootstrap admin
  becomes a user; an allowed-domain person without one is recorded on the waiting list; anyone
  else is refused". Then check the content against AC-1.2/1.3, not just with a grep.
- **Spec fidelity (3): the same misstatement is in four more places.**
  - `AGENTS.md` auth line (an invitation holder "or an `ALLOWED_SIGNUP_DOMAINS` email").
  - `AGENTS.md` admin-ui line (access requests "from people outside the allowed domains", which is inverted).
  - `infra/README.md:1541-1542`, the operator runbook for this feature.
  - `.changeset/invitation-only-access.md` ("creates a user only for someone holding a valid
    invitation or an email in an allowed domain"). This text goes into the CHANGELOG.

  AGENTS.md is loaded into every agent's context, so the wrong rule spreads. The fix is a few lines.
- **Test quality (4).**
  - Run AC-1.6 through the real OAuth re-entry path (`handleOAuthUserInfo`, or `createOAuthUser`
    on an existing account) as the plan specified.
  - Scope the `operai.test` allowlist push in `invitations.routes.test.ts:35` with
    `beforeAll`/`afterAll`.
- **Code quality (4).** Replace the `as 300` cast with an `as const` source constant, and move
  `serializeInvitation` to a shared module. Neither blocks.
- **Design fidelity (4).**
  - Step back a page when a decision empties the current one.
  - Give the results region a visible focus indicator, or keep it `outline-none` and document why.
  - Set design.md to approved.

## Recommended next step

- FAIL. Route back through `/wellforge:implement` with a small docs task under **T11
  (AC-6.1)**: correct the specs/004 AC-6.3 and specs/006 Problem amendments, the two
  `AGENTS.md` lines, `infra/README.md` § "Users who entered without an invitation", and the
  `.changeset/invitation-only-access.md` body so they match AC-1.1–1.4 and ADR-0071. Then
  re-run QE with a content check of AC-6.1 and re-run `/wellforge:eval`.
- Optional in the same pass: the AC-1.6 test path and the env-fixture leak (test quality).
