/**
 * @vitest-environment jsdom
 *
 * SaveBar (task T24; design F7, S1, S5; AC-4.1): "Save as version n+1", the status, and the Preview button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { SaveBar } from './SaveBar'
import type { SaveBarProps } from './SaveBar'

afterEach(() => cleanup())

const bar = (over: Partial<SaveBarProps> = {}) => {
  const onSave = vi.fn()
  const onPreview = vi.fn()
  const view = render(
    <SaveBar
      dirty
      nextVersion={4}
      saving={false}
      conflict={false}
      readOnly={false}
      onSave={onSave}
      onPreview={onPreview}
      {...over}
    />,
  )
  return { onSave, onPreview, ...view }
}
const save = () => screen.getByTestId('letterheads-save')

describe('SaveBar', () => {
  it('offers "Save as version n+1" and saves on click when there are changes', async () => {
    const { onSave } = bar()
    expect(save().textContent).toBe('Save as version 4')
    expect(save().getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByTestId('letterheads-status').textContent).toBe('Unsaved changes')
    await userEvent.click(save())
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('says "Save as version 1" for an entity with none', () => {
    bar({ nextVersion: 1 })
    expect(save().textContent).toBe('Save as version 1')
  })

  it('keeps Save focusable but inert, with its reason, while there is nothing to save', async () => {
    const { onSave } = bar({ dirty: false })
    expect(save().getAttribute('aria-disabled')).toBe('true')
    expect((save() as HTMLButtonElement).disabled).toBe(false)
    expect(document.getElementById(save().getAttribute('aria-describedby')!)?.textContent).toBe('No changes to save.')
    expect(screen.getByTestId('letterheads-status').textContent).toBe('No unsaved changes')
    // In the tab order (Preview, then Save): a `disabled` button would be skipped, and its reason never heard.
    await userEvent.tab()
    await userEvent.tab()
    expect(document.activeElement).toBe(save())
    await userEvent.keyboard('{Enter}')
    await userEvent.click(save())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('waits for the reload after a conflict, and says so', async () => {
    const { onSave } = bar({ conflict: true })
    expect(save().getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(save().getAttribute('aria-describedby')!)?.textContent).toBe('Reload first.')
    await userEvent.click(save())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows "Saving…" and ignores clicks while a save runs', async () => {
    const { onSave } = bar({ saving: true })
    expect(save().textContent).toContain('Saving…')
    expect(save().getAttribute('aria-busy')).toBe('true')
    expect(save().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('letterheads-status').textContent).toBe('Saving…')
    await userEvent.click(save())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('opens the preview from its own button, and shows a notice where the person is looking', async () => {
    const { onPreview } = bar({ notice: <p data-testid="notice">Version 4 saved</p> })
    await userEvent.click(screen.getByTestId('letterheads-preview-open'))
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('notice').textContent).toBe('Version 4 saved')
  })

  it('is only the Preview button when the person cannot change the letterhead: no Save, no status', async () => {
    const { onPreview } = bar({ readOnly: true })
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
    expect(screen.queryByTestId('letterheads-status')).toBeNull()
    await userEvent.click(screen.getByTestId('letterheads-preview-open'))
    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('has no accessibility violations, clean, dirty or read-only', async () => {
    for (const over of [{ dirty: false }, { dirty: true }, { readOnly: true }, { conflict: true }]) {
      const { container, unmount } = bar(over)
      expect(await axeViolations(container)).toEqual([])
      unmount()
    }
  })
})
