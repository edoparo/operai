/**
 * @vitest-environment jsdom
 *
 * Component tests for InviteUserModal (T12, specs/20260713-user-invitations,
 * design.md Modal N1).
 *
 * Covers:
 *   (A) role="dialog" (not alertdialog — inviting isn't destructive),
 *       labelled, default focus on Email.
 *   (B) Submit is disabled only while the email is empty; a malformed one is
 *       explained on submit (focus moves to it) and on blur (INC-16).
 *   (C) Filling the roles/departments checkboxes calls onToggleRole/
 *       onToggleDepartment.
 *   (D) Submitting a valid form calls onSubmit.
 *   (E) Escape / Cancel / backdrop click call onCancel.
 *   (F) emailError renders under Email with aria-invalid/aria-describedby;
 *       generalError renders as a banner.
 *   (G) Submitting state disables every control and shows "Sending…".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import InviteUserModal from './InviteUserModal'
import type { Department, Role } from '../lib/adminApi'

afterEach(() => {
  cleanup()
})

const roleAccounting: Role = {
  id: 'role-1',
  name: 'accounting',
  description: null,
  isSystem: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const deptFinance: Department = {
  id: 'dept-1',
  name: 'Finance',
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const baseProps = {
  email: '',
  onEmailChange: vi.fn(),
  roles: [roleAccounting],
  departments: [deptFinance],
  selectedRoleIds: new Set<string>(),
  onToggleRole: vi.fn(),
  selectedDepartmentIds: new Set<string>(),
  onToggleDepartment: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  submitting: false,
  emailError: null,
  generalError: null,
}

describe('InviteUserModal', () => {
  it('renders a role="dialog" (not alertdialog) labelled "Invite user", focused on Email', () => {
    render(<InviteUserModal {...baseProps} />)

    const dialog = screen.getByRole('dialog')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Invite user')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('invite-user-email'))
  })

  it('disables Submit only while the email is empty', () => {
    const { rerender } = render(<InviteUserModal {...baseProps} email="" />)
    expect(screen.getByTestId('invite-user-submit').hasAttribute('disabled')).toBe(true)

    rerender(<InviteUserModal {...baseProps} email="not-an-email" />)
    expect(screen.getByTestId('invite-user-submit').hasAttribute('disabled')).toBe(false)

    rerender(<InviteUserModal {...baseProps} email="alice@welld.ch" />)
    expect(screen.getByTestId('invite-user-submit').hasAttribute('disabled')).toBe(false)
  })

  it('a malformed email is explained on submit, never submitted, and focus moves to the field', () => {
    const onSubmit = vi.fn()
    render(<InviteUserModal {...baseProps} email="not-an-email" onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('invite-user-submit'))

    expect(onSubmit).not.toHaveBeenCalled()
    const input = screen.getByTestId('invite-user-email')
    expect(screen.getByTestId('invite-user-email-error').textContent).toMatch(/valid email address/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input)
  })

  it('a malformed email is explained on blur', () => {
    render(<InviteUserModal {...baseProps} email="alice@" />)

    expect(screen.queryByTestId('invite-user-email-error')).toBeNull()
    fireEvent.blur(screen.getByTestId('invite-user-email'))
    expect(screen.getByTestId('invite-user-email-error').textContent).toMatch(/valid email address/)
  })

  it('marks Email required (aria-required) and has no "(optional)" label text', () => {
    render(<InviteUserModal {...baseProps} />)

    expect(screen.getByTestId('invite-user-email').getAttribute('aria-required')).toBe('true')
    expect(screen.getByTestId('invite-user-modal').textContent).not.toMatch(/\((required|optional)\)/)
  })

  it('checking a role/department checkbox calls onToggleRole/onToggleDepartment', () => {
    const onToggleRole = vi.fn()
    const onToggleDepartment = vi.fn()
    render(<InviteUserModal {...baseProps} onToggleRole={onToggleRole} onToggleDepartment={onToggleDepartment} />)

    fireEvent.click(screen.getByTestId('invite-user-role-role-1'))
    expect(onToggleRole).toHaveBeenCalledWith('role-1')

    fireEvent.click(screen.getByTestId('invite-user-department-dept-1'))
    expect(onToggleDepartment).toHaveBeenCalledWith('dept-1')
  })

  it('roles/departments are optional: an empty catalog shows the "not defined yet" message, not an error', () => {
    render(<InviteUserModal {...baseProps} roles={[]} departments={[]} />)

    expect(screen.getByText('No roles defined yet.')).not.toBeNull()
    expect(screen.getByText('No departments defined yet.')).not.toBeNull()
  })

  it('submitting a well-formed email calls onSubmit', () => {
    const onSubmit = vi.fn()
    render(<InviteUserModal {...baseProps} email="alice@welld.ch" onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('invite-user-submit'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Escape and Cancel call onCancel; the backdrop does not, so typed input survives', () => {
    const onCancel = vi.fn()
    render(<InviteUserModal {...baseProps} onCancel={onCancel} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('invite-user-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTestId('invite-user-modal'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('renders emailError under Email with aria-invalid/aria-describedby (409 AC-1.3/1.4 or client-side format)', () => {
    render(<InviteUserModal {...baseProps} emailError="An invitation is already pending for this email." />)

    const input = screen.getByTestId('invite-user-email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const err = screen.getByTestId('invite-user-email-error')
    expect(input.getAttribute('aria-describedby')).toBe(err.parentElement?.id)
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.textContent).toBe('An invitation is already pending for this email.')
  })

  it('renders generalError as a banner (422 unknown role/department id)', () => {
    render(<InviteUserModal {...baseProps} generalError="Could not create the invitation. Try again." />)

    const err = screen.getByTestId('invite-user-general-error')
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.textContent).toBe('Could not create the invitation. Try again.')
  })

  it('submitting=true shows "Sending…" and disables the form controls', () => {
    render(<InviteUserModal {...baseProps} email="alice@welld.ch" submitting={true} />)

    expect(screen.getByText('Sending…')).not.toBeNull()
    expect(screen.getByTestId('invite-user-email').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('invite-user-cancel').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('invite-user-submit').hasAttribute('disabled')).toBe(true)
  })
})

describe('InviteUserModal domain_not_allowed message (specs/20261105-signup-gate T8, AC-5.1)', () => {
  it('shows the domain message as the email field error, focused, and not as a general error', () => {
    render(
      <InviteUserModal
        {...baseProps}
        email="x@gmail.com"
        emailError="Invitations can only be sent to welld.ch, welld.it addresses."
      />,
    )
    const error = screen.getByTestId('invite-user-email-error')
    expect(error.textContent).toBe('Invitations can only be sent to welld.ch, welld.it addresses.')
    expect(error.getAttribute('role')).toBe('alert')
    expect(screen.queryByTestId('invite-user-general-error')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('invite-user-email'))
  })
})
