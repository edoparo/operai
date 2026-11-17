/**
 * @vitest-environment jsdom
 *
 * CheckboxField (task T21): one labelled checkbox with the hint and error wiring of `Field`, operable
 * with the keyboard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { CheckboxField } from './CheckboxField'

afterEach(() => cleanup())

describe('CheckboxField', () => {
  it('is a checkbox named by its label, and clicking the label toggles it', async () => {
    const onChange = vi.fn()
    render(<CheckboxField label="Bold" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByText('Bold'))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('checkbox', { name: 'Bold' })).not.toBeNull()
  })

  it('toggles with the space key and takes focus with Tab', async () => {
    const onChange = vi.fn()
    render(<CheckboxField label="Bold" checked onChange={onChange} />)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('checkbox'))
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('shows its state', () => {
    const { rerender } = render(<CheckboxField label="Bold" checked onChange={() => undefined} />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    rerender(<CheckboxField label="Bold" checked={false} onChange={() => undefined} />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('is described by its hint and by its error, and the error marks it invalid', () => {
    render(<CheckboxField label="Bold" checked={false} onChange={() => undefined} hint="A hint" error="Refused" />)
    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('aria-invalid')).toBe('true')
    const described = (box.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['A hint', 'Refused'])
  })

  it('is not invalid and not described when it has neither', () => {
    render(<CheckboxField label="Bold" checked={false} onChange={() => undefined} />)
    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('aria-invalid')).toBeNull()
    expect(box.getAttribute('aria-describedby')).toBeNull()
  })

  it('passes extra props to the input, and honours disabled', async () => {
    const onChange = vi.fn()
    render(<CheckboxField label="Bold" checked={false} onChange={onChange} disabled data-pointer="/x" />)
    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('data-pointer')).toBe('/x')
    await userEvent.click(box)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('has no axe violations, with a hint and an error', async () => {
    const { container } = render(
      <CheckboxField label="Bold" checked={false} onChange={() => undefined} hint="A hint" error="Refused" />,
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
