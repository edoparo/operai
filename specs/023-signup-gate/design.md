---
spec: 023
status: draft
---

# Design: Access to Operai only by invitation, with a waiting list

Sources read: `spec.md`, `plan.md` (approved 2026-11-05); `operai-ui/docs/building-pages.md`,
`design-system.md`, `operai-ui/src/index.ts`; `admin-ui/src/pages/InvitationsPage.tsx`,
`components/InviteUserModal.tsx`, `UsersSubNav.tsx`, `InvitationStatusBadge.tsx`,
`lib/statusMeaning.ts`, `lib/inviteConflict.ts`, `strings/*`, `router.tsx`;
`auth/src/signin/signin.routes.ts`. Source inspection only (no dev server, per brief).

UI surfaces in scope: (1) admin-ui "Access requests" view, (2) admin-ui `InviteUserModal` 422
message, (3) the hosted sign-in page's three new messages (placement check only).
Everything else in the spec (gate, notifications, audit, docs) has no UI surface.

## Flows

Entry points to the new view: the "Access requests" tab in `UsersSubNav`, and the in-app
notification / email link `/admin/users/access-requests` (US-4, AC-4.1).

### F1 - Review the waiting list (US-3 / AC-3.1, AC-3.10)

1. Admin opens `/admin/users/access-requests` (tab, or notification link). The shell's
   `navigateSuite` drives the shell router to the absolute path; admin-ui's inner router
   (basepath `/admin`) resolves `/users/access-requests`. The link carries no query, so the
   view always opens on the **Pending** filter (filter is component state, not URL, like
   Invitations). Deep link therefore lands on the pending list. Confirmed, no change needed.
2. Page shows loading skeleton, then exactly one of: pending list / empty / error.
3. Admin can switch the filter to Approved or Rejected (page resets to 1); those rows show
   who decided and when.
4. Exits: a row action (F2/F3); another view via `UsersSubNav`; 403 -> `PermissionDenied`
   (AC-3.10; the tool itself is already admin-gated, this is the mid-session race).

### F2 - Approve a request (AC-3.2, 3.3, 3.5, 3.6, 3.7)

1. Pending row -> "Approve" opens the **Approve dialog** (`FormDialog`): requester email
   and name shown, roles and departments checkbox groups, none preselected, copy stating
   the zero-selection outcome (see Screens).
2. "Approve and send invitation" -> `POST .../approve {roleIds, departmentIds}`; button busy,
   dialog not dismissible.
3. Success `200`: dialog closes, list reloads (row leaves Pending). Banner:
   - `emailDelivery: "sent"` -> success tone: "Approved. Invitation sent to <email>."
   - `emailDelivery: "failed"` -> **warning** tone (never auto-dismissed): "Approved, but the
     invitation email could not be sent to <email>. Resend it from Invitations." with a link
     action to `/users/invitations` (AC-3.7).
4. Errors, dialog stays open and request is unchanged unless noted:
   - 409 `active_user_exists` -> inline: "<email> already has an Operai account. Change their
     roles from the user's page instead." (AC-3.5)
   - 409 `pending_invitation_exists` -> inline: "An invitation is already pending for
     <email>. Resend it from Invitations instead." (AC-3.5)
   - 409 `already_decided` -> dialog closes, list reloads, **warning** banner: "Someone else
     already decided this request. The earlier decision stands." (AC-3.6, see F4)
   - 422 `domain_not_allowed` -> inline: the domain list may have shrunk (plan).
   - 422 other (stale role/department id) -> inline "One or more selected roles or
     departments no longer exist." (reuse `users.invite.stale`).
   - 404 -> dialog closes, reload, warning "This request no longer exists."
   - 401 handled by `apiFetch`; 403 -> `PermissionDenied`; network / 5xx -> inline generic
     "Could not approve this request. Try again."

### F3 - Reject a request (AC-3.4, 3.6)

1. Pending row -> "Reject" opens a `ConfirmDialog tone="danger"`: states that nothing is
   sent to the person, that signing in again will not reopen it, and that an admin can still
   invite them directly (AC-2.3).
2. Confirm -> `POST .../reject`; busy, not dismissible.
3. Success: dialog closes, list reloads, success banner "Request from <email> rejected."
4. Errors: 409 `already_decided` as F4; 404 as F2; other -> inline in the dialog.

### F4 - Already decided by another admin (AC-3.6)

Approve or reject returns 409 `already_decided`: close the dialog, reload the current filter
(the row disappears from Pending), show the warning banner "Someone else already decided
this request. The earlier decision stands." The admin finds the decision under Approved or
Rejected. No retry action.

### F5 - Invite outside the allowed domains (US-5 / AC-5.1)

From the Invitations screen (or the Users list's "Invite user", which shares the modal):
submit an address like `x@gmail.com` -> 422 `domain_not_allowed` -> the **email field**
shows the message naming the allowed domains, focus returns to the email input, nothing is
stored or sent. Modal stays open. (Today a 422 goes to the general alert; this code is
routed to the field instead because the cause is the email.)

### F6 - Requester's sign-in outcomes (AC-1.2, 1.3, 2.3, 2.5)

Provider callback -> `/sign-in?error=<code>` -> the hosted page shows one message in the
existing `.error-banner` (`role="alert"`) above the provider buttons. No other requester UI
exists (AC-2.5).

### F7 - Non-admin / denied (AC-3.10)

Page load or action returns 403 -> `PermissionDenied` (existing, `StatePanel role="alert"
focusOnMount`) replaces the page content, same as every admin-ui screen.

## Screens & states

### S1 - Access requests list (`AccessRequestsPage`, route `/users/access-requests`)

Structure (copies `InvitationsPage`): `<section aria-labelledby="admin-access-requests-heading"
data-testid="admin-access-requests-page">` -> `UsersSubNav` -> `PageHeader` (title "Access
requests", description, **no** action button: requests only come from sign-ins, so there is
nothing to create) -> catalog `ErrorBanner` -> `SuccessBanner` -> filter row -> one state
block. Column is the tool's existing `default`.

Filter: a labelled `<select>` (same control as the Invitations status filter) with
Pending (default) / Approved / Rejected. No "All" and no email search: the AC list asks for
neither (not designed, see Scope notes).

Table (`DataTable`, caption "Access requests", `rowHeader` = email), columns depend on the
filter so no column is empty:

| Filter | Columns |
|---|---|
| Pending | Email (row header) - Name - Sign-in provider - Last asked (`formatDateTime(requestedAt)`) - Actions |
| Approved / Rejected | Email (row header) - Name - Sign-in provider - Last asked - State (`AccessRequestStatusBadge`) - Decided by (`decidedBy.name ?? email`, em dash if null: deleted admin, FK SetNull) - Decided on (`formatDateTime(decidedAt)`) |

Provider cell: plain text "Google" / "GitHub" / "Unknown" (strings map; no brand icon, `Icon`
has none and none is requested). Name and email render as text only (plan Security: escaped
by React; never `dangerouslySetInnerHTML`, never a `mailto:`).

Row actions (Pending only): `Approve` (`Button` default/primary-less small, since several
rows each have one; design-system.md allows one primary per page, so row buttons are
`size="sm"` default variant) and `Reject` (`variant="danger"`, `size="sm"`), each with an
`aria-label` including the email, `data-testid` `access-request-approve-<id>` /
`-reject-<id>`. Same shape as Resend/Revoke on Invitations. A per-row inline error line
(`role="alert"`, `text-red-text`) is not needed: both actions open a dialog that carries its
own inline error.

States (exactly one, in `building-pages.md` order):

| State | Render |
|---|---|
| 403 | `PermissionDenied` |
| loading | `SkeletonListRows rows={5}` + `VisuallyHidden live` "Loading access requests" (the list skeleton wrapper already provides the live text; match Invitations) |
| error | `ErrorBanner` (warning tone) with the server `detail` or "Could not load access requests.", Retry reloads |
| empty, Pending | `StatePanel` "No one is waiting for access" / "When a wellD colleague signs in without an invitation, they appear here and admins are notified." |
| empty, Approved | `StatePanel` "No approved requests" / "Requests you approve are listed here." |
| empty, Rejected | `StatePanel` "No rejected requests" / "Requests you reject are listed here." |
| loaded | `DataTable` + `Pagination` (page size 20, existing `components/Pagination`) |

Catalog (roles/departments) is fetched once on mount, as Invitations does. Approve is
`disabled` until it loads; a catalog failure shows the `ErrorBanner` above the list and
leaves Approve disabled; the list itself still renders and Reject still works.

Feedback (`SuccessBanner`, `compact`, `testId="access-requests-announcement"`):
success tone auto-dismisses; warning tone (email failed, already decided) persists until
dismissed. The banner is the page's single live region (Banner renders `role=status/alert`
per tone); no second `aria-live` is added.

Item removal: after a decision, the row leaves Pending on reload. Focus: the decided row's
buttons no longer exist, so after the dialog closes focus goes to the results region (the
table wrapper / empty `StatePanel`, `tabIndex={-1}`, via `useFocusOnMount`-style ref) rather
than falling to `<body>`. See Accessibility.

### S2 - Approve dialog (`ApproveAccessRequestModal`, `FormDialog` size `sm`)

- Title: "Approve access request". Description line: "<name> (<email>) will receive an
  invitation by email."
- Roles `CheckboxGroupField` (scroll), Departments `CheckboxGroupField` (scroll): identical
  to `InviteUserModal`, none preselected.
- Helper text under the groups (a `<p>` with `id`, referenced by `aria-describedby` on the
  dialog body is not available in `FormDialog`; place it as plain text above the groups so
  it is read in order): "If you choose no roles or departments, they join as an employee.
  If you choose roles, those roles replace the employee role." See Gaps (departments-only
  case needs confirming against specs/006 AC-1.1).
- Submit "Approve and send invitation" / busy "Approving..."; Cancel left. Submit is always
  enabled once the catalogs are loaded (zero selections is valid, AC-3.2).
- Error slot: `FormDialog.error` (string) for the F2 messages; the dialog stays open.
- Loading state: n/a (catalogs are loaded before the button enables). Empty catalog:
  `CheckboxGroupField.emptyState` strings as in Invite.

### S3 - Reject confirm (`ConfirmDialog tone="danger"`)

Title "Reject access request?". Body: "Reject the request from <name> (<email>)? Nothing is sent
to them, and signing in again will not reopen it. You can still invite them directly from
Invitations." Confirm "Reject request" / busy "Rejecting..."; Cancel; inline `error`.

### S4 - Invite dialog 422 (`InviteUserModal`, edit of existing component)

The `domain_not_allowed` 422 sets `emailError` (not `generalError`): "Invitations can only
be sent to <domains> addresses." Existing effect already refocuses the email field when
`emailError` is set; the field error is `role="alert"`. Other 422s keep the general alert.

### S5 - Hosted sign-in page (`auth/src/signin/signin.routes.ts`) - placement only

The three messages go into `ERROR_MESSAGES` and render through the existing `errorBanner()`:
same slot (below the subtitle, above the provider buttons), same `role="alert"` so they are
announced on load, English, `<html lang="en">`, allowlisted (an unknown `?error=` still gets
the generic message, not echoed). No redesign. Observations, not changes: the pending
message is a neutral outcome shown in the error style (red); acceptable per brief and the
requester can still retry other providers. The page `h1` still reads "Sign in to EstimAI"
(pre-existing, out of scope). Mockup is not needed: nothing visual changes.

### Strings (admin-ui, `en` + complete `it`, sentence case)

New module `admin-ui/src/strings/accessRequests.ts` registered in `strings.ts` as
`accessRequests`; plus additions to `nav`, `badges`, `users.invite`. English as designed;
Italian is provided for translation review.

```ts
// strings/accessRequests.ts (en)
heading: 'Access requests'
description: 'People with a wellD account who signed in without an invitation. Approve to invite them, or reject.'
loadError: 'Could not load access requests.'
catalogLoadError: 'Could not load roles and departments.'
caption: 'Access requests'
filterLabel: 'Filter by status'
filter: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }
columns: { name: 'Name', provider: 'Sign-in provider', lastAsked: 'Last asked', state: 'State',
           decidedBy: 'Decided by', decidedOn: 'Decided on' }
provider: { google: 'Google', github: 'GitHub', unknown: 'Unknown' }
empty: { pending: { title: 'No one is waiting for access',
                    body: 'When a wellD colleague signs in without an invitation, they appear here and admins are notified.' },
         approved: { title: 'No approved requests', body: 'Requests you approve are listed here.' },
         rejected: { title: 'No rejected requests', body: 'Requests you reject are listed here.' } }
approve: 'Approve'                       reject: 'Reject'
approveLabel: (email) => `Approve access request from ${email}`
rejectLabel:  (email) => `Reject access request from ${email}`
approveDialog: { title: 'Approve access request',
                 intro: (name, email) => `${name} (${email}) will receive an invitation by email.`,
                 defaultAccess: 'If you choose no roles or departments, they join as an employee. If you choose roles, those roles replace the employee role.',
                 submit: 'Approve and send invitation', busy: 'Approving…' }
rejectDialog: { title: 'Reject access request?',
                body: (name, email) => `Reject the request from ${name} (${email})? Nothing is sent to them, and signing in again will not reopen it. You can still invite them directly from Invitations.`,
                confirm: 'Reject request', busy: 'Rejecting…' }
approved: (email) => `Approved. Invitation sent to ${email}.`
approvedEmailFailed: (email) => `Approved, but the invitation email could not be sent to ${email}.`
goToInvitations: 'Open Invitations'                   // Banner action link
rejected: (email) => `Request from ${email} rejected.`
conflict: { activeUser: (email) => `${email} already has an Operai account. Change their roles from the user's page instead.`,
            pendingInvitation: (email) => `An invitation is already pending for ${email}. Resend it from Invitations instead.`,
            alreadyDecided: 'Someone else already decided this request. The earlier decision stands.',
            notFound: 'This request no longer exists.' }
approveFailed: 'Could not approve this request. Try again.'
rejectFailed: 'Could not reject this request. Try again.'
// nav.accessRequests: 'Access requests' / 'Richieste di accesso'
// badges.accessRequestStatus: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }
// users.invite.domainNotAllowed: (domains: string) => `Invitations can only be sent to ${domains} addresses.`
```

Italian: heading "Richieste di accesso"; filters "In attesa / Approvate / Rifiutate";
approve "Approva", reject "Rifiuta"; approve dialog submit "Approva e invia invito";
defaultAccess "Se non scegli ruoli né reparti, la persona entra come dipendente. Se scegli
dei ruoli, questi sostituiscono il ruolo di dipendente."; `alreadyDecided` "Un altro
amministratore ha già deciso questa richiesta. La decisione precedente resta valida."; the
rest mirrors the English one-to-one (the implementer completes `it: typeof en`; the parity
test `catalogGaps` enforces completeness). Dates: `formatDateTime` from `@operai/ui`
(the list shows a time because "last asked" is a moment; Invitations does the same).

## Component inventory

Library in use: **`@operai/ui`** (ADR-0050; from AGENTS.md and the imports in
`admin-ui/src`), Tailwind token utilities, no Mantine. In-repo admin-ui wrappers are reused
where they exist.

| Element | Reuse / NEW |
|---|---|
| Users section tab strip, third tab | `admin-ui/src/components/UsersSubNav.tsx` (edit: add entry; fix testid, see Gaps) over `@operai/ui` `TabNav` + `tabLinkClassName` |
| Page frame, heading | `PageHeader` |
| Table | `@operai/ui` `DataTable` (caption, `rowHeader`) |
| Pagination | `admin-ui/src/components/Pagination.tsx` |
| Loading | `admin-ui/src/components/SkeletonListRows.tsx` |
| Empty | `StatePanel` |
| Error / retry | `admin-ui/src/components/ErrorBanner.tsx` |
| Success / warning feedback | `admin-ui/src/components/SuccessBanner.tsx` (+ `Banner` `actions` for the "Open Invitations" link) |
| 403 | `admin-ui/src/components/PermissionDenied.tsx` |
| Status filter | native `<select>` as in `InvitationsPage` (no library Select exists) |
| Row buttons | `Button` (default, `danger`, `size="sm"`, `busy`) |
| Reject confirm | `@operai/ui` `ConfirmDialog tone="danger"` |
| Role / department pickers | `CheckboxGroupField` (as `InviteUserModal`) |
| Approve dialog shell | `FormDialog` |
| Status mapping | `admin-ui/src/lib/statusMeaning.ts` (add `ACCESS_REQUEST_STATUS_MEANING`: pending -> `pending`, approved -> `active`, rejected -> `failed`) |
| Dates | `formatDateTime` |
| Icons | `Icon` only (none needed beyond the badge's) |
| Invite 422 | edit `InviteUserModal.tsx` / `InvitationsPage.tsx` / `UsersPage.tsx` handlers (existing `emailError` slot) |
| Sign-in messages | edit `ERROR_MESSAGES` in `auth/src/signin/signin.routes.ts` |
| `AccessRequestsPage` | **NEW** (`pages/AccessRequestsPage.tsx`): a distinct route/screen; no existing page lists access requests. Structure copies InvitationsPage. |
| `ApproveAccessRequestModal` | **NEW** (`components/`): `InviteUserModal` has an email input and email validation that do not apply (the email is fixed); a thin `FormDialog` with the two checkbox groups. Could be folded into the page, kept separate to mirror `InviteUserModal`'s presentational contract and test it alone. |
| `AccessRequestStatusBadge` | **NEW** (`components/`, ~10 lines): the "one badge component per domain" rule (building-pages 5), mirrors `InvitationStatusBadge`. |
| `lib/accessRequestConflict.ts` | helper (not a component): maps `ApiError.code` + email to the conflict string. Replaces the string pattern-matching in `inviteConflict.ts` for this endpoint. |

Ratio: 17 reused elements / 3 NEW components (plus one helper module and edits to four
existing files). No new library component: nothing here is a pattern a second app needs.

Data client (frontend task, no UI): `adminApi.ts` gains `listAccessRequests`,
`approveAccessRequest`, `rejectAccessRequest` and types; `ApiError` must expose the
problem's `code` (see Gaps).

Router: add `accessRequestsRoute` at `/users/access-requests` (flat child of root, like
`invitationsRoute`); the static segment already wins over `/users/$id` and
`router.test.tsx` must assert it for this path too. `SectionNav`'s "Users" tab stays active
on this route (fuzzy match), no change.

## Accessibility

**Users sub-nav.** Third real `<a>` in the existing labelled `<nav>`; `aria-current="page"`
from `Link`. Only "Active users" uses `exact`. Tab order: Active users, Invitations, Access
requests, then the page.

**List page.**
- One `h2` (PageHeader); no skipped levels. `<section aria-labelledby>`.
- `DataTable` renders a real `<table>` with caption and `<th scope>`; email is the row
  header. Column set changes with the filter, so the table is re-rendered, not hidden.
- The filter `<select>` has a visible-to-AT `<label className="sr-only">`; changing it does
  not move focus; the loading skeleton announces via the live text.
- Row buttons carry the requester's email in `aria-label` (otherwise 20 identical
  "Approve" buttons); Reject uses the danger variant AND the word "Reject" (not colour only).
- Status badge: icon (decorative, `aria-hidden` inside `StatusBadge`) + text label; colour
  is never the only signal.
- Empty/error states use text; error `ErrorBanner` has a Retry button.
- Success/warning outcomes are announced through the single `SuccessBanner` live region;
  the warning (email failed, already decided) does not auto-dismiss so a screen-reader or slow
  user does not miss it (matches Invitations' "never a toast" rule).

**Approve and reject dialogs (library `FormDialog` / `ConfirmDialog`, built on
`useDialogBehavior`).**
- `role="dialog" aria-modal`, labelled by the title; focus trapped; Escape and backdrop =
  Cancel, both disabled while busy.
- Initial focus: Approve dialog -> first checkbox group / first focusable control (no text
  input exists); Reject dialog -> Cancel (safe default for a danger confirm; library
  default, verify).
- On close, focus returns to the control that opened it **if it still exists**. After a
  successful decision the row is gone, so focus is set programmatically to the results
  region (`tabIndex={-1}` wrapper around table/empty panel). After Cancel it returns to
  the row's trigger button.
- Inline errors in the dialog are `role="alert"` (the library `error` prop); the 422 on the
  invite dialog's email field is `role="alert"` and moves focus to the email input (existing
  behaviour).
- The checkbox groups are `fieldset`/`legend` via `CheckboxGroupField`; the zero-selection
  helper sentence is plain text placed before them so it is read in tab/reading order.

**Contrast / tokens.** Warning copy uses `text-org-text`, error uses `text-red-text`
(design-system.md: raw orange/red are not text colours); no new colours. `text-muted` is
not used for anything the admin must read (e.g. the provider column is `text-soft` at
minimum).

**Hosted sign-in page.** Message in the existing `role="alert"` banner is announced on page
load; text contrast is the page's existing banner style; the message is allowlisted text,
never echoing `?error=`. Provider buttons remain the only controls; no new focus target.

Hotspots: (1) focus after a decision removes the row; (2) the many-identical-buttons
labelling; (3) warning banner that must not auto-dismiss; (4) dialogs closing on a 409
and leaving the banner as the only explanation; (5) the sign-in `role="alert"` for a
non-error outcome.

## Scope notes and traceability

| Spec item | UI |
|---|---|
| AC-3.1 | S1 list, filter, columns |
| AC-3.2 / 3.3 | F2, S2 |
| AC-3.4 | F3, S3 |
| AC-3.5 | F2 inline 409s |
| AC-3.6 | F4 |
| AC-3.7 | F2 warning banner (email failed -> Invitations) |
| AC-3.10 | F7 |
| AC-5.1 | F5, S4 |
| AC-1.2, 1.3, 2.3 | F6, S5 |
| AC-4.1 (link) | deep link lands on Pending (F1) |
| AC-3.8, 3.9, AC-1.x logic, AC-2.1/2.2/2.4, AC-4.2/4.3, AC-5.2, AC-6.x | no UI surface (AC-5.2 reuses the existing Invitations screen unchanged) |

Not designed on purpose (no AC asks for it): search by email, an "All" filter, a pending
count badge on the tab or in the section nav, a "revoke/undo" for a decision, a link from an
approved row to its invitation, bulk approve/reject, a requester-facing status page
(AC-2.5 forbids it), editing allowed domains (spec Non-goal).

## Gaps found in spec / plan

1. **`ApiError` has no `code`.** `admin-ui/src/lib/adminApi.ts` keeps only
   status/title/detail, and `inviteConflict.ts` pattern-matches English prose. The plan's
   409/422 `code` values cannot be read until `ApiError` (and `ApiProblem`) expose `code`.
   Frontend task, not a plan change; do not copy the prose-matching approach.
   **Resolved 2026-11-05:** plan.md § API contracts now specifies `code`/`allowedDomains` on `ApiError`.
2. **Localised domain list on the 422.** `detail` is English ("Invitations can only be sent
   to welld.ch, welld.it addresses"), but admin-ui is en/it. Either accept the English
   server text in the Italian UI, or (recommended) add an `allowedDomains: string[]` problem
   extension so `users.invite.domainNotAllowed(domains)` can be localised. Plan amendment
   to decide; the design uses the template with `detail` as the fallback.
   **Resolved 2026-11-05:** plan.md adds `allowedDomains` to the 422 body.
3. **Roles replace `employee`, departments-only is unclear.** Plan: "a named-role invitation
   REPLACES `employee`, a no-role invitation keeps it". The spec's wording for zero
   selections (specs/006 AC-1.1) is about "no roles/departments". What a departments-only
   invitation yields is not stated; the approve-dialog helper text (and its test) assumes
   departments-only keeps `employee`. Confirm with the backend before copy is frozen.
   **Resolved 2026-11-05:** confirmed from `applyLivePendingInvitationOnUserCreate` (replaces
   only when `roleIds` is non-empty); plan.md states it. The helper text stands.
4. **`UsersSubNav` testid bug waiting to happen.** It derives
   `data-testid="users-subnav-${to === '/users' ? 'active' : 'invitations'}"`, so a third
   entry would also get `...-invitations` (duplicate ids). Derive the id from an explicit
   `testId` field per view. Also its doc comment ("two-tab strip") and `UsersSubNav.test`
   need updating.
5. **Approve gives the page no per-invitation delivery state.** The email-failed notice is
   a one-shot banner; the persistent per-row indicator lives on Invitations only (spec
   AC-3.7 says exactly that). Fine, but the banner action ("Open Invitations") is
   therefore load-bearing; keep it.
6. **Plan's notification has no `link.label`.** The deep link works without one (item
   falls back to the title); a label such as "Review access requests" would help the
   notification row. Optional plan tweak.
   **Dropped 2026-11-05:** notify-api's `LinkSchema` has no `label` field; out of scope.
7. **Pending read-after-write.** `GET` orders Pending by `requestedAt desc`, so a repeat
   sign-in (AC-2.2) moves a request to the top between loads. Harmless; no UI work.
8. Sign-in page: the pending-outcome message is styled as an error (see S5). Accepted
   as-is per the brief.
9. Date format: the brief says `formatDate`; timestamps ("last asked", "decided on") need a
   time, so the design uses the library `formatDateTime`, as Invitations does.
10. No `data-testid` contract exists yet for e2e (`seed-access-request` fixtures in the
    plan). Proposed prefix `access-request-*`: `admin-access-requests-page`,
    `access-requests-table`, `access-request-row-<id>`, `access-request-approve-<id>`,
    `access-request-reject-<id>`, `access-requests-status-filter`,
    `access-requests-announcement`, `approve-access-request-*` (dialog prefix).
