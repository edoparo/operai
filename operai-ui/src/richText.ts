/**
 * `@operai/ui/rich-text` — the rich-text editor, in an entry of its own (not `@operai/ui`): it needs TipTap,
 * which only an app that uses it installs. Such an app adds, next to the main alias (README § Rich text):
 * the `@operai/ui/rich-text` alias, the `@tiptap/*` packages as dependencies, and those packages to
 * `resolve.dedupe` (so the library's imports resolve from the app) and to tsconfig `paths`.
 */
export { RichTextEditor } from './rich-text/RichTextEditor'
export type { RichTextDoc, RichTextEditorProps } from './rich-text/RichTextEditor'
/** For tests in jsdom only: an empty layout, so ProseMirror can scroll the caret. */
export { stubLayoutForRichText } from './rich-text/jsdomLayout'
