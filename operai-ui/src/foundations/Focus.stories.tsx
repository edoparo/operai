import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { ListRows, listRowClassName, listRowMetaClassName } from '../components/ListRows'
import { StatusBadge } from '../components/StatusBadge'
import { TabNav, tabLinkClassName } from '../components/TabNav'
import { Tabs, tabPanelProps } from '../components/Tabs'
import { Icon } from '../components/Icon'

/**
 * One keyboard focus ring for every focusable element: a 2px `--focus-ring`
 * outline (= `--acc-hi`, at least 5.2:1 on every surface in both themes),
 * drawn by `tokens.css` on `:focus-visible`. Text fields show focus with their
 * accent border instead. Never remove it; a component that draws its own
 * indicator must keep at least 3:1.
 */
const meta: Meta = {
  title: 'Foundations/Focus',
  parameters: { controls: { disable: true } },
}
export default meta

function KeyboardTour() {
  const id = useId()
  const [tab, setTab] = useState<'one' | 'two'>('one')
  const [section, setSection] = useState('first')
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-soft">
        Click the canvas, then press <kbd className="font-mono">Tab</kbd> to walk through every control. The ring only
        appears for keyboard focus, not on a mouse click.
      </p>
      <Card title="Links and buttons">
        <p className="text-sm">
          An inline{' '}
          <a href={`#${id}-link`} className="link">
            text link
          </a>{' '}
          and every button variant:
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button iconOnly aria-label="Edit">
            <Icon name="pencil" />
          </Button>
        </div>
      </Card>
      <Card title="Section tabs and in-page tabs">
        <TabNav label="Example sections">
          {['first', 'second', 'third'].map((name) => (
            <a
              key={name}
              href={`#${id}-${name}`}
              className={tabLinkClassName}
              aria-current={section === name ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                setSection(name)
              }}
            >
              {name[0].toUpperCase() + name.slice(1)} section
            </a>
          ))}
        </TabNav>
        <Tabs
          label="Example views"
          idPrefix={`${id}-views`}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'one', label: 'First view' },
            { id: 'two', label: 'Second view' },
          ]}
        />
        <div {...tabPanelProps(`${id}-views`, tab)} className="text-sm text-soft">
          {tab === 'one' ? 'The first view. Arrow keys move between the tabs.' : 'The second view.'}
        </div>
      </Card>
      <Card title="Form controls and rows">
        <Field label="A text field shows focus with its border">{(control) => <input {...control} />}</Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" /> A checkbox gets the ring
        </label>
        <ListRows label="Example rows">
          <a href={`#${id}-row`} className={listRowClassName}>
            <span className="flex items-center gap-3">
              <StatusBadge status="active">Available</StatusBadge>
              <span className={listRowMetaClassName}>A whole-row link</span>
            </span>
          </a>
        </ListRows>
      </Card>
    </div>
  )
}

export const KeyboardWalkthrough: StoryObj = {
  name: 'Keyboard walkthrough',
  render: () => <KeyboardTour />,
}

/** What the ring looks like, drawn statically on each surface (outline utilities in the focus colour). */
export const RingOnEverySurface: StoryObj = {
  name: 'Ring on every surface',
  render: () => (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
      {[
        ['bg-ink', 'Page (ink)'],
        ['bg-ink-soft', 'Panel (ink-soft)'],
        ['bg-ink-mid', 'Control (ink-mid)'],
      ].map(([surface, label]) => (
        <div key={surface} className={`flex flex-col items-start gap-3 rounded-md border border-rule p-4 ${surface}`}>
          <span className="font-mono text-2xs text-soft">{label}</span>
          <span className="btn btn-secondary outline-2 outline-offset-2 outline-acc-hi outline-solid">Button</span>
          <span className="link rounded-xs outline-2 outline-offset-2 outline-acc-hi outline-solid">Text link</span>
        </div>
      ))}
    </div>
  ),
}
