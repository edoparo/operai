/**
 * useLineDraftValidation — the per-field validation an expense-line form runs
 * (INC-16, operai-ui/docs/design-system.md § Forms), shared by
 * `ExpenseLineComposer` (a new line) and `ExpenseLineRow` (a line edited in
 * place) so the two never disagree on when an error shows.
 *
 *   - A field's error shows once the field has been touched (blurred) and is
 *     invalid, or once a submit ("Add" / "Done" / leaving the row) was
 *     attempted — never while the person is still on their first pass.
 *   - `validate({ focus: true })` reveals every error and moves focus to the
 *     first invalid control (the first `[aria-invalid="true"]` inside the
 *     form's container, i.e. in render order) after the errors render.
 *   - The rules themselves are `lineDraftInvalidFields` — the same ones
 *     `isLineDraftComplete` (and so the auto-save) has always used.
 */

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { strings } from '../strings'
import type { LineDraftField, LineDraftValue } from './lineDraft'
import { lineDraftInvalidFields } from './lineDraft'

export type LineDraftValidation = {
  /** The error to show under `field` right now, or `undefined`. */
  errorFor: (field: LineDraftField) => string | undefined
  /** `onBlur` handler marking `field` as touched. */
  touch: (field: LineDraftField) => () => void
  /** Reveals every error; with `focus`, moves focus to the first invalid field. Returns whether the draft is valid. */
  validate: (options: { focus: boolean }) => boolean
  /** Forgets touched/submitted state (after a successful add). */
  reset: () => void
}

export function useLineDraftValidation(
  draft: LineDraftValue,
  containerRef: RefObject<HTMLElement | null>,
): LineDraftValidation {
  const messages = strings.pages.requestDetail.composer.fieldErrors
  const [touched, setTouched] = useState<ReadonlySet<LineDraftField>>(() => new Set())
  const [attempted, setAttempted] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)

  const invalid = lineDraftInvalidFields(draft)

  // Runs after the render that marked the fields invalid, so the query sees them.
  useEffect(() => {
    if (focusRequest === 0) return
    containerRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusRequest, containerRef])

  return {
    errorFor: (field) => ((attempted || touched.has(field)) && invalid.includes(field) ? messages[field] : undefined),
    touch: (field) => () =>
      setTouched((prev) => {
        if (prev.has(field)) return prev
        const next = new Set(prev)
        next.add(field)
        return next
      }),
    validate: ({ focus }) => {
      if (invalid.length === 0) return true
      setAttempted(true)
      if (focus) setFocusRequest((n) => n + 1)
      return false
    },
    reset: () => {
      setTouched(new Set())
      setAttempted(false)
    },
  }
}
