# UI, UX and design-system inconsistencies across the Operai frontends

Audit of the six frontends (shell, estimai-ui, refund-ui, admin-ui, notify-ui,
inventory-ui) done on 2026-10-31, before extracting the shared component library
`@operai/ui` (`operai-ui/`, ADR-0050). Every finding cites code in at least two
apps; line numbers refer to `main` at a45961d (tokens to the pre-move
`shell/src/styles/tokens.css`).

Each finding carries its status on the branch `feat/operai-ui-library`, which
extracted the library and then moved all six frontends onto it. The
decisions behind the fixes are in `operai-ui/docs/decisions.md`.

> **Two styling dialects — resolved (ADR-0051).** The audit's baseline found the shell and
> estimai-ui styling tokens with Tailwind utilities while refund, admin, notify and inventory
> used inline `style={{ color: 'var(--…)' }}` (about 850 token values). All six frontends now
> use token utilities only (`text-soft`, `bg-org/10`), generated from `@theme inline`; an
> ESLint rule shared from `operai-ui/eslint/design-tokens.ts` keeps it that way.

## Status at a glance

| Finding | Status on this branch |
|---|---|
| INC-01 | Fixed |
| INC-02 | Fixed |
| INC-03 | Fixed |
| INC-04 | Fixed |
| INC-05 | Fixed |
| INC-06 | Fixed |
| INC-07 | Fixed |
| INC-08 | Fixed |
| INC-09 | Fixed |
| INC-10 | Fixed |
| INC-11 | Fixed |
| INC-12 | Fixed, with one documented exception |
| INC-13 | Fixed |
| INC-14 | Fixed, with one documented exception |
| INC-15 | Fixed |
| INC-16 | Fixed |
| INC-17 | Fixed |
| INC-18 | Fixed |
| INC-19 | Fixed |
| INC-20 | Fixed |
| INC-21 | Fixed |
| INC-22 | Fixed |
| INC-23 | Fixed |
| INC-24 | Fixed |
| INC-25 | Fixed |
| INC-26 | Fixed |
| INC-27 | Fixed |
| INC-28 | Fixed |
| INC-29 | Fixed |
| INC-30 | Fixed |
| INC-31 | Fixed |
| INC-32 | Fixed |
| INC-33 | Fixed |

## What is still open

Every finding is fixed on this branch; these are the deliberate exceptions and
the follow-ups they leave, all recorded in `operai-ui/docs/decisions.md`:

- **Editing grids stay their own components** (estimai's activity and summary
  tables): they are editors, not data tables (INC-14).
- **Client documents stay English**: estimai's PDF/XLSX exports and refund-api's
  PDFs (INC-24/25). Translating them is a product decision.
- **Empty states inside cards in inventory** still use an h3 under the card's
  h3; `StatePanel` now accepts `headingLevel={4}`.
- **refund-ui's motivo autocomplete** (`MotivoSuggestField`) stays its own
  combobox: specs/014 makes it a combobox only on `travel_km` lines and forbids
  any empty, loading or error line in its popup, the opposite of the library
  `Combobox`'s caller-owned empty state.
- **Visual review in the running suite** is still to do: every change was
  verified by unit tests, lint, type-checks and builds, not in a browser with the
  whole stack, and the e2e suite has not been run. The specs that still looked
  for the specs/003 sidebar label "Refund (Rimborsi)" and the "coming soon"
  placeholder now match the current tool ("Refund", exact).

## Baseline metrics (component `.tsx` files, per app)

| Metric | shell | estimai | refund | admin | notify | inventory |
|---|---|---|---|---|---|---|
| files | 17 | 25 | 39 | 33 | 6 | 41 |
| `<button` | 12 | 48 | 43 | 68 | 2 | 34 |
| `btn btn-*` class uses | 0 | 0 | 1 | 0 | 0 | 33 |
| `.card`/`card-title` uses | 0 | 0 | 0 | 0 | 0 | 8 |
| inline `style={{` | 0 | 14 | 236 | 330 | 21 | 157 |
| `var(--…)` in TSX | 0 | 3 | 352 | 473 | 30 | 234 |
| Tailwind palette utilities (`text-soft`, `bg-ink`…) | 121 | 417 | 0 | 0 | 2 | 0 |
| arbitrary `text-[NNpx]` | 15 | 104 | 22 | 39 | 1 | 7 |
| `aria-*` attributes | 43 | 58 | 135 | 178 | 7 | 166 |
| `aria-invalid` | 0 | 1 | **0** | 11 | 0 | 31 |
| `focus-visible:` utilities | 13 | 2 | 0 | 0 | 0 | 5 |

The suite uses two styling dialects. shell and estimai use Tailwind palette utilities (`text-soft`). refund, admin, notify and inventory use inline `style={{ color: 'var(--soft)' }}`. Only inventory-ui has migrated to the `.btn` and `.card` classes.

---

## 1. Tokens and global CSS

### INC-01: `font-mono` renders the system monospace, not DM Mono (high)
- **Status on `feat/operai-ui-library`:** Fixed. The `@theme` keys are `--font-mono`/`--font-disp`/`--font-body` (mapped to `var(--mono)`/`var(--disp)`/`var(--body)` by `@theme inline`), so the built sheet resolves `font-mono` to DM Mono; the hand-written `.font-disp`/`.font-body` classes are removed, so each font utility is defined once, by Tailwind, without the old `fantasy`/`serif` fallbacks. Every `font-mono` use in every app changes typeface.
- **Description.** The `@theme` block declares `--font-family-mono`/`-disp`/`-body`. Tailwind v4's namespace is `--font-*`, so `font-mono` keeps Tailwind's default stack. Apps that write `var(--mono)` get DM Mono; apps that write `font-mono` get ui-monospace/Menlo. Numeric figures therefore render in two different typefaces across the suite.
- **Evidence:**
  - `git show HEAD:shell/src/styles/tokens.css:56` declares `--font-family-mono: 'DM Mono'`.
  - The built sheet `shell/dist/assets/index-DkbXC72g.css` contains `.font-mono{font-family:var(--font-mono)}` with `--font-mono:ui-monospace, SFMono-Regular, Menlo…`.
  - `font-mono` uses: shell 12, estimai 38 (e.g. `estimai-ui/src/components/SummaryTable.tsx:38`), refund 14 (`refund-ui/src/pages/MyRequestsPage.tsx:150`), admin 14 (`admin-ui/src/pages/UsersPage.tsx:635`), notify 1 (`notify-ui/src/components/NotificationItem.tsx` origin label), inventory 1 (`inventory-ui/src/components/DataTable.tsx:54`).
  - `var(--mono)` uses: inventory 8 (`inventory-ui/src/pages/RegisterAssetPage.tsx:584`), admin 2, refund 1.
- **Recommendation.** Rename the theme keys to `--font-mono`, `--font-disp` and `--font-body` in the library's `@theme`, then drop the hand-written `.font-disp`/`.font-body` classes.

### INC-02: The shell's Tailwind `@source` list omits notify-ui (medium)
- **Status on `feat/operai-ui-library`:** Fixed. `shell/src/index.css` now scans `notify-ui/src` and `operai-ui/src`.
- **Description.** The shell emits the only Tailwind sheet, and it is supposed to scan every remote. notify-ui is not scanned, so a utility class that only notify-ui uses is never generated. notify-ui's App doc says it uses standard Tailwind utilities "freely".
- **Evidence:**
  - `shell/src/index.css:15-18` lists estimai, refund, admin and inventory only.
  - `notify-ui/src/App.tsx:53-56` says the utilities are used freely.
  - `leading-tight` in `notify-ui/src/components/NotificationItem.tsx` (the "New" tag) is absent from `shell/dist/assets/index-DkbXC72g.css`. Every other notify class happens to exist because another app uses it.
- **Recommendation.** Add `@source "../../notify-ui/src";`, or have the library generate a scan list covering every remote.

### INC-03: The standalone CSS copies do not match tokens.css (medium, dev parity)
- **Status on `feat/operai-ui-library`:** Fixed. Every remote's standalone `index.css` is now Tailwind + `operai-ui/src/styles/tokens.css` + a library scan, with no copy of the tokens (ADR-0051); inventory keeps its own focus ring (INC-04).
- **Description.** The tokens header says each remote keeps "its own copy of the SAME rules" in `src/index.css`. Only estimai does, and its copy is stale. refund, admin, notify and inventory import only `tailwindcss`, so their standalone builds have no palette `@theme`, base inputs, checkbox, select chevron or `.btn`. In those apps that is partly mitigated because `App.tsx` imports `shell/tokens.css` at runtime.
- **Evidence:**
  - `estimai-ui/src/index.css:1-268` copies `@theme`, `:root`, light theme, base layer, checkbox and chevron, but has **no `@layer components`**. The committed tokens file has `.btn` at line 228, `.card` at 284 and `.btn-primary` at 302. estimai standalone therefore cannot render `.btn`/`.card`.
  - `refund-ui/src/index.css:9`, `admin-ui/src/index.css:10` and `notify-ui/src/index.css:10` contain only `@import "tailwindcss"`.
  - `inventory-ui/src/index.css:21-30` adds a rule that exists nowhere else (see INC-04).
- **Recommendation.** Every app imports the single library stylesheet, both standalone and federated; delete the copies.

### INC-04: inventory's global focus ring ships only in its standalone build (medium, a11y)
- **Status on `feat/operai-ui-library`:** Fixed. The ring moved from inventory-ui's standalone `index.css` into the library's base layer: `:focus-visible` draws a 2px `--focus-ring` (= `--acc-hi`, ≥ 5.2:1 on every surface, both themes) on every focusable element except text fields (which keep their accent border) and `tabindex="-1"` programmatic targets (which keep the browser's behaviour). `.btn`, `.link`, tabs and table focus use the same token. inventory's a11y test checks the ring's contrast from the library tokens.
- **Description.** inventory-ui defines `:focus-visible { outline: 2px solid var(--acc-hi) }` in its own `index.css`. That file is deliberately not imported by the federated `App.tsx`, so inside the shell the ring does not exist. In production, inventory looks like the other apps, which rely on browser defaults or ad-hoc rings.
- **Evidence:**
  - `inventory-ui/src/index.css:21-30` defines the ring.
  - `inventory-ui/src/App.tsx:7-10` documents that `index.css` is not imported.
  - The committed tokens file defines focus-visible only for `.btn` (`:focus-visible` in the `.btn` block after line 228) and for checkbox/radio.
  - estimai uses ad-hoc `focus-visible:ring-acc/60` (`estimai-ui/src/components/WarningBadge.tsx`).
  - refund, admin and notify have 0 `focus-visible:` utilities.
- **Recommendation.** Move a global `:focus-visible` ring into the library tokens.

### INC-05: Hardcoded colours, and an "AI purple" that is not a token (medium)
- **Status on `feat/operai-ui-library`:** Fixed. No hex or `rgba()` remains in app code: estimai's AI purple is the new `--ai` token (`#b47fff` dark, `#7d3fd6` light), its hardcoded `rgba()` tints became token opacities (`bg-org/12`, `bg-acc/7`), and lint rejects colour literals and arbitrary colour classes (ADR-0051).
- **Description.** AGENTS.md names a "purple AI accent" as part of the design system, but it only exists as an arbitrary hex in estimai. Tints are also written as raw `rgba()` instead of `color-mix`/`--acc-lo`.
- **Evidence:**
  - `estimai-ui/src/components/SummaryTable.tsx:38,133,261,264,273,319,322,325` and `MetricsBar.tsx:42,48` hardcode `#b47fff`.
  - `SummaryTable.tsx:255,313` and `ActivityTable.tsx:1037` hardcode `rgba(245,166,35,…)` (= `--org`).
  - `HelpDrawer.tsx:49,84,107` hardcode `rgba(91,106,247,0.07)` (= accent).
  - `estimai-ui/src/lib/pdfExport.ts` has 17 hex literals and `lib/ganttChart.ts` has 8 (export rendering).
  - Every modal backdrop uses an inline `rgba(0, 0, 0, 0.6)`: `refund-ui/src/components/ConfirmDeleteModal.tsx:158`, `admin-ui/src/components/ConfirmDeleteModal.tsx:148`, `inventory-ui/src/components/FormModal.tsx:149` and 11 more. estimai and shell use `bg-black/60` (`estimai-ui/src/components/ConfirmDeleteModal.tsx:121`, `shell/src/components/AboutModal.tsx:58`).
- **Recommendation.** Add `--ai` (and its light-theme value) plus an `--overlay` token, and replace the literals.

### INC-06: Ad-hoc type scale (low/medium)
- **Status on `feat/operai-ui-library`:** Fixed. Type scale = Tailwind's steps plus `text-2xs` (11px, the floor); every arbitrary `text-[Npx]` (≈190 across estimai, admin, shell, refund, inventory, notify) is mapped onto it and arbitrary sizes are a lint error (`operai-ui/eslint/design-tokens.ts`). 9–10px text became 11px; estimai's SummaryTable headers now wrap instead of overflowing.
- **Description.** Font sizes are mostly arbitrary pixel values, and the same role gets different sizes in each app (see INC-14 for tables).
- **Evidence:**
  - estimai has 104 `text-[NNpx]` (e.g. `text-[9px]` headers at `SummaryTable.tsx:38`, `text-[14px]` at `components/Header.tsx`).
  - admin has 39 (`text-[11px]` table body at `UsersPage.tsx:617`, `text-[9px]` headers at `:635`).
  - Badges are `text-[11px]` everywhere.
  - inventory has 7.
- **Recommendation.** Define a small type scale (caption, label, body, title) as tokens and utilities.

---

## 2. Buttons

### INC-07: Only inventory uses the `.btn` vocabulary; three other button dialects exist (high)
- **Status on `feat/operai-ui-library`:** Fixed. Every button in every app is the library `Button` (or `buttonClassName` on an action `<Link>`). Kept as custom controls, by rule: shell menu items, sidebar nav rows, the bell link (styled as an icon button), estimai's in-page section tabs, filter chips, table-cell note toggle and template cards, admin's audit expand toggle, combobox options.
- **Description.** The design system mandates `.btn` + one variant, but only inventory-ui follows it. The others style every button individually, with different padding, radius and hover behaviour (`hover:opacity-80`, `hover:opacity-90`, `hover:bg-acc/90`, `hover:text-acc`).
- **Evidence:**
  - inventory has 33 `btn btn-*` uses out of 34 `<button>`s, e.g. `inventory-ui/src/components/ConfirmDialog.tsx:180,186`.
  - refund has 1 out of 43: only `refund-ui/src/pages/MyRequestsPage.tsx:93`.
  - admin, estimai, notify and shell have 0.
  - Examples of one-off styling: `admin-ui/src/pages/UsersPage.tsx:539-540`, `notify-ui/src/pages/NotificationCenterPage.tsx:145-146`, `estimai-ui/src/pages/EstimatesPage.tsx:411,424`, `shell/src/components/AboutModal.tsx` (close ×).
- **Recommendation.** Ship `<Button variant size>` in the library and migrate app by app.

### INC-08: Primary buttons use `--acc` under white text, which fails AA, outside inventory (high)
- **Status on `feat/operai-ui-library`:** Fixed. No surface fills with `--acc` under white text any more (primary = `btn-primary` on `--acc-solid`); the shell bell's unread badge moved to `--acc-solid` too.
- **Description.** The design doc says filled accent must use `--acc-solid` (5.0:1) because `--acc` under white text is 4.3:1. admin, refund and estimai fill with `--acc`.
- **Evidence:**
  - admin: `admin-ui/src/pages/UsersPage.tsx:540`, `InvitationsPage.tsx:391,456`, `RolesPage.tsx:244,267`, `RoleEditor.tsx:904`, `MileageRatesPage.tsx:456,612`.
  - refund: `refund-ui/src/pages/BatchHistoryPage.tsx:107`, `RequestDetailPage.tsx:637`.
  - estimai: `estimai-ui/src/pages/EstimatesPage.tsx:424`, `ImportOfferModal.tsx:271`, `ActivityTable.tsx:923`, and the active tab at `EstimatorApp.tsx:452`.
  - inventory: `.btn-primary` resolves to `var(--acc-solid)` (committed tokens: `--acc-solid` at line 78, `.btn-primary` at 302).
- **Recommendation.** Migrate to `btn-primary`.

### INC-09: The same meaning gets different variants: Cancel, destructive, acknowledge (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Cancel = ghost, destructive = danger, positive confirmation and acknowledge = primary, through the library `ConfirmDialog`/`NoticeDialog`/`FormDialog`/`Dialog`: admin, estimai, inventory and refund's dialogs are adapters over them; the shell's About modal and estimai's shortcuts/health modals now have dialog semantics and a focus trap. estimai's CollaboratorsDialog, which nests a confirm, uses the library `Dialog` too since dialogs stack (decisions D-43).
- **Description.** Equivalent actions look different from app to app.
- **Evidence (Cancel):**
  - estimai: outlined, muted, Tailwind (`estimai-ui/src/components/ConfirmDeleteModal.tsx:164`).
  - admin and refund: outlined, inline `var(--rule)`/`var(--muted)` (`admin-ui/src/components/ConfirmDeleteModal.tsx:202-203`, `refund-ui/src/components/ConfirmDeleteModal.tsx:212-213`).
  - inventory: `btn-ghost`, no border (`inventory-ui/src/components/ConfirmDialog.tsx:180`).
- **Evidence (destructive):**
  - estimai: red text, `border-red/50` (`ConfirmDeleteModal.tsx:173`).
  - admin and refund: red text and red border (`admin-ui/.../ConfirmDeleteModal.tsx:213`, `refund-ui/.../ConfirmDeleteModal.tsx:223`, where refund switches to green with `tone='positive'` at `:107`).
  - inventory: `btn-danger`, text in the normal text colour with a red border and tint (committed tokens, `.btn-danger` at line 335).
  - In the light theme, red text fails contrast, which the tokens comment calls out.
- **Evidence (Guardrail "OK"):**
  - admin and refund: accent-outlined (`admin-ui/src/components/GuardrailDialog.tsx:119`, `refund-ui/src/components/GuardrailDialog.tsx:132`).
  - inventory: `btn btn-primary` (`inventory-ui/src/components/GuardrailDialog.tsx:104`).
- **Recommendation.** Use one ConfirmDialog in the library with `tone: danger | primary`.

### INC-10: Same-app inconsistency in refund, and links styled as square-cornered buttons (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Action links use `buttonClassName`; inline navigation (names in tables, back links) is a `.link`, in every app.
- **Description.** refund's own "New" actions use two different styles. A `<Link>` styled by hand gets no radius, because the base `button` radius rule does not apply to `<a>`.
- **Evidence:**
  - "+ New request" uses `btn btn-primary` (`refund-ui/src/pages/MyRequestsPage.tsx:93`).
  - "New batch" uses an inline white-on-acc `<Link>` with no radius (`refund-ui/src/pages/BatchHistoryPage.tsx:106-107`).
  - The rejected-request "New request" link uses the same inline style (`RequestDetailPage.tsx:633-637`).
  - "Back to my requests" is a navigation link styled as an outlined button, against design rule 4 (`refund-ui/src/pages/NewRequestPage.tsx:117-124`).
- **Recommendation.** Use `.btn` on action links; plain underlined links for navigation.

### INC-11: Glyph prefixes in button labels (low)
- **Status on `feat/operai-ui-library`:** Fixed. Labels are sentence case, verb first, no glyph prefixes ("New request", "Invite user", "Import JSON", "Export PDF"); e2e selectors updated. Status glyphs stay in badges and in status text ("✓ Saved").
- **Evidence:**
  - `+ Invite user` (`admin-ui/src/pages/UsersPage.tsx:542`).
  - `+ New request` (`refund-ui/src/strings.ts:89`).
  - `+ New estimate` and `↑ Import JSON` (`estimai-ui/src/pages/EstimatesPage.tsx:413,427`).
  - inventory labels have no glyphs ("Register asset").
- **Recommendation.** Pick one rule (an icon slot in `<Button>`, not text glyphs).

---

## 3. Page layout

### INC-12: Different page frames, widths and title scales (medium)
- **Status on `feat/operai-ui-library`:** Fixed, with one documented exception. Every tool frame is `ToolLayout` (h1 tool title, `TabNav`, no nested `<main>`) on the width scale narrow 40rem / default 64rem / wide 90rem; every page starts with `PageHeader`. refund, admin, inventory, notify, estimai's list, the shell's `/account` (narrow) and `/devices` use it. Exception: estimai's estimate editor keeps its own sticky workspace header (decisions D-40).
- **Evidence:**
  - refund, admin and inventory share the same tool-header frame: `max-w-5xl px-6 py-8`, an `h1 text-xl font-bold` tool name, then `h2 text-lg` page titles. See `refund-ui/src/components/RefundShell.tsx:56-58,107`, `admin-ui/src/components/AdminShell.tsx:28-30,37`, `inventory-ui/src/components/InventoryShell.tsx:97-98,135`. These are three copies of one component.
  - notify: `max-w-2xl px-6 py-16`, page `h1 text-3xl font-bold`, no tool header (`notify-ui/src/pages/NotificationCenterPage.tsx:129-134`).
  - estimai list: `max-w-3xl px-5.5 py-8` (`estimai-ui/src/pages/EstimatesPage.tsx:231,242,317`). Its sticky header has no title, only actions (`:406-430`). The only `h1` is in the empty state (`:273`), and the estimate view has its own sticky header with an editable name (`components/Header.tsx:25`).
  - shell `/account`: `max-w-xl px-6 py-12`, `h1 text-lg font-semibold` (`shell/src/components/AccountScreen.tsx:125-126`).
  - inventory `/devices`: `max-w-3xl px-6 py-8`, `h1 text-lg` (`inventory-ui/src/pages/MyDevicesPage.tsx:163-172`).
- **Recommendation.** Library `ToolLayout` (header, title, tabs) and `PageHeader` (title, actions, back link), with one width scale.

### INC-13: Back links take three forms (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Every detail page has a back link in `PageHeader`'s `back` slot in every state: `.link`, sentence case, arrow `aria-hidden` — refund (request, review, batch), admin (user, department, role), inventory (asset, fiscal year), estimai's editor ("← Back to estimates").
- **Evidence:**
  - admin: `← Back to Users`, soft colour, no underline, Title Case, hardcoded (`admin-ui/src/pages/UserDetail.tsx:358-364`, `DepartmentDetail.tsx:282`).
  - inventory: `Back to assets`, accent, underlined, from strings (`inventory-ui/src/pages/AssetDetailPage.tsx:242-243`, `FiscalYearDetailPage.tsx:79`).
  - refund: the request, review and batch detail pages have no back link in the normal state, only in the not-found state (`refund-ui/src/pages/RequestDetailPage.tsx:440-446`, `ReviewDetailPage.tsx:389-395`, `BatchDetailPage.tsx:329-335`). The new-request page uses a button-styled link (`NewRequestPage.tsx:117`).
  - No app has breadcrumbs.
- **Recommendation.** Make the back link a `PageHeader` prop, rendered as an underlined accent link.

---

## 4. Tables and lists

### INC-14: Four list/table idioms with different density and semantics (medium)
- **Status on `feat/operai-ui-library`:** Fixed, with one documented exception. Record lists are the library `DataTable` (admin's users, roles, departments, invitations, mileage rates and audit log — the audit log with `renderDetail` for its expandable entries; estimai's health-warning and import-result tables) or `ListRows` (refund, notify, estimai's estimates, inventory's devices). Row hover is the library's. Exception: estimai's activity and summary grids are editing grids (inline inputs, drag to reorder, computed totals), not data tables.
- **Evidence:**
  - admin: raw `<table>`. Body `text-[11px]`, headers `text-[9px] font-mono uppercase`, no `<caption>`, no scroll region (`admin-ui/src/pages/UsersPage.tsx:617-640`). The same pattern repeats in Roles, Departments, Invitations, Audit and MileageRates.
  - inventory: a shared `DataTable`. Body `text-sm` (14px), headers 11px, `<caption>`, row header `<th scope=row>`, focusable `role=region` scroll wrapper (`inventory-ui/src/components/DataTable.tsx:45-89`, `CELL` at `:56`).
  - estimai: `<table>` with `text-xs` body, 9px headers on `bg-ink-mid`, `tableLayout: fixed` (`estimai-ui/src/components/SummaryTable.tsx:38,143`).
  - refund: no tables. Lists are stacks of bordered card links (`refund-ui/src/pages/MyRequestsPage.tsx:128-140`).
  - notify: a `<ul>` of bordered rows (`NotificationCenterPage.tsx:199`).
  - Row hover differs: refund/notify `hover:opacity-90`, admin/inventory none.
  - No app implements sorting. `inventory-ui/src/components/DataTable.tsx:23` says so explicitly.
- **Recommendation.** One library `DataTable` (inventory's is the most complete) plus a `ListRow`.

### INC-15: Pagination versus "Load more" (low/medium)
- **Status on `feat/operai-ui-library`:** Fixed. Paging follows the API: library `Pagination` for offset endpoints with a total (admin users, invitations, audit), library `LoadMore` for cursor endpoints (inventory assets). Lists bounded by the person (their requests, estimates, notifications) do not page.
- **Evidence:**
  - admin: numbered Previous/Next `Pagination` with one-off buttons (`admin-ui/src/components/Pagination.tsx:64-89`; used at `UsersPage.tsx:714`, `InvitationsPage.tsx:563`, `AuditPage.tsx:311`).
  - inventory: cursor "Load more" with `btn-secondary` (`inventory-ui/src/components/LoadMore.tsx:48-62`, used at `AssetsPage.tsx:447`).
  - refund, estimai and notify render unbounded lists.
- **Recommendation.** Decide one paging pattern per data shape; put both in the library sharing button styles.

---

## 5. Forms

### INC-16: Required markers and validation display differ (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Every form control is in a library `Field` (or `RadioGroupField`): `*` + `aria-required` on required fields, no "(required)"/"(optional)" text, errors under the control with `aria-invalid`, validation on blur and submit, focus on the first invalid field (`focusFirstInvalid`) — in admin, inventory, refund and estimai.
- **Evidence:**
  - admin: a red `*` plus sr-only "(required)" and `aria-invalid` with a red border (`admin-ui/src/components/AddRateEntryModal.tsx:170-204`).
  - inventory: the text suffix "(required)"/"(optional)" on every label, `aria-invalid` (31) and `aria-describedby` (54) with a `FieldError` component (`inventory-ui/src/pages/RegisterAssetPage.tsx:134-137,424`).
  - refund: no visible marker (`refund-ui/src/components/ExpenseLineComposer.tsx:166-172`). "Add line" stays disabled until valid, plus a `SubmitValidationSummary`. Zero `aria-invalid` anywhere in refund-ui.
  - estimai: one `aria-invalid` in the whole app.
- **Recommendation.** Library `Field` (label, required/optional, hint, error) with one convention: either "(optional)" on optional fields, or an asterisk plus sr text.

### INC-17: Money and date inputs differ (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Amounts are `MoneyInput` + `parseDecimal` (comma or dot, exact integer minor units; micros for the mileage rate), dates `DateInput`/`DateTimeInput`; no `type="number"` for money anywhere; per-app control skins removed (controls in a `Field` are the form size). Quantities (km, years, efforts) stay numeric inputs.
- **Evidence:**
  - refund amount is `type="number" step="0.01"`, which only accepts a dot in many locales, while refund displays a comma (`refund-ui/src/components/ExpenseLineComposer.tsx:246-249`).
  - inventory price is `type="text" inputMode="decimal"` with a comma-or-dot parser (`inventory-ui/src/pages/RegisterAssetPage.tsx:577-579`, `lib/money.ts:63-82`).
  - admin rate is `type="number" inputMode="decimal"` (`admin-ui/src/components/AddRateEntryModal.tsx:180-181`).
  - Input skin is overridden per app: refund `text-sm px-2.5 py-1.5`, background `var(--ink)` (`ExpenseLineComposer.tsx:254-255`); the base is 12px on `--ink-mid` (committed tokens, line 179). inventory sets the price font to `var(--mono)` explicitly (`RegisterAssetPage.tsx:584`).
- **Recommendation.** Library `MoneyInput` built on inventory's `amountToCents`, and a `DateInput`; stop overriding the base input skin.

---

## 6. Feedback

### INC-18: estimai uses native `confirm()`/`alert()` while every other app uses custom dialogs (high)
- **Status on `feat/operai-ui-library`:** Fixed. estimai's `alert()` calls are Banners (warning with Retry, danger for a bad import) and its `confirm()` is a library `ConfirmDialog`; no native dialog remains in any app.
- **Evidence:**
  - `estimai-ui/src/EstimatorApp.tsx:166` uses `confirm()` to delete a release.
  - `estimai-ui/src/pages/EstimatesPage.tsx:124,142,215` use `alert()` for error messages.
  - The same app already has a custom `ConfirmDeleteModal` (`estimai-ui/src/components/ConfirmDeleteModal.tsx`).
  - The other apps have no native dialogs.
- **Recommendation.** Replace these with the library ConfirmDialog and ErrorBanner/Toast.

### INC-19: Success feedback has four mechanisms, and no remote uses the shell ToastHost (medium)
- **Status on `feat/operai-ui-library`:** Fixed. One rule: feedback on the person's own action appears where they acted (compact success `Banner`, auto-dismissing; or a polite live region when the change is visible; or the destination after navigation); the shell `ToastHost` is reserved for notifications from elsewhere. Every create, save, invite and delete now confirms (admin had none).
- **Evidence:**
  - shell `ToastHost`: fixed top-right, severity border, live region (`shell/src/components/ToastHost.tsx:96,168-184`). It is fed only by SSE notifications. No remote calls `raiseNotification` (`shell/src/lib/notifications.ts:132`).
  - estimai `ToastBanner`: inline, auto-dismiss, Tailwind (`estimai-ui/src/components/ToastBanner.tsx:24-41`).
  - refund `ToastBanner`: inline, auto-dismiss, inline style, `rounded-sm` (`refund-ui/src/components/ToastBanner.tsx:25-50`). This is a near-copy of estimai's with a different style.
  - inventory: a green `<p role="status">` flash (`inventory-ui/src/pages/AssetsPage.tsx:489-491`).
  - admin: no success message after save, invite or delete. Only a persistent `BulkDeleteResultPanel`.
- **Recommendation.** Expose a local `toast()` from shell/session onto ToastHost, or a library Toast; pick one.

### INC-20: Error colour is orange in banners but red in fields (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Orange = a failure the same control retries (`Banner tone="warning"`, `LoadMore`'s error); red = a failed action and field errors (`.form-error`, `.field-error`, `Banner tone="danger"`); text never uses the bare `text-org`/`text-red` (contrast), only the `-text` tokens.
- **Evidence:**
  - Page and banner errors use `--org`, the warning colour: `admin-ui/src/components/ErrorBanner.tsx:16-18`, `refund-ui/src/components/ErrorBanner.tsx:23-25`, `inventory-ui/src/components/ErrorBanner.tsx:34-36`, `notify-ui/src/pages/NotificationCenterPage.tsx:169-171`.
  - Dialog errors are `--org` too (`admin-ui/src/components/ConfirmDeleteModal.tsx:190`, `estimai-ui/src/components/ConfirmDeleteModal.tsx:152`).
  - Field errors use `--red` (`admin-ui/src/components/AddRateEntryModal.tsx:193,204`).
  - The retry button differs: admin, refund and notify use orange-outlined one-offs (`admin-ui/.../ErrorBanner.tsx:28-29`, `notify-ui/...:179-180`), while inventory uses `btn btn-secondary btn-sm` (`inventory-ui/.../ErrorBanner.tsx:53`), as design rule 2 prescribes.
- **Recommendation.** Use a `--red` "error" tone versus an `--org` "warning" tone in a library `Banner` with tones.

### INC-21: Modal implementations differ in role, focus restore and button styling (medium, a11y)
- **Status on `feat/operai-ui-library`:** Fixed. Every modal in every app runs on the library `Dialog` family: alertdialog/dialog roles, aria-modal, full focus trap, focus return, not dismissible while busy, stacking (only the topmost handles the keyboard), and page scroll locked while open.
- **Evidence:**
  - Role: estimai `ConfirmDeleteModal` uses `role="dialog"` (`estimai-ui/src/components/ConfirmDeleteModal.tsx:126`). The admin, refund and inventory copies use `role="alertdialog"` with `aria-describedby` (`admin-ui/...:153`, `refund-ui/...:163`, `inventory-ui/src/components/ConfirmDialog.tsx:136`).
  - Focus restore: only inventory returns focus to the trigger on close (`inventory-ui/src/components/ConfirmDialog.tsx:81`, `FormModal.tsx:86`, `GuardrailDialog.tsx:43`). The admin, refund and estimai copies only trap Tab (`activeElement` checks at `admin-ui/...ConfirmDeleteModal.tsx:127-132`).
  - No `role`/`aria-modal` at all and no focus trap: `estimai-ui/src/components/ShortcutsModal.tsx:41`, `HealthWarningsModal.tsx:50`.
  - shell `AboutModal` has `role="dialog"` but no `aria-modal` and no focus trap (`shell/src/components/AboutModal.tsx:58-61`).
  - No dialog locks body scroll.
  - Dismissal while in flight: inventory blocks Escape and backdrop (`ConfirmDialog.tsx:16`); the others do not document this.
- **Recommendation.** One library `Dialog` primitive (focus trap and restore, Escape, backdrop, aria) with ConfirmDialog, FormDialog and Guardrail built on it.

### INC-22: Loading and empty states vary (low/medium)
- **Status on `feat/operai-ui-library`:** Fixed. Loading = `SkeletonRows` + a polite live line (local skeleton copies are thin adapters or gone); empty = `StatePanel` with a title and a body in every app.
- **Evidence (loading):**
  - Four separate `SkeletonListRows` copies with different content (MD5 differs; 37/52/49/44 lines in estimai, refund, admin, inventory), plus a fifth inline in `notify-ui/src/pages/NotificationCenterPage.tsx:216-233`.
  - The shell route fallback is a spinner (`shell/src/components/RoutePendingFallback.tsx:31`).
- **Evidence (empty states):**
  - refund: `h3 text-base` plus `--muted` body, `py-16` (`MyRequestsPage.tsx:114-120`).
  - notify: `h2 text-lg` plus `--soft` body, `py-16` (`NotificationCenterPage.tsx:188-194`).
  - admin: body text only, `py-10` (`admin-ui/src/pages/RolesPage.tsx:259-260`).
  - inventory: body text only, `py-8` (`inventory-ui/src/pages/AssetsPage.tsx:404,419`).
  - estimai: `h1 text-xl` with a CTA (`EstimatesPage.tsx:273`).
- **Recommendation.** Library `Skeleton` and `EmptyState`.

---

## 7. Status badges

### INC-23: inventory badges are outlined; every other app uses tinted fills; glyph meanings collide (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Every status badge is `StatusBadge`: each app maps its domain statuses to the suite dictionary in one module (draft, pending, active, settled, stored, attention, failed, missing, voided, info), so an icon has one meaning suite-wide; badges are tinted with SVG icons; entity badges have no flag emoji; labels come from the strings modules.
- **Description.** inventory uses a coloured border, the normal text colour and a coloured glyph. Everyone else uses coloured text on a 10% `color-mix` tint. The same glyph also means different things in different apps.
- **Evidence (shape):**
  - `inventory-ui/src/components/AssetStatusBadge.tsx:27-35` (outlined).
  - `refund-ui/src/components/RequestStatusBadge.tsx:25-26`, `BatchStatusBadge.tsx:22-23`, `admin-ui/src/components/InvitationStatusBadge.tsx:20-21`, `SystemBadge.tsx:7-8`, `RateInEffectBadge.tsx:6-7`, `estimai-ui/src/components/AccessLevelBadge.tsx:21-22` (tinted).
- **Evidence (glyph collisions):**
  - `◆` is "paid" (green) in refund (`RequestStatusBadge.tsx:11`, `BatchStatusBadge.tsx:7`) but "in stock" (accent) in inventory (`AssetStatusBadge.tsx:7`).
  - `⏳` is "submitted" in refund and "pending" in admin, both accent.
  - `✕` is "rejected" (red) and "discarded" (muted) in refund, and "error" in notify (`notify-ui/src/lib/severity.ts`).
  - `✎` is "draft" in refund and "editor" in estimai.
  - admin badge labels are hardcoded English (`InvitationStatusBadge.tsx:4-7`).
- **Recommendation.** Library `Badge` with a `tone` and an optional glyph, plus a suite-level status-glyph dictionary.

---

## 8. Copy, i18n and formatting

### INC-24: The string-module policy is applied unevenly (high)
- **Status on `feat/operai-ui-library`:** Fixed. Every app (and the shell) has a strings module with `en` and `it` catalogs exported through `selectStrings`, a parity test (`catalogGaps`) and a no-hardcoded-strings test that scans every `.tsx`. Exempt by design: estimai's template data (user content) and its client exports (English documents).
- **Evidence:**
  - Full `strings` modules: inventory (`inventory-ui/src/strings.ts` plus 20 namespace files; `lib/noHardcodedStrings.test.ts` scans all of `src/`) and refund (`refund-ui/src/strings.ts`).
  - Partial: estimai. `estimai-ui/src/strings.ts:7-14` admits the existing surface inlines English. Its `noHardcodedStrings.test.ts` checks only listed files (e.g. `:66` AccessLevelBadge), although AGENTS.md says estimai "enforces this".
  - None: admin (e.g. `admin-ui/src/components/SectionNav.tsx:13-27`, `ConfirmDeleteModal.tsx:205,225` "Cancel"/"Delete") and notify (`notify-ui/src/pages/NotificationCenterPage.tsx:138,148,182,190`, `lib/severity.ts`).
  - Shell: per-component `COPY` objects (`shell/src/components/UserMenu.tsx:61`, `AccountScreen.tsx:60-80`), while `AboutModal`, `NoAccessScreen` and others are English literals.
- **Recommendation.** Use one strings convention, with a library `createStrings`/`t` helper and a suite-wide lint/test.

### INC-25: Italian appears in only a few screens, so the UI mixes languages (high)
- **Status on `feat/operai-ui-library`:** Fixed. Complete Italian in every tool; the language is resolved once (the shell sets `<html lang>` from the browser's preferred languages before rendering, every remote reads it); the three local detections are gone. refund-api's PDFs remain English (server-side, separate decision).
- **Description.** For an Italian-locale user, the shell user menu, `/account` and admin's address section are Italian, and everything else is English.
- **Evidence:** `navigator.language` IT/EN switching is implemented three separate times:
  - `shell/src/components/UserMenu.tsx:50-63`
  - `shell/src/components/AccountScreen.tsx:72-80`
  - `admin-ui/src/lib/addressCopy.ts:37-42,119-124`
- **Recommendation.** One locale resolver and provider in the library; decide whether to ship IT everywhere or nowhere until it is complete.

### INC-26: Date formats differ, five ways (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Every date goes through the library: `formatDate` (dd.mm.yyyy in both languages), `formatDateTime`, `formatDateLong`, `formatRelative`; no `toLocale*` and no hand-written formatting left.
- **Evidence:**
  - `dd.mm.yyyy` by hand: `refund-ui/src/lib/dates.ts:48-62` and `inventory-ui/src/lib/dates.ts:34-48`, which are byte-identical copies.
  - Browser-locale `toLocaleDateString(undefined, {day:'numeric', month:'short'})` ("12 Mar 2026" or "12/03/2026" depending on browser): `estimai-ui/src/pages/EstimatesPage.tsx:46`, `admin-ui/src/pages/AuditPage.tsx:46`, `MileageRatesPage.tsx:143,155`, `InvitationsPage.tsx:60,63`, `components/AddressSection.tsx:143`.
  - Forced `en-GB` with month names: `notify-ui/src/components/NotificationItem.tsx:84`, `estimai-ui/src/EstimatorApp.tsx:341`, `lib/pdfExport.ts:95`.
  - Default locale: `estimai-ui/src/EstimatorApp.tsx:182`.
  - Relative time ("3h ago") only in notify (`NotificationItem.tsx:~70-81`).
- **Recommendation.** Library `formatDate`/`formatDateTime`/`formatRelative` on `Intl` with the suite locale.

### INC-27: Money and number formatting is duplicated and inconsistent (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Amounts go through `formatMoney`/`formatAmount` (Intl, currency code, language separators, real minus sign, integer cents); rates and other numbers through `formatNumber`; the duplicated helpers are thin wrappers or gone.
- **Evidence:**
  - refund and inventory each hand-roll `formatMoney`/`formatMoneyAmount` (`refund-ui/src/lib/money.ts:53-101`, `inventory-ui/src/lib/money.ts:35-61`).
  - Neither groups thousands (`1234,50 €`), and both use a hyphen for negatives. refund's own delta uses U+2212 (`refund-ui/src/lib/money.ts:149`).
  - The currency maps differ (refund EUR/CHF/USD/GBP at `:34-39`, inventory EUR/CHF at `:24-27`).
  - estimai uses `toLocaleString()` with the browser locale and no currency for AI cost (`estimai-ui/src/components/SummaryTable.tsx:262,320`, `MetricsBar.tsx:40`).
  - admin shows mileage rates without the refund helper.
- **Recommendation.** One library `formatMoney(cents, currency, locale)` via `Intl.NumberFormat`, keeping the integer-cents contract (ADR-0025).

### INC-28: Title Case versus sentence case (low)
- **Status on `feat/operai-ui-library`:** Fixed. Sentence case for headings, labels, tabs, dialog titles and column headers in both languages.
- **Evidence:**
  - estimai headings use Title Case: "Model Parameters" (`ParametersPanel.tsx:73`), "Activity Detail" (`ActivityTable.tsx:909`), "Release Summary" (`SummaryTable.tsx:83`), "By Specialist Profile" (`:335`), "Keyboard Shortcuts" (`ShortcutsModal.tsx:47`), "Health Warnings" (`HealthWarningsModal.tsx:58`), "Model Reference" (`HelpDrawer.tsx:27`).
  - admin "Back to Users" (`UserDetail.tsx:364`).
  - Elsewhere sentence case: "Active users", "Back to assets", "Mark all as read".
- **Recommendation.** Sentence case everywhere, as the design doc already states for buttons.

---

## 9. Accessibility

### INC-29: Remotes render a nested `<main>` inside the shell's `<main>` (medium)
- **Status on `feat/operai-ui-library`:** Fixed. No remote renders a `<main>`; `ToolLayout` and every tool frame use a `<div>`.
- **Description.** ShellLayout says remotes must NOT render their own top-level `<main>`/banner (`shell/src/components/ShellLayout.tsx:46-48`; the shell's `<main>` is at `:132`). Four remotes do.
- **Evidence:**
  - `refund-ui/src/components/RefundShell.tsx:107`
  - `admin-ui/src/components/AdminShell.tsx:37`
  - `inventory-ui/src/components/InventoryShell.tsx:135`
  - `estimai-ui/src/EstimatorApp.tsx:561`
  - notify-ui and shell-owned screens do not.
- **Recommendation.** `ToolLayout` renders a `<div>`/`<section>` and no `<main>`.

### INC-30: Heading hierarchy and focus-on-navigate differ (low/medium)
- **Status on `feat/operai-ui-library`:** Fixed. h1 = tool title (`ToolLayout`; estimai's editor has a visually hidden h1), h2 = page (`PageHeader`), h3 = cards; focus on mount through the library (`focusableHeading`, `StatePanel focusOnMount`, `useFocusOnMount`); estimai's view switch is a real tablist (`Tabs`).
- **Evidence:**
  - refund, admin and inventory: the tool name is `h1` and each page is `h2` (`RefundShell.tsx:58`, `MyRequestsPage.tsx:86`).
  - notify: the page is `h1` (`NotificationCenterPage.tsx:131`).
  - estimai: no `h1` except the empty state (`EstimatesPage.tsx:273`). Its section headings are `h2 text-sm`.
  - Focus moves to the page heading on mount (`tabIndex={-1}`) in refund (11), inventory (13), shell (4), admin (4), notify (3) and estimai (3), applied unevenly.
  - Tab-like controls in estimai are plain `<button>`s with no `aria-pressed`/`aria-selected`/`role=tab` (`estimai-ui/src/EstimatorApp.tsx:447-453`). Tool nav elsewhere uses Router `<Link>` with `aria-current` (`admin-ui/src/components/SectionNav.tsx:49`).
- **Recommendation.** Use the `PageHeader` heading as the h1 inside a tool, or document the h1=tool / h2=page rule; `useFocusOnMount` belongs in the library.

---

## 10. Icons

### INC-31: SVG only in the shell; remotes use Unicode glyphs and emoji (low/medium)
- **Status on `feat/operai-ui-library`:** Fixed. One inline-SVG `Icon` set in the library; every Unicode glyph and emoji used as an icon (×, ←, ✓, ⚠, ▶, 💬, 👁, flags…) is replaced in every app, including the shell's private SVGs.
- **Evidence:**
  - shell has inline SVG icons (`shell/src/components/Sidebar.tsx:87-121`, `Bell.tsx:73`).
  - The remotes use Unicode glyphs and emoji instead.
  - Close buttons use `×` in every app (estimai 63, refund 38, admin 24, inventory 11, shell 4).
  - Flag emoji for entities: `refund-ui/src/components/EntityBadge.tsx:9-10`, `inventory-ui/src/components/EntityBadge.tsx:8-9`.
  - `👁` for viewer (`estimai-ui/src/components/AccessLevelBadge.tsx:8`).
  - `ⓘ✓⚠✕` severity icons (`notify-ui/src/lib/severity.ts`).
  - `⚙⌀⇢` asset status (`inventory-ui/src/components/AssetStatusBadge.tsx:6-11`).
  - Glyph rendering depends on the OS font (flag emoji do not render on Windows).
  - No app uses an icon library.
- **Recommendation.** A small library `Icon` set (inline SVG, `currentColor`), starting with close, back, add, status and entity.

---

## 11. Navigation inside a tool

### INC-32: Underline tabs copied three times; estimai uses filled pill tabs (medium)
- **Status on `feat/operai-ui-library`:** Fixed. Tool sections are `TabNav` links (with an `end` slot), in-page views `Tabs`; every permission check reads `usePermissions()` from `shell/session`: admin's tabs, its user-detail address section and its mileage-rate and settings actions (`adminApi.getMe()` is gone). Inventory keeps its entity-scope endpoint, which permissions cannot provide.
- **Evidence:**
  - refund, admin and inventory share the same underline-tab recipe (`border-b-2`, `--soft` → `--acc`), written three times: `refund-ui/src/components/RefundShell.tsx:64-68` (repeated per link), `admin-ui/src/components/SectionNav.tsx:102-111`, `inventory-ui/src/components/InventoryShell.tsx:43-46`.
  - admin adds a second-level sub-nav with different padding, `py-2` versus `py-3` (`admin-ui/src/components/UsersSubNav.tsx`).
  - estimai's view tabs are a filled `bg-acc text-white` with a top-rounded pill as the active state (`estimai-ui/src/EstimatorApp.tsx:450-453`).
  - Permission-gated tab hiding uses three implementations: `usePermissions()` in refund (`RefundShell.tsx:49-52`), its own `adminApi.getMe()` fetch in admin (`SectionNav.tsx:79-96`), and a scope hook in inventory.
- **Recommendation.** Library `TabNav` (Link-based, `aria-current`), plus one permission hook (`usePermissions` from shell/session).

### INC-33: Cards are used only in inventory (low/medium)
- **Status on `feat/operai-ui-library`:** Fixed. Detail pages are columns of `Card`s with `FactList` for label/value pairs in admin, refund, inventory and estimai; ad-hoc bordered panels and bare h3 sections are gone.
- **Description.** The design doc requires a detail page to be a column of `.card`s. Only inventory follows it.
- **Evidence:**
  - inventory uses `.card` and `card-title` (`inventory-ui/src/pages/AssetDetailPage.tsx:347`, `components/LedgerBlock.tsx:81`, `HistoryTimeline.tsx:166`, `InvoiceFilePanel.tsx:291`).
  - admin detail pages use bare `h3` sections on the page background (`admin-ui/src/pages/UserDetail.tsx:404`).
  - refund uses 17 ad-hoc `rounded-md border` panels (e.g. `refund-ui/src/pages/MyRequestsPage.tsx:138`, `components/ExpenseLineRow.tsx:471`).
- **Recommendation.** Library `Card`/`CardTitle`.

---

## Duplicated components, and where they live now

The audit found these copies across the apps. Each one is now a library
component (the app keeps at most a thin adapter for its copy and test ids).

| Duplicated pattern | Now in `@operai/ui` |
|---|---|
| ConfirmDeleteModal / ConfirmDialog / Approve-Reject-MarkPaid dialogs | `ConfirmDialog`, `Dialog` |
| GuardrailDialog | `NoticeDialog` |
| Form modal shell | `FormDialog`, `Dialog` |
| ErrorBanner / ToastBanner / success flashes | `Banner` |
| SkeletonListRows | `SkeletonRows` |
| PermissionDenied / NotFoundPage / NoAccessScreen / empty states | `StatePanel` |
| Status, entity, currency and access badges | `StatusBadge`, `Badge` |
| Tool shells and their tab navs | `ToolLayout`, `TabNav` (in-page: `Tabs`) |
| DataTable, Pagination, LoadMore | `DataTable`, `Pagination`, `LoadMore` |
| Money and date formatting, money parsing | `formatMoney`/`formatAmount`/`formatDate`…, `parseDecimal`, `MoneyInput`, `DateInput` |
| Locale detection and copy objects | `resolveLocale`, `selectStrings`, `catalogGaps` |
| Combobox (admin, inventory) | `Combobox` |
| estimai's HelpDrawer | `Drawer` |
| MarkPaidDialog (refund) / IrreversibleActionDialog (inventory): checkbox-acknowledged confirm | `ConfirmDialog` with `acknowledgeLabel` and `fields` |
| Checkbox lists (admin invite, user detail, department detail; inventory invoice linking) | `CheckboxGroupField` |
| Shell LogoMenu / UserMenu open-close logic and list | `Menu`, `MenuItem` |
| Success auto-dismiss delay (four apps) | `Banner` `autoDismiss` + `CONFIRMATION_DISMISS_MS` |

A second sweep (decisions D-59 – D-63) compared every same-named component across
the apps: what remains app-side binds the app's copy and e2e test ids to a library
component, or maps domain values (entity, currency) onto `Badge`.

The table below is the original inventory, kept for reference.

### Original inventory

| Component / helper | Copies (paths) | Notes |
|---|---|---|
| ConfirmDeleteModal / ConfirmDialog | `estimai-ui/src/components/ConfirmDeleteModal.tsx`, `refund-ui/src/components/ConfirmDeleteModal.tsx` (+ `ApproveDialog`, `RejectDialog`, `MarkPaidDialog`), `admin-ui/src/components/ConfirmDeleteModal.tsx`, `inventory-ui/src/components/ConfirmDialog.tsx`, `inventory-ui/src/components/IrreversibleActionDialog.tsx` | Different role, focus restore and button styles (INC-09, INC-21) |
| GuardrailDialog | `refund-ui/src/components/GuardrailDialog.tsx`, `admin-ui/src/components/GuardrailDialog.tsx`, `inventory-ui/src/components/GuardrailDialog.tsx` | OK button style differs |
| Form modal shell | `inventory-ui/src/components/FormModal.tsx`; `admin-ui/src/components/{InviteUserModal,CreateRoleModal,CreateDepartmentModal,AddRateEntryModal}.tsx`; `estimai-ui/src/components/{CollaboratorsDialog,ImportOfferModal,ShortcutsModal,HealthWarningsModal}.tsx`; `shell/src/components/AboutModal.tsx` | Base Dialog primitive |
| ErrorBanner | `refund-ui/src/components/ErrorBanner.tsx`, `admin-ui/src/components/ErrorBanner.tsx`, `inventory-ui/src/components/ErrorBanner.tsx`, inline in `notify-ui/src/pages/NotificationCenterPage.tsx:164-184` | Same layout, different retry button |
| ToastBanner / Toast | `estimai-ui/src/components/ToastBanner.tsx`, `refund-ui/src/components/ToastBanner.tsx`, `shell/src/components/ToastHost.tsx` | Unify on one toast channel |
| SkeletonListRows | `estimai-ui`, `refund-ui`, `admin-ui`, `inventory-ui` `src/components/SkeletonListRows.tsx`; inline in `notify-ui/src/pages/NotificationCenterPage.tsx:216` | 5 variants |
| PermissionDenied | `refund-ui`, `admin-ui`, `inventory-ui` `src/components/PermissionDenied.tsx` (+ `shell/src/components/NoAccessScreen.tsx`) | Near-identical markup |
| NotFoundPage | `refund-ui`, `admin-ui`, `notify-ui`, `inventory-ui` `src/pages/NotFoundPage.tsx` | |
| Status badge (base) | `refund-ui/src/components/{RequestStatusBadge,BatchStatusBadge}.tsx`, `inventory-ui/src/components/AssetStatusBadge.tsx`, `admin-ui/src/components/{InvitationStatusBadge,SystemBadge,RateInEffectBadge}.tsx`, `estimai-ui/src/components/AccessLevelBadge.tsx` | One `Badge` with tone and glyph (INC-23) |
| EntityBadge | `refund-ui/src/components/EntityBadge.tsx`, `inventory-ui/src/components/EntityBadge.tsx` | Identical |
| CurrencyBadge | `refund-ui/src/components/CurrencyBadge.tsx`, `inventory-ui/src/components/CurrencyBadge.tsx` | Currency set differs |
| Combobox | `admin-ui/src/components/Combobox.tsx` (278 lines), `inventory-ui/src/components/Combobox.tsx` (263); related `refund-ui/src/components/MotivoSuggestField.tsx` | |
| Tool layout + tab nav | `refund-ui/src/components/RefundShell.tsx`, `admin-ui/src/components/AdminShell.tsx` + `SectionNav.tsx` + `UsersSubNav.tsx`, `inventory-ui/src/components/InventoryShell.tsx` | Also fixes nested `<main>` (INC-29) |
| Table / pagination | `inventory-ui/src/components/DataTable.tsx`, `inventory-ui/src/components/LoadMore.tsx`, `admin-ui/src/components/Pagination.tsx` | |
| Money formatting | `refund-ui/src/lib/money.ts`, `inventory-ui/src/lib/money.ts` (+ `estimai` `toLocaleString`) | INC-27 |
| Date formatting | `refund-ui/src/lib/dates.ts` = `inventory-ui/src/lib/dates.ts` (identical); ad-hoc `formatDate`/`formatTimestamp` in `estimai-ui/src/pages/EstimatesPage.tsx:44`, `admin-ui/src/pages/AuditPage.tsx:44`, `admin-ui/src/pages/MileageRatesPage.tsx:141,153`, `notify-ui/src/components/NotificationItem.tsx:~70-92` | INC-26 |
| Locale resolver / `t()` | `shell/src/components/UserMenu.tsx:50-63`, `shell/src/components/AccountScreen.tsx:72-80`, `admin-ui/src/lib/addressCopy.ts:37-42,119` | INC-25 |
| noHardcodedStrings test | `estimai-ui/src/lib/noHardcodedStrings.test.ts`, `refund-ui/src/lib/noHardcodedStrings.test.ts`, `inventory-ui/src/lib/noHardcodedStrings.test.ts` | Three scopes; share one |
