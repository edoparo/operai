---
spec: 20261116
status: approved
approved: 2026-11-16
---

# Design: Letterhead service — the configurator (`letterheads-ui`) and the CRM wizard's service preview

> Inputs: `spec.md` (approved, amended A1–A5), `plan.md` (approved), `spike.md`. UI ACs: US-8
> (AC-8.1–8.9), the form content of US-4 to US-7 (A1–A3 included), and US-10's AC-10.3, 10.4,
> 10.5, 10.7, 10.8, 10.11, 10.13. Prior decisions kept: `specs/20261115-crm-offer-wizard/design.md`
> (layout of the wizard pane, Drawer below `xl`, sticky action bar, `data-wizard-field` jump, band-free
> quiet failure) and the library rules in `operai-ui/docs/design-system.md`.
> Library in use: **`@operai/ui`** (Tailwind 4 token utilities), the only component source
> (AGENTS.md UI rules). Strings are `selectStrings({ en, it })` with `it: typeof en`.
> The project has a design system, so there is **no `## Visual direction` section**: the system wins.
> Mockups are ASCII. The Visual Companion was enabled for this run, but it needs the person to accept
> the offer and this run could not ask; no server was started and nothing is under `.forge/design/`.
> Where this document needs something the plan does not give, it says so under "Gaps for spec/plan"
> and does not design around it.

## The big calls

1. **One page, one form, no template editor.** `letterheads-ui` is a single route (`/letterheads`)
   with search params `?entity=welld_it|welld_ch&version=n&view=settings|history`. The person
   edits a closed set of controls: numbers within bounds, selects from the catalog, hex colours,
   checkboxes, file uploads, and short texts. Nothing in the form is a template, a code box or a
   markup editor. The "frame model" (up to four lines per zone, a look per line, placeholders,
   conditional segments, literal braces) is shown through labelled inputs plus one help card
   (§ How the frame model is exposed).
2. **The form is one long column of `Card`s, not tabs.** Variants (default, first, last) are
   stacked cards, not a tab strip. A refused value therefore always exists in the DOM, can take
   focus, and is never hidden in an unselected tab (AC-8.3). Only two tab strips exist: the entity
   (`welld_it` | `welld_ch`) and the view (Settings | History).
3. **The preview is shared with the CRM.** Both apps need "pages as images, previous pages kept
   while updating, stale answers discarded, `Page N of M` alternative, page text for assistive
   technology". That is a second consumer on day one, so the page stack becomes one library
   component, `PagePreview`, and the request handling becomes one library hook, `useLatestResult`
   (the wizard design's rule: promote on the second consumer). Each app adds its own request, its
   own notices and its own copy.
4. **Validation lives in the service.** The form has no rule engine. The preview route validates
   the unsaved configuration "with the save rules" (plan), so refused values appear next to their
   controls while the person edits; the save route answers the same `invalid_letterhead problems[]`.
   The form only maps `{path, reason}` to a control and a sentence. The client does not repeat the
   40-character fit, placeholder or bound checks.
5. **Read-only is a mode of the same screen, not a second screen.** Access-only holders, a scoped
   manager looking at the other entity, and an old version opened from the history all show the same
   form with `fieldset disabled`, no Save, and a banner that says why.

## Flows

Ids: US/AC from `spec.md`. "Page" = the `/letterheads` screen.

### F1 Open the tool (AC-8.1, 8.9)
1. Sidebar shows **Letterheads** only for holders of `letterheads:access` (the shell filters `TOOLS` by
   `/authz/me` `apps`; the new tool's id is `letterheads`, the catalog app id). Route `/letterheads/$` is
   gated by `createToolAccessBeforeLoad`; a person without it never sees the entry and a deep link is
   refused by the shell, as for every gated tool. Inside the remote nothing re-checks the grant.
2. `LetterheadsShell` (modelled on `ProjectsShell`) loads `GET /v1/catalog` and `GET /v1/letterheads`
   once and hands them to the page through a context. Loading: `Loading` (polite line + skeleton rows).
   403: `PermissionDenied` (replaces the page, takes focus, no retry). 503: the "authorization service
   unavailable" banner with **Retry** (`LoadFailure`). Other errors: `warning` banner with the problem's
   detail and **Retry**. The `h1` (tool title) is on screen in every state.
3. Success: the page opens on the entity of `?entity`, else the first entity the person may change,
   else `welld_it`, in the Settings view, with the active version loaded (`GET …/versions/{n}`).
4. Exits: ready (S1), empty entity (S2), or one of the failure states above.

### F2 Switch entity (AC-8.2, 8.3)
Entity `Tabs` ("wellD IT" | "wellD CH", ←/→/Home/End). Selecting the other tab: if the form is dirty,
the leave dialog (F9) asks first with confirm **Switch and discard**; otherwise it switches at once and
`?entity` is replaced (not pushed). The new entity loads its active version; its permission mode (F10,
F11) is decided by its own `canManage`. Focus stays on the selected tab. A polite line says "Showing
{entity}". Both entities are always listed: every holder of access sees both (AC-8.2).

### F3 Edit with a live preview (AC-8.3, 8.4, 8.5, 8.6)
1. Any edit changes the in-memory configuration. 300 ms after the last edit the page posts
   `POST /v1/letterheads/{entity}/preview` with `{config, language}` (all pages; `pages=` is not used,
   § Decisions D-6). Target: new pages within 2 s of the last edit in 95 % of edits.
2. While the request runs the **previous pages stay**, the status line says "Updating the preview…" with
   a `Spinner`, and the region has `aria-busy`. The first time there are no previous pages: an A4-shaped
   `Skeleton` page with "Preparing the preview…" (never a blank pane).
3. An answer is applied only if it belongs to the newest request (sequence id); an older answer is
   discarded (AC-8.6). **A request superseded by a newer edit is not aborted**: it is left to finish and
   its answer is ignored. The letterhead service kills the worker of an aborted preview request, and each
   new worker re-parses the fonts (about 130 ms), so aborting on every edit would cost more than it saves.
   The page aborts only when it goes away: unmount, or switching entity. While the person types, several
   previews can be in flight; only the newest is shown. (2026-11-17, implementation finding; owner to confirm)
   (Implemented in `letterheads-ui/src/components/PreviewPaneRequest.ts`.)
4. A 422 `invalid_letterhead` is not a failure of the service: it means the form holds refused values.
   The previous pages stay, the pane shows the info notice "The preview shows the last valid form", and
   each problem appears next to its control (S4). Save is not blocked by it (the service decides on save).
5. A service failure (network, 5xx, `busy`, timeout): the previous pages stay; the status line becomes
   "Could not update"; a `warning` notice with **Try again** appears in the pane; the form stays usable;
   Save stays available (AC-8.6). One automatic retry after `Retry-After` for `busy` only; every other
   retry is the person's (Try again, or the next edit).
6. The sample document is the service's own, in the **person's language** at first (AC-8.8). Its company
   data is marked as sample by the service; the page repeats the fact in one sentence above the pages
   (AC-8.5). The configurator makes no other call (no CRM read).

### F4 Switch the preview language (AC-5.8, 8.3)
`RadioGroupField` "Preview language: Italian | English" above the pages. Changing it sends the same
request with the other `language`; the form is untouched. It is a viewing choice, not saved. The text
inputs are **not** filtered by it: every line shows both its Italian and its English input at all times,
so a refused "filled in one language, empty in the other" is never hidden.

### F5 Upload a logo or a background (AC-7.1–7.4, 7.7)
1. In a variant's Logo or Background section, **Choose file** (`FilePicker`, `accept` = PNG, JPEG, SVG as
   a hint). The browser checks only the 2 MiB limit (a pre-check, to spare an upload; the service is the
   authority). The file name and type are never used to decide anything.
2. The file is posted at once to `POST /v1/letterheads/{entity}/assets` (kind logo or background). The
   field shows the picker's busy state; the rest of the form stays usable.
3. Success: a thumbnail (fetched with the person's token from `GET /v1/assets/{id}` and shown from an
   object URL, because `<img src>` cannot carry the token) and "Current file: PNG, 400 × 150 px" replace
   the empty state; the form is dirty. The asset joins the version only on save; an abandoned upload is
   the service's to sweep.
4. Refusals appear in the field's own error line (`errorRole="alert"`, announced) and the picker returns
   to its idle state with the old file untouched: `unsupported_image`, `image_too_large`,
   `svg_unsafe:<reason>`, the 2 MiB pre-check, 403 `out_of_scope` / `forbidden` (the form turns read-only,
   F10/F11), network/5xx ("could not be uploaded, try again"). Each reason has its own sentence (§ Copy).
5. **Remove logo / Remove background** sets the slot to empty in the form (no call). The thumbnail goes;
   focus moves to the field's **Choose file** button.

### F6 First-page and last-page variants on and off (AC-5.4, 5.5)
Each of the "First page" and "Last page" cards starts with a checkbox "Use a different first page" /
"Use a different last page", described by its rule (first: "Without it, page 1 uses the default page";
last: "Used on the last page of a document of more than one page. It must fit the same margins, so it
never changes where pages break"). Off: the card shows only the checkbox and "Not used. Its settings are
kept in this form until you leave." On: the full header/footer/logo/background controls appear. Turning
it on for the first time starts from a **copy of the default page's settings** (D-4); turning it off and
on again restores what the person had typed. A saved version stores `null` for an off variant. The
preview follows within the usual 300 ms + request; the person sees the effect on page 1 / the last page.
Focus stays on the checkbox; a polite line says "First page settings shown / hidden".

### F7 Save (AC-4.1, 4.8, 5.x, 6.x, 8.2, 8.3)
Sticky action bar: status text + **Save as version {n+1}** (primary). Disabled-looking (`aria-disabled`,
reason "No changes to save") while the form equals the loaded version. **Below `xl` the bar also holds
the secondary button Preview** (opens the Drawer, S1); from `xl` up the preview is beside the form and the
button is absent. (2026-11-17, implementation finding; owner to confirm)
1. Click: `POST …/versions {baseVersion, config}` (`baseVersion` = the loaded version, 0 for an entity
   with none). The button is `busy`; the form is not locked.
2. **201**: baseline = saved configuration; the `Saved` banner "Version {n} saved" (auto-dismiss, polite);
   the header shows the new active version; the history refetches on next view; focus stays on the Save
   button (now `aria-disabled`).
3. **422 `invalid_letterhead`** (refused values): an assertive `danger` `Banner` at the top of the form
   with a list "{n} values were refused. Nothing was saved." Each item is a button that names the setting
   in words and moves focus to its control. **Focus moves to the first refused control in page order**
   (AC-8.3); the same sentences are shown next to each control (S4). Frame-level refusals
   (`header_overflow` / `footer_overflow`, the 40-character rule) sit under the Header/Footer heading and
   focus goes to that frame's first control.
4. **409 `version_conflict`**: a `danger` banner "A newer version was saved while you were editing. Your
   changes are still in this form but were not saved. Reload to work on their version; nothing they
   saved is lost." with **Reload and discard my changes**. Until then Save is `aria-disabled` ("Reload
   first") and the form stays editable and readable, so the person can copy values over by hand. Reload
   refetches the active version, replaces the form and baseline, clears errors, and moves focus to the
   page heading. **The button acts directly**: its label already says it discards, and the banner has just
   said that the changes were not saved, so there is no second `ConfirmDialog` (F9's dialog does not apply
   to it). (2026-11-17, implementation finding; owner to confirm)
5. **403 `out_of_scope`** or **403 `forbidden`** (the grant changed): a `warning` banner "You can no longer
   change this letterhead" and the form turns read-only (F10/F11); the person's edits stay visible.
6. Network / 5xx: inline `danger` banner "The letterhead was not saved. Your changes are still here." with
   **Try again**.

### F8 History, open an old version, restore (AC-4.2, 8.7)
History view (`Tabs` Settings | History): `DataTable` of versions (newest first): number (with an
**Active** badge on the highest, and "Restored from version {m}" under a restored one), who saved it,
when (`formatDateTime`), what changed (setting names; a restore says "Same settings as version {m}").
Row actions: **Open** (everyone with access) and **Restore** (managers in scope, not on the active row).
- **Open**: if dirty, leave dialog (F9). Then `?version=n`, the view switches to Settings, the form loads
  that version read-only (`GET …/versions/{n}`), the preview shows it, and a version banner heads the
  page: "Viewing version {n}. Saved by {who} on {date}. This is not the active version." with **Back to
  the active version** and, for managers, **Restore this version**. Focus moves to the banner's heading.
- **Restore** (row or banner): `ConfirmDialog` (primary tone): "Restore version {n}? This creates version
  {next} with the same settings and logos as version {n} and makes it the active one. Version {active}
  and the rest of the history stay as they are." Confirm sends `…/versions/{n}/restore {baseVersion}`.
  Busy and an inline error line stay in the dialog. 201: `Saved` "Version {next} created from version {n}",
  the page shows the new active version (Settings view, editable), focus on the page heading. 409
  `version_conflict`: dialog error "A newer version was saved meanwhile. Reload the history and try
  again." with the list refetched behind it. 403: dialog error + read-only mode.
- States: loading (`Loading`), empty ("No versions yet", only before the first save), failed
  (`LoadFailure`), a version that no longer loads (404): `warning` banner with **Back to the active version**.

### F9 Leave with unsaved changes (AC-8.8)
"Dirty" = the form differs from its loaded version, or an upload is in flight. Three guards, one dialog:
- **In-app navigation** (sidebar to another tool, browser Back to another tool): the page registers
  `registerNavigationBlocker(() => dirty, message)` through `shell/session`; the shell raises its own
  confirmation with the remote's message (the meetings-ui seam).
- **Inside the page** (switch entity, open a version; not the conflict reload, see F7.4 (2026-11-17, implementation finding; owner to confirm)): the page's own
  `ConfirmDialog` (danger tone): title "Leave without saving?", body "You have unsaved changes to the
  letterhead of {entity}. If you continue, they are lost.", **Keep editing** (default focus) and a
  confirm whose label names the act: **Switch and discard**, **Open and discard**, **Leave and discard**.
- **Tab close or reload**: `beforeunload` while dirty (the browser's own text).
Nothing is kept in browser storage (no draft recovery; no AC asks for it).

### F10 Access-only (read-only) mode (AC-8.2)
For a holder of `letterheads:access` without `letterhead:manage` (`canManage` false for both entities):
the form is the same, shown in a `fieldset disabled`; an `info` banner (`live="off"`, `role=note`) at the
top says "You can see this letterhead, its history and its preview, but you cannot change it. Ask an
administrator for the permission to change letterheads." There is **no** Save button, no Restore, no
Upload/Remove (they are not rendered, so nothing is offered that the service would refuse with 403). The
preview works, the language switch works, the history lists and **Open** works, the help card works
(it sits outside the `fieldset`). Keyboard: the page is read by Tab through tabs, language switch, help,
history; values in the disabled form are read in browse mode.

### F11 Out-of-scope entity for a scoped manager (AC-8.2)
A person whose grant is conditioned on one entity sees both entities. On their own entity the form is
editable (F7). On the other one it is the F10 mode with a more specific banner: "You can change only the
letterhead of {own}. This one is read-only for you." They never meet a 403 by trying: the controls are
not offered. The 403 `out_of_scope` that can still happen (grant removed or narrowed within the 30 s
authorization cache) is handled in F7.5 and F5.4. An administrator (unconditioned) can change both.

### F12 CRM wizard Preview with the service's pages (AC-10.3, 10.4, 10.5; the plan's `POST /deals/{id}/offer-draft/preview`)
Only when `letterheadService` is true (§ Which path the UI takes).
1. The preview pane (wide: sticky `aside`; narrow: the Drawer behind **Preview**) shows the service's
   pages in place of the HTML pagination. The pane's title row, the missing-count badge, the Drawer, the
   region and the address notice are the wizard's existing ones; the letterhead band is gone (there is no
   letterhead state to report: the pages are the PDF's own).
2. 250 ms after the last change of the draft (the wizard's existing debounce) the pane posts the **unsaved**
   draft body to `POST /deals/{id}/offer-draft/preview` (all pages). The request starts when a preview is
   first shown (the first step after Template on wide, the Drawer's first opening on narrow) and again on
   each change while a preview is shown. Closing the Drawer keeps the last answer in the page's state;
   reopening it shows that answer at once and asks again only if the draft changed.
3. **Previous pages stay** until the new ones arrive, with "Updating…" and `aria-busy`; the first time, the
   A4 skeleton. The pane is never blank (AC-10.4).
4. **Stale answers are discarded** by a sequence id. The pane still aborts a superseded request in the
   browser, and that is harmless here: crm-api does not pass the browser's abort on to the layout service
   (its client uses only its own timeout), so the service's worker is not killed and the render finishes.
   Unlike the configurator (F3.3), nothing needs to be spared. (2026-11-17, implementation finding; owner to confirm)
5. A missing field is drawn on the page by the service (named style `missing`, with its label); the
   wizard adds nothing on top. The **list of missing fields** on the Preview step stays the way to reach a
   field (AC-10.5, AC-3.4 of the earlier spec); its counts come from the wizard's own resolution, as today,
   and the pane's badge uses the same count. Selecting and copying text from the preview is not offered.
6. Each page is a figure whose image has the text alternative "Page N of M" and whose text, as the service
   returns it, is available to assistive technology (§ Accessibility).
7. Exits: pages shown (S7); failure (F13); letterhead not configured (F13).

### F13 The preview cannot be made, or no letterhead is configured (AC-10.7, 10.8)
- **Service unreachable, error, `busy` or timeout** → crm-api answers 503 `layout_service_unavailable`.
  The previous pages stay; the status line says "Could not update"; a **compact `warning` Banner**
  `live="polite"` (announced once, not a dialog, not `role=alert`) in the pane says "The preview could not
  be updated. The pages shown are from your last successful preview." with **Try again**. Typing, step
  changes, autosave, Next and Generate are untouched. One automatic retry after the service's `Retry-After`
  for `busy`. No previous pages: the A4 placeholder is drawn empty (`aria-hidden`; it cannot hold text) and
  **the notice banner above it carries the sentence** "There is no preview yet. You can keep working; the
  draft is still saved." (key `…failedFirstBody`), with **Try again**, in place of the "pages shown are from
  your last successful preview" body, which would be untrue. Still not blank. (2026-11-17, implementation finding; owner to confirm)
- **Busy is waited out, not reported** (2026-11-17, implementation finding; owner to confirm). Two answers mean "come back later", and neither shows the
  failure notice at first (`useServicePreview.ts`, `busyOf`):
  - **503 busy** (a 503 with `Retry-After`, or `reason: busy`): asked **once more** after the `Retry-After`
    (2 s when the answer names none). A second 503 is a failure: the notice above.
  - **429 `preview_busy`** (crm-api's per-person cap of 2 previews in flight): retried **quietly up to 3
    times**, after its `Retry-After` (1 s when none), each time with the **latest** input (a retry never
    re-sends a superseded draft). Meanwhile the previous pages stay and the pane reads "Updating…"
    (`aria-busy`); with no pages yet it is the first-load skeleton. The failure notice appears only when the
    **4th attempt** (the first ask and the three retries) is still busy.
  - Each kind has its own count, and it starts again for a new draft and after **Try again**, which gets
    its whole budget. An aborted request is never retried.
- **409 `letterhead_not_configured`** → a `warning` `Banner` (not compact, `live="polite"`) in the pane:
  "No letterhead is set for {entity}. The preview and the PDF need one." The pane keeps its previous
  pages if any, else the empty `aria-hidden` A4 placeholder; the words are the banner's, above it. (2026-11-17, implementation finding; owner to confirm) **Only a holder of access to Letterheads**
  (`usePermissions().apps` includes `letterheads`) gets the action **Open Letterheads** (a link to
  `/letterheads?entity={entity}` on the shell's path); everyone else reads "Ask an administrator to set it
  up in Letterheads." and sees no link (AC-10.8). The wizard stays usable; no PDF with a plain header is
  ever offered.
- **Letterhead overflow** (409 `letterhead_overflow`) (2026-11-17, implementation finding; owner to confirm): a value of the entity's profile does not fit
  the letterhead's header or footer (AC-5.3). A `warning` `Banner` (not compact, `live="polite"`) in the
  pane (`LetterheadNotice`, `problem="overflow"`), titled with the entity and **the frame named**
  ("A value of the {entity} profile does not fit the letterhead's header" / "...footer"; `frame` comes from
  the answer, `header` if absent). Body: "Shorten the value in CRM Settings, or change the letterhead."
  **Link rule as not-configured**: only a holder of access to Letterheads gets **Open Letterheads**; everyone
  else reads "Shorten the value in CRM Settings, or ask an administrator to change the letterhead in
  Letterheads." and sees no link. The pane keeps its previous pages, the wizard stays usable, no retry.
- **Section too long** (422 `section_too_long`) (2026-11-17, implementation finding; owner to confirm): a section prints more than 20 000 characters (Generate
  refuses the same text). A compact `warning` `Banner` `live="polite"` that **names the section(s)** by the
  template's heading, in quotes ("The section "X" is" / "The sections "X", "Y" are"; "A section of the
  offer is" when it has no heading, as an opening or an annex), then "longer than 20 000 characters, so the
  preview cannot be updated. The pages shown are from your last preview. Shorten the text and the preview
  will follow." **No Try again and no automatic retry** (the same text would be refused again); the previous
  pages stay, and the next change of the draft asks again.
- **Entity profile missing** (409 `entity_profile_missing`) (2026-11-17, implementation finding; owner to confirm): the entity's legal name is blank. A compact
  `warning` `Banner` `live="polite"`: "The preview cannot be made: the legal name of {entity} is not set. Set
  it in CRM Settings." No retry and no link (CRM Settings is where the person already is); previous pages
  stay.
- **Template format mismatch** (409 `template_format_mismatch`, on **try-preview** only) (2026-11-17, implementation finding; owner to confirm): the template is
  a classic one, not a wizard template. It is **not given its own notice**: it falls into the generic
  failure above (compact `warning` Banner with **Try again**, body by whether pages exist), and the view
  does not fall back to the browser-drawn preview. The dedicated sentence exists
  (`offers.errors.templateFormatMismatch`) but the pane does not use it; Try again cannot fix it. Left as
  built; see Amendments.
- **Generate** (AC-10.6, 10.8): the same two answers on `POST …/generate` appear in the Preview step's
  existing `Banner tone="danger" role="alert"` area (S10 of the wizard design): 503
  `layout_service_unavailable` → "The layout service is not available. Nothing was created: no offer
  number was used and the draft is unchanged. Try again in a moment." + **Retry**; 409
  `letterhead_not_configured` → "No offer was created: no letterhead is set for {entity}." + the same
  link rule. Focus follows the wizard's existing rule for a failed Generate (the issues heading). Generate
  stays available (the state may have changed since the last preview).

### F14 CRM Settings without the upload card (AC-10.11, 10.13)
With `letterheadService` true, `SettingsPage` renders, per entity, `EntityProfileForm`, `OfferNumberingCard`
and `TemplatesCard`, and **not** `LetterheadCard`. Nothing replaces it (no AC asks for a pointer; see
"Not designed"). With it false, Settings is exactly as today. The upload, replace and download actions,
their errors (`letterhead_invalid`, `letterhead_unusable`) and strings are unreachable after the switch.

### F15 Template editor "Try the wizard" on the service path (AC-10.14; plan amendment G1)

Same behaviour as F12/F13, with no deal. `TryWizardView` keeps its form and sample answers; on the
service path its preview pane is `ServicePreview` fed by crm-api
`POST /offer-templates/{id}/try-preview` with the unsaved template content, the sample answers, the
entity and the language. Debounce, keep the previous pages while updating, discard stale answers,
polite failure notice and `letterhead_not_configured` (with the /letterheads link only for holders of
access) exactly as in F12/F13 and S9. No new component, no new copy beyond F13's keys (and the two below).
On the old path (switch off) the view is unchanged.

**Try the wizard always shows the service's pages on the service path** (2026-11-17, implementation finding; owner to confirm). A template that was never saved
and a person who cannot change the template both get the service's pages: there is no browser-drawn
approximate preview, no `info` note and no request-less case. Task T53 adds a **try-preview route with no
template id** (the unsaved template travels whole, with the answers, the entity and the language) and
relaxes both try-preview routes to the template editor's **read** guard (`crm:access` + `deal:financials`; **no entity
scope**, as template reads have none: a person who passes the guard may try either entity's template) (2026-11-17, implementation
finding; owner to confirm), because a preview stores nothing; the per-person cap and the switch apply as before. This
**supersedes Amendment 2** (the approximate preview for those two cases) and removes its deviation from
AC-10.14. The two keys `templates.wizardEditor.try.unsavedPreview` and `…readOnlyPreview` leave the
service path (§ Copy keys). The template-format mismatch above is the one answer this view can still get
that the deal's wizard cannot.

## Which path the UI takes (the switch)

- crm-ui reads one boolean, `letterheadService`, from the answer it already loads once per session for
  capabilities (`useCrmCapabilities` / `GET /scope`; the plan leaves "`GET /config` or the existing scope
  answer" open, Gap G7). `false`, absent (older crm-api during a rolling deploy) or not yet loaded = the
  **old path**: `DocumentPreview` with the browser-drawn letterhead, and `LetterheadCard` in Settings. The
  CRM shell already waits for that answer before rendering pages, so no preview mounts before the flag is
  known.
- `true` = the **service path**: `OfferWizard` mounts `ServicePreview` where it mounted `DocumentPreview`
  (same two slots, wide pane and Drawer, same props for the draft and the address notice), `useLetterhead`
  is not called, and `SettingsPage` omits `LetterheadCard`.
- The choice is made in **one place** (the component that renders the preview slot, and `SettingsPage`),
  never inside the old preview. Both paths stay in the tree until the follow-up that drops the profile
  columns (plan R8); the old ADRs and strings stay.
- The template editor's "Try the wizard" view takes the same switch and shows the service's pages in every case (F15; Gap G1 was resolved by AC-10.14, and the two no-preview cases were removed by T53). (2026-11-17, implementation finding; owner to confirm)

## Screens & states

### S1 The configurator page (`/letterheads`), wide (≥ 1280 px)
> mockup: .forge/design/20261116-letterhead-service/content/screens-v1.html (screen s1; reviewed by the owner 2026-11-16)

```
┌ Letterheads (h1) ─────────────────────────────────────────────────────────────────────────┐
│ [ wellD IT ]  wellD CH                                           ← entity Tabs             │
│ wellD IT   Active version 7  · saved by A. Rossi, 12 Nov 2026                  (h2)       │
│ [ Settings ]  History                                            ← view Tabs               │
│ ┌ banners: read-only · version view · conflict · refused · not saved ─────────────────────┐│
│ ┌ form column (Cards) ────────────────────────────┐ ┌ preview pane (sticky) ─────────────┐ │
│ │ ▸ Placeholders and special characters   (help)  │ │ Preview     Updating…  4 pages     │ │
│ │ ┌ Page setup ─────────────────────────────────┐ │ │ Sample document with sample company│ │
│ │ │ Margins (mm) Top[32] Bottom[34] Left[25.4]… │ │ │ data. Nothing is read from the CRM.│ │
│ │ │ Fonts  Body[Noto Serif] Headings[Ubuntu] …  │ │ │ Preview language ◉ Italian ○ English│ │
│ │ └──────────────────────────────────────────────┘ │ │ ┌ region (scrolls) ───────────────┐ │ │
│ │ ┌ Look of the document ──────────────────────┐ │ │ │  ┌ page 1 ─────────────┐        │ │ │
│ │ ┌ Default page ───────────────────────────────┐ │ │ │  │ logo      Offerta   │        │ │ │
│ │ │ h4 Header   valign ◉ Top ○ Bottom            │ │ │ │  │ …                    │        │ │ │
│ │ │   ☑ Draw a line between header and body …    │ │ │ │  └──────────────────────┘        │ │ │
│ │ │   Left zone  / Centre zone / Right zone      │ │ │ │  ┌ page 2 …                      │ │ │
│ │ │     Line 1  Text, Italian [          ]       │ │ │ └──────────────────────────────────┘ │ │
│ │ │             Text, English [          ]       │ │ └──────────────────────────────────────┘ │
│ │ │             Size[7.5] ☐ Bold  Colour #[595c69]■│                                          │
│ │ │     [+ Add a line]  (zone holds up to 4)     │ │                                          │
│ │ │   h4 Footer …  h4 Logo …  h4 Background …    │ │                                          │
│ │ ┌ First page ─ ☐ Use a different first page ──┐ │                                          │
│ │ ┌ Last page  ─ ☐ Use a different last page ───┐ │                                          │
│ └──────────────────────────────────────────────────┘                                          │
│ ══ sticky bar:  ● Unsaved changes         [Preview*]            [ Save as version 8 ] ═══════ │  *< xl
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Frame: `ToolLayout width="wide"`, `PageHeader` (h2 = entity name; description = active version and who/when;
  no actions, so the bar holds the one primary). Layout `grid grid-cols-1 gap-6 xl:grid-cols-2`; below `xl`
  the preview opens in a `Drawer` from the bar's **Preview** button (the wizard's rule), carrying the
  same `PagePreview` and the same state (a closed Drawer loses nothing).
- Card order and headings (h3): **Page setup** (margins; fonts) · **Look of the document** (AC-5.9) ·
  **Default page** · **First page** · **Last page**. Inside a variant: h4 **Header**, **Footer**, **Logo**,
  **Background image**. Inside Header/Footer: valign, rule, then three zones (`fieldset` + `legend` "Left
  zone"), each with up to 4 line groups (`fieldset` + `legend` "Line 1") holding Text Italian, Text
  English, Size, Bold, Colour.
- **Page setup**: four `Field`s with `inputMode="decimal"` (top, bottom, left, right), each labelled with
  the unit, hint "Between 5 and 100 mm. The body area must stay at least 100 × 150 mm." (bounds from the
  catalog); three font `select`s (body, headings, header and footer) from the catalog's closed list.
- **Look of the document**: a row per heading level 1–3 (size 8–24, bold, colour); body size (8–14) and line
  spacing (1.0–2.0); table header-row colour, "Draw cell borders", border colour; list marker `select`
  (Bullet | Dash). Every number is an `input` with `inputMode="decimal"`, parsed with `parseDecimal`;
  out-of-range values are sent as typed and refused by the service (the form never silently clamps).
- **Zone lines**: a zone starts with the lines it has (a zone may be empty). **Add a line** appends an empty
  line; at 4 lines it is `aria-disabled` with the reason "A zone holds up to 4 lines" in its description.
  **Remove** (`ghost`, icon-only `trash`, `aria-label` "Remove {zone}, line {n}") deletes a line; focus
  goes to the next line's first input, else the previous, else **Add a line**; a polite line says "Line
  removed". A new line's look starts at the zone's last line's look (D-5). Reordering is not offered (no AC).
- **Rule** (per header/footer): checkbox "Draw a line between the header and the body", then thickness (pt)
  and colour, shown only while ticked (absent from the DOM when off, values kept).
- **Colour** everywhere is the same control: a text input for six hex digits (an optional `#` is accepted
  and stripped on blur) with a `#` adornment and a small swatch of the current value. The swatch is
  decoration (`aria-hidden`); the hex is the value. A refused colour says "Use six hexadecimal digits, for
  example e50339".
- **Logo**: file field (F5); when a file exists: thumbnail, "Current file: PNG, 400 × 150 px", **Remove
  logo**, position `RadioGroupField` (Left | Centre | Right), height (mm) `Field` with hint "Between 5 and
  40 mm. The width follows the proportions." Position and height are absent from the DOM while no logo.
- **Background image**: file field and **Remove background**, hint "Drawn under everything else on the whole
  page. Text stays inside the margins."
- **Status text** in the bar: "No unsaved changes" / "Unsaved changes" (`text` + icon, never colour only);
  `Spinner` + "Saving…" while saving. The bar's text is not a live region; Save outcomes are (F7).
- States of the page: **loading** (`Loading`); **failed** (`LoadFailure`); **ready** (above); **empty
  entity** (S2); **read-only** (S5); **version view** (S6); **conflict** and **refused** banners (S3, S4).

### S2 Empty entity (no active letterhead) (AC-4.1)
`GET /v1/letterheads` says the entity has none. The Settings view shows the form filled with the catalog's
**starting values** (Gap G2: the plan gives no defaults), an `info` banner "{entity} has no letterhead
yet. The form shows starting values; fill it in and save to create version 1." and the preview of those
values. The header description is "No letterhead yet"; the bar's Save says "Save as version 1"; the
History view says "No versions yet". A person without the manage permission sees the same entity in
read-only mode with "{entity} has no letterhead yet." and no starting form values (an empty state:
`StatePanel` "No letterhead yet" with the sentence "Documents for this entity cannot be made until one is
saved. Ask an administrator.").

### S3 Conflict and gone (AC-4.8)
`409 version_conflict` banner (F7.4) is `danger`, `role="alert"`, first in the banner stack. The form and
preview stay; Save is `aria-disabled`. 404 on the entity's version (cannot happen with no delete route)
falls to the generic load failure.

### S4 Refused values (AC-5.1–5.9, 6.1, 6.6, 7.x, 8.3)
> mockup: .forge/design/20261116-letterhead-service/content/screens-v1.html (screen s4; reviewed by the owner 2026-11-16)
- **Summary** (after a refused **save** only): `Banner tone="danger"` `role="alert"`, title "Nothing was
  saved: {n} values were refused", a `ul` of buttons "{Where}: {reason}" that focus the control; at most
  the service's problems (no cap invented). On a refused **preview** the same problems are shown next to
  the controls but **no** summary banner and **no** assertive announcement (typing must not chatter); a
  polite status line in the pane says "{n} values are refused".
- **Next to the control**: every control sits in a `Field` (label above, hint, error below); the error is
  `aria-invalid` + `aria-describedby`. For a group (frame, zone) the error is a `p` with an id under the
  group's heading and the group's first control describes itself with it.
- **Naming**: a sentence is built from the problem's path (pointer into the configuration) and reason, in
  words the person can read without the form: "Footer, left zone, line 2, English text: uses {foo}, which
  is not a placeholder. The placeholders are {legal_name}, {address}, …". "Top margin: use a number between
  5 and 100 mm." "Footer: it does not fit the bottom margin, checked with every placeholder replaced by 40
  characters. Raise the bottom margin, shorten the text or use fewer lines." "Header, centre zone, line 1,
  Italian text: filled in Italian but empty in English." The reason codes the UI maps are listed in
  § Copy; an unknown reason falls back to "This value was refused." so the form never shows a code.
- **Focus** on a refused save: the first control in page order that carries a problem. The Banner list is a
  second way in. A polite line after a successful re-save clears nothing else.
- Problems clear as soon as the preview or the next save no longer reports them; a control's error also
  clears when the control changes (it comes back if the service still refuses it).

### S5 Read-only (F10, F11)
> mockup: .forge/design/20261116-letterhead-service/content/screens-v1.html (screen s5; reviewed by the owner 2026-11-16)
`fieldset disabled` around Page setup … Last page (not around the help card, the language switch, the
history or the page's tabs). Banner text per case in § Copy. No sticky Save bar; on `< xl` a slim bar holds
only **Preview**. Uploads, Add line, Remove and Use-a-different-page checkboxes are inside the fieldset, so
they are inert; the thumbnails stay visible.

### S6 Version view (F8)
`Banner tone="info" live="off"` as the first banner: heading "Viewing version {n}" (focus target, `tabIndex
-1`), "Saved by {who} on {date}. This is not the active version." Actions **Back to the active version**
(secondary) and, for managers in scope, **Restore this version** (primary). The form is S5's read-only,
whatever the person's permission, and the status text in the bar is replaced by those actions on `< xl`.
The preview shows version n (via its stored configuration; Gap G6 for layout versions).

### S7 Preview pane — configurator and wizard (`PagePreview`)

```
┌ region role=region aria-label="Preview of the sample document" tabindex=0 aria-busy ┐
│ status row: [Spinner] Updating the preview…                       4 pages           │  ← not a live region
│ notice slot (children): failed / refused / not configured (Banner)                   │
│ stage (bg-ink-mid)                                                                   │
│   <figure>  <img alt="Page 1 of 4">  <figcaption class="sr-only">page text</figcaption>
│   <figure>  …                                                                         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
- **Pages**: each `figure` is the PNG (893 × 1263) shown at `width = min(available, 794px)`, aspect 210:297,
  `bg-paper border border-muted` (the wizard's page-edge rule, 3.35:1 in the light theme, survives
  forced colours), 16 px gap on `bg-ink-mid`, no shadow, **light in the dark theme** (the page is a picture
  of paper: no filter, opacity or blend). `draggable={false}`, `select-none`. Images are decoded from the
  base64 string once per distinct string; a page whose string is unchanged keeps its DOM node (no flicker).
- **Region** is the one scroller: `overscroll-contain`, ends above the sticky bar on wide (wizard rule D19),
  `max-h-[80vh]` inside a Drawer, keyboard-scrollable (it is the single tab stop), `scrollbar-gutter:
  stable`. The scroll position is kept across updates and across a change of the page count.
- **States** (`state` prop): `loading` (A4 `Skeleton` page + "Preparing the preview…"); `ready`;
  `updating` (previous pages + status row); `failed` (previous pages or the A4 placeholder, plus the
  notice in the slot); `blocked` (letterhead not configured: A4 placeholder or previous pages + notice).
  No state ever renders an empty region.
- **Status row**: left, `Spinner` + "Updating the preview…" or "Could not update" or "{n} pages"; never a
  progress bar; reduced motion: the spinner is the library's (already honours it).
- **Notices** are the consumers' (their copy and actions): configurator → refused-form info, failed warning;
  wizard → failed warning, not-configured warning.
- **The A4 placeholder is a bare page-shaped box, `aria-hidden`; it cannot hold text.** Any sentence about
  an empty pane (F13) lives in the notice slot's banner above it, which is readable and announced. (2026-11-17, implementation finding; owner to confirm)

### S8 History view (F8)
> mockup: .forge/design/20261116-letterhead-service/content/screens-v1.html (screen s8; reviewed by the owner 2026-11-16)
`DataTable` caption "Versions of {entity}", columns Version · Saved by · Saved on · What changed · Actions,
rows sorted by version descending. Version cell: number, **Active** `Badge tone="accent"`, "Restored from
version {m}" `text-xs text-soft`. "What changed": the names of the settings, mapped to words by a table of
the setting names (§ Copy); unknown names show as received. Actions: **Open** (`secondary sm`, `aria-label`
"Open version {n} in the preview"), **Restore** (`ghost sm`, `aria-label` "Restore version {n}",
`aria-haspopup="dialog"`; absent on the active row, absent when the person cannot manage the entity).
Narrow: the table becomes the library's card rows. The preview pane stays on the right.

### S9 Wizard preview pane on the service path (F12, F13)
> mockup: .forge/design/20261116-letterhead-service/content/screens-v1.html (screen s9, s9b; reviewed by the owner 2026-11-16)

```
┌ aside (sticky, ≥ xl) / Drawer ───────────────────────────────┐
│ Document preview                          ⚠ 3 missing  (h3)  │  existing title row
│ [address notice, existing, only when it applies]             │
│ ┌ region ────────────────────────────────────────────────┐   │
│ │ Updating…                                   4 pages    │   │
│ │ [notice: could not update / no letterhead — Banner]    │   │
│ │ ┌ page 1 (service PNG, "Page 1 of 4") ┐                │   │
│ │ │ … the PDF's own pages, "1 / 4" included │              │   │
│ └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```
`ServicePreview` = existing title row + address notice + `PagePreview` + the wizard's notices. Missing
fields are on the pages (drawn by the service) and in the Preview step's list. The `aria-busy` of the
region follows the request, not the 250 ms debounce alone. No band, no note about approximate page breaks
(they are no longer approximate), no letterhead attempt state.

### S10 Settings (service path) (F14)
Same page, one card fewer per entity. Empty/loading/failed states of `SettingsPage` are unchanged.

### S11 Not found
`NotFoundPage` (as projects-ui) for any path under `/letterheads/…` other than the root.

## How the frame model is exposed (US-5, US-6; AC-5.2, 6.1, 6.2, 6.6, 8.3)

The form teaches the model through what is on screen, with one non-modal help card, and never shows a
template. The help card ("Placeholders and special characters", a native `details`/`summary` inside a
`Card`, collapsed, **outside** any disabled `fieldset`, at the top of the form) holds:

1. **The closed set of placeholders**, listed from the catalog (`GET /v1/catalog`), in a `dl`: name in
   `font-mono`, meaning, the sample value the preview uses. A name the catalog adds later is listed with
   its name only (no meaning string) so nothing is hidden. `{page}` and `{pages}` carry the example
   "Page {page} of {pages}" and "{page}/{pages}" and say that the zone the text is in sets its position.
2. **A literal brace or bracket**: "Write `{{` to print `{`, `}}` to print `}`; write `[[` to print `[`,
   `]]` to print `]`." Shown as a two-column "You type / It prints" table, taken from the catalog's
   escape help (AC-6.2).
3. **A conditional segment**: "Text in square brackets around placeholders prints only when every
   placeholder in it has a value. `[VAT: {vat}]` prints "VAT: CHE-123.456.789" when a VAT number is sent
   and nothing at all, label included, when it is not. A segment needs at least one placeholder and cannot
   hold another segment." (AC-6.6)
4. **The fit rule**: "A header or footer must fit its margin. When you save, the service checks it with
   every placeholder replaced by a 40-character value, and tells you which one does not fit. Raise the
   margin, shorten the text or use fewer lines." (AC-5.2)
5. **Lines**: "Each zone holds up to 4 lines. Each line has its own size (6–14 pt), weight and colour."

At the field: each frame section's hint reads "Placeholders such as {page} and {pages} are described in
'Placeholders and special characters' above"; a text input's `hint` is only used for its refusal, so it
stays short. The 40-character fit rule, the unknown placeholder, an unbalanced brace, a segment with no
placeholder or nested, and a text filled in one language only reach the person **as refusals next to the
text or the frame** (S4), not as client checks. Nothing in the form parses text. There is no preview of
"the template", no insert-placeholder buttons (no AC asks for them) and no raw JSON view.

## Component inventory

Library in use: **`@operai/ui`** (`operai-ui/src/index.ts`). In-repo reuse is from `projects-ui/`
(smallest gated tool) and `crm-ui/`; `letterheads-ui` cannot import `crm-ui`, so a pattern from crm-ui is a
copy of the pattern, not of the file.

| Element | Component | Source |
|---|---|---|
| Tool frame, h1, width | `ToolLayout width="wide"` | library |
| Page header (entity, version) | `PageHeader` | library |
| Entity and view tabs | `Tabs`, `tabPanelProps` | library |
| Cards of the form | `Card` (`headingLevel` 3), `FactList` for the version facts | library |
| Labelled inputs, hints, errors | `Field`, `parseDecimal`, `focusFirstInvalid` | library |
| Radio sets (valign, position, preview language, marker) | `RadioGroupField` (inline) | library |
| Native select (fonts, marker) | `select` inside `Field` (the wizard's S4 pattern) | library `Field` |
| File choose + size line | `FilePicker` (`error`, `inputTestId`) | library |
| Banners (read-only, version, conflict, refused, failed) | `Banner` (`tone`, `live`, `compact`, `actions`, `onRetry`) | library |
| Confirmations (leave, restore) | `ConfirmDialog` | library |
| History | `DataTable`, `Badge`, `Button`, `formatDateTime` | library |
| Narrow preview | `Drawer` | library |
| Loading, empty, forbidden | `SkeletonRows`, `Skeleton`, `StatePanel`, `Spinner`, `VisuallyHidden` | library |
| Save/confirm outcomes | `Saved` (compact auto-dismiss `Banner`) | projects-ui `components/LoadState.tsx` (pattern) |
| Loading, `LoadFailure`, `StaleWriteBanner` | pattern copy | projects-ui `components/LoadState.tsx` |
| `PermissionDenied`, `NotFoundPage` | pattern copy | projects-ui `components/PermissionDenied.tsx`, `pages/NotFoundPage.tsx` |
| `LetterheadsShell` (loads catalog + list, context) | pattern copy of `ProjectsShell` | projects-ui `components/ProjectsShell.tsx` |
| `useResource`, `api.ts`, `errors.ts`, router skeleton, `strings` layout, `noHardcodedStrings` test | pattern copy | projects-ui |
| In-app leave guard | `registerNavigationBlocker` | shell/session (`shell/src/lib/navigationBlocker.ts`) |
| Sidebar entry, route, strings | one `TOOLS` entry (`id: 'letterheads'`, `to: '/letterheads'`), `ToolId` union, `strings.tools.letterheads`, gated route + remote mount | shell `lib/tools.ts`, `router.tsx`, `strings` |
| Wizard preview slot, address notice, title row, Drawer, bar | unchanged | crm-ui `offerWizard/` |
| Cross-tool link | plain `<a className="link" href="/letterheads?entity=…">` (the shell owns the path) | none new |
| **`PagePreview`** (page stack, status row, notice slot, text alternatives, skeleton) | **NEW** (library) — second consumer on day one (configurator and wizard); nothing in the library draws image pages | `operai-ui/src/components/PagePreview.tsx` + story + test + design-system entry |
| **`useLatestResult`** (debounce, abort, sequence id, keep previous, `busy` retry) | **NEW** (library hook) — the same request discipline in two apps; no hook in the library does it | `operai-ui/src/lib/` |
| `ConfiguratorPage` + form state (reducer, baseline, dirty, problems by pointer) | **NEW** (letterheads-ui) — the tool's one page | `letterheads-ui/src/pages/` |
| `ZoneEditor` (a zone's up to 4 lines: two texts + look, add/remove, focus rules) | **NEW** (letterheads-ui) — no library list editor; `crm-ui`'s `ListFieldEditor` is wizard-specific and in another app | `components/` |
| `AssetField` (picker + upload + thumbnail + remove + refusal sentences) | **NEW** (letterheads-ui) — wraps `FilePicker`, which does not upload or preview | `components/` |
| `ColourInput` (hex text + swatch) | **NEW** (letterheads-ui) — the library has no colour input; native `type=color` cannot show the service's refusal of a hex and hides the value | `components/` |
| `CheckboxField` (one labelled checkbox with hint/error wiring) | **NEW** (letterheads-ui) — `CheckboxGroupField` is a group with a legend; 12 single checkboxes here (candidate for the library) | `components/` |
| `ErrorSummary` + `fieldPath` (pointer → words, pointer → control) | **NEW** (letterheads-ui) — no library summary; the wizard's `IssuesList` is wizard-specific | `components/`, `lib/` |
| `HistoryPanel` (table, open, restore dialog) | **NEW** (letterheads-ui), a composition of reused parts only | `components/` |
| `TextsHelp` (the help card) | **NEW** (letterheads-ui), plain content in a `Card` with `details`; non-modal on purpose, so it can stay open beside the field being edited (a `Drawer` would cover the preview and block the inputs) | `components/` |
| `ServicePreview` + `useServicePreview` (request, notices, link rule) | **NEW** (crm-ui) — replaces `DocumentPreview` on the service path | `offerWizard/` |
| `LetterheadNotice` (not-configured banner with the access-only link; used by the pane and by the Generate error) | **NEW** (crm-ui) — one rule in two places | `offerWizard/` |

Counts: **reuse 28** (library 21: `ToolLayout`, `PageHeader`, `Tabs`, `Card`, `FactList`, `Field`,
`RadioGroupField`, `FilePicker`, `Banner`, `ConfirmDialog`, `DataTable`, `Badge`, `Button`, `Drawer`,
`SkeletonRows`, `Skeleton`, `StatePanel`, `Spinner`, `VisuallyHidden`, `Icon`, `formatDateTime`; in-repo 7:
projects-ui `LoadState`, `PermissionDenied`, `ProjectsShell`, `useResource`/api/errors, router, strings
layout, shell `registerNavigationBlocker`). **NEW 13**: library 2 (`PagePreview`, `useLatestResult`),
letterheads-ui 9 (`ConfiguratorPage`, `ZoneEditor`, `AssetField`, `ColourInput`, `CheckboxField`,
`ErrorSummary`, `HistoryPanel`, `TextsHelp`, plus `LetterheadsShell` as a pattern copy counted once),
crm-ui 2 (`ServicePreview`, `LetterheadNotice`). Reuse : NEW = 28 : 13. No new token, no new icon (`trash`,
`plus`, `check`, `alert`, `info`, `lock`, `refresh`, `arrow-left` exist).

## Accessibility

Per screen. Library contracts (dialog focus trap, Esc, return focus; `Banner` roles; `Tabs` keys) are
relied on, not restated.

**Configurator**
- **Structure**: h1 tool (`ToolLayout`), h2 entity (`PageHeader`), h3 one per `Card`, h4 Header / Footer /
  Logo / Background image, then `fieldset`/`legend` for zones and lines. No level is skipped.
- **Labels (AC-8.3)**: every control has a **visible** label from `Field` (or a `legend` for a group).
  Repeated names are made unique by context, not hidden: a text input is labelled "Text, Italian" inside a
  `fieldset` "Line 2" inside a `fieldset` "Left zone" inside a `section` headed "Footer". Icon-only buttons
  carry an `aria-label` with the full context ("Remove footer, left zone, line 2").
- **Keyboard only**: the whole screen is Tab/Shift+Tab, arrow keys in tabs and radio groups, Space/Enter on
  buttons and checkboxes; Esc closes dialogs and the Drawer. No hover-only or drag-only control exists
  (no reordering, no colour wheel). The file field's **Choose file** is a real button.
- **Errors, named and announced (AC-8.3)**: a problem is shown in the control's `Field` error (`aria-
  invalid`, `aria-describedby`) in a sentence that names the setting in words (S4). A refused **save**: the
  summary `Banner` is `role="alert"` (announced once), and **focus moves to the first refused control**
  (page order); the summary's buttons focus any control and scroll it into view (`behavior: auto` under
  reduced motion). A refused **preview** does not move focus or announce assertively; its count is a
  polite status line.
- **Live regions** (polite `VisuallyHidden`): "Version {n} saved", "Showing {entity}", "Line removed",
  "First page settings shown/hidden", "{n} values are refused" (preview). `role="alert"` only for a refused
  save, a conflict, a not-saved failure and an upload refusal. The preview itself is **not** live (it
  would chatter on every keystroke); its status row is plain text.
- **Focus management**: after Save success focus stays on the Save button; after a conflict reload, a
  restore, or **Back to the active version**, focus goes to the page heading (`tabIndex -1`); after opening a
  version it goes to the version banner heading; after removing a line (neighbour, else Add), a logo
  (Choose file), or switching entity (the tab); dialogs return focus to their opener (library).
- **Read-only**: disabled fieldset values are readable in browse mode; the banner is a static note placed
  before the form so it is read first; no control is offered that the service would refuse (so no focusable
  control leads to a 403).
- **Colour is never the only signal**: dirty = icon + words; refused = icon + sentence + `aria-invalid`;
  swatches are decoration beside a hex value; active version = **Active** badge text.
- **Contrast**: library tokens only; the pages are pictures of paper and keep the wizard's page-edge rule
  (`border-muted` ≥ 3:1 against both stages). Hint and status text use `text-soft` at ≥ 12 px (no text
  below the library's 11 px floor).
- **Zoom 200 % / 320 px**: single column below `xl`, the preview in the Drawer, no horizontal page scroll;
  zones stack one under the other; the line look controls wrap under the two text inputs; the history becomes
  card rows.

**Preview pages (both apps) — AC-8.6, AC-10.5**
- Each page is `<figure>` containing `<img alt="Page {n} of {m}">` (the text alternative the AC names) and a
  visually-hidden `<figcaption>` holding **that page's text as the service returned it**, in reading order,
  line breaks kept (`white-space: pre-line`), `lang` = the document's language (it/en). A screen-reader user
  reads the page number, then the page text, page after page. This satisfies AC-8.6 ("Page N of M" alt, text
  available) and AC-10.5 (the page's text is the page's text alternative); see Gap G8 for the wording.
- The region is `role="region"`, named ("Preview of the sample document" / "Document preview"), `tabIndex=0`
  (the one tab stop that scrolls the pages), `aria-busy` while a request is in flight. Selecting or copying
  text from the pictures is not offered (`select-none`; the text lives only in the hidden captions).
- The notice slot's banners are `live="polite"` (failed, not configured) or `live="off"` (refused-form
  info); none is `role="alert"`, none is a dialog (AC-10.7).

**CRM wizard**: the Drawer, tabs, action bar and jump-to-field behaviour are unchanged. New: the failure and
not-configured banners are polite and non-modal; **Open Letterheads** is a real link (keyboard reachable) and
exists only for holders of access; the 503 and 409 Generate banners follow the wizard's `role="alert"` rule
and its focus move to the issues heading.

## Responsive

| Width | Configurator | Wizard pane |
|---|---|---|
| ≥ 1280 (`xl`) | form + sticky preview side by side; bar = status + Save | unchanged pane, `PagePreview` inside |
| 640–1279 | single column; **Preview** button in the bar opens the Drawer; line look controls in a row | unchanged Drawer |
| < 640 | one column; zone lines stack (Text IT, Text EN, then Size / Bold / Colour wrap); Drawer full width; history as card rows; bar in two rows | unchanged |

## Copy keys

Conventions as the wizard design: sentence case, functions for values, `it: typeof en`, catalog parity test
(`catalogGaps`), no JSX copy, no hard-coded strings test (as projects-ui). Common keys (`permissionDenied`,
`authUnavailable`, `loadErrorTitle`, `retry`, `reload`, `dismiss`, `staleWrite`) are copied from
`projects-ui/src/strings/common.ts` with the same wording. Entity labels reuse the suite's "wellD IT" /
"wellD CH". Keys → `strings.letterheads.*` in `letterheads-ui/src/strings/`.

**Nav, page, modes**

| Key | en | it |
|---|---|---|
| `nav.heading` | Letterheads | Carte intestate |
| `nav.loading` | Loading letterheads… | Caricamento delle carte intestate… |
| `entity.tabs` | Entity | Entità |
| `view.tabs` | Views of this letterhead | Viste di questa carta intestata |
| `view.settings` / `view.history` | Settings / History | Impostazioni / Cronologia |
| `page.active(n)` | Active version {n} | Versione attiva {n} |
| `page.activeBy(n,who,date)` | Active version {n}, saved by {who} on {date} | Versione attiva {n}, salvata da {who} il {date} |
| `page.none` | No letterhead yet | Nessuna carta intestata |
| `page.showing(entity)` (sr) | Showing {entity} | Visualizzazione di {entity} |
| `empty.banner(entity)` | {entity} has no letterhead yet. The form shows starting values; fill it in and save to create version 1. | {entity} non ha ancora una carta intestata. Il modulo mostra valori iniziali; compilalo e salva per creare la versione 1. |
| `empty.readOnlyTitle` | No letterhead yet | Nessuna carta intestata |
| `empty.readOnlyBody` | Documents for this entity cannot be made until one is saved. Ask an administrator. | I documenti di questa entità non si possono creare finché non ne viene salvata una. Chiedi a un amministratore. |
| `readOnly.access` | You can see this letterhead, its history and its preview, but you cannot change it. Ask an administrator for the permission to change letterheads. | Puoi vedere questa carta intestata, la sua cronologia e la sua anteprima, ma non puoi modificarla. Chiedi a un amministratore il permesso di modificare le carte intestate. |
| `readOnly.scoped(own)` | You can change only the letterhead of {own}. This one is read-only for you. | Puoi modificare solo la carta intestata di {own}. Questa per te è in sola lettura. |
| `readOnly.lost` | You can no longer change this letterhead. Your changes are still visible here but were not saved. | Non puoi più modificare questa carta intestata. Le tue modifiche sono ancora visibili qui ma non sono state salvate. |
| `version.title(n)` | Viewing version {n} | Visualizzazione della versione {n} |
| `version.body(who,date)` | Saved by {who} on {date}. This is not the active version. | Salvata da {who} il {date}. Non è la versione attiva. |
| `version.back` / `version.restore` | Back to the active version / Restore this version | Torna alla versione attiva / Ripristina questa versione |
| `version.notFound` | This version could not be loaded. | Impossibile caricare questa versione. |

**Save, conflict, leave**

| Key | en | it |
|---|---|---|
| `bar.clean` / `bar.dirty` | No unsaved changes / Unsaved changes | Nessuna modifica non salvata / Modifiche non salvate |
| `bar.save(n)` | Save as version {n} | Salva come versione {n} |
| `bar.saving` | Saving… | Salvataggio… |
| `bar.nothingToSave` | No changes to save. | Nessuna modifica da salvare. |
| `bar.reloadFirst` | Reload first. | Ricarica prima. |
| `bar.preview` | Preview | Anteprima |
| `save.saved(n)` | Version {n} saved | Versione {n} salvata |
| `save.failedTitle` / `save.failedBody` | The letterhead was not saved / Your changes are still here. Try again. | La carta intestata non è stata salvata / Le tue modifiche sono ancora qui. Riprova. |
| `conflict.title` | A newer version was saved | È stata salvata una versione più recente |
| `conflict.body` | Someone saved a newer version while you were editing. Your changes are still in this form but were not saved. Reload to work on their version; nothing they saved is lost. | Qualcuno ha salvato una versione più recente mentre modificavi. Le tue modifiche sono ancora in questo modulo ma non sono state salvate. Ricarica per lavorare sulla loro versione; ciò che hanno salvato non va perso. |
| `conflict.reload` | Reload and discard my changes | Ricarica e scarta le mie modifiche |
| `leave.title` | Leave without saving? | Uscire senza salvare? |
| `leave.body(entity)` | You have unsaved changes to the letterhead of {entity}. If you continue, they are lost. | Hai modifiche non salvate alla carta intestata di {entity}. Se continui, andranno perse. |
| `leave.message(entity)` (shell blocker) | same as `leave.body` | uguale a `leave.body` |
| `leave.keep` | Keep editing | Continua a modificare |
| `leave.switchEntity` / `leave.openVersion` / `leave.leave` | Switch and discard / Open and discard / Leave and discard | Cambia e scarta / Apri e scarta / Esci e scarta |

**Form**

| Key | en | it |
|---|---|---|
| `setup.title` | Page setup | Impaginazione |
| `margins.legend` | Margins (mm) | Margini (mm) |
| `margins.top/bottom/left/right` | Top / Bottom / Left / Right | Superiore / Inferiore / Sinistro / Destro |
| `margins.hint(min,max,w,h)` | Between {min} and {max} mm. The body area must stay at least {w} × {h} mm. | Tra {min} e {max} mm. L'area del testo deve restare di almeno {w} × {h} mm. |
| `fonts.legend` | Fonts | Caratteri |
| `fonts.body/heading/frame` | Body text / Headings / Header and footer | Testo / Titoli / Intestazione e piè di pagina |
| `look.title` | Look of the document | Aspetto del documento |
| `look.heading(n)` | Heading {n} | Titolo {n} |
| `look.size` / `look.bold` / `look.colour` | Size (pt) / Bold / Colour | Dimensione (pt) / Grassetto / Colore |
| `look.bodyText` / `look.lineSpacing` | Body text / Line spacing | Testo / Interlinea |
| `look.table` / `look.headerFill` / `look.borders` / `look.borderColour` | Table / Header row background / Draw cell borders / Border colour | Tabella / Sfondo della riga di intestazione / Disegna i bordi delle celle / Colore dei bordi |
| `look.marker` / `look.bullet` / `look.dash` | List marker (bulleted lists) / Bullet / Dash | Simbolo dell'elenco puntato / Punto / Trattino |
| `variant.default/first/last` | Default page / First page / Last page | Pagina predefinita / Prima pagina / Ultima pagina |
| `variant.useFirst` / `variant.useLast` | Use a different first page / Use a different last page | Usa una prima pagina diversa / Usa un'ultima pagina diversa |
| `variant.firstHint` | Without it, page 1 uses the default page. | Senza, la pagina 1 usa la pagina predefinita. |
| `variant.lastHint` | Used on the last page of a document of more than one page. It must fit the same margins, so it never changes where pages break. | Usata sull'ultima pagina di un documento di più pagine. Deve stare negli stessi margini, quindi non cambia mai dove vanno a capo le pagine. |
| `variant.off` | Not used. Its settings are kept in this form until you leave. | Non usata. Le sue impostazioni restano in questo modulo finché non esci. |
| `variant.shown(name)` / `variant.hidden(name)` (sr) | {name} settings shown / {name} settings hidden | Impostazioni di {name} mostrate / nascoste |
| `frame.header` / `frame.footer` | Header / Footer | Intestazione / Piè di pagina |
| `frame.valign` | Align the three zones to the | Allinea le tre zone in |
| `frame.top` / `frame.bottom` | Top / Bottom | Alto / Basso |
| `frame.valignHint` | Bottom lines up a one-line zone with the last line of a longer one. | «Basso» allinea una zona di una riga all'ultima riga di una più lunga. |
| `frame.placeholdersHint` | Placeholders such as {page} and {pages} are described in "Placeholders and special characters" above. | I segnaposto come {page} e {pages} sono descritti in «Segnaposto e caratteri speciali» qui sopra. |
| `rule.show(frame)` | Draw a line between the {frame} and the body | Disegna una linea tra {frame} e testo |
| `rule.thickness` / `rule.colour` | Thickness (pt) / Colour | Spessore (pt) / Colore |
| `zone.left/center/right` | Left zone / Centre zone / Right zone | Zona sinistra / Zona centrale / Zona destra |
| `line.n(n)` | Line {n} | Riga {n} |
| `line.textIt` / `line.textEn` | Text, Italian / Text, English | Testo, italiano / Testo, inglese |
| `line.add` | Add a line | Aggiungi una riga |
| `line.limit` | A zone holds up to 4 lines. | Una zona contiene al massimo 4 righe. |
| `line.remove(where)` (aria) | Remove {where} | Rimuovi {where} |
| `line.removed` (sr) | Line removed | Riga rimossa |
| `logo.title` / `logo.file` | Logo / Logo file | Logo / File del logo |
| `logo.position` / `logo.left/center/right` | Position / Left / Centre / Right | Posizione / Sinistra / Centro / Destra |
| `logo.height` / `logo.heightHint(min,max)` | Height (mm) / Between {min} and {max} mm. The width follows the proportions. | Altezza (mm) / Tra {min} e {max} mm. La larghezza segue le proporzioni. |
| `logo.remove` | Remove logo | Rimuovi il logo |
| `background.title` / `background.file` | Background image / Background image file | Immagine di sfondo / File dell'immagine di sfondo |
| `background.hint` | Drawn under everything else on the whole page. Text stays inside the margins. | Disegnata sotto tutto il resto su tutta la pagina. Il testo resta dentro i margini. |
| `background.remove` | Remove background | Rimuovi lo sfondo |
| `asset.current(fmt,w,h)` | Current file: {fmt}, {w} × {h} px | File attuale: {fmt}, {w} × {h} px |
| `asset.currentSvg` | Current file: SVG | File attuale: SVG |
| `asset.thumbAlt(what)` | Current {what} | {what} attuale |
| `asset.choose` / `asset.clear` / `asset.none` | Choose file / Remove file / No file chosen | Scegli file / Rimuovi file / Nessun file scelto |
| `asset.uploading` | Uploading… | Caricamento… |
| `asset.accept` (hint) | PNG, JPEG or SVG, up to 2 MB. | PNG, JPEG o SVG, fino a 2 MB. |

**Upload refusals** (`upload.*`, shown in the file field)

| Key | en | it |
|---|---|---|
| `upload.tooLargeClient` | This file is larger than 2 MB. | Questo file supera i 2 MB. |
| `upload.unsupported_image` | This file is not a PNG, JPEG or SVG image. The file name does not matter; the content is checked. | Questo file non è un'immagine PNG, JPEG o SVG. Il nome del file non conta: si controlla il contenuto. |
| `upload.image_too_large` | This image is too large. A file can be at most 2 MB, a PNG or JPEG at most 25 megapixels, an SVG at most 10 000 elements. | Questa immagine è troppo grande. Un file può essere al massimo di 2 MB, un PNG o JPEG di 25 megapixel, un SVG di 10 000 elementi. |
| `upload.svg.script` | This SVG contains a script. Export it again as a plain SVG. | Questo SVG contiene uno script. Esportalo di nuovo come SVG semplice. |
| `upload.svg.event_handler` | This SVG contains an event handler (an attribute such as onclick). Export it again as a plain SVG. | Questo SVG contiene un gestore di eventi (un attributo come onclick). Esportalo di nuovo come SVG semplice. |
| `upload.svg.foreign_object` | This SVG contains an embedded page element (foreignObject). Export it again as a plain SVG. | Questo SVG contiene un elemento di pagina incorporato (foreignObject). Esportalo di nuovo come SVG semplice. |
| `upload.svg.doctype_or_entity` | This SVG contains a document-type or entity declaration. Export it again as a plain SVG. | Questo SVG contiene una dichiarazione di tipo di documento o di entità. Esportalo di nuovo come SVG semplice. |
| `upload.svg.external_reference` | This SVG refers to something outside the file (a web address, a file or a stylesheet). Embed what it needs and export it again. | Questo SVG rimanda a qualcosa fuori dal file (un indirizzo web, un file o un foglio di stile). Incorpora ciò che serve ed esportalo di nuovo. |
| `upload.svg.other` | This SVG contains something that is not allowed. Export it again as a plain SVG. | Questo SVG contiene qualcosa che non è consentito. Esportalo di nuovo come SVG semplice. |
| `upload.failed` | The file could not be uploaded. Try again. | Impossibile caricare il file. Riprova. |

**Problems** (`problem.*`; "{where}: {reason}"; the reason codes are assumed, Gap G3)

| Key | en | it |
|---|---|---|
| `problem.summaryTitle(n)` | Nothing was saved: {n} values were refused (1: "Nothing was saved: 1 value was refused") | Non è stato salvato nulla: {n} valori rifiutati (1: «Non è stato salvato nulla: 1 valore rifiutato») |
| `problem.summaryHint` | Fix them and save again. | Correggili e salva di nuovo. |
| `problem.previewCount(n)` (status) | {n} values are refused | {n} valori rifiutati |
| `problem.previewTitle` / `problem.previewBody` | The preview shows the last valid form / Some values in the form are refused, so the preview was not updated. They are marked in the form. | L'anteprima mostra l'ultimo modulo valido / Alcuni valori del modulo sono rifiutati, quindi l'anteprima non è stata aggiornata. Sono segnalati nel modulo. |
| `problem.out_of_range(min,max)` | Use a number between {min} and {max}. | Usa un numero tra {min} e {max}. |
| `problem.not_a_number` | Enter a number. | Inserisci un numero. |
| `problem.bad_colour` | Use six hexadecimal digits, for example e50339. | Usa sei cifre esadecimali, per esempio e50339. |
| `problem.unknown_font` | Choose one of the listed fonts. | Scegli uno dei caratteri elencati. |
| `problem.unknown_placeholder(name)` | Uses {name}, which is not a placeholder. The placeholders are listed in the help above. | Usa {name}, che non è un segnaposto. I segnaposto sono elencati nell'aiuto qui sopra. |
| `problem.unbalanced_brace` | A brace is not closed. Write {{ or }} to print a brace. | Una parentesi graffa non è chiusa. Scrivi {{ o }} per stamparla. |
| `problem.segment_no_placeholder` | A segment in square brackets must contain a placeholder. Write [[ to print a bracket. | Un segmento tra parentesi quadre deve contenere un segnaposto. Scrivi [[ per stampare una parentesi quadra. |
| `problem.segment_nested` | A segment in square brackets cannot contain another one. | Un segmento tra parentesi quadre non può contenerne un altro. |
| `problem.too_many_lines` | A zone holds up to 4 lines. | Una zona contiene al massimo 4 righe. |
| `problem.language_missing(lang)` | Filled in one language but empty in {lang}. Fill in both. | Compilato in una lingua ma vuoto in {lang}. Compila entrambe. |
| `problem.body_too_small` | The body area would be smaller than 100 × 150 mm. Reduce the margins. | L'area del testo sarebbe inferiore a 100 × 150 mm. Riduci i margini. |
| `problem.frame_overflow(side)` | It does not fit the {side} margin, checked with every placeholder replaced by 40 characters. Raise the margin, shorten the text or use fewer lines. | Non sta nel margine {side}, controllato con ogni segnaposto sostituito da 40 caratteri. Aumenta il margine, accorcia il testo o usa meno righe. |
| `problem.asset_unknown` | This image is no longer available. Upload it again. | Questa immagine non è più disponibile. Caricala di nuovo. |
| `problem.refused` (fallback) | This value was refused. | Questo valore è stato rifiutato. |
| `where.*` | words for path segments: margins.top → "Top margin"; frame → "Header" / "Footer"; zone → "left zone"…; line → "line {n}"; text.it/en → "Italian text"/"English text"; variant → "Default page" / "First page" / "Last page" | parole per i segmenti: «Margine superiore»; «Intestazione» / «Piè di pagina»; «zona sinistra»…; «riga {n}»; «testo italiano» / «testo inglese»; «Pagina predefinita» / «Prima pagina» / «Ultima pagina» |

**Help card** (`help.*`)

| Key | en | it |
|---|---|---|
| `help.title` | Placeholders and special characters | Segnaposto e caratteri speciali |
| `help.placeholders` | Placeholders are replaced when a document is made. | I segnaposto vengono sostituiti quando si crea un documento. |
| `help.placeholder.legal_name/address/vat/iban/contacts` | The entity's legal name / The address, lines separated by a comma / The VAT number / The IBAN / The contacts line | La ragione sociale dell'entità / L'indirizzo, righe separate da una virgola / La partita IVA / L'IBAN / La riga dei contatti |
| `help.placeholder.page/pages` | The number of the page / The total number of pages | Il numero della pagina / Il numero totale di pagine |
| `help.pageFormat` | The zone a text is in sets where the page number is printed. Examples: Page {page} of {pages}, {page}/{pages}. | La zona in cui si trova un testo decide dove viene stampato il numero di pagina. Esempi: Pagina {page} di {pages}, {page}/{pages}. |
| `help.literal` | To print a brace or a square bracket, write it twice. | Per stampare una parentesi graffa o quadra, scrivila due volte. |
| `help.youType` / `help.itPrints` | You type / It prints | Scrivi / Viene stampato |
| `help.segment` | Text in square brackets around placeholders prints only when every placeholder in it has a value. [VAT: {vat}] prints "VAT: CHE-123.456.789" when a VAT number is sent, and nothing at all, label included, when it is not. A segment needs at least one placeholder and cannot hold another segment. | Il testo tra parentesi quadre attorno a dei segnaposto viene stampato solo se ogni segnaposto al suo interno ha un valore. [P.IVA: {vat}] stampa «P.IVA: CHE-123.456.789» quando la partita IVA è presente, e niente affatto, etichetta compresa, quando manca. Un segmento richiede almeno un segnaposto e non può contenerne un altro. |
| `help.fit` | A header or footer must fit its margin. When you save, the service checks it with every placeholder replaced by a 40-character value, and tells you which one does not fit. | Intestazione e piè di pagina devono stare nel loro margine. Al salvataggio il servizio li controlla con ogni segnaposto sostituito da un valore di 40 caratteri e indica quale non ci sta. |
| `help.lines` | Each zone holds up to 4 lines. Each line has its own size (6 to 14 pt), weight and colour. | Ogni zona contiene al massimo 4 righe. Ogni riga ha la propria dimensione (da 6 a 14 pt), peso e colore. |

**Preview** (`preview.*`, letterheads-ui)

| Key | en | it |
|---|---|---|
| `preview.title` / `preview.region` | Preview / Preview of the sample document | Anteprima / Anteprima del documento di esempio |
| `preview.sample` | Sample document with sample company data. Nothing here is read from the CRM or any other tool. | Documento di esempio con dati aziendali di esempio. Nulla viene letto dal CRM o da altri strumenti. |
| `preview.language` / `preview.it` / `preview.en` | Preview language / Italian / English | Lingua dell'anteprima / Italiano / Inglese |
| `preview.pages(n)` | {n} pages (1: "1 page") | {n} pagine (1: «1 pagina») |
| `preview.updating` / `preview.failedShort` | Updating the preview… / Could not update | Aggiornamento dell'anteprima… / Aggiornamento non riuscito |
| `preview.loading` | Preparing the preview… | Preparazione dell'anteprima… |
| `preview.pageAlt(n,m)` | Page {n} of {m} | Pagina {n} di {m} |
| `preview.failedTitle` / `preview.failedBody` | The preview could not be updated | Non è stato possibile aggiornare l'anteprima |
| | The pages shown are from your last successful preview. Your changes are kept and you can still save. | Le pagine mostrate sono dell'ultima anteprima riuscita. Le tue modifiche sono conservate e puoi ancora salvare. |
| `preview.failedFirstBody` | There is no preview yet. Your changes are kept and you can still save. | Non c'è ancora un'anteprima. Le tue modifiche sono conservate e puoi ancora salvare. |
| `preview.retry` | Try again | Riprova |

**History** (`history.*`)

| Key | en | it |
|---|---|---|
| `history.caption(entity)` | Versions of {entity} | Versioni di {entity} |
| `history.version/savedBy/savedAt/changed/actions` | Version / Saved by / Saved on / What changed / Actions | Versione / Salvata da / Salvata il / Cosa è cambiato / Azioni |
| `history.active` | Active | Attiva |
| `history.restoredFrom(m)` | Restored from version {m} | Ripristinata dalla versione {m} |
| `history.sameAs(m)` | Same settings as version {m} | Stesse impostazioni della versione {m} |
| `history.open(n)` / `history.restore(n)` (aria) | Open version {n} in the preview / Restore version {n} | Apri la versione {n} nell'anteprima / Ripristina la versione {n} |
| `history.openLabel` / `history.restoreLabel` | Open / Restore | Apri / Ripristina |
| `history.empty` | No versions yet | Nessuna versione |
| `history.setting.*` | words for the changed settings' names (margins, fonts, look, header, footer, logo, background, rule, first page, last page …); an unknown name is shown as received | parole per i nomi delle impostazioni modificate; un nome sconosciuto è mostrato com'è |
| `restore.title(n)` | Restore version {n}? | Ripristinare la versione {n}? |
| `restore.body(n,next,active)` | This creates version {next} with the same settings and logos as version {n} and makes it the active one. Version {active} and the rest of the history stay as they are. | Verrà creata la versione {next} con le stesse impostazioni e gli stessi loghi della versione {n} e diventerà quella attiva. La versione {active} e il resto della cronologia restano invariati. |
| `restore.confirm(n)` / `restore.busy` | Restore version {n} / Restoring… | Ripristina la versione {n} / Ripristino… |
| `restore.conflict` | A newer version was saved meanwhile. Reload the history and try again. | Nel frattempo è stata salvata una versione più recente. Ricarica la cronologia e riprova. |
| `restore.done(next,n)` | Version {next} created from version {n} | Creata la versione {next} dalla versione {n} |

**Shell and CRM** (new keys)

| Key | en | it |
|---|---|---|
| shell `tools.letterheads` | Letterheads | Carte intestate |
| crm `offerWizard.servicePreview.pages(n)` | {n} pages | {n} pagine |
| crm `…updating` / `…failedShort` | Updating… / Could not update | Aggiornamento… / Aggiornamento non riuscito |
| crm `…loading` | Preparing the preview… | Preparazione dell'anteprima… |
| crm `…pageAlt(n,m)` | Page {n} of {m} | Pagina {n} di {m} |
| crm `…failedTitle` / `…failedBody` | The preview could not be updated / The pages shown are from your last successful preview. You can keep typing and saving. | Non è stato possibile aggiornare l'anteprima / Le pagine mostrate sono dell'ultima anteprima riuscita. Puoi continuare a scrivere e salvare. |
| crm `…failedFirstBody` | There is no preview yet. You can keep working; the draft is still saved. | Non c'è ancora un'anteprima. Puoi continuare a lavorare; la bozza viene comunque salvata. |
| crm `…retry` | Try again | Riprova |
| crm `…invalidAnswers` (422 `answers_invalid`, built; see Amendments) (2026-11-17, implementation finding; owner to confirm) | The preview cannot be made while an answer is not valid. Correct it and the preview will follow. | L'anteprima non si può creare finché una risposta non è valida. Correggila e l'anteprima seguirà. |
| crm `…profileMissing(entity)` (2026-11-17, implementation finding; owner to confirm) | The preview cannot be made: the legal name of {entity} is not set. Set it in CRM Settings. | L'anteprima non si può creare: la ragione sociale di {entity} non è impostata. Impostala nelle Impostazioni CRM. |
| crm `…sectionTooLong(sections)` (2026-11-17, implementation finding; owner to confirm) | {The section "X" is / The sections "X", "Y" are / A section of the offer is} longer than 20 000 characters, so the preview cannot be updated. The pages shown are from your last preview. Shorten the text and the preview will follow. | {La sezione «X» supera / Le sezioni «X», «Y» superano / Una sezione dell’offerta supera} i 20 000 caratteri, quindi l’anteprima non si può aggiornare. Le pagine mostrate sono dell’ultima anteprima. Accorcia il testo e l’anteprima seguirà. |
| crm `letterhead.overflow.title(entity,frame)` / `.header` / `.footer` (2026-11-17, implementation finding; owner to confirm) | A value of the {entity} profile does not fit the letterhead's {header / footer} | Un valore del profilo di {entity} è troppo lungo per {l'intestazione / il piè di pagina} della carta intestata |
| crm `letterhead.overflow.body` / `.bodyAskAdmin` (2026-11-17, implementation finding; owner to confirm) | Shorten the value in CRM Settings, or change the letterhead. / ...or ask an administrator to change the letterhead in Letterheads. | Accorcia il valore nelle Impostazioni CRM, oppure modifica la carta intestata. / ...oppure chiedi a un amministratore di modificare la carta intestata in Carte intestate. |
| crm `letterhead.notConfigured.title(entity)` | No letterhead is set for {entity} | Nessuna carta intestata impostata per {entity} |
| crm `letterhead.notConfigured.preview` | The preview and the PDF need one. | Servono per l'anteprima e per il PDF. |
| crm `letterhead.notConfigured.generate` | No offer was created. | Non è stata creata nessuna offerta. |
| crm `letterhead.open` | Open Letterheads | Apri Carte intestate |
| crm `letterhead.askAdmin` | Ask an administrator to set it up in Letterheads. | Chiedi a un amministratore di configurarla in Carte intestate. |
| crm `templates.wizardEditor.try.unsavedPreview` (**removed from the service path by T53**; supersedes the earlier amendment; 2026-11-17, implementation finding; owner to confirm) | Save the template to see its pages as the PDF will draw them. Until then the preview is approximate. | Salva il template per vedere le sue pagine come le disegnerà il PDF. Fino ad allora l'anteprima è approssimativa. |
| crm `templates.wizardEditor.try.readOnlyPreview` (**removed from the service path by T53**; supersedes the earlier amendment; 2026-11-17, implementation finding; owner to confirm) | The pages as the PDF will draw them are shown to people who can change this template. This preview is approximate. | Le pagine come le disegnerà il PDF sono mostrate a chi può modificare questo template. Questa anteprima è approssimativa. |
| crm `generate.layoutUnavailable.title` / `.body` | The layout service is not available / Nothing was created: no offer number was used and the draft is unchanged. Try again in a moment. | Il servizio di impaginazione non è disponibile / Non è stato creato nulla: nessun numero di offerta è stato usato e la bozza è invariata. Riprova tra poco. |

## Decisions recorded here

- **D-1** Stacked cards, not variant tabs (errors can never hide; one tab strip fewer).
- **D-2** `PagePreview` and `useLatestResult` live in `@operai/ui` (second consumer, same day).
- **D-3** Save is never blocked by the form's own refused values or by a failed preview: the service decides
  on save (AC-8.6).
- **D-4** A newly enabled first or last page starts as a copy of the default page's settings. (Convenience,
  not an AC; recorded because it decides the initial state.)
- **D-5** A new zone line starts with the previous line's look.
- **D-6** All pages are requested (`pages=` unused). A ten-page offer is about 870 KiB as base64 (plan R6);
  revisit after the PERF run on Railway. The identical-string reuse of page images is client-side only.
- **D-7** A page's text is a visually hidden `figcaption` after the image, not an `aria-describedby`: browse
  mode reads it as text in order, and long descriptions are not truncated by screen readers.
- **D-8** The version view loads the old version into the same form, read-only, instead of previewing it
  beside the active form.
- **D-9** The configurator keeps no draft in browser storage; leaving discards after confirmation.

## Coverage

| AC | Where |
|---|---|
| 8.1 | F1; shell touchpoints (inventory) |
| 8.2 | F7.5, F10, F11, S5, "Gaps" G4 |
| 8.3 | S1, S4, How the frame model is exposed, Accessibility |
| 8.4, 8.5 | F3, S1, S7, Copy `preview.sample` |
| 8.6 | F3.2–F3.5, S7, Accessibility (pages) |
| 8.7 | F8, S6, S8 |
| 8.8 | F9, Copy (en/it parity), D-9; the sample's language follows the person (F3.6); dates through `formatDateTime` |
| 8.9 | No UI (auth seed); F1 relies on it |
| 10.3, 10.4, 10.5 | F12, S7, S9, Accessibility |
| 10.7 | F13 |
| 10.8 | F13 (`LetterheadNotice`) |
| 10.11 | F14, S10 |
| 10.13 | Copy (crm keys), parity test |
| 5.2 (A1–A3), 5.4–5.9, 6.1, 6.2, 6.6, 7.1–7.7 | the form (S1), F5, F6, How the frame model is exposed |
| 4.1, 4.2, 4.8, 4.7 | F7, F8, S2, S3, S8 |

Flows: **15** (F1–F15), with F12–F15 on the CRM side. (2026-11-17, implementation finding; owner to confirm)

## UI with no AC (not designed)

- A pointer ("Letterheads are managed in Letterheads") where the CRM Settings upload card used to be.
- A "Discard changes" / "Reset" button in the configurator (leaving and reloading does it).
- Placeholder insert buttons, reordering of zone lines, a live "body area is 159 × 231 mm" readout, a raw
  JSON/config view, a diff between versions, copy or export of a version.
- Showing `unprintableCharacters` (AC-7.6) or `missingPlaceholders` (AC-6.4) in the configurator: both are
  answer fields with no AC for the screen (the sample fills every placeholder).
- Showing the preview answer's `missingFields` in the wizard: the Preview step's own list (AC-3.4 of the
  earlier spec) is the source and stays.
- A standing indicator in the CRM that the entity has no letterhead before a preview or generation asks.
- A line in the wizard preview for the deal PDFs that are appended after the rendered pages (see G5).
- Draft recovery of unsaved configurator changes.

## Gaps for spec/plan

**Resolved 2026-11-16 by the owner:** G1 → spec AC-10.14 (crm-api `POST /offer-templates/{id}/try-preview`;
`TryWizardView` uses `ServicePreview` on the service path); G2–G10 → plan.md § Amendment (design gaps G1–G10),
whose answers replace the assumptions below (G3 reason codes and upload errors, G4 `canManage`, G7 `GET /scope`,
G8 confirmed as designed).

(As reported:)

- **G1 Template editor "Try the wizard" has no preview after the switch.** Its preview (the old design's F13/S13)
  shows an unsaved template on sample answers with no deal, so `POST /deals/{id}/offer-draft/preview` cannot
  serve it, and the browser-drawn letterhead goes with the uploaded PDF (AC-10.11, 10.12). Neither the spec
  nor the plan says what the Try view shows. Needs a decision (a crm-api route without a deal, or keeping
  the HTML preview there). Not designed.
- **G2 No starting configuration for an entity with no version.** The form of an empty entity (S2) needs
  defaults (margins, fonts, look, a default variant), and the first save needs a stated `baseVersion` (0?).
  The plan's catalog lists fonts, placeholders, styles, bounds and brace help only. Add `defaultConfig`
  to `GET /v1/catalog` and state `baseVersion` for the first save.
- **G3 `invalid_letterhead problems[]` is underspecified.** The UI needs (a) the syntax of `path`
  (assumed: a JSON Pointer into `LetterheadConfig`, e.g. `/variants/first/footer/left/1/text/en`,
  `/margins/left`, and a frame path for `header_overflow` / `footer_overflow`); (b) a closed list of `reason`
  codes (assumed in § Copy: `out_of_range`, `not_a_number`, `bad_colour`, `unknown_font`,
  `unknown_placeholder`, `unbalanced_brace`, `segment_no_placeholder`, `segment_nested`, `too_many_lines`,
  `language_missing`, `body_too_small`, `header_overflow`, `footer_overflow`, `asset_unknown`); (c) AC-6.1
  and AC-8.3 ask the error to name the placeholder, the text and the language, but the answer carries only
  path and reason: either add a `name`/`detail` member or accept that the UI re-parses the text it already
  holds (a second parser in the browser, which D-3's "no client rules" avoids); (d) `svg_unsafe:<reason>`
  reasons are not listed (assumed: `script`, `event_handler`, `foreign_object`, `doctype_or_entity`,
  `external_reference`) and the multipart fields of the asset upload (`kind`) are not stated; (e) whether
  `image_too_large` covers bytes, megapixels and SVG element count.
- **G4 The UI cannot tell what the person may change.** The plan's person routes have no scope answer
  (crm-ui has `GET /scope`; projects-ui too). The read-only modes (F10, F11) need, per entity, whether the
  person holds `letterhead:manage` in scope. Add `canManage: { welld_it: boolean, welld_ch: boolean }` to
  `GET /v1/letterheads` (or a `GET /v1/scope`). The browser must not re-implement the condition logic from
  `/authz/me` permissions (plan R3 already warns about drift there).
- **G5 Does `draftToBlocks()` print the "appended deal PDFs" line?** The old preview showed "Allegato C —
  file.pdf (appended)" as text. AC-10.3 says preview text equals the PDF's rendered pages, and the deal PDFs
  are appended unrendered (AC-10.1), so the preview cannot show them unless the PDF does too. Confirm they
  are intentionally absent from the preview.
- **G6 Opening an old version previews it on the current layout.** `POST …/preview` takes `{config, language}`
  only; a version carries its own `layoutVersion` (ADR-3). When a second layout exists, "open version n"
  would not show that version as it prints. Add `layoutVersion` (or `version`) to the preview request.
  Harmless while only layout 1 exists.
- **G7 Where `letterheadService` comes from is left open** ("`GET /config` or the existing scope answer").
  crm-ui has no `/config` call; the design assumes the answer behind `useCrmCapabilities` (`GET /scope`).
  Pick one.
- **G8 AC-8.6 and AC-10.5 word the page text differently.** AC-8.6: the image has the alternative "Page N of
  M" and the text is available to assistive technology. AC-10.5: the text is the page's text alternative.
  Designed as: `alt` "Page N of M" plus the text in a visually hidden caption (D-7). Confirm that reading
  satisfies both.
- **G9 The history answer's "who" and the "names of what changed" are undefined.** `createdBy` may be an
  account id (the change record has `actor_name`, but the versions route lists `createdBy`), and
  `changedSettings` is "keys only" without a vocabulary. The table (S8) needs a display name and a closed,
  documented set of setting names (or paths) to translate.
- **G10 The plan's route table has no "load the active version" shortcut.** The page must call
  `GET /v1/letterheads` and then `GET …/versions/{n}`; acceptable, noted only so the two calls are known to
  the task list (the list answer must carry the active version number).

## Amendments

Drift found while implementing. Each is also marked at its place in the text above. All (2026-11-17, implementation finding; owner to confirm).

1. **Superseded previews are not aborted (F3.3, F12.4).** The configurator lets in-flight previews finish
   and discards stale answers by sequence id, because an aborted preview request makes the service kill its
   worker (about 130 ms of font re-parsing for each new one). It aborts only on unmount or entity switch
   (`letterheads-ui/src/components/PreviewPaneRequest.ts`). The CRM wizard's aborts stay and are harmless:
   crm-api does not propagate the browser's abort to the service. The library hook `useLatestResult`
   (inventory) is unchanged; the configurator's fetcher ignores the signal the hook hands it.
2. **Superseded by Amendment 7.** **Try the wizard for a never-saved template or a person who cannot change it (F15).** No service request;
   the browser-drawn approximate preview with a note (keys `templates.wizardEditor.try.unsavedPreview`,
   `try.readOnlyPreview`; added to Copy keys). **Deviates from AC-10.14** for these two cases (the AC says
   the unsaved template being edited is previewed by the service), so the spec owner must accept it or
   change it. **Owner decision:** keep the approximate preview, or disable Try for unsaved templates.
3. **Placeholder sentence (F13, S7).** The A4 placeholder is `aria-hidden` and cannot hold text; the
   sentence lives in the notice banner above it (`…failedFirstBody`). Not-configured: the banner has the
   words.
4. **Save bar (F7, F9).** The Preview button is in the save bar below `xl`. The conflict **Reload and discard
   my changes** acts directly (its label says it discards) with no second `ConfirmDialog`; F9's in-page dialog
   no longer lists "reload after a conflict".
5. **Busy retry (F13).** 503 busy: one retry after `Retry-After`. 429 `preview_busy` (per-person cap of 2 in
   flight) is busy too: up to 3 quiet retries with the latest input, pages kept and "updating", the failure
   notice only after the 4th attempt (`crm-ui/src/components/offerWizard/useServicePreview.ts`, T51).
6. **Four CRM states designed after the fact (F13, Copy keys).** Letterhead overflow (409
   `letterhead_overflow`, frame named, link rule as not-configured); section too long (422
   `section_too_long`, section named, no retry, pages kept); entity profile missing (409
   `entity_profile_missing`); template format mismatch (409 `template_format_mismatch` on try-preview, built
   as the generic failure notice with **Try again**, which cannot help: **owner decision:** give it its own
   notice without a retry, using `offers.errors.templateFormatMismatch`, or accept). Also built and not
   asked for in the design: 422 `answers_invalid` (compact `info` Banner, key `servicePreview.invalidAnswers`,
   no retry; the next change of the draft asks again), recorded in Copy keys.
7. **F15 supersedes Amendment 2.** Try the wizard always shows the service's pages on the service path
   (T53: an id-less try-preview route, and the template editor's read guard for both routes). The approximate
   preview, its note and its two keys go; the deviation from AC-10.14 is gone with them.
8. **Stale lines fixed.** Coverage reads 15 flows (F1–F15); the "Which path the UI takes" bullet no longer
   says Try the wizard is outside this design.
