import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter } from '@dnd-kit/core'

/** One lane (column) of a board: a stage of a pipeline, a status of a task. */
export type BoardLane<L extends string> = {
  id: L
  /** The lane's heading. */
  title: string
  /** Beside the heading, usually the number of cards. */
  count?: ReactNode
  /** More of the header, under the title: what the lane means, totals. */
  header?: ReactNode
  /** Under the cards: a "show more" button, a note. */
  footer?: ReactNode
  /** Shown in place of the cards when the lane has none. */
  empty: string
  /** The lane's accessible name (`Deals in Qualified`, `Open tasks`). */
  label: string
}

/** Every string the board says, from the app's strings module. */
export type BoardCopy = {
  /** The board region's accessible name. */
  label: string
  /** Read once to a screen reader on a draggable card. */
  dragInstructions: string
  picked: (item: string, lane: string) => string
  over: (item: string, lane: string) => string
  dropped: (item: string, lane: string) => string
  cancelled: (item: string) => string
}

/** What a static card renderer gets: the card surface's class, the content and the test id. */
export type BoardStaticCardProps = { className: string; children: ReactNode; testId: string | undefined }

export type BoardProps<T, L extends string> = {
  lanes: readonly BoardLane<L>[]
  items: readonly T[]
  idOf: (item: T) => string
  laneOf: (item: T) => L
  /** The card's title, for the drag announcements. */
  titleOf: (item: T) => string
  /** The card's content; the board draws the card surface around it. */
  renderCard: (item: T) => ReactNode
  /** The card's accessible name; the title when absent. */
  cardLabel?: (item: T) => string
  /** Whether this card can be picked up at all. Without `onMove`, none can. */
  canDrag?: (item: T) => boolean
  /** Whether this card may be dropped in that lane (its own lane never counts as a move). Default: any. */
  canDrop?: (item: T, lane: L) => boolean
  /** A card was dropped in another lane that accepts it. The board moves nothing itself: the app writes. */
  onMove?: (item: T, lane: L) => void
  /** A click, or Enter, on a card (no drag). */
  onOpen?: (item: T) => void
  /**
   * How a card that cannot be dragged is drawn when it should be a link (middle-click, open in a new tab): the app
   * renders its router's link with the given class and children. Without it such a card opens with `onOpen`.
   */
  staticCard?: (item: T, props: BoardStaticCardProps) => ReactNode
  copy: BoardCopy
  /** The narrowest a lane gets before the board scrolls sideways. Default `14rem`. */
  minLaneWidth?: string
  testId?: string
  laneTestId?: (lane: L) => string
  cardTestId?: (item: T) => string
}

/**
 * Board — cards in lanes, moved between lanes by dragging, in the Jira/GitLab shape (the CRM pipeline, the tasks of a
 * project). The whole card is the drag source:
 * - Pointer: press and move 8 px to drag; a click without moving opens the card (`onOpen`).
 * - Keyboard: a card is one tab stop. Space picks it up, left/right arrows jump a whole lane, Space drops, Escape
 *   cancels, Enter opens. Every step is announced in the app's words.
 * - A lane that does not accept the card being dragged is dimmed and cannot be dropped on.
 *
 * The board only reports the drop (`onMove`); the app performs the write and re-renders with the card in its new lane.
 * Needs `@dnd-kit/core`, which is why it ships from `@operai/ui/board` (README § Board).
 */
export function Board<T, L extends string>({
  lanes,
  items,
  idOf,
  laneOf,
  titleOf,
  renderCard,
  cardLabel,
  canDrag = () => true,
  canDrop = () => true,
  onMove,
  onOpen,
  staticCard,
  copy,
  minLaneWidth = '14rem',
  testId,
  laneTestId,
  cardTestId,
}: BoardProps<T, L>) {
  const [active, setActive] = useState<T | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Enter is left to "open the card"; Space alone picks up and drops.
    useSensor(KeyboardSensor, {
      coordinateGetter: laneCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
  const find = (id: unknown) => items.find((item) => idOf(item) === id)
  const laneTitle = (id: unknown) => lanes.find((lane) => lane.id === id)?.title ?? ''
  const itemTitle = (id: unknown) => {
    const item = find(id)
    return item === undefined ? '' : titleOf(item)
  }
  const draggable = (item: T) => onMove !== undefined && canDrag(item)

  const announcements: Announcements = {
    onDragStart: ({ active: card }) => copy.picked(itemTitle(card.id), laneTitle(card.data.current?.lane)),
    onDragOver: ({ active: card, over }) => (over ? copy.over(itemTitle(card.id), laneTitle(over.id)) : undefined),
    onDragEnd: ({ active: card, over }) =>
      over ? copy.dropped(itemTitle(card.id), laneTitle(over.id)) : copy.cancelled(itemTitle(card.id)),
    onDragCancel: ({ active: card }) => copy.cancelled(itemTitle(card.id)),
  }

  const onDragStart = (event: DragStartEvent) => setActive(find(event.active.id) ?? null)
  const onDragEnd = (event: DragEndEvent) => {
    setActive(null)
    const item = find(event.active.id)
    const target = event.over?.id as L | undefined
    if (item !== undefined && target !== undefined && target !== laneOf(item) && canDrop(item, target)) {
      onMove?.(item, target)
    }
  }

  /** Whether the lane takes the card being dragged (null when nothing is). */
  const accepts = (lane: L): boolean | null =>
    active === null ? null : lane === laneOf(active) || canDrop(active, lane)

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements, screenReaderInstructions: { draggable: copy.dragInstructions } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      {/* A narrow screen scrolls the board, not the page. */}
      <div className="board" role="region" aria-label={copy.label} data-testid={testId}>
        <div
          className="board-lanes"
          style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(${minLaneWidth}, 1fr))` }}
        >
          {lanes.map((lane) => (
            <Lane key={lane.id} lane={lane} accepts={accepts(lane.id)} testId={laneTestId?.(lane.id)}>
              {items
                .filter((item) => laneOf(item) === lane.id)
                .map((item) => (
                  <li key={idOf(item)}>
                    <Card
                      item={item}
                      id={idOf(item)}
                      lane={lane.id}
                      label={cardLabel?.(item) ?? titleOf(item)}
                      draggable={draggable(item)}
                      dragging={active !== null}
                      onOpen={onOpen}
                      staticCard={staticCard}
                      testId={cardTestId?.(item)}
                    >
                      {renderCard(item)}
                    </Card>
                  </li>
                ))}
            </Lane>
          ))}
        </div>
      </div>
      <DragOverlay>{active ? <div className="board-card board-card-overlay">{renderCard(active)}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function Lane<L extends string>({
  lane,
  accepts,
  testId,
  children,
}: {
  lane: BoardLane<L>
  accepts: boolean | null
  testId: string | undefined
  children: ReactNode[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id, disabled: accepts === false })
  const state = accepts === null ? undefined : isOver && accepts ? 'over' : accepts ? 'accepts' : 'refuses'
  return (
    <section ref={setNodeRef} aria-label={lane.label} className="board-lane" data-drop={state} data-testid={testId}>
      <header className="board-lane-header">
        <div className="board-lane-heading">
          <h3 className="board-lane-title">{lane.title}</h3>
          {lane.count !== undefined && <span className="board-lane-count">{lane.count}</span>}
        </div>
        {lane.header}
      </header>
      {children.length > 0 ? <ul className="board-cards">{children}</ul> : <p className="board-empty">{lane.empty}</p>}
      {lane.footer}
    </section>
  )
}

function Card<T, L extends string>({
  item,
  id,
  lane,
  label,
  draggable,
  dragging,
  onOpen,
  staticCard,
  testId,
  children,
}: {
  item: T
  id: string
  lane: L
  label: string
  draggable: boolean
  dragging: boolean
  onOpen: ((item: T) => void) | undefined
  staticCard: ((item: T, props: BoardStaticCardProps) => ReactNode) | undefined
  testId: string | undefined
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { lane }, disabled: !draggable })
  const open = () => onOpen?.(item)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter opens the card, except while a keyboard drag is running.
    if (event.key === 'Enter' && !dragging) {
      event.preventDefault()
      open()
      return
    }
    if (draggable) listeners?.onKeyDown?.(event)
    else if (event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  if (!draggable && staticCard) return staticCard(item, { className: 'board-card board-card-link', children, testId })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(draggable ? listeners : {})}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={open}
      aria-label={label}
      className={`board-card${draggable ? ' board-card-draggable' : ''}`}
      data-dragging={isDragging || undefined}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

/**
 * Keyboard moves jump a whole lane: left/right centre the dragged card on the previous/next lane, so a few presses
 * reach any lane.
 */
export const laneCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined
  event.preventDefault()
  const { collisionRect, droppableRects } = context
  if (!collisionRect) return undefined
  const lanes = [...droppableRects.values()].sort((a, b) => a.left - b.left)
  const centre = collisionRect.left + collisionRect.width / 2
  const next =
    event.code === 'ArrowRight'
      ? lanes.find((lane) => lane.left > centre)
      : [...lanes].reverse().find((lane) => lane.left + lane.width < centre)
  if (!next) return undefined
  return { x: next.left + (next.width - collisionRect.width) / 2, y: next.top + 8 }
}
