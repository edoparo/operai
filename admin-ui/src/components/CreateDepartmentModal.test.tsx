/**
 * @vitest-environment jsdom
 *
 * Component tests for CreateDepartmentModal — Modal M2 (T19,
 * specs/004-auth-roles-permissions).
 *
 * Covers:
 *   (A) role="dialog" labelled by the title; default focus on the Name field.
 *   (B) Escape calls onCancel.
 *   (C) focus trap: Tab from the last focusable (Create) wraps to the first
 *       (Name input); Shift+Tab from the first wraps to the last.
 *   (D) client-side validation: empty name blocks submit (no onSubmit call)
 *       and shows an inline error; never disables Cancel.
 *   (E) valid submit calls onSubmit with the trimmed name/description,
 *       omitting `description` entirely when blank.
 *   (F) isSubmitting disables all fields/buttons and shows "Creating…".
 *   (G) server errorMessage (e.g. 409) renders inline; a subsequent local
 *       validation error would take precedence only if re-triggered (not
 *       tested here beyond confirming the prop renders as expected).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CreateDepartmentModal from './CreateDepartmentModal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const baseProps = {
  isSubmitting: false,
  errorMessage: null,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
}

describe('CreateDepartmentModal', () => {
  it('renders as a dialog labelled by its title, focused on the Name field', () => {
    render(<CreateDepartmentModal {...baseProps} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('New department')
    expect(screen.getByText('New department')).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('create-department-name-input'))
  })

  it('Escape calls onCancel', () => {
    const onCancel = vi.fn()
    render(<CreateDepartmentModal {...baseProps} onCancel={onCancel} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // The library dialog traps Tab over every enabled control, the header × included (first stop).
  it('traps Tab from the last focusable (Create) back to the first (×)', () => {
    render(<CreateDepartmentModal {...baseProps} />)

    const closeBtn = screen.getByTestId('create-department-close')
    const createBtn = screen.getByTestId('create-department-submit')
    createBtn.focus()
    expect(document.activeElement).toBe(createBtn)

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(document.activeElement).toBe(closeBtn)
  })

  it('traps Shift+Tab from the first focusable (×) to the last (Create)', () => {
    render(<CreateDepartmentModal {...baseProps} />)

    const closeBtn = screen.getByTestId('create-department-close')
    const createBtn = screen.getByTestId('create-department-submit')
    closeBtn.focus()
    expect(document.activeElement).toBe(closeBtn)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(createBtn)
  })

  it('blocks submit with an inline error when Name is empty', () => {
    const onSubmit = vi.fn()
    render(<CreateDepartmentModal {...baseProps} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('create-department-submit'))

    expect(onSubmit).not.toHaveBeenCalled()
    // INC-16: a field error on the Name field itself — announced, marking the
    // control invalid, describing it, and focus moved to it.
    const error = screen.getByTestId('create-department-name-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toBe('Name is required.')
    const input = screen.getByTestId('create-department-name-input')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(error.parentElement?.id)
    expect(document.activeElement).toBe(input)
    expect(screen.getByTestId('create-department-cancel').hasAttribute('disabled')).toBe(false)
  })

  it('marks Name required with aria-required, never "(required)"/"(optional)" label text', () => {
    render(<CreateDepartmentModal {...baseProps} />)

    expect(screen.getByTestId('create-department-name-input').getAttribute('aria-required')).toBe('true')
    expect(screen.getByTestId('create-department-modal').textContent).not.toMatch(/\((required|optional)\)/)
  })

  it('validates a name typed then cleared on blur, and clears the error as the admin types', () => {
    render(<CreateDepartmentModal {...baseProps} />)

    const input = screen.getByTestId('create-department-name-input')
    fireEvent.change(input, { target: { value: 'Ops' } })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('create-department-name-error').textContent).toBe('Name is required.')

    fireEvent.change(input, { target: { value: 'O' } })
    expect(screen.queryByTestId('create-department-name-error')).toBeNull()
  })

  it('submits trimmed name+description on valid input', () => {
    const onSubmit = vi.fn()
    render(<CreateDepartmentModal {...baseProps} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByTestId('create-department-name-input'), {
      target: { value: '  Accounting  ' },
    })
    fireEvent.change(screen.getByTestId('create-department-description-input'), {
      target: { value: '  Finance & billing  ' },
    })
    fireEvent.click(screen.getByTestId('create-department-submit'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Accounting', description: 'Finance & billing' })
  })

  it('omits description when left blank', () => {
    const onSubmit = vi.fn()
    render(<CreateDepartmentModal {...baseProps} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByTestId('create-department-name-input'), {
      target: { value: 'HR' },
    })
    fireEvent.click(screen.getByTestId('create-department-submit'))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'HR', description: undefined })
  })

  it('isSubmitting disables fields/buttons and shows "Creating…"', () => {
    render(<CreateDepartmentModal {...baseProps} isSubmitting={true} />)

    expect(screen.getByTestId('create-department-name-input').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('create-department-description-input').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('create-department-cancel').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('create-department-submit').hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Creating…')).not.toBeNull()
  })

  it('renders a server errorMessage (e.g. 409 duplicate name) inline', () => {
    render(<CreateDepartmentModal {...baseProps} errorMessage='A department named "HR" already exists' />)

    const error = screen.getByTestId('create-department-error')
    expect(error.textContent).toContain('already exists')
  })

  it('clicking Cancel or the "×" calls onCancel', () => {
    const onCancel = vi.fn()
    render(<CreateDepartmentModal {...baseProps} onCancel={onCancel} />)

    fireEvent.click(screen.getByTestId('create-department-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
