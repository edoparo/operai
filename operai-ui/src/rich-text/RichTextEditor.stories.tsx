import type { Meta, StoryObj } from '@storybook/react-vite'
import { RichTextEditor } from './RichTextEditor'

/**
 * WYSIWYG text with a fixed, small set of formats (bold, italic, a heading, bulleted, numbered and check
 * lists), no links and no images. The document is TipTap JSON, rendered only through the editor's schema.
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
