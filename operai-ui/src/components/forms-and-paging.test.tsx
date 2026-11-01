import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Dialog } from './Dialog'
import { CheckboxGroupField } from './Field'
import { LoadMore } from './LoadMore'
import { DateInput, MoneyInput, parseDecimal } from './MoneyInput'
import { Pagination } from './Pagination'

afterEach(cleanup)

describe('parseDecimal', () => {
  it('reads a dot or a comma as the decimal separator, into integer cents', () => {
    expect(parseDecimal('45.50')).toBe(4550)
    expect(parseDecimal('45,5')).toBe(4550)
    expect(parseDecimal(' 1299 ')).toBe(129900)
    expect(parseDecimal('0,05')).toBe(5)
  })

  it('parses the string exactly, never through a float', () => {
    // 1.15 * 100 === 114.99999999999999 in floating point.
    expect(parseDecimal('1.15')).toBe(115)
    expect(parseDecimal('0.29')).toBe(29)
  })

  it('refuses what is not an amount instead of guessing', () => {
    for (const raw of ['', '12.345', '-3', '1.2.3', '1,000.50', 'abc', '.5', '5.']) {
      expect(parseDecimal(raw)).toBeNull()
    }
  })

  it('takes the number of decimals, e.g. micros for a mileage rate', () => {
    expect(parseDecimal('0,4321', 6)).toBe(432100)
    expect(parseDecimal('0.000001', 6)).toBe(1)
    expect(parseDecimal('0.0000001', 6)).toBeNull()
  })
})

describe('MoneyInput and DateInput', () => {
  it('MoneyInput is a text field with the decimal keypad, figures in mono', () => {
    render(<MoneyInput aria-label="Amount" defaultValue="12,50" />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input).toHaveClass('input-figure')
  })

  it('DateInput is a native date field', () => {
    render(<DateInput aria-label="Date" defaultValue="2026-10-31" />)
    expect(screen.getByLabelText('Date')).toHaveAttribute('type', 'date')
  })
})

describe('Pagination', () => {
  const props = {
    pageSize: 25,
    total: 60,
    label: 'Users pages',
    previousLabel: 'Previous',
    nextLabel: 'Next',
    status: ({ page, totalPages, rangeStart, rangeEnd, total }: Record<string, number>) =>
      `Page ${page} of ${totalPages}, ${rangeStart}–${rangeEnd} of ${total}`,
  }

  it('reports the range and keeps an end button focusable but inert', async () => {
    const onPageChange = vi.fn()
    render(<Pagination {...props} page={1} onPageChange={onPageChange} />)
    expect(screen.getByRole('navigation', { name: 'Users pages' })).toBeInTheDocument()
    expect(screen.getByTestId('pagination-status')).toHaveTextContent('Page 1 of 3, 1–25 of 60')

    const previous = screen.getByRole('button', { name: 'Previous' })
    expect(previous).toHaveAttribute('aria-disabled', 'true')
    expect(previous).not.toBeDisabled()
    await userEvent.click(previous)
    expect(onPageChange).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('clamps the last page range', () => {
    render(<Pagination {...props} page={3} onPageChange={vi.fn()} />)
    expect(screen.getByTestId('pagination-status')).toHaveTextContent('Page 3 of 3, 51–60 of 60')
    expect(screen.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('LoadMore', () => {
  const props = { label: 'Load more', loadingLabel: 'Loading more…' }

  it('ignores clicks while loading and hides itself without a next page', async () => {
    const onLoadMore = vi.fn()
    const { rerender } = render(<LoadMore {...props} hasMore loading onLoadMore={onLoadMore} />)
    const button = screen.getByRole('button', { name: 'Loading more…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onLoadMore).not.toHaveBeenCalled()

    rerender(<LoadMore {...props} hasMore={false} loading={false} onLoadMore={onLoadMore} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows why the last load failed, and the same button retries', async () => {
    const onLoadMore = vi.fn()
    render(<LoadMore {...props} hasMore loading={false} error="Could not load more assets." onLoadMore={onLoadMore} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load more assets.')
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})

describe('page scroll behind dialogs (INC-21)', () => {
  function Harness() {
    const [outer, setOuter] = useState(false)
    const [inner, setInner] = useState(false)
    return (
      <>
        <button onClick={() => setOuter(true)}>Open</button>
        {outer && (
          <Dialog title="Outer" closeLabel="Close" onClose={() => setOuter(false)}>
            <button onClick={() => setInner(true)}>Confirm something</button>
            {inner && (
              <ConfirmDialog
                title="Sure?"
                confirmLabel="Yes"
                busyLabel="…"
                cancelLabel="Cancel"
                closeLabel="Close confirmation"
                busy={false}
                error={null}
                onConfirm={vi.fn()}
                onCancel={() => setInner(false)}
              >
                Body
              </ConfirmDialog>
            )}
          </Dialog>
        )}
      </>
    )
  }

  it('locks while any dialog is open and restores the page value after the last one closes', async () => {
    const user = userEvent.setup()
    document.body.style.overflow = 'auto'
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: 'Confirm something' }))
    await user.keyboard('{Escape}')
    // The confirm closed, the outer dialog is still open: still locked.
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')
  })
})

describe('RadioGroupField and focusFirstInvalid', () => {
  it('is a labelled radiogroup with the Field wiring, and focus goes to its checked radio', async () => {
    const { RadioGroupField, focusFirstInvalid } = await import('./Field')
    const { container } = render(
      <form>
        <input aria-label="Name" />
        <RadioGroupField label="Disposal reason" required error="Pick a reason">
          <label>
            <input type="radio" name="reason" value="sold" /> Sold
          </label>
          <label>
            <input type="radio" name="reason" value="scrapped" defaultChecked /> Scrapped
          </label>
        </RadioGroupField>
      </form>,
    )
    const group = screen.getByRole('radiogroup', { name: 'Disposal reason' })
    expect(group).toHaveAttribute('aria-required', 'true')
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAccessibleDescription('Pick a reason')

    expect(focusFirstInvalid(container)).toBe(true)
    expect(screen.getByRole('radio', { name: 'Scrapped' })).toHaveFocus()
  })

  it('returns false when nothing is invalid', async () => {
    const { focusFirstInvalid } = await import('./Field')
    const { container } = render(<input aria-label="Name" />)
    expect(focusFirstInvalid(container)).toBe(false)
  })
})

describe('CheckboxGroupField', () => {
  const options = [
    { id: 'admin', label: 'Admin' },
    { id: 'accounting', label: 'Accounting' },
  ]

  it('is a named group of labelled checkboxes that reports each toggle', async () => {
    const onToggle = vi.fn()
    render(
      <CheckboxGroupField
        label="Roles"
        hint="Takes effect immediately."
        options={options}
        selected={new Set(['admin'])}
        onToggle={onToggle}
        optionTestIdPrefix="role"
      />,
    )
    const group = screen.getByRole('group', { name: 'Roles' })
    expect(group).toHaveAccessibleDescription('Takes effect immediately.')
    expect(screen.getByRole('checkbox', { name: 'Admin' })).toBeChecked()
    expect(screen.getByTestId('role-accounting')).not.toBeChecked()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Accounting' }))
    expect(onToggle).toHaveBeenCalledWith('accounting', true)
  })

  it('accepts an array, keeps a hidden legend accessible, and disables every option', () => {
    render(
      <CheckboxGroupField label="Departments" hideLabel options={options} selected={['accounting']} onToggle={vi.fn()} disabled />,
    )
    expect(screen.getByRole('group', { name: 'Departments' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Accounting' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Admin' })).toBeDisabled()
  })

  it('shows the empty state when there are no options', () => {
    render(<CheckboxGroupField label="Roles" options={[]} selected={[]} onToggle={vi.fn()} emptyState="No roles yet." />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('No roles yet.')).toBeInTheDocument()
  })
})
