import { useRef, useState } from 'react'
import { Banner, Button, Field, FormDialog, Icon } from '@operai/ui'
import type { WizardAnswers, WizardContext } from '../../lib/offerEngine/answers'
import { findTokens, resolveSectionForEdit } from '../../lib/offerEngine/edit'
import { REFERENCE_TOKEN } from '../../lib/offerEngine/markup'
import type { TemplateAst } from '../../lib/offerEngine/syntax'
import { offerFailure } from '../../lib/offerErrors'
import { strings } from '../../strings'
import MarkupHelp from '../MarkupHelp'
import { MAX_EDIT_BODY, MAX_EDIT_HEADING } from './handEdits'

const t = strings.offerWizard

export interface HandEditDialogProps {
  ast: TemplateAst
  answers: WizardAnswers
  context: WizardContext
  /** The template's key of the section (heading source text + "#" + occurrence). */
  sectionKey: string
  /** True once the section was edited by hand: the dialog then offers Restore. */
  edited: boolean
  /** Saves the text; rejects with the failure (a conflict, the network) and the dialog stays open with the text. */
  onSave: (heading: string, body: string) => Promise<void>
  /** Asks to restore the wizard's text; the page confirms. */
  onRestore: () => void
  onCancel: () => void
}

type Which = 'heading' | 'body'

/** Why a bracket in a text is refused (AC-5.2, DD-30, DD-52): a mark to replace, or a stray bracket to remove. */
function refusal(token: { start: number; label: string }, text: string, which: Which): string {
  if (token.label !== '') return t.edit.tokenLeft(token.label)
  const char = text[token.start]
  if (char === '⟪' || char === '⟫')
    return which === 'heading' ? t.edit.referenceStrayHeading : t.edit.referenceStrayBody
  return t.edit.bracketStray
}

/** Puts the caret on a place in a text and scrolls a long text so that it shows. */
function placeCaret(control: HTMLInputElement | HTMLTextAreaElement, start: number, end: number): void {
  control.focus()
  control.setSelectionRange(start, end)
  if (control instanceof HTMLTextAreaElement) {
    const line = control.value.slice(0, start).split('\n').length
    const height = Number.parseFloat(window.getComputedStyle(control).lineHeight)
    control.scrollTop = Math.max(0, line - 3) * (Number.isNaN(height) ? 20 : height)
  }
}

/**
 * The hand-edit dialog (design S8, F9; AC-5.1–5.4, DD-30, DD-52): the section's text as the current answers resolve
 * it, in the offer markup, with a visible "⟦Label⟧" for every value still missing and "⟪REF⟫" where the offer
 * reference goes. A hand-edited text no longer follows the answers, so Save is refused while any "⟦" or "⟧" is
 * left — even for a field filled since — and for a "⟪" or "⟫" that is not the whole reference token in the text.
 * The caret goes to the first such place. Over the limits, a field says so as the person types.
 */
export default function HandEditDialog({
  ast,
  answers,
  context,
  sectionKey,
  edited,
  onSave,
  onRestore,
  onCancel,
}: HandEditDialogProps) {
  // what the dialog opens with: the text of the moment, never recomputed while the person types
  const [initial] = useState(() => resolveSectionForEdit(ast, answers, context, sectionKey))
  const [heading, setHeading] = useState(initial?.heading ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [refused, setRefused] = useState<{ heading?: string; body?: string }>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const headingRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  if (initial === null) return null

  const headingTooLong = heading.length > MAX_EDIT_HEADING
  const bodyTooLong = body.length > MAX_EDIT_BODY
  const headingError = headingTooLong ? t.edit.tooLong(MAX_EDIT_HEADING) : refused.heading
  const bodyError = bodyTooLong ? t.edit.tooLong(MAX_EDIT_BODY) : refused.body

  const submit = async () => {
    const headingToken = findTokens(heading, 'heading')[0]
    const bodyToken = findTokens(body)[0]
    const next = {
      heading: headingToken ? refusal(headingToken, heading, 'heading') : undefined,
      body: bodyToken ? refusal(bodyToken, body, 'body') : undefined,
    }
    setRefused(next)
    if (headingToken && headingRef.current) return placeCaret(headingRef.current, headingToken.start, headingToken.end)
    if (headingTooLong) return headingRef.current?.focus()
    if (bodyToken && bodyRef.current) return placeCaret(bodyRef.current, bodyToken.start, bodyToken.end)
    if (bodyTooLong) return bodyRef.current?.focus()
    setBusy(true)
    setFailure(null)
    try {
      await onSave(heading, body)
    } catch (error) {
      setFailure(offerFailure(error))
      setBusy(false)
    }
  }

  const counter = (length: number, max: number) => (
    <span className={length > max ? 'text-red-text' : undefined}>{t.edit.counter(length, max)}</span>
  )

  return (
    <FormDialog
      title={t.edit.title}
      description={t.edit.description}
      size="lg"
      submitLabel={t.edit.save}
      busyLabel={t.edit.saving}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={failure}
      onSubmit={() => void submit()}
      onCancel={onCancel}
      testIdPrefix="crm-wizard-hand-edit"
    >
      <div className="dialog-body flex flex-col gap-4">
        {initial.tokens.length > 0 ? (
          <Banner tone="warning" live="polite">
            {t.edit.missingBanner(initial.tokens.map((token) => token.label).join(', '))}
          </Banner>
        ) : null}
        <Field
          label={t.edit.heading}
          hint={counter(heading.length, MAX_EDIT_HEADING)}
          error={headingError}
          errorRole="alert"
        >
          {(control) => (
            <input
              {...control}
              ref={headingRef}
              type="text"
              value={heading}
              onChange={(event) => {
                setHeading(event.target.value)
                setRefused((now) => ({ ...now, heading: undefined }))
              }}
            />
          )}
        </Field>
        <Field label={t.edit.text} hint={counter(body.length, MAX_EDIT_BODY)} error={bodyError} errorRole="alert">
          {(control) => (
            <textarea
              {...control}
              ref={bodyRef}
              rows={14}
              className="font-mono"
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                setRefused((now) => ({ ...now, body: undefined }))
              }}
            />
          )}
        </Field>
        {body.includes(REFERENCE_TOKEN) ? (
          <p className="flex items-start gap-2 text-xs text-soft">
            <Icon name="info" className="mt-0.5 shrink-0" /> {t.edit.referenceNote}
          </p>
        ) : null}
        <MarkupHelp placeholders={false} note={t.edit.markupNote} />
        {edited ? (
          <div>
            <Button variant="ghost" size="sm" onClick={onRestore}>
              {t.edit.restore}
            </Button>
          </div>
        ) : null}
      </div>
    </FormDialog>
  )
}
