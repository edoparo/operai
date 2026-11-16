/**
 * @vitest-environment jsdom
 *
 * The outline's "Supplied by the CRM" group (specs/20261115-crm-offer-wizard T66; AC-12.1, AC-12.9; design S13, D-27, G17):
 * one row per issuer field the text uses, last section of the card, never an input, absent when there is none.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import OutlineView from './OutlineView'
import { outline, suppliedFields } from '../../lib/offerEngine/outline'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const w = strings.templates.wizardEditor

const BASE = `@@salutation Spett.le

## OGGETTO
@@step scope
Fornitore [EMITTENTE], sede [SEDE]. Oggetto [PROGETTO].

@@field PROGETTO
label: Progetto
`
const EMITTENTE = '\n@@field EMITTENTE\nlabel: Emittente\nsource: issuer\n'
const SEDE = '\n@@field SEDE\nlabel: Sede dell’emittente\nsource: issuerAddress\n'

const show = (source: string, stale = false) => {
  const { ast } = parseTemplate(source)
  render(<OutlineView outline={outline(ast, null)} supplied={suppliedFields(ast)} stale={stale} language="it" />)
}
const group = () => screen.queryByRole('region', { name: w.supplied.title })

afterEach(cleanup)

describe('the "Supplied by the CRM" group', () => {
  it('lists the legal name and the address in order of first use, each marked as locked and from the profile', () => {
    show(BASE + EMITTENTE + SEDE)
    const rows = within(group()!).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain(w.supplied.issuer)
    expect(rows[0]!.textContent).toContain('Emittente')
    expect(rows[1]!.textContent).toContain(w.supplied.issuerAddress)
    expect(rows[1]!.textContent).toContain('Sede dell’emittente')
    for (const row of rows) expect(row.textContent).toContain(w.supplied.badge)
    expect(within(group()!).getByText(w.supplied.hint)).not.toBeNull()
  })

  it('is the last section of the card, after the steps', () => {
    show(BASE + EMITTENTE + SEDE)
    const card = screen.getByTestId('crm-template-outline')
    const headings = within(card)
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)
    expect(headings[headings.length - 1]).toBe(w.supplied.title)
    expect(headings.indexOf(strings.offerWizard.steps.scope)).toBeLessThan(headings.indexOf(w.supplied.title))
  })

  it('is never an input and carries no "optional" tag', () => {
    show(BASE + EMITTENTE + SEDE)
    expect(within(group()!).queryAllByRole('textbox')).toEqual([])
    expect(within(group()!).queryByText(w.optional)).toBeNull()
  })

  it('does not ask for them in the steps', () => {
    show(BASE + EMITTENTE + SEDE)
    // only the field the wizard asks for is a form item; the two supplied ones are not repeated above the group
    expect(screen.getAllByText('Progetto')).toHaveLength(1)
  })

  it('lists only what the text uses: a declared field nobody prints is not listed', () => {
    show(BASE.replace(', sede [SEDE]', '') + EMITTENTE + SEDE)
    const rows = within(group()!).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain(w.supplied.issuer)
  })

  it('names a field by its identifier when the author gave it no label', () => {
    show(BASE + '\n@@field EMITTENTE\nsource: issuer\n' + SEDE)
    expect(within(group()!).getByText('EMITTENTE')).not.toBeNull()
  })

  it('is absent, with no empty text, when the text uses no issuer field', () => {
    show(BASE.replace('Fornitore [EMITTENTE], sede [SEDE]. ', ''))
    expect(group()).toBeNull()
    expect(screen.queryByText(w.supplied.title)).toBeNull()
  })

  it('a template whose only items are supplied still says there is nothing to ask, then shows the group', () => {
    show(`@@salutation S\n\n## A\n@@step scope\n[EMITTENTE]\n${EMITTENTE}`)
    expect(screen.getByText(w.outlineEmpty.title)).not.toBeNull()
    expect(group()).not.toBeNull()
  })
})
