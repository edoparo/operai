import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FloatingPanel, GLIDE_MS, PERIMETER_MARGIN, frameOf, placeOnPerimeter, snapToPerimeter } from './FloatingPanel'
import type { PerimeterPosition } from './FloatingPanel'

afterEach(cleanup)

const frame = { left: 0, top: 0, width: 1000, height: 600 }
const size = { width: 200, height: 40 }

describe('perimeter geometry', () => {
  it('places a panel on each edge, offset along it, never outside the frame', () => {
    expect(placeOnPerimeter({ edge: 'bottom', offset: 1 }, size, frame)).toEqual({ left: 800, top: 560 })
    expect(placeOnPerimeter({ edge: 'top', offset: 0.5 }, size, frame)).toEqual({ left: 400, top: 0 })
    expect(placeOnPerimeter({ edge: 'left', offset: 0 }, size, frame)).toEqual({ left: 0, top: 0 })
    expect(placeOnPerimeter({ edge: 'right', offset: 2 }, size, frame)).toEqual({ left: 800, top: 560 })
  })

  it('snaps a dropped panel to the nearest edge and keeps its place along it', () => {
    expect(snapToPerimeter({ left: 300, top: 540 }, size, frame)).toEqual({ edge: 'bottom', offset: 300 / 800 })
    expect(snapToPerimeter({ left: 790, top: 200 }, size, frame)).toEqual({ edge: 'right', offset: 200 / 560 })
    expect(snapToPerimeter({ left: 400, top: 10 }, size, frame)).toEqual({ edge: 'top', offset: 0.5 })
    expect(snapToPerimeter({ left: -50, top: 280 }, size, frame)).toEqual({ edge: 'left', offset: 0.5 })
  })

  it('a drop outside the window is clamped into it first', () => {
    expect(snapToPerimeter({ left: 5000, top: 5000 }, size, frame)).toEqual({ edge: 'bottom', offset: 1 })
  })

  it('the frame keeps the insets clear and a margin on every side', () => {
    expect(frameOf(1000, 600, { top: 56, bottom: 30 })).toEqual({
      left: PERIMETER_MARGIN,
      top: 56 + PERIMETER_MARGIN,
      width: 1000 - 2 * PERIMETER_MARGIN,
      height: 600 - 56 - 30 - 2 * PERIMETER_MARGIN,
    })
  })
})

describe('FloatingPanel', () => {
  const renderPanel = (position: PerimeterPosition, onPositionChange = vi.fn()) => {
    render(
      <FloatingPanel
        label="Recording in progress"
        moveLabel="Move the recorder"
        moveHint="Arrow keys move it"
        position={position}
        onPositionChange={onPositionChange}
      >
        <span>content</span>
      </FloatingPanel>,
    )
    return onPositionChange
  }

  it('is a named region with a move handle that names its keys, and takes no focus by itself', () => {
    renderPanel({ edge: 'bottom', offset: 1 })
    expect(screen.getByRole('region', { name: 'Recording in progress' })).toBeInTheDocument()
    const handle = screen.getByRole('button', { name: 'Move the recorder' })
    expect(handle).toHaveAccessibleDescription('Arrow keys move it')
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('an arrow key moves it a step and snaps it back to the perimeter', () => {
    const onChange = renderPanel({ edge: 'bottom', offset: 1 })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move the recorder' }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as PerimeterPosition
    // jsdom measures nothing (0 x 0), so from the bottom-right corner one step up lands on the right edge
    expect(next.edge).toBe('right')
    expect(next.offset).toBeLessThan(1)
  })

  it('only a move the person makes glides: a re-render with a new position from outside does not', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { rerender } = render(
      <FloatingPanel
        label="R"
        moveLabel="Move"
        moveHint="Keys"
        position={{ edge: 'bottom', offset: 1 }}
        onPositionChange={onChange}
      >
        <span>a</span>
      </FloatingPanel>,
    )
    const region = screen.getByRole('region', { name: 'R' })
    expect(region).not.toHaveClass('floating-panel-moving')
    rerender(
      <FloatingPanel
        label="R"
        moveLabel="Move"
        moveHint="Keys"
        position={{ edge: 'top', offset: 0 }}
        onPositionChange={onChange}
      >
        <span>a much longer content</span>
      </FloatingPanel>,
    )
    expect(region).not.toHaveClass('floating-panel-moving')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move' }), { key: 'ArrowDown' })
    expect(region).toHaveClass('floating-panel-moving')
    act(() => {
      vi.advanceTimersByTime(GLIDE_MS + 100)
    })
    expect(region).not.toHaveClass('floating-panel-moving')
    vi.useRealTimers()
  })

  it('other keys do nothing', () => {
    const onChange = renderPanel({ edge: 'bottom', offset: 1 })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move the recorder' }), { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dragging the handle reports the snapped position on release', () => {
    const onChange = renderPanel({ edge: 'bottom', offset: 1 })
    const handle = screen.getByRole('button', { name: 'Move the recorder' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 900, clientY: 700, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 400, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((onChange.mock.calls[0]![0] as PerimeterPosition).edge).toBe('left')
  })
})
