import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from './Card'
import { PageHeader } from './PageHeader'
import { TabNav, tabLinkClassName } from './TabNav'
import { ToolLayout } from './ToolLayout'

/**
 * A tool's own frame inside the shell: the tool title (the page's one h1), its
 * `TabNav`, then the routed page in one of three columns — `narrow` (40rem) for
 * a single form, `default` (64rem) for lists and detail pages, `wide` (90rem)
 * for data-dense workspaces. The shell owns everything around it (header,
 * sidebar, session, the one `<main>`): a tool never renders chrome or a
 * `<main>` of its own.
 */
const meta = {
  title: 'Components/Layout/ToolLayout',
  component: ToolLayout,
  tags: ['autodocs'],
  parameters: { frame: 'page' },
  args: { title: 'Catalogue', width: 'default', children: null },
  argTypes: {
    width: { control: 'inline-radio', options: ['narrow', 'default', 'wide'] },
    title: { control: 'text' },
    children: { control: false },
    nav: { control: false },
  },
} satisfies Meta<typeof ToolLayout>
export default meta

type Story = StoryObj<typeof meta>

function Nav() {
  const [active, setActive] = useState('items')
  const tab = (id: string, text: string) => (
    <a
      href={`#${id}`}
      className={tabLinkClassName}
      aria-current={active === id ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault()
        setActive(id)
      }}
    >
      {text}
    </a>
  )
  return (
    <TabNav label="Catalogue sections" end={tab('settings', 'Settings')}>
      {tab('items', 'Items')}
      {tab('collections', 'Collections')}
      {tab('suppliers', 'Suppliers')}
    </TabNav>
  )
}

const page = (width: string) => (
  <>
    <PageHeader title="Items" description={`A page in the ${width} column.`} />
    <Card title="Content">
      <p className="text-sm text-soft">The routed page renders here, inside the tool column.</p>
    </Card>
  </>
)

export const Playground: Story = {
  render: (args) => (
    <ToolLayout {...args} nav={<Nav />}>
      {page(args.width ?? 'default')}
    </ToolLayout>
  ),
}

/** 64rem: lists and detail pages, the column most tools use. */
export const DefaultWidth: Story = {
  name: 'Default width, with tabs',
  parameters: { controls: { disable: true } },
  render: () => (
    <ToolLayout title="Catalogue" nav={<Nav />}>
      {page('default')}
    </ToolLayout>
  ),
}

/** 40rem: a single form or a profile. */
export const Narrow: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ToolLayout title="Catalogue" width="narrow" nav={<Nav />}>
      {page('narrow')}
    </ToolLayout>
  ),
}

/** 90rem: a data-dense workspace. */
export const Wide: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ToolLayout title="Catalogue" width="wide" nav={<Nav />}>
      {page('wide')}
    </ToolLayout>
  ),
}

/** A single-screen tool has no tabs. */
export const WithoutTabs: Story = {
  name: 'Without tabs',
  parameters: { controls: { disable: true } },
  render: () => <ToolLayout title="Catalogue">{page('default')}</ToolLayout>,
}
