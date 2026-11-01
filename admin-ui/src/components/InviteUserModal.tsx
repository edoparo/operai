/**
 * InviteUserModal — Modal N1 (T12, specs/006-user-invitations, design.md
 * "Modal N1 (Invite user)").
 *
 * A `FormDialog` with the email field and two library `CheckboxGroupField`s
 * (direct roles, departments), the same group UserDetail and
 * DepartmentDetail use (decisions D-62); each list scrolls inside the dialog.
 *
 * Presentational: all data/callbacks arrive via props. `InvitationsPage.tsx`
 * owns the field state and the `POST /admin/invitations` call, mapping 409s
 * (AC-1.3/1.4) and 422s onto `emailError`/`generalError` (design.md F1 step 3).
 *
 * A11y (mirrors CreateRoleModal.tsx's contract):
 *   • role="dialog" aria-modal="true" aria-labelledby
 *   • Focus trap across every enabled, currently-rendered focusable element.
 *   • Default focus: the Email field.
 *   • Escape = Cancel; backdrop click = Cancel.
 *   • Submit stays disabled (not hidden) until the email is non-empty and
 *     well-formed (design.md: "a screen-reader user tabbing to it gets a
 *     consistent, explorable control").
 */

import { useEffect, useRef, useState } from 'react'
import { CheckboxGroupField, Field, FormDialog } from '@operai/ui'
import type { Department, Role } from '../lib/adminApi'
import { strings } from '../strings'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_FORMAT_ERROR = strings.users.invite.dialog.emailFormat

// ---------------------------------------------------------------------------
// InviteUserModal
// ---------------------------------------------------------------------------

export type InviteUserModalProps = {
  email: string
  onEmailChange: (value: string) => void
  roles: Role[]
  departments: Department[]
  selectedRoleIds: ReadonlySet<string>
  onToggleRole: (id: string) => void
  selectedDepartmentIds: ReadonlySet<string>
  onToggleDepartment: (id: string) => void
  onSubmit: () => void
  onCancel: () => void
  /** Whether the `POST /admin/invitations` request is currently in-flight. */
  submitting: boolean
  /** Field-level error under Email — client-side format errors AND 409s (AC-1.3/1.4); null = none. */
  emailError: string | null
  /** Non-field error banner (e.g. 422 unknown role/department id); null = none. */
  generalError: string | null
}

export default function InviteUserModal({
  email,
  onEmailChange,
  roles,
  departments,
  selectedRoleIds,
  onToggleRole,
  selectedDepartmentIds,
  onToggleDepartment,
  onSubmit,
  onCancel,
  submitting,
  emailError,
  generalError,
}: InviteUserModalProps) {
  const trimmedEmail = email.trim()
  // Submit is disabled only while nothing is typed (INC-16); a malformed
  // address is explained on submit and on blur, never by a dead button.
  const canSubmit = trimmedEmail.length > 0 && !submitting

  const [formatError, setFormatError] = useState<string | null>(null)
  const shownEmailError = emailError ?? formatError
  const emailRef = useRef<HTMLInputElement>(null)

  // A server-side email error (409) moves focus back to the field.
  useEffect(() => {
    if (emailError) emailRef.current?.focus()
  }, [emailError])

  const handleSubmit = () => {
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setFormatError(EMAIL_FORMAT_ERROR)
      emailRef.current?.focus()
      return
    }
    onSubmit()
  }

  return (
    <FormDialog
      title={strings.users.invite.dialog.title}
      size="sm"
      submitLabel={strings.users.invite.dialog.submit}
      busyLabel={strings.users.invite.dialog.busy}
      cancelLabel={strings.common.actions.cancel}
      closeLabel={strings.common.actions.cancel}
      busy={submitting}
      canSubmit={canSubmit}
      error={null}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      testIdPrefix="invite-user"
      backdropTestId="invite-user-modal"
    >
      <Field
        label={strings.common.fields.email}
        required
        error={
          shownEmailError && (
            <span role="alert" data-testid="invite-user-email-error">
              {shownEmailError}
            </span>
          )
        }
      >
        {(control) => (
          <input
            {...control}
            ref={emailRef}
            type="email"
            value={email}
            onChange={(e) => {
              setFormatError(null)
              onEmailChange(e.target.value)
            }}
            onBlur={() => {
              if (trimmedEmail !== '' && !EMAIL_PATTERN.test(trimmedEmail)) setFormatError(EMAIL_FORMAT_ERROR)
            }}
            disabled={submitting}
            data-testid="invite-user-email"
          />
        )}
      </Field>

      <CheckboxGroupField
        label={strings.common.fields.roles}
        emptyState={strings.users.invite.dialog.noRoles}
        options={roles.map((option) => ({ id: option.id, label: option.name }))}
        selected={selectedRoleIds}
        onToggle={(id) => onToggleRole(id)}
        disabled={submitting}
        scroll
        optionTestIdPrefix="invite-user-role"
      />

      <CheckboxGroupField
        label={strings.common.fields.departments}
        emptyState={strings.users.invite.dialog.noDepartments}
        options={departments.map((option) => ({ id: option.id, label: option.name }))}
        selected={selectedDepartmentIds}
        onToggle={(id) => onToggleDepartment(id)}
        disabled={submitting}
        scroll
        optionTestIdPrefix="invite-user-department"
      />

      {generalError && (
        <p role="alert" data-testid="invite-user-general-error" className="form-error">
          {generalError}
        </p>
      )}
    </FormDialog>
  )
}
