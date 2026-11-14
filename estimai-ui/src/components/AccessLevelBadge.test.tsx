/**
 * @vitest-environment jsdom
 *
 * Component tests for AccessLevelBadge (T14, specs/20260807-estimate-sharing/
 * tasks.md, design.md Component inventory / Accessibility → "Estimates list
 * (S6)").
 *
 * Covers: both variants render an icon AND a text label naming the access
 * level (INC-31: an SVG icon, never a Unicode glyph), the icon is
 * aria-hidden so the visible text label alone carries the accessible name
 * ("Editor"/"Viewer"), and never color alone.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AccessLevelBadge from './AccessLevelBadge'
import { strings } from '../strings'

afterEach(() => {
  cleanup()
})

describe('AccessLevelBadge', () => {
  it.each([
    ['editor', strings.sharing.dialog.levelEditor],
    ['viewer', strings.sharing.dialog.levelViewer],
    ['oversight', strings.sharing.dialog.levelOversight],
  ] as const)('renders the %s variant with its icon and label text', (level, label) => {
    render(<AccessLevelBadge level={level} />)

    const badge = screen.getByTestId('access-level-badge')
    expect(badge.textContent).toBe(label)
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('the glyph is aria-hidden — the visible text label alone carries the accessible name', () => {
    render(<AccessLevelBadge level="editor" />)

    const badge = screen.getByTestId('access-level-badge')
    const glyphSpan = badge.querySelector('[aria-hidden="true"]')
    expect(glyphSpan?.querySelector('svg')).not.toBeNull()
    expect(glyphSpan?.textContent).toBe('')

    // The label text renders outside the aria-hidden glyph span, so it is
    // exposed to assistive tech as ordinary text content (not aria-label-only).
    expect(badge.textContent).toContain(strings.sharing.dialog.levelEditor)
  })

  it('exposes "Editor"/"Viewer" as the accessible name (not a raw glyph or level key)', () => {
    render(<AccessLevelBadge level="viewer" />)
    expect(screen.getByText(strings.sharing.dialog.levelViewer)).toBeTruthy()
  })

  it('uses a different color per variant (never color-only, but distinct anyway)', () => {
    const colors = (['editor', 'viewer'] as const).map((level) => {
      const { container } = render(<AccessLevelBadge level={level} />)
      const badge = container.querySelector('[data-testid="access-level-badge"]') as HTMLElement
      const color = badge.className
      cleanup()
      return color
    })

    expect(new Set(colors).size).toBe(2)
  })
})

describe('AccessLevelBadge — oversight (specs/20261108-estimate-list-oversight)', () => {
  it('is told apart from Viewer by its label text, not by its (shared) eye glyph', () => {
    const { unmount } = render(<AccessLevelBadge level="oversight" />)
    const oversight = screen.getByTestId('access-level-badge').textContent
    unmount()
    render(<AccessLevelBadge level="viewer" />)

    expect(oversight).toBe(strings.sharing.dialog.levelOversight)
    expect(oversight).not.toBe(screen.getByTestId('access-level-badge').textContent)
  })
})
