/**
 * @vitest-environment jsdom
 *
 * The axe helper of the form's tests must be able to fail: a form control with no label is reported, so a
 * clean result elsewhere means something.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { axeViolations } from './formStateAxe'

afterEach(() => cleanup())

describe('axeViolations', () => {
  it('reports an input without a label', async () => {
    const { container } = render(<input type="text" />)
    expect((await axeViolations(container)).join('\n')).toContain('label')
  })

  it('reports nothing for a labelled input', async () => {
    const { container } = render(
      <label>
        Name <input type="text" />
      </label>,
    )
    expect(await axeViolations(container)).toEqual([])
  })

  it('reports a skipped heading level', async () => {
    const { container } = render(
      <div>
        <h2>One</h2>
        <h4>Three</h4>
      </div>,
    )
    expect((await axeViolations(container)).join('\n')).toContain('heading-order')
  })
})
