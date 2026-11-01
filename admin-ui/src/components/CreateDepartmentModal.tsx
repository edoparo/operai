/**
 * CreateDepartmentModal — Modal M2 (design.md "Create-role / Create-department
 * modal (M1/M2)", T19, specs/004-auth-roles-permissions/tasks.md).
 *
 * Small name+description dialog, structurally modeled on
 * `ConfirmDeleteModal`'s dialog shell (backdrop, header/body/footer, Escape)
 * per design.md's component inventory — but genuinely simpler: a plain
 * `role="dialog"` (not `alertdialog`) since creating a department isn't a
 * consequential/destructive action requiring interruption-level ARIA
 * semantics, and a real `<form>` with two fields instead of a single
 * confirm/cancel pair.
 *
 * Presentational: name/description are owned locally (the modal is the only
 * thing that needs them while open); submission and its outcome
 * (isSubmitting / errorMessage — a 409 duplicate-name from
 * `POST /admin/departments`, design.md F3 step 1) are owned by the caller
 * (DepartmentsPage, ../pages/DepartmentsPage.tsx) exactly like
 * ConfirmDeleteModal's idle/deleting/error contract.
 *
 * A11y:
 *   • role="dialog" aria-modal="true" aria-labelledby
 *   • Focus trap across every focusable element inside the FORM (name
 *     input, description textarea, Cancel, Create) — a generalisation of
 *     ConfirmDeleteModal's two-button trap to an arbitrary field count. The
 *     header "×" sits outside the `<form>` and is deliberately excluded
 *     from the ring, exactly like ConfirmDeleteModal's own trap excludes
 *     its header "×" from its two-button cycle.
 *   • Default focus: the Name field (the first thing to fill in).
 *   • Escape = Cancel; backdrop click = Cancel (matches ConfirmDeleteModal).
 *   • Client-side validation (name required) never reaches the network —
 *     the inline error area is shared between that and a 409 from the
 *     server so there is exactly one place errors surface.
 *
 * Built on @operai/ui's `FormDialog` (ADR-0050, INC-09): the library owns
 * the frame, the focus trap (now over every enabled control, the header ×
 * included), Escape/backdrop = Cancel (never while submitting), focus return
 * and the buttons.
 */

import { useRef, useState } from 'react'
import { Field, FormDialog } from '@operai/ui'
import { strings } from '../strings'

const NAME_REQUIRED = strings.common.nameRequired

export type CreateDepartmentModalProps = {
  /** Whether the create request is currently in-flight. */
  isSubmitting: boolean
  /** Server-side error (e.g. 409 duplicate name); null = no error. */
  errorMessage: string | null
  /** Called with the trimmed field values once client-side validation passes. */
  onSubmit: (input: { name: string; description?: string }) => void
  /** Called when the user cancels (clicks "Cancel", "×", or presses Escape). */
  onCancel: () => void
}

export default function CreateDepartmentModal({
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
}: CreateDepartmentModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [typed, setTyped] = useState(false)
  // The Name field's own error (INC-16): set by a failed submit, or on blur
  // of a name typed then cleared; cleared as the admin types.
  const [nameError, setNameError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError(NAME_REQUIRED)
      nameRef.current?.focus()
      return
    }
    setNameError(null)
    const trimmedDescription = description.trim()
    onSubmit({ name: trimmedName, description: trimmedDescription || undefined })
  }

  return (
    <FormDialog
      title={strings.departments.createDialog.title}
      size="sm"
      submitLabel={strings.common.actions.create}
      busyLabel={strings.common.actions.creating}
      cancelLabel={strings.common.actions.cancel}
      closeLabel={strings.common.actions.cancel}
      busy={isSubmitting}
      error={errorMessage}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      testIdPrefix="create-department"
      backdropTestId="create-department-modal"
    >
      <Field
        label={strings.common.fields.name}
        required
        error={
          nameError && (
            <span role="alert" data-testid="create-department-name-error">
              {nameError}
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
            disabled={isSubmitting}
            onChange={(e) => {
              setTyped(true)
              setNameError(null)
              setName(e.target.value)
            }}
            onBlur={() => {
              if (typed && name.trim() === '') setNameError(NAME_REQUIRED)
            }}
            data-testid="create-department-name-input"
          />
        )}
      </Field>

      <Field label={strings.common.fields.description}>
        {(control) => (
          <textarea
            {...control}
            value={description}
            disabled={isSubmitting}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            data-testid="create-department-description-input"
          />
        )}
      </Field>
    </FormDialog>
  )
}
