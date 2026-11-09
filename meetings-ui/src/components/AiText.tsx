import { cx } from '@operai/ui'
import { textBlocks } from '../lib/textBlocks'

export type AiTextProps = {
  /** Plain text written by the model (ADR-0067). */
  text: string
  /** Secondary text, e.g. a section the meeting did not discuss. */
  soft?: boolean
}

/**
 * AI-written plain text with its paragraphs and lists laid out as such. Every block is a React text node: nothing
 * the model wrote is ever read as HTML or Markdown (ADR-0067).
 */
export function AiText({ text, soft = false }: AiTextProps) {
  const tone = soft ? 'text-soft' : 'text-text'
  return (
    <div className={cx('flex flex-col gap-2 break-words text-sm leading-relaxed', tone)}>
      {textBlocks(text).map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={index} className="whitespace-pre-line">
              {block.text}
            </p>
          )
        }
        const List = block.ordered ? 'ol' : 'ul'
        return (
          <List key={index} className={cx('flex flex-col gap-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
            {block.items.map((item, i) => (
              <li key={i} className="pl-1">
                {item}
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
