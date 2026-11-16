import { useId, useState, type Ref, type SyntheticEvent } from 'react'
import { Button, Card, Field, VisuallyHidden } from '@operai/ui'
import { MAX_TEMPLATE_CHARS } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'
import { caretPosition } from './lines'

const w = strings.templates.wizardEditor

export interface TemplateTextAreaProps {
  value: string
  onChange: (value: string) => void
  textareaRef: Ref<HTMLTextAreaElement>
  /** The box is read-only (no right to manage the entity, or an archived template). */
  disabled?: boolean
  /** Errors in the text: the link to the problem list shows only when there are some. */
  errorCount: number
  /** A refusal of the whole text by the server that is not a problem of one line (a character that cannot be saved). */
  error?: string
  onGoToProblems: () => void
  onOpenSyntax: () => void
}

/**
 * The template's text (design S13): a soft-wrapped monospace box with a status line instead of a line-number gutter
 * (a paragraph of 800 characters wraps, so a gutter cannot follow it — DD-37). The status line says where the caret
 * is, in the lines the parser counts, and how much of the limit the text uses; it is not announced (`aria-live`
 * off), the problem list is the place to listen to.
 */
export default function TemplateTextArea({
  value,
  onChange,
  textareaRef,
  disabled = false,
  errorCount,
  error,
  onGoToProblems,
  onOpenSyntax,
}: TemplateTextAreaProps) {
  const statusId = useId()
  const [caret, setCaret] = useState({ line: 1, col: 1 })
  const follow = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const box = event.currentTarget
    setCaret(caretPosition(box.value, box.selectionStart))
  }

  return (
    <Card title={w.text}>
      <div className="flex flex-col gap-2">
        <Field label={<VisuallyHidden>{w.text}</VisuallyHidden>} hint={w.textHint} error={error}>
          {(control) => (
            <textarea
              {...control}
              ref={textareaRef}
              aria-describedby={[control['aria-describedby'], statusId].filter(Boolean).join(' ')}
              rows={28}
              wrap="soft"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={disabled}
              className="w-full resize-y font-mono text-sm"
              value={value}
              onChange={(event) => {
                follow(event)
                onChange(event.target.value)
              }}
              onSelect={follow}
              onKeyUp={follow}
              onClick={follow}
              onFocus={follow}
              data-testid="crm-template-text"
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            id={statusId}
            aria-live="off"
            className="font-mono text-2xs text-soft"
            data-testid="crm-template-text-status"
          >
            {w.status(caret.line, caret.col, value.length, MAX_TEMPLATE_CHARS)}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {errorCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={onGoToProblems}>
                {w.goToProblems(errorCount)}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={onOpenSyntax}>
              {w.syntax}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
