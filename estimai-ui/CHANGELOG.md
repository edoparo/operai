# @operai/estimai-ui

## 0.1.0

### Minor Changes

- 3172659: EstimAI list (specs/20261108-estimate-list-oversight): an admin can list and open every estimate read-only (new `estimate:read-all` permission, seeded to `admin`; ADR 20261108-estimai-oversight-permission-amends-0036); closed estimates move from the default Open list to a Closed filter; an estimate linked to a CRM deal shows a Deal badge, kept up to date by crm-api's new deal-link notices (scope `deal-link-notices.send`, ADR 20261108-crm-pushes-deal-links-to-estimai). Deploy auth first, then add the scope to crm-api's `SERVICE_CLIENTS` entry, set `SERVICE_AUDIENCE` on estimai-api and `ESTIMAI_INTERNAL_URL` on crm-api, deploy both, and run `crm-api/scripts/backfill-estimate-links.ts --apply` once.
- d549baf: A technical estimate is finished when it is closed in EstimAI. The owner or an editor closes it from the estimate page, after which it is read-only until someone reopens it. The CRM follows on its own: the deal's estimate turns ready, its task is completed, and the requester and the deal owner are told; reopening it in EstimAI reverses that. The CRM no longer has its own "Mark ready" and "Reopen" buttons. Needs `estimate-notices.send` on estimai-api's service client in auth, `CRM_INTERNAL_URL` on estimai-api and `SERVICE_AUDIENCE` on crm-api.
- 28872b4: Every tool now shares one look for actions, text and page layout: buttons and
  dialogs come from the shared library with the same meaning-based styles
  (primary actions meet contrast everywhere, cancel is quiet, destructive is
  red), text uses one type scale with an 11px minimum, labels drop their "+"
  and arrow prefixes, each tool has the same title bar, tabs and page header on
  a common width scale, and every detail page has a "Back to …" link. EstimAI's
  shortcuts, health and About dialogs are now real modal dialogs.
- 28872b4: Tables, paging, forms and feedback now work the same in every tool: record
  lists are accessible data tables, long lists page the same way, every form
  marks required fields with an asterisk and explains errors next to the field
  (moving focus to the first one), amounts accept a comma or a dot, dates use
  the date picker, every save, invite and delete confirms where you acted,
  errors you can retry are orange and errors you must fix are red, EstimAI no
  longer uses browser alert boxes, and the page no longer scrolls behind an open
  dialog.
- 28872b4: The whole suite now speaks Italian as well as English: every tool has a
  complete Italian translation and follows the browser's language, chosen once
  for all tools. Dates read the same everywhere (31.10.2026), amounts show their
  currency code with the language's separators, statuses use one shared set of
  icons and colours so the same symbol always means the same thing, emoji and
  text symbols are replaced by real icons that render on every system, headings
  are in sentence case, loading and empty screens look the same in every tool,
  detail pages are organised in cards, and EstimAI's views are proper tabs.

### Patch Changes

- 28872b4: The design system gains `Combobox` (suggestions while typing) and `Drawer` (a
  side panel for reference content). Admin's address and country fields and
  Inventory's holder and supplier pickers now share the one `Combobox`, which
  also keeps the highlighted suggestion in view in a long list. EstimAI's model
  reference opens in the library `Drawer`. Admin's user detail and mileage-rate
  pages read permissions from the shell instead of fetching them again. The
  suite's end-to-end tests look for the current Refund label instead of the old
  "Refund (Rimborsi)".
- bc428e8: CRM offer document (specs/20261102-crm-offer-document, ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes):
  - **Letterhead:** each entity uploads its letterhead PDF in Settings; every offer page is printed on it.
  - **Offer templates:** wellD's contract structure as editable templates per entity and language (14 seeded from wellD's own offers, Italian and English), with a template editor in Settings.
  - **Generate dialog:** starts from a template; the draft is prefilled from the estimate (epics, phases, timing per release, man-days, amount split per release); cost lines with unit price, quantity, yearly lines and discounts (amount or percentage); deal PDFs can be appended as annexes; optional Annex A with the effort detail.
  - **Numbering:** `0017/2026`, then `0017/2026r1` for later revisions of the same deal.
  - **Companies:** legal name, street and postal code.
  - **Fix:** estimate activities are matched to their release by name as well as id, so the effort no longer lands under "Other".
- 59e9b48: Dependency security update. better-auth moves to 1.7.18 everywhere, closing the advisory that let an OAuth state be used as a magic link to sign in as another user. The frontends move to vitest 4 and refreshed lockfiles, which clears the critical seroval and tinypool advisories. auth gains a migration adding three optional key columns that better-auth 1.7 expects on its signing-key table.
- bc428e8: An estimate whose stored document lacks some model parameters (one the CRM creates starts empty) now opens with their defaults instead of blank fields.
- 3f6c467: The import offer no longer comes back for estimates already in your account: it remembers what this browser imported and leaves out local estimates whose name is already in your list.
- 2947be3: The estimate editor confirms an autosave with a small badge in its header — a spinner while saving, then "Saved just now" / "Saved 5 minutes ago" — instead of a "Changes stored" banner that pushed the page down on every save.
- 7260f31: The collaborators dialog no longer sticks on "Adding…" in development: its
  mounted flag is set again after React StrictMode's remount, so add, level change,
  remove and leave results are applied.
- 7f5c0af: A click outside a form dialog no longer closes it and throws away what was typed: `FormDialog` ignores the backdrop, and Cancel, × and Escape still close it. `Dialog` gains `dismissOnBackdrop` for the same behaviour, which the estimate's collaborators dialog and the refund reject dialog now use. In every dialog and drawer, a text selection that starts inside and is released outside no longer counts as a click on the backdrop.
- 28872b4: One styling dialect across the suite (ADR 20261031-one-styling-dialect-token-utilities): colours and fonts are Tailwind
  utilities generated from the shared design tokens, never inline styles, and a
  lint rule keeps it that way. Hover and focus colours now apply where inline
  colours used to override them, date pickers follow the light theme, EstimAI's
  AI purple and tinted highlights follow the theme too, and each tool's
  standalone build uses the suite's real tokens instead of a stale copy.
- 28872b4: The design system gains `Menu` (the header's logo and account menus, now with
  full keyboard support) and `CheckboxGroupField` (pick several options from a
  list), and `ConfirmDialog` can ask for an acknowledgement and hold fields.
  Refund's "Mark as paid" and Inventory's dispose, close-year and new-rule
  dialogs now share that confirmation; Admin's role and department checklists
  and Inventory's invoice linking share the checkbox group. Success messages
  dismiss themselves after the same time in every tool.
- 28872b4: A confirmation opened on top of another dialog now closes on its own: Escape
  and Tab act on the topmost dialog only, so cancelling "Remove this
  collaborator?" no longer closes the collaborators dialog too. EstimAI's
  collaborators dialog now uses the shared dialog frame.
- c4ba4c3: Pages use more of a wide screen: the default tool column grows from 64rem to 80rem and the wide one (the CRM pipeline) fills the width beside the sidebar; single forms stay at 40rem.

## 0.0.2

### Patch Changes

- 2b11a53: Status, entity and currency badges keep their label on one line instead of wrapping inside a
  narrow table column.
- 2b11a53: React and React DOM now resolve to 19.2.7, the version every other frontend in the suite
  uses. Module Federation shares React as a singleton, so a different version in one remote can
  break the others when they load together.

  Dropdowns now draw the suite's own chevron with space reserved for it, instead of the browser's
  arrow sitting against the right border.

  Checkboxes and radio buttons use the suite's own style instead of the browser's.

## 0.0.1

### Patch Changes

- 6a13795: The shell footer/About dialog was showing `@operai/shell`'s own package
  version (`0.0.0`) instead of the Operai suite's umbrella version — the two
  are different numbers, and only the umbrella one is meaningful to a user.
  The footer now reads the umbrella version from a committed, generated file
  (`shell/src/lib/suiteVersion.generated.json`, kept in sync by
  `scripts/version.mjs` at release time) instead of `shell`'s own
  `package.json`.

  The About dialog additionally gains a "Components" section listing each
  mounted remote's own version (EstimAI, Refund, Admin, Notify), each exposed
  via a small new federated `./version` module. A remote whose version can't be
  resolved — unreachable, cold-starting, or (going forward, since every app
  deploys independently) simply predating this change — degrades to a muted
  "—" rather than blocking the dialog or throwing.
