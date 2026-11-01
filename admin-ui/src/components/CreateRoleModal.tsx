/**
 * CreateRoleModal — Modal M1 (T17, specs/004-auth-roles-permissions,
 * design.md Screen A1 / F2 step 2: "'New role' → Modal M1 (Create role)
 * (name, description) → `POST /admin/roles`").
 *
 * NEW component (design.md component inventory: "Create-role / Create-
 * department modal (M1/M2) — NEW … structurally simpler than, but modeled
 * on, ConfirmDeleteModal's dialog shell (backdrop, role, header/body/footer,
 * Escape)"). Unlike ConfirmDeleteModal/GuardrailDialog (Dialogs D1/D2), this
 * is a plain `role="dialog"` — design.md restricts `alertdialog` to dialogs
 * that interrupt to demand acknowledgement of something consequential
 * (destructive delete, hard guardrail); a create-entity form has neither, so
 * the ordinary dialog role is correct here.
 *
 * Presentational: all data/callbacks arrive via props. RolesPage.tsx owns
 * the field state and the `POST /admin/roles` call, and maps a `409`
 * (duplicate name) onto `nameError` (design.md F2 step 2: "409 duplicate
 * name → inline field error on the modal, modal stays open").
 *
 * A11y (mirrors ConfirmDeleteModal.tsx's contract):
 *   • role="dialog" aria-modal="true" aria-labelledby + aria-describedby-less
 *     (no single describing paragraph — the form fields ARE the content).
 *   • Focus trap: Tab cycles the Name input → Description input → Cancel →
 *     Create, and back.
 *   • Default focus: the Name field (a create form's natural first control,
 *     unlike a destructive confirm's "safe default is Cancel").
 *   • Escape = Cancel; no submit is triggered.
 *
 * Built on @operai/ui's `FormDialog` (ADR-0050, INC-09): the library owns
 * the frame, the focus trap (every enabled control, × included), Escape /
 * backdrop = Cancel (never while submitting), focus return and the buttons.
 */

import { useEffect, useRef, useState } from 'react'
import { Field, FormDialog } from '@operai/ui'
import { strings } from '../strings'

const ROLE_NAME_REQUIRED = strings.common.nameRequired

export type CreateRoleModalProps = {
  name: string
  description: string
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  /** Whether the `POST /admin/roles` request is currently in-flight. */
  submitting: boolean
  /** Field-level error under the Name input (409 duplicate name); null = none. */
  nameError: string | null
  /** Non-field error banner (any other failure); null = none. */
  generalError: string | null
}

export default function CreateRoleModal({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onSubmit,
  onCancel,
  submitting,
  nameError,
  generalError,
}: CreateRoleModalProps) {
  // Submit stays disabled only while nothing is typed; a name typed then
  // cleared is explained on blur (INC-16).
  const canSubmit = name.trim().length > 0 && !submitting
  const [typed, setTyped] = useState(false)
  const [touched, setTouched] = useState(false)
  const blurError = touched && name.trim() === '' ? ROLE_NAME_REQUIRED : null
  const shownNameError = nameError ?? blurError

  // A rejected name (409) moves focus back to the field.
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (nameError) nameRef.current?.focus()
  }, [nameError])

  return (
    <FormDialog
      title={strings.roles.createDialog.title}
      size="sm"
      submitLabel={strings.roles.createDialog.submit}
      busyLabel={strings.common.actions.creating}
      cancelLabel={strings.common.actions.cancel}
      closeLabel={strings.common.actions.cancel}
      busy={submitting}
      canSubmit={canSubmit}
      error={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      testIdPrefix="create-role"
      backdropTestId="create-role-modal"
    >
      <Field
        label={strings.common.fields.name}
        required
        error={
          shownNameError && (
            <span role="alert" data-testid="create-role-name-error">
              {shownNameError}
            </span>
          )
        }
      >
        {(control) => (
          <input
            {...control}
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => {
              setTyped(true)
              onNameChange(e.target.value)
            }}
            onBlur={() => setTouched(typed)}
            disabled={submitting}
            data-testid="create-role-name"
          />
        )}
      </Field>

      <Field label={strings.common.fields.description}>
        {(control) => (
          <textarea
            {...control}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            disabled={submitting}
            rows={2}
            data-testid="create-role-description"
            className="resize-none"
          />
        )}
      </Field>

      {generalError && (
        <p role="alert" data-testid="create-role-general-error" className="form-error">
          {generalError}
        </p>
      )}
    </FormDialog>
  )
}
