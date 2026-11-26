import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Board } from './Board'
import type { BoardLane } from './Board'
import { stubLayoutForBoard } from './jsdomLayout'

type Lane = 'todo' | 'doing' | 'done'
type Item = { id: string; title: string; lane: Lane; locked?: boolean }

const LANES: BoardLane<Lane>[] = [
  { id: 'todo', title: 'To do', label: 'To do cards', empty: 'Nothing to do', count: 2 },
  { id: 'doing', title: 'Doing', label: 'Doing cards', empty: 'Nothing in progress' },
  { id: 'done', title: 'Done', label: 'Done cards', empty: 'Nothing done', footer: <button type="button">Older</button> },
]
const ITEMS: Item[] = [
  { id: 'a', title: 'Write the brief', lane: 'todo' },
  { id: 'b', title: 'Book the room', lane: 'todo', locked: true },
]
const COPY = {
  label: 'Work board',
  dragInstructions: 'Space to pick up',
  picked: (item: string, lane: string) => `Picked ${item} in ${lane}`,
  over: (item: string, lane: string) => `${item} over ${lane}`,
  dropped: (item: string, lane: string) => `Dropped ${item} in ${lane}`,
  cancelled: (item: string) => `${item} not moved`,
}

const press = async (target: Element, code: string) => {
  await act(async () => {
    fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const setup = (props: Partial<Parameters<typeof Board<Item, Lane>>[0]> = {}) => {
  const onMove = vi.fn()
  const onOpen = vi.fn()
  render(
    <Board<Item, Lane>
      lanes={LANES}
      items={ITEMS}
      idOf={(item) => item.id}
      laneOf={(item) => item.lane}
      titleOf={(item) => item.title}
      renderCard={(item) => <span>{item.title}</span>}
      canDrag={(item) => !item.locked}
      onMove={onMove}
      onOpen={onOpen}
      copy={COPY}
      testId="board"
      laneTestId={(lane) => `lane-${lane}`}
      cardTestId={(item) => `card-${item.id}`}
      {...props}
    />,
  )
  return { onMove, onOpen }
}

let restore: () => void
beforeEach(() => {
  restore = stubLayoutForBoard()
})
afterEach(() => {
  restore()
  cleanup()
})

describe('Board', () => {
  it('draws one named lane per lane, its cards, its count, its footer, and the empty text of an empty lane', () => {
    setup()
    expect(screen.getByRole('region', { name: 'Work board' })).not.toBeNull()
    const todo = screen.getByRole('region', { name: 'To do cards' })
    expect(within(todo).getAllByRole('listitem')).toHaveLength(2)
    expect(within(todo).getByText('2')).not.toBeNull()
    expect(within(screen.getByTestId('lane-doing')).getByText('Nothing in progress')).not.toBeNull()
    expect(within(screen.getByTestId('lane-done')).getByRole('button', { name: 'Older' })).not.toBeNull()
  })

  it('opens a card on click and on Enter', async () => {
    const { onOpen } = setup()
    fireEvent.click(screen.getByTestId('card-a'))
    expect(onOpen).toHaveBeenCalledWith(ITEMS[0])
    fireEvent.keyDown(screen.getByTestId('card-b'), { key: 'Enter', code: 'Enter' })
    expect(onOpen).toHaveBeenLastCalledWith(ITEMS[1])
  })

  it('moves a card one lane with Space, an arrow and Space, and reports the move', async () => {
    const { onMove } = setup()
    const card = screen.getByTestId('card-a')
    card.focus()
    await press(card, 'Space')
    await press(card, 'ArrowRight')
    await press(card, 'Space')
    expect(onMove).toHaveBeenCalledExactlyOnceWith(ITEMS[0], 'doing')
  })

  it('a card that cannot be dragged is not picked up, and Space opens it', async () => {
    const { onMove, onOpen } = setup()
    const card = screen.getByTestId('card-b')
    card.focus()
    await press(card, 'Space')
    await press(card, 'ArrowRight')
    expect(onMove).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledWith(ITEMS[1])
  })

  it('a lane that refuses the card is skipped: the drop there moves nothing', async () => {
    const { onMove } = setup({ canDrop: (_, lane) => lane !== 'doing' })
    const card = screen.getByTestId('card-a')
    card.focus()
    await press(card, 'Space')
    expect(screen.getByTestId('lane-doing').getAttribute('data-drop')).toBe('refuses')
    await press(card, 'ArrowRight')
    await press(card, 'Space')
    expect(onMove).not.toHaveBeenCalledWith(ITEMS[0], 'doing')
  })

  it('a static card is drawn by the app (a link), with the card surface class', () => {
    setup({
      onMove: undefined,
      staticCard: (item, { className, children, testId }) => (
        <a href={`/items/${item.id}`} className={className} data-testid={testId}>
          {children}
        </a>
      ),
    })
    const link = screen.getByTestId('card-a')
    expect(link.tagName).toBe('A')
    expect(link.className).toContain('board-card')
  })
})
