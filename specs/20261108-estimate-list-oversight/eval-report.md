---
spec: 20261108
evaluated: 2026-11-09
rubric: default-v2
score: 83.5
verdict: PASS
---
# Eval report: EstimAI list — every estimate for admins, closed estimates out of the way, the deal at a glance

Rubric: `default-v2`, from the plugin-bundled copy
(`~/.claude/plugins/cache/wellforge/wellforge/2.57.1/config/eval-rubric.yml`). There is no
`gates/configs/eval-rubric.yml` and no `.wellforge-gates/` copy in this repo, and no
`specs/20261108-estimate-list-oversight/eval.md`, so no overrides apply. `design.md` exists, so
`design_fidelity` applies and the total is normalised over 115 weight points.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | All 22 ACs met with passing tests. US-1 and US-2 can also be seen working end to end in `shell/e2e/estimate-oversight.spec.ts` (All → stranger's estimate read-only → All+Closed). US-3 (AC-3.1–3.8) is backed by tests only: there is no live crm-api → estimai-api run, by plan design |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | The contracts match plan.md § API contracts, and the T12 amendments are written into plan/ADR 20261108-estimai-oversight-permission-amends-0036. One undocumented change: the system route answers 401 to every bad credential, where the plan says 403 for wrong scope/sub. design.md is still `status: draft`, and its F3/G4 text contradicts the plan's errorComponent decision |
| Test quality | 20 | 5 | 3 | 20.0 | `estimates.routes.test.ts` "specs/20261108-estimate-list-oversight — oversight read path" checks that the resolver gets no call on the owner path, that the 404 is byte-identical, same-token revocation, refusal caching and the outage split (503 on read, 404 on write). `dealLinkNotices.routes.test.ts` covers repeats, older notices, equal-time ties, other-deal unlink, future `at`, strict body and aud/scope/sub/user-JWT. The UI tests cover out-of-order responses, waiting for permissions, and storage that throws |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | Idiomatic: Effect, RFC 7807 codes, a single conditional raw-SQL UPDATE (the reason is documented: it keeps `@updatedAt` unchanged), a notice client that never throws with a timeout and `redirect:"error"`. Nits: the best-effort notice is awaited on the CRM request path; `permissionsLoaded` is inferred heuristically (`EstimatesPage.tsx`, epoch>0 \|\| apps) |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md is complete: 7 flows, a full state table, a 4-cell empty matrix, an a11y section and a reuse inventory (13 reused : 2 new). The build realises it (`focusOnMount` 403 panel, 503 Banner, live `loadedContext`, `DealBadge` aria-label/`navigateSuite`, `estimate-row-oversight`, "You" rows, oversight Banner). Differences: G4 "redirect with notice" became an error page (decided in plan, not reflected in design.md), and the design's manual contrast pass is not evidenced |
| Trajectory | 10 | 4 | 2 | 8.0 | Run trace `.forge/runs/2026-11-09T13-13-59Z-implement-024-…json`: QE was BLOCKED (env), then e2e passed 15/15, owasp-reviewer PASS with 4 low findings, fixed in f888a453 (T12) with tests. Gaps: `verdicts.qe = PASS` was recorded by the main loop, not a QE re-run; implementation agents for T1–T9 are not in the trace; T12 comes after the trace |
| **Total** | **115** | | | **96.0/115 → 83.5/100** | |

**Verdict: PASS.** The score is 83.5, above `pass_score` 80, and every applicable dimension is at or above its floor. AC satisfaction is exactly at its floor of 4.

## Findings

- **AC satisfaction (4).** Every AC has a passing test. Observable behaviour (a run through the
  real stack) exists only for US-1/US-2 (`estimate-oversight.spec.ts`; 15/15 with the EstimAI
  regression specs). For US-3 the evidence is per service:
  - crm-api `estimate.test.ts` "deal-link notices to EstimAI" covers AC-3.4, 3.5 and 3.8;
  - estimai-api `dealLinkNotices.routes.test.ts` covers AC-3.5 and 3.6;
  - `backfill-estimate-links.test.ts` covers AC-3.7;
  - estimai-ui `DealBadge.test.tsx` and `EstimatesPage.test.tsx (L)` cover AC-3.1–3.3.

  AC-3.5's "deal is deleted" branch has no code path (crm-api has no deal deletion). This is
  recorded in plan.md and ADR 20261108-crm-pushes-deal-links-to-estimai. To reach 5: one cross-service journey that shows the
  badge, e.g. a stack run with a crm-api service credential, or a scripted request → list →
  unlink → list check.
- **Spec fidelity (4).**
  - **401 instead of 403.** plan.md § API contracts gives `403 — wrong scope or sub` for
    `POST /system/deal-link-notices`. The implementation answers one identical 401 for every
    bad credential (`systemAuth.middleware.test.ts` "every rejection carries the same body"),
    and the route's OpenAPI lists 401 only. The choice is defensible, but it is not written
    into the plan.
  - **design.md out of date.** It is still `status: draft`, and its F3 text ("503 → redirect
    to list with a notice") contradicts the implemented `EstimateRouteError` panel. The
    supersession lives only in plan.md § Decisions.
  - **Save badge commit.** 2947be3 (the save badge) landed in the same window. It is a
    separate commit, declared outside 024 and not mixed into its diffs.

  To reach 5: amend the plan contract to 401, and mark design.md approved with G4 updated.
- **Code quality (4).**
  - `sendDealLinkNotice` is awaited after commit inside `POST/DELETE /deals/{id}/estimate`.
    When estimai-api is slow, the CRM response can wait for a token fetch plus up to two
    5 s attempts. This copies the ADR 20261105-estimai-closes-the-estimate-crm-follows pattern and never fails the action, but it adds
    latency.
  - `permissionsLoaded = epoch > 0 || apps.length > 0` infers that permissions have loaded,
    because `usePermissions` has no loaded flag (design G1). That is correct for any user
    who can reach EstimAI, but it is a heuristic, not a signal.
- **Design fidelity (4).** See above: the G4 divergence is not written back into design.md,
  and there is no evidence of the planned two-theme contrast check for the Oversight
  (neutral) and Deal (accent) badges.
- **Trajectory (4).**
  - The QE verdict became PASS without the QE agent re-running; the main loop recorded it
    after fixing the env fault and running e2e itself.
  - T12 (f888a453) was verified by estimai-api tests (345/0, fresh) but has no run-trace
    entry.
- **Known notes, weighed.**
  - The unpaginated `whose=all` list is an ADR 20261108-estimai-oversight-permission-amends-0036 decision, with a >500-row warning
    (`OVERSIGHT_LIST_REVISIT_ROWS`). The warning itself is untested, which is acceptable
    because it is not an AC.
  - Testing AC-3.5/3.6 per service follows the plan's test strategy.
- **Fresh evidence gathered by the evaluator.** `estimai-ui` vitest: 30 files, 355/355 pass
  (2026-11-09 14:46).

## Recommended next step
- PASS: the spec may move to `done`, after the owner's review of the decisions flagged in
  plan.md § "Decisions on the design's gaps".
- Optional clean-up before closing (no re-implementation needed):
  - align plan.md's 401/403 contract line;
  - mark design.md approved, with G4 updated to the errorComponent decision;
  - append T12 to the run trace.
