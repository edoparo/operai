# QE report — specs/022-projects-handoff (T17, QE-light, rigor mvp, advisory mode)

Measured at `22658b0` (code identical at `b681713`, the HEAD at hand-over: the commits in between
touch only `specs/**`). Date 2026-11-05. Tree clean; this QE pass added no tests and no code.

## QE verdict: FAIL (advisory mode, rigor mvp — coverage advisory)        (measured at 22658b0 / b681713)

FAIL is driven by exactly two rows, neither a gate: **AC-6.1** (known, being fixed by T37, not 022
code) and **D1** (new: the awaiting-PM notice is squeezed at 360 px). One live-pass row is **BLOCKED**
by an environment fault (the dev CRM database lacks 6 migrations): **live row 7** (Delivery card).
Every blocking gate (lint, typecheck, secret scan, SAST) is green.

**Blocked / not executable (first lines, as required):**
1. ENV-FAULT: dev `crm` database is 6 migrations behind (`20261104120000_deal_amount_optional` …
   `20261104210100_offer_sent_backfill`, all from main, none from 022). `crm-api` answers 500
   (`The column company.source does not exist`) on `GET /companies`, `GET /deals`, `GET /deals/{id}`,
   `GET /pipeline`, so the CRM UI and the deal page are down on the dev stack. I tried
   `cd crm-api && direnv exec . bun run db:deploy`; the permission classifier **denied** it and I did
   not work around it. Developer command: `cd crm-api && direnv exec . bun run db:deploy` (the six
   migrations are additive: ADD COLUMN, CREATE TABLE, one DROP NOT NULL, one backfill UPDATE).
   Blocks live row 7 (deal page Delivery card) and the CRM-side half of row 5 (see there).
2. The repo has no secret-scan CI workflow and no installed pre-commit hook (`.git/hooks` empty;
   `betterleaks` not installed). I ran `gitleaks` 8.30.1 (mise) with the repo's `.betterleaksignore`.
3. No persona has EstimAI tool access except admin, so the "user with EstimAI but without this
   estimate" variant of AC-3.2 could not be exercised live (see row 6).

## Gate table

| Check | Threshold | Actual | Result |
|---|---|---|---|
| auth typecheck / tests | clean / green | exit 0 / 696 pass, 0 fail (49 files) | ✓ |
| crm-api typecheck / tests (`crm_test`) | clean / green | exit 0 / 348 pass, 0 fail (27 files) | ✓ |
| notify-api typecheck / tests | clean / green | exit 0 / 255 pass, 0 fail (20 files) | ✓ |
| notify-ui lint / tests | clean / green | exit 0 / 41 pass (8 files) | ✓ |
| crm-ui lint / build / tests | clean / ok / green | exit 0 / built / 207 pass (13 files) | ✓ |
| projects-api typecheck / tests | clean / green | exit 0 / 1166 pass, 0 fail (26 files) | ✓ |
| projects-ui lint / build / tests | clean / ok / green | exit 0 / built / 681 pass (24 files) | ✓ |
| estimai-api typecheck / tests | clean / green | exit 0 / 240 pass, 0 fail (15 files) | ✓ |
| env-doctor (`bun test tools/env-doctor`) | green | 160 pass, 0 fail (6 files) | ✓ |
| Shared copies | in sync | `2 group(s) in sync (serviceToken, manDays)` | ✓ |
| Changeset | bumps for auth, estimai-api, crm-api, crm-ui, notify-api, notify-ui, projects-api, projects-ui | `changeset status`: all eight at minor; `changeset:check` OK (`projects-handoff.md`) | ✓ |
| Secret scan (security floor, BLOCKING) | no leak in the 022 commits | `gitleaks git feat/projects..HEAD` (66 commits): **no leaks**. Full history: 11 findings, none in the 022 range (all on main / PR #7 / the backup branch: test fixtures and one false positive on a table row of `specs/021-projects/qe-report.md:38`) | ✓ |
| SAST-high (BLOCKING) | 0 high | semgrep 1.182 (`p/typescript`, `p/owasp-top-ten`, `p/security-audit`, severity ERROR) on 99 changed source files: **0 findings** (one partial-parse warning on a literal NUL separator in `auth/src/authz/resolver.ts:145`, specs/004 code) | ✓ |
| Dependency audit (advisory; not in the security floor per `rigor-tiers`) | no new critical | osv-scanner 2.7.0 on 8 lockfiles. 022 changes **no dependency** except the `@module-federation/vite` pin (40b52e5). Pre-existing criticals (CVSS ≥ 9): `better-auth 1.6.23` GHSA-965c-763c-88jm 9.1 (auth, a runtime dependency; also in notify-ui's lockfile), `tinypool 1.1.1` 9.5 (vitest tooling, crm-ui/projects-ui/notify-ui), `seroval 1.5.5` GHSA-p6vx-979v-rg4c 9.8 (notify-ui). Many highs (fast-uri, undici, zod, mysql2, vite, brace-expansion …). None introduced by 022 | ADVISORY |
| Line coverage (bun, % lines / % funcs) | ≥ 80% (advisory) | projects-api 97.42 / 95.77; auth 96.67 / 96.05; crm-api 93.73 / 91.57; notify-api 90.37 / 84.25; estimai-api 88.69 / 87.12. Gap to 80%: none. Frontends: no coverage provider installed, not reported | ADVISORY ✓ |
| Shell / estimai-ui unit tests | known pre-existing | shell 91 failed / 214 passed; estimai-ui 2 failed / 274 passed; every failure is `localStorage`/`sessionStorage` undefined (shell: `getItem`/`setItem`/`clear` of undefined and follow-on element-not-found; estimai-ui `ImportOfferModal` sessionStorage). `shell/src` and `estimai-ui/src` are untouched by 022 | NOT COUNTED |
| Design states / a11y (design.md) | — | no `design.md` for 022; the UI was checked against the ACs and the T30–T33 contracts only | n/a |

## AC sweep (36 ACs: the 35 of the brief + AC-6.1 added at b681713)

Evidence = tests executed in the green full runs above (names carry the AC id) plus the live pass.
"Live" refers to the live-pass rows below. No AC lacked a covering test, so none was written.

| AC | Result | Evidence |
|---|---|---|
| AC-1.1 | PASS | `projects-api/src/queue/queue.test.ts`, `lib/crm.deals.test.ts`, `matrix.test.ts`; live 1 (queue for sales: title, company, entity, won date, estimate link, no amount) |
| AC-1.2 | PASS | `queue/take.test.ts`, `projects-ui/.../TakeDealDialog.test.tsx`; live 1 (name prefilled, 4 types, no Internal, ops-manager, referent, dates/terms) |
| AC-1.3 | PASS | `take.test.ts` ("leaves the queue", "refusals leave nothing behind"); live 1 (planned, no PM, one PO) |
| AC-1.6 | PASS | `queue.test.ts`, `take.test.ts`, `db.constraints.test.ts` (dealId UNIQUE) |
| AC-1.8 | PASS | `take.test.ts`, `terms/terms.test.ts`, `TermsFormDialog.test.tsx`; live 1 |
| AC-1.9 | PASS | `queue.test.ts`, `take.test.ts`, `matrix.test.ts`, `scope.test.ts`, `ProjectsShell.test.tsx`; live 3 (nav, 403) |
| AC-1.10 | PASS | `take.test.ts` ("no attach…"), `projects.test.ts` |
| AC-1.11 | PASS | `take.test.ts`, `queue/candidates.test.ts`, `TakeDealDialog.test.tsx` (CRM outage not exercised live) |
| AC-2.1 / 2.2 | PASS | `queue.test.ts`, `crm.deals.test.ts`; live 5 (queue: leaves on reopen, returns on re-win) |
| AC-2.3 / 2.4 | PASS | `projects.test.ts` ("won: false … true again"), `PurchaseOrderCard.test.tsx`; live 5 (notice on page and PO card, gone on re-win) |
| AC-3.1 | PASS | `take.test.ts` ("is a snapshot", "server-owned"), `PurchaseOrderCard.test.tsx`; live 1 (read-only "From the estimate", 76.7 man-days on the PO) |
| AC-3.2 | PASS (observation O1) | `PurchaseOrderCard.test.tsx`; live 6 |
| AC-3.3 | PASS | `PurchaseOrderCard.test.tsx`; live (deal title links to `/crm/deals/<id>`) |
| AC-3.4 | PASS by tests, live BLOCKED | `system/purchaseOrders.routes.test.ts`, crm-api `deals/delivery.test.ts` + `lib/projects.test.ts` (on `crm_test`), crm-ui `DealDetailPage.test.tsx` / `DeliveryCard.test.tsx`; live row 7 blocked by the env fault |
| AC-3.5 | PASS | `take.test.ts`, `TakeDealDialog.test.tsx` |
| AC-3.6 | PASS | `purchase-orders/referent.test.ts`, `take.test.ts`, `crm.contacts.test.ts`, `ReferentPicker.test.tsx`; live 1 |
| AC-3.7 | PASS | `referent.test.ts`, `matrix.test.ts`, `PurchaseOrderCard.test.tsx`; live 4 (pm-it of the other entity sees no edit control) |
| AC-3.8 | PASS | `projects.test.ts` (one contacts call, live change, no cache, "no CRM access"), `referent.test.ts`; live 4 |
| AC-3.9 | PASS | `projects.test.ts` (erased / moved → null), `PurchaseOrderCard.test.tsx` (not exercised live) |
| AC-3.10 | PASS | `projects.test.ts` ("unavailable", still 200), `PurchaseOrderCard.test.tsx` (not exercised live) |
| AC-4.1 | PASS | `queue/candidates.test.ts`, `take.test.ts`, auth `holders.routes.test.ts`; live 1 (ops-ch prefilled; admins listed "All entities") |
| AC-4.2 | PASS | `take.test.ts` (`ops_manager_invalid`, admin accepted), auth holders tests |
| AC-4.3 | PASS, with caveat | `take.test.ts` (one push, English, link, nobody else), notify-api `system/*`, notify-ui; live 2: notification "Purchase order assigned: App mobile onboarding clienti … pick the project manager of this project." linking to the project; the link works from a cold start (3/3) and fails after the user was in the Projects module — that is AC-6.1, known |
| AC-4.4 | PASS | `take.test.ts` ("a notification that cannot be delivered changes nothing") |
| AC-4.5 | PASS | `projects.test.ts`, `ProjectsPage.test.tsx`; live (list cell "Awaiting project manager", filter "None yet") |
| AC-4.6 | PASS (layout defect D1 at 360) | `ProjectDetailPage.test.tsx`; live 2 |
| AC-4.7 | PASS | `projects/transitions.test.ts`, `pick.test.ts`; live 2 (Start disabled with reason; API 409 `awaiting_project_manager`) |
| AC-4.8 | PASS | `pick.test.ts`, `matrix.test.ts`, `PickProjectManagerDialog.test.tsx`; live 2 (pick works; API 403 for ops-it `out_of_scope`, sales `not_ops_manager`, pm-it `out_of_scope`) |
| AC-4.9 | PASS | `pick.test.ts`; live (API 422 `project_manager_required`) |
| AC-5.1 | PASS | `projects.test.ts`, `ProjectFormDialog.test.tsx`; live 8 |
| AC-5.2 | PASS | `projects.test.ts`, `bexio.test.ts`; live 8 (hand-made page shows no PO, referent or ops-manager) |
| AC-5.3 | PASS | `projects.test.ts`, `terms.test.ts`, `TermsFormDialog.test.tsx`; live 8 (end before start refused naming the field) |
| AC-5.4 | PASS | `terms.test.ts`, `TermsCard.test.tsx`; live 8 (terms shown; removed → "No terms yet. Add terms") |
| AC-6.1 | FAIL — known, being fixed (T37) | I hit it (below). Not 022 code; spec/tasks added at b681713 |

**Count: AC coverage 35/36 pass; the 36th (AC-6.1) is known-open (T37). 1 AC (AC-3.4) has its live leg blocked by the env fault.**

## Live pass

Dev stack untouched (not restarted). Own headless Chromium, test-auth sessions. Screenshots in
`/private/tmp/claude-331608204/-Users-edoardo-paronzini-Work-Experiments-operai/81b2a4d5-c9fe-491f-8092-cb8f109563af/scratchpad/qe/shots/` (names below).

| # | Row | Result | What I saw |
|---|---|---|---|
| 1 | sales-ch takes "App mobile onboarding clienti" into a fixed-price project with referent and prefilled ops-manager; sees the estimate's man-days | PASS | Queue lists 4 deals with title, company, entity, won date, estimate link, no amount; the IT deal has no action for sales-ch (S3). Dialog: name prefilled, type Choose/T&M/Fixed/Maintenance/SaaS, ops-manager prefilled "QE022 ops-ch" (admins "QE021 admin — All entities", "Admin — All entities" listed after), referent list "Luca Bernasconi — Responsabile IT", fixed price shows "Estimated man-days: From the estimate" read-only. Created → lands on `/projects/cmw3mzl6x0000xavdu8jbvimz`: Planned, "Awaiting project manager", PO card with deal link, estimate link, ops-manager, referent, terms, **76.7 man-days**. `queue-1280.png`, `take-dialog-1280-fixed.png`, `project-created-1280.png` |
| 2 | ops-ch: notification, fail to activate, pick PM, notice disappears | PASS (link: see AC-6.1) | `/notify` shows "Purchase order assigned: App mobile onboarding clienti — Banca Ticinese SA — pick the project manager of this project." (PROJECTS), link `/projects/<id>`. Start project disabled with "Waiting for a project manager…"; API activate → 409 `awaiting_project_manager`. "Pick project manager" → dialog (7 people) → set → "Project manager picked.", notice gone, Start enabled. `notify-centre-1280.png`, `pick-dialog-1280.png`, `after-pick-1280.png` |
| 3 | pm-it: no "To start", permission-denied on `/projects/queue` | PASS | nav has 0 "To start"; queue page "You do not have access to this. Ask an administrator for the permission…"; API `GET /queue` and `…/ops-managers` → 403. `queue-denied-pmit-1280.png` |
| 4 | pm-it (no CRM access): PO page shows referent | PASS | name, job title, email, phone shown (`mailto:` / `tel:` links with fixed scheme); no CRM request from the browser; pm-it `GET crm /contacts` → 403; no edit control (other entity). `po-referent-pmit-1280.png` |
| 5 | reopen and re-win the deal; notice comes and goes | PASS (via SQL, deviation) | The CRM write routes are down (env fault), so I reopened / re-won by `UPDATE deal` on the dev `crm` DB. Project "Alpina — Portale clienti B2B": base no notice → reopened: notice on the page ("The deal is no longer won. Reopened in the CRM … unchanged") and on the PO card → re-won: gone. Queue: "Licenza wellD Fleet — 25 veicoli" present → absent after reopen → present after re-win. Rows restored to the original stage/closedAt/version. The CRM's own reopen route was not exercised live. `po-notice-reopened-1280.png` |
| 6 | estimate link as a user without EstimAI access | PASS with observation O1 | Link `/estimai/estimates/<id>`. pm-it and sales-ch have no EstimAI *tool* access: the shell silently redirects them to their landing page (`/projects`, `/crm/companies`), no message; estimai-api answers 404 for pm-it. Admin sees the estimate. No persona has EstimAI access without owning this estimate, so EstimAI's own not-found state could not be reached live (admin + bogus id → redirected to the estimate list). `estimate-unavailable-*-1280.png` |
| 7 | project name and Bexio id on the CRM deal page (Delivery card) | **BLOCKED** | `GET crm-api /deals/{id}` → 500 (ENV-FAULT above). Covered by tests only: crm-api delivery tests (crm_test), crm-ui DeliveryCard/DealDetailPage tests, projects-api `/system/purchase-orders` tests, all green. Re-run after `db:deploy` |
| 8 | hand-made `saas` with terms (company required); remove terms | PASS | As pm-it: SaaS shows Company*; submit without it → "Choose a company from the list." and the dialog stays; terms section opt-in; end before start → "The end date must not be before the start date."; valid → `/projects/cmw3nfbcp0003xavdd7wxenil`, Terms card (start/end/SLA/hours), PM = creator, no PO card. "Remove terms" → inline confirm "Remove the terms?" → "Terms · Add terms · No terms yet." `handmade-saas-created-1280.png`, `remove-terms-confirm-1280.png`, `handmade-no-terms-1280.png` |
| 9 | rendered 360 / 1280, focus order and return | FAIL (D1) + advisories | see below |

### Rendered findings (360 px with the sidebar collapsed; 1280 px)

| View | 1280 | 360 |
|---|---|---|
| Queue | ✓ | ✓ no page overflow; table scrolls inside its container, the "New project" column is off-screen until scrolled (advisory) — `r-queue-360.png` |
| Take dialog (saas, long) | ✓ 754 px tall in 900 | ✓ 826 px in a 740 viewport: the backdrop scrolls, the submit button is reachable, no horizontal overflow — `r-take-dialog-top/bottom-360.png` |
| Project page, PO card | ✓ | ✓ no overflow |
| Awaiting notice + pick button | ✓ | **✗ D1** — `r-project-awaiting-360-tall.png` |
| Pick dialog | ✓ | ✓ 293 px, scrolls inside |
| Projects list ("Awaiting project manager") | ✓ | ✓ table in its own scroll container |
| Hand-made create, Terms open | ✓ | ✓ 946 px, backdrop scrolls, no overflow — `r-create-terms-360.png` |

Focus: dialogs open with focus on the first field (take, create) or the combobox (pick), never behind the dialog; Tab order Name → Type → Ops manager → Referent → dates → checkboxes → Cancel / Create stays in the dialog; Esc returns focus to the trigger (take dialog → the row's "New project", pick dialog → "Pick project manager", create → "New project"). On success of the pick, focus falls to `<body>` because its trigger disappears (A1, advisory).

## Defects

**D1 (new, ✗) — the "Awaiting project manager" notice is unreadable at 360 px.** Frontend (projects-ui, or the shared `Banner` in operai-ui — owner to decide).
Repro: log in as `qe022-ops-ch@operai.test`, 360 × 740, open `/projects/c73wfia5p1vlhf9hjuy7cr4w2`, collapse the sidebar. The `<Banner actions=…>` is `.banner-content` 51 px + `.banner-actions` 142 px ("Pick project manager", `flex-shrink:0`, no wrap) in one row, so the notice text breaks one word per line ("QE022 / ops-ch / is the / ops / manager …"). Evidence `r-project-awaiting-360-tall.png`. Class sweep of placements: awaiting notice on the project page ✗ (360), ✓ at 1280; "deal no longer won" notice on the page and on the PO card have no actions ✓; the take dialog, pick dialog and list have no Banner-with-actions ✓. The same shared Banner-with-actions is used by inventory-ui `AssetActions` (not 022, not checked). First pass: not a regression of a fix.

**D2 (minor, advisory) — stale validation message.** Frontend. In the hand-made create dialog, after a failed submit "Choose a company from the list." stays visible after the company is chosen (it clears only on the next submit). Repro: `/projects` as pm-it → New project → name, type Maintenance → Create project → choose a company → message still shown (`handmade-stale-error-1280.png`). Placements: Company ✗; the Project-manager combobox in the same dialog was not checked.

**D3 (known — being fixed, T37 / AC-6.1) — stale router after a module switch.** Observed instance relevant to AC-4.3: as ops-ch on `/projects`, click the shell bell (`/notify`), click the notification → `GET /projects/notify` → 404 then the project URL renders "Project not found" (3/3). Also `/projects` → bell → "Projects" in the sidebar → "Project not found". From a cold load of `/notify` the link works (3/3). Not investigated further, as instructed. I could not reproduce it on the CRM list with the same steps.

## Environment faults (not defects)
- **ENV-FAULT: dev `crm` DB 6 migrations behind** (see top). Checked: `prisma migrate status` (read-only) lists the six pending; the 500 reproduces by `curl` with an admin JWT on four routes; `crm_test` is migrated, hence the green crm-api suite. Fix: the developer's `db:deploy`.

## Observations for the PO / owners (not defects, no fix round)
- **O1 (AC-3.2):** a user with no EstimAI tool access who clicks "Open the estimate" is redirected by the shell to their landing page with no explanation (the AC says "sees it as unavailable"); the PO may want a message or a disabled link. Shell behaviour, untouched by 022.
- **O2:** the shell leaves the sidebar expanded at 360 px (224 px of 360; content ~136 px) until collapsed by hand. Pre-existing, shell untouched by 022.
- **A1 (a11y):** after "Set project manager" succeeds, focus lands on `<body>`; consider moving it to the status message or the heading.
- The pick and referent lists show the project users' e-mail addresses (pick dialog) and the referent's e-mail/phone to every `projects:access` holder: accepted by D49 / `security-review.md`.
- Dependency criticals above (better-auth in auth) are pre-existing; the owner should schedule an upgrade outside 022.
- Deferred and not exercised live: AC-1.11 CRM outage, AC-3.9 erased referent, AC-3.10 CRM outage on the PO page (unit-tested only); shell e2e journey; production provisioning (as the spec states).

## Re-run requirements (projects-ui changes after this pass, T37 touches every `*-ui/src/App.tsx`)
A re-run must cover, at the new HEAD:
1. Gates: `projects-ui`, `crm-ui`, `notify-ui` lint / build / test (plus `admin-ui`, `estimai-ui`, `inventory-ui`, `refund-ui` as T37 lists), the gitleaks scan, semgrep on the new diff.
2. Live rows that run through projects-ui: 1, 2 (including the **warm** notification link: `/projects` → bell → link), 3, 4, 8, 9 (all projects-ui views at 360 and 1280, focus order/return), and the T37 check `/projects` → `/admin` → back, `/crm` → `/admin` → back.
3. D1 and D2 if fixed in projects-ui (or operai-ui, then every consumer).
4. **Live row 7** (Delivery card) and the CRM-side of row 5 once the developer has run `db:deploy` on the dev `crm` DB.
5. AC-6.1.

## Dev data changed during this pass
- Taken deal: "App mobile onboarding clienti" (Banca Ticinese) is now a project `cmw3mzl6x0000xavdu8jbvimz` (fixed price, referent Luca Bernasconi, PM now **QE021 pm-it**, ops-manager QE022 ops-ch); the queue holds 3 deals now. One unread in-app notification for QE022 ops-ch (and the matching one-time state in notify DB).
- Hand-made project `cmw3nfbcp0003xavdd7wxenil` "QE022 SaaS licence — hand-made" (saas, welld_it, company Alpina Logistik AG, PM pm-it, terms removed).
- CRM `deal` rows `czh7januxvzc4hqfhfxeav3a0` and `c6lzp75cmu92aniw6ffa306pe` were reopened / re-won by SQL and **restored** to stage `won`, original `closedAt`, `version` 1 (`updatedAt` untouched).
- Test-auth sessions minted for the listed personas (names unchanged). Test suites ran against `crm_test`, `projects_test` and the shared `operai_auth` (existing practice). `pnpm build` wrote the (git-ignored) `dist/` of crm-ui and projects-ui.
- No env file read or written; the stack was not stopped; no schema change was applied (the `db:deploy` was denied).

## Recommendation
Run the `owasp-reviewer` pass (it is in progress in parallel; implementation review is appended in `security-review.md`). Areas I touched but did not review in depth: referent data crossing CRM → projects-api → browser (observed: no browser request to CRM, `no-store` not re-checked live), the auth holders listing, and the ops-manager override.
