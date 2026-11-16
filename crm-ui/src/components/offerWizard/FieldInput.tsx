import { useState, type ReactNode } from 'react'
import { Badge, DateInput, Field, Icon, MoneyInput, parseDecimal } from '@operai/ui'
import type { OfferLanguage } from '../../lib/offerEngine/answers'
import type { OutlineItem } from '../../lib/offerEngine/outline'
import { strings } from '../../strings'
import { controlId } from './controlId'
import TemplateText from './TemplateText'

const t = strings.offerWizard

export type FieldItem = Extract<OutlineItem, { type: 'field' }>

/** The answers schema's cap on a text answer (crm-api `answersSchema.ts`): more is refused, so it cannot be typed or pasted. */
const LONGTEXT_MAX = 20_000
/** The counter shows from 80 % of the limit. */
const LONGTEXT_COUNTER_FROM = 16_000

type Parsed<V> = { ok: true; value: V | undefined } | { ok: false }

/** What a person types for a number or a percentage → the canonical decimal text the answers hold. */
function parseNumber(text: string): Parsed<string> {
  const typed = text.trim().replace(',', '.')
  if (typed === '') return { ok: true, value: undefined }
  const match = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(typed)
  if (!match) return { ok: false }
  const whole = match[2]!.replace(/^0+(?=\d)/, '')
  const fraction = (match[3] ?? '').replace(/0+$/, '')
  const sign = match[1] === '-' && (whole !== '0' || fraction !== '') ? '-' : ''
  return { ok: true, value: `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}` }
}

/** What a person types for an amount → integer cents. */
function parseAmount(text: string): Parsed<number> {
  if (text.trim() === '') return { ok: true, value: undefined }
  const cents = parseDecimal(text, 2)
  return cents === null ? { ok: false } : { ok: true, value: cents }
}

const showCents = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

interface Draft<V> {
  text: string
  /** The answer this text produced; the draft stands only while the answer is still that (a fill may replace it). */
  pushed: V | undefined
  invalid: boolean
}

export interface FieldInputProps {
  item: FieldItem
  value: string | number | undefined
  /** The offer's language: the template's text is marked with it when it is not the interface's. */
  language: OfferLanguage
  currency: string
  /** A derived field's text, shown read-only. */
  derivedText?: string
  /** The reason of an invalid answer (an engine issue's code, in words). */
  error?: string | null
  /** The resolver would print it and it is empty. Shown as "Required" once the person has left the field. */
  missing: boolean
  /** What a hand-edited section says about this field (AC-5.2). */
  handEditedNote?: string
  /** What the chosen option fills (`Fills: …`). */
  fillsNote?: string
  onChange: (value: string | number) => void
}

/**
 * One template field as a control, by kind (AC-1.3, AC-1.8, AC-4.5): `select` when it declares options, textarea
 * for longtext, a decimal input for number and percentage, `DateInput`, `MoneyInput` in the deal currency for an
 * amount; a derived field read-only. Label, hint and example are the template's; a required field carries `*`
 * and `aria-required`, an optional one the word "optional" (DD-36). It never computes: a change is handed up as
 * the answer the engine's `setField` is given.
 */
export default function FieldInput({
  item,
  value,
  language,
  currency,
  derivedText,
  error,
  missing,
  handEditedNote,
  fillsNote,
  onChange,
}: FieldInputProps) {
  const [touched, setTouched] = useState(false)
  const [numberDraft, setNumberDraft] = useState<Draft<string> | null>(null)
  const [amountDraft, setAmountDraft] = useState<Draft<number> | null>(null)

  const id = controlId(item.name)
  const required = !item.optional && !item.derived
  const base = (item.label ?? item.name) as string
  const labelText = item.kind === 'amount' ? t.field.withCurrency(base, currency) : base
  const label: ReactNode = (
    <>
      <TemplateText language={language}>{labelText}</TemplateText>
      {item.optional ? (
        <>
          {' '}
          <Badge tone="muted">{t.field.optional}</Badge>
        </>
      ) : null}
    </>
  )

  const draft = item.kind === 'amount' ? amountDraft : numberDraft
  const draftShown = draft !== null && draft.pushed === value
  const typedInvalid = draftShown && draft.invalid
  const shownError =
    typedInvalid && touched ? t.invalid.not_a_number : (error ?? (missing && touched ? t.invalid.required : null))

  const hint: ReactNode =
    item.hint || item.derived || fillsNote || handEditedNote ? (
      <>
        {item.hint ? (
          <span className="block">
            <TemplateText language={language}>{item.hint}</TemplateText>
          </span>
        ) : null}
        {item.derived ? (
          <span className="block">
            <Icon name="lock" /> {t.field.derived}
          </span>
        ) : null}
        {fillsNote ? <span className="block">{fillsNote}</span> : null}
        {handEditedNote ? (
          <span className="block">
            <Icon name="info" /> {handEditedNote}
          </span>
        ) : null}
      </>
    ) : undefined

  const placeholder = item.example ?? undefined
  const onBlur = () => {
    setTouched(true)
    // a clean draft gives way to the answer's own text (1,50 → 1.5); an unreadable one stays, with its error
    if (draft !== null && !draft.invalid) {
      setNumberDraft(null)
      setAmountDraft(null)
    }
  }

  const control = (props: Record<string, unknown>): ReactNode => {
    const common = { ...props, 'data-wizard-field': item.name, onBlur }
    if (item.derived) {
      return <input {...common} type="text" readOnly aria-readonly="true" value={derivedText ?? ''} />
    }
    if (item.options !== null) {
      const text = value === undefined ? '' : String(value)
      const outside = text !== '' && !item.options.includes(text)
      return (
        <select {...common} value={text} onChange={(event) => onChange(event.target.value)}>
          {item.default === null && !outside && text === '' ? <option value="">{t.field.select}</option> : null}
          {item.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          {outside ? <option value={text}>{t.field.notAnOption(text)}</option> : null}
        </select>
      )
    }
    switch (item.kind) {
      case 'longtext': {
        const text = value === undefined ? '' : String(value)
        return (
          <>
            <textarea
              {...common}
              rows={4}
              maxLength={LONGTEXT_MAX}
              className="resize-y"
              placeholder={placeholder}
              value={text}
              onChange={(event) => onChange(event.target.value)}
            />
            {text.length >= LONGTEXT_COUNTER_FROM ? (
              <p className="text-xs text-soft">{t.edit.counter(text.length, LONGTEXT_MAX)}</p>
            ) : null}
          </>
        )
      }
      case 'date':
        return (
          <DateInput
            {...common}
            value={value === undefined ? '' : String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      case 'amount': {
        const text = draftShown
          ? draft.text
          : typeof value === 'number'
            ? showCents(value)
            : value === undefined
              ? ''
              : String(value)
        return (
          <MoneyInput
            {...common}
            placeholder={placeholder}
            value={text}
            onChange={(event) => {
              const typed = event.target.value
              const parsed = parseAmount(typed)
              const pushed = parsed.ok ? parsed.value : undefined
              setAmountDraft({ text: typed, pushed, invalid: !parsed.ok })
              onChange(pushed ?? '')
            }}
          />
        )
      }
      case 'number':
      case 'percentage': {
        const text = draftShown ? draft.text : value === undefined ? '' : String(value)
        return (
          <input
            {...common}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="input-figure"
            placeholder={placeholder}
            value={text}
            onChange={(event) => {
              const typed = event.target.value
              const parsed = parseNumber(typed)
              const pushed = parsed.ok ? parsed.value : undefined
              setNumberDraft({ text: typed, pushed, invalid: !parsed.ok })
              onChange(pushed ?? '')
            }}
          />
        )
      }
      default:
        return (
          <input
            {...common}
            type="text"
            maxLength={LONGTEXT_MAX}
            placeholder={placeholder}
            value={value === undefined ? '' : String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        )
    }
  }

  return (
    <Field id={id} label={label} hint={hint} error={shownError} required={required}>
      {(props) => control(props)}
    </Field>
  )
}
