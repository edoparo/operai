# @operai/ui

The Operai design system: design tokens and themes, the component classes, the
React components built on them, and a Storybook that shows every component and
the suite's page types. Shared by every Operai frontend (ADR-0050).

| What | Where |
|---|---|
| Tokens, themes, fonts, component classes | `src/styles/tokens.css` |
| React components | `src/components/`, exported from `src/index.ts` |
| Token names and roles as data | `src/foundations/tokens.ts` |
| Example pages of a generic tool (list, detail, form, deletion, navigation, states) | `src/pages/` (Storybook § Pages) |
| Rules: what to use when | [`docs/design-system.md`](docs/design-system.md) |
| Procedure for building a page | [`docs/building-pages.md`](docs/building-pages.md) |
| Why it is built this way | [`docs/decisions.md`](docs/decisions.md), `docs/adr/0050-…` |

## Components

- **Layout:** `ToolLayout`, `TabNav`, `Tabs` (+ `tabPanelProps`), `PageHeader`, `Card`, `FactList`
- **Actions:** `Button` / `buttonClassName`, `Menu` / `MenuItem`, `Icon`
- **Dialogs:** `Dialog` (+ `useDialogBehavior`), `ConfirmDialog`, `FormDialog`, `NoticeDialog`, `Drawer`
- **Forms:** `Field`, `RadioGroupField`, `CheckboxGroupField`, `focusFirstInvalid`, `Combobox`, `MoneyInput` (+ `parseDecimal`), `DateInput`, `DateTimeInput`
- **Data:** `DataTable`, `ListRows`, `Pagination`, `LoadMore`, `Badge`, `StatusBadge` (+ `STATUS`)
- **Feedback:** `Banner` (+ `CONFIRMATION_DISMISS_MS`), `StatePanel`, `Skeleton` / `SkeletonRows`, `Spinner`, `VisuallyHidden`
- **Language and format:** `selectStrings`, `catalogGaps`, `resolveLocale`, `formatDate`, `formatDateTime`,
  `formatDateLong`, `formatRelative`, `formatMoney`, `formatAmount`, `formatNumber`
- **Helpers:** `useFocusOnMount`, `cx`

Every component takes its user-visible copy as props; the library has no strings.
Components render only the classes defined in `tokens.css` (no Tailwind
utilities, no inline colours), so they look the same in every build.

## Working on the library

```bash
mise run ui:storybook   # Storybook on http://localhost:6006 (installs first)
cd operai-ui
pnpm typecheck && pnpm lint && pnpm test
pnpm build-storybook    # static build, what CI would publish
mise run ui:check       # the library + every consumer (shell, refund-ui): run before merging
```

Storybook has a _Theme_ toolbar (dark/light) and runs the accessibility checks on
every story. A new component comes with a story and a test.

The library is never built or published: there is no `dist`. `node_modules`
here serves Storybook and the tests only.

## Adopting the library in an app

The library is compiled from source by the app that uses it (ADR-0050). In the
app directory:

1. **`vite.config.ts`** — alias the package and keep one React:

   ```ts
   const operaiUiEntry = fileURLToPath(new URL('../operai-ui/src/index.ts', import.meta.url))
   export default defineConfig({
     resolve: {
       alias: { '@operai/ui': operaiUiEntry },
       dedupe: ['react', 'react-dom'],
     },
     // …
   })
   ```

2. **`vitest.config.ts`** — the same alias and `dedupe` under `resolve`.
3. **`tsconfig.app.json`** — `compilerOptions.paths`:

   ```json
   "paths": {
     "@operai/ui": ["../operai-ui/src/index.ts"],
     "react": ["./node_modules/@types/react"],
     "react/*": ["./node_modules/@types/react/*"],
     "react-dom": ["./node_modules/@types/react-dom"],
     "react-dom/*": ["./node_modules/@types/react-dom/*"]
   }
   ```

   The `react` entries make the library's files type-check against the app's
   React types; on Vercel `operai-ui/node_modules` does not exist.
4. **CSS** — nothing for a remote: the classes arrive with `shell/tokens.css`,
   which the remote already imports, and the shell's Tailwind already scans
   `operai-ui/src`. For the remote's standalone build, add
   `@source "../../operai-ui/src";` to its `src/index.css`.
5. **Test ids and copy** — wrap library components in the app's own small
   adapters where the app needs fixed copy or `data-testid`s (refund-ui's
   `ErrorBanner`, `ConfirmDeleteModal`, `RequestStatusBadge` are the model).
   Keep every `data-testid` the e2e suite in `shell/e2e/` uses; the dialogs take
   `backdropTestId` for that.
6. **Changeset** — select `@operai/ui` and the app when a change touches both.

## Versioning

`@operai/ui` is a Changesets package like the apps (`lerna.json`). Because apps
compile it from source, its version records what changed; it does not pin what an
app gets — an app always builds against the library at the same commit.
