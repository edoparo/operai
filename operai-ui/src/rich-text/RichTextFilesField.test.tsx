/**
 * @vitest-environment jsdom
 *
 * A form's rich text with its files: chosen pictures and attachments stay in the browser until the
 * app saves (nothing is uploaded from here), a refused file is said and not kept, removing a stored
 * attachment only marks it, and a local picture is shown from its blob URL.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RichTextFilesField } from './RichTextFilesField'
import { useDeferredFiles } from './deferredFiles'
import type { DeferredFile, DeferredFiles } from './deferredFiles'
import type { RichTextDoc } from './RichTextEditor'
import { imageFileIds } from './doc'
import { stubLayoutForRichText } from './jsdomLayout'

stubLayoutForRichText()
afterEach(cleanup)
beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:local-${++n}`)
  URL.revokeObjectURL = vi.fn()
})

const copy = {
  editor: {
    toolbar: 'Formatting',
    bold: 'Bold',
    italic: 'Italic',
    heading: 'Heading',
    bulletList: 'Bulleted list',
    orderedList: 'Numbered list',
    taskList: 'Checklist',
  },
  images: {
    insert: 'Insert image',
    uploading: 'Uploading image…',
    loading: 'Loading image…',
    unavailable: 'Image not available',
  },
  attachments: {
    title: 'Attachments',
    add: 'Attach files',
    adding: 'Uploading…',
    download: (name: string) => `Download ${name}`,
    remove: (name: string) => `Remove ${name}`,
    pending: 'saved with the task',
  },
}

const STORED: DeferredFile[] = [{ id: 'f-1', kind: 'attachment', name: 'offer.pdf', sizeBytes: 2048 }]

function Harness({ onState, onDoc }: { onState: (files: DeferredFiles) => void; onDoc: (doc: RichTextDoc) => void }) {
  const [stored] = useState(STORED)
  const files = useDeferredFiles(stored)
  onState(files)
  return (
    <RichTextFilesField
      label="Description"
      initialValue={null}
      onChange={(doc) => onDoc(doc)}
      files={files}
      resolveStoredUrl={async (id) => `https://bucket.test/${id}`}
      onDownload={() => {}}
      imageAccept="image/png"
      attachmentAccept="application/pdf"
      check={(file) => (file.size > 10 ? `${file.name} is too large` : null)}
      copy={copy}
      testIdPrefix="d"
    />
  )
}

describe('RichTextFilesField', () => {
  it('keeps chosen attachments and pictures locally until the save; nothing is uploaded from here', async () => {
    let state!: DeferredFiles
    let doc: RichTextDoc | null = null
    render(<Harness onState={(files) => (state = files)} onDoc={(next) => (doc = next)} />)

    await userEvent.upload(
      screen.getByTestId('d-files-input'),
      new File(['pdf'], 'spec.pdf', { type: 'application/pdf' }),
    )
    expect(screen.getByTestId('d-files-list').textContent).toContain('spec.pdf')
    expect(screen.getByTestId('d-files-list').textContent).toContain('saved with the task')

    await userEvent.upload(screen.getByTestId('d-image-input'), new File(['png'], 'chart.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'chart' }).getAttribute('src')).toBe('blob:local-1'))
    expect(state.pending.map((file) => [file.kind, file.name])).toEqual([
      ['attachment', 'spec.pdf'],
      ['image', 'chart.png'],
    ])
    expect(imageFileIds(doc)).toEqual([state.pending[1]!.id])
  })

  it('a refused file is said and not kept; removing a stored attachment only marks it', async () => {
    let state!: DeferredFiles
    render(<Harness onState={(files) => (state = files)} onDoc={() => {}} />)
    await userEvent.upload(
      screen.getByTestId('d-files-input'),
      new File(['x'.repeat(50)], 'huge.pdf', { type: 'application/pdf' }),
    )
    expect(screen.getByRole('alert').textContent).toBe('huge.pdf is too large')
    expect(state.pending).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Remove offer.pdf' }))
    expect(state.removed.map((file) => file.id)).toEqual(['f-1'])
    expect(screen.queryByText('offer.pdf')).toBeNull()
  })
})

describe('RichTextFilesView', () => {
  it('shows the text and the attachments as downloads; nothing at all when there is neither', async () => {
    const { RichTextFilesView } = await import('./RichTextFilesView')
    const onDownload = vi.fn()
    const viewCopy = { images: copy.images, check: { done: 'done', todo: 'to do' }, attachments: copy.attachments }
    const { rerender } = render(
      <RichTextFilesView
        doc={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bring the cables' }] }] }}
        attachments={[{ id: 'f-1', name: 'offer.pdf', sizeBytes: 2048 }]}
        resolveImageUrl={async () => 'https://bucket.test/x'}
        onDownload={onDownload}
        copy={viewCopy}
        testIdPrefix="v"
      />,
    )
    expect(screen.getByTestId('v-text').textContent).toBe('Bring the cables')
    await userEvent.click(screen.getByRole('button', { name: 'Download offer.pdf' }))
    expect(onDownload).toHaveBeenCalledWith({ id: 'f-1', name: 'offer.pdf', sizeBytes: 2048 })
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()

    rerender(<RichTextFilesView doc={null} attachments={[]} resolveImageUrl={async () => ''} onDownload={onDownload} copy={viewCopy} testIdPrefix="v" />)
    expect(screen.queryByTestId('v-view')).toBeNull()
  })
})
