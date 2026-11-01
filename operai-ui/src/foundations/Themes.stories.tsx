import { useId } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { StatusBadge } from '../components/StatusBadge'

/**
 * Dark is the default theme. `data-theme="light"` on `<html>` (the shell's
 * theme toggle) or the system preference switches to light;
 * `data-theme="dark"` forces dark. Components never pick a theme: they read
 * the tokens, and the light theme only redefines the token values.
 */
const meta: Meta = {
  title: 'Foundations/Themes',
  parameters: { controls: { disable: true } },
}
export default meta

function Sample({ theme }: { theme: string }) {
  const id = useId()
  return (
    <Card title={`${theme} theme`} className="flex-1">
      <p className="text-sm">
        Primary text, <span className="text-soft">secondary text</span> and a{' '}
        <a className="link" href={`#${id}`}>
          text link
        </a>
        .
      </p>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="pending">On order</StatusBadge>
        <StatusBadge status="active">Available</StatusBadge>
        <StatusBadge status="attention">Needs review</StatusBadge>
        <StatusBadge status="failed">Failed</StatusBadge>
      </div>
      <Field label="Name" hint="As customers will see it." required>
        {(control) => <input {...control} defaultValue="Oak desk lamp" />}
      </Field>
      <Banner tone="warning" title="Items unavailable">
        The items could not be loaded.
      </Banner>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary">Save item</Button>
        <Button>Edit</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
    </Card>
  )
}

/**
 * The same content in both themes. The right half sets `data-theme="light"` on
 * its own container, which redefines the tokens for everything inside it.
 * This story locks the toolbar on dark: the tokens have no element-level dark
 * block, so a dark island inside a light page is not possible.
 */
export const SideBySide: StoryObj = {
  name: 'Side by side',
  globals: { theme: 'dark' },
  render: () => (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex flex-1 rounded-lg bg-ink p-4">
        <Sample theme="Dark" />
      </div>
      <div data-theme="light" className="flex flex-1 rounded-lg bg-ink p-4 text-text">
        <Sample theme="Light" />
      </div>
    </div>
  ),
}

/** The same content, following the Theme toolbar: switch it to compare. */
export const FollowsTheToolbar: StoryObj = {
  name: 'Follows the toolbar',
  render: (_args, { globals }) => (
    <div className="flex max-w-xl flex-col gap-3">
      <p className="text-sm text-soft">
        Current theme: <strong className="text-text">{String(globals.theme)}</strong>. Use the Theme toolbar to switch.
      </p>
      <Sample theme={globals.theme === 'light' ? 'Light' : 'Dark'} />
    </div>
  ),
}
