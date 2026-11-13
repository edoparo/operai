import type { Meta, StoryObj } from '@storybook/react-vite'
import { RichTextEditor } from './RichTextEditor'

/**
 * WYSIWYG text with a fixed, small set of formats (bold, italic, a heading, bulleted, numbered and check
 * lists), no links; images only with `images` (chosen, pasted or dropped, uploaded by the app and kept as
 * a file id). The document is TipTap JSON, rendered only through the editor's schema.
 * Imported from `@operai/ui/rich-text`, not the main entry: the app that uses it installs TipTap.
 */
const meta = {
  title: 'Components/Forms/RichTextEditor',
  component: RichTextEditor,
  tags: ['autodocs'],
  args: {
    label: 'My notes',
    placeholder: 'Write as the meeting goes.',
    maxLength: 20000,
    initialValue: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Budget' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'They want to start in ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'January' },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ask about the Q3 numbers' }] }] },
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send the offer' }] }] },
          ],
        },
      ],
    },
    onChange: () => {},
    copy: {
      toolbar: 'Formatting',
      bold: 'Bold',
      italic: 'Italic',
      heading: 'Heading',
      bulletList: 'Bulleted list',
      orderedList: 'Numbered list',
      taskList: 'Checklist',
    },
    testIdPrefix: 'story',
  },
} satisfies Meta<typeof RichTextEditor>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { initialValue: null } }

export const ReadOnly: Story = { args: { readOnly: true } }

/** A picture of a chart, standing in for the app's presigned URL. */
const SAMPLE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200"><rect width="480" height="200" fill="#1c1d2b"/><path d="M20 180 L120 120 L220 140 L320 60 L460 40" stroke="#8b96ff" stroke-width="6" fill="none"/></svg>',
  )

/**
 * With images: the toolbar's picture button (or paste, or drop) uploads through the app's `upload` and
 * places the returned file id; `resolveUrl` turns an id into what the browser shows. Here both are fakes.
 */
export const WithImages: Story = {
  args: {
    initialValue: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The dashboard as the client sees it today:' }] },
        { type: 'image', attrs: { fileId: 'sample', alt: 'Usage chart' } },
      ],
    },
    images: {
      upload: () => Promise.resolve('sample'),
      resolveUrl: () => Promise.resolve(SAMPLE_IMAGE),
      accept: 'image/png,image/jpeg,image/gif,image/webp',
      copy: { insert: 'Insert image', uploading: 'Uploading image…', loading: 'Loading image…', unavailable: 'Image not available' },
    },
  },
}
