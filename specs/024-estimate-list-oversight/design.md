---
spec: 024
status: draft
---

# Design: EstimAI list — every estimate for admins, closed out of the way, the deal at a glance

Binding rules read first: `operai-ui/docs/building-pages.md`, `operai-ui/docs/design-system.md`,
`operai-ui/src/index.ts`. Existing screens inspected from source (`EstimatesPage.tsx`,
`EstimatorApp.tsx`, `EstimatorContext.tsx`, `AccessLevelBadge.tsx`, `router.tsx`,
`crm-ui/src/pages/PipelinePage.tsx`); the dev stack was not driven. No visual direction section:
the design system wins.

## Flows

| # | Flow | Covers |
|---|---|---|
| F1 | Admin switches the list to **All** | US-1: AC-1.1, 1.3 |
| F2 | User without the permission | AC-1.2 |
| F3 | Admin opens a stranger's estimate (oversight mode) | AC-1.4, 1.5 |
| F4 | Browse **Closed**, open one, reopen it | US-2: AC-2.1–2.5 |
| F5 | Filters survive reload and return from an estimate | AC-2.6 |
| F6 | Deal badge (link or plain) | US-3: AC-3.1–3.3 |
| F7 | Failure paths: 503, 403, withdrawn permission | AC-1.6, 1.7 |

**F1.** `/estimates` → filter row shows **Whose** (Mine selected) and **Status** (Open) → user picks
All → URL becomes `?whose=all`, heading changes to "All estimates", list area shows the loading
state, then rows (success), or an empty state / banner (exits, see Screens).

**F2.** Same entry; the Whose field is absent from the DOM (never disabled). Only Status is shown.
A URL or sessionStorage value `whose=all` is dropped silently (replace-navigate to the URL without
it) once permissions have loaded; no error.

**F3.** On All, row's Open (or Enter on it) → `/estimates/:id` → loader returns `access: "oversight"`
→ the estimate renders read-only with the oversight banner; toolbar keeps exports + help. Success exit:
Back/"Estimates" link returns to the list with the filters restored (F5). Error exits: 404 (permission
withdrawn) → redirect to list (as today); 503 → redirect to list **with a notice** (see Gaps G4).
If the admin also owns or collaborates on the estimate, the server returns their own level and the
page is exactly as today (AC-1.5); nothing in the UI mentions oversight.

**F4.** Status = Closed → rows carry the existing Closed badge → Open → closed banner (existing)
→ owner/editor sees Reopen (existing); reopening shows the existing success banner, and the estimate
is then under Open on the next list visit. An admin in oversight sees the closed banner and no Reopen.

**F5.** Each change writes URL search params (`replace`, so Back does not step through filter
changes) and mirrors them to `sessionStorage`. Reload keeps the URL. Returning to `/estimates` with no
params (tab link, "Estimates" back link) restores from `sessionStorage`; defaults (`mine`, `open`) are
omitted from the URL.

**F6.** Row with `crmDealId` shows **Deal**. Viewer holds `(crm, access)` → the badge is a link
(`href="/crm/deals/:id"`, click goes through `navigateSuite`, middle-click/copy-link still work).
Otherwise a plain badge. Never a title, company or amount.

**F7.** `whose=all` → 503 `authz_unavailable`: warning banner with Retry; Mine keeps working.
→ 403 `oversight_required` (permission withdrawn mid-session): denied panel with "Show my estimates".
Next permission revalidation removes the Whose field.

## Screens & states

### S1. Estimates list (`/estimates`)

Structure (inside the existing `ToolLayout` > `section aria-labelledby`):

1. `PageHeader` — title (h2) = **"My estimates"** when Whose = Mine, **"All estimates"** when All
   (Status does not change the heading). Actions unchanged: Import JSON (secondary), New estimate
   (primary, hidden only in the Mine + Open empty state, where the panel carries it, as today).
2. Action banners (existing: action error, deleted notice).
3. **Filter row**, directly under the header, above the list (the CRM `PipelinePage` pattern: labelled
   `Field`s with bare `select`s, left-aligned, `grid max-w-md grid-cols-1 sm:grid-cols-2 gap-3`; with
   Whose absent, Status occupies the first column). Rendered in every list state (loading, error,
   empty, loaded) so the user can always change course; only the 403 panel keeps it too.
4. Exactly one list state (building-pages order: 403 → loading → failed → empty → loaded).

**Filter row.**

| Field | Label (en / it) | Options (en / it) | Shown |
|---|---|---|---|
| Whose | "Whose estimates" / "Stime di" | Mine / Mie, All / Tutte | only with `(estimate, read-all)` |
| Status | "Status" / "Stato" | Open / Aperte, Closed / Chiuse | always |

Selects apply on change (no Apply button); they stay enabled while loading (a later choice supersedes
an earlier request; the page must ignore out-of-order responses). Whose appears when permissions
resolve, so it can pop in after first paint; reserve no space, but do not fetch `whose=all` before
permissions are known (G1).

**Row anatomy** (`ListRows` row `div` as today; the name `Link` keeps `tabIndex={-1}`, **Open** is the
keyboard entry):

```
[name]  [Closed]  [Deal]  [access badge]            [Open] [trash]
 owner-or-author · dd.mm.yyyy
```

| Element | Rule |
|---|---|
| Name | `p.name || Untitled`, truncates |
| Closed | existing `StatusBadge status="settled"` "Closed" when `closedAt`; shown on the Closed list too (redundant but it is the row's own statement, AC-2.2) |
| Deal | `crmDealId` set → `DealBadge`; link variant with `(crm, access)`, plain otherwise. Sits **outside** the name `Link` (a link cannot nest in a link): the line is a flex row of siblings |
| Access badge | owner: none (as today). editor / viewer: existing `AccessLevelBadge`. **oversight**: same component, new `oversight` level, neutral tone, `eye` icon, label "Oversight" / "Supervisione". Distinct from Viewer because the right does not come from a share |
| Meta | owner row: author · date (as today). Any other row (shared or oversight): owner identity via `formatIdentity` · date. Orphaned owner keeps the existing "unknown" placeholder |
| Open | every row |
| Delete | owner rows only, unchanged; never on shared or oversight rows (absent, not disabled) |
| testid | `estimate-row-owned` / `estimate-row-shared` / new `estimate-row-oversight` |

**States** (list area; filter row always above it).

| State | Render |
|---|---|
| Loading (first load or filter change) | `VisuallyHidden live` "Loading estimates" + `SkeletonRows` (existing). Filter row stays mounted; the old rows are replaced by the skeleton, not dimmed |
| Loaded | `VisuallyHidden live` count line including context: "Showing all estimates, 12 loaded" / "Showing your closed estimates, 1 loaded" |
| Failed (network, 5xx) | `Banner tone="warning"` + Retry; copy names what failed ("Could not load your estimates…" / "Could not load all estimates…") |
| 503 `authz_unavailable` (Whose = All only) | `Banner tone="warning"` titled "Authorization service unavailable" (building-pages rule, ADR-0014) + Retry; body: "Every estimate cannot be listed right now. Switch to Mine to keep working." Mine is unaffected |
| 403 `oversight_required` | `StatePanel role="alert" focusOnMount` title "You cannot list every estimate" body "Your access to all estimates is not granted or was withdrawn." action `Button secondary` "Show my estimates" (sets Whose = Mine). The Whose field is removed on the next permission revalidation |
| Empty | `StatePanel`, copy per matrix below |

**Empty matrix** (no panel action unless stated; the page header's New estimate is the way forward):

| Whose / Status | Title | Body |
|---|---|---|
| Mine / Open | "No open estimates" | "Create one, or look under Closed for finished work." + actions **New estimate**, **Load example** (as today; header New estimate hidden) |
| Mine / Closed | "No closed estimates" | "Estimates you close appear here. A closed estimate is read-only until its owner or an editor reopens it." |
| All / Open | "No open estimates" | "There is no estimate in progress in EstimAI." |
| All / Closed | "No closed estimates" | "No estimate in EstimAI has been closed yet." |

"All with zero estimates" cannot be told from All / Open empty without a second query; the copy above
is true in both cases. The first-run onboarding copy ("Ready to estimate your first project?" and the
feature line) is **dropped from this state** because Open-empty no longer implies "never had one"
(see G3).

**Link variant of the Deal badge** and the plain one, both `Badge tone="accent"` with text "Deal"; no
glyph (the library has no deal/briefcase icon; the text carries the meaning, see Component
inventory). The link variant is distinguishable by hover underline on the label and the global focus
ring; it is the only badge in the row that is focusable.

### S2. Estimate page, oversight mode (`/estimates/:id`, `access: "oversight"`)

Changes relative to the existing page only; everything else (grids, tabs, summary) renders read-only
exactly as for a Viewer (`canEdit` false).

| Zone | Oversight behaviour |
|---|---|
| Indicator | Persistent `Banner tone="info"`, title "Read-only: admin view", body "You can see this estimate because you may read every estimate. It is owned by {owner}. You can export it, but not change, close or share it." Sits in the same zone as the closed banner, above it when both apply (the closed banner then reads "…until the owner or an editor reopens it", the existing viewer wording). Not dismissible; `data-testid="estimate-oversight-banner"` |
| Collaborators control | Not rendered (neither the owner button nor the member chip): the collaborators API 404s for this caller |
| Close / Reopen | Not rendered (`canChangeLifecycle` false) |
| Exports (client, PDF, Excel) and Help | Kept |
| Name / author / grids | Read-only via `canEdit` (no new code path in components) |
| Dialogs | Collaborators, close-confirm: never mounted |

Loading/error of the page: unchanged (loader). Error exits are in F3/G4.

### S3. Back to list

The page's existing link back to the list carries no params; restoration comes from `sessionStorage`
(F5). Browser Back returns the exact URL.

## Component inventory

Library in use: **`@operai/ui`** (AGENTS.md, ADR-0050) on Tailwind 4 token utilities. Nothing else.

| Element | Component | Source |
|---|---|---|
| Filter fields + selects | `Field` wrapping native `<select>` (bare/compact look) | `@operai/ui`; layout pattern from `crm-ui/src/pages/PipelinePage.tsx` |
| Page title/actions | `PageHeader` | `@operai/ui` |
| List rows | `ListRows`, `listRowClassName`, `listRowMetaClassName` | `@operai/ui` (as today) |
| Closed badge | `StatusBadge status="settled"` | `@operai/ui` (as today) |
| Access badges (editor/viewer/oversight) | `AccessLevelBadge` + `oversight` level | `estimai-ui/src/components/AccessLevelBadge.tsx` (extend: one config entry; type `AccessLevel` widens) |
| Owner identity | `formatIdentity` | `estimai-ui/src/lib/identity.ts` |
| Dates | `formatDate` | `@operai/ui` |
| Loading / empty / 403 | `SkeletonRows`, `VisuallyHidden`, `StatePanel` | `@operai/ui` |
| Failed / 503 / oversight indicator | `Banner` (`warning`; `info`) | `@operai/ui` |
| Buttons | `Button` | `@operai/ui` |
| Icons | `Icon` (`eye`) | `@operai/ui` |
| Layout | `ToolLayout` | `@operai/ui` |
| Deal badge | **NEW** `DealBadge` (`estimai-ui/src/components/DealBadge.tsx`) | Composes `Badge` + optional `<a>`; needed because no component renders a badge as a link and the aria wording is specific to this domain. Single consumer, so app-level, not library (see G5) |
| Filter row | **NEW** `EstimateFilters` (`estimai-ui/src/components/EstimateFilters.tsx`) | Thin composition of two `Field`+`select`; keeps `EstimatesPage` from growing and holds the permission check and option copy. No library `FilterBar` exists and CRM builds its own inline; extract to the library when a second app repeats it |

Reuse : NEW = **13 library/in-repo components reused (+1 extended) : 2 NEW app-level composites**; 0 new
library components.

URL/state (not a visual component): route `validateSearch` on `/estimates`
(`whose?: 'mine'|'all'`, `status?: 'open'|'closed'`; unknown values fall back to defaults),
`sessionStorage` key `estimai.list.filters` (all reads/writes in try/catch), restore in the route's
`beforeLoad` so the first fetch already uses the restored filters.

## Copy (strings.ts, `en` + `it: typeof en`, sentence case)

New keys under `estimatesList` unless noted (the existing `heading` stays "My estimates"):

| Key | en | it |
|---|---|---|
| `headingAll` | All estimates | Tutte le stime |
| `filters.whose` / `status` | Whose estimates / Status | Stime di / Stato |
| `filters.mine` / `all` | Mine / All | Mie / Tutte |
| `filters.open` / `closed` | Open / Closed | Aperte / Chiuse |
| `loadedContext(scope, n)` | Showing all estimates, 12 loaded | Tutte le stime: 12 caricate |
| `loadFailedAll` | Could not load all estimates. Check your connection and try again. | Impossibile caricare tutte le stime. Verificare la connessione e riprovare. |
| `authzUnavailableTitle` / `Body` | Authorization service unavailable / Every estimate cannot be listed right now. Switch to Mine to keep working. | Servizio di autorizzazione non disponibile / Al momento non è possibile elencare tutte le stime. Passare a Mie per continuare a lavorare. |
| `denied.title` / `body` / `action` | You cannot list every estimate / Your access to all estimates is not granted or was withdrawn. / Show my estimates | Non è possibile elencare tutte le stime / L'accesso a tutte le stime non è concesso o è stato revocato. / Mostra le mie stime |
| `empty.*` (matrix) | see matrix | Italian equivalents, complete |
| `deal.label` | Deal | Trattativa |
| `deal.linkName(name)` | Deal for "{name}": open in the CRM | Trattativa per "{name}": apri nel CRM |
| `deal.plainHidden` | linked to a CRM deal | collegata a una trattativa CRM |
| `sharing.dialog.levelOversight` | Oversight | Supervisione |
| `lifecycle.oversightTitle` / `oversightBody(owner)` | Read-only: admin view / … (as in S2) | Sola lettura: vista amministratore / … |

## Accessibility

- **Selects.** Native `<select>` inside `Field` (visible label, programmatic association). Keyboard:
  Tab reaches Whose then Status; Space/Alt+↓ opens, arrows pick, Enter/Esc as native. Changing a value
  does not move focus; the result is announced by the polite live region (loaded line carries scope,
  e.g. "Showing all estimates, 12 loaded"). Because some browsers fire `change` per arrow key, the
  page must discard out-of-order responses.
- **Heading change** ("My estimates" ↔ "All estimates") is announced through that same live line, not
  by moving focus.
- **Absent, not disabled:** Whose is removed from the DOM without the permission; no explanatory text.
- **Row tab order:** Deal link (when link) → Open → Delete (owner). The name link stays out of the tab
  order as today. Row `ListRows` label follows the heading ("My estimates"/"All estimates").
- **Deal badge name.** Link variant: `aria-label="Deal for "{name}": open in the CRM"` (contains the
  visible word "Deal", WCAG 2.5.3, and is unique per row). Plain variant: visible "Deal" plus
  `VisuallyHidden` " linked to a CRM deal". Never the deal title (not known). Real `href` so it is
  announced as a link; click handler calls `navigateSuite` and `preventDefault` only for plain left
  clicks.
- **Badges are not colour-only:** Closed has check-circle glyph + text; Oversight has eye + text;
  Deal has text. Glyphs `aria-hidden`.
- **Oversight vs Viewer** are distinguished by label text, not icon alone (both use `eye`).
- **Oversight banner** is `role="status"` (info Banner default), static; the page's tab order starts
  at the same controls as for a Viewer, minus collaborators and lifecycle buttons.
- **403 panel:** `StatePanel role="alert" focusOnMount` — focus goes to its heading; its button is the
  next tab stop. **503/failed banners:** `role="alert"` (warning default) with Retry; focus not moved.
- **Loading:** skeleton `aria-hidden`; the polite live line says "Loading estimates".
- **Contrast/theme:** only library components and tokens; no new colours. Check Oversight (neutral)
  and Deal (accent) badges in both themes in Storybook-less manual pass.
- **Focus visibility:** the global 2px `--focus-ring`; the Deal anchor adds no styling of its own.

## Gaps and findings (reported, not designed around)

- **G1 permissions-not-loaded signal.** `usePermissions()` returns `EMPTY_PERMISSIONS` (epoch 0)
  until `/authz/me` resolves; the plan says to render Whose from it and to honour `whose=all` from
  URL/sessionStorage. There is no "loaded" flag, so the page cannot tell "no permission" from "not
  yet". Needed: wait for resolution before fetching `whose=all` or normalising it away.
- **G2 owner on own rows.** AC-1.3 says each All row shows the owner; the plan's contract returns
  `owner` only for rows the caller does not own, and the owner row currently shows free-text `author`
  (not the owner). Design keeps today's author · date for own rows. Decide if own rows on All need an
  owner label ("You").
- **G3 first-run onboarding.** With `status` defaulting to Open, an empty Mine/Open list no longer
  means "never created one" (someone may only have closed estimates). The design drops the onboarding
  copy from that state. Alternative: one extra unfiltered count call. Needs a product call.
- **G4 failures opening an estimate.** The estimate route's loader redirects to the list on ANY
  error, silently. A 503 on the oversight fallback (AC-1.7) therefore lands the admin on the list with
  no explanation. Needs a notice (e.g. a one-shot `Banner tone="warning"` "Could not open that
  estimate. The authorization service is unavailable.") and a way to pass it (router state or search
  flag); plan/router change, not specified in the plan.
- **G5 library candidates.** (a) A link-capable `Badge` (no interactive badge exists); (b) a deal/
  briefcase `Icon` (none; a status icon must not be reused, `banknote` implies money which AC-3.3
  forbids); (c) a shared filter-row/`FilterBar` pattern. All deferred to app-level now; flagged per
  "pattern a second app needs goes into the library".
- **G6 no AC for UI additions.** Not asked by any AC but required to make the ACs usable, listed so
  the caller can veto: dynamic heading ("All estimates"), the `Oversight` access badge, the oversight
  banner on the estimate page, the 403 denied panel with "Show my estimates", the empty-state matrix.
  Spec says "heading likely must change" only in the brief, not in the spec.
- **G7 ACs with no UI surface:** AC-1.8 (seed), AC-1.6/1.7 server halves, AC-2.5, AC-3.3 backend
  half, AC-3.4–3.8 (CRM/estimai-api behaviour). AC-1.5 has no UI beyond "unchanged".
- **G8 stale badge is invisible.** AC-3.8 allows the badge to lag; the UI offers no refresh cue. The
  list refetches on every visit and filter change, which is the only remedy; no extra UI designed.
- **G9 estimate page author effect.** `EstimatorApp` auto-fills `author` from the session user when
  empty and not closed (around line 204). Verify it cannot fire (or mark dirty) in oversight mode,
  where the viewer-like `canEdit=false` must also suppress it.
- **G10 Mine + Closed hides nothing about the owner role**: the Closed list for a collaborator shows
  their access badge and the Reopen path only for editors (existing behaviour); no gap, noted for QA.
