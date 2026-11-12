/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RichTextEditor } from './RichTextEditor'
import type { RichTextDoc } from './RichTextEditor'
import { stubLayoutForRichText } from './jsdomLayout'

stubLayoutForRichText()

afterEach(cleanup)

const copy = {
  toolbar: 'Formatting',
  bold: 'Bold',
  italic: 'Italic',
  heading: 'Heading',
  bulletList: 'Bulleted list',
  orderedList: 'Numbered list',
  taskList: 'Checklist',
}

const doc = (text: string): RichTextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('RichTextEditor', () => {
  it('is a labelled multi-line text box with a toolbar of toggles', () => {
    render(<RichTextEditor initialValue={doc('Hello')} onChange={() => {}} label="My notes" copy={copy} testIdPrefix="t" />)
    const box = screen.getByRole('textbox', { name: 'My notes' })
    expect(box.getAttribute('aria-multiline')).toBe('true')
    expect(box.textContent).toBe('Hello')
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    for (const name of Object.values(copy).slice(1)) {
      expect(toolbar.querySelector(`[aria-label="${name}"]`)?.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('a toolbar button changes the document and says it is on', async () => {
    const onChange = vi.fn()
    render(<RichTextEditor initialValue={doc('Point')} onChange={onChange} label="My notes" copy={copy} testIdPrefix="t" />)
    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
    expect(screen.getByRole('button', { name: 'Bulleted list' }).getAttribute('aria-pressed')).toBe('true')
    const [latest, length] = onChange.mock.calls.at(-1)! as [RichTextDoc, number]
    expect(latest.content?.[0]?.type).toBe('bulletList')
    expect(length).toBe(5)
    expect(screen.getByRole('textbox', { name: 'My notes' }).querySelector('ul li')?.textContent).toBe('Point')
  })

  it('renders a stored document through its schema: no link, no script, no unknown node', () => {
    const hostile = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'link', attrs: { href: 'https://evil.example' } }], text: 'click' }] },
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      ],
    } as RichTextDoc
    render(<RichTextEditor initialValue={hostile} onChange={() => {}} label="My notes" copy={copy} testIdPrefix="t" />)
    const box = screen.getByRole('textbox', { name: 'My notes' })
    expect(box.querySelector('a')).toBeNull()
    expect(box.querySelector('script')).toBeNull()
  })

  it('read-only: no toolbar, not editable', () => {
    render(<RichTextEditor initialValue={doc('Fixed')} onChange={() => {}} label="My notes" readOnly copy={copy} testIdPrefix="t" />)
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'My notes' }).getAttribute('contenteditable')).toBe('false')
  })
})
