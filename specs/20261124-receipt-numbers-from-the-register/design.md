---
spec: 20261124
status: draft
---

# Design: Receipt codes in Refund Settings (US-4) and three-letter receipt numbers on existing screens

`status: draft` is deliberate: design files are not gated in this repository (most earlier features' `design.md` stay `draft`), and plan.md § "Design sync (2026-11-24)" governs where the two differ; this file was aligned with DS-8 on 2026-11-24.

Designed unattended on 2026-11-24 from `spec.md` (approved) and `plan.md` (§ "UI surface", § "Prefixes and receipt codes (D8)", § "API contracts"), plus a static read of `refund-ui/src`
(`ExpenseTypeDefaultsCard`, `DefaultClassificationDialog`, `ChangeHistoryDrawer`, `SettingsPage`, `RefundShell`, `ReceiptNumber`, `strings.ts`) and of
`specs/20261118-refund-accounting-export/design.md` (format and accessibility conventions). The app was not run, no browser was started and the visual companion was not
enabled, so there are no mockups: layouts are words and small text wireframes. The product already has a design system, so there is **no Visual direction section**; no token is added.

Only US-4 has a UI. US-1, US-2, US-3 and US-5 are release-script behaviour (CLI, report, runbook) and have no screen. Decisions are numbered `RC-n`.

Stack in use: React + Vite, `@operai/ui` (own library, consumed as source) with Tailwind tokens, as in `ExpenseTypeDefaultsCard` (`refund-ui/src/components/settings/`).

## Decisions

| # | Decision | Why | Cost to change |
|---|---|---|---|
| RC-1 | "Receipt codes" is a **third same-page view** of Settings (`?section=receipt-codes`), mounted only while open, in `SettingsPage`'s existing `Tabs`. | The page already has General and Default classification as tabs (UX-1/UX-16 of the earlier designs). A card under Default classification would show it to holders of `settings:read` who cannot use it, and a user with only the new capability would still see an unrelated tab. | Low |
| RC-2 | Section availability is computed per section: `general` needs `rate:read` or `settings:read`; `defaults` needs `settings:read`; `receipt-codes` needs `receipt-code:manage`. If the user holds none of the three, `general` stays (today's behaviour: its cards handle a 403). With **one** section there is no tab list. | Plan table for `SettingsPage`. A holder of only `receipt-code:manage` sees a page that is exactly the Receipt codes card, not a General view full of 403s. A section the user cannot open is **left out**, never disabled (design-system rule, UX-9 of 20261118). | Low |
| RC-3 | The section has **no read-only mode**: without `receipt-code:manage` it does not exist. A 403 that arrives anyway shows `PermissionDenied` in place of the card (not `null`). | AC-4.9 gates reading too. The existing card returns `null` on 403 because other cards remain beside it; here the card can be the whole page, and a blank page is the worst state. | Low |
| RC-4 | **Set / Change** is a `FormDialog` per employee with one text field. **Clear** is a **row action of its own** (only when a code is set) that opens a `ConfirmDialog`. Clear is **not** a secondary button inside the Set/Change dialog. | The plan puts Clear "as a secondary action with a confirmation" inside the dialog. That is a dialog opened from a dialog (`NestedDialogs` is supported, but focus return and Escape get two layers) for an action used rarely. A row action keeps one layer, gives Clear its own accessible name ("Clear the receipt code of Anna Rossi"), and matches Deactivate (UX-3 of 20261118). Plan wording to update (Gap G3). | Low |
| RC-5 | The code field has **no `maxLength`**, uppercases ASCII letters as typed (a-z only), and validates on submit and on blur. | The plan says `maxLength 3`. A silent truncation turns a pasted `ABCD` into `ABC`, which is a valid, wrong code that then saves. With no cap the user sees `ABCD` and the 2-3 letters message. Uppercasing only `[a-z]` keeps `ß` and `À` visibly invalid (the server refuses them before upper-casing, plan D8) instead of the browser turning `ß` into `SS`. | Low |
| RC-6 | Save is disabled while the field is empty or equals the saved code. A shape error is a **field error on submit**, no request sent. An empty field never clears: Clear is its own action (RC-4). | Same rule as `DefaultClassificationDialog` (disabled until something differs). Removing "empty clears" from the dialog avoids an accidental clear by deleting the text and pressing Enter. The API still accepts it (AC-4.2). | Low |
| RC-7 | The 409 `receipt_code_in_use` message is one sentence for both causes and **names nobody and says nothing about which cause**: "This code is already in use. Choose another." | AC-4.3. Saying "another employee holds it" vs "numbers were issued with it" would tell the accountant more about who has what than the spec allows. | Low |
| RC-8 | The "Shares prefix" mark is a **badge with a glyph and text** (`StatusBadge`, meaning `attention`), shown whenever `sharesPrefix` is true, **with or without a code** (changed 2026-11-24, DS-8: a code equal to a codeless colleague's initials is a shared prefix caused by the code, flagged on both rows); plus **one static note** above the table with the count of flagged rows. No name of the other employee anywhere. | D13 of the plan (the post-release fallback: not refused at approval, flagged in the list only). Colour is never the only signal. A count lets accounting see the size of the work before scanning rows. The plan's "decision 10" is D13 (Gap G1). | Low |
| RC-9 | History opens in the existing **`ChangeHistoryDrawer`**, fetched **when opened**, with a loading and an error state inside the drawer. | The history route is per employee (`GET .../{userId}/history`), not embedded in the list as the defaults history is. The drawer today has no loading or error state, so it gains two optional props (Component inventory, Gap G4). | Low-medium |
| RC-10 | Rows are in the API's order (name, then user id). **No search, no paging, no client sort.** | The API does not page; the number of employees of the tool is the company's, tens to low hundreds. A filter would be scope no AC asks for. If the list outgrows a screen, `DataTable` already scrolls in its own region. Reported as Gap G5. | Medium |
| RC-11 | The numbers elsewhere (review line, batch rows, PDF, journal) are **shown as issued**, nothing is redesigned; only widths are checked (§ Issued numbers elsewhere). | AC-4.8. | None |

## Flows

F = flow. Each names its story and acceptance criteria.

**F1 — Accounting opens Receipt codes** (US-4: AC-4.9)
1. Entry: the Settings entry in the top navigation (shown to a holder of `rate:read`, `settings:read` **or** `receipt-code:manage`), then, if more than one section is available, the tab **Receipt codes**; or a deep link `/settings?section=receipt-codes`.
2. The card loads (skeleton, one polite announcement), then the table.
3. Exits: 403 `forbidden` -> `PermissionDenied` (S1). Network or 5xx -> `ErrorBanner` with Retry. Empty list -> `StatePanel`.
4. A user without the capability has no entry and no tab; a deep link falls back to the first available section (no error), as `?section=` does today.

**F2 — Set or change a code** (US-4: AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.5, AC-4.6)
1. In the employee's row, **Set code** (no code yet) or **Change** (code set) opens the dialog (S3), field empty or holding the current code, focus in the field.
2. The user types 2 or 3 letters; ASCII lower case turns to capitals as typed.
3. **Save**:
   - Shape wrong (not 2-3 letters A-Z after trimming, e.g. `A`, `ABCD`, `A1`, `ÀB`, `A B`) -> field error, focus stays on the field, nothing sent (AC-4.2).
   - 200 -> dialog closes, the row updates in place (code, prefix in use, status), a success banner says what was saved, focus returns to the button that opened the dialog.
   - 422 `receipt_code_invalid` (the server disagrees with the client, e.g. a rule changed) -> the same field error text, focus on the field.
   - 409 `receipt_code_in_use` -> field error (RC-7), focus on the field, typed value kept, nothing saved (AC-4.3). Two people racing for one code: exactly one gets 200, the other gets this error.
   - 404 `employee_not_found` -> dialog error "This employee is no longer listed", the list reloads when the dialog is closed.
   - 403 -> dialog error "You don't have permission to do this."
   - Network or 5xx -> dialog error "Could not save. Try again.", value kept.
4. The dialog description says what a code does: it applies to **new** numbers from now on, the sequence continues, numbers already issued do not change (AC-4.4, AC-4.5, AC-4.6).

**F3 — Clear a code** (US-4: AC-4.6, AC-4.7)
1. **Clear** (visible only when a code is set) opens a `ConfirmDialog` (`tone="primary"`: reversible, the code can be set again, and the change is in the history).
2. Body states the consequence: new numbers use the initials again (shown), the sequence continues, issued numbers do not change.
3. Confirm -> 200 `{code: null}`; the row shows the initials as prefix and "Set code"; success banner; focus goes to the row header (the Clear button no longer exists), through `DataTable`'s `focusRowKey`.
4. Exits: error inside the dialog (403, 404, network), as F2.

**F4 — Read the history of one employee** (US-4: AC-4.7)
1. **History** opens the drawer (S4), loading, then newest-first rows: when, by, before, after.
2. Exits: error with Retry inside the drawer; empty ("No changes recorded yet."). Close or Escape returns focus to the History button.

**F5 — Spot employees that share a prefix** (US-4: AC-4.3, AC-4.11 after the release; plan D13)
1. The note above the table says "N employees share a prefix with another employee" (hidden at 0) (changed 2026-11-24, DS-8).
2. Each such row carries the "Shares prefix" badge, with or without a code (changed 2026-11-24, DS-8). The remedy is a code for the codeless employee (**Set code**) or another code for the coded one (**Change**); a code is unique (AC-4.3).
3. Nothing blocks approval for them after the release (D13): the list is the only place they show, which is why the count is stated.

### Acceptance criteria with no UI surface of their own

- AC-4.1 saves "for an employee known to Refund (at least one request)": the list holds exactly those, so there is no "add employee" control and no free-text employee field.
- AC-4.4 to AC-4.6, AC-4.10, AC-4.12: behaviour of numbering and of the release. The UI only **says** it (dialog description, confirm body) and shows the result in "Last number" after a later reload.
- AC-4.7 audit trail: surfaced as the history drawer (F4); the audit-log read is not a UI.
- AC-4.11 dry-run listing: script output, no screen. The Settings flag (F5) is the post-release counterpart, not the AC.
- AC-4.8 "every screen shows it as issued": nothing to build, see § Issued numbers elsewhere.

### UI in the plan that no acceptance criterion asks for (reported, not designed)

- The **"Shares prefix"** badge and count (plan D13) is not required by an AC ("no AC asks for a review flag"); the plan chose the Settings list as its only place. Designed because the plan specifies it and it is small. If scope must shrink, drop it (RC-8) without touching anything else.
- **"Last changed"** column: asked for by the caller and useful, but the list API of the plan does not return it (Gap G2). Designed as conditional on that field.

## Screens & states

For every screen exactly one state shows at a time. The Receipt codes card announces loading once through a polite `VisuallyHidden` line.

### S1 — Settings shell (existing page, changed)

`PageHeader` -> `Tabs` (when more than one section) -> the open section.

| State | Behaviour |
|---|---|
| Holder of `receipt-code:manage` plus other Settings capabilities | Tabs: General (if `rate:read` or `settings:read`), Default classification (if `settings:read`), **Receipt codes**. |
| Holder of **only** `receipt-code:manage` | One section, no tab list, the page is the Receipt codes card. The description under the title is `descriptionReceiptCodes`. |
| `?section=receipt-codes` without the capability, or unknown | First available section, no error. |
| Capabilities not resolved yet | Fail closed: today's behaviour (General for an instant for an unresolved session, then the switch). For a holder of only the new capability the General view could flash 403 cards; see Gap G6. |
| Navigation entry (`RefundShell`) | The Settings link shows with `rate:read`, `settings:read` or `receipt-code:manage`. |

### S2 — Card "Receipt codes" (`ReceiptCodesCard`)

Wireframe (desktop; the table scrolls inside its focusable region when narrower):

```
Receipt codes
A code replaces the initials in new receipt numbers. Numbers already issued never change.
[note] 2 employees share a prefix with another employee.      (changed 2026-11-24, DS-8: was "...and have no code")
[success banner, dismissible]
Employee            Code  Prefix in use   Last number   Last changed   Status          Actions
Anna Rossi          ARO   ARO             ARO26/039     24 Nov 2026    -               [Change] [Clear] [History]
 anna.rossi@...
Luca Conti          None  LC (initials)   LC26/012      Not set yet    [!] Shares prefix  [Set code] [History]
```

Columns: **Employee** (row header: name, else email; the email on a second soft line **when a name exists**, so two people with the same name or initials can be told apart), **Code** (mono, or "None" in soft text), **Prefix in use** (mono; with a code just the code; without, the initials followed by "from initials" in soft text), **Last number** (mono, as issued, or "No number yet" in soft text), **Last changed** (date and `by` email, or "Not set yet"; conditional on Gap G2), **Status** (badge or empty), **Actions**.

Derived initials are visible exactly when they are the prefix (no code). When a code is set the dialog and the Clear confirmation state what the initials are, so the table does not carry a column of letters that do not apply.

| State | Behaviour |
|---|---|
| Loading | `SkeletonRows` (5), polite line "Loading the receipt codes...". |
| Error | `ErrorBanner` "Could not load the receipt codes." with Retry (existing component). |
| 403 | `PermissionDenied` in place of the card (RC-3). |
| Empty | `StatePanel` (heading level h4): "No employees yet" and "An employee appears here after their first request." No actions. |
| Loaded | Note (only when count > 0), table. |
| Row with a code | Actions: **Change**, **Clear**, **History**. |
| Row without a code | Actions: **Set code**, **History**. Badge **Shares prefix** when `sharesPrefix`. |
| Row with `sharesPrefix` and a code | Badge **Shares prefix** too (changed 2026-11-24, DS-8: the code equals a codeless colleague's initials; the remedy is a code for the colleague, or another code here). Actions as any row with a code. |
| After a save or clear | The row is replaced from the 200 body (`resource.replace`), the count note recomputed, a `SuccessBanner` says what happened. |

Prefix of the saved state comes from the API (`prefix`, `prefixSource`); the UI never derives initials itself.

### S3 — Dialog "Receipt code" (`ReceiptCodeDialog`, `FormDialog`, `size="sm"`)

Mounted **beside** the card, never inside a `<form>` (ADR 20261118-a-dialog-that-renders-its-own-form-is-mounted-beside-the-form-never-inside-it); the card has no form around it.

```
Receipt code - Luca Conti
New numbers use this code instead of the initials (LC). The sequence continues; numbers already issued do not change.
Code *
[ LCX         ]   Two or three letters, A to Z.
[Cancel] [Save]
```

- Title: employee name (else email). Description: the sentence above, with the employee's derived initials in it.
- Field `Code`, required, mono, `autocomplete="off"`, `autocapitalize="characters"`, `spellcheck=false`, hint "Two or three letters, A to Z." (real hint, in `aria-describedby`).
- **Save** disabled while the field is empty or equal to the saved code (after trimming and capitalising); busy label "Saving...".
- Errors: shape (client and 422) and in-use (409) are **field errors** (`errorRole="alert"`), focus moved to the field; 403, 404 and network are the dialog's `error`.
- Focus lands in the field on open (library behaviour for `FormDialog`'s first control; verified in the browser pass: the field is focused).

| State | Behaviour |
|---|---|
| Open, unchanged | Save disabled. |
| Typing | Capitalises a-z; no error text appears until blur or submit. |
| Submit, bad shape | Field error "A code is two or three letters, A to Z.", focus in the field, no request. |
| Busy | Fieldset disabled by `FormDialog`; label "Saving..."; Escape and the close button are inert (as other dialogs). |
| 409 | Field error, value kept, focus in the field; typing clears the error. |
| 404 | Dialog error, Save stays disabled; Cancel closes and the list reloads. |

### S3b — Confirmation "Clear the receipt code" (`ConfirmDialog`, `tone="primary"`)

Title "Clear the code of Luca Conti"; body "New numbers will use the initials (LC) again. The sequence continues and numbers already issued do not change."; confirm **Clear code**, cancel **Cancel**; busy "Clearing...". Errors inside the dialog as F2. Mounted beside the card.

### S4 — History drawer (`ChangeHistoryDrawer`, existing, with loading and error states added)

Title "History - Luca Conti". Columns: **When** (`<time dateTime>`), **By** (email), **Before**, **After** (mono; "None" when null, meaning "no code, initials in use"). Newest first.

| State | Behaviour |
|---|---|
| Loading | The drawer opens at once with `SkeletonRows` and a polite line "Loading the history...". |
| Error | Inside the drawer `ErrorBanner` with Retry. |
| Empty | "No changes recorded yet." (existing key). Normal for an employee who never had a code. |
| Loaded | Table; the caller maps the API's newest-first to the drawer's oldest-first input (the drawer reverses; Gap G4). |

### S5 — Success banner (existing `SuccessBanner`)

Polite status line: "Receipt code for Luca Conti is now LCX." / "Receipt code for Luca Conti cleared. New numbers use LC." Dismissible, replaced by the next one.

## Component inventory

Library in use: **`@operai/ui`** (own library consumed as source, per `refund-ui/src/components/settings/*` imports and `docs/design-system.md`) with Tailwind token classes; no Mantine, no MUI.

| Element | Reuse | Note |
|---|---|---|
| Section tab | `Tabs`, `tabPanelProps` in `SettingsPage` (`refund-ui/src/pages/SettingsPage.tsx`) | One more id in `SETTINGS_SECTIONS`; availability becomes per section (RC-2). |
| Page / card | `PageHeader`, `Card` | As `ExpenseTypeDefaultsCard`. |
| Table | `DataTable` (caption, row header, `focusRowKey`) | |
| Load state | `SkeletonRows`, `VisuallyHidden live`, `ErrorBanner` (`refund-ui/src/components/ErrorBanner.tsx`), `useLoadedResource` (`src/lib/useLoadedResource.ts`) | Identical to the defaults card. |
| Empty state | `StatePanel` (`@operai/ui`) | As the rates card does. |
| 403 | `PermissionDenied` (`src/components/PermissionDenied.tsx`) | |
| Count note | `Banner tone="warning" live="off"` with an `aria-label` | As `needsChoice` of the defaults card. |
| Shares-prefix badge | `StatusBadge status="attention"` | New entry **not** needed: `statusMeaning.ts` already maps `attention`. |
| Set/change dialog | `FormDialog`, `Field`, text input | |
| Clear confirmation | `ConfirmDialog` | |
| History | `ChangeHistoryDrawer` (`src/components/ChangeHistoryDrawer.tsx`), `formatDateTime` | **Extended**, below. |
| Success | `SuccessBanner` (`src/components/SuccessBanner.tsx`) | |
| Navigation entry | `RefundShell` (`src/components/RefundShell.tsx`) | One more `||` in `canSeeSettings`. |
| Receipt number | `ReceiptNumber` (`src/components/ReceiptNumber.tsx`) | Unchanged; shows the string as issued. |

NEW (all in refund-ui):

| New | Why nothing fits |
|---|---|
| `ReceiptCodesCard.tsx`, `ReceiptCodeDialog.tsx`, `ReceiptCodesSettingsView.tsx`, `receiptCodesApi.ts` | The feature itself; patterns copied from the defaults card and dialog. |
| `ChangeHistoryDrawer` optional props `loading?: boolean`, `error?: { message; onRetry }` (existing component extended, not a new one) | The drawer takes ready rows today (the defaults history is embedded in the list). Receipt-code history is fetched on open. Also needs its value-column header strings to come from the caller (it already takes `valueColumns` with their own headers). |
| Capability helper `hasCapability(permissions, 'receipt-code', 'manage')` | Already exists in `SettingsPage`; reuse, no new helper. |

Reuse / NEW ratio: 13 reused (counting the extended drawer as reuse) to 4 new files, plus 1 prop extension.

## Copy keys (`refund-ui/src/strings.ts`, `en` and `it: typeof en`)

Convention of the file: sentence case, a sentence with a value is a function, Italian in the impersonal form ("Impossibile...", "Riprovare."). The parity test requires every key in both catalogs. New keys under `settings.receiptCodes`, plus the extras below.

| Key | EN | IT |
|---|---|---|
| `settings.sections.receiptCodes` | Receipt codes | Codici ricevuta |
| `settings.descriptionReceiptCodes` | The codes that start the receipt numbers of each employee. | I codici con cui iniziano i numeri di ricevuta di ogni dipendente. |
| `settings.history.columns.before` | Before | Prima |
| `settings.history.columns.after` | After | Dopo |
| `settings.history.loading` | Loading the history... | Caricamento della cronologia... |
| `settings.history.loadError` | Could not load the history. | Impossibile caricare la cronologia. |
| `receiptCodes.title` | Receipt codes | Codici ricevuta |
| `receiptCodes.description` | A code replaces the initials in new receipt numbers. Numbers already issued never change. | Un codice sostituisce le iniziali nei nuovi numeri di ricevuta. I numeri già emessi non cambiano mai. |
| `receiptCodes.caption` | Receipt codes by employee | Codici ricevuta per dipendente |
| `receiptCodes.loading` | Loading the receipt codes... | Caricamento dei codici ricevuta... |
| `receiptCodes.loadError` | Could not load the receipt codes. | Impossibile caricare i codici ricevuta. |
| `receiptCodes.empty.title` | No employees yet | Ancora nessun dipendente |
| `receiptCodes.empty.body` | An employee appears here after their first request. | Un dipendente compare qui dopo la sua prima richiesta. |
| `receiptCodes.columns.employee` | Employee | Dipendente |
| `receiptCodes.columns.code` | Code | Codice |
| `receiptCodes.columns.prefix` | Prefix in use | Prefisso in uso |
| `receiptCodes.columns.lastNumber` | Last number | Ultimo numero |
| `receiptCodes.columns.changed` | Last changed | Ultima modifica |
| `receiptCodes.columns.status` | Status | Stato |
| `receiptCodes.columns.actions` | Actions | Azioni |
| `receiptCodes.none` | None | Nessuno |
| `receiptCodes.fromInitials` | from initials | dalle iniziali |
| `receiptCodes.noNumberYet` | No number yet | Ancora nessun numero |
| `receiptCodes.notSet` | Not set yet | Mai impostato |
| `receiptCodes.changedBy(by, on)` | `${by} · ${on}` | `${by} · ${on}` |
| `receiptCodes.sharesPrefix` | Shares prefix | Prefisso condiviso |
| `receiptCodes.sharesPrefixHint` | Another employee uses the same letters. Set a code to tell the numbers apart. | Un altro dipendente usa le stesse lettere. Impostare un codice per distinguere i numeri. |
| `receiptCodes.sharesPrefixHintWithCode` *(added 2026-11-24, eval round 2: a flagged row that has a code)* | Another employee uses the same letters. Choose another code, or set a code for the colleague. | Un altro dipendente usa le stesse lettere. Scegliere un altro codice o impostarne uno per il collega. |
| `receiptCodes.shareNote(n)` | n=1: `1 employee shares a prefix with another employee.` n>1: `${n} employees share a prefix with another employee.` (changed 2026-11-24, DS-8) | n=1: `1 dipendente condivide il prefisso con un altro dipendente.` n>1: `${n} dipendenti condividono il prefisso con un altro dipendente.` (changed 2026-11-24, DS-8) |
| `receiptCodes.shareNoteLabel` | Employees sharing a prefix | Dipendenti con prefisso condiviso |
| `receiptCodes.setLabel(name)` *(changed 2026-11-24, live e2e: the name must contain the visible "Set code", WCAG 2.5.3)* | `Set code for ${name}` | `Imposta codice per ${name}` |
| `receiptCodes.changeLabel(name)` | `Change the receipt code of ${name}` | `Modifica il codice ricevuta di ${name}` |
| `receiptCodes.clearLabel(name)` | `Clear the receipt code of ${name}` | `Rimuovi il codice ricevuta di ${name}` |
| `receiptCodes.historyLabel(name)` | `Show the receipt code history of ${name}` | `Mostra la cronologia del codice ricevuta di ${name}` |
| `receiptCodes.set` | Set code | Imposta codice |
| `receiptCodes.change` | Change | Modifica |
| `receiptCodes.clear` | Clear | Rimuovi |
| `receiptCodes.dialog.title(name)` | `Receipt code — ${name}` | `Codice ricevuta — ${name}` |
| `receiptCodes.dialog.description(initials)` | `New numbers use this code instead of the initials (${initials}). The sequence continues. Numbers already issued do not change.` | `I nuovi numeri usano questo codice al posto delle iniziali (${initials}). La sequenza continua. I numeri già emessi non cambiano.` |
| `receiptCodes.dialog.field` | Code | Codice |
| `receiptCodes.dialog.hint` | Two or three letters, A to Z. | Due o tre lettere, da A a Z. |
| `receiptCodes.dialog.save` | Save | Salva |
| `receiptCodes.dialog.busy` | Saving... | Salvataggio... |
| `receiptCodes.clearDialog.title(name)` | `Clear the code of ${name}` | `Rimuovi il codice di ${name}` |
| `receiptCodes.clearDialog.body(initials)` | `New numbers will use the initials (${initials}) again. The sequence continues. Numbers already issued do not change.` | `I nuovi numeri useranno di nuovo le iniziali (${initials}). La sequenza continua. I numeri già emessi non cambiano.` |
| `receiptCodes.clearDialog.confirm` | Clear code | Rimuovi codice |
| `receiptCodes.clearDialog.busy` | Clearing... | Rimozione... |
| `receiptCodes.errors.invalid` (422, client) | A code is two or three letters, A to Z. | Un codice è di due o tre lettere, da A a Z. |
| `receiptCodes.errors.inUse` (409) | This code is already in use. Choose another. | Questo codice è già in uso. Sceglierne un altro. |
| `receiptCodes.errors.notFound` (404) | This employee is no longer listed. Close this window to refresh the list. | Questo dipendente non è più in elenco. Chiudere questa finestra per aggiornare l'elenco. |
| `receiptCodes.saved(name, code)` | `Receipt code for ${name} is now ${code}.` | `Il codice ricevuta di ${name} è ora ${code}.` |
| `receiptCodes.cleared(name, initials)` | `Receipt code for ${name} cleared. New numbers use ${initials}.` | `Codice ricevuta di ${name} rimosso. I nuovi numeri usano ${initials}.` |
| `receiptCodes.unchanged(name)` (200 with no change, rare) | `The receipt code for ${name} was already this.` | `Il codice ricevuta di ${name} era già questo.` |
| Reused as is | `settings.catalog.forbidden`, `settings.catalog.genericError`, `settings.catalog.cancel`, `settings.history.title/description/empty/open/closeLabel`, `components.errorBanner.defaultRetryLabel` | same keys |

The 422 and 409 texts are **local** (keyed by `code`), never the server `detail`: the plan's English details would not be translated. Neither text contains a name or a count.

## Issued numbers elsewhere (AC-4.8, RC-11)

Format is now `<2 or 3 letters><yy>/<seq>`: `LC26/039`, `LCX26/040`. They are text from the API and are shown exactly as issued, in every place below; **nothing is redesigned and no component changes.** Nothing derives a prefix on the client. Width: one more character (8 to 9 for a 3-digit sequence; 10 with a 4-digit one).

| Place | Rendering | Width note |
|---|---|---|
| Review line, request page line (`ReceiptNumber`, `font-mono text-sm`, inline) | Single string, no fixed width. | A mono string of 9 characters; the line row wraps already. Check at 320 px that the row does not overflow with a long name. |
| Batch rows (`BatchEmployeeGroupList`, "Receipts MC26/014, MC26/015" in full, UX-8 of 20261118) | Comma-joined list in a flex-col row that wraps. | A row mixing `LC26/039, LCX26/040` is the case to look at: both prefixes appear in one list, which is correct. |
| Batch PDF (compressed ranges, plan: `compressReceiptNumbers` parses any prefix) | `LC26/039, LCX26/040` stay two entries; a split receipt prints once. | The **receipt-number column width of the PDF table was not read** by this design; it is refund-api's template. QE to check it on a `LCX26/1000` worst case (Gap G7). |
| Journal workbook (Description, `Cancelleria [LCX26/040] <name>`) | Text cell, no column width set by the UI. | None for the UI. |
| Accounting export card, request detail, anywhere a number is listed | As issued, employee name beside it where listed (AC-4.8, already so). | None. |
| This feature's own "Last number" column | Mono, no truncation, `whitespace-nowrap`. | Column sized by content. |

## Accessibility

Conventions of `specs/20261118-refund-accounting-export/design.md` § Accessibility apply; checks below are what is specific here.

**Claim.** Written without running the app (the browser pass was done later: § Browser accessibility pass). Only jsdom axe (`expectNoAxeViolations`, `refund-ui/src/test-support/axe.ts`, with `color-contrast`, `region`, `landmark-one-main`, `page-has-heading-one` off) and the e2e **browser** axe (`axeViolations`, `shell/e2e`) can be claimed once built. No hand contrast, 320 px reflow, focus-order walk or screen-reader result exists for these screens; none is claimed.

**Per screen**

- **Settings tabs and entry (S1).** One tab stop, arrows, Home and End; `tabPanelProps` pairs panel and tab. With one section there is no tablist and the page heading is the h2 (`PageHeader`). The nav `Link` for Settings is named "Settings" whatever the section.
- **Card (S2).** h3 title (card), `StatePanel` heading is h4. `DataTable` supplies caption, `scope` and the focusable scroll region. **Employee** is the row header (`rowHeader: true`). Buttons are named after the employee ("Change the receipt code of Anna Rossi"), because a list of 60 identical "Set code" buttons is unusable by a role list. `aria-haspopup="dialog"` on the buttons that open a dialog or drawer, as in the defaults card.
- **Status and codes.** The badge has a glyph **and** the text "Shares prefix"; it is never colour alone. The badge hint ("Another employee uses the same letters...") is attached by `aria-describedby` to the row's **Set code** button, so a keyboard user hears why, and no tooltip is needed. A code or number in the table is real text; "None" and "No number yet" are text, never an empty cell. Mono strings are plain text (the visually hidden "Receipt number" label is for the line view, not here).
- **Count note.** A static `role="note"`-style `Banner` with `live="off"` and an `aria-label` ("Employees sharing a prefix"), read in place, not announced when the list reloads (as `needsChoice`).
- **Loading and results.** Loading is one polite line. A save or clear success is `role="status"` (`SuccessBanner`); errors are `role="alert"`.
- **Dialog (S3).** `FormDialog`: modal, labelled by the title, described by the description, Tab trapped, Escape and the close button closing except while busy. Field is required (`*` plus `aria-required` of `Field`), the hint and the error are in `aria-describedby`; the field error has `errorRole="alert"` and, after a failed submit, **focus is moved to the field** (a failure must not leave focus on the Save button with an unspoken error). On the 409 the value is kept and selected so the user can overtype. Disabled Save is a real `disabled` button inside the dialog (the library's pattern); the reason is the visible hint, not a hidden one.
- **Focus return.** After a successful Set/Change the dialog closes and focus returns to the button that opened it (it persists, its label may change from Set code to Change; its accessible name still names the employee). After a Clear, the button is gone, so focus goes to the **row header** (`focusRowKey`), as Deactivate does in 20261118. After closing the history drawer, focus returns to the History button.
- **Confirm (S3b).** `ConfirmDialog` with the first control focused as the library does; the confirm button names the action ("Clear code"), not "OK".
- **History drawer (S4).** Focus moves to the heading on open and back on close; Tab trapped; dates are `<time dateTime>`; Before and After use text "None" (not an empty cell, not a dash). Loading is polite, the error is `role="alert"` with a Retry in the drawer; Retry keeps focus on itself until the result arrives.
- **Language.** Every sentence comes from `strings.ts` in both languages; the dialog description interpolates the **employee's initials**, which are letters and need no formatting. Dates through `formatDate` / `formatDateTime`.
- **Contrast and theme.** Only tokens: `text-soft` for secondary text, toned text through the badge and banners. No new colour. Check "Not set yet", "from initials" and the attention badge in **light and dark**.
- **Reflow at 320 px.** Cards stack; the table scrolls in its keyboard-focusable region; the actions cell wraps (`inline-flex flex-wrap gap-2`); the dialog keeps its footer visible.
- **Motion.** Nothing animates beyond the library's drawer and spinner (reduced motion respected there).

**Hotspots**
1. Focus after Clear (the pressed button is removed).
2. Focus and announcement of the 409 and 422 field errors (not left on a disabled or busy control).
3. Capability change mid-session / fail-closed flash for the only-capability user (S1, Gap G6).
4. 60 or more rows, each with 2-3 buttons: names must disambiguate; the scroll region must be focusable.
5. Dialog focus on open: the field is the first control (library behaviour, to verify).

**Tests the tasks should carry** (rigor `production`)
- jsdom axe, each after the state settled: card loaded (with code, without code, shares prefix), loading, error, empty, 403; the dialog (empty, valid, field error 422, field error 409, busy, dialog error); the clear confirmation; the drawer (loading, loaded, empty, error); Settings with one section and with three. All in **en and it**, and in **light and dark** where the harness supports a theme switch.
- Browser axe in e2e at: the card loaded, the open dialog with a 409 error, the open drawer. One theme per run is acceptable; a dark checkpoint is the one worth adding.
- Keyboard-only journeys (QE): open Settings -> Receipt codes; set a code with the keyboard only and land back on the button; trigger and read the 409; clear and land on the row header; open and close the history and land back on its button.
- Behaviour tests: no request on a bad shape; 422/409/404/403/network each shown as specified; Save disabled while empty or equal; a-z uppercased as typed, `ß` and `À` not altered; `sharesPrefix` + code shows the badge too (changed 2026-11-24, DS-8); the count note equals the rows flagged; the other employee is never named.
- Strings parity test (existing) covers en/it; assert `settings.sections.receiptCodes` appears in the tab.
- `RefundShell.test`: a user with only `receipt-code:manage` sees the Settings entry; `SettingsPage.test`: that user gets one section, no tab list.

## Gaps found

Resolved in plan.md § Design sync (2026-11-24): gap Gn is DS-n there (G1–G9 → DS-1–DS-9). Only G8 changed this design (DS-8, edited in place above and marked "changed 2026-11-24, DS-8").

| # | Gap | Where | Proposal |
|---|---|---|---|
| G1 | The brief and some notes call the shared-prefix flag "plan decision 10"; in `plan.md` it is **D13** ("Post-release shared prefix: not refused; flagged in the Settings list only"), and D10 is `--show-emails` removed. | plan § Decisions taken unattended | Wording only; this design follows D13. |
| G2 | The caller asks for the **last change** in the table; the `GET /accounting/receipt-codes` row has no `updatedAt` / `updatedBy`. `receipt_code` stores `updatedAt` and `updatedByEmail`. | plan § API contracts | Add `changedAt: string \| null` and `changedBy: string \| null` (email) to the row, null when no code was ever set or after a clear (clear is a `receipt_code_change` row; its time would be wanted too: use the newest `receipt_code_change`). Without it, drop the column; History still gives it. |
| G3 | The plan puts **Clear** inside the Set/Change dialog; this design makes it a row action with its own `ConfirmDialog` (RC-4). | plan § UI surface | Update the plan sentence, or tell me to nest it. |
| G4 | `ChangeHistoryDrawer` takes `rows` ready (`at`, `byEmail`, **oldest first**); the new API is **newest first** with `changedAt` and `changedBy.email` and is fetched when opened. | plan § API / refund-ui files | The history call maps to `{at, byEmail, before, after}` and **reverses** to oldest-first (the drawer reverses again); extend the drawer with loading and error (RC-9). A task for it is needed; the plan's file table does not list `ChangeHistoryDrawer.tsx`. |
| G5 | No search or paging on a list that grows with every new employee. | plan § API | Accepted for now (RC-10); a name filter is the first thing to add if the list passes about 100 rows. |
| G6 | The plan changes `SettingsPage` so `general` is offered only with `rate:read` or `settings:read`, but "capabilities not resolved yet" is today a fail-closed state in which General shows. For the only-capability user the flash is General cards that 403. | plan § refund-ui | Render nothing (or the skeleton) in the panel until `usePermissions` has resolved, **if** the hook exposes a resolved flag; I did not confirm it does. |
| G7 | The PDF's receipt-number column width and the journal's cell widths are in refund-api and were not read here. | AC-4.8 | QE check with `LCX26/1000` in the batch PDF; no UI work. |
| G8 (resolved: DS-8, badge with or without a code) | `sharesPrefix` is defined for an employee with a code too ("another employee's code/initials/issued prefix equals `prefix`"). A code cannot equal another's code (unique) but can equal another employee's **initials or issued prefix**; the plan's D13 flags "no code" only and AC-4.3 forbids it for other **issued** prefixes, not for another employee's derived initials with no number yet. | plan § API vs § D8 | Confirm the badge rule here (flag only when no code). If a code equal to someone else's derived initials is possible, that case is a shared prefix **caused by** the code and deserves a flag too. |
| G9 | The list shows "Last number" as issued, but a code change does not alter it, so after a change the column still shows the old prefix until the next numbered line. This is correct (AC-4.4) and confusing at a glance. | S2 | The dialog description says so; no extra UI. If accountants ask, add a "Next number will start with" line (derived: prefix + year). |

## Browser accessibility pass (2026-11-24, T32)

Run by the orchestrator on the owner's request against the real stack (shell host + refund-ui remote at `1e28a399`, auth,
refund-api, accounting-api, notify-api on the shared dev Postgres), Chromium through Playwright, as a scripted walk of this
section's checks; screenshots looked at by hand. Results:

| Check | Result |
|---|---|
| Browser axe (wcag2a/aa, contrast on) on the loaded card: light and dark × en-US and it-IT | 0 violations in all four |
| Hotspot 1, focus after Clear | lands on the row header (`th scope="row"`); the success line is `role="status"` ("Receipt code for … cleared. New numbers use EE.") |
| Hotspot 2, 422 and 409 | focus stays on the field, `aria-invalid="true"`, the hint and the error in `aria-describedby`, the error `<p role="alert">`; axe on the dialog with the 409: 0 |
| Hotspot 3, only-capability user | the view on first render, no tablist, no 403 response |
| Hotspot 4, names | every action button is named after the employee ("Set code for …", "Change the receipt code of …", "Show the receipt code history of …"); `aria-describedby` targets resolve; the table is a focusable region named "Receipt codes by employee". Duplicate names appear only for dev-database test users that share a display name; two real employees with the same full name would get identical button names (low, not fixed). |
| Hotspot 5, dialog focus on open | the field is focused |
| Clear confirmation | `alertdialog` named "Clear the code of …", first focus on Cancel, the action button "Clear code" |
| History drawer | focus to the heading on open, back to History on close; table with caption, row headers `<time>`; "None" as text; axe 0; reduced motion emulated: opens and closes |
| Focus visibility | 2 px solid outline (rgb 61 76 224) on the focused control |
| Reflow at 320 px | **fails, suite-wide**: no page-level horizontal scroll and the card's table keeps its focusable scroll region, but the shell's sidebar stays expanded at 320 px, so `main` is 91 px wide (content one word per line, scrolled horizontally inside `main`). The dialog keeps its footer visible at 320 px. This is the shell layout (every tool), not this view: follow-up **A11Y-F1** (shell: collapse the sidebar under a narrow breakpoint), outside this feature. **Fixed by `06998068`** (shell): below 640 px the rail stays icons-only (64 px) and the toggle opens the full rail over the content, with a backdrop, closed by Escape, a backdrop click, navigation or widening; not persisted. Re-measured live at 320 px on `/refund/settings` and `/accounting`: document 320 px, nav 64 px, `main` 251 px, no horizontal scroll; at 1280 px the rail is 224 px and toggles to 64 px as before. |
| Screen reader | not run with a real screen reader; the ARIA snapshots of the dialog, the confirmation, the drawer and a row read as specified (names, roles, described-by). |

Pre-existing, shell-wide (found by a body-scoped axe run after the A11Y-F1 fix, not fixed here): **A11Y-F2**, the shell footer text (`Footer.tsx`, `text-2xs text-muted`, #8888aa on #f0f0f8, 11 px) has a contrast of 3.01:1, below the 4.5:1 of WCAG 1.4.3; five nodes (legal link, company, version, separator, site link) on every page. It dates from specs/003 and the `text-muted` token is shared by the design system, so the fix is a design-system decision, left to the owner. **Fixed 2026-11-24 on the owner's request, in the footer only** (the token is unchanged): the footer uses `text-soft` (5.2:1 light, 5.4:1 dark on `--ink-soft`; `--muted` was 3.0:1 light and 2.8:1 dark) and its links hover to `text-acc-text`; `shell/src/components/Footer.test.tsx` pins it.

Minor, library-wide (not fixed here): the dialogs' close icon is named "Cancel", so a dialog exposes two "Cancel" buttons.

