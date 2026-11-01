import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button } from './Button'
import { Field, focusFirstInvalid } from './Field'
import { FormDialog } from './FormDialog'
import { MoneyInput, parseDecimal } from './MoneyInput'

/**
 * A `dialog` holding a short form (five fields at most). Focus starts on the
 * first field; Enter submits; Cancel is `ghost`, left of the submit button.
 * While busy the fields are disabled as a group and the dialog cannot be
 * dismissed. On failure the dialog stays open with every typed value kept and
 * the error shown above the buttons. Field errors belong on each `Field`.
 */
const meta = {
  title: 'Components/Dialogs/FormDialog',
  component: FormDialog,
  tags: ['autodocs'],
  parameters: { docs: { story: { inline: false, iframeHeight: 520 } } },
  args: {
    title: 'New item',
    description: 'Add the essentials now; everything else can be edited later.',
    submitLabel: 'Create item',
    busyLabel: 'Creating…',
    cancelLabel: 'Cancel',
    closeLabel: 'Close',
    tone: 'primary',
    busy: false,
    canSubmit: true,
    error: null,
    onSubmit: fn(),
    onCancel: fn(),
    children: null,
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['primary', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    title: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    children: { control: false },
  },
} satisfies Meta<typeof FormDialog>
export default meta

type Story = StoryObj<typeof meta>

const fields = (
  <>
    <Field label="Name" required>
      {(control) => <input {...control} defaultValue="Oak desk lamp" />}
    </Field>
    <Field label="Price" hint="In euros, e.g. 45.50.">
      {(control) => <MoneyInput {...control} defaultValue="89.00" />}
    </Field>
  </>
)

/** Static, driven by Controls: busy, error, tone. */
export const Playground: Story = {
  args: { children: fields },
}

export const Busy: Story = {
  args: { children: fields, busy: true },
}

export const WithError: Story = {
  name: 'With a request error',
  args: {
    children: fields,
    error: 'The item could not be created: the server is unavailable. Your input is kept; try again.',
  },
}

/** Submitting is irreversible: the submit button is danger. */
export const Danger: Story = {
  args: {
    tone: 'danger',
    title: 'Archive “Oak desk lamp”',
    description: 'Archived items cannot be ordered. This cannot be undone.',
    submitLabel: 'Archive item',
    busyLabel: 'Archiving…',
    children: (
      <Field label="Reason" required>
        {(control) => <textarea {...control} rows={3} defaultValue="Discontinued by the supplier." />}
      </Field>
    ),
  },
}

function ValidationDemo({ failFirst }: { failFirst: boolean }) {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [touched, setTouched] = useState({ name: false, price: false })
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const attempts = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const form = useRef<HTMLDivElement>(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const nameError = name.trim() === '' ? 'Enter a name.' : undefined
  const priceError =
    price.trim() === ''
      ? 'Enter a price.'
      : parseDecimal(price) === null
        ? 'Enter an amount with at most two decimals.'
        : undefined
  const show = (field: 'name' | 'price') => submitted || touched[field]

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="primary"
        onClick={() => {
          setName('')
          setPrice('')
          setTouched({ name: false, price: false })
          setSubmitted(false)
          setError(null)
          setOpen(true)
        }}
      >
        New item
      </Button>
      <p role="status" className="text-sm text-soft">
        {created ? `“${created}” created.` : ''}
      </p>
      {open && (
        <FormDialog
          title="New item"
          description="Add the essentials now; everything else can be edited later."
          submitLabel="Create item"
          busyLabel="Creating…"
          cancelLabel="Cancel"
          closeLabel="Close"
          busy={busy}
          error={error}
          onCancel={() => setOpen(false)}
          onSubmit={() => {
            setSubmitted(true)
            if (nameError || priceError) {
              // Focus the first invalid field once the errors have rendered.
              window.requestAnimationFrame(() => focusFirstInvalid(form.current))
              return
            }
            setBusy(true)
            setError(null)
            attempts.current += 1
            timer.current = window.setTimeout(() => {
              setBusy(false)
              if (failFirst && attempts.current === 1) {
                setError('The item could not be created: the server is unavailable. Your input is kept; try again.')
                return
              }
              setCreated(name.trim())
              setOpen(false)
            }, 1200)
          }}
        >
          <div ref={form} className="contents">
            <Field label="Name" required error={show('name') ? nameError : undefined}>
              {(control) => (
                <input
                  {...control}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                />
              )}
            </Field>
            <Field
              label="Price"
              hint="In euros, e.g. 45.50 or 45,50."
              required
              error={show('price') ? priceError : undefined}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, price: true }))}
                />
              )}
            </Field>
          </div>
        </FormDialog>
      )}
    </div>
  )
}

/** Validation on blur and on submit; a failed submit focuses the first invalid field. */
export const LiveValidation: Story = {
  name: 'Live: validation',
  parameters: { controls: { disable: true } },
  render: () => <ValidationDemo failFirst={false} />,
}

/** The first submit fails on the server: the error shows inline and the values stay. Submit again to succeed. */
export const LiveServerError: Story = {
  name: 'Live: server error, then retry',
  parameters: { controls: { disable: true } },
  render: () => <ValidationDemo failFirst />,
}
