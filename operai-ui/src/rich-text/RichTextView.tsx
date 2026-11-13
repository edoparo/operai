import type { JSONContent } from '@tiptap/core'
import type { ReactNode } from 'react'
import { RichTextImage } from './image'
import type { ResolveImageUrl, RichTextImageCopy } from './image'

export type RichTextViewProps = {
  doc: JSONContent
  /** How image nodes become URLs; without it, images are not shown. */
  resolveImageUrl?: ResolveImageUrl
  imageCopy?: RichTextImageCopy
  /** Copy for a check-list item's state, for assistive technology ("done", "to do"). */
  checkCopy?: { done: string; todo: string }
  className?: string
  testId?: string
}

type MarkTag = 'strong' | 'em' | 's' | 'code'
const MARK_TAGS: Record<string, MarkTag> = { bold: 'strong', italic: 'em', strike: 's', code: 'code' }

function text(node: JSONContent, key: string): ReactNode {
  let out: ReactNode = node.text ?? ''
  for (const mark of node.marks ?? []) {
    const Tag = MARK_TAGS[mark.type]
    if (Tag) out = <Tag>{out}</Tag>
  }
  return <span key={key}>{out}</span>
}

/**
 * RichTextView — a document from `RichTextEditor`, shown read-only as React elements: no editor, no
 * HTML string, so it is light enough for a list and can never inject markup. It knows the editor's
 * nodes (paragraph, heading, lists, check lists, quote, code, rule, line break, image); a node it does
 * not know shows its children, or nothing.
 */
export function RichTextView({ doc, resolveImageUrl, imageCopy, checkCopy, className, testId }: RichTextViewProps) {
  const render = (node: JSONContent, key: string): ReactNode => {
    const children = () => (node.content ?? []).map((child, index) => render(child, `${key}.${index}`))
    switch (node.type) {
      case 'doc':
        return children()
      case 'text':
        return text(node, key)
      case 'paragraph':
        return <p key={key}>{children()}</p>
      case 'heading':
        return <h3 key={key}>{children()}</h3>
      case 'bulletList':
        return <ul key={key}>{children()}</ul>
      case 'orderedList':
        return (
          <ol key={key} start={typeof node.attrs?.['start'] === 'number' ? (node.attrs['start'] as number) : undefined}>
            {children()}
          </ol>
        )
      case 'listItem':
        return <li key={key}>{children()}</li>
      case 'taskList':
        return (
          <ul key={key} data-type="taskList">
            {children()}
          </ul>
        )
      case 'taskItem': {
        const checked = node.attrs?.['checked'] === true
        return (
          <li key={key} data-checked={checked}>
            <input
              type="checkbox"
              checked={checked}
              disabled
              readOnly
              aria-label={checkCopy ? (checked ? checkCopy.done : checkCopy.todo) : undefined}
            />
            <div>{children()}</div>
          </li>
        )
      }
      case 'blockquote':
        return <blockquote key={key}>{children()}</blockquote>
      case 'codeBlock':
        return (
          <pre key={key}>
            <code>{children()}</code>
          </pre>
        )
      case 'horizontalRule':
        return <hr key={key} />
      case 'hardBreak':
        return <br key={key} />
      case 'image': {
        const fileId = typeof node.attrs?.['fileId'] === 'string' ? (node.attrs['fileId'] as string) : null
        if (!resolveImageUrl || !imageCopy) return null
        return (
          <div key={key} className="rich-text-image-block">
            <RichTextImage
              key={fileId ?? 'none'}
              fileId={fileId}
              alt={(node.attrs?.['alt'] as string | null) ?? null}
              resolveUrl={resolveImageUrl}
              copy={imageCopy}
            />
          </div>
        )
      }
      default:
        return node.content ? <div key={key}>{children()}</div> : null
    }
  }
  return (
    <div className={['rich-text-content', 'rich-text-view', className].filter(Boolean).join(' ')} data-testid={testId}>
      {render(doc, 'n')}
    </div>
  )
}
