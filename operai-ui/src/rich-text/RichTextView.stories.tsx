import type { Meta, StoryObj } from '@storybook/react-vite'
import { RichTextView } from './RichTextView'

/**
 * A `RichTextEditor` document shown read-only, as React elements: no editor and no HTML string, so it is
 * light enough for a list and cannot inject markup. Images appear only through `resolveImageUrl`.
 * Imported from `@operai/ui/rich-text`.
 */
const meta = {
  title: 'Components/Data/RichTextView',
  component: RichTextView,
  tags: ['autodocs'],
  args: {
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Before the demo' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bring the ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'test meter' },
            { type: 'text', text: ' and the cables.' },
          ],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book the room' }] }] },
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Print the agenda' }] }] },
          ],
        },
      ],
    },
    checkCopy: { done: 'done', todo: 'to do' },
  },
} satisfies Meta<typeof RichTextView>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
