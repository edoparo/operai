/**
 * @vitest-environment jsdom
 *
 * ColourInput (task T21): a hex text input with a `#` adornment and a swatch that is decoration only.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { ColourInput } from './ColourInput'

afterEach(() => cleanup())

function Harness({ initial = 'e50339', error }: { initial?: string; error?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <ColourInput label="Colour" value={value} onChange={setValue} error={error} hint="Six digits" />
      <output data-testid="value">{value}</output>
    </>
  )
}

const input = () => screen.getByRole('textbox', { name: 'Colour' }) as HTMLInputElement
const swatch = () => document.querySelector('[data-swatch]') as HTMLElement

describe('ColourInput', () => {
  it('is a text input named by its label, holding the hex without the #', () => {
    render(<Harness />)
    expect(input().value).toBe('e50339')
    expect(input().getAttribute('autocomplete')).toBe('off')
  })

  it('draws a swatch of a valid value and keeps both the # and the swatch out of the accessibility tree', () => {
    render(<Harness />)
    expect(swatch().getAttribute('aria-hidden')).toBe('true')
    expect(swatch().getAttribute('data-swatch')).toBe('e50339')
    expect(swatch().style.backgroundColor).not.toBe('')
    expect(screen.getByText('#').getAttribute('aria-hidden')).toBe('true')
  })

  it('draws no colour for a value that is not six hex digits, and says nothing about it itself', async () => {
    render(<Harness />)
    await userEvent.clear(input())
    await userEvent.type(input(), 'e5033')
    expect(swatch().getAttribute('data-swatch')).toBe('none')
    expect(swatch().style.backgroundColor).toBe('')
    expect(input().getAttribute('aria-invalid')).toBeNull()
  })

  it('does not draw anything from a value that only looks like a colour', () => {
    render(<Harness initial="zzzzzz" />)
    expect(swatch().getAttribute('data-swatch')).toBe('none')
    expect(swatch().style.backgroundColor).toBe('')
  })

  it('drops a typed or pasted leading # and sends the rest as typed (the service lowercases and refuses)', async () => {
    render(<Harness initial="" />)
    await userEvent.click(input())
    await userEvent.paste('#E50339')
    expect(screen.getByTestId('value').textContent).toBe('E50339')
    expect(input().value).toBe('E50339')
    expect(swatch().getAttribute('data-swatch')).toBe('e50339')
  })

  it('drops surrounding spaces when it loses focus', async () => {
    render(<Harness initial="" />)
    await userEvent.type(input(), ' e50339 ')
    expect(screen.getByTestId('value').textContent).toBe(' e50339 ')
    await userEvent.tab()
    expect(screen.getByTestId('value').textContent).toBe('e50339')
  })

  it('shows the hint and the error, wired to the input', () => {
    render(<Harness error="Use six hexadecimal digits, for example e50339." />)
    expect(input().getAttribute('aria-invalid')).toBe('true')
    const described = (input().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['Six digits', 'Use six hexadecimal digits, for example e50339.'])
  })

  it('has no axe violations', async () => {
    const { container } = render(<Harness error="Refused" />)
    expect(await axeViolations(container)).toEqual([])
  })
})
