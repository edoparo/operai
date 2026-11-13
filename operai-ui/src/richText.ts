/**
 * `@operai/ui/rich-text` — the rich-text editor, in an entry of its own (not `@operai/ui`): it needs TipTap,
 * which only an app that uses it installs. Such an app adds, next to the main alias (README § Rich text):
 * the `@operai/ui/rich-text` alias, the `@tiptap/*` packages as dependencies, and those packages to
 * `resolve.dedupe` (so the library's imports resolve from the app) and to tsconfig `paths`.
 */
export { RichTextEditor } from './rich-text/RichTextEditor'
export type { RichTextDoc, RichTextEditorProps, RichTextImages } from './rich-text/RichTextEditor'
export { RichTextView } from './rich-text/RichTextView'
export type { RichTextViewProps } from './rich-text/RichTextView'
export { FileImage, RichTextImage } from './rich-text/image'
export type { ResolveImageUrl, RichTextImageCopy } from './rich-text/image'
export { imageFileIds, isEmptyRichText, mapImageFileIds } from './rich-text/doc'
/** For tests in jsdom only: an empty layout, so ProseMirror can scroll the caret. */
export { stubLayoutForRichText } from './rich-text/jsdomLayout'
export { RichTextFilesField } from './rich-text/RichTextFilesField'
export type { RichTextFilesFieldProps } from './rich-text/RichTextFilesField'
export { commitDeferredFiles, isLocalFileId, useDeferredFiles, withoutLocalImages } from './rich-text/deferredFiles'
export type { CommittedFiles, DeferredFile, DeferredFiles } from './rich-text/deferredFiles'
export { RichTextFilesView } from './rich-text/RichTextFilesView'
export type { RichTextFilesViewProps } from './rich-text/RichTextFilesView'
