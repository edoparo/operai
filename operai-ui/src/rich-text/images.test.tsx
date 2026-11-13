/**
 * @vitest-environment jsdom
 *
 * Images in rich text: the editor uploads a chosen picture and keeps only its file id; a document
 * shows an image only through the app's resolver (never a URL of its own); RichTextView renders a
 * document read-only as React elements; the doc helpers map and find image ids.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RichTextEditor } from './RichTextEditor'
import type { RichTextDoc, RichTextImages } from './RichTextEditor'
import { RichTextView } from './RichTextView'
import { imageFileIds, isEmptyRichText, mapImageFileIds } from './doc'
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
const imageCopy = {
  insert: 'Insert image',
  uploading: 'Uploading image…',
  loading: 'Loading image…',
  unavailable: 'Image not available',
}

const images = (overrides: Partial<RichTextImages> = {}): RichTextImages => ({
  upload: vi.fn(async () => 'file-1'),
  resolveUrl: vi.fn(async (id: string) => `https://bucket.test/${id}`),
  accept: 'image/png,image/jpeg',
  copy: imageCopy,
  ...overrides,
})

const withImage = (fileId: string): RichTextDoc => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'See' }] },
    { type: 'image', attrs: { fileId, alt: 'Screenshot' } },
  ],
})

describe('RichTextEditor with images', () => {
  it('a chosen picture is uploaded and kept in the document as its file id, never a URL', async () => {
    const onChange = vi.fn()
    const options = images()
    render(
      <RichTextEditor
        initialValue={null}
        onChange={onChange}
        label="Description"
        copy={copy}
        images={options}
        testIdPrefix="t"
      />,
    )
    const png = new File(['x'], 'Screen shot.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('t-image-input'), png)

    await waitFor(() => expect(options.upload).toHaveBeenCalledWith(png))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Screen shot' }).getAttribute('src')).toBe('https://bucket.test/file-1'),
    )
    const [latest] = onChange.mock.calls.at(-1)! as [RichTextDoc]
    expect(imageFileIds(latest)).toEqual(['file-1'])
    expect(JSON.stringify(latest)).not.toContain('https://')
  })

  it('a refused upload leaves the text as it was and is reported to the app', async () => {
    const onChange = vi.fn()
    const onError = vi.fn()
    const failure = new Error('too large')
    render(
      <RichTextEditor
        initialValue={null}
        onChange={onChange}
        label="Description"
        copy={copy}
        images={images({ upload: vi.fn(async () => Promise.reject(failure)), onError })}
        testIdPrefix="t"
      />,
    )
    const png = new File(['x'], 'big.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('t-image-input'), png)
    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure, png))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a stored image through the resolver, and says so when it cannot', async () => {
    render(
      <RichTextEditor
        initialValue={withImage('gone')}
        onChange={() => {}}
        label="Description"
        copy={copy}
        images={images({ resolveUrl: vi.fn(async () => Promise.reject(new Error('404'))) })}
        testIdPrefix="t"
      />,
    )
    expect(await screen.findByText('Image not available')).toBeTruthy()
  })

  it('without `images` there is no image button, and an image node is never fetched from anywhere', () => {
    render(
      <RichTextEditor
        initialValue={withImage('file-1')}
        onChange={() => {}}
        label="Description"
        copy={copy}
        testIdPrefix="t"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull()
    expect(document.querySelector('img[src]')).toBeNull()
  })
})

describe('RichTextView', () => {
  it('renders the editor nodes as elements, marks included, and nothing it does not know', async () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://evil.example' } }] },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done thing' }] }],
            },
          ],
        },
        { type: 'script', attrs: { src: 'https://evil.example/x.js' } },
        { type: 'image', attrs: { fileId: 'file-9', alt: 'Diagram' } },
      ],
    }
    const resolve = vi.fn(async (id: string) => `https://bucket.test/${id}`)
    render(
      <RichTextView
        doc={doc}
        resolveImageUrl={resolve}
        imageCopy={imageCopy}
        checkCopy={{ done: 'done', todo: 'to do' }}
        testId="view"
      />,
    )
    const view = screen.getByTestId('view')
    expect(view.querySelector('h3')?.textContent).toBe('Plan')
    expect(view.querySelector('strong')?.textContent).toBe('bold')
    expect(view.querySelector('a')).toBeNull()
    expect(view.querySelector('script')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'done' })).toHaveProperty('checked', true)
    expect((await screen.findByRole('img', { name: 'Diagram' })).getAttribute('src')).toBe('https://bucket.test/file-9')
    expect(resolve).toHaveBeenCalledWith('file-9')
  })

  it('without a resolver shows no image at all', () => {
    render(<RichTextView doc={withImage('file-1')} testId="view" />)
    expect(screen.getByTestId('view').querySelector('img')).toBeNull()
  })
})

describe('doc helpers', () => {
  it('find, map and drop image ids; a document of whitespace is empty', () => {
    const doc = withImage('local-1')
    expect(imageFileIds(doc)).toEqual(['local-1'])
    expect(imageFileIds(mapImageFileIds(doc, () => 'stored-1'))).toEqual(['stored-1'])
    const dropped = mapImageFileIds(doc, () => null)
    expect(imageFileIds(dropped)).toEqual([])
    expect(dropped.content).toHaveLength(1)
    expect(
      isEmptyRichText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }] }),
    ).toBe(true)
    expect(isEmptyRichText({ type: 'doc', content: [{ type: 'image', attrs: { fileId: 'x' } }] })).toBe(false)
    expect(isEmptyRichText(null)).toBe(true)
  })
})
