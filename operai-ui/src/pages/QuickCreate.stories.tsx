import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Field, focusFirstInvalid } from '../components/Field'
import { FormDialog } from '../components/FormDialog'
import { MoneyInput, parseDecimal } from '../components/MoneyInput'
import { PageHeader } from '../components/PageHeader'
import { CatalogueFrame, ItemsTable, t, useLatency } from './catalogue'
import { CATEGORIES, ITEMS } from './fixtures'
import type { Item } from './fixtures'

/**
 * A short form (five fields at most) belongs in a `FormDialog` over the page
 * that needs it. "New item" opens it; focus starts on the first field. Fields
 * are validated on blur and on submit (focus goes to the first invalid one);
 * Create is busy for 1.2s. On success the dialog closes, the new row is added
 * at the top of the table and focused, and a compact success `Banner`
 * confirms. With **outcome** = `failure` the first attempt fails: the error is
 * shown inside the dialog with every value kept; the second attempt succeeds.
 */
type Args = { outcome: 'success' | 'failure' }

const meta: Meta<Args> = {
  title: 'Pages/Quick create in a dialog',
  parameters: { frame: 'page' },
  args: { outcome: 'success' },
  argTypes: { outcome: { control: 'inline-radio', options: ['success', 'failure'] } },
}
export default meta

type Story = StoryObj<Args>

type Draft = { name: string; category: string; price: string }
const EMPTY: Draft = { name: '', category: '', price: '' }

function QuickCreatePage({ outcome }: Args) {
  const titleId = useId()
  const later = useLatency()
  const [items, setItems] = useState<Item[]>(ITEMS.slice(0, 5))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [created, setCreated] = useState<Item | null>(null)
  const [fieldsEl, setFieldsEl] = useState<HTMLDivElement | null>(null)

  const errors = {
    name: draft.name.trim() === '' ? t.form.nameRequired : undefined,
    category: draft.category === '' ? t.form.categoryRequired : undefined,
    price:
      draft.price.trim() === ''
        ? t.form.priceRequired
        : parseDecimal(draft.price) === null
          ? t.form.priceInvalid
          : undefined,
  }
  const shown = (name: keyof Draft) => (submitted || touched[name] ? errors[name] : undefined)
  const blur = (name: keyof Draft) => () => setTouched((current) => ({ ...current, [name]: true }))

  const openDialog = () => {
    setDraft(EMPTY)
    setTouched({})
    setSubmitted(false)
    setError(null)
    setOpen(true)
  }

  const submit = () => {
    setSubmitted(true)
    if (errors.name || errors.category || errors.price) {
      window.requestAnimationFrame(() => focusFirstInvalid(fieldsEl))
      return
    }
    const attempt = attempts + 1
    setAttempts(attempt)
    setBusy(true)
    setError(null)
    later(1200, () => {
      setBusy(false)
      if (outcome === 'failure' && attempt === 1) {
        setError(t.quick.error)
        return
      }
      const item: Item = {
        id: `quick-${attempt}-${items.length}`,
        code: `CAT-${String(300 + items.length).padStart(4, '0')}`,
        name: draft.name.trim(),
        category: draft.category,
        owner: 'Giulia Bianchi',
        status: 'draft',
        priceCents: parseDecimal(draft.price) ?? 0,
        currency: 'EUR',
        updated: '2026-10-31',
        availableFrom: '2026-11-01',
        description: '',
      }
      setItems((current) => [item, ...current])
      setCreated(item)
      setOpen(false)
    })
  }

  return (
    <CatalogueFrame active="items">
      <section aria-labelledby={titleId}>
        <PageHeader
          title={t.list.heading}
          titleId={titleId}
          description={t.list.description}
          actions={
            <Button variant="primary" onClick={openDialog}>
              {t.list.newItem}
            </Button>
          }
        />
        <div className="flex flex-col gap-4">
          {created && (
            <Banner
              tone="success"
              compact
              autoDismiss
              onDismiss={() => setCreated(null)}
              dismissLabel={t.delete.dismiss}
            >
              {t.quick.created(created.name)}
            </Banner>
          )}
          <ItemsTable items={items} focusRowKey={created?.id ?? null} />
        </div>
      </section>
      {open && (
        <FormDialog
          title={t.quick.title}
          description={t.quick.description}
          submitLabel={t.quick.submit}
          busyLabel={t.quick.busy}
          cancelLabel={t.form.cancel}
          closeLabel={t.delete.close}
          busy={busy}
          error={error}
          onCancel={() => setOpen(false)}
          onSubmit={submit}
        >
          <div ref={setFieldsEl} className="contents">
            <Field label={t.form.name} required error={shown('name')}>
              {(control) => (
                <input
                  {...control}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onBlur={blur('name')}
                />
              )}
            </Field>
            <Field label={t.form.category} required error={shown('category')}>
              {(control) => (
                <select
                  {...control}
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  onBlur={blur('category')}
                >
                  <option value="">{t.form.choose}</option>
                  {CATEGORIES.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t.form.price} hint={t.form.priceHint} required error={shown('price')}>
              {(control) => (
                <MoneyInput
                  {...control}
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  onBlur={blur('price')}
                />
              )}
            </Field>
          </div>
        </FormDialog>
      )}
    </CatalogueFrame>
  )
}

export const Default: Story = {
  render: (args) => <QuickCreatePage key={args.outcome} {...args} />,
}

export const FirstAttemptFails: Story = {
  name: 'First attempt fails',
  args: { outcome: 'failure' },
  render: (args) => <QuickCreatePage key={args.outcome} {...args} />,
}
