# Building a page in an Operai tool

The procedure for adding or reworking a screen in any Operai frontend. Follow it
in order; each step names the library piece to use. The rules behind each step
are in [design-system.md](./design-system.md); working examples of every page
type are in Storybook under **Pages** (`mise run ui:storybook`), source in
`operai-ui/src/pages/`.

## 0. Before writing code

- **The app must consume `@operai/ui`.** If `import … from '@operai/ui'` does not
  resolve, wire it first (README § Adopting the library in an app).
- **Look for the component before writing markup.** Read `operai-ui/src/index.ts`
  (the full export list). If a pattern you need is missing and a second app will
  need it, add it to the library with a story and a test in the same change.
  Never copy a component from another app.
- **Copy goes in the app's `strings.ts`** (or the app's strings module). The
  library takes every label, title and aria-label as a prop.
- **Decide the page type**: list, detail, form or table. Each has a skeleton
  below.

## 1. Frame

The tool's root layout (once per tool, not per page) is `ToolLayout` with a
`TabNav`; pages render inside it through the router's `<Outlet/>`. A page never
renders a `<main>`, an `<h1>`, a header bar or a sidebar — the shell and
`ToolLayout` own them.

```tsx
<section aria-labelledby="refund-my-requests-heading" data-testid="refund-my-requests-page">
  <PageHeader title={t.heading} titleId="refund-my-requests-heading" actions={…} />
  {/* exactly one state, step 2 */}
</section>
```

- Pick the tool's column once, on `ToolLayout`: `default` (80rem) for lists and
  detail pages, `narrow` for a single form, `wide` for a data-dense workspace.
- `PageHeader` first: title (h2), `status` badge beside it, `back` on every detail
  page (`<Link className="link"><Icon name="arrow-left" /> {t.back}</Link>`),
  optional `description`, `actions` with at most one primary.
- Labels: sentence case, verb first, no glyph prefixes ("New request", not
  "+ New request"). Sizes from the type scale only (`text-2xs` … `text-2xl`).
- Copy in the strings module, English and Italian (`selectStrings`); dates and
  amounts through the library formatters; statuses through `StatusBadge`; icons
  through `Icon`, never a Unicode glyph or emoji.
- A primary action that navigates is `<Link className={buttonClassName({ variant: 'primary' })}>`.

## 2. States

Render exactly one of these, in this order of checks:

| Data state | Render |
|---|---|
| 403 | the app's `PermissionDenied` (`StatePanel role="alert" focusOnMount`) |
| loading | `<VisuallyHidden live>{t.loading}</VisuallyHidden>` + `<SkeletonRows />` |
| failed | `<Banner tone="warning" onRetry={retry} retryLabel={…}>{problem.detail}</Banner>` |
| empty | `<StatePanel title={t.empty.heading}>{t.empty.body}</StatePanel>` |
| loaded | the content, step 3 |

A 503 from an authorization-enforcing API (ADR 20260716-refund-api-authorization-enforcing-resource-server) is the same `Banner` with
`title` = "Authorization service unavailable".

## 3. Content by page type

**List** — each row opens a record:

```tsx
<ListRows testId="my-requests-list">
  {items.map((item) => (
    <Link key={item.id} to="/requests/$id" params={{ id: item.id }} className={listRowClassName}>
      <span className="flex items-center gap-3">
        <RequestStatusBadge status={item.status} />
        <span className={listRowMetaClassName}>{t.row.updated(formatDate(item.updatedAt))}</span>
      </span>
      <span className="font-mono text-sm">{formatMoney(item.total)}</span>
    </Link>
  ))}
</ListRows>
```

**Table** — rows with comparable columns: `DataTable` with a caption, the row's
name as `rowHeader` (a `.link` when it opens the record), amounts as `numeric`.
Filters go in a `Card` above it.

**Detail** — a column of `Card`s, one per subject: summary (`FactList`), lines
(`DataTable`), attachments, history. Page actions (Submit, Delete) in the
`PageHeader`; a card's own action (Add line) in the card's `action`.

**Form** — a short form (≤ 5 fields) or a decision goes in a `FormDialog` over
the page that triggered it; a long form is a page with `Card` sections. Every
control is wrapped in `Field`; submit right, Cancel (`ghost`) left of it.

## 4. Actions and confirmations

- Choose the button variant by meaning (design-system.md § Buttons).
- Destructive or irreversible → `ConfirmDialog` (`tone="danger"`); a positive but
  consequential decision → `ConfirmDialog tone="primary"` (or a `FormDialog` if
  it needs input); a blocked action → `NoticeDialog`. Never `window.confirm`.
- While a request runs: the button is `busy`, the dialog is not dismissible, the
  error comes back inline and the dialog stays open.
- After success: navigate, or update in place and confirm with a
  `Banner tone="success"` (compact, auto-dismiss) or a polite live region.

## 5. Status and figures

- Statuses through ONE badge component per domain, mapping value → `tone` +
  `glyph` + label (`Badge`). Entity and currency badges are `neutral`.
- Money is integer minor units from the API, formatted once in the app's money
  helper, shown in `font-mono`. Dates are formatted for display only.
- Numbers shown to the user are rounded.

## 6. Accessibility

- One h2 per page (the `PageHeader`), h3 for cards; never skip a level.
- Every icon-only button has an `aria-label`; every glyph is `aria-hidden`.
- A state that replaces the page (denied, not found) takes focus.
- Run the page's Storybook story (if you added one) with the Accessibility panel,
  and check both themes.

## 7. Tests and done

- Test behaviour, not styling: roles, accessible names, focus, the text shown in
  each state, the calls made. Do not assert inline colours or generated ids.
- Keep `data-testid`s that e2e uses (`shell/e2e/`); add new ones with the page's
  prefix (`refund-…`).
- `pnpm lint`, `pnpm build` (type-check) and `pnpm test` in the app. A library
  change also runs `pnpm typecheck`, `pnpm test` and `pnpm build-storybook` in
  `operai-ui/`, and the shell's `pnpm build`.
- Record a changeset for every app touched, `@operai/ui` included when the
  library changed.
