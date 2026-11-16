/**
 * @vitest-environment jsdom
 *
 * The wizard's inputs never hand the draft what the server's answers schema refuses (QE D14, design S9: "the UI
 * enforces the same limits"; crm-api `offer-drafts/answersSchema.ts`): a text answer of at most 20 000 characters,
 * and at least one client line. A 422 `answers_invalid` on an ordinary edit pauses autosave with no field named.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FieldInput, { type FieldItem } from './FieldInput'
import ListFieldEditor from './ListFieldEditor'
import { strings } from '../../strings'

const t = strings.offerWizard

const fieldOf = (kind: FieldItem['kind']): FieldItem => ({
  type: 'field',
  name: 'NOTE',
  label: 'Note',
  hint: null,
  example: null,
  kind,
  default: null,
  options: null,
  optional: false,
  derived: false,
  system: null,
  fills: [],
  handEditedIn: [],
})

afterEach(cleanup)

describe.each([
  ['a single-line text', 'text'],
  ['a long text', 'longtext'],
] as const)('%s answer', (_name, kind) => {
  it('takes at most 20 000 characters, so the draft is never refused for its size', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <FieldInput item={fieldOf(kind)} value="" language="en" currency="EUR" missing={false} onChange={onChange} />,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement | HTMLTextAreaElement
    expect(input.maxLength).toBe(20_000)
    await user.click(input)
    await user.paste('x'.repeat(20_001))
    const sent = onChange.mock.calls.map(([value]) => String(value).length)
    expect(sent.filter((length) => length > 20_000)).toEqual([])
  })
})

describe('the last line of a list that must keep one (the client lines)', () => {
  const item = {
    type: 'list' as const,
    name: 'client:lines',
    label: 'Client lines',
    hint: null,
    optional: false,
    handEditedIn: [],
  }

  it('cannot be removed, so the answers never hold an empty list; another can', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <ListFieldEditor item={item} items={['Acme']} language="en" minItems={1} onChange={onChange} />,
    )
    const remove = screen.getByRole('button', { name: t.list.remove(1, 'Client lines') })
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    await user.click(remove)
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <ListFieldEditor item={item} items={['Acme', 'Street 1']} language="en" minItems={1} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: t.list.remove(2, 'Client lines') }))
    expect(onChange).toHaveBeenCalledWith(['Acme'])
  })
})
