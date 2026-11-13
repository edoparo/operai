/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentList } from './AttachmentList'

afterEach(cleanup)

const copy = {
  add: 'Attach files',
  adding: 'Uploading…',
  download: (name: string) => `Download ${name}`,
  remove: (name: string) => `Remove ${name}`,
  pending: 'waiting to upload',
}
const items = [
  { id: 'a', name: 'offer.pdf', sizeBytes: 2_516_582 },
  { id: 'b', name: 'notes.txt', sizeBytes: 300, pending: true },
]

describe('AttachmentList', () => {
  it('lists each file with its size; a stored one downloads, a pending one says it is waiting', async () => {
    const onDownload = vi.fn()
    render(<AttachmentList items={items} onDownload={onDownload} copy={copy} testIdPrefix="f" />)
    await userEvent.click(screen.getByRole('button', { name: 'Download offer.pdf' }))
    expect(onDownload).toHaveBeenCalledWith(items[0])
    expect(screen.queryByRole('button', { name: 'Download notes.txt' })).toBeNull()
    expect(screen.getByTestId('f-item-b').textContent).toContain('waiting to upload')
    expect(screen.getByTestId('f-item-a').textContent).toMatch(/2[.,]4\s?MB/)
  })

  it('a reader gets no add and no remove button; an editor removes and adds several files at once', async () => {
    const { rerender } = render(<AttachmentList items={items} copy={copy} testIdPrefix="f" />)
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByTestId('f-add')).toBeNull()

    const onRemove = vi.fn()
    const onAdd = vi.fn()
    rerender(<AttachmentList items={items} onRemove={onRemove} onAdd={onAdd} copy={copy} testIdPrefix="f" />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove offer.pdf' }))
    expect(onRemove).toHaveBeenCalledWith(items[0])
    const files = [
      new File(['1'], 'a.pdf', { type: 'application/pdf' }),
      new File(['2'], 'b.pdf', { type: 'application/pdf' }),
    ]
    await userEvent.upload(screen.getByTestId('f-input'), files)
    expect(onAdd).toHaveBeenCalledWith(files)
  })

  it('renders nothing for an empty list a reader cannot add to', () => {
    render(<AttachmentList items={[]} copy={copy} testIdPrefix="f" />)
    expect(screen.queryByTestId('f-list')).toBeNull()
  })
})
