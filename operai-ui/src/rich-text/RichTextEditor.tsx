import type { JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'

/** A rich-text document: TipTap's JSON. Stored and sent as data, never as HTML. */
export type RichTextDoc = JSONContent

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
  /** Prefix of every `data-testid`: `<p>-editor`, `<p>-toolbar`, `<p>-tool-<name>`. */
  testIdPrefix: string
}

/**
 * RichTextEditor — WYSIWYG text with a small, fixed set of formats: bold, italic, a heading, bulleted,
 * numbered and check lists (plus what the keyboard and Markdown shortcuts give: quotes, code, a rule).
 * There are no links and no images: what is written is text, and only the editor's schema renders it,
 * so a stored document can never inject markup. The document is TipTap JSON (`RichTextDoc`).
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
  testIdPrefix,
}: RichTextEditorProps) {
  // The latest callbacks, without recreating the editor when the parent re-renders.
  const handlers = useRef({ onChange, onBlur })
  useEffect(() => {
    handlers.current = { onChange, onBlur }
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, link: false, underline: false }),
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
    },
    onUpdate: ({ editor: current }) => handlers.current.onChange(current.getJSON(), current.storage.characterCount.characters()),
    onBlur: () => handlers.current.onBlur?.(),
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
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
