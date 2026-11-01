/**
 * @vitest-environment jsdom
 *
 * Component tests for SkeletonListRows (T15, specs/004-auth-roles-permissions).
 *
 * Covers:
 *   (A) renders the default 3 rows, aria-hidden (no semantic content of its
 *       own — the parent owns the aria-live loading announcement).
 *   (B) renders a custom row count.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SkeletonListRows from './SkeletonListRows'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SkeletonListRows', () => {
  it('renders 3 placeholder rows by default, aria-hidden', () => {
    render(<SkeletonListRows />)

    const container = screen.getByTestId('skeleton-list-rows')
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(container.children).toHaveLength(3)
  })

  it('renders a custom number of rows', () => {
    render(<SkeletonListRows rows={5} />)

    expect(screen.getByTestId('skeleton-list-rows').children).toHaveLength(5)
  })

  it('exposes no accessible role/text of its own', () => {
    render(<SkeletonListRows />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('announces the load in a polite live region (INC-22)', () => {
    const { container } = render(<SkeletonListRows label="Loading roles…" />)

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('Loading roles…')
  })

  it('announces a generic loading text by default', () => {
    const { container } = render(<SkeletonListRows />)

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Loading…')
  })
})
