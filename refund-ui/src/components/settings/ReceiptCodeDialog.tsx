/**
 * ReceiptCodeDialog — set or change the receipt code of ONE employee
 * (specs/20261124-receipt-numbers-from-the-register, design S3, RC-4 to RC-7, plan DS-3; AC-4.1 to AC-4.6).
 * A `FormDialog` mounted beside the card (ADR 20261118 dialog-beside-form), `size="sm"`, with one text field.
 *
 *   - There is no Clear here and an empty field never clears (RC-4, RC-6): Clear is a row action of its own. Save is
 *     disabled while the field is empty or equals the saved code.
 *   - The field has no `maxLength` and upper-cases `a-z` only, as typed (RC-5): a pasted `ABCD` is shown and refused
 *     rather than cut to a valid, wrong `ABC`, and `ß` or `À` stay visibly invalid instead of becoming `SS`.
 *   - The shape (two or three letters A-Z after trimming) is checked on submit and on blur, in step with the server's
 *     AC-4.2 rule; a bad shape sends no request. The server stays the authority: a 422 shows the same text.
 *   - 422 `receipt_code_invalid` and 409 `receipt_code_in_use` are field errors with LOCAL text keyed by `code`, never
 *     the server `detail` (it is English, and the 409 must say nothing about who or why, AC-4.3, RC-7). After either,
 *     focus goes back to the field; on a 409 the typed value is kept and selected so it can be overtyped.
 *   - 404, 403 and anything else (network, 5xx) are the dialog's error; after a 404 Save stays disabled (the employee
 *     is gone) and Cancel closes it, the card then reloads the list.
 *   - The description says what a code does: new numbers only, the sequence continues, issued numbers do not change.
 *
 * It owns its field and the `PUT`; the card owns the focus after a save. `onNotFound` (T20) tells the card the employee
 * is gone, so it reloads the list when this dialog is closed.
 */

import { useEffect, useRef, useState } from 'react'
import { Field, FormDialog } from '@operai/ui'
import { strings } from '../../strings'
import { putCode, receiptCodeErrorCode } from '../../lib/receiptCodesApi'
import type { ReceiptCodeEmployee } from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'

const t = strings.settings.receiptCodes
const tc = strings.settings.catalog

/** Upper-case ASCII letters only, so `ß` and `À` are left as the user typed them (RC-5). */
const capitalise = (value: string): string => value.replace(/[a-z]/g, (letter) => letter.toUpperCase())

/** AC-4.2: two or three letters A-Z, after trimming and capitalising. */
const SHAPE = /^[A-Z]{2,3}$/

export type ReceiptCodeDialogProps = {
  employee: ReceiptCodeEmployee
  onCancel: () => void
  /** The row the server answered (the same shape as the list's). */
  onSaved: (row: ReceiptCodeEmployee) => void
  /** A 404 `employee_not_found` came back: the list is stale. */
  onNotFound?: () => void
}

export default function ReceiptCodeDialog({ employee, onCancel, onSaved, onNotFound }: ReceiptCodeDialogProps) {
  const [value, setValue] = useState(employee.code ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // A new object per request: focus moves in an effect, once the fieldset is enabled again (a control of a busy
  // dialog is disabled and cannot take focus). `select` is the 409: the value is kept and ready to be overtyped.
  const [focusRequest, setFocusRequest] = useState<{ select: boolean } | null>(null)

  useEffect(() => {
    if (!focusRequest) return
    inputRef.current?.focus()
    if (focusRequest.select) inputRef.current?.select()
  }, [focusRequest])

  const code = capitalise(value.trim())
  const canSave = !gone && code !== '' && code !== (employee.code ?? '')

  const handleSubmit = async () => {
    setDialogError(null)
    if (!SHAPE.test(code)) {
      setFieldError(t.errors.invalid)
      setFocusRequest({ select: false })
      return
    }
    setFieldError(null)
    setBusy(true)
    let saved: ReceiptCodeEmployee
    try {
      saved = await putCode(employee.userId, code)
    } catch (error) {
      setBusy(false)
      const kind = receiptCodeErrorCode(error)
      if (kind === 'receipt_code_invalid') {
        setFieldError(t.errors.invalid)
        setFocusRequest({ select: false })
      } else if (kind === 'receipt_code_in_use') {
        setFieldError(t.errors.inUse)
        setFocusRequest({ select: true })
      } else if (kind === 'employee_not_found') {
        setGone(true)
        onNotFound?.()
        setDialogError(t.errors.notFound)
      } else if (kind === 'forbidden' || (error instanceof ApiError && error.status === 403)) {
        setDialogError(tc.forbidden)
      } else {
        setDialogError(tc.genericError)
      }
      return
    }
    onSaved(saved)
  }

  return (
    <FormDialog
      title={t.dialog.title(employee.name ?? employee.email)}
      description={t.dialog.description(employee.initials)}
      size="sm"
      submitLabel={t.dialog.save}
      busyLabel={t.dialog.busy}
      cancelLabel={tc.cancel}
      closeLabel={tc.cancel}
      busy={busy}
      canSubmit={canSave}
      error={dialogError}
      onSubmit={() => void handleSubmit()}
      onCancel={onCancel}
      testIdPrefix="receipt-code"
    >
      <Field
        label={t.dialog.field}
        hint={t.dialog.hint}
        error={fieldError && <span data-testid="receipt-code-field-error">{fieldError}</span>}
        errorRole="alert"
        required
      >
        {(control) => (
          <input
            {...control}
            ref={inputRef}
            type="text"
            className="font-mono"
            value={value}
            onChange={(event) => {
              setValue(capitalise(event.target.value))
              setFieldError(null)
            }}
            onBlur={() => {
              // A non-empty value of the wrong shape is said at once; an empty one only keeps Save disabled.
              if (code !== '' && !SHAPE.test(code)) setFieldError(t.errors.invalid)
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-testid="receipt-code-field"
          />
        )}
      </Field>
    </FormDialog>
  )
}
