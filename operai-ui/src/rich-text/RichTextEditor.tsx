import type { JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { EditorView } from '@tiptap/pm/view'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { FileImage, RichTextImageContext } from './image'
import type { ResolveImageUrl, RichTextImageCopy } from './image'

/** A rich-text document: TipTap's JSON. Stored and sent as data, never as HTML. */
export type RichTextDoc = JSONContent

/**
 * Images in the text, by file id. The editor never holds a URL in the document: it asks `upload` for
 * an id when a picture is chosen, pasted or dropped, and `resolveUrl` for a URL when one is shown.
 */
export type RichTextImages = {
  /** Uploads one image and returns its file id; a rejection leaves the text as it was (`onError` says why). */
  upload: (file: File) => Promise<string>
  resolveUrl: ResolveImageUrl
  /** The image types the app accepts (`image/png,image/jpeg,…`): what the file dialog offers and what paste and drop take. */
  accept: string
  onError?: (error: unknown, file: File) => void
  copy: RichTextImageCopy & {
    /** The toolbar button ("Insert image"). */
    insert: string
    /** Announced while uploads run ("Uploading image…"). */
    uploading: string
  }
}

export type RichTextEditorProps = {
  /** The document the editor starts from (null = empty). Uncontrolled afterwards: remount (a new `key`) to replace it. */
  initialValue: RichTextDoc | null
  /** Every change: the document and its length in characters of text. */
  onChange: (doc: RichTextDoc, textLength: number) => void
  onBlur?: () => void
  /** The editable region's accessible name. */
  label: string
  /** Ids of elements that describe the region (a hint, a status). */
  describedBy?: string
  placeholder?: string
  /** Characters of text at most (typing stops there). */
  maxLength?: number
  readOnly?: boolean
  copy: {
    /** The toolbar's accessible name. */
    toolbar: string
    bold: string
    italic: string
    heading: string
    bulletList: string
    orderedList: string
    taskList: string
  }
  /** Images inside the text; without it the editor has no image button and ignores pasted pictures. */
  images?: RichTextImages
  /** Prefix of every `data-testid`: `<p>-editor`, `<p>-toolbar`, `<p>-tool-<name>`, `<p>-image-input`. */
  testIdPrefix: string
}

const imageFilesOf = (list: FileList | null | undefined, accept: string): File[] => {
  const types = accept.split(',').map((type) => type.trim())
  return Array.from(list ?? []).filter((file) => types.includes(file.type))
}

/**
 * RichTextEditor — WYSIWYG text with a small, fixed set of formats: bold, italic, a heading, bulleted,
 * numbered and check lists (plus what the keyboard and Markdown shortcuts give: quotes, code, a rule).
 * There are no links: what is written is text, and only the editor's schema renders it, so a stored
 * document can never inject markup. With `images`, pictures can be chosen, pasted or dropped: each is
 * uploaded by the app and kept in the document as a file id (`FileImage`), never as a URL. The
 * document is TipTap JSON (`RichTextDoc`); show it read-only with `RichTextView`.
 *
 * A toolbar (`role="toolbar"`) of toggle buttons (`aria-pressed`) that never takes the focus away from
 * the text; the usual shortcuts (Ctrl/Cmd+B, I, Shift+8, Shift+7, Shift+9) work too. Copy is the app's.
 *
 * Ships from its own entry, `@operai/ui/rich-text`, NOT the main one: it needs TipTap, which only the
 * apps that use it install (and list in `resolve.dedupe`); every other app keeps a dependency-free library.
 */
export function RichTextEditor({
  initialValue,
  onChange,
  onBlur,
  label,
  describedBy,
  placeholder,
  maxLength,
  readOnly = false,
  copy,
  images,
  testIdPrefix,
}: RichTextEditorProps) {
  // The latest callbacks, without recreating the editor when the parent re-renders.
  const handlers = useRef({ onChange, onBlur, images })
  useEffect(() => {
    handlers.current = { onChange, onBlur, images }
  })
  const [uploading, setUploading] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const statusId = useId()

  const insertRef = useRef<(files: File[], at?: number) => Promise<void>>(async () => {})

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, link: false, underline: false }),
      ...(images
        ? [
            // Its URLs and copy come from RichTextImageContext, below: the app's resolver may change without recreating the editor.
            FileImage,
          ]
        : []),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      CharacterCount.configure({ limit: maxLength ?? null }),
    ],
    content: initialValue ?? '',
    editable: !readOnly,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: 'rich-text-content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        'data-testid': `${testIdPrefix}-editor`,
      },
      // A pasted or dropped picture is uploaded and placed; anything else is the editor's to handle.
      handlePaste: (_view: EditorView, event: ClipboardEvent) => {
        const accept = handlers.current.images?.accept
        if (!accept) return false
        const files = imageFilesOf(event.clipboardData?.files, accept)
        if (files.length === 0) return false
        event.preventDefault()
        void insertRef.current(files)
        return true
      },
      handleDrop: (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
        const accept = handlers.current.images?.accept
        if (moved || !accept) return false
        const files = imageFilesOf(event.dataTransfer?.files, accept)
        if (files.length === 0) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertRef.current(files, at)
        return true
      },
    },
    onUpdate: ({ editor: current }) => handlers.current.onChange(current.getJSON(), current.storage.characterCount.characters()),
    onBlur: () => handlers.current.onBlur?.(),
  })
  const resolveUrl = images?.resolveUrl
  const loading = images?.copy.loading
  const unavailable = images?.copy.unavailable
  const imageContext = useMemo(
    () => (resolveUrl ? { resolveUrl, copy: { loading: loading ?? '', unavailable: unavailable ?? '' } } : null),
    [resolveUrl, loading, unavailable],
  )
  /** Uploads each picture, then puts it where the person chose (`at`), or at the caret. */
  const insertImages = async (files: File[], at?: number) => {
    const current = handlers.current.images
    if (!current || files.length === 0) return
    setUploading((count) => count + files.length)
    let position = at
    for (const file of files) {
      try {
        const fileId = await current.upload(file)
        const name = file.name.replace(/\.[a-z0-9]+$/i, '')
        const chain = editor?.chain().focus()
        const content = { type: 'image', attrs: { fileId, alt: name } }
        if (position === undefined) chain?.insertContent(content).run()
        else {
          chain?.insertContentAt(position, content).run()
          position = editor?.state.selection.to
        }
      } catch (error) {
        current.onError?.(error, file)
      } finally {
        setUploading((count) => count - 1)
      }
    }
  }
  useEffect(() => {
    insertRef.current = insertImages
  })


  // Without emitting an update: becoming read-only is not an edit, and must not look like one to `onChange`.
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false)
  }, [editor, readOnly])

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      heading: current?.isActive('heading', { level: 3 }) ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      taskList: current?.isActive('taskList') ?? false,
    }),
  })

  const tools: { name: keyof typeof run; icon: IconName }[] = [
    { name: 'bold', icon: 'bold' },
    { name: 'italic', icon: 'italic' },
    { name: 'heading', icon: 'heading' },
    { name: 'bulletList', icon: 'list-bullet' },
    { name: 'orderedList', icon: 'list-ordered' },
    { name: 'taskList', icon: 'list-check' },
  ]
  const run = {
    bold: () => editor?.chain().focus().toggleBold().run(),
    italic: () => editor?.chain().focus().toggleItalic().run(),
    heading: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    bulletList: () => editor?.chain().focus().toggleBulletList().run(),
    orderedList: () => editor?.chain().focus().toggleOrderedList().run(),
    taskList: () => editor?.chain().focus().toggleTaskList().run(),
  }

  return (
    <div className="rich-text">
      {!readOnly && (
        <div role="toolbar" aria-label={copy.toolbar} className="rich-text-toolbar" data-testid={`${testIdPrefix}-toolbar`}>
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className="rich-text-tool"
              aria-label={copy[tool.name]}
              aria-pressed={active?.[tool.name] ?? false}
              // Keep the caret in the text: the command then applies where the person is writing.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run[tool.name]()}
              data-testid={`${testIdPrefix}-tool-${tool.name}`}
            >
              <Icon name={tool.icon} />
            </button>
          ))}
          {images && (
            <>
              <button
                type="button"
                className="rich-text-tool"
                aria-label={images.copy.insert}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => fileInput.current?.click()}
                data-testid={`${testIdPrefix}-tool-image`}
              >
                <Icon name="image" />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={images.accept}
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-label={images.copy.insert}
                data-testid={`${testIdPrefix}-image-input`}
                onChange={(event) => {
                  const files = imageFilesOf(event.target.files, images.accept)
                  event.target.value = ''
                  void insertImages(files)
                }}
              />
            </>
          )}
          {/* Only when pictures can be added: a page may have its own status line (a save state). */}
          {images && (
            <span id={statusId} role="status" className="rich-text-status">
              {uploading > 0 ? images.copy.uploading : ''}
            </span>
          )}
        </div>
      )}
      <RichTextImageContext.Provider value={imageContext}>
        <EditorContent editor={editor} />
      </RichTextImageContext.Provider>
    </div>
  )
}
