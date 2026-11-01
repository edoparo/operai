import { useRef } from 'react'
import { Icon } from './Icon'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button, buttonClassName } from './Button'
import { PageHeader } from './PageHeader'
import { StatusBadge } from './StatusBadge'

/**
 * The top of every page inside a tool: an optional back link, the title (h2),
 * a status badge beside it (outside the heading, so not part of its name), a
 * one-line description and the page-level actions on the right — at most one
 * `primary`. A detail page always has a back link: a `.link` with an
 * aria-hidden arrow.
 */
const meta = {
  title: 'Components/Layout/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
  args: { title: 'Items', description: 'Everything the catalogue offers, newest change first.' },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [1, 2] },
    actions: { control: false },
    back: { control: false },
    status: { control: false },
  },
} satisfies Meta<typeof PageHeader>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const TitleOnly: Story = {
  name: 'Title only',
  args: { title: 'Items', description: undefined },
}

export const WithDescription: Story = {
  name: 'With a description',
  args: { title: 'Items', description: 'Everything the catalogue offers, newest change first.' },
}

export const WithActions: Story = {
  name: 'With actions',
  args: {
    title: 'Items',
    description: 'Everything the catalogue offers, newest change first.',
    actions: (
      <>
        <Button onClick={fn()}>Export</Button>
        <a href="#new" className={buttonClassName({ variant: 'primary' })}>
          New item
        </a>
      </>
    ),
  },
}

const back = (
  <a href="#items" className="link">
    <Icon name="arrow-left" /> Back to items
  </a>
)

export const WithBackLink: Story = {
  name: 'With a back link',
  args: { title: 'Oak desk lamp', description: undefined, back },
}

/** A detail page: back link, title with its status, and the record's actions. */
export const DetailPage: Story = {
  name: 'Detail page (back, status, actions)',
  args: {
    title: 'Oak desk lamp',
    description: 'CAT-0104 · Lighting',
    back,
    status: <StatusBadge status="active">Available</StatusBadge>,
    actions: (
      <>
        <Button onClick={fn()}>Edit</Button>
        <Button variant="danger" onClick={fn()}>
          Delete
        </Button>
      </>
    ),
  },
}

function FocusableHeadingDemo() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Oak desk lamp" headingRef={headingRef} focusableHeading back={back} />
      <div>
        <Button size="sm" onClick={() => headingRef.current?.focus()}>
          Move focus to the heading
        </Button>
      </div>
      <p className="text-xs text-soft">
        A page reached after an action, or a state that replaces the page, moves focus to its heading so a screen-reader
        user hears where they are. The heading gets tabIndex −1: focusable by script, never a tab stop. In an app use{' '}
        <code className="font-mono">useFocusOnMount()</code> for the ref.
      </p>
    </div>
  )
}

export const FocusableHeading: Story = {
  name: 'Focusable heading',
  parameters: { controls: { disable: true } },
  render: () => <FocusableHeadingDemo />,
}
