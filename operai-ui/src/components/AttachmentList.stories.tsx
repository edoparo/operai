import type { Meta, StoryObj } from '@storybook/react-vite'
import { AttachmentList } from './AttachmentList'

/**
 * The files of a record, compact: each name downloads it (when the app can), its size, a remove button for
 * whoever may, and an add button that opens the file dialog for several files. The component asks; the app
 * checks, uploads, downloads and deletes. All copy is a prop.
 */
const meta = {
  title: 'Components/Data/AttachmentList',
  component: AttachmentList,
  tags: ['autodocs'],
  args: {
    items: [
      { id: 'a', name: 'Offer 0042-2026.pdf', sizeBytes: 2_516_582 },
      { id: 'b', name: 'Requirements.docx', sizeBytes: 348_160 },
      { id: 'c', name: 'Site photo.jpg', sizeBytes: 1_048_576, pending: true },
    ],
    onDownload: () => {},
    onRemove: () => {},
    onAdd: () => {},
    copy: {
      add: 'Attach files',
      adding: 'Uploading…',
      download: (name: string) => `Download ${name}`,
      remove: (name: string) => `Remove ${name}`,
      pending: 'waiting to upload',
    },
    testIdPrefix: 'story',
  },
} satisfies Meta<typeof AttachmentList>
export default meta

type Story = StoryObj<typeof meta>

export const Editor: Story = {}

export const Reader: Story = { args: { onRemove: undefined, onAdd: undefined } }

export const Uploading: Story = { args: { adding: true } }
