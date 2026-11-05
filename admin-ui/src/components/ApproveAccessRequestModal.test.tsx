/**
 * @vitest-environment jsdom
 *
 * ApproveAccessRequestModal (T9, specs/023, design.md S2): requester shown, roles and
 * departments none preselected, default-access helper, submit/cancel, busy, inline error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ApproveAccessRequestModal from './ApproveAccessRequestModal'
import type { Department, Role } from '../lib/adminApi'

afterEach(cleanup)

const role: Role = { id: 'r1', name: 'accounting', description: null, isSystem: false, createdAt: '', updatedAt: '' }
const dept: Department = { id: 'd1', name: 'Finance', description: null, createdAt: '', updatedAt: '' }

const base = {
  name: 'Ada Lovelace',
  email: 'ada@welld.ch',
  roles: [role],
  departments: [dept],
  selectedRoleIds: new Set<string>(),
  onToggleRole: vi.fn(),
  selectedDepartmentIds: new Set<string>(),
  onToggleDepartment: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  submitting: false,
  error: null,
}

describe('ApproveAccessRequestModal', () => {
  it('is a dialog naming the requester and states the zero-selection outcome', () => {
    render(<ApproveAccessRequestModal {...base} />)
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(screen.getByText('Ada Lovelace (ada@welld.ch) will receive an invitation by email.')).not.toBeNull()
    expect(screen.getByText(/they join as an employee/)).not.toBeNull()
  })

  it('has no preselected role or department and submit is enabled with zero selections (AC-3.2)', () => {
    render(<ApproveAccessRequestModal {...base} />)
    expect((screen.getByRole('checkbox', { name: 'accounting' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Finance' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByTestId('approve-access-request-submit').hasAttribute('disabled')).toBe(false)
  })

  it('toggling calls the handlers; submit and cancel call theirs', () => {
    const onToggleRole = vi.fn()
    const onToggleDepartment = vi.fn()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <ApproveAccessRequestModal
        {...base}
        onToggleRole={onToggleRole}
        onToggleDepartment={onToggleDepartment}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'accounting' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Finance' }))
    expect(onToggleRole).toHaveBeenCalledWith('r1')
    expect(onToggleDepartment).toHaveBeenCalledWith('d1')
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send invitation' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('approve-access-request-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows the inline error and keeps the dialog open', () => {
    render(<ApproveAccessRequestModal {...base} error="boom" />)
    expect(screen.getByRole('alert').textContent).toContain('boom')
  })

  it('while submitting: busy label, submit disabled, controls disabled', () => {
    render(<ApproveAccessRequestModal {...base} submitting />)
    expect(screen.getByRole('button', { name: 'Approving…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'accounting' }).matches(':disabled')).toBe(true)
  })
})
