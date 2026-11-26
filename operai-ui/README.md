# @operai/ui

The Operai design system: design tokens and themes, the component classes, the
React components built on them, and a Storybook that shows every component and
the suite's page types. Shared by every Operai frontend (ADR 20261031-shared-ui-library-consumed-as-source).

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

The library is compiled from source by ONE app, the shell, and shared with every remote as a
Module Federation singleton (ADR 20261031-shared-ui-library-consumed-as-source, amended by
ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell). A remote declares the dependency and never bundles it. In the app
directory:

1. **`package.json`** — `pnpm add -D '@operai/ui@link:../operai-ui'`. The symlink is how the
   federation plugin finds the package: it reads the library's named exports from it at build
   time. Do NOT alias `@operai/ui` in `vite.config.ts`: an alias bypasses Module Federation's
   sharing and the library is bundled again.
   **`vite.config.ts`** — keep one React and declare the share:

   ```ts
   export default defineConfig({
     resolve: { dedupe: ['react', 'react-dom'] },
     plugins: [
       federation({
         // …
         shared: {
           // …react, react-dom, @tanstack/react-router, better-auth
           // a REMOTE: consumed from the shell, never bundled, no fallback
           '@operai/ui': { singleton: true, import: false, requiredVersion: false },
           // the SHELL (the one provider): the same line without `import: false`
         },
       }),
     ],
   })
   ```

   A remote therefore cannot run its standalone `pnpm dev` page with the library: nothing
   provides it outside the shell. Run it through the shell (`mise run dev`).
2. **`vitest.config.ts`** — the tests do not load the federation plugin, so alias `@operai/ui`
   to `../operai-ui/src/index.ts` there, with the same `dedupe` under `resolve`.
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

## Rich text (`@operai/ui/rich-text`)

`RichTextEditor` (WYSIWYG: bold, italic, a heading, bulleted, numbered and check lists; no links; with
`images`, pictures chosen, pasted or dropped, kept in the document as a FILE ID the app resolves, never a URL;
the document is TipTap JSON, rendered only through the editor's schema) needs TipTap, so it ships from its own
entry and the main `@operai/ui` stays dependency-free. The same entry has `RichTextView` (a document as React
elements, read-only, light enough for a list), `RichTextFilesField` / `RichTextFilesView` (text plus attachments,
in a form and read-only), `useDeferredFiles` / `commitDeferredFiles` (files chosen in a form wait for the save)
and the doc helpers (`imageFileIds`, `mapImageFileIds`, `isEmptyRichText`). `AttachmentList` needs no TipTap and
is in the main entry. An app that uses the rich-text entry:

1. installs `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-list`
   and `@tiptap/extensions` (the version this library's devDependencies pin, exactly);
2. compiles this entry ITSELF (the shell does not install TipTap, so it cannot provide it): in
   `vite.config.ts` alias only the rich-text entry, with an exact match, and leave the main entry
   to the share; in `vitest.config.ts` alias both, the longer first (an object alias would make
   `@operai/ui` a prefix of the other):

   ```ts
   // vite.config.ts
   alias: [
     { find: /^@operai\/ui\/rich-text$/, replacement: fileURLToPath(new URL('../operai-ui/src/richText.ts', import.meta.url)) },
   ],
   // vitest.config.ts
   alias: [
     { find: /^@operai\/ui\/rich-text$/, replacement: fileURLToPath(new URL('../operai-ui/src/richText.ts', import.meta.url)) },
     { find: /^@operai\/ui$/, replacement: fileURLToPath(new URL('../operai-ui/src/index.ts', import.meta.url)) },
   ],
   ```

   The rich-text entry imports `AttachmentList` and `Icon` by relative path, so those two
   stateless components are bundled again in each rich-text remote.

3. adds the six `@tiptap/*` packages to `resolve.dedupe` (vite and vitest), so the library's imports
   resolve from the app (on Vercel `operai-ui/node_modules` does not exist);
4. adds to tsconfig `paths`: `"@operai/ui/rich-text": ["../operai-ui/src/richText.ts"]` and
   `"@tiptap/*": ["./node_modules/@tiptap/*"]`.

Tests in jsdom call `stubLayoutForRichText()` (from the same entry) once: ProseMirror needs a layout jsdom
does not have. Today's consumers: meetings-ui (personal meeting notes), crm-ui and projects-ui (task
descriptions with images and attachments, ADR 20261113-task-description-files-in-activities-api-bucket).

## Board (`@operai/ui/board`)

`Board` (cards in lanes, moved by dragging; design-system.md § Board) needs `@dnd-kit/core`, so it ships from its own
entry, like the rich text, and the main `@operai/ui` stays dependency-free. Its classes (`.board*`) are in
`tokens.css`, so the shell must be live with them before a remote shows a board. An app that uses it:

1. installs `@dnd-kit/core` at the version this library's devDependencies pin, exactly;
2. compiles the entry ITSELF: in `vite.config.ts` an exact-match alias
   `{ find: /^@operai\/ui\/board$/, replacement: '../operai-ui/src/board.ts' }` (the main entry stays shared), in
   `vitest.config.ts` the same before the main alias;
3. adds `@dnd-kit/core` to `resolve.dedupe` (vite and vitest), so the library's import resolves from the app;
4. adds to tsconfig `paths`: `"@operai/ui/board": ["../operai-ui/src/board.ts"]` and
   `"@dnd-kit/*": ["./node_modules/@dnd-kit/*"]`.

Tests in jsdom call `stubLayoutForBoard()` (same entry) before a keyboard drag: jsdom lays nothing out. Today's
consumers: crm-ui (the pipeline) and projects-ui (the tasks of a project, My tasks).

## Versioning

`@operai/ui` is a Changesets package like the apps (`lerna.json`). Its version
records what changed; it does not pin what an app gets. At runtime every remote
uses the library THE SHELL was built with, which may be a different commit from
the one the remote was built with (Vercel deploys each project on its own, and a
remote can be redeployed alone). So a change to the main entry must be
compatible both ways for one deploy:

- **adding** an export that a remote uses: ship the library change in a push
  that redeploys the shell, and use it from the remote once the shell is live
  (a remote importing a name the live shell does not export receives `undefined`
  and fails where it uses it: the shell's error boundary shows "couldn't load");
- **removing or renaming** an export, or changing a prop incompatibly: first
  stop every remote using it, then remove it in a later push;
- a visual change to a component reaches every remote at the next shell
  deploy, without the remote being rebuilt.

`/version.json` (the shell) and the About modal tell which shell is live.
