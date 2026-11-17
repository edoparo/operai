import { useEffect, useId, useRef } from 'react'
import { Button, Icon } from '@operai/ui'
import { useFieldError, useForm } from '../lib/formStateContext'
import type { FormLine } from '../lib/formStateTypes'
import { strings } from '../strings'
import { BoolField, ColourField, NumberField, TextField } from './VariantCardFields'

export interface ZoneEditorProps {
  /** The JSON Pointer of the zone's array of lines, e.g. `/variants/default/footer/left`. */
  pointer: string
  /** The zone's name as the person reads it ("Left zone"). */
  zoneLabel: string
  /** The page this zone is in ("Default page") and its frame ("Footer"): they name the remove buttons. */
  variantLabel: string
  frameLabel: string
  lines: readonly FormLine[]
}

/** Where focus goes once the lines have changed: a line's first input, or the Add button. */
type FocusTarget = { kind: 'line'; index: number } | { kind: 'add' }

/**
 * ZoneEditor — one zone (left, centre or right) of a header or footer: up to `maxLinesPerZone` lines, each
 * with its Italian and English text and its own size, weight and colour (AC-5.2, 5.8, A1, A2). A zone may
 * hold no line.
 *
 * - **Add a line** appends an empty line that starts from the previous line's look (D-5) and moves focus to
 *   its first input. At the limit the button is `aria-disabled` and described by the reason, so a keyboard
 *   user still lands on it and hears why (a `disabled` button would drop out of the tab order).
 * - **Remove** deletes the line; focus goes to the line that took its place, else the one before, else the
 *   Add button, and the page says "Line removed" (design F5 "Zone lines", § Accessibility).
 * - Lines have no identity of their own, so they are keyed by position; the number fields re-read their value
 *   when the line under them changes.
 */
export function ZoneEditor({ pointer, zoneLabel, variantLabel, frameLabel, lines }: ZoneEditorProps) {
  const { dispatch, catalog, announce } = useForm()
  const max = catalog.bounds.maxLinesPerZone
  const full = lines.length >= max
  const error = useFieldError(pointer)
  const ids = useId()
  const limitId = `${ids}-limit`
  const errorId = `${ids}-error`
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const focusAfter = useRef<FocusTarget | null>(null)

  // Runs after the lines changed and were drawn, so the line to focus exists by now.
  useEffect(() => {
    const target = focusAfter.current
    if (target === null) return
    focusAfter.current = null
    const element =
      target.kind === 'add'
        ? addRef.current
        : rootRef.current?.querySelector<HTMLElement>(`[data-line="${target.index}"] input[type="text"]`)
    element?.focus()
  }, [lines])

  const add = () => {
    if (full) return
    focusAfter.current = { kind: 'line', index: lines.length }
    dispatch({ type: 'lineAdded', zone: pointer })
  }

  const remove = (index: number) => {
    focusAfter.current =
      index < lines.length - 1
        ? { kind: 'line', index }
        : index > 0
          ? { kind: 'line', index: index - 1 }
          : { kind: 'add' }
    dispatch({ type: 'lineRemoved', zone: pointer, index })
    announce(strings.form.line.removed)
  }

  return (
    <fieldset
      ref={rootRef}
      className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
      data-zone={pointer}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="field-label">{zoneLabel}</legend>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      {lines.map((line, index) => {
        const at = `${pointer}/${index}`
        return (
          <fieldset
            key={index}
            data-line={index}
            className="m-0 flex min-w-0 flex-col gap-3 rounded-md border border-rule p-3"
          >
            <legend className="field-label px-1">{strings.form.line.n(index + 1)}</legend>
            <TextField label={strings.form.line.textIt} pointer={`${at}/text/it`} value={line.text.it} />
            <TextField label={strings.form.line.textEn} pointer={`${at}/text/en`} value={line.text.en} />
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <NumberField className="w-24" label={strings.form.line.size} pointer={`${at}/size`} value={line.size} />
              <BoolField label={strings.form.line.bold} pointer={`${at}/bold`} checked={line.bold} className="pb-2" />
              <ColourField label={strings.form.line.colour} pointer={`${at}/color`} value={line.color} />
              <Button
                variant="ghost"
                iconOnly
                aria-label={strings.form.line.remove(variantLabel, frameLabel, zoneLabel, index + 1)}
                onClick={() => remove(index)}
                data-testid={`remove-${at}`}
              >
                <Icon name="trash" />
              </Button>
            </div>
          </fieldset>
        )
      })}
      <div className="flex flex-col items-start gap-1">
        <Button
          ref={addRef}
          size="sm"
          variant="secondary"
          aria-disabled={full || undefined}
          aria-describedby={full ? limitId : undefined}
          onClick={add}
        >
          <Icon name="plus" />
          {strings.form.line.add}
        </Button>
        {full && (
          <p id={limitId} className="field-hint">
            {strings.form.line.limit(max)}
          </p>
        )}
      </div>
    </fieldset>
  )
}
