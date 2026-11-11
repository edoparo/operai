import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonChips } from './PersonChips'

afterEach(cleanup)

const people = [
  { id: 'u1', label: 'Anna Rossi' },
  { id: 'u2', label: 'Bruno Bianchi' },
]

describe('PersonChips', () => {
  it('lists the people in a named list', () => {
    render(<PersonChips label="Participants" people={people} removeLabel={(n) => `Remove ${n}`} onRemove={() => {}} />)
    const list = screen.getByRole('list', { name: 'Participants' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Anna Rossi')).toBeInTheDocument()
  })

  it('gives every remove button a name that says whom it removes, and reports the id', async () => {
    const onRemove = vi.fn()
    render(<PersonChips label="Participants" people={people} removeLabel={(n) => `Remove ${n}`} onRemove={onRemove} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bruno Bianchi' }))
    expect(onRemove).toHaveBeenCalledWith('u2')
    expect(screen.getByRole('button', { name: 'Remove Anna Rossi' })).toBeInTheDocument()
  })

  it('renders nothing for an empty list (no empty <ul>)', () => {
    const { container } = render(
      <PersonChips label="Participants" people={[]} removeLabel={(n) => `Remove ${n}`} onRemove={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('without onRemove it is read-only: names, no buttons', () => {
    render(<PersonChips label="Participants" people={people} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Bruno Bianchi')).toBeInTheDocument()
  })

  it('a disabled list keeps the buttons but they cannot be used', async () => {
    const onRemove = vi.fn()
    render(<PersonChips label="P" people={people} removeLabel={(n) => `Remove ${n}`} onRemove={onRemove} disabled />)
    const button = screen.getByRole('button', { name: 'Remove Anna Rossi' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('puts a testid per remove button when asked', () => {
    render(<PersonChips label="P" people={people} removeLabel={(n) => n} onRemove={() => {}} testId="x" />)
    expect(screen.getByTestId('x-remove-u1')).toBeInTheDocument()
  })

  it('after a removal, focus goes to the element the app names (the picker input), not to <body>', async () => {
    const Harness = () => {
      const [list, setList] = useState(people)
      const inputRef = useRef<HTMLInputElement>(null)
      return (
        <>
          <input aria-label="Add" ref={inputRef} />
          <PersonChips
            label="P"
            people={list}
            removeLabel={(n) => `Remove ${n}`}
            onRemove={(id) => setList(list.filter((p) => p.id !== id))}
            focusAfterRemove={() => inputRef.current}
          />
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Anna Rossi' }))
    expect(screen.queryByText('Anna Rossi')).toBeNull()
    expect(screen.getByLabelText('Add')).toHaveFocus()
    // Also when the last chip goes and the list unmounts.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bruno Bianchi' }))
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByLabelText('Add')).toHaveFocus()
  })

  it('without focusAfterRemove nothing is focused by the chips (unchanged behaviour)', async () => {
    render(<PersonChips label="P" people={people} removeLabel={(n) => n} onRemove={() => {}} />)
    const button = screen.getByRole('button', { name: 'Anna Rossi' })
    await userEvent.click(button)
    expect(button).toHaveFocus()
  })

  it('a target that is not there (null) is tolerated', async () => {
    render(
      <PersonChips
        label="P"
        people={people}
        removeLabel={(n) => n}
        onRemove={() => {}}
        focusAfterRemove={() => null}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Anna Rossi' }))
  })
})
