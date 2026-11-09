---
id: 024
slug: estimate-list-oversight
status: in-progress
rigor: production
created: 2026-11-08
approved: 2026-11-08
---

# EstimAI list: every estimate for admins, closed estimates out of the way, the deal at a glance

## Amendments

- **Amends specs/013 (estimate sharing) and ADR-0036/0037.** So far an estimate opens only for
  its owner or a collaborator. This spec adds a third, read-only way in: an admin may open
  any estimate (US-1).
- **Amends specs/018 AC-3.3 and ADR-0073.** Closing an estimate also takes it out of the
  default list for everyone (US-2). Who may close, read-only while closed and the CRM notice
  are unchanged. Archiving is the same thing as closing (owner, 2026-11-08); there is no
  separate archived status.

## Problem

The EstimAI list shows only the estimates a person owns or was invited to. An admin who has
to know what is being estimated across the company sees nothing beyond their own. Estimates
that are finished stay in the list next to the ones in progress, so the list grows forever
and the current work gets harder to find. And nothing in the list says whether an estimate
belongs to a CRM deal: a technician cannot tell which estimates a salesperson is waiting
for.

## User stories

### US-1: An admin sees every estimate, read-only
As an admin, I want to list and open every estimate in EstimAI, so that I know what is being
estimated without asking each owner to share it.

**Acceptance criteria:**
- AC-1.1: Given a user who holds the new EstimAI "read every estimate" permission, when they
  open the list, then a "Whose" control offers **Mine** (the default) and **All**.
- AC-1.2: Given a user without that permission, when they open the list, then the "Whose"
  control is not shown, and asking the server for every estimate returns 403.
- AC-1.3: Given an admin on **All**, when the list loads, then it contains every estimate in
  EstimAI, including those they neither own nor collaborate on. Each row shows the name, the
  owner, the last-updated date and the deal badge (US-3).
- AC-1.4: Given an admin who neither owns nor collaborates on an estimate, when they open it,
  then they see it in full and can export it (XLSX, PDF). Edit, close, reopen, delete and
  sharing are not offered, and the server refuses each of them with 403.
- AC-1.5: Given an admin who owns or collaborates on an estimate, when they open it, then
  their own access level applies, as before (the read-only rule of AC-1.4 never removes a
  right they already have).
- AC-1.6: Given the permission is withdrawn from a user, when they next load the list or
  open an estimate they reach only through it, then they get Mine only, or 404 for an
  estimate that is not theirs. No sign-out is needed (ADR-0007's live resolution).
- AC-1.7: Given `auth` cannot answer whether the caller holds the permission, when they ask
  for **All** or open an estimate only through it, then the request fails (503). The caller's
  own and shared estimates keep working.
- AC-1.8: The permission is granted to the `admin` role by the seed and to no other role.

### US-2: Closed estimates leave the default list
As an EstimAI user, I want closed estimates out of my list unless I ask for them, so that the
list shows the work still in progress.

**Acceptance criteria:**
- AC-2.1: The list has a "Status" control with **Open** (the default) and **Closed**,
  combinable with the "Whose" control (e.g. All + Closed).
- AC-2.2: Given an estimate is closed (by its owner or an editor, as today), when anyone who
  can see it loads the list with **Open**, then it is not there. With **Closed** it is, and
  the row says it is closed.
- AC-2.3: Given the owner or an editor reopens a closed estimate, then it is back under
  **Open** for everyone who can see it.
- AC-2.4: A closed estimate opened from the **Closed** list is read-only, as today. The owner
  or an editor can reopen it from there.
- AC-2.5: Estimates already closed when this ships appear under **Closed**.
- AC-2.6: The chosen "Whose" and "Status" survive a reload of the page and a return to the
  list from an estimate.

### US-3: The list shows which estimates belong to a deal
As a technician or a salesperson, I want to see in the list which estimates belong to a CRM
deal, so that I know which ones somebody is waiting for.

**Acceptance criteria:**
- AC-3.1: Given an estimate linked to a CRM deal, when it appears in the list (any "Whose",
  any "Status"), then its row shows a **Deal** badge.
- AC-3.2: Given the viewer can open the CRM, when they activate the badge, then the deal
  opens (`/crm/deals/:id`). Given the viewer cannot open the CRM, then the badge is shown but
  is not a link.
- AC-3.3: The badge never shows the deal's title, its company or any amount: EstimAI learns
  only that a deal exists and its id.
- AC-3.4: Given a deal requests an estimate (specs/018 AC-3.1), then the new estimate carries
  the badge from its first appearance in the list.
- AC-3.5: Given EstimAI is reachable and the deal's estimate is unlinked, or the deal is
  deleted, then the next list load after the CRM change shows the estimate without the
  badge.
- AC-3.6: Given the same CRM change is reported to EstimAI twice, or two changes arrive in
  the wrong order, then the badge ends up matching the CRM's latest state.
- AC-3.7: Given estimates linked to deals before this ships, then they show the badge once
  the feature is live, with no action by their users.
- AC-3.8: Given EstimAI cannot be told about a CRM change at that moment, then the CRM change
  itself still succeeds; the badge may lag (see Open questions).

## Non-goals

- **Admin writes.** An admin never edits, closes, reopens, deletes or shares an estimate they
  reach only through **All**. If they need to, the owner adds them as a collaborator.
- **A separate archived status.** Archive and close are one status (owner, 2026-11-08).
- **Changing who may close.** Owner or editor, unchanged (ADR-0073).
- **Deal details in EstimAI.** No deal title, company, stage or amount in EstimAI; the CRM
  stays the only place for them.
- **The badge on the estimate page.** This spec covers the list only.
- **Search, sorting or paging changes.** The list keeps its current order and size.
- **Notifications.** Closing still notifies only through the CRM as today; an admin opening an
  estimate notifies nobody.
- **Entity- or department-scoped oversight.** The permission sees every estimate; narrower
  scopes (the catalog already declares the conditions) are not built.

## Constraints

Owner's decisions, 2026-11-08, recorded as given:
- "Admin 'All estimates': read-only. A new EstimAI catalog permission (e.g.
  `estimate:read-all`, seeded to `admin` only) resolved live against auth, failing closed;
  amends ADR-0036."
- "Archive and close statuses can be collapsed in one status." Who closes: owner or editor.
- "CRM pushes the link: crm-api sends estimai-api a content-free notice when a deal links or
  unlinks an estimate (mirror of ADR-0073, service JWT). estimai-api stores the deal id; the
  list shows a 'Deal' badge, clickable to /crm/deals/:id. Works for users without CRM access
  too (badge only, no title)."
- Filters: two controls, "Whose" (Mine / All) and "Status" (Open / Closed).

## Open questions

- [ ] Delivery of the CRM's link notices: best effort (a lost notice leaves a stale badge
  until the next change or a re-run of the backfill) or retried until delivered. The badge is
  informational, so best effort is the proposed default. — owner: architect (plan). Accepted
  as risk by the owner at approval (2026-11-08).
