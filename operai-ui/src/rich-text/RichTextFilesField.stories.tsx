import type { Meta, StoryObj } from '@storybook/react-vite'
import { RichTextFilesField } from './RichTextFilesField'
import type { RichTextFilesFieldProps } from './RichTextFilesField'
import { useDeferredFiles } from './deferredFiles'
import type { DeferredFile } from './deferredFiles'

const STORED: DeferredFile[] = [
  { id: 'f-1', kind: 'attachment', name: 'Offer 0042-2026.pdf', sizeBytes: 2_516_582 },
  { id: 'f-2', kind: 'attachment', name: 'Requirements.docx', sizeBytes: 348_160 },
]

type Args = Omit<RichTextFilesFieldProps, 'files'>

function WithFiles(args: Args) {
  const files = useDeferredFiles(STORED)
  return <RichTextFilesField {...args} files={files} />
}

/**
 * A record's rich text with its pictures and attachments, in a form that saves on submit. Pictures
 * (chosen, pasted or dropped) and attachments are checked, kept in the browser (`useDeferredFiles`) and
 * uploaded by the app after the record is saved; removing a stored attachment only marks it.
 * Imported from `@operai/ui/rich-text`.
 */
const meta = {
  title: 'Components/Forms/RichTextFilesField',
  component: WithFiles,
  tags: ['autodocs'],
  args: {
    label: 'Description',
    placeholder: 'What has to be done, and anything that helps.',
    initialValue: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prepare the demo for Thursday.' }] }] },
    onChange: () => {},
    resolveStoredUrl: () => Promise.reject(new Error('no bucket in Storybook')),
    onDownload: () => {},
    imageAccept: 'image/png,image/jpeg,image/gif,image/webp',
    attachmentAccept: '.pdf,.docx,.xlsx,.pptx,.txt,.csv,image/*',
    check: (file: File) => (file.size > 20 * 1024 * 1024 ? `${file.name} is larger than 20 MB` : null),
    copy: {
      editor: { toolbar: 'Formatting', bold: 'Bold', italic: 'Italic', heading: 'Heading', bulletList: 'Bulleted list', orderedList: 'Numbered list', taskList: 'Checklist' },
      images: { insert: 'Insert image', uploading: 'Adding image…', loading: 'Loading image…', unavailable: 'Image not available' },
      attachments: {
        title: 'Attachments',
        add: 'Attach files',
        adding: 'Uploading…',
        download: (name: string) => `Download ${name}`,
        remove: (name: string) => `Remove ${name}`,
        pending: 'saved with the task',
      },
    },
    testIdPrefix: 'story',
  },
} satisfies Meta<typeof WithFiles>
export default meta

export const Default: StoryObj<typeof meta> = {}
