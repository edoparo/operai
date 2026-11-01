import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Badge } from './Badge'
import { Banner, CONFIRMATION_DISMISS_MS } from './Banner'
import { Button, buttonClassName } from './Button'
import { DataTable } from './DataTable'
import { Field } from './Field'
import { StatePanel } from './StatePanel'
import { TabNav } from './TabNav'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Button', () => {
  it('defaults to a secondary type="button"', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('btn', 'btn-secondary')
  })

  it('ignores clicks and is aria-busy while busy', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" busy onClick={onClick}>
        Saving…
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Saving…' })
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('builds the class string for a link', () => {
    expect(buttonClassName({ variant: 'primary', size: 'sm' })).toBe('btn btn-primary btn-sm')
  })
})

describe('Badge', () => {
  it('pairs a decorative glyph with its label', () => {
    render(
      <Badge tone="success" glyph="✓">
        Approved
      </Badge>,
    )
    const badge = screen.getByText('Approved').parentElement
    expect(badge).toHaveClass('badge', 'badge-success')
    expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Banner', () => {
  it('is an alert for warning and danger, a polite status otherwise', () => {
    const { rerender } = render(<Banner tone="warning">Could not load</Banner>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    rerender(<Banner tone="success">Saved</Banner>)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders Retry and Dismiss when given handlers', async () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(
      <Banner tone="warning" onRetry={onRetry} retryLabel="Retry" onDismiss={onDismiss} dismissLabel="Dismiss">
        Could not load
      </Banner>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after CONFIRMATION_DISMISS_MS', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <Banner tone="success" onDismiss={onDismiss} dismissLabel="Dismiss" autoDismiss>
        Saved
      </Banner>,
    )
    act(() => vi.advanceTimersByTime(CONFIRMATION_DISMISS_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('Field', () => {
  it('labels the control and describes it with hint and error', () => {
    render(
      <Field label="Amount" hint="In euro" error="Required" required>
        {(control) => <input {...control} />}
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).toHaveAccessibleDescription('In euro Required')
  })

  it('is valid and undescribed without hint or error', () => {
    render(<Field label="Note">{(control) => <input {...control} />}</Field>)
    const input = screen.getByRole('textbox', { name: 'Note' })
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})

describe('DataTable', () => {
  const rows = [
    { id: 'a', name: 'Laptop', price: 'EUR 1,200.00' },
    { id: 'b', name: 'Monitor', price: 'EUR 300.00' },
  ]

  it('renders a captioned table with row headers and numeric cells', () => {
    render(
      <DataTable
        caption="Assets"
        rows={rows}
        getRowKey={(row) => row.id}
        columns={[
          { id: 'name', header: 'Name', rowHeader: true, render: (row) => row.name },
          { id: 'price', header: 'Price', numeric: true, render: (row) => row.price },
        ]}
      />,
    )
    expect(screen.getByRole('table', { name: 'Assets' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Assets' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('rowheader', { name: 'Laptop' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'EUR 300.00' })).toHaveClass('is-numeric')
  })
})

describe('StatePanel', () => {
  it('focuses its heading when asked', () => {
    render(<StatePanel title="No access" role="alert" focusOnMount headingLevel={2} />)
    expect(screen.getByRole('heading', { level: 2, name: 'No access' })).toHaveFocus()
  })
})

describe('TabNav', () => {
  it('wraps each link in a list item inside a labelled nav, skipping absent tabs', () => {
    const canReview = false
    render(
      <TabNav label="Sections">
        <a className="tab-link" href="/a" aria-current="page">
          A
        </a>
        {canReview && <a href="/b">B</a>}
      </TabNav>,
    )
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('Banner auto-dismiss timer', () => {
  it('does not restart when the same message re-renders, and restarts for a new one', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(
      <Banner tone="success" autoDismiss onDismiss={onDismiss} dismissLabel="Dismiss">
        Saved
      </Banner>,
    )
    act(() => vi.advanceTimersByTime(2000))
    // A parent re-render passes the same text again (and a fresh onDismiss).
    rerender(
      <Banner tone="success" autoDismiss onDismiss={() => onDismiss()} dismissLabel="Dismiss">
        Saved
      </Banner>,
    )
    act(() => vi.advanceTimersByTime(1000))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    rerender(
      <Banner tone="success" autoDismiss onDismiss={onDismiss} dismissLabel="Dismiss">
        Deleted
      </Banner>,
    )
    act(() => vi.advanceTimersByTime(2999))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })
})

describe('DataTable detail rows', () => {
  it('renders a full-width detail row only where renderDetail returns content', () => {
    const rows = [
      { id: 'a', name: 'Alpha', open: true },
      { id: 'b', name: 'Beta', open: false },
    ]
    const { container } = render(
      <DataTable
        caption="Entries"
        rows={rows}
        getRowKey={(row) => row.id}
        columns={[
          { id: 'name', header: 'Name', rowHeader: true, render: (row) => row.name },
          { id: 'other', header: 'Other', render: () => '—' },
        ]}
        renderDetail={(row) => (row.open ? `Details of ${row.name}` : null)}
      />,
    )
    const details = container.querySelectorAll('tr.data-table-detail')
    expect(details).toHaveLength(1)
    expect(details[0].querySelector('td')).toHaveAttribute('colspan', '2')
    expect(details[0]).toHaveTextContent('Details of Alpha')
  })
})

describe('Button keeps a typing field focused on mouse press', () => {
  it('prevents the mousedown blur while a text field has focus, and still clicks', async () => {
    const onClick = vi.fn()
    const onBlur = vi.fn()
    render(
      <>
        <input aria-label="Name" onBlur={onBlur} />
        <Button onClick={onClick}>Save</Button>
      </>,
    )
    const input = screen.getByRole('textbox', { name: 'Name' })
    input.focus()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onBlur).not.toHaveBeenCalled()
    expect(input).toHaveFocus()
  })

  it('leaves the default alone when no field is being edited', async () => {
    render(<Button>Open</Button>)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })
})
