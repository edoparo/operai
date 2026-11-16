---
spec: 20261115
status: draft
---

# Design: CRM offer wizard — a guided offer built from the template

> Inputs: `spec.md` (approved, amended SA-1..SA-4), `plan.md` (approved by delegation),
> `decisions.md` (O3: values filled by a block/option are **kept** when it is switched off or
> replaced). UX reference: `WellD_OperAI_Wizard_Offerte.html` (steps as tabs, split form/preview,
> missing list, `opt` cards with nested fields, sticky footer). Not adopted: its markup, CSS, PDF,
> light/dark switch, URL prefill, JSON export (spec § Non-goals).
> Rules followed: `operai-ui/docs/building-pages.md`, `operai-ui/docs/design-system.md`,
> `operai-ui/src/index.ts`. Library in use: **`@operai/ui`** (Tailwind 4 token utilities, one
> styling dialect, ADR 20261031). Current screens read from source (`OffersCard`, `GenerateOfferDialog`,
> `TemplatesCard`, `TemplateEditorPage`, `CrmShell`, `MarkupHelp`, `LoadState`); no live audit was run
> (it needs an admin session seeded in the DB — creating users/roles was out of bounds for a headless run).
> Headless run: no Visual Companion; mockups below are ASCII.
> Re-synced 2026-11-15 to plan.md § Amendments ("post-design, delegated") and DD-27…DD-38: every changed spot is marked
> "(re-synced to plan DD-n, 2026-11-15)"; the contract gaps G1–G9 below are closed by those decisions.
>
> **Amended 2026-11-15 for the owner's approved amendment** (spec US-11 letterhead behind the HTML preview, AC-11.1–11.9;
> US-12 issuer legal name and address from the entity profile, AC-12.1–12.13; changed AC-3.2, 8.5, 9.6; plan § Amendment
> DD-53…DD-64). Every changed spot is marked "(owner amendment, DD-n)"; new decisions are D-22…D-32; new flows F14, F15;
> new gaps G11–G17. Library rules re-read for this pass (`operai-ui/docs/building-pages.md`, `design-system.md`,
> `operai-ui/src/index.ts`): nothing new is needed in `@operai/ui` — the `paper-*` tokens already exist (verified in
> `tokens.css`, identical in both themes), `Banner` already has `live="off"` and `compact`.
>
> **Re-synced 2026-11-15 for the owner's amendment OA-3 — "Real A4 pages"** (spec OA-3, AC-3.2, AC-11.1–11.13; plan § Amendment OA-3,
> DD-65…DD-72, DD-76). The preview is a stack of real A4 pages with the letterhead behind each and the text inside the PDF's frame.
> Changed: F3, F14, § Preview pane (rewritten: page stack, page size and scale, frame, type, states, Drawer, zoom), § Letterhead bands
> (caption and note), § Loading and layout stability, S10 and new S12b (`letterhead_unusable`), the component inventory, Accessibility,
> Responsive, the copy keys, coverage and gaps G18–G22, decisions D-33…D-42 (superseding D-8 in part, D-22, D-23, D-29, D-31).
> Every changed spot says "(OA-3)". The 10 CSS px text floor of AC-11.13 is taken as decided (the PO is rewording the AC and AC-11.11's
> O12/O13 readings; this document restates neither the break rules nor those readings, only what the person sees). Tokens re-read:
> **no new token, component or icon** — the page edge and the gap use `bg-ink-mid`, `bg-paper`, `border-muted` (verified contrast below).

## The two big calls

1. **The wizard is a full page, not a dialog.** Route `/crm/deals/$id/offer` (plan), `ToolLayout width="wide"`.
   Why: seven steps, a document preview that must sit *beside* the form, a draft that lives on the
   deal and is resumed from another device (a URL is the natural address), browser Back/refresh,
   and the page must stay usable for long sessions. A `Dialog` traps focus, locks scroll, ignores the
   backdrop while typing, tops out at `lg` (≈ 48rem) so a side-by-side preview is impossible, and is
   exactly the shape that made `GenerateOfferDialog` a 611-line single form. Dialogs stay for the *small*
   decisions inside the wizard (hand-edit a section, restore, switch template, discard).
2. **The editor's "Preview in wizard" (AC-8.5) is a second view of the editor page, not a full-screen
   dialog** (deviation from plan DD-25's *presentation*, not its substance: unsaved text, sample answers,
   no deal, no draft, no write). The editor page has `Tabs` "Edit" / "Try the wizard"; both panels stay
   mounted so nothing typed is lost. Why: the library has no full-screen dialog size, a dialog would
   trap the keyboard away from the problem list while the author is trying to fix what the preview shows,
   and `Tabs` is the library's own answer to "two views of the same page" (design-system § TabNav or Tabs).

## Flows

Ids: US/AC from spec.md. "Deal page" = `DealDetailPage` › `OffersCard`.

### F1 Start an offer (US-1, US-2; AC-1.1, 2.1–2.5, 6.5)
1. Deal page → **New offer** (primary `Link` in `OffersCard`'s header; hidden when a draft exists —
   the draft row carries *Continue*; hidden for non-`canManage`) → `/deals/$id/offer`.
2. Loading → **Template step** (no draft ⇒ no step tabs yet, only this step; nothing is stored until a
   template is picked, AC-1.1). Shows, in this order of checks: estimate gate banner (AC-2.4), unsent-newest-
   offer banner (018 AC-7.1), then the templates grouped by language (the person's UI language first),
   then "Classic templates" for languages without a wizard template (DD-9).
3. Pick **Use template** on a card → `POST offer-draft` (button `busy`) → `201` → Client step (`?step=client`).
4. Success exits: draft exists, steps appear. Error exits: `409 draft_exists` (open the existing draft with
   an info banner naming who started it and when), `409 estimate_not_ready`, `409 offer_not_sent`,
   `409 template_archived` (banner, list reloads without it), network (inline Banner, button back to idle).

### F2 Fill in the steps (US-1, US-2, US-4; AC-1.2–1.9, 2.1, 2.3, 2.5, 4.x)
Client → Scope → Conditions → Costs → Annexes (only if the outline has items there) → Preview. Move with
Back/Next in the sticky action bar, by clicking/arrow-keying a step tab, or by the browser Back button
(step is the `?step=` search param, replaced not pushed). Everything entered is the answers state; moving
never loses it (AC-1.6). Every content change triggers autosave (F5) and a debounced preview re-resolve (F3); clicking a tab or pressing Back/Next saves nothing, the current step rides on the next content save (re-synced to plan DD-31, 2026-11-15).
All steps are reachable as soon as the draft exists ("visited" in AC-1.6 is not a restriction: the answers
live on the server, so there is nothing to gate).

### F3 Watch the document (US-3; AC-3.1–3.3)
Wide: preview pane beside the form on every step after Template. Narrow: **Preview** button in the action bar
opens it in a `Drawer`. The preview is drawn as **A4 pages with the letterhead behind each** (OA-3, § The page stack). Re-resolved and
paged again 250 ms after the last change (≤ 1 s, AC-3.1, AC-11.11). A missing field is a
highlighted placeholder carrying its label; a not-yet-assigned reference is a dashed "assigned when the offer
is generated" run (AC-2.2).

### F4 Fix what is missing, then generate (US-3, US-4; AC-3.4–3.6)
Preview step → **Before you can generate** card lists *missing* and *to correct* items (to correct = invalid answers, cost-table errors and over-long hand edits, all from the engine's one issue list (re-synced to plan DD-32, 2026-11-15)) → choosing one moves to
its step and focuses the field (F4a) → when both lists are empty, **Generate offer** (primary) works: flush
autosave → `POST …/generate` (`busy`, whole page `inert` apart from the status line) → navigate to the deal
with `state: { generated: ref, proposePrompt }` → the deal page confirms with the compact auto-dismissing
`Banner success` (INC-19) and, for a `qualified` deal, opens the existing "move to proposal?" dialog.
Blocked path: Generate is `aria-disabled` with the counts next to it and in its description (AC-3.5).
Failure exits are in § Generation errors.

### F5 Autosave and resume (US-6; AC-6.1, 6.3, 6.7)
No Save button. Content changes are saved ≤ 1 s after the last one (≤ 5 s while typing); changing step alone saves nothing and the current step travels as `lastStep` with the next content save (re-synced to plan DD-31, 2026-11-15). Status text beside the title
says what is true (§ Save status). Close the tab, reload, or open the deal elsewhere: the wizard opens on the
draft's last step (that of the last content change; `?step=` wins when present (re-synced to plan DD-31, 2026-11-15)) with the answers as left. Two people: the stale writer stops, is told to reload (F6).
Nothing in browser storage (AC-6.7): no `localStorage`/`sessionStorage`/IndexedDB, not even for UI state
(the Drawer open/closed and the focused field are plain component state).

### F6 Conflict and gone (AC-6.3)
`409 version_conflict` on a PUT → autosave stops, the form becomes read-only (`<fieldset disabled>`), a `danger`
Banner with **Reload draft** appears (§ States). `404 draft_not_found` on a PUT/generate (colleague discarded
it, or generated the offer) → `warning` Banner "This draft no longer exists" with **Back to the deal**; the form
becomes read-only. Two people who only read and move between steps never cause a 409: a step change writes nothing, and a PUT identical to the stored draft is a no-op (200, same version) (re-synced to plan DD-31, 2026-11-15).

### F7 Change the template of a draft (AC-6.5, 8.4)
Template tab (always present once a draft exists) → another card's **Use template** → `ConfirmDialog` (danger:
answers are replaced) → `POST …/template` → client block, contacts, place and date kept; the rest replaced;
focus returns to the Template tab heading and a polite line says "Template changed to X". If the template was
*edited* since the draft began: the **template-changed notice** (F8).

### F8 Template edited or archived under a draft (AC-8.4, DD-8, DD-17)
Opening a draft whose `templateVersion` ≠ the template's: the client reconciles, saves, and shows an info
`Banner` at the top of every step until dismissed: "The template changed since you started. We kept the
answers whose fields still exist." with **See what was dropped** (opens a `Dialog`: dropped answers by label,
and any orphaned hand edits as read-only text with **Copy**). Orphaned hand edits also stay visible as a card on
the Preview step ("Text for sections that no longer exist — dropped when you generate") until generation.
Template archived while a draft exists: `warning` Banner "This template was archived. Choose another to keep
working" + the form read-only except the Template tab.

### F9 Hand-edit a section (US-5; AC-5.1–5.4)
Preview step › **Sections** table › **Edit text** → `FormDialog` (heading + text in the offer markup, in which every still-missing value and the not-yet-known reference is a visible ⟦Label⟧ token (re-synced to plan DD-30, 2026-11-15), markup
help, counters) → **Save text** (flushes the draft; the dialog stays busy and shows a conflict inline if it
occurs) → row shows **Edited by hand**; the preview marks the section; every field the section uses shows a
note naming it (AC-5.2). **Restore wizard text** (row action, and inside the dialog) → `ConfirmDialog` naming the
section and what is lost (AC-5.3) → the section follows the answers again. **Save text is refused while any ⟦ or ⟧ remains** in the heading or text — even for a field filled since, because hand-edited text no longer follows the answers (re-synced to plan DD-30, 2026-11-15). A heading or text over its limit at generate is an issue of the Preview list named `section:<key>`, not a separate banner (re-synced to plan DD-32, 2026-11-15).

### F10 Resume from the deal page (US-6; AC-6.4)
`OffersCard` shows the **draft row** (template, target, "changed by X, date"), read from `GET /deals/{id}/offer-draft/summary` — 200 `{ draft: null }` when there is none, never the answers (re-synced to plan DD-27, 2026-11-15): **Continue** → wizard on the draft;
**Discard** → `ConfirmDialog` (danger) → `DELETE` with the summary's version (If-Match; a 409 refetches the summary and says "the draft changed meanwhile", a 404 means it is already gone) → row disappears,
`success` Banner "Draft discarded". A person without `deal:financials` or without `deal:manage` over the deal's
entity never sees the row nor any hint (the card asks only when `/scope` reports both; the summary's 403 renders nothing and its body is the same with or without a draft, so nothing leaks (re-synced to plan DD-27, 2026-11-15)).

### F11 Edit / revise (US-7; AC-7.1–7.3)
`OffersCard` row/header actions, decided by `offer.origin`:
| Entry | Origin `wizard` | Origin `sections` | Origin `summary` (`OF-…`) |
|---|---|---|---|
| **Edit** (newest unsent) | `POST offer-draft { target: edit }` **without `templateId`** — the server takes the snapshot's template and reconciles its answers, hand edits included → wizard on the offer's answers; 409 `template_archived` → wizard Template step with `target` set, client + contacts carried over (re-synced to plan DD-28, 2026-11-15) | no wizard template for (entity, offer language) → legacy `GenerateOfferDialog` (unchanged); else wizard Template step with `target=edit`, client + contacts prefilled | no action (unchanged) |
| **New revision** (newest sent; header) | `POST offer-draft { target: revision }` without `templateId` (same rule, 409 `template_archived` → Template step with `target` set) (re-synced to plan DD-28, 2026-11-15) → wizard | same split as above with `target=revision` | no action |
A draft already exists → a three-button `Dialog` first: "A draft already exists on this deal" · **Cancel** ·
**Discard it and continue** (danger) · **Continue the draft** (primary) (018-style "continue it or discard it").
If the existing draft *is* for this very offer and target, the click just continues it. The wizard header always
says what generating will do (§ Target banner).

### F12 Maintain templates in Settings (US-8, US-9; AC-8.1–8.5)
Settings › Templates card (format badge, description) → **New template** / **Edit** / **Duplicate** → wizard
editor page (F13). Classic rows keep their classic editor. Archive/restore errors mapped (`last_template`,
`template_superseded`) in the card's existing `danger` Banner.

### F13 Edit a template (AC-8.1–8.5)
Editor page, two views. **Edit**: metadata, text, problems, outline (live, ≤ 300 ms debounce) → **Save** is
`aria-disabled` while errors exist (clicking it moves focus to the problems card) → `PUT` with If-Match.
**Try the wizard**: the same wizard on the unsaved text with sample answers, a preview, no Generate (§ Editor).

### F14 See the letterhead behind the preview (US-11; AC-11.1–11.9, owner amendment, DD-53…DD-56; OA-3 AC-11.10–11.13, DD-65…DD-72)
No task of its own: it happens around F3, with no action from the person and no wait.
1. **Opening the wizard** (the page mounts: a new offer, a draft resumed from another device, an edit, a revision; or the
   editor's Try view mounts) starts one *letterhead attempt* for this opening. The wizard context says whether the entity's
   profile has a letterhead (`letterhead`); none → state `none` at once, no request (AC-11.3).
2. **The first preview that mounts asks for it**: the inline pane on the first step after Template (wide), the Drawer's first
   opening (narrow). One attempt, ≤ 10 s, never retried, and never repeated when the person types, changes step, opens and
   closes the Drawer or resizes across `xl` (AC-11.4, 11.6, 11.8) — the result lives with the page, not with the preview.
3. **While it loads** (`pending`) the preview already shows the document's text on **A4 pages with the PDF's frame** (OA-3, AC-11.4), the
   pages empty behind it, and the band says the letterhead "is added in the PDF" (plus the note that page breaks are approximate).
   **When it is ready** (`shown`) the **same** image appears behind the text of **every** page and the band becomes the caption "shown on
   every page. Page breaks are approximate: the PDF is the authority". Nothing moves and no page break changes: the pages were
   A4-sized, with the same frame, all along (§ Loading and layout stability).
4. **If it cannot be shown** (link, bytes, render, a browser that cannot draw the image, 10 s, a 409 `letterhead_unusable` from crm-api; also the
   Try view when the profile is unreadable) → `failed`: the pages stay (A4, same frame, same breaks), the image is absent, the band says it "could
   not be shown here" and that the PDF still has it. No toast, dialog, alert or retry button; Generate, autosave and the counts are untouched
   (AC-11.4). Opening the wizard again tries again. (Generating with an unusable letterhead is refused separately, S10, finding G18.)
- Exits: `shown`, `none`, `failed` — three quiet end states; none blocks anything. An edit or a revision (US-7) is the same
  page, so the same flow (AC-11.9), on the same A4 pages.

### F15 The issuer's name and address come from the entity profile (US-12; AC-12.1, 12.7–12.9, 12.12, 12.13, owner amendment, DD-57…DD-62)
No step, no field: the wizard never asks for either (AC-12.1, 12.9). The preview prints them where the template uses them and
the editor's outline lists them as supplied (S13). The person meets them in exactly three exceptions:
1. **The profile has no address and the template prints it** → the address notice beside the preview (§ Address notice,
   AC-12.12). Nothing is blocked, counted or refused.
2. **The profile's legal name is blank** (damaged data only) → the preview prints nothing for it, no stand-in; **Generate offer**
   is `aria-disabled` with the reason "Set the legal name of {entity} in CRM Settings." (AC-12.7, DD-61); it is not a missing
   field, so the counts do not move and nothing can be focused.
3. **In the editor's Try view the profile cannot be read** (no `deal:financials`, network, 503) → sample name and address,
   said to be samples (S13, AC-12.8, 12.13); the view still works.

## Screens & states

### S1 Wizard page frame (`OfferWizardPage`)

```
┌ CRM (h1)  Companies · Contacts · Pipeline · Tasks · Settings ────────────────────────────┐
│ ‹ Back to the deal                                                                       │
│ New offer  [✎ Draft]                                      ✓ All changes saved            │  PageHeader h2
│ Acme SA — Website relaunch · WellD CH                                                    │  (title, status, description,
│ ─────────────────────────────────────────────────────────────────────────────────────────│   actions slot = SaveStatus)
│ [Template] [Client] [Scope ²] [Conditions] [Costs] [Annexes] [Preview ⁵]   ← Tabs        │
│ ┌ Banners: target / estimate / template changed / conflict ──────────────────────────────┐│
│ ┌ form column (step panel) ───────────────┐ ┌ preview pane (sticky, ≥ 1280px) ───────────┐│
│ │ h3 Step title + one-line intro          │ │ h3 Document preview      ⚠ 3 missing       ││
│ │ Cards of fields …                       │ │ ┌ A4 page 1 of N ───────────────────────┐ ││
│ │                                         │ │ │ …                                      │ ││
│ └─────────────────────────────────────────┘ └──────────────────────────────────────────┘│
│ ══ sticky action bar:  [‹ Back]   Step 3 of 6 · Conditions ▬▬▬▬░░   [Preview*]  [Next ›] ═│  *narrow only
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Column: `ToolLayout width="wide"`. `CrmShell` currently picks `wide` only for `/pipeline`; its `useMatchRoute`
  test also matches `/deals/$id/offer` and the template editor routes (a one-line change).
- `PageHeader`: back link in the `back` slot (a `.link`, `arrow-left` icon) in **every** state (loading, error,
  forbidden); `title` by target (§ Target banner); `status` = `StatusBadge status="draft"`; `description` = deal
  title · company · entity badge text; `actions` = `SaveStatus` only (no button, so no primary competes with the
  action bar's one primary).
- Layout: `grid grid-cols-1 gap-6 xl:grid-cols-2` (form | preview). Below `xl` the preview is a `Drawer`.
  The step panel is `tabPanelProps('offer-wizard', step)` (role `tabpanel`, labelled by its tab).
- **Step tabs**: `Tabs` (arrow keys, Home/End, automatic activation; each tab is a button, not a link — same
  page). A tab label is the step name plus, when there are issues, a `Badge tone="warning"` with the count and
  a `VisuallyHidden` "n missing" (never colour alone). The Preview tab's count = missing + to-correct. A step
  with nothing to ask is not in the list (AC-1.2). Before a draft exists there is no tablist at all.
- **Action bar** (sticky bottom of the content area, `border-t border-rule bg-ink-soft`): *Back* (secondary),
  *Step n of N · name* with a determinate `ProgressBar` (label "Offer progress"; value = step index, not
  completeness — completeness is the badges), *Preview* (secondary, `< xl` only, `aria-haspopup="dialog"`),
  *Next* (primary). On the Preview step *Next* is replaced by *Generate offer* (primary) and the count text.
  `< 640px`: two rows (info + Preview; Back/Next at 50% each). The bar's bottom padding reserves room for the
  shell's floating recorder dock (it rests on the edge clear of the footer, so no overlap by design).
- Template-derived text (labels, hints, option texts, section headings, the preview) is wrapped in
  `lang={template.language}` when it differs from the UI language (WCAG 3.1.2). Chrome stays in the UI language.

#### Target banner (always the first banner, `Banner tone="info" live="off" role=note`)
- new: none (the title says "New offer").
- edit: "You are editing offer {ref}, which has not been sent. Generating replaces it under the same reference."
- revision: "Revision of offer {ref}. Generating creates {nextRef}; the sent offer stays unchanged."
- legacy start (AC-7.3, no draft yet): "Pick a template to edit/revise {ref} with the wizard. The client and contacts of that offer are carried over."
- archived start (edit/revision of a wizard offer whose template was archived, no draft yet): "The template of offer {ref} was archived. Pick another to continue; the client and contacts are carried over." (re-synced to plan DD-28, 2026-11-15)

### S2 Template step (AC-1.1, 2.4, 6.5, 7.3, DD-9)
- **Estimate gate** (checked first): `estimate.state === 'missing'` → `Banner tone="warning"`: "This deal has no ready
  estimate, so no offer can be generated. Close the estimate in EstimAI or ask an admin to override the check."
  with a `Link` **Go to the estimate** (scrolls/links to the deal's Estimate card). All template cards are
  `aria-disabled` with the reason in their description. `override` → compact `info` Banner "The estimate check was
  overridden by an admin; figures from the estimate are not available."
- **Unsent newest offer** (target `new` only): `Banner tone="info"` "Offer {ref} has not been sent. Send or delete it
  before starting a new one." with **Edit it instead** (F11). Cards `aria-disabled`.
- **Template cards**, one `h3` per language ("Italian templates" / "English templates"), grid
  `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`: `Card headingLevel={4}` title = name; body = description
  (`text-sm text-soft`) + **Typical uses** as neutral `Badge`s (≤ 6); `action` = **Use template** (`secondary`, `sm`,
  `busy` while creating). The draft's current template shows a `Badge tone="accent"` "Current template" and no
  button. Picking while a draft exists → F7's `ConfirmDialog`.
- **Entered with a target** (`?target=` from the deal page: a legacy offer, AC-7.3, or a wizard offer whose template is archived, DD-28): the target banner above, then the same cards; **Use template** → `POST offer-draft { templateId, target }` (another template or a legacy offer: initial answers + the offer's client lines, contacts, place and date) (re-synced to plan DD-28, 2026-11-15).
- **Classic templates** (only languages without a wizard template, DD-9): a `Card` "Classic templates" with intro
  "These use the previous offer form" and a row per template: name, language, **Use classic form** (`secondary`) →
  `GenerateOfferDialog` (unchanged; on success the same navigate-to-deal confirmation).
- States: loading = `Loading` (skeleton + polite line); load failed = `LoadFailure` (`warning` Banner + Retry; 503
  = the "authorization service unavailable" title; 403 = `PermissionDenied` replacing the page); **empty** (no
  active templates for the entity at all — cannot happen for `welld_ch` after the seed) = `StatePanel` "No offer
  templates for {entity}" + (for an admin/`deal:manage` holder) **Open Settings** link; **forbidden for this deal**
  (403 `out_of_scope`) = `PermissionDenied`; **deal not found** = `StatePanel` "Deal not found" with the back link.

### S3 Client step (AC-2.1, 2.2, 2.5, 6.5)
Cards (all prefilled from the context, all editable):
1. **Client** — `list` editor of 1–8 lines (`ListFieldEditor`, line limit 200, hint "First line is the legal name").
2. **Contacts** — `CheckboxGroupField` of the company's contacts, ≤ 5 (`scroll`; at the limit the extra boxes stay
   enabled and the pick shows `pickError`, as `GenerateOfferDialog` does today); `emptyState` "This company has no
   contacts yet." (not an error, the line "All'attenzione di" is simply left out).
3. **Place and date** — place `input`; printed date as `RadioGroupField` "The day the offer is generated" (default)
   / "A specific date" + `DateInput` (±90 days, DD-16; error "Pick a date within 90 days of today").
4. **Reference** — read-only `FactList` row with a `lock` icon: "Assigned when the offer is generated" (edit:
   the existing reference; revision: "Next revision of {ref}"). Never an input (AC-2.2).
Fields that the template binds as `source:` values (client, place, date, validity…) are these controls, not
duplicated elsewhere. Currency is stated once, here, as a `FactList` row "Currency: CHF (the deal's)" (AC-2.5).

### S4 Scope / Conditions steps (generic step form; AC-1.2–1.9, 1.5, 5.2)
Items in text order inside one `Card` per step (title = step name is already the panel h3, so the card has no
extra title; sub-groups use `h4`). Control by kind:

| Item | Control | Notes |
|---|---|---|
| `text` | `input` (or `select` when `options`) | `select` offers exactly the declared options (AC-1.8) and has an empty first option only when there is no default; a stored value outside them (the template changed) stays selected as an extra flagged option "{value} — no longer an option" with the error `invalid.not_an_option`, until a listed one is picked (re-synced to plan DD-38, 2026-11-15) |
| `longtext` | `textarea` rows 4, `resize-y` | counter at 80 % of 20 000 |
| `number`, `percentage` | `input inputMode="decimal"` parsed with `parseDecimal` | percentage's unit is in the label |
| `date` | `DateInput` | `default: today` resolved once |
| `amount` | `MoneyInput` | label gets the currency: "Importo (CHF)" via `strings.offerWizard.field.withCurrency` |
| derived (`compute`) | read-only `input` (`readOnly`, `aria-readonly`), `lock` icon, hint "Calculated" | never missing, may be invalid |
| list | `ListFieldEditor` | add / remove / move up / move down; empty items not printed |
| repeatable table | `RepeatableTableEditor` (stack of row cards) | per-column control by the column field's kind |
| optional block | `BlockSwitch` (checkbox card: label, explanation, nested fields) | `aria-expanded` + `aria-controls` the nested group |
| block choice | `RadioGroupField` (legend = choice label), option label + explanation + "Fills: …" hint | exactly one on; nested fields under the chosen option |

Rules:
- **Required vs optional (AC-1.3).** A field that can be missing carries the library `*` (`required`). An optional
  field carries a neutral `Badge tone="muted"` "optional" inside its label (the AC wins over INC-16's
  "never write optional"; recorded as D-7). Optional fields are never counted missing.
- **Nesting (AC-1.5, 1.9).** A field used only inside a block is rendered nested under that block's switch/option
  (`ml-6 border-l-2 border-acc/45 pl-3`), and is *absent from the DOM* while the block is off.
- **Fills (AC-1.9, O3).** An option/block that fills fields shows under its explanation: "Fills: {label} = {value}, …
  Switching it off keeps these values." When chosen/switched on, the fields take the values (even in another step)
  and a polite line announces "{n} fields filled: {labels}". Values stay editable.
- **Hand-edited note (AC-5.2).** Under a field that a hand-edited section uses, inside its `hint`: info icon +
  "The section “{heading}” was edited by hand and no longer follows this field." (≤ 2 headings, then "and {n} more").
- **Errors.** Shown on blur of a touched field, after a jump from the issues list, and after a failed Generate
  (design-system forms rule). Missing → "Required". Invalid → the reason of the issue's `code` in `ResolvedOffer.invalid` (§ Copy: `invalid.*`, `not_an_option` included (re-synced to plan DD-38, 2026-11-15)). A fresh wizard is not red.
- **Jump targets** (re-synced to plan DD-32, 2026-11-15): every issue `name` (a field; a list/table; a table cell `TABELLA#<rowId>.COL`; `cost:<key>`, `cost:<key>#<n>`, `cost:extra:<id>`, `cost:*`; `section:<key>`) is the value of `data-wizard-field` on the element to focus, looked up by attribute (never by `#id`: the names contain `:` and `#`) — a control's own `id` is `wiz-` plus a sanitised name. The element's first control receives focus; `cost:*` → the Cost table card heading; `section:<key>` → that row's **Edit text** button.

### S5 Costs step (AC-4.1–4.7, SA-1)
A single `Card` "Cost table" plus a `Card` "Table layout" and (when no template field is bound to it) "Validity".

```
Cost lines                                                        [+ Add cost line]
┌ 1 · One-off ────────────────────────────────────────────────────────────┐
│ Sviluppo del sito, a corpo                                              │  resolved description (read-only text)
│ Unit price (CHF) [ 24 000.00 ]   Quantity [ 1 ]        Total  24'000.00 │
└─────────────────────────────────────────────────────────────────────────┘
┌ 2 · Yearly · comes with “Canone annuo” (Scope) ─────────────────────────┐
┌ Discount (no number) · [Amount | Percent]  [ 5 % ]         Total −1'200 │
╞═ TOTALE primo anno ═════════════════════════════════════════ 22'800.00 ═╡  total row (`li` with aria-label)
┌ 3 · Option · not counted in any total ──────────────────────────────────┐
╞═ TOTALE opzioni ═══════════════════════════════════════════════════ – ═╡  span with no counted line prints "–"
```
- Structure: `<ol>` of `<li>`s. A line card = `Badge` for the kind ("One-off", "Yearly", "Discount",
  "Option" — option's text says "not counted in any total") + its description + a grid of `Field`s (description
  fields embedded in the template line, unit price, quantity; qty hidden when the unit/quantity columns are off
  and for `qty=1` literals) + read-only total in `font-mono` (`formatMoney`). Total rows are separate `<li>`s styled
  as a rule + label + amount, in document formatting. Money in the cards is the library's `formatMoney`; the
  preview uses the document's (DD-21). A discount has no position number; an option line is numbered after the counted lines (AC-4.7). A total row over a span with no counted line shows "–" (a `VisuallyHidden` "no lines in this part" beside it); a span with a value still missing shows no partial sum, only an empty missing mark (re-synced to plan DD-34, 2026-11-15).
- **Bound fields (AC-4.2).** A line's unit/quantity bound to `[FIELD]` or a table column *is* that answer: editing it
  here edits the field/cell (it re-renders in the Scope step too). A `each=TABLE` line shows one card per printed
  row, headed "Row: {key}". A `perRelease` line shows one card per estimate release with an editable description.
- **Discount**: `RadioGroupField` Amount | Percent (when the template allows `?`) + the input; `10%` literals are
  read-only.
- **Block lines (AC-4.4):** a line that belongs to an off block is not rendered; an on block's line shows the hint
  "Comes with “{block}” (Scope)" as a `.link` that jumps to the block's step and focuses its switch.
- **Extra lines (AC-4.3):** **Add cost line** → a new card inserted immediately before the last total row (at the end when the table has none), so it falls in the last span and changes that span's total (re-synced to plan DD-35, 2026-11-15) (focus moves to its description); kind `Select`
  (One-off, Yearly, Discount, Option); **Remove** (`ghost` icon-only `trash`, `aria-label` names the line) only on
  added lines; at the 10-line limit **Add** is `aria-disabled` with a hint "Limit of 10 lines, counting option lines
  and table rows". Template lines cannot be removed (switch their block off, or clear the quantity bound field).
- **Layout card:** three checkboxes — "Number the lines" (`position`), "Show unit and quantity columns" (`unit`),
  "Show total rows" (`showTotals`). Turning unit columns off forces quantities to 1 (as today), announced.
- **Errors** are the `ResolvedOffer.invalid` entries of step `costs` (from `computeCosts`) (re-synced to plan DD-32, 2026-11-15) — no separate cost banner exists and the UI synthesises none. Each shows on the line its `name` points at (`cost:<key>`, `cost:<key>#<n>`, `cost:extra:<id>`) and, identically, in the Preview issues list; `cost:*` errors show at the top of this card. Codes: `discounts_exceed_span` (at the span's first discount; the printed total would be negative), `discounts_exceed_one_off` (at the last discount; document-wide, the price would be negative), `discount_without_base` (a percentage in a span with no one-off line), `no_counted_line` ("Add at least one one-off or yearly line"), `cost_total_too_large`, `too_many_cost_lines` (re-synced to plan DD-34, 2026-11-15). The server returns the same list inside 422 `offer_incomplete`. A span with a missing value waits: its checks do not run until the value is filled.
- States: **no lines at all** (template has none and no extras) cannot occur (a costs section is mandatory, AC-8.3)
  — if the engine returns zero, show `StatePanel` "This template has no cost lines" + Add. **Estimate-less deal**:
  `deal`/`manDays`-bound lines start empty and are required (missing), not hidden.

### S6 Annexes step (AC-1.2; 018 AC-1.7)
Only present if the outline has annex-step items **or** the deal has an estimate/PDFs. Cards: the template's own
annex-step items (generic, S4) · **Effort-detail annex** checkbox card ("Add the effort detail from the estimate",
hint "Lettered after the template's own annexes", disabled with reason when no ready estimate) · **AI-assisted
figures** (nested under it; "Fields you have not edited switch to the AI-assisted man-days; edited ones keep your
value") · **Deal PDFs to append** `CheckboxGroupField` (≤ 5, total ≤ 20 MiB shown as "n of 5 · x MB of 20 MB";
`emptyState` "This deal has no PDF files. Add them in the deal's Attachments card.").

### S7 Preview step — the issues, the sections, generate (US-3, US-5)
Cards in order:
1. **Before you can generate** (h3, `focusableHeading`). Two sub-lists, each a `ul` of `.link` buttons —
   *Missing ({n})*: "{label} — {step}"; *To correct ({n})*: "{label} — {reason}". Selecting → F4a. *To correct* holds every `ResolvedOffer.invalid` entry — invalid answers (`not_an_option` included), cost-table errors and over-long hand edits — and a 422 `offer_incomplete` replaces both lists with the server's, same names (re-synced to plan DD-32, 2026-11-15). A `null` label (an extra cost line, the whole cost table) is replaced by the app's own words (`issues.costExtra`, `issues.costTable`). Selecting jumps by `name` (§ S4 jump targets): a field/list/table/cell → its control; `cost:…` → that line's card on the Costs step; `section:<key>` → that section's **Edit text** button. Both empty:
   a `success` icon + "Nothing is missing. You can generate the offer." (`role="status"`). Generate also sits
   here (primary) with the count text, duplicating the action bar's so it is where the eye is.
2. **Sections** — `DataTable` (caption "Contract sections and annexes"): *Section* (rowHeader, heading text),
   *Step* (text), *Status* (`Badge accent` "Edited by hand"; plus a `Badge tone="danger"` "Too long" when the section has a `section_too_long`/`heading_too_long` issue (re-synced to plan DD-32, 2026-11-15); otherwise nothing), *Actions* (**Edit text**, **Restore wizard
   text** only when edited; `aria-label`s name the section). The opening and salutation are not listed (DD-17).
3. **Hand edits that no longer match** (only when `orphanedEdits.length`): read-only blocks + **Copy**; "Dropped when
   you generate".
4. **Deal context line**: `FactList` — template, language, currency, offer validity, effort annex on/off, PDFs count.
   (Compact; no new controls.)
- States: **loading** n/a (local); **generation in progress** = the page is `inert` except the status line, the button
  shows "Generating…", a polite line says "Generating the offer. This can take a few seconds."

### S8 Hand-edit dialog (AC-5.1–5.4)
`FormDialog size="lg"`, title "Edit section text", description "Only for this offer. After saving, the answers no longer
change this section."
- `Field` **Heading** (`input`, ≤ 120, counter); `Field` **Text** (`textarea` rows 14, `font-mono`, ≤ 20 000, counter,
  `aria-describedby` the counter; counters turn `red-text` and the field `aria-invalid` over the limit — a 422 `answers_invalid` `{ path }` on the save is mapped to these fields; an over-long section found at generate is an issue `section:<key>` in the Preview list, not a banner here (re-synced to plan DD-32, 2026-11-15)).
- The textarea starts with the section's text **as resolved from the current answers** (AC-5.1), in the offer markup.
  Every missing value, and the offer reference (unknown until generation), appears as the visible token **⟦Label⟧** (U+27E6/U+27E7 — a pair no template text or typing produces, unlike «Cliente» which T1 writes itself) (re-synced to plan DD-30, 2026-11-15). A `warning` Banner at the top lists the tokens from `resolveSectionForEdit().tokens` when any ("…replace each mark with text"). **Save text is refused while the heading or the text contains ⟦ or ⟧** — whether or not the field was filled since (hand-edited text no longer follows the answers, so a token left in it would print literally): a field error on the text, focus and caret on the first token (`findTokens`); a stray bracket the person typed is refused the same way. A section already edited by hand opens with its stored text and no tokens. The server refuses the same characters (422 `answers_invalid`), so a token never reaches a PDF.
- Reuse `MarkupHelp` (collapsible) under the text, extended with the new constructs' "do not type" note.
- Footer: **Cancel** (ghost) · **Save text** (primary). **Restore wizard text** (`ghost`, left) only when already edited.
- Save flushes the draft first; errors (conflict, network) stay inline above the footer, the typed text stays.
- Focus: opens on **Heading**; closes back to the row's **Edit text** button (library dialog contract).

### S9 Draft states and notices (autosave, conflict, discard, template-changed)

| State | Where | Component | Copy intent | Behaviour |
|---|---|---|---|---|
| saved | header `SaveStatus` | text + `check` icon | "All changes saved" | `title` = absolute time |
| saving | same | `Spinner` + text | "Saving…" | no announcement |
| retrying | same + `warning` `Banner live="polite"` after 10 s | `alert` icon | "Not saved yet — retrying. Don't close this tab." | backoff 2/4/8/16 s; `beforeunload` prompt while pending |
| conflict (409) | top `danger` Banner (`StaleWriteBanner` variant) + read-only form | `Banner` + **Reload draft** | "Someone else changed this draft. Your latest changes were not saved. Reload to see theirs." | reload refetches, re-reconciles, restores focus to the panel heading |
| gone (404) | top `warning` Banner | `Banner` + **Back to the deal** | "This draft was discarded or turned into an offer." | read-only form |
| rejected (422 `answers_invalid`, 413 `draft_too_large`) | top `warning` Banner | `Banner` | "This change could not be saved: {field label from `path`}" / "The draft is too large to save." | autosave pauses; the next content change retries. The UI enforces the same limits, so this is reachable by another client or by a template edited meanwhile; a `not_an_option` value under the current template version is refused here, under a stale one it is accepted and flagged at generate (re-synced to plan DD-38, 2026-11-15) |
| template changed | top `info` Banner, dismissible | `Banner` + **See what was dropped** | see F8 | dismiss is per session (memory) |
| template archived | top `warning` Banner | `Banner` | see F8 | |
| estimate not ready (draft exists) | top `warning` Banner on every step | `Banner` | "No ready estimate: the offer cannot be generated until…" | Generate `aria-disabled` + reason |
| issuer legal name blank (owner amendment, DD-61) | **Generate offer** in the bar and in the Preview card | `GenerateControl` `blockedReason` (existing) | "Set the legal name of {entity} in CRM Settings." | `aria-disabled`, reason in its `aria-describedby`; not a banner on every step (the person cannot fix it in the wizard), not a count; order of reasons: estimate → template archived → this one, one at a time |
| read-only (no manage / archived / conflict / gone) | form | `fieldset disabled` | | Tab and Back-to-deal still work |
| forbidden / not found / load failed | page | `PermissionDenied` / `StatePanel` / `LoadFailure` | | back link kept |

Banner order (max visible at once is naturally 2–3): conflict/gone > rejected > target > template changed/archived > estimate.

### S10 Generation errors (all inside the Preview step, `Banner tone="danger"`, `role="alert"`, with actions)
| Server | Banner | Action |
|---|---|---|
| 422 `offer_incomplete` | "The offer is not complete" — the lists above are replaced by the response's `missing`/`invalid` (missing values, invalid answers, cost-table errors and hand-edit limits, one list (re-synced to plan DD-32, 2026-11-15)); focus → the issues card heading, then each item jumps by `name` | — |
| 422 `contact_not_in_company` | "A chosen contact no longer belongs to the company" | **Go to Client** |
| 422 `attachment_*` | the PDF issue | **Go to Annexes** |
| 409 `template_changed` | "The template changed while you were working" | **Reload draft** (reconciles) |
| 409 `template_archived` | F8 | **Choose another template** |
| 409 `estimate_not_ready` | S9 | **Go to the estimate** |
| 409 `offer_not_sent` / `offer_sent` / `offer_not_latest` / `offer_changed` | "The offer this draft belongs to changed meanwhile" | **Back to the deal** |
| 409 `version_conflict` / 404 `draft_not_found` | F6 | |
| 409 `letterhead_unusable` (OA-3, plan DD-76; before any render, nothing written, draft kept) | "The letterhead of {entity} can no longer be used. Upload it again in CRM Settings." (`{entity}` = badge label of the response's `entity`) | none: the fix is outside the wizard (as the address notice, D-25); **Generate offer** stays available to try again after the upload. The legacy dialog shows the same line (shared `offerFailure`) |
| 503 / network | `warning` Banner "Nothing was created. Try again." | **Retry** |

The first draft's separate banners for `section_too_long`/`heading_too_long` and for the cost codes are gone: the draft generate route answers them only inside `offer_incomplete` (re-synced to plan DD-32, 2026-11-15). Only the checks that need the database (`contact_not_in_company`, `attachment_*`) keep their own 422 banners. A 409 `template_archived` while starting an edit/revision goes to the Template step with the target set (re-synced to plan DD-28, 2026-11-15).

### S11 Deal page (AC-6.4, 7.x) — `OffersCard`
- Header action (primary, one): **New offer** (`Link`) when there is no draft and the newest offer is not an unsent
  document; **New revision** (button, busy "Starting…") when the newest is sent; none when a draft exists or the
  newest is an unsent document (edit is a row action, as today). `disabled`+title when the estimate is not ready
  stays as today.
- **Draft row** above the table (inside the card, `border border-rule rounded-md p-3`, not a new card), fed by `GET /deals/{id}/offer-draft/summary` (re-synced to plan DD-27, 2026-11-15) (no `answers`; its `ETag` = the `version` that Discard sends as If-Match; asked only when `/scope` reports `financials` and manage for the deal's entity, G10):
  `StatusBadge status="draft"` "Draft" · "{template name} · {target text}" · "Changed by {person}, {formatDateTime}"
  · **Continue** (primary `sm`, `Link`) · **Discard** (ghost `sm`, `aria-haspopup="dialog"`). When the summary says `templateChanged` a muted `Badge` "Template edited since" follows the name, and when `template.archived` a `warning` `Badge` "Template archived" (Continue still opens the draft; F8 explains) (re-synced to plan DD-27, 2026-11-15). Target text: "New offer",
  "Editing {ref}", "Revision of {ref}".
- States of the draft check (it must never block the table): loading = nothing shown + polite line "Checking for a
  draft…" only after 800 ms; none (`{ draft: null }` — the normal answer, never a 404) = nothing; error = a one-line `info` text "Could not check for a draft" + **Retry**
  (the header action still works; a `draft_exists` answer is handled by F1); 403/404 = nothing (AC-6.2; the 403 body is identical with or without a draft).
- Table: unchanged except `origin` badge text under the reference ("Classic template" for `sections`; nothing for
  `wizard`). Legacy offers keep **Edit**/**New revision** per F11; for `origin === "wizard"` they start a draft without sending a `templateId` (re-synced to plan DD-28, 2026-11-15).
- Discard `ConfirmDialog` (danger): title "Discard this draft?", body "Everything entered for “{template}” is deleted. The
  deal and its offers are not affected." For an edit/revision draft add "Offer {ref} stays as it is."
- After generating from the wizard: `Saved` banner "Offer {ref} generated" and, for `qualified`, the existing proposal dialog.

### S12 Settings › Templates card (`TemplatesCard`; AC-8.1, 9.2)
Columns: **Name** (link + description line `text-xs text-soft`; `StatusBadge voided` when archived), **Format**
(`Badge`: "Wizard" accent / "Classic" muted), **Language**, **Updated**, **Actions**. Card description updated to explain
the two formats and that the first wizard template of a language archives that language's classic templates.
Errors (existing `danger` Banner): `last_template` "This is the only active template for {language}. Create another
first.", `template_superseded` "A wizard template is active for {language}, so classic templates cannot be restored."

### S12b Settings › Letterhead card (`LetterheadCard`; OA-3 / security M-4, plan DD-76)
No new element: the card keeps its upload button (`Replace letterhead`), the **Download** button, its description and the existing dismissible `danger` Banner
(`crm-letterhead-{entity}-error`). Two outcomes gain copy (S12b strings in § Copy keys):
- **Upload refused** — 422 `letterhead_invalid` with `reason` `too_complex`, `decoded_too_large`, `image_too_large` or `unbounded_stream`: the one "too complex"
  message ("Export it again as a plain PDF"). The refused file is deleted server-side and the old letterhead stays (as today); the other reasons keep theirs.
- **Download** (the plan says "Open"; the control is labelled `Download`) on a stored letterhead that the server now refuses — 409 `letterhead_unusable`:
  "This letterhead can no longer be used. Upload it again." in the same Banner, with **Replace letterhead** beside it. `letterheadFailure` gains `case 'letterhead_unusable'`.
States: loading, empty ("No letterhead uploaded yet…"), no-profile and the other errors are the card's existing ones (unchanged). Not designed (no AC; finding G19):
a standing indicator that a stored letterhead is unusable before anyone opens it.

### S13 Template editor (`TemplateEditorPage`, wizard branch; AC-8.1–8.5)
`PageHeader` (back to Settings, title, **Save** primary). Below it `Tabs` **Edit** | **Try the wizard**.

```
Edit view, ≥ 1280px                                         < 1280px: one column, same order
┌ Details ───────────────────────────────┐ ┌ Problems ──────────────────────────┐
│ Name · Language · Description          │ │ ✗ 2 errors, ⚠ 1 warning            │
│ Typical uses (ListFieldEditor ≤ 6)     │ │  Line 42 · Field “ACCONTO” is used │
├ Template text ─────────────────────────┤ │  but not declared                  │
│ [ monospace textarea, resize-y, 28 rows]│ ├ What the wizard will ask ──────────┤
│ Line 12, col 4 · 4 210 / 150 000 chars │ │ Client                              │
│ 2 errors — go to problems              │ │  · Field Cliente (text)             │
│ [Syntax reference]                     │ │ Scope                               │
└────────────────────────────────────────┘ │  · Switch Seconda voce di costo     │
                                           │      · Field Seconda voce (text)   │
```
- **Details card**: `Field`s name (required), language (`select`), description (`input`, ≤ 160, single line, counter),
  typical uses (`ListFieldEditor`, ≤ 6 × ≤ 40). Language note when saving would archive classic templates (D-12).
- **Template text card**: `textarea` (`font-mono text-sm`, soft-wrapped, `spellCheck={false}`, `aria-describedby` the
  status line and problems summary), status line `Line n, col m · x / 150 000` (`aria-live="off"`; updates on
  `selectionchange` throttled 150 ms), a link "n errors — go to problems" (moves focus to the problems heading),
  **Syntax reference** (button → `Drawer` with the extended `MarkupHelp` content: grammar table of the plan, copied from
  strings; never a form).
- **Problems card** (`h3`, `focusableHeading`): none → `check` + "No problems"; otherwise a `ul`: each `li` is a button
  `Error|Warning · Line {n} · {message}` (severity as `Icon` + visible word). Activating → focus the textarea and select
  that line (`setSelectionRange`, scroll into view). Errors come from the shared parser live (debounce 300 ms) and from a
  server `422 template_invalid` (merged, de-duplicated by line+code). Warnings never block Save. New template errors: a counted or discount cost line after the last total row (`cost_line_after_last_total`, (re-synced to plan DD-35, 2026-11-15)) and ⟦ or ⟧ in the text or a label (`reserved_character`, (re-synced to plan DD-30, 2026-11-15)); `optional_heading_not_last` is a warning (re-synced to plan DD-29, 2026-11-15).
- **Outline card** (`h3`): per **non-empty** step an `h4`, then per section of that step its heading and a `ul` in text order (one `outline(ast, null)`: every item whatever a block's state): kind label (Field · text, Field ·
  amount, List, Table · 4 columns, Switch, Choice · 2 options, Cost lines · 6), the label, "optional" badge, "derived"
  lock, "Fills: {label}" under an option or block that fills fields (per option for a choice), the total-row labels among the cost lines, and nested items indented under their block (re-synced to plan DD-33, 2026-11-15). Updates with the text (same debounce). Empty (no declarations yet):
  `StatePanel` "Nothing to ask yet" + hint. While the text has errors the outline shows the last valid parse with an
  `info` line "Showing the last readable version".
- **"Supplied by the CRM" group** (owner amendment, DD-58, AC-12.1, 12.9): after the last step, inside the same card, an `h4`
  "Supplied by the CRM" and a one-line `text-xs text-soft` hint ("The wizard does not ask for these. The CRM reads them from the
  entity profile each time it shows or generates the offer."), then a `ul` in order of first use: one `li` per declared
  `issuer` / `issuerAddress` field the text actually uses (`suppliedFields(ast)`), each built from the existing `Heading` row —
  kind "Issuer · legal name" or "Issuer · address", the author's own label through `TemplateText`, and a `Badge` with the `lock`
  icon "From the entity profile". Never an input and no "optional" tag. A field declared but unused is not listed. No such
  field → no group, no empty-state text (the group is not something to ask). A template whose only items are supplied still
  shows "Nothing to ask yet" for the steps, then the group. Same last-readable-version rule as the rest of the outline.
- **Save** is `aria-disabled` while errors exist, described by "Fix {n} errors first"; activating it focuses the
  Problems heading. `busy` while saving; stale → `StaleWriteBanner` (typed text kept); `template_name_taken` → name field
  error; archived/readOnly banners as today; success → `Saved` "Template saved"; create → navigate to the edit URL.
- **Try the wizard view**: `info` `Banner` "Sample answers on the text you have typed. Nothing is saved." + **Reset sample
  answers** (`secondary sm`). With parse errors: `warning` Banner "Fix the {n} errors to try the wizard" + **Go to problems**
  (switches to Edit and focuses the Problems heading) — the wizard is not rendered. Otherwise the same `OfferWizard` core,
  sample mode: step tabs, step forms, preview pane, issues list on a Preview step with **no Generate button** (replaced by
  text "Generating is not available in the editor"), no autosave, no network. Sample client "Cliente di prova SA" and deal
  currency of the entity. (owner amendment, DD-62, AC-8.5/11.9/12.8/12.13) The view makes exactly two reads, once per
  mount, and nothing else (the preview is the same A4 page stack, OA-3, AC-11.9): the entity profiles list (the issuer's legal name and address lines; the template's entity) and,
  through the same letterhead attempt as the wizard page (F14), the letterhead link and bytes.
  - **Profile readable and its legal name not blank**: the context's issuer name and address are the profile's; no note. A
    profile with no address and a template that prints it shows the address notice like the wizard (§ Address notice).
  - **Profile unreadable or its name blank**: the sample name and address of `sampleContext` ("Fornitore di esempio SA",
    "Via Esempio 2, 6900 Lugano"; never a real wellD company), and under the "Sample answers…" banner a second
    `Banner tone="info" compact live="off"` (`data-testid="crm-template-try-issuer-sample"`): "The supplier's name and address
    are samples: the profile of {entity label} could not be read." The letterhead band is the `failed` one (AC-11.9: a person
    who cannot read it gets the band, never an error). No retry button, no error state; the view works.
  - **While the profile read is in flight** the wizard is already rendered on the sample values and **no note shows** (the
    note is for a read that failed, not one that has not finished; both editor views stay mounted, so on a normal visit the
    read is long settled before the person opens the tab). The letterhead attempt waits for the answer (state `pending`),
    it does not start as `failed` (G11).
- States: loading (`Loading`), load failed (`LoadFailure`), read-only (no `deal:manage` for the entity or archived: whole
  form `fieldset disabled`, Try view still works), unknown entity (existing `warning` Banner).

## Preview pane (wide vs narrow) — `DocumentPreview`

> Pagination mechanism and break rules: docs/adr/20261115-paginated-preview-one-flow-float-rail.md (one flow over empty floats, decorative page layer, relaxation order R3, R2, R5, R4).

Re-synced to the owner's amendment (US-11, US-12; DD-55, DD-56, DD-58), to the owner's D19 layout fix and, **2026-11-15 (OA-3), to the
owner's choice of "Real A4 pages"** (spec OA-3, AC-3.2, AC-11.1–11.13; plan § Amendment OA-3, DD-65…DD-72, DD-76). OA-3 replaces the
single A4 box (DD-55, D-23) by a **stack of A4 pages**; the mechanism (one flow of real text over a page layer, a rail of floats for
the breaks) is the plan's and is not restated here — this section says what the person sees and what the frontend must honour.

- **Layout rule (owner D19)**: in the wide layout the **preview region's height is the remaining content area** — it ends just
  above the sticky action bar, measured from its own top by `useFitToScrollport` — it **scrolls internally**, and
  `overscroll-contain` **stops scroll chaining** to the page, so reading the preview never moves the form or the page. Whatever
  sits above the region in the pane (title row, band, notice, § below) therefore shortens it and never pushes the bar. The
  Drawer's region keeps `max-h-[80vh]` (its body is its own bound). Everything below lives **inside the pane's column**: chrome above
  the region, the page stack inside it — no new scroller, no new fixed height. The region keeps `scrollbar-gutter: stable`, so a
  scrollbar appearing never changes the pages' width.
- **Wide (≥ 1280 px viewport, `xl`)**: right column (`aside`, `sticky top-4`), one flex column, top to bottom:
  1. title row — `h3` "Document preview" and the missing-count `Badge tone="warning"` (pane only, not in the Drawer);
  2. **the band** — one `text-xs text-soft` paragraph (§ Letterhead bands), `data-chrome`;
  3. **the address notice** — only when it applies (§ Address notice);
  4. **the preview region** — `role="region"`, `aria-label="Document preview"`, `tabIndex={0}`, `aria-busy` while the text
     debounces; it holds the page stack and nothing else.
  The band and the notice are **outside the region and outside the pages**: they stay in view while the pages scroll and never sit
  on the letterhead's graphics.
- **Narrow**: hidden; the **Preview** button in the action bar opens the same content in a `Drawer` (`title` "Document
  preview", focus on its heading, Escape closes, focus returns to the button). If the viewport grows past `xl` while open, the
  Drawer closes and the inline pane takes over. Same tree, minus the title row: band, notice, region (§ Drawer).

### The page stack (OA-3, AC-11.1–11.6, 11.10; D-33…D-36)

```
region (the one scroller, focusable)
└ stage (bg-ink-mid, the gap and the margins around the pages)
    ├ page 1  ┌──────────────── W ─────────────────┐  A4: height = W × 297 / 210, edge 1 px border-muted
    │         │  letterhead (same image on every   │  ← frame top 120/842 of H: nothing of the offer here
    │         │  page, full bleed, behind the text)│
    │         │   ┌ frame: text only in here ┐     │  ← left/right 71/595 of W
    │         │   │ the offer's text …       │     │
    │         │   └──────────────────────────┘     │  ← frame bottom 110/842 of H
    │         └────────────────────────────────────┘
    │              gap ≥ 16 px (stage colour)
    ├ page 2 …
    └ page N  (the last may end anywhere; an offer with no text still shows page 1)
```

- **Page width rule** (plan DD-66): with `available` = the region's content width, `inset = min(16, available / 20)` px on every side of
  the stack and `W = min(794, available − 2 × inset)`; a pane wider than 794 + 2 × inset centres the stack. `H = W × 297 / 210`.
  Pages are never scaled with a CSS transform: only the numbers change, the text stays real text and zooms with the browser.
- **Gap**: 16 px between one page and the next (≥ 16 as AC-11.2 asks), and the same 16 px at most around the stack. Its colour is
  the **stage's `bg-ink-mid`**, so it follows the theme (dark `#1c1c2a`, light `#e8e8f4`).
- **Page edge** (AC-11.2, AC-11.5): each page is `bg-paper border border-muted` (a 1 px edge inside the page's box, so the box is
  exactly A4 at its width). `border-muted` against `bg-paper` is **6.5:1 in the dark theme and 3.35:1 in the light one**
  (values from `tokens.css`), so the edge clears the 3:1 non-text floor in both themes and survives forced-colours mode (a border,
  not a shadow). `--muted` is "decorative only, never text" in the design system; a hairline is exactly that. **Plan DD-71 names
  `border-paper-rule` for this edge; it is 1.19:1 against the light stage and 1.42:1 against the paper, so in the light theme the
  page would melt into the gap — reported as plan finding F-A, D-34.** There is no shadow token in the library and none is used.
- **Pages stay light in the dark theme** (AC-11.5): `paper-*` tokens, no `dark:` class, no `filter`, no `opacity`, no blend mode, no
  scrim on a page or on its image. Only the gap (the stage) follows the theme.
- **Frame** (AC-11.10; the PDF's 120 / 110 / 71 / 71 pt on 595.28 × 841.89 pt, one shared constant, plan DD-67): the offer's text, marks, lists
  and tables are drawn only inside the frame, on every page, in every letterhead state; the preview adds nothing in the margins (no page
  number, no running header, no break marker, no "continued", no ruler). A long word or a wide table wraps inside the frame; there is
  no horizontal scroll inside a page (today's `overflow-x-auto` table wrappers go, DD-70).

  | Where | `W` | `H` | frame top / bottom | frame left / right | text column | body text |
  |---|---|---|---|---|---|---|
  | Wide pane at 1280 × 800 (plan's measurement) | ≈ 488 | ≈ 690 | ≈ 98 / 90 | ≈ 58 | ≈ 372 | 10 px (floor; 8.2 px at PDF scale) |
  | A wide screen, the cap | 794 | 1123 | 160 / 147 | 95 | 605 | 13.3 px (PDF scale) |
  | Drawer at a 320 px viewport (≈ 272 px of room) | ≈ 245 | ≈ 347 | ≈ 49 / 45 | ≈ 29 | ≈ 187 | 10 px (4.1 px at PDF scale) |

  Approximate, to size expectations only; the rule above is the contract.
- **Type** (plan DD-66, **floor 10 CSS px as decided with AC-11.13**, plan's 12 to be re-synced): each PDF size (body 10, sub-heading 10 bold,
  section and annex headings 10.5, title 11.5, tables 9.5 pt) is drawn at its size × `W / 595.28`, **never under 10 CSS px**, and the floor
  follows the person's text-size setting (10/16 of the root font size, so doubling the text doubles it). Line height 1.35 × the size.
  Sizes reach the elements as inline `style` (runtime values, allowed by the styling rules); this is a deliberate exception to the
  library's 11 px `text-2xs` floor, which is for chrome — the page is a rendering of print, and AC-11.13 owns its floor. Colours
  stay `paper-*` token utilities. At the default pane every size is 10 px (headings and title differ by weight); body text is at the PDF's relative scale
  from `W ≥ 595` px. Consequence (owner O8/O11): at 488 px the text is ≈ 1.2 × the PDF's relative size, so the preview shows
  **about 1.5 × the PDF's page count**, and on a phone Drawer more. The caption says breaks are approximate.
- **The letterhead on every page** (AC-11.1, 11.2, 11.8): while `shown`, **each** page holds the **same** decoded image, full bleed (`h-full w-full`,
  `alt=""`, `aria-hidden="true"`, `draggable={false}`, `select-none pointer-events-none`, decoded before the state turns `shown`, G12),
  behind the text. One fetch and one render serve any number of pages; a page that appears while typing already has it, so no page
  is ever blank. `bg-paper` stays under it, so a transparent letterhead shows paper.
- **Pending, failed and none** (AC-11.3, 11.4): the same page boxes, the same frame, the same text and the same breaks, with no
  image. `none` is known before the first paint; `pending` becomes `shown` or `failed` without moving a single line or changing any
  page break (breaks never read the letterhead state). The preview does **not** draw the plain header the PDF prints on a page without a
  letterhead (the band says so) and no page numbers.
- **What a break looks like** (AC-11.11, rules R1–R8 of plan DD-68, not restated): the text stops at the bottom of a frame and goes on at the
  top of the next page's frame, across the gap; a paragraph cut by a break is still one paragraph (one text run: selection, copy and the
  browser's find treat it as continuous); a heading is never alone at the foot of a page; a 2–3-line paragraph and a table row stay whole
  (a row too tall for a page follows AC-11.11's final wording, being reworded by the PO); the acceptance block stays together; each text annex and
  the effort-detail annex starts a new page, so a page can end early where a keep rule moves what follows; no page is blank. The
  table's header row is **not** repeated after a break (a visible difference from the PDF, covered by "approximate"). Hand-edited
  sections keep their left rule inside the frame, and it is interrupted by the gap, never drawn in it.
- **Re-layout** (AC-3.1, AC-11.11): the pages are laid out again within the second of AC-3.1 after a change (the 250 ms debounce + one
  synchronous layout, never a visible intermediate frame), and again when the region's width, the text-size setting or the web
  font changes. The scroll position is kept; no spinner, no skeleton, no live announcement.

### Content (inside the frame)

- **Content** (React elements from `ResolvedOffer`, never HTML strings): salutation + client lines; "A.c.a." contacts; place and
  date; title with reference; opening; numbered sections (`numberOffer`'s section and sub-heading numbers and annex letters and
  the engine's `words.ts` fixed words — one copy shared with the PDF (re-synced to plan DD-29, 2026-11-15)), sub-headings,
  lists, tables; the cost table in the chosen columns (total rows in bold, a total over a span with no counted line printing
  "–", discounts unnumbered, option lines numbered and flagged "option" — re-synced to plan DD-34, 2026-11-15); text annexes
  ("ALLEGATO A – …", each on its own page), effort-detail annex (from `estimate.annex`), the deal PDFs as "Allegato C — file.pdf (appended)"
  (a line of text, not a page: the PDF appends those files unchanged). Section headings are `h4` (the pane's title is the h3). The
  issuer's legal name and address print as plain text where the template uses them (AC-12.2, 12.9); a blank value prints nothing
  (AC-12.7, 12.12), never a placeholder.
- **Missing**: `<mark class="bg-paper-mark text-paper-mark-ink">⟦Label⟧</mark>` with a `VisuallyHidden` "Missing:" prefix —
  visible word + brackets + highlight, never colour alone. The brackets are the same ⟦ ⟧ as the hand-edit token (D-19, my
  choice: «Label» would be indistinguishable from document text such as T1's «Cliente», the very reason of DD-30).
  **Reference not yet assigned**: dashed outline run "assigned when the offer is generated" (not an error). **Edited by hand**:
  `border-l-2 border-paper-ink pl-3` plus a caption "Edited by hand" in `text-paper-soft`.
- `lang={template.language}` on the flow (the content), not on the page layer. Re-resolve debounce 250 ms; the region has `aria-busy`
  while debouncing **only** (the letterhead loading and the page layout never set it); the pane is **not** a live region (it would
  chatter) — neither are the band nor the notice (D-24).

### Letterhead bands (owner amendment, DD-56, AC-11.2–11.4; OA-3 DD-72; D-22, D-29, D-37)

One paragraph, `text-xs text-soft`, **`min-h-14`** (three lines, § Loading and layout stability), no icon, no `Banner`, no
`role="alert"`, no live region, `data-testid="crm-wizard-letterhead-band"` with `data-state="pending|shown|none|failed"`. It reads
the page's letterhead attempt, so the pane and the Drawer always agree. `{entity}` is the context's legal name; when that is blank
(AC-12.7) or the Try view could not read the profile it is the entity's badge label ("wellD CH").

| State | Pages | Paragraph (en) | Paragraph (it) |
|---|---|---|---|
| `pending` (no request yet, or loading; also the Try view while its profile read is in flight) | A4 pages, frame, no image | **The letterhead of {entity} is added in the PDF.** Page breaks are approximate: the PDF is the authority. | **La carta intestata di {entity} viene aggiunta nel PDF.** Le interruzioni di pagina sono approssimative: fa fede il PDF. |
| `shown` | A4 pages, the letterhead on every page | **The letterhead is shown on every page. Page breaks are approximate: the PDF is the authority.** (one string, the caption of AC-11.2) | **La carta intestata è mostrata su ogni pagina. Le interruzioni di pagina sono approssimative: fa fede il PDF.** |
| `none` (profile has no letterhead) | A4 pages, frame, no image | **No letterhead is set for {entity}: the PDF uses a plain header with the entity's name and address.** Page breaks are approximate: the PDF is the authority. | **Nessuna carta intestata impostata per {entity}: il PDF usa un'intestazione semplice con nome e indirizzo dell'entità.** Le interruzioni di pagina sono approssimative: fa fede il PDF. |
| `failed` (not fetched, not drawn, not ready in 10 s, a 409 `letterhead_unusable`, or Try view cannot read the profile) | A4 pages, frame, no image | **The letterhead of {entity} could not be shown here. It is still added in the PDF.** Page breaks are approximate: the PDF is the authority. | **Non è stato possibile mostrare qui la carta intestata di {entity}. Viene comunque aggiunta nel PDF.** Le interruzioni di pagina sono approssimative: fa fede il PDF. |

Bold is the state's own sentence (AC-11.3, 11.4, the pending sentence); the plain sentence is `preview.note`, whose copy OA-3 changes from
"Layout and page breaks differ in the PDF." to the second sentence of the caption (plan DD-72), kept as a second `<span>` of the same
paragraph. In `shown` the caption already contains it, so the standalone note is not repeated. No page number, page count or list of
pages appears anywhere. Transitions are silent and immediate (no fade): `pending → shown | failed`, never back. The other three
sentences are unchanged (AC-11.3, 11.4); with the note rewritten, the English/Italian wording of the shipped note and of the caption now
agree (finding G13 closed).

### Address notice (owner amendment, DD-58, AC-12.12, 12.13; D-25)

- **When**: the settled resolution says the printed text read the address (`resolved.systemRead` includes `issuerAddress`) **and**
  the context's `issuerAddressLines` are all empty or spaces. It follows the pages' own 250 ms debounce, so it appears and
  goes with the text that causes it (a block toggled on, a hand edit that removes the use) and never flickers on a keystroke.
  Never while the template does not print it, never for a blank legal name (a different reason, § S9).
- **Where and what**: directly under the band, above the region, in the pane and in the Drawer, the same component:
  `Banner tone="warning" live="off" compact` with an `aria-label` ("Issuer address"), text exactly: **"The address of {entity} is not
  set, so it is not printed in the offer. Set it in CRM Settings."** (it: "L'indirizzo di {entity} non è impostato, quindi non
  viene stampato nell'offerta. Impostalo nelle Impostazioni CRM."), `data-testid="crm-wizard-address-notice"`. `warning` because it
  is something to fix, `live="off"` because it is a persistent condition read in place and the preview is never live (design-system
  § Feedback); no `onDismiss`, no `actions`: it describes a state, and the fix is in CRM Settings, outside the wizard. Not counted
  among missing or to-correct items; **Generate stays available** (AC-12.12).
- **Which pane**: wherever a preview is drawn — wizard pane, Drawer, Try view (AC-12.13). On `< xl` the Preview step itself shows no
  preview, so the notice is seen when the person opens the Drawer, which is what "near the preview" asks (finding G14).

### Loading and layout stability (owner amendment, DD-55, AC-11.4; OA-3 DD-69, DD-71)

- **The preview's text never waits for the letterhead.** The pages render from `ResolvedOffer` on the first frame (the page boxes exist
  from the first paint: at least page 1), and keep re-resolving every 250 ms whatever the letterhead is doing; the letterhead can only
  add an image behind the text of each page.
- **No layout shift when the image arrives or fails**: the page boxes are the same in `pending`, `shown`, `failed` and `none`; the image
  appears inside boxes that already have their final size and the flow never reads the state, so `pending → shown | failed` moves no text
  and changes no page break (AC-11.4). `none` is known before the first paint and never changes in this opening.
- **No layout shift while typing**: the stage's height changes only when the number of pages changes; a page that appears already shows the
  letterhead; the person's scroll offset is kept (the stage keeps its previous height while the layout is measured).
- **The band is a single paragraph with `min-h-14`** (three `text-xs` lines at the pane's width: the Italian `none` and `failed` sentences plus the note
  run to ≈ 170–180 characters, two lines are not enough), so the four states do not change its height in the pane. In a narrow Drawer a
  state may wrap to one more line than the previous; that single line moves the region's top by at most one line and the region keeps its
  bottom (D19 fit), so the pages do not jump (D-42).
- **No spinner, no skeleton, no progress text** for the letterhead or for the page layout: the `pending` band already says it is "added in
  the PDF", and empty pages under real text are not a loading screen (D-23, carried over). No `aria-busy` for it (§ above).
- **A first paint of a decoded image** is not left to chance: the hook only reports `shown` after the browser has decoded the blob
  (`Image.decode()` inside the 10 s budget) or, equivalently, the preview reports an `<img>` `error` back to it; either way a blob
  the browser cannot draw becomes `failed` (AC-11.4 "the browser cannot render it") instead of empty pages under a `shown` band (G12).

### Drawer, narrow widths, zoom and text size (owner amendment, AC-11.6; OA-3 AC-11.13; D-32, D-38)

The Drawer shows **the same tree** as the pane at its own width: band, notice, region with the page stack — the same pages, frame
proportions, letterhead state and text in the same order — with `available` = the Drawer region's width (`max-w-xl`, so `W` is at most
≈ 540 px and the pages ≈ 760 px tall at the most). Opening the Drawer for the first time on a narrow screen is the moment the preview "first
needed" the letterhead (F14.2); closing it, opening it again, or growing the viewport so the inline pane takes over starts no
request and changes no state, because the attempt, its result and the `blob:` URL belong to the page and survive the preview
unmounting (the URL is revoked only when the page unmounts). The pages are laid out again for the new width (breaks differ from the
pane's, as AC-11.13 allows). The Drawer's region is not `fit` (it keeps `max-h-[80vh]`) and the title row is omitted (the Drawer has the
title). Focus: unchanged (the heading, the region as the one tab stop inside).

- **320 px** (AC-11.13): `W ≤ available − 2 × inset`, so the stack never needs horizontal scrolling; the frame is proportional (≈ 29 px
  left and right at `W ≈ 245`), the letterhead shows whole, the text is at the 10 px floor and a page holds ≈ 18 lines.
- **Browser zoom 200 %** (1280 device px = 640 CSS px): the viewport is below `xl`, so the person reads the preview in the Drawer, not the
  inline pane; the pages are as wide as the Drawer allows, the text is 10 CSS px = 20 device px, nothing is clipped, nothing leaves its
  frame, and the same offer simply runs over more pages. 400 % reaches the 320 px case.
- **Text size doubled** (root font 32 px): the floor doubles with it (10/16 of the root), `available` is unchanged, so fewer words fit per
  line, more pages result, and a table row can exceed a page's frame (AC-11.11 says how such a row breaks). The band and the notice
  wrap (`min-h`, not a fixed height); the region stays the one scroller.
- **Theme and settings**: pages and text follow the suite's theme (gap) and the person's browser settings (text size, zoom); reduced
  motion changes nothing because nothing moves.

## Component inventory

Library in use: **`@operai/ui`** (`operai-ui/src/index.ts`), Tailwind 4 token utilities, strings in `crm-ui/src/strings`
(`en` + `it: typeof en`, `selectStrings`). Paths: library `operai-ui/src/components/*`; crm-ui `crm-ui/src/...`.

| Element | Component | Source |
|---|---|---|
| Tool frame / width | `ToolLayout` (`wide`), `TabNav` | library; `crm-ui/src/components/CrmShell.tsx` (extend the `wide` route test) |
| Page header, back, status badge | `PageHeader`, `StatusBadge status="draft"`, `Icon` | library |
| Step tabs, editor view tabs | `Tabs`, `tabPanelProps`, `Badge`, `VisuallyHidden` | library |
| Template cards, step cards, cost cards | `Card`, `Badge`, `Button`, `FactList` | library |
| Fields | `Field`, `MoneyInput`, `DateInput`, `RadioGroupField`, `CheckboxGroupField`, `focusFirstInvalid`, `parseDecimal` | library |
| Contacts / PDFs pick | `CheckboxGroupField` (`scroll`, `emptyState`) | library; pattern as `crm-ui/src/components/GenerateOfferDialog.tsx` (plan said `Combobox`; checkboxes match today's dialog and ≤ 5 is a pick-from-list, D-14) |
| Banners, errors, loading, forbidden | `Banner` (`actions`, `onRetry`), `StatePanel`, `SkeletonRows`, `Spinner` | library; `crm-ui/src/components/LoadState.tsx` (`Loading`, `LoadFailure`, `StaleWriteBanner`, `Saved`), `PermissionDenied.tsx` |
| Dialogs | `FormDialog` (hand edit), `ConfirmDialog` (switch template, restore, discard), `Dialog` (draft-exists three-button, dropped answers), `Drawer` (preview, syntax reference) | library |
| Sections table | `DataTable` | library |
| Draft/offers list | `DataTable`, `StatusBadge`, existing `OffersCard.tsx` | crm-ui |
| Progress | `ProgressBar` | library |
| Announcements | `VisuallyHidden live` | library |
| Template list | existing `TemplatesCard.tsx` (+ Format column) | crm-ui |
| Markup help | existing `MarkupHelp.tsx` (extend rows) | crm-ui |
| Legacy flow | existing `GenerateOfferDialog.tsx` (untouched) | crm-ui |
| Line-editor row frame | pattern of `CostLinesEditor.tsx` `Row` (extract if the wizard's cost card needs the same frame) | crm-ui |
| `OfferWizard` core (steps, forms, preview, issues; props: ast, answers, setAnswers, context, mode `deal`\|`sample`) | **NEW** (crm-ui) — shared by the page and the editor's Try view; nothing in the library fits a template-driven form | `crm-ui/src/components/offerWizard/` |
| `OfferWizardPage` + `useOfferDraft` (autosave, If-Match, backoff, `beforeunload`) | **NEW** (crm-ui) — plan | `crm-ui/src/pages/`, `hooks/` |
| `FieldInput` (kind → control), `BlockSwitch`, `BlockChoice` | **NEW** (crm-ui): no library switch/choice-with-nested-content; composed from native checkbox/`RadioGroupField` | offerWizard/ |
| `ListFieldEditor`, `RepeatableTableEditor` | **NEW** (crm-ui): add/remove/reorder rows with labelled controls; `SectionsEditor` is heading+body only | offerWizard/ |
| `CostTableEditor` (lines, total rows, extras) | **NEW** (crm-ui): total rows and bound fields, `invalid` entries shown on the line by name (re-synced to plan DD-32, 2026-11-15); `OfferCostLinesEditor` models the old single-total table | offerWizard/ |
| `IssuesList` (missing / to correct, jump) | **NEW** (crm-ui); renders `ResolvedOffer.missing/.invalid` or a 422 `offer_incomplete` body as is, jumps by `name` (re-synced to plan DD-32, 2026-11-15) | offerWizard/ |
| `DocumentPreview` (page stack with the letterhead on every page, band, address notice) | **NEW** (crm-ui) — plan: one consumer, stays here until a second app needs it; extended by the owner amendment with the band and the notice (DD-56, DD-58) and **(OA-3) with the page stack instead of the single A4 box** (DD-65, DD-71, DD-72; DD-55 superseded), no new component | offerWizard/ |
| `WizardActionBar` (sticky Back / progress / Preview / Next) | **NEW** (crm-ui) — no library pattern; **promote to `@operai/ui`** when a second tool wizard exists | offerWizard/ |
| `SaveStatus` (autosave text + throttled live region) | **NEW** (crm-ui) — same promotion rule | offerWizard/ |
| `TemplateText` (`lang` wrapper) | **NEW** (crm-ui), 10 lines | offerWizard/ |
| `OutlineView`, `ProblemsList`, `TemplateTextArea` (status line, go-to-line) | **NEW** (crm-ui), editor-only | `crm-ui/src/components/templateEditor/` |
| **Library tokens `--paper`, `--paper-ink`, `--paper-soft`, `--paper-rule`, `--paper-head`, `--paper-mark`, `--paper-mark-ink`** (+ `@theme inline` lines, identical in both themes, AA-checked, Storybook Foundations entry) | **NEW** (`operai-ui/src/styles/tokens.css`) — "a new colour is a new token" (ADR 20261031); the print must stay light in the dark theme and no existing token pair gives that. Deploy order: the shell with the tokens goes live before crm-ui uses them. | library |
| Letterhead band, address notice, Try view sample note | existing `Banner` (`tone`, `live="off"`, `compact`, `aria-label`) for the notice and the note; a plain `<p>` for the band (DD-56: no `Banner`) | library — nothing new |
| Letterhead `<img>` (one per page), page boxes, stage (OA-3) | plain `img` / `div`: `bg-paper border border-muted` pages on a `bg-ink-mid` stage, geometry as runtime inline `style`; tokens only | none (inside `DocumentPreview`) |
| Pagination (`pageGeometry`, `placeBreaks`, `realize`, `collectFlowItems`, `usePagination`, `PaperTypeContext`; not UI components) (OA-3) | **NEW** (crm-ui), plan DD-65…DD-70 — nothing in the library paginates a document; pure logic with one consumer | `offerWizard/paper/` |
| "Supplied by the CRM" outline group | existing `Heading` row of `OutlineView`, `Badge` + `Icon name="lock"`, `TemplateText` | crm-ui `templateEditor/OutlineView.tsx`, `offerWizard/TemplateText.tsx` |
| `useLetterhead`, `renderLetterhead`, `fetchLetterheadBytes` (not UI components) | **NEW** (crm-ui), plan DD-53/DD-54 — one attempt per opening; two small additions needed (G11, G12) | `offerWizard/useLetterhead.ts`, `lib/letterhead/`, `lib/crmApi.ts` |

Counts: **reuse ≈ 30 library/in-repo components** vs **NEW 12 crm-ui compositions + 1 library change (tokens only)**. No
library *component* is added; no new icon (`eye`, `edit`, `pencil`, `list-check`, `arrow-up/down`, `trash`, `lock`, `plus`,
`copy`, `alert`, `info`, `check`, `x-circle`, `refresh`, `arrow-left/right` exist).

OA-3 (real A4 pages): **no new library component, token or icon** either — the page edge and the gap are `border-muted`, `bg-paper`, `bg-ink-mid`; the
pagination modules are logic, not components (NEW 12 compositions unchanged; the non-UI additions are listed above).

Owner amendment (US-11, US-12): **no new library component, token or icon** (the `paper-*` tokens, `Banner`, `Badge`, `Icon name="lock"`
and `info` exist); the NEW count of 12 crm-ui compositions is unchanged (`DocumentPreview` was already one) plus the plan's non-UI
`useLetterhead` / `renderLetterhead`. Reuse stays ≈ 30.

## Accessibility

- **Structure**: one h1 (tool, from `ToolLayout`), one h2 (`PageHeader`), h3 = step panel title / card titles / preview,
  h4 = sub-groups, template cards, preview sections. Never skipped.
- **Tabs (steps)**: real `tablist` (`Tabs`): one tab stop, ←/→/Home/End, automatic activation, panel `tabindex=0`.
  Counts are `Badge` + sr-only text. After **Next/Back** focus moves to the new panel's h3 (`tabIndex=-1`); after
  using the tab keys focus stays on the tab (standard).
- **Jump to field (AC-3.4/3.6)** (re-synced to plan DD-32, 2026-11-15): issues are `<button class="link">`. Activation: set step (`replace`), wait one frame,
  focus the element carrying `data-wizard-field="{name}"` (its first control; the Cost table card heading for `cost:*`; that row's Edit text button for `section:<key>`), `scrollIntoView({block:'center'})`
  (`behavior:'auto'` under `prefers-reduced-motion`); the field shows its error text so the reason is read with the label.
- **Live regions** (`VisuallyHidden live`, polite): save status (throttled: terminal changes, at most one per 10 s;
  `retrying` after 10 s immediately; conflict through the Banner `alert`); "{n} fields filled: …" after a fills choice;
  list/table add/remove ("Item removed", focus goes to the neighbour or the Add button); "Template changed to X";
  "Generating the offer…"; "Section {x} edited by hand / restored". The preview is never live.
- **Forms**: `Field` wiring; required `*` (aria-hidden) + `aria-required`; optional is a visible "optional" tag;
  derived fields `readOnly` + `aria-readonly`; errors `aria-invalid` + `aria-describedby`; a Generate that fails moves
  focus to the issues heading. Radio groups for choices; the block checkbox has `aria-expanded`/`aria-controls`.
- **aria-disabled, not disabled**, for **Generate offer**, **Save** (editor), **Use template** on a gated card, **Add cost
  line** at the limit: the user must be able to reach them to hear *why*; the handler ignores the click.
- **Dialogs**: library contract (modal, labelled, focus trap, Esc, return focus, stacking — the restore confirm over the
  hand-edit dialog works). Busy dialogs are not dismissible. `FormDialog` ignores the backdrop (typed text).
- **Hand-edit token refusal** (re-synced to plan DD-30, 2026-11-15): a refused Save moves focus to the text with the caret on the first ⟦ (`setSelectionRange`), the error is `aria-describedby` of the text and also announced by the dialog's `role="alert"` line; the token is read as "left bracket Label right bracket" so the Banner above also names each token in words.
- **Icon-only buttons** (move up/down, remove, tab-less) have `aria-label`s that name the item ("Remove item 2 of
  Funzionalità"); icons `aria-hidden`.
- **Colour**: severity/status always has a glyph and a word; missing is ⟦Label⟧ + highlight; paper tokens meet 4.5:1
  (ink on paper ≥ 15:1, soft ≥ 6:1, mark-ink on mark ≥ 7:1); the paper is not recoloured per theme.
- **Language**: `lang` on template-derived text and the paper when it differs from the UI language.
- **Motion**: none beyond the library's spinner/progress; both honour reduced motion.
- **Keyboard path, whole wizard**: Template card **Use template** → Tab through the step panel → **Next** → … → issues
  list button → focuses the field → **Generate offer**. Editor: Tab reaches the textarea, Problems, Outline, **Save**;
  problems buttons put the caret on the line.
- Text zoom 200 %: single column, no clipped fixed heights except the preview's own scrolling region (focusable); the preview then opens in the Drawer and its pages scale to it (OA-3, § Drawer, narrow widths, zoom and text size).
- **Letterhead, pages and issuer (owner amendment US-11/US-12; OA-3 AC-11.1, 11.12, 11.13)**:
  - *The image adds nothing to assistive technology or the keyboard, on every page.* Each page's `<img alt="" aria-hidden="true" draggable={false}>`
    is not focusable, `pointer-events-none`, `select-none`. The whole page layer (boxes + images) is `aria-hidden` **and `inert`**; the flow
    (the offer's text) is the only content in the accessibility tree and keeps today's reading order, which is the PDF's. A test asserts the
    preview exposes no `img` role and that the letterhead's presence, and the number of pages, change none of the text. The text stays real:
    selectable, found by the browser's find (AC-11.1).
  - *Page boundaries are invisible to AT* (AC-11.12; D-39). A page, a gap or a break is not a landmark, heading, list, table or live
    announcement and carries no page number or label (no "page 2 of 5", no `aria-label` on a page, no `role="img"`); pagination adds no element to the
    document's structure (only the empty, `aria-hidden` rail inside the flow). A sentence cut by a break is one text run: selected, copied
    (no character, space or line added) and found by the browser's search as one sentence.
  - *Still one tab stop in the preview.* The region (`role="region"`, `tabIndex={0}`, named "Document preview") remains the one
    focusable scroll region and the only way to scroll the pages by keyboard (arrows, Page Up/Down, Home/End); no page, gap or
    image takes Tab; the band (`p`) and the address notice (`Banner live="off"`, `role="note"`) are not focusable; the Drawer's tab order
    is heading → close → region. The region's focus ring is the library's global 2 px `--focus-ring` outline.
  - *Nothing is announced about the letterhead or the pages.* The band and the notice are static text (no live region, no `role="alert"`, no
    toast): `pending → shown | failed` and a re-layout that adds or removes a page are cosmetic or non-actionable, and a failure must stay quiet
    (AC-11.4). The region's `aria-busy` is tied to the 250 ms debounce only. `data-state` is for tests.
  - *Text over graphics* (O5 closed by OA-3): the text sits inside the frame, away from the letterhead's header and footer areas; its contrast
    is the `paper-*` tokens' on plain paper (≥ 15:1); the letterhead's own artwork inside the frame is the owner's own file.
  - *Page edge and gap* (AC-11.5): `border-muted` on `bg-paper` is 6.5:1 (dark) and 3.35:1 (light), both over the 3:1 non-text floor; the edge is a
    border, so it also survives forced-colours mode (a shadow would not). The gap follows the theme (`bg-ink-mid`). Colour is not the only
    signal either: the pages' shape and order carry the structure.
  - *Text size and zoom* (AC-11.13): 10 CSS px floor for the pages' text, following the person's text-size setting (10/16 of the root font); at 200 % zoom
    or doubled text nothing is clipped, nothing leaves its frame and nothing needs horizontal scrolling at 320 CSS px; the same offer runs over
    more pages. The 10 px is below the library's 11 px chrome floor on purpose (D-36).
  - *Colour is never the signal*: the four band states and the notice are sentences; the notice also carries the `warning` icon and its `aria-label`.
  - *Blank legal name*: the reason is `aria-describedby` of the `aria-disabled` Generate button in the bar and in the Preview card
    (the same mechanism as the estimate reason), so a person who reaches the button hears it.
  - *Generating with an unusable letterhead* (OA-3, DD-76): the 409 line is a `role="alert"` Banner in the Preview step (S10) and focus follows the
    existing rule for a failed Generate (the issues heading); no new mechanism.
  - *Try view*: the sample note is a static `role="note"` banner, read in the page order before the wizard; nothing moves focus.
  - *Reduced motion*: nothing here animates (no fade, no shimmer, no spinner, no scroll animation on a re-layout); the image appears in one frame.

## Responsive

| Width | Wizard | Editor |
|---|---|---|
| ≥ 1280 (`xl`) | form + sticky preview side by side; action bar single row | text + problems/outline side by side |
| 1024–1279 | single column; Preview via Drawer (`max-w-xl`) | single column |
| 640–1023 | as above; field grid 2 columns (`sm:grid-cols-2`), long text/list/table span 2 | as above |
| < 640 | field grid 1 column; tabs wrap onto lines; action bar two rows; Drawer full-width; cost cards stack their fields; table rows are cards already | text area full width, outline below |

Pages (OA-3, supersedes the single A4 box): the stack's page width is `W = min(794, available − 2·inset)` of the region it sits in (§ The page
stack), so the pages scale with the pane and the Drawer by width alone — ≈ 488 px at the default 1280 pane, ≤ ≈ 540 px in the Drawer, ≈ 245 px
at a 320 px viewport — keep A4 proportions and the PDF's frame proportions, and nothing is scaled with CSS transforms. The text keeps a
10 CSS px floor, so the narrower the page the more pages the same offer takes (AC-11.13); the breaks approximate the PDF's.

No horizontal page scroll at any width: the cost table and repeatable tables are card stacks, the paper wraps
(`break-words`), the preview region scrolls internally.

## Copy keys (app-owned, `crm-ui/src/strings/offerWizard.ts` + additions to `offers.ts`, `templates.ts`)

Conventions: sentence case; functions for strings with values; `it: typeof en`; parity test `catalogGaps`; no hardcoded
JSX copy. Template content (labels, hints, texts) is **never** in this catalog (AC-10.1). Keys → `strings.offerWizard.*`.

**Chrome**

| Key | en | it |
|---|---|---|
| `page.titleNew` | New offer | Nuova offerta |
| `page.titleEdit(ref)` | Edit offer {ref} | Modifica offerta {ref} |
| `page.titleRevision(ref)` | Revision of offer {ref} | Revisione dell'offerta {ref} |
| `page.back` | Back to the deal | Torna al deal |
| `page.draft` | Draft | Bozza |
| `page.loading` | Loading the offer wizard… | Caricamento della procedura guidata… |
| `page.notFound.title/body` | Deal not found / This deal does not exist or was removed. | Deal non trovato / Questo deal non esiste o è stato rimosso. |
| `steps.label` | Offer steps | Passi dell'offerta |
| `steps.template/client/scope/conditions/costs/annexes/preview` | Template / Client / Scope / Conditions / Costs / Annexes / Preview | Template / Cliente / Oggetto / Condizioni / Costi / Allegati / Anteprima |
| `steps.count(n)` (sr) | {n} to fix | {n} da completare |
| `steps.intro.client/costs/annexes/preview` | Who the offer is for and the date it carries. / The prices, discounts and totals. / Annexes printed after the contract. / Check, fix what is missing, then generate. | A chi è rivolta l'offerta e la data che riporta. / Prezzi, sconti e totali. / Allegati stampati dopo il contratto. / Controlla, completa ciò che manca, poi genera. |
| `bar.back/next/preview/generate` | Back / Next / Preview / Generate offer | Indietro / Avanti / Anteprima / Genera offerta |
| `bar.stepOf(n,total,name)` | Step {n} of {total} · {name} | Passo {n} di {total} · {name} |
| `bar.progress` | Offer progress | Avanzamento dell'offerta |
| `bar.counts(m,c)` | {m} missing · {c} to correct | {m} mancanti · {c} da correggere |
| `bar.generateBlocked` | Complete the missing items to generate the offer. | Completa gli elementi mancanti per generare l'offerta. |
| `bar.blockedLegalName(entity)` (owner amendment, AC-12.7, DD-61; `{entity}` = the entity's badge label, the legal name being what is blank) | Set the legal name of {entity} in CRM Settings. | Imposta la ragione sociale di {entity} nelle Impostazioni CRM. |
| `bar.generating` | Generating… | Generazione… |
| `bar.generatingLive` | Generating the offer. This can take a few seconds. | Generazione dell'offerta in corso. Può richiedere qualche secondo. |

**Save status**

| Key | en | it |
|---|---|---|
| `save.saved` | All changes saved | Tutte le modifiche sono salvate |
| `save.saving` | Saving… | Salvataggio… |
| `save.retrying` | Not saved yet — retrying. Keep this tab open. | Non ancora salvato — nuovo tentativo. Tieni aperta questa scheda. |
| `save.conflict.title` | Someone else changed this draft | Qualcun altro ha modificato questa bozza |
| `save.conflict.body` | Your latest changes were not saved. Reload to see theirs; nothing they saved is lost. | Le tue ultime modifiche non sono state salvate. Ricarica per vedere le loro; ciò che hanno salvato non va perso. |
| `save.reload` | Reload draft | Ricarica la bozza |
| `save.gone.title/body` | This draft no longer exists / It was discarded or turned into an offer by someone else. | Questa bozza non esiste più / È stata eliminata o trasformata in offerta da qualcun altro. |
| `save.leave` | Changes are still being saved. | Le modifiche sono ancora in salvataggio. |
| `save.rejected(label)` / `save.tooLarge` (re-synced to plan DD-38, 2026-11-15) | This change could not be saved: {label}. / The draft is too large to save. | Questa modifica non è stata salvata: {label}. / La bozza è troppo grande per essere salvata. |

**Banners and target**

| Key | en | it |
|---|---|---|
| `target.edit(ref)` | You are editing offer {ref}, which has not been sent. Generating replaces it under the same reference. | Stai modificando l'offerta {ref}, non ancora inviata. Generandola la sostituisci con lo stesso riferimento. |
| `target.revision(ref,next)` | Revision of offer {ref}. Generating creates {next}; the sent offer stays unchanged. | Revisione dell'offerta {ref}. Generando si crea {next}; l'offerta inviata resta invariata. |
| `target.legacy(ref)` | Pick a template to continue {ref} in the wizard. Its client and contacts are carried over. | Scegli un template per proseguire {ref} nella procedura guidata. Cliente e referenti vengono riportati. |
| `target.archived(ref)` (re-synced to plan DD-28, 2026-11-15) | The template of offer {ref} was archived. Pick another to continue; the client and contacts are carried over. | Il template dell'offerta {ref} è stato archiviato. Scegline un altro per proseguire; cliente e referenti vengono riportati. |
| `estimate.missing` | This deal has no ready estimate, so no offer can be generated. Close the estimate in EstimAI or ask an admin to override the check. | Questo deal non ha una stima pronta: non si può generare l'offerta. Chiudi la stima in EstimAI o chiedi a un admin di forzare il controllo. |
| `estimate.override` | An admin overrode the estimate check: figures from the estimate are not available. | Un admin ha forzato il controllo della stima: i dati della stima non sono disponibili. |
| `estimate.go` | Go to the estimate | Vai alla stima |
| `unsent.body(ref)` | Offer {ref} has not been sent. Send or delete it before starting a new one. | L'offerta {ref} non è stata inviata. Inviala o eliminala prima di iniziarne una nuova. |
| `unsent.editInstead` | Edit it instead | Modificala invece |
| `changed.title/body` | The template changed since you started / We kept the answers whose fields still exist. | Il template è cambiato da quando hai iniziato / Abbiamo mantenuto le risposte ai campi che esistono ancora. |
| `changed.see` | See what was dropped | Vedi cosa è stato scartato |
| `changed.dialog.title/answers/edits/copy/close` | Answers that no longer fit / Answers dropped / Hand edits for sections that no longer exist / Copy text / Close | Risposte che non corrispondono più / Risposte scartate / Modifiche manuali di sezioni che non esistono più / Copia il testo / Chiudi |
| `changed.orphans.title/body` | Text for sections that no longer exist / It is dropped when you generate the offer. Copy it first if you need it. | Testo di sezioni che non esistono più / Viene scartato alla generazione dell'offerta. Copialo prima se ti serve. |
| `archived.title/body` | This template was archived / Choose another template to keep working. | Questo template è stato archiviato / Scegli un altro template per proseguire. |
| `draftExists(by,at)` | A draft already exists — {by} started it on {at}. Here it is. | Esiste già una bozza — l'ha iniziata {by} il {at}. Eccola. |

**Template step**

| Key | en | it |
|---|---|---|
| `template.heading(lang)` | {lang} templates | Template in {lang} |
| `template.uses` | Typical uses | Usi tipici |
| `template.use` | Use template | Usa il template |
| `template.current` | Current template | Template attuale |
| `template.starting` | Starting… | Avvio… |
| `template.classic.title/intro/use` | Classic templates / These use the previous offer form. / Use classic form | Template classici / Usano il modulo di offerta precedente. / Usa il modulo classico |
| `template.empty.title/body` | No offer templates for {entity} / Ask someone who manages deals for this entity to add one in Settings. | Nessun template di offerta per {entity} / Chiedi a chi gestisce i deal di questa entità di aggiungerne uno in Impostazioni. |
| `template.switch.title` | Switch template? | Cambiare template? |
| `template.switch.body(name)` | The answers specific to the current template are replaced by those of “{name}”. The client, contacts, place and date are kept. | Le risposte specifiche del template attuale vengono sostituite da quelle di «{name}». Cliente, referenti, luogo e data restano. |
| `template.switch.confirm/busy/done(name)` | Switch template / Switching… / Template changed to {name} | Cambia template / Cambio… / Template cambiato in {name} |

**Client / fields / costs / annexes**

| Key | en | it |
|---|---|---|
| `client.card` / `client.lines` / `client.linesHint` | Client / Client lines / The first line is the legal name. Up to 8 lines. | Cliente / Righe del cliente / La prima riga è la ragione sociale. Fino a 8 righe. |
| `client.contacts` / `client.contactsLimit` / `client.contactsEmpty` | Contacts (A.c.a.) / At most 5 contacts. / This company has no contacts yet. | Referenti (A.c.a.) / Al massimo 5 referenti. / Questa azienda non ha ancora referenti. |
| `client.place` / `client.date` / `client.dateToday` / `client.dateOn` / `client.dateRange` | Place / Date on the offer / The day the offer is generated / A specific date / Pick a date within 90 days of today. | Luogo / Data sull'offerta / Il giorno della generazione / Una data precisa / Scegli una data entro 90 giorni da oggi. |
| `client.reference` / `client.referencePending` / `client.referenceNext(ref)` / `client.currency(c)` | Reference / Assigned when the offer is generated / Next revision of {ref} / Currency: {c} (the deal's) | Riferimento / Assegnato alla generazione dell'offerta / Prossima revisione di {ref} / Valuta: {c} (quella del deal) |
| `field.optional` | optional | facoltativo |
| `field.withCurrency(label,c)` | {label} ({c}) | {label} ({c}) |
| `field.derived` | Calculated | Calcolato |
| `field.fills(list)` | Fills: {list}. Switching it off keeps these values. | Compila: {list}. Disattivandolo i valori restano. |
| `field.filledLive(n,list)` | {n} fields filled: {list} | {n} campi compilati: {list} |
| `field.handEdited(h)` | The section “{h}” was edited by hand and no longer follows this field. | La sezione «{h}» è stata modificata a mano e non segue più questo campo. |
| `field.more(n)` | and {n} more | e altre {n} |
| `field.select` | Choose… | Scegli… |
| `field.notAnOption(v)` (re-synced to plan DD-38, 2026-11-15) | {v} — no longer an option | {v} — non più tra le opzioni |
| `list.add/remove(n,label)/up(n,label)/down(n,label)/removedLive` | Add item / Remove item {n} of {label} / Move item {n} of {label} up / … down / Item removed | Aggiungi voce / Rimuovi la voce {n} di {label} / Sposta su la voce {n} di {label} / … giù / Voce rimossa |
| `table.row(n)/addRow/removeRow(n)/empty/limit` | Row {n} / Add row / Remove row {n} / No rows yet. / Up to 50 rows. | Riga {n} / Aggiungi riga / Rimuovi la riga {n} / Nessuna riga. / Fino a 50 righe. |
| `invalid.required` | Required | Obbligatorio |
| `invalid.out_of_range` / `not_integer` / `not_a_number` / `date_out_of_range` | Must be 0 or more / Enter a whole number / Enter a number / Date is outside the allowed range | Deve essere 0 o più / Inserisci un numero intero / Inserisci un numero / Data fuori dall'intervallo consentito |
| `invalid.not_an_option` (re-synced to plan DD-38, 2026-11-15) | Choose one of the listed options. | Scegli una delle opzioni elencate. |
| `invalid.discounts_exceed_span` / `discounts_exceed_one_off` / `discount_without_base` (re-synced to plan DD-34, 2026-11-15) | Discounts exceed the lines they discount in this part of the table. / Discounts exceed the one-off lines: the price would be negative. / A percentage needs a one-off line before it in this part of the table. | Gli sconti superano le voci che scontano in questa parte della tabella. / Gli sconti superano le voci una tantum: il prezzo sarebbe negativo. / Una percentuale richiede una voce una tantum prima di sé in questa parte della tabella. |
| `invalid.no_counted_line` / `cost_total_too_large` / `too_many_cost_lines` (re-synced to plan DD-32, 2026-11-15) | Add at least one one-off or yearly line. / A total is too large. / Too many cost lines. | Aggiungi almeno una voce una tantum o annuale. / Un totale è troppo grande. / Troppe voci di costo. |
| `invalid.heading_too_long` / `section_too_long` (re-synced to plan DD-32, 2026-11-15) | The heading is longer than 120 characters. / The text is longer than 20 000 characters. | Il titolo supera i 120 caratteri. / Il testo supera i 20 000 caratteri. |
| `costs.card` / `costs.add` / `costs.addLimit` | Cost table / Add cost line / Limit of 10 lines, counting option lines and table rows. | Tabella costi / Aggiungi voce di costo / Limite di 10 righe, comprese le voci a scelta e le righe delle tabelle. |
| `costs.kind.one_off/yearly/discount/option` | One-off / Yearly / Discount / Option | Una tantum / Annuale / Sconto / A scelta |
| `costs.optionNote` | Not counted in any total | Non rientra in nessun totale |
| `costs.unit/quantity/total/discountAmount/discountPercent` | Unit price / Quantity / Total / Amount / Percent | Prezzo unitario / Quantità / Totale / Importo / Percentuale |
| `costs.comesWith(block)` | Comes with “{block}” | Fa parte di «{block}» |
| `costs.row(key)` | Row: {key} | Riga: {key} |
| `costs.remove(n)` | Remove cost line {n} | Rimuovi la voce di costo {n} |
| `costs.layout/position/unitCols/showTotals` | Table layout / Number the lines / Show unit and quantity columns / Show total rows | Aspetto della tabella / Numera le righe / Mostra colonne unità e quantità / Mostra le righe di totale |
| `costs.validity` / `costs.validityHint` | Offer validity (days) / 1 to 365 days from the printed date. | Validità dell'offerta (giorni) / Da 1 a 365 giorni dalla data stampata. |
| `costs.spanEmpty` / `costs.spanEmptyLive` / `costs.spanIncomplete` (re-synced to plan DD-34, 2026-11-15) | – / No lines in this part of the table / Not complete yet | – / Nessuna voce in questa parte della tabella / Non ancora completo |
| (the former `costs.err.*` are now the `invalid.*` rows above, one map for the whole engine (re-synced to plan DD-32, 2026-11-15)) | | |
| `annexes.effort/effortHint/ai/aiHint/noEstimate` | Add the effort detail from the estimate / Lettered after the template's own annexes. / AI-assisted figures / Fields you have not edited switch to the AI-assisted man-days; edited ones keep your value. / Needs a ready estimate. | Aggiungi il dettaglio dell'impegno dalla stima / Prende la lettera dopo gli allegati del template. / Valori assistiti da AI / I campi non modificati passano alle giornate assistite da AI; quelli modificati restano. / Richiede una stima pronta. |
| `annexes.pdfs/pdfsEmpty/pdfsLimit/pdfsSize(n,mb)` | Deal PDFs to append / This deal has no PDF files. Add them in the deal's Attachments card. / At most 5 PDFs. / {n} of 5 · {mb} MB of 20 MB | PDF del deal da allegare / Questo deal non ha file PDF. Aggiungili nella scheda Allegati del deal. / Al massimo 5 PDF. / {n} di 5 · {mb} MB su 20 MB |

**Preview step, issues, hand edit**

| Key | en | it |
|---|---|---|
| `issues.title` | Before you can generate | Prima di poter generare |
| `issues.missing(n)` / `issues.invalid(n)` | Missing ({n}) / To correct ({n}) | Mancanti ({n}) / Da correggere ({n}) |
| `issues.item(label,step)` / `issues.invalidItem(label,reason)` | {label} — {step} / {label} — {reason} | {label} — {step} / {label} — {reason} |
| `issues.costExtra` / `issues.costTable` (re-synced to plan DD-32, 2026-11-15) | Extra cost line / Cost table | Voce di costo aggiunta / Tabella costi |
| `issues.none` | Nothing is missing. You can generate the offer. | Non manca nulla. Puoi generare l'offerta. |
| `sections.caption/section/step/status/actions` | Contract sections and annexes / Section / Step / Status / Actions | Sezioni del contratto e allegati / Sezione / Passo / Stato / Azioni |
| `sections.edited` | Edited by hand | Modificata a mano |
| `sections.edit(h)` / `sections.restore(h)` | Edit text of {h} / Restore the wizard text of {h} | Modifica il testo di {h} / Ripristina il testo guidato di {h} |
| `edit.title` / `edit.description` | Edit section text | Modifica il testo della sezione |
| | Only for this offer. After saving, the answers no longer change this section. | Solo per questa offerta. Dopo il salvataggio le risposte non modificano più questa sezione. |
| `edit.heading/text/counter(n,max)/save/saving/restore` | Heading / Text / {n} of {max} characters / Save text / Saving… / Restore wizard text | Titolo / Testo / {n} di {max} caratteri / Salva il testo / Salvataggio… / Ripristina il testo guidato |
| `edit.missingBanner(list)` (re-synced to plan DD-30, 2026-11-15) | The ⟦…⟧ marks in the text stand for values still missing: {list}. Fill the fields first, or replace each mark with text. | I segni ⟦…⟧ nel testo indicano valori ancora mancanti: {list}. Compila prima i campi, oppure sostituisci ogni segno con del testo. |
| `edit.tokenLeft(label)` / `edit.bracketStray` (re-synced to plan DD-30, 2026-11-15) | Replace ⟦{label}⟧ with text. A hand-edited section no longer follows the answers. / Remove the ⟦ and ⟧ marks: write the text itself. | Sostituisci ⟦{label}⟧ con del testo. Una sezione modificata a mano non segue più le risposte. / Rimuovi i segni ⟦ e ⟧: scrivi direttamente il testo. |
| `edit.tooLong(max)` | At most {max} characters. | Al massimo {max} caratteri. |
| `edit.savedLive(h)` / `edit.restoredLive(h)` | Section {h} edited by hand | Sezione {h} modificata a mano |
| `restore.title` / `restore.body(h)` / `restore.confirm/busy` | Restore the wizard text? / The text you wrote for “{h}” will be lost. The section follows the answers again. / Restore text / Restoring… | Ripristinare il testo guidato? / Il testo che hai scritto per «{h}» andrà perso. La sezione tornerà a seguire le risposte. / Ripristina il testo / Ripristino… |
| `preview.title` / `preview.note` (OA-3, value changed, DD-72) / `preview.drawerTitle` / `preview.missingBadge(n)` | Document preview / Page breaks are approximate: the PDF is the authority. / Document preview / {n} missing | Anteprima del documento / Le interruzioni di pagina sono approssimative: fa fede il PDF. / Anteprima del documento / {n} mancanti |
| `preview.letterhead(entity)` / `preview.pending` / `preview.missing(label)` / `preview.edited` / `preview.annexAppended(f)` | The letterhead of {entity} is added in the PDF. / assigned when the offer is generated / Missing: / Edited by hand / {f} (PDF, appended) | La carta intestata di {entity} viene aggiunta nel PDF. / assegnato alla generazione dell'offerta / Mancante: / Modificata a mano / {f} (PDF, in allegato) |
| `preview.letterheadShown` (AC-11.2, OA-3: value changed; the whole caption, one string) | The letterhead is shown on every page. Page breaks are approximate: the PDF is the authority. | La carta intestata è mostrata su ogni pagina. Le interruzioni di pagina sono approssimative: fa fede il PDF. |
| `preview.letterheadNone(entity)` (AC-11.3) | No letterhead is set for {entity}: the PDF uses a plain header with the entity's name and address. | Nessuna carta intestata impostata per {entity}: il PDF usa un'intestazione semplice con nome e indirizzo dell'entità. |
| `preview.letterheadFailed(entity)` (AC-11.4) | The letterhead of {entity} could not be shown here. It is still added in the PDF. | Non è stato possibile mostrare qui la carta intestata di {entity}. Viene comunque aggiunta nel PDF. |
| `preview.addressMissing(entity)` (AC-12.12) | The address of {entity} is not set, so it is not printed in the offer. Set it in CRM Settings. | L'indirizzo di {entity} non è impostato, quindi non viene stampato nell'offerta. Impostalo nelle Impostazioni CRM. |
| `preview.addressMissingLabel` (the notice's `aria-label`) | Issuer address | Indirizzo dell'emittente |
| `generate.fail.*` (per S10) | e.g. `incomplete`: The offer is not complete. / `contact`: A chosen contact no longer belongs to the company. / `retry`: Nothing was created. Try again. | e.g. L'offerta non è completa. / Un referente scelto non appartiene più all'azienda. / Non è stato creato nulla. Riprova. |
| `generate.fail.go(step)` | Go to {step} | Vai a {step} |
| `generate.done(ref)` | Offer {ref} generated | Offerta {ref} generata |

**Letterhead refusals (OA-3 and security M-4, plan DD-76)** — new keys, en + it; `{entity}` is the badge label (`strings.badges.entity`) of the response's `entity`

| Key | en | it |
|---|---|---|
| `offers.errors.letterheadUnusable(entity)` (409 `letterhead_unusable` on generate, wizard and legacy dialog, via `offerFailure`) | The letterhead of {entity} can no longer be used. Upload it again in CRM Settings. | La carta intestata di {entity} non può più essere usata. Caricala di nuovo nelle Impostazioni CRM. |
| `templates.letterhead.errors.invalid.too_complex` / `.decoded_too_large` / `.image_too_large` / `.unbounded_stream` (four keys, one text; 422 `letterhead_invalid` on upload) | This PDF is too complex to be used as a letterhead. Export it again as a plain PDF. | Questo PDF è troppo complesso per essere usato come carta intestata. Esportalo di nuovo come PDF semplice. |
| `templates.letterhead.errors.unusable` (409 `letterhead_unusable` on **Download**, `LetterheadCard`) | This letterhead can no longer be used. Upload it again. | Questa carta intestata non può più essere usata. Caricala di nuovo. |

**Deal page and Settings**

| Key | en | it |
|---|---|---|
| `offers.new` / `offers.starting` | New offer | Nuova offerta |
| | Starting… | Avvio… |
| `offers.draft.row(template,target)` | Draft · {template} · {target} | Bozza · {template} · {target} |
| `offers.draft.target.new/edit(ref)/revision(ref)` | New offer / Editing {ref} / Revision of {ref} | Nuova offerta / Modifica di {ref} / Revisione di {ref} |
| `offers.draft.changed(by,at)` | Changed by {by}, {at} | Modificata da {by}, {at} |
| `offers.draft.continue/discard` | Continue / Discard | Continua / Elimina |
| `offers.draft.discardOf(template)` | Discard the draft of {template} | Elimina la bozza di {template} |
| `offers.draft.discard.title/body/bodyOffer(ref)/confirm/busy/done` | Discard this draft? / Everything entered for “{template}” is deleted. The deal and its offers are not affected. / Offer {ref} stays as it is. / Discard draft / Discarding… / Draft discarded | Eliminare questa bozza? / Tutto ciò che hai inserito per «{template}» viene eliminato. Il deal e le sue offerte non cambiano. / L'offerta {ref} resta com'è. / Elimina la bozza / Eliminazione… / Bozza eliminata |
| `offers.draft.checkFailed` | Could not check for a draft. | Impossibile verificare se esiste una bozza. |
| `offers.draft.templateChanged` / `templateArchived` / `changedMeanwhile` (re-synced to plan DD-27, 2026-11-15) | Template edited since / Template archived / The draft changed meanwhile. Here is the latest. | Template modificato da allora / Template archiviato / La bozza è cambiata nel frattempo. Ecco l'ultima versione. |
| `offers.draft.exists.title/body/discard/continue` | A draft already exists / {by} started a draft on {at}. Continue it, or discard it to start something else. / Discard it and continue / Continue the draft | Esiste già una bozza / {by} ha iniziato una bozza il {at}. Continuala, oppure eliminala per iniziare altro. / Eliminala e continua / Continua la bozza |
| `offers.origin.sections` | Classic template | Template classico |
| `offers.errors.template_archived/offer_legacy/…` | This offer's template was archived. / This offer predates templates and cannot be edited. | Il template di questa offerta è stato archiviato. / Questa offerta è precedente ai template e non è modificabile. |
| `templates.list.format` / `.wizard` / `.classic` | Format / Wizard / Classic | Formato / Procedura guidata / Classico |
| `templates.list.errors.last_template(lang)` / `.template_superseded(lang)` | This is the only active template for {lang}. Create another first. / A wizard template is active for {lang}, so classic templates cannot be restored. | È l'unico template attivo per {lang}. Creane prima un altro. / Per {lang} c'è un template guidato attivo: i template classici non si possono ripristinare. |

**Editor**

| Key | en | it |
|---|---|---|
| `editor.views` / `editor.edit` / `editor.try` | Template views / Edit / Try the wizard | Viste del template / Modifica / Prova la procedura |
| `editor.details` / `editor.description` / `editor.descriptionHint` / `editor.uses` / `editor.usesHint` | Details / Description / One line, up to 160 characters. / Typical uses / Up to 6, shown on the template card. | Dettagli / Descrizione / Una riga, fino a 160 caratteri. / Usi tipici / Fino a 6, mostrati sulla scheda del template. |
| `editor.text` / `editor.textHint` / `editor.status(line,col,n,max)` | Template text / The contract text with fields, blocks and conditions written inline. / Line {line}, column {col} · {n} of {max} characters | Testo del template / Il testo del contratto con campi, blocchi e condizioni scritti nel testo. / Riga {line}, colonna {col} · {n} di {max} caratteri |
| `editor.goToProblems(n)` / `editor.syntax` | {n} errors — go to problems / Syntax reference | {n} errori — vai ai problemi / Guida alla sintassi |
| `editor.problems` / `editor.noProblems` / `editor.error` / `editor.warning` / `editor.line(n)` | Problems / No problems / Error / Warning / Line {n} | Problemi / Nessun problema / Errore / Avviso / Riga {n} |
| `editor.outline` / `editor.outlineEmpty.title/body` / `editor.outlineStale` | What the wizard will ask / Nothing to ask yet / Declare fields, blocks or choices in the text and they appear here. / Showing the last readable version. | Cosa chiederà la procedura / Ancora nulla da chiedere / Dichiara campi, blocchi o scelte nel testo e compariranno qui. / Mostrata l'ultima versione leggibile. |
| `editor.kind.text/longtext/number/percentage/date/amount/list/table(n)/block/choice(n)/costs(n)/derived` | Field · text / … · long text / … · number / … · percentage / … · date / … · amount / List / Table · {n} columns / Switch / Choice · {n} options / Cost lines · {n} / Calculated | Campo · testo / … · testo lungo / … · numero / … · percentuale / … · data / … · importo / Elenco / Tabella · {n} colonne / Interruttore / Scelta · {n} opzioni / Voci di costo · {n} / Calcolato |
| `editor.saveBlocked(n)` | Fix {n} errors first. | Correggi prima {n} errori. |
| `editor.supersede(lang,n)` | Saving this template makes it the first wizard template for {lang}: the {n} classic templates for {lang} will be archived. | Salvando questo template sarà il primo template guidato per {lang}: i {n} template classici per {lang} verranno archiviati. |
| `editor.try.banner` / `editor.try.reset` / `editor.try.blocked(n)` / `editor.try.goProblems` / `editor.try.noGenerate` | Sample answers on the text you have typed. Nothing is saved. / Reset sample answers / Fix the {n} errors to try the wizard. / Go to problems / Generating is not available in the editor. | Risposte di esempio sul testo che hai scritto. Non viene salvato nulla. / Reimposta le risposte di esempio / Correggi i {n} errori per provare la procedura. / Vai ai problemi / La generazione non è disponibile nell'editor. |
| `editor.try.issuerSample(entity)` (owner amendment, AC-12.8/12.13, DD-62) | The supplier's name and address are samples: the profile of {entity} could not be read. | Nome e indirizzo del fornitore sono di esempio: non è stato possibile leggere il profilo di {entity}. |
| `editor.supplied.title` / `editor.supplied.hint` (AC-12.1, 12.9) | Supplied by the CRM / The wizard does not ask for these. The CRM reads them from the entity profile each time it shows or generates the offer. | Fornito dal CRM / La procedura non li chiede. Il CRM li legge dal profilo dell'entità ogni volta che mostra o genera l'offerta. |
| `editor.supplied.issuer` / `editor.supplied.issuerAddress` / `editor.supplied.badge` | Issuer · legal name / Issuer · address / From the entity profile | Emittente · ragione sociale / Emittente · indirizzo / Dal profilo dell'entità |
| `editor.problem.<code>(name?)` — one entry per `ProblemCode` of the plan (≈ 35: `block_not_closed`, `field_undeclared`, `label_missing`, `no_costs_section`, `choice_too_few_options`, …) | en/it each, e.g. `field_undeclared(name)`: Field “{name}” is used but not declared. | Il campo «{name}» è usato ma non dichiarato. |

OA-3 changes the **values** of two keys (`preview.note`, `preview.letterheadShown`) and adds the three entries above (six keys: `offers.errors.letterheadUnusable`,
the four upload reasons, `templates.letterhead.errors.unusable`), en + it; no key is removed or renamed (`preview.letterhead`, `preview.letterheadNone`,
`preview.letterheadFailed` keep their text). The Italian caption and the shipped note now both say "approssimative" (finding G13 closed).

Owner amendment adds 12 keys (`preview.letterheadShown/None/Failed`, `preview.addressMissing`, `preview.addressMissingLabel`,
`bar.blockedLegalName`, `editor.try.issuerSample`, `editor.supplied.title/hint/issuer/issuerAddress/badge`), en + it, one block each at
the end of the existing groups (the plan's rule for `offerWizard.ts`: never reorder the file). `{entity}` is the issuer's legal name in
the band and the notice, the entity's badge label (`strings.badges.entity`) wherever the legal name is blank or unread. (OA-3: the old Italian
"sono diverse" / "possono variare" mismatch of finding G13 no longer exists.)

All new keys also feed the existing `catalogGaps` parity test and the no-hardcoded-copy scan; `data-testid`s use the
prefixes `crm-wizard-*` (page, steps, issues, bar, save-status) and `crm-template-*` (editor), keeping existing e2e ids.

## Spec/plan coverage and findings

**ACs with no UI surface** (rendering, API or constraint only): AC-4.6/4.7 *printing* (the UI shows the table, S5, and
the preview), AC-6.7 (a constraint, honoured by design), AC-9.1–9.6 (seed and renderer), AC-10.1 (copy rule). Everything
else maps to a flow above.

**Owner amendment — ACs with no UI surface**: AC-12.2 (engine: same value in preview and PDF, escaping), AC-12.3, 12.10 (seed texts),
AC-12.4 (frozen offers), AC-12.5, 12.6, 12.11 (the in-place upgrade; a draft's AC-8.4 notice is the existing F8), AC-11.7 and 11.8
(constraints met by `useLetterhead`: own origins, no storage, one attempt), AC-3.2 and AC-9.6 (what "same content" excludes; print
differences). Mapped to a surface: AC-11.1 → pages (letterhead on each, text above), 11.2–11.4 → page stack + bands (§ The page stack, § Letterhead bands), 11.5 → page edge and
gap tokens (no filter), 11.6 → Drawer, 11.9 → F14 and the Try view, 12.1 and 12.9 → the outline group (S13) and the paper's print, 12.7 → S9,
12.8 and 12.13 → Try view, 12.12 → address notice.

**OA-3 — mapping** (AC-3.2, AC-11.1–11.6, 11.8, 11.9 changed; AC-11.10–11.13 added): AC-11.2 → § The page stack (page size, gap, edge) and the caption (§ Letterhead
bands); AC-11.10 → the frame proportions and "nothing in the margins"; AC-11.11 → "What a break looks like" (the break rules themselves are plan DD-68, not
design); AC-11.12 → § Accessibility (page boundaries invisible to AT); AC-11.13 → § Drawer, narrow widths, zoom and text size and § Responsive; AC-3.2 → § Content
(same text and order, breaks approximate). **ACs with no UI surface after OA-3**: AC-11.8 (one fetch, a constraint on `useLetterhead`), AC-11.7. **UI added that no AC asks
for in OA-3**: none (the `letterhead_unusable` lines are the plan's DD-76 error mapping, M-4, not an AC of this spec; the Settings reason strings serve AC-9/Settings
upload, listed under S12b).

**UI added that no AC asks for** (kept small, droppable; reported, not expanded):**
1. A "Syntax reference" `Drawer` and extended `MarkupHelp` in the template editor (R9: non-developers write templates).
2. The editor's supersession note (AC-9.2 archives classic templates silently).
3. `state`-carried confirmation + proposal prompt after navigating from the wizard to the deal (INC-19; the old flow
   did it in the same page).
4. `lang` wrapper, status line, Reset sample answers.
Not designed though the mockup has them: the "optional fields left empty" list, URL prefill, JSON export, PDF download from
the wizard, the mockup's theme switch; click-a-placeholder-in-the-preview; outline-click-to-line; a Discard button *inside*
the wizard (Discard lives on the deal page, AC-6.4).

**Gaps found in the first draft — all closed by the plan's amendments (re-synced to plan DD-27…38, 2026-11-15)** (G10 kept as a note):
- **G1** The deal page needs a *draft summary* (template name, target, `updatedBy/At`, `version`) without downloading
  `answers` (≤ 512 KiB) — e.g. `GET /deals/{id}/offer-draft?summary=1` (or HEAD-like). Discard needs the `version`. **Closed: DD-27** (`GET /deals/{id}/offer-draft/summary`, 200 `{ draft: null }` when none).
- **G2** `POST offer-draft` requires `templateId`, but for edit/revision of a **wizard** offer the UI does not know it
  (`OfferSchema` has `templateName` only). Make `templateId` optional for those targets (server reads it from the snapshot)
  or expose `templateId` on the offer. **Closed: DD-28** (optional; the snapshot's template is the default; 409 `template_archived`, 422 `template_required`).
- **G3** The preview must show the renderer's **section numbering** (templates cite "par. 2"); numbering lives in the 018
  renderer, not in the shared engine contract. Put the numbering function in the byte-identical engine so AC-3.2 holds. **Closed: DD-29** (`numbering.ts`, `words.ts`).
- **G4** Hand-editing a section with missing fields: the engine's reserved markers (U+E000–E0FF) are refused in answers
  (422). The resolved-text-for-editing needs a visible token («Label») and a save-time check that no still-missing token is
  left (S8). Add `resolveSectionForEdit` to the engine contract. **Closed: DD-30**, with the token written ⟦Label⟧, not «Label», and any remaining token blocking the save.
- **G5** `answers.lastStep` would bump `version` on every step click and cause needless 409s between two editors. Design:
  step navigation alone does not save; `lastStep` rides on the next content save. **Closed: DD-31** (plus a PUT identical to the stored draft is a no-op).
- **G6** `computeCosts` errors (`discounts_exceed_one_off`, `no_counted_line`…) are not in `ResolvedOffer.invalid`, so the
  UI would offer Generate and the server would 422. The UI synthesises them into the issues list (S5/S7); confirm the server
  returns them in `offer_incomplete.invalid` too, for consistency. **Closed: DD-32** (they are `ResolvedOffer.invalid` entries; the UI synthesises nothing; hand-edit limits too).
- **G7** `outline()` should expose per item: `fills` (for the "Fills:" hint), `optional`, `derived`, and per step the
  section headings (nice-to-have for the editor outline). **Closed: DD-33**.
- **G8** AC-1.3 ("optional" marked) vs design-system INC-16 ("never write optional") — **recorded as DD-36** (AC-1.3 wins over INC-16; the departure stays the owner's to review).
- **G9** Plan deviations of presentation: DD-25 (dialog → editor view), editor "line numbers" (→ status line + problem
  line numbers, because soft-wrapped 800-character paragraphs cannot share a gutter), plan's contacts `Combobox` (→ checkboxes). **Accepted: DD-37**.
- **G10** The CRM `/scope` response must tell the deal page whether the caller holds `financials` **and** manage for this
  deal's entity (it already has `financials`; entity scope comes from `canManageDealsOf`) — no new endpoint, only a note.
- **G11 (owner amendment)** `useLetterhead` as sketched in the plan takes `present: boolean | null`, where `null` = "profile unreadable"
  means `failed` at once. The Try view reads the profile asynchronously, so it needs a third input — "not known yet" — that keeps the
  state `pending` and starts nothing; otherwise the band flashes `failed` on every mount and the one-shot attempt is spent before
  the answer arrives. Needs a small hook change (e.g. `present: boolean | null | "loading"`); not a plan or spec change.
- **G12 (owner amendment)** AC-11.4 "the browser cannot render it" is not covered by the plan's hook: a `blob:` PNG the browser cannot
  draw would leave the pages with broken `<img>`s while the state says `shown`. The hook should decode the blob (`Image.decode()`)
  inside its 10 s budget before reporting `shown`, or `DocumentPreview` should report the `<img>` `error` event back (an
  `onLetterheadError` that sets `failed`). Either keeps the band truthful.
- **G13 (owner amendment) — closed by OA-3.** The old Italian caption ("sono diverse") and the shipped note ("possono variare") disagreed; the new
  caption and the rewritten `preview.note` both say "approssimative" (DD-72).
- **G14 (owner amendment)** On `< xl` the Preview step shows no inline preview, so the address notice (AC-12.12) is visible only in the
  Drawer. That is "near the preview" as written; surfacing it on the Preview step too would be a new UI no AC asks for, not designed.
- **G15 (owner amendment)** With a blank legal name the Preview card still says "Nothing is missing. You can generate the offer."
  (`issues.none`) next to a disabled Generate whose reason is the blank name. The same already happens with the estimate reason; the
  line is about the answers, the reason sits directly under it. Left as is; a dev may soften `issues.none` when `blockedReason` is
  set if QE finds it confusing.
- **G16 (owner amendment)** `ResolvedOffer.systemRead` (DD-58) must come from the **settled** resolution (the same one the paper
  prints), so the notice and the text agree; computing it from the live inputs would show the notice 250 ms before the text.
- **G18 (OA-3, needs the PO)** A 409 `letterhead_unusable` (DD-76) makes the preview's one attempt `failed`, and the `failed` band — whose words are fixed by AC-11.4 —
  says "It is **still added in the PDF**". For this one cause that is untrue: generating is refused (S10). The wizard says so at Generate (S10, "can no longer
  be used. Upload it again in CRM Settings"), but a person reads the reassuring band first. Options: accept; or add a fifth band state for this cause with its own
  words (a new AC; not designed here — "report, don't design"). Recommendation: add the state when the PO next touches AC-11.4; it is one string and one condition.
- **G19 (OA-3, no AC)** Nothing in Settings shows that a stored letterhead has become unusable until someone presses **Download** or an offer is refused. The release
  audit (DD-78) is the control for the legacy files; a standing indicator is UI no AC asks for, so it is not designed.
- **G20 (OA-3, plan finding)** DD-71 draws the page edge with `border-paper-rule` on a `bg-ink-mid` stage. Computed from `tokens.css`: paper vs stage is **1.19:1** and
  `paper-rule` vs paper 1.42:1 in the light theme — the pages would blend into the gap, against AC-11.2/11.5 ("clearly distinguishable"). This design uses
  `border-muted` (3.35:1 light, 6.5:1 dark vs paper); the plan line should be re-synced. Fallback if the owner finds the light gap too faint: stage `bg-muted` and no border
  (gap-vs-paper 3.35:1 / 6.5:1; heavier look in the dark theme). A dedicated desk token would be a library change (shell first), not proposed.
- **G21 (OA-3, plan finding)** DD-66's type rule is `max(12, 0.75 × rootFontPx, p × s)`. With the floor decided at 10 px, only the first term changes nothing: `0.75 × 16 = 12`
  keeps the floor at 12 at the default text size. The root-relative term must become `10/16 × rootFontPx` (= 0.625). The pages' sizes also reach the DOM as inline `style`
  (allowed: runtime values) below the library's 11 px chrome floor (`design-system.md` § Type) — an intended exception, recorded as D-36 so the token lint and reviewers expect it.
- **G22 (OA-3)** The spec file still words AC-11.13 with a 12 px floor and lists O8 open while the PO rewords it; this design is written for 10 px and must be re-read once
  the spec lands. `plan.md` DD-66, R/O11 and the page-count consequence ("about twice") also still say 12 px; at 10 px the figure is about 1.5 ×.
- **G17 (owner amendment)** `OutlineView` receives only `outline`; the "Supplied by the CRM" group needs `suppliedFields(ast)` too (a new
  prop, shape per DD-58: at least `name`, `label`, `source: "issuer" | "issuerAddress"`, in order of first use). The editor page, which
  holds the last readable `ast`, passes it.


## Delegated decisions

Taken on the owner's behalf (headless, ungated); each is reversible in review.

| # | Decision | Alternatives | Why |
|---|---|---|---|
| D-1 | Wizard = full page `/crm/deals/$id/offer`, `wide` column | `Dialog`, `Drawer`-hosted wizard | S1 rationale; plan already routes it |
| D-2 | Editor "Preview in wizard" = a second **view** (`Tabs`), not a dialog | full-screen `Dialog` (plan DD-25), new `Dialog size="full"` | No library change, keyboard keeps the problem list, state stays mounted — accepted by plan DD-37 (supersedes DD-25's presentation) |
| D-3 | Step = `?step=` search param, replaced on navigation; all steps reachable once a draft exists | push history; disable unvisited steps | Back button/refresh/deep link without history spam; answers live on the server |
| D-4 | Autosave status text + throttled live region; no Save button | explicit Save | AC-6.1; avoids chatter for SR users |
| D-5 | Conflict ⇒ read-only form + Reload (own unsaved ≤ 1 s lost, said so) | auto-merge, keep editing locally | AC-6.3; no hidden merge rules; hand-edit dialog saves synchronously so long text is never lost silently |
| D-6 | Contacts picked with `CheckboxGroupField`, not `Combobox` | `Combobox` (plan) | Same control as today's dialog; ≤ 5 of the company's contacts — accepted by plan DD-37 |
| D-7 | Optional fields carry a visible "optional" tag **and** required ones the `*` | follow INC-16 only | AC-1.3 demands the word; a11y still has `aria-required` — recorded as plan DD-36 |
| D-8 *(OA-3: "fluid width, `max-w-3xl`" superseded by D-33; the light-in-both-themes part stands)* | Preview paper is light in both themes via 7 new `paper-*` tokens; fluid width, no CSS scaling | scaled A4 box (mockup), theme-coloured paper | Fidelity to print, real text/zoom, "new colour = new token" |
| D-9 | Narrow preview in a `Drawer` | inline collapsible, route | Library pattern for reference content read next to the page |
| D-10 | Preview step shows issues + sections table + generate; draft row lives inside `OffersCard`, not a new card | separate "Drafts" card | Fewer cards on the deal page; AC-6.4 asks for an indicator, not a section |
| D-11 | Header primary on the deal page: New offer / New revision / none while a draft exists; Continue is the draft row's primary | two primaries | One primary per card |
| D-12 | Editor shows the supersession note (D-additions list item 2) | silent | A destructive-looking side effect should not be a surprise |
| D-13 | Template cards act immediately (**Use template** creates the draft) | select-then-confirm | AC-1.1/6.5: nothing stored before a pick; fewer steps |
| D-14 | Outline cannot be clicked to jump; preview placeholders are not interactive | interactive | Not asked; keeps tab order short |
| D-15 | Block with `fills` shows a static "Fills: …" hint and keeps values when off (O3) | revert on off | `decisions.md` O3; discloses behaviour up front |
| D-16 | Generate is `aria-disabled` (not `disabled`) with count + description | disabled | Users must reach it to learn why (design-system rule 5) |
| D-17 | After generation navigate to the deal; confirmation + proposal prompt via router `state` (memory) | stay on the wizard | INC-19; the draft no longer exists; no browser storage (AC-6.7) |
| D-18 | Template-derived text carries `lang` when it differs from the UI | none | WCAG 3.1.2; Italian templates under an English UI are the normal case |
| D-19 (re-synced to plan DD-30, 2026-11-15) | The preview's missing mark is ⟦Label⟧, the same glyphs as the hand-edit token (plan DD-30 fixes only the hand-edit text) | «Label» in the preview and ⟦Label⟧ in the dialog | The person sees one notation for "a value is missing"; «…» appears in template text (T1's «Cliente») and would pass for it. Reversible without any contract change |
| D-20 (re-synced to plan DD-31, 2026-11-15) | Step navigation saves nothing; `lastStep` rides on the next content save | save on every step click | No spurious 409 between two people reviewing; reopening lands where the last change was made |
| D-21 (re-synced to plan DD-35, 2026-11-15) | An added cost line is inserted before the last total row | at the end of the table | The plan's rule: at the end it would sit outside every printed total |
| D-22 *(OA-3: the band stays chrome above the region; "the existing note as a second span" is now the rewritten note, D-37)* (owner amendment, DD-55, DD-56) | The band and the address notice are **chrome above the scrolling region**, outside the paper; one paragraph per state (the new sentence + the existing `preview.note`), except `shown`, whose caption already contains the note | Keep the band inside the paper (plan rejected); a `Banner` for the failed state; a separate row for the note in every state | AC-11.2 words the caption as one sentence pair; outside the region it stays in view while the document scrolls and never sits on the letterhead |
| D-23 *(superseded by D-38, OA-3: page boxes replace the A4 box)* (owner amendment) | The A4 box is reserved in every state but `none` (a `div` while `pending` and `failed`, the `<img>` when `shown`); no spinner, skeleton or progress text | Image appears and grows the paper; a loading skeleton on the paper | Zero layout shift (no jump of the person's reading position); the band already says what is pending |
| D-24 (owner amendment) | Band, notice and letterhead state are silent: no live region, no alert, no toast; `aria-busy` of the paper stays tied to the text's debounce | Polite announcement "Letterhead loaded" / alert on failure | AC-11.4 forbids dialog/toast; the preview is deliberately never live; nothing is actionable |
| D-25 (owner amendment, DD-58) | Address notice = `Banner tone="warning" live="off" compact` + `aria-label`, no action, not dismissible, below the band, same in pane, Drawer and Try view | `info` tone; a dismiss ×; a "Open CRM Settings" action; a banner on every step | Something to fix but the offer stays valid; a persistent state read in place; the wizard cannot fix it, and a link would be UI no AC asks for |
| D-26 (owner amendment, DD-61) | The blank-legal-name reason joins the existing `generateBlockedReason` chain (estimate → archived → this), text with a final period, `{entity}` = badge label; no banner, no count, no focus target | A top banner on every step; a missing-field entry; checking it on the Client step | AC-12.7: not a missing field, the person cannot fill it in; one reason at a time as the others |
| D-27 (owner amendment, DD-58) | The outline's "Supplied by the CRM" group is the last section of the card, after the steps, lists only declared-and-used fields, absent when none | At the top; a step of its own; also listing `reference` and `currency` (open question O10) | It is not something to ask; AC-12.1/12.9 ask for the two sources only |
| D-28 (owner amendment, DD-62) | Try view: wizard renders at once on sample values; the sample note appears only after the profile read fails or its name is blank; the letterhead attempt waits for the read | Block the view on the read; show the note while loading | The preview must not wait; a note for an unfinished read would say something untrue |
| D-29 *(OA-3: the caption changed with the owner's choice, D-37; G13 closed)* (owner amendment) | The four spec strings are the contract, copied exactly; the Italian caption keeps "sono diverse" next to the shipped "possono variare" (G13) | Rewrite the shipped note | AC wording is the owner's own |
| D-30 (owner D19, 2026-11-15) | Preview region height = remaining content area, internal scroll, `overscroll-contain`, wide pane only; recorded as the first bullet of § Preview pane; the chrome added by this amendment sits above the region | A viewport-relative `max-h` (the first draft) | Owner's fix; the region is measured from its own top, so chrome above it needs no extra rule |
| D-31 *(superseded by D-33/D-35, OA-3: the frame is now an AC; the no-marker, no-scrim and no-retry parts stand)* (owner amendment, DD-55) | No page-break marker at the end of the A4 box, no scrim behind the text, no inset mirroring the PDF's frame, no retry button for a failed letterhead | Dashed "page 1 ends here" rule; semi-opaque layer under the text; "Try again" | Not asked; the caption says it, O5 accepts the overlap, "tried again the next time the wizard is opened" is the spec's retry |
| D-32 (owner amendment) | The letterhead attempt's result (state and `blob:` URL) belongs to the page and is shared by the pane and the Drawer; the URL is revoked at page unmount only | Each preview owns its own attempt | AC-11.6, 11.8: no second fetch when the Drawer opens or the viewport crosses `xl` |
| D-33 (OA-3, DD-65, DD-66) | The preview is **a stack of real A4 pages** in the one scrolling region: `W = min(794, available − 2·inset)`, `inset = min(16, available/20)`, `H = W·297/210`, gap 16 px, stack centred when wider; scaling by width only, never by CSS transform; one continuous flow of real text over a decorative page layer | One A4 box with `max-w-3xl` paper (D-8, D-23); a scaled A4 mockup; a PDF/canvas preview (declined by the owner) | The owner's "Real A4 pages": AC-11.2, AC-11.13; text stays real, selectable and zoomable |
| D-34 (OA-3, DD-71) | Gap = the stage's `bg-ink-mid` (follows the theme); page = `bg-paper border border-muted`; **no shadow**; edge 6.5:1 dark / 3.35:1 light vs paper | Plan's `border-paper-rule` (1.19:1 light — fails AC-11.5); `shadow-*` (no token, not in forced colours, invisible on the dark stage); stage `bg-muted` without border (fallback, heavier in dark); a new desk token (library change, shell-first deploy) | Only existing tokens give a ≥ 3:1 edge in both themes; a border survives forced colours |
| D-35 (OA-3, AC-11.10) | The frame is 120/110/71/71 pt as proportions of the page, identical in every letterhead state; the preview adds nothing in the margins — no page numbers, markers, running headers, "continued" or ruler, no plain header for a missing letterhead | A page number in a corner like the PDF; a dashed break marker; drawing the plain header when none | AC-11.2, 11.3, 11.12 say none; the band tells the rest |
| D-36 (OA-3, AC-11.13) | Text = PDF sizes × `W/595.28`, **floor 10 CSS px** following the text-size setting (10/16 of root), line-height 1.35; reaches the DOM as inline runtime `style`; below the library's 11 px chrome floor on purpose | 12 px (spec O8's first value, plan DD-66); 11 px to match `text-2xs`; arbitrary `text-[10px]` classes (lint-refused, and the px are runtime) | Owner/PO decision for 10; the page is print, not chrome; token lint satisfied (no colour inline) |
| D-37 (OA-3, DD-72) | Caption of `shown` = AC-11.2's two sentences as one string; the other three states keep their sentence and append the rewritten `preview.note` ("Page breaks are approximate: the PDF is the authority.", it "Le interruzioni di pagina sono approssimative: fa fede il PDF."); no page number, count or list | Composing `shown` from sentence + note (the AC calls it one caption); dropping the note in three states; a separate caption line (shifts layout) | The AC's copy exactly; one sentence about breaks in every state |
| D-38 (OA-3, AC-11.3, 11.4, 11.6) | `pending`, `failed` and `none` draw the same pages (frame, text, breaks) without the image; `pending → shown/failed` moves nothing; the Drawer renders the same tree at its own width, with the page's one attempt and image; no spinner or skeleton | An A4 box only for some states; collapsing the pages while loading | AC-11.4 "changes nothing but what is drawn behind the text"; AC-11.6 |
| D-39 (OA-3, AC-11.12) | One focusable region; page layer `aria-hidden` + `inert`, no page label/number/landmark, nothing announced on a re-layout; `aria-busy` for the debounce only | A "Page n of N" label for screen readers; a live "N pages" count | AC-11.12 forbids all three; the PDF is the authority for page counts |
| D-40 (OA-3, AC-11.11) | Visible differences from the PDF are accepted and stated by the caption, not patched: table header row not repeated after a break, pages ending early before kept-together blocks and annexes, ≈ 1.5 × the PDF's page count at the default pane | Repeating the header (adds structure, AC-11.1); shrinking the text below the floor | Plan DD-68/DD-79; the PDF is the authority |
| D-41 (OA-3, DD-76) | 409 `letterhead_unusable` on generate = a `danger` Banner in S10 with no action (the fix is in Settings; Generate stays available); Settings shows two new messages (S12b); the preview's band stays AC-11.4's `failed` copy though "still added in the PDF" is untrue here (G18) | An "Open CRM Settings" action (UI no AC asks for); a fifth band state (a new AC) | Plan's copy as written; the report asks the PO about G18 |
| D-42 (OA-3) | The band reserves **three** lines (`min-h-14`, was `min-h-10`) | Keep two lines; reserve four | The caption and the Italian `none`/`failed` sentences plus the note are ≈ 170–180 characters: two lines would shift the region on a state change |

## Self-critique (one pass, `design.md` checklist)

Checked: loading/empty/error/forbidden/conflict states exist for the page, template step, deal-page draft row, hand edit and
editor (S1–S13); every NEW has a one-line reason and none duplicates a library component (the one table that looked like a
duplicate, `SectionsEditor`, is heading+body only); every flow cites US/AC; a11y is stated as concrete mechanisms (focus
targets, live-region policy, aria-disabled cases), not prose. Residual risks: the preview's section numbering and the
hand-edit token handling are now plan contracts (DD-29, DD-30), no longer open gaps; the "optional" tag contradicts INC-16 pending the
owner (D-7); no live screenshots of the current screens were taken. Re-sync pass 2026-11-15: every screen and state re-read against the plan's UI section, API tables, `ResolvedOffer`/`InvalidCode`, `costs.ts` rules C1–C9 and DD-27…DD-38; one residual choice of mine, D-19.

**Owner amendment pass (2026-11-15, US-11/US-12), one pass over the changes** (`self-critique` checklist for design.md):
- *States.* The letterhead has all four (pending, shown, none, failed) with exact en+it copy, plus the Try view's loading, unreadable and
  blank-name cases; the address notice has its condition, absence and placement; the blank legal name has its reason. No state is left to
  prose. Loading/empty/error of the wizard itself are untouched (S1–S13).
- *Flow/AC mapping.* Every new element cites its AC (F14, F15, § Letterhead bands, § Address notice, S13 additions); the ACs with no UI
  surface are listed; UI not asked for is listed as not designed (D-31, G14).
- *NEW components.* None added; the two reuse rows say why nothing new fits (`Banner` already has `live="off"`/`compact`; the band is
  deliberately not a `Banner`, DD-56). The hook additions are findings (G11, G12), not designs.
- *a11y as mechanism, not prose.* `alt=""` + `aria-hidden`, no tab stop, the one focusable region, `live="off"` + `aria-label`,
  `aria-describedby` on Generate, no animation; each is a testable assertion.
- *Residual risks.* (1) *(superseded by D-42, OA-3: the band now reserves three lines)* The `min-h-10` band reserves two lines; a narrow Drawer can still wrap to three (one line of shift at most,
  absorbed by the D19 fit). (2) Text over the letterhead's own artwork can fall below AA locally (accepted, O5). (3) The Italian caption
  differs by a phrase from the shipped note (G13). (4) G11/G12 need two small hook changes the plan does not state. (5) The design
  assumes `systemRead` and `suppliedFields` ship as DD-58 describes; their exact shapes are the plan's, not verified here (the engine
  code was not read). Not re-run: visual direction (the system wins; the paper tokens already exist). No live screenshots were taken.

**OA-3 re-sync pass (2026-11-15, real A4 pages), one pass over the changes** (`self-critique` checklist for design.md):
- *States.* Pending, shown, none and failed each have their pages, copy (en + it) and a no-shift statement; the Try view, the Drawer, 320 px, 200 % zoom and doubled text
  are named; the new generate refusal has its S10 row and the Settings card its two outcomes (S12b). Loading/empty of the surrounding screens are unchanged.
- *Flow/AC mapping.* Each new surface cites its AC (§ coverage); ACs with no UI surface are AC-11.7, 11.8 and the break rules themselves (plan); no UI is added that
  no AC asks for, except the `letterhead_unusable` mapping, which is the plan's M-4, and it is reported.
- *NEW components.* None; the one new inventory row is non-UI logic with a stated reason. DD-55's A4-box rows were replaced, not duplicated (re-read the table).
- *a11y as mechanism.* `aria-hidden` + `inert` layer, no page labels, one tab stop, `aria-busy` rule, border-based edge with measured contrast, text floor tied to the
  root size; each is a testable assertion.
- *Fixed.* Stale first-page / A4-box wording (F14, mockup, § Preview pane, § Loading, § Drawer, Responsive, copy keys, coverage, D-8/22/23/29/31, a duplicated sentence in
  the coverage heading). *Found and reported, not decided:* G18 (the `failed` band's "still added in the PDF" is untrue for an unusable letterhead), G20 (plan DD-71's edge token
  fails in the light theme), G21 (plan DD-66's `0.75 × root` term would keep the floor at 12), G22 (spec/plan still say 12 px).
- *Residual risks.* The 10 px floor and `border-muted` are my choices on the decision given (reversible by one constant / one class); the contrast figures come from the token
  values, not a rendered check; the table figures are approximate; the Drawer's inner width was not measured (no running app); the plan's break rules were taken as written,
  not verified. Not re-run: visual direction (the system wins).
