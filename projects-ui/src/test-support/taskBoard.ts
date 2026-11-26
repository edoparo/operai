/**
 * Tests only: driving a task board (`TaskBoard`) the way a person does — open a card's drawer, drag a card with the
 * keyboard. A keyboard drag in jsdom needs `stubLayoutForBoard()` (from `@operai/ui/board`) first: jsdom lays nothing
 * out, so there would be no lane to move to.
 */
import { act, fireEvent, screen, within } from '@testing-library/react'

/** Clicks the card `${prefix}-${id}` and returns the drawer it opens (scoped queries: `within(drawer)`). */
export async function openCard(prefix: string, id: string) {
  fireEvent.click(await screen.findByTestId(`${prefix}-${id}`))
  return within(await screen.findByTestId('task-drawer'))
}

/** Closes the open drawer with its × button. */
export function closeDrawer() {
  fireEvent.click(screen.getByTestId('task-drawer-close'))
}

const press = async (target: Element, code: string) => {
  await act(async () => {
    fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Picks the card up with Space, moves it `lanes` lanes (positive: right, negative: left) and drops it with Space, as
 * the board's keyboard contract says. Lanes left to right: Open, In progress, Done.
 */
export async function dragCard(card: HTMLElement, lanes: number) {
  card.focus()
  await press(card, 'Space')
  for (let step = 0; step < Math.abs(lanes); step += 1) await press(card, lanes > 0 ? 'ArrowRight' : 'ArrowLeft')
  await press(card, 'Space')
}

/** The cards of one lane (`${base}-lane-${lane}`), as their test ids, in order. */
export function laneCards(base: string, lane: 'open' | 'in_progress' | 'done', prefix: string): string[] {
  return within(screen.getByTestId(`${base}-lane-${lane}`))
    .queryAllByTestId(new RegExp(`^${prefix}-[^-]+$`))
    .map((card) => card.getAttribute('data-testid') ?? '')
}

/** The value of one labelled fact in a task's drawer (`due`, `assignee`, `participants`, `project`, `company`, …). */
export function factValue(prefix: string, id: string, fact: string): string {
  return screen.getByTestId(`${prefix}-${id}-fact-${fact}`).nextElementSibling?.textContent ?? ''
}
