/**
 * ApproveAccessRequestModal — the approve dialog of the Access requests screen
 * (T9, specs/20261105-signup-gate, design.md S2). A `FormDialog` with the two library
 * `CheckboxGroupField`s (roles, departments), none preselected, exactly like
 * `InviteUserModal` minus the email input (the requester's address is fixed).
 *
 * Presentational: `AccessRequestsPage` owns the selection state and the
 * `POST /admin/access-requests/:id/approve` call, and passes the failure
 * message back as `error` (the dialog stays open). Zero selections is valid
 * (AC-3.2), so submit is enabled whenever nothing is in flight; the helper
 * sentence says what that outcome is and sits before the groups so it is read
 * in order.
 */
import { CheckboxGroupField, FormDialog } from '@operai/ui'
import type { Department, Role } from '../lib/adminApi'
import { strings } from '../strings'

export type ApproveAccessRequestModalProps = {
  name: string
  email: string
  roles: Role[]
  departments: Department[]
  selectedRoleIds: ReadonlySet<string>
  onToggleRole: (id: string) => void
  selectedDepartmentIds: ReadonlySet<string>
  onToggleDepartment: (id: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitting: boolean
  /** Inline failure from the approve call; null = none. */
  error: string | null
}

export default function ApproveAccessRequestModal({
  name,
  email,
  roles,
  departments,
  selectedRoleIds,
  onToggleRole,
  selectedDepartmentIds,
  onToggleDepartment,
  onSubmit,
  onCancel,
  submitting,
  error,
}: ApproveAccessRequestModalProps) {
  const t = strings.accessRequests.approveDialog

  return (
    <FormDialog
      title={t.title}
      description={t.intro(name, email)}
      size="sm"
      submitLabel={t.submit}
      busyLabel={t.busy}
      cancelLabel={strings.common.actions.cancel}
      closeLabel={strings.common.actions.cancel}
      busy={submitting}
      error={error}
      onSubmit={onSubmit}
      onCancel={onCancel}
      testIdPrefix="approve-access-request"
      backdropTestId="approve-access-request-modal"
    >
      <p className="text-sm text-soft" data-testid="approve-access-request-default-access">
        {t.defaultAccess}
      </p>

      <CheckboxGroupField
        label={strings.common.fields.roles}
        emptyState={strings.users.invite.dialog.noRoles}
        options={roles.map((option) => ({ id: option.id, label: option.name }))}
        selected={selectedRoleIds}
        onToggle={(id) => onToggleRole(id)}
        disabled={submitting}
        scroll
        optionTestIdPrefix="approve-access-request-role"
      />

      <CheckboxGroupField
        label={strings.common.fields.departments}
        emptyState={strings.users.invite.dialog.noDepartments}
        options={departments.map((option) => ({ id: option.id, label: option.name }))}
        selected={selectedDepartmentIds}
        onToggle={(id) => onToggleDepartment(id)}
        disabled={submitting}
        scroll
        optionTestIdPrefix="approve-access-request-department"
      />
    </FormDialog>
  )
}
