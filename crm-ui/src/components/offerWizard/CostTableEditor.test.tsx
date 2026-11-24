/**
 * @vitest-environment jsdom
 *
 * The Costs step's table (specs/20261115-crm-offer-wizard T44; AC-2.5, AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.6,
 * AC-4.7; DD-34, DD-35, DD-39, DD-47): template lines with description, unit, quantity and total, total rows in the
 * document's formatting, bound fields edited in the line, extra lines up to the limit, the layout switches, and the
 * engine's `invalid` entries shown on the line they name.
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatMoney } from '@operai/ui'
import OfferWizard from './OfferWizard'
import type { WizardStep } from './steps'
import { initialAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { resolveOffer } from '../../lib/offerEngine/resolve'
import { parseTemplate, type TemplateAst } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear

## SCOPE
@@step scope
Rate [TARIFFA] for [GG] days. Project [NOME].
{{ricorrente::Maintenance is included.}}
{{sconto::A discount applies.}}
{{secondo::A second total is shown.}}

## COSTS
@@step costs
@@costs position unit
@@line dev one_off | Development of **[NOME]** | unit=[TARIFFA] | qty=[GG]
@@OPT_START ricorrente
@@line canone yearly | Yearly fee | unit=? | qty=?
@@OPT_END
@@OPT_START sconto
@@line sconto discount | Goodwill discount | unit=?
@@OPT_END
@@total **TOTAL ONE**
@@OPT_START secondo
@@line extra_line one_off | Second part | unit=100 | qty=1
@@total **TOTAL TWO**
@@OPT_END
@@line scelta option | Optional extra | unit=? | qty=1
@@end

@@field TARIFFA
label: Day rate
kind: amount

@@field GG
label: Days
kind: number

@@field NOME
label: Project name

@@block ricorrente
label: Maintenance

@@block sconto
label: Discount

@@block secondo
label: Second part
`

const ast = parseTemplate(SOURCE).ast
const context = { ...sampleContext('en'), estimate: null }

function Form({
  start,
  first = 'costs',
  template = ast,
}: {
  start?: (answers: WizardAnswers) => WizardAnswers
  first?: WizardStep
  template?: TemplateAst
}) {
  const tree = useMemo(() => template, [template])
  const [step, setStep] = useState<WizardStep>(first)
  const [answers, setAnswers] = useState(() => {
    const initial = initialAnswers(tree, context)
    return start ? start(initial) : initial
  })
  return (
    <>
      <OfferWizard
        mode="sample"
        ast={tree}
        answers={answers}
        onAnswersChange={setAnswers}
        context={context}
        step={step}
        onStepChange={setStep}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

const stored = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}') as WizardAnswers
const filled =
  (patch: (a: WizardAnswers) => void) =>
  (a: WizardAnswers): WizardAnswers => {
    const next = structuredClone(a)
    next.fields.NOME = 'Atlas'
    next.fields.TARIFFA = 80_000
    next.fields.GG = '10'
    patch(next)
    return next
  }
const exact = (label: string): RegExp => new RegExp(`^${label.replace(/[()]/g, '\\$&')}`)
const costCard = (name: string): HTMLElement => screen.getByRole('group', { name })

afterEach(cleanup)

describe('CostTableEditor — lines (AC-4.1)', () => {
  it('shows a template line with its description, unit price, quantity and total', () => {
    render(<Form start={filled(() => undefined)} />)
    const card = costCard('Development of Atlas')
    expect(within(card).getByText(t.costs.kind.one_off)).not.toBeNull()
    expect((within(card).getByLabelText(/Day rate/) as HTMLInputElement).value).toBe('800.00')
    expect((within(card).getByLabelText(/Days/) as HTMLInputElement).value).toBe('10')
    expect(within(card).getByText(formatMoney(800_000, 'CHF'))).not.toBeNull()
  })

  it('shows the line description as plain text: markup is stripped and a value `**x**` stays literal (DD-47)', () => {
    render(<Form start={filled((a) => (a.fields.NOME = '**Bold**'))} />)
    expect(costCard('Development of **Bold**')).not.toBeNull()
  })

  it('marks a missing value inside the description with the label', () => {
    render(<Form />)
    const card = screen.getByRole('group', { name: /Development of/ })
    const mark = card.querySelector('mark')
    expect(mark?.textContent).toContain('Project name')
    expect(within(card).getByText(t.preview.missing, { exact: false })).not.toBeNull()
  })

  it('edits the bound field from the line, and the field changes the line (AC-4.2)', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    const unit = within(costCard('Development of Atlas')).getByLabelText(/Day rate/)
    await user.clear(unit)
    await user.type(unit, '900')
    expect(stored().fields.TARIFFA).toBe(90_000)
    // the same field in the Scope step
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.scope) }))
    expect((screen.getByLabelText(/Day rate/) as HTMLInputElement).value).toBe('900.00')
    await user.clear(screen.getByLabelText(/Days/))
    await user.type(screen.getByLabelText(/Days/), '4')
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.costs) }))
    expect(within(costCard('Development of Atlas')).getByText(formatMoney(360_000, 'CHF'))).not.toBeNull()
  })

  it('does not repeat a bound field in the generic form below the table', () => {
    render(<Form start={filled(() => undefined)} />)
    expect(screen.getAllByLabelText(/Day rate/)).toHaveLength(1)
  })
})

describe('CostTableEditor — blocks (AC-4.4)', () => {
  it('does not show a line of an off block', () => {
    render(<Form start={filled(() => undefined)} />)
    expect(screen.queryByRole('group', { name: /Yearly fee/ })).toBeNull()
  })

  it('shows a line of an on block with the hint that names the block', () => {
    render(<Form start={filled((a) => (a.blocks.ricorrente = true))} />)
    const card = costCard('Yearly fee')
    expect(within(card).getByRole('button', { name: new RegExp(t.costs.comesWith('Maintenance')) })).not.toBeNull()
  })

  it('jumps to the block’s switch from the hint', async () => {
    const user = userEvent.setup()
    render(<Form start={filled((a) => (a.blocks.ricorrente = true))} />)
    await user.click(
      within(costCard('Yearly fee')).getByRole('button', { name: new RegExp(t.costs.comesWith('Maintenance')) }),
    )
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.scope) }).getAttribute('aria-selected')).toBe('true')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(document.activeElement?.getAttribute('data-wizard-field')).toBe('ricorrente')
  })
})

describe('CostTableEditor — totals, options and currency (AC-4.6, AC-4.7)', () => {
  it('shows a total row in the document formatting and a span without a counted line as a dash', () => {
    render(
      <Form
        start={filled((a) => {
          a.blocks.secondo = true
        })}
      />,
    )
    const one = screen.getByRole('listitem', { name: /TOTAL ONE/ })
    expect(one.textContent).toContain('8’000')
    // second total: the span holds the 100.- line, so it has a figure; remove the line's value via the empty span case
    expect(screen.getByRole('listitem', { name: /TOTAL TWO/ }).textContent).toContain('100')
  })

  it('prints a dash for a total whose span has no counted line, with a spoken reason', () => {
    const emptySpan = parseTemplate(`@@salutation Dear

## COSTS
@@step costs
@@costs position unit
@@line a one_off | Work | unit=100 | qty=1
@@total **FIRST**
@@total **SECOND**
@@end
`).ast
    render(<Form template={emptySpan} />)
    const second = screen.getByRole('listitem', { name: /SECOND/ })
    expect(second.textContent).toContain(t.costs.spanEmpty)
    expect(within(second).getByText(t.costs.spanEmptyLive)).not.toBeNull()
    expect(screen.getByRole('listitem', { name: /FIRST/ }).textContent).toContain('100')
  })

  it('shows an option line with its price, flagged, and out of the totals', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    const card = costCard('Optional extra')
    expect(within(card).getByText(t.costs.optionNote)).not.toBeNull()
    await user.type(within(card).getByLabelText(new RegExp(t.costs.unit)), '250')
    expect(within(card).getByText(formatMoney(25_000, 'CHF'))).not.toBeNull()
    expect(screen.getByRole('listitem', { name: /TOTAL ONE/ }).textContent).toContain('8’000')
  })

  it('shows card amounts in the deal currency', () => {
    render(<Form start={filled(() => undefined)} />)
    expect(costCard('Development of Atlas').textContent).toContain('CHF')
  })
})

describe('CostTableEditor — discounts (DD-39)', () => {
  const withDiscount = (percentBp: number | null, secondTotal: boolean) =>
    filled((a) => {
      a.blocks.sconto = true
      a.blocks.secondo = secondTotal
      a.costs.lines.sconto = percentBp === null ? { unitCents: 10_000 } : { percentBp }
    })

  it('offers amount or percent while the table has one total row', () => {
    render(<Form start={withDiscount(null, false)} />)
    const card = costCard('Goodwill discount')
    expect(within(card).getByRole('radio', { name: t.costs.discountPercent })).not.toBeNull()
    expect(within(card).getByRole('radio', { name: t.costs.discountAmount })).not.toBeNull()
  })

  it('offers an amount only with two total rows, and says why', () => {
    render(<Form start={withDiscount(null, true)} />)
    const card = costCard('Goodwill discount')
    expect(within(card).queryByRole('radio', { name: t.costs.discountPercent })).toBeNull()
    expect(within(card).getByText(t.costs.discountAmountOnly)).not.toBeNull()
  })

  it('lists a stored percentage as invalid on its line and keeps the toggle', () => {
    render(<Form start={withDiscount(1_000, true)} />)
    const card = costCard('Goodwill discount')
    expect(within(card).getByText(t.invalid.percent_discount_multi_total)).not.toBeNull()
    expect(within(card).getByRole('radio', { name: t.costs.discountPercent })).not.toBeNull()
    expect(stored().costs.lines.sconto?.percentBp).toBe(1_000)
  })

  it('shows the engine’s error on the line it names', async () => {
    const user = userEvent.setup()
    render(<Form start={withDiscount(null, false)} />)
    const card = costCard('Goodwill discount')
    const amount = within(card).getByLabelText(new RegExp(t.costs.unit))
    await user.clear(amount)
    await user.type(amount, '9000')
    expect(within(costCard('Goodwill discount')).getByText(t.invalid.discounts_exceed_span)).not.toBeNull()
  })
})

describe('CostTableEditor — choosing Percent by hand (owner D12)', () => {
  const withDiscount = filled((a) => {
    a.blocks.sconto = true
  })
  const percentRadio = () => within(costCard('Goodwill discount')).getByRole('radio', { name: t.costs.discountPercent })
  const amountRadio = () => within(costCard('Goodwill discount')).getByRole('radio', { name: t.costs.discountAmount })

  it('keeps Percent chosen before a value is typed, marks the empty percentage, then stores the typed one', async () => {
    const user = userEvent.setup()
    render(<Form start={withDiscount} />)
    await user.click(percentRadio())
    expect((percentRadio() as HTMLInputElement).checked).toBe(true)
    expect((amountRadio() as HTMLInputElement).checked).toBe(false)
    const input = within(costCard('Goodwill discount')).getByLabelText(exact(t.costs.discountPercentInput))
    expect(within(costCard('Goodwill discount')).queryByLabelText(exact(t.costs.unit))).toBeNull()
    // empty: marked as missing once the person leaves it
    await user.click(input)
    await user.tab()
    expect(within(costCard('Goodwill discount')).getByText(t.invalid.required)).not.toBeNull()
    await user.type(input, '10')
    expect(stored().costs.lines.sconto?.percentBp).toBe(1_000)
    expect((percentRadio() as HTMLInputElement).checked).toBe(true)
  })

  it('stays on Percent when the typed percentage is emptied again', async () => {
    const user = userEvent.setup()
    render(<Form start={withDiscount} />)
    await user.click(percentRadio())
    const input = within(costCard('Goodwill discount')).getByLabelText(exact(t.costs.discountPercentInput))
    await user.type(input, '10')
    await user.clear(input)
    expect(stored().costs.lines.sconto?.percentBp ?? null).toBeNull()
    expect((percentRadio() as HTMLInputElement).checked).toBe(true)
  })

  it('keeps the choice across a move to another step and back', async () => {
    const user = userEvent.setup()
    render(<Form start={withDiscount} />)
    await user.click(percentRadio())
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.scope) }))
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.costs) }))
    expect((percentRadio() as HTMLInputElement).checked).toBe(true)
  })

  it('switches back to Amount, clearing the percentage', async () => {
    const user = userEvent.setup()
    render(<Form start={withDiscount} />)
    await user.click(percentRadio())
    await user.type(within(costCard('Goodwill discount')).getByLabelText(exact(t.costs.discountPercentInput)), '10')
    await user.click(amountRadio())
    expect((amountRadio() as HTMLInputElement).checked).toBe(true)
    expect(stored().costs.lines.sconto?.percentBp ?? null).toBeNull()
    await user.type(within(costCard('Goodwill discount')).getByLabelText(exact(t.costs.unit)), '50')
    expect(stored().costs.lines.sconto?.unitCents).toBe(5_000)
  })

  it('starts on Percent for a stored percentage (a reloaded draft) and stays there when it is emptied', async () => {
    const user = userEvent.setup()
    render(
      <Form
        start={filled((a) => {
          a.blocks.sconto = true
          a.costs.lines.sconto = { percentBp: 1_000 }
        })}
      />,
    )
    expect((percentRadio() as HTMLInputElement).checked).toBe(true)
    await user.clear(within(costCard('Goodwill discount')).getByLabelText(exact(t.costs.discountPercentInput)))
    expect((percentRadio() as HTMLInputElement).checked).toBe(true)
  })

  it('offers no Percent choice with two total rows (DD-39)', () => {
    render(
      <Form
        start={filled((a) => {
          a.blocks.sconto = true
          a.blocks.secondo = true
        })}
      />,
    )
    expect(within(costCard('Goodwill discount')).queryByRole('radio', { name: t.costs.discountPercent })).toBeNull()
  })

  it('does the same for an extra discount line, and drops the choice when its kind changes', async () => {
    const user = userEvent.setup()
    render(<Form start={withDiscount} />)
    await user.click(screen.getByRole('button', { name: t.costs.add }))
    await user.selectOptions(screen.getByLabelText(t.costs.kindLabel), 'discount')
    const extra = () => screen.getByRole('group', { name: t.costs.lineNumber(3) })
    await user.click(within(extra()).getByRole('radio', { name: t.costs.discountPercent }))
    expect((within(extra()).getByRole('radio', { name: t.costs.discountPercent }) as HTMLInputElement).checked).toBe(
      true,
    )
    await user.type(within(extra()).getByLabelText(exact(t.costs.discountPercentInput)), '5')
    expect(stored().costs.extra[0]!.percentBp).toBe(500)
    await user.selectOptions(screen.getByLabelText(t.costs.kindLabel), 'one_off')
    await user.selectOptions(screen.getByLabelText(t.costs.kindLabel), 'discount')
    expect((within(extra()).getByRole('radio', { name: t.costs.discountAmount }) as HTMLInputElement).checked).toBe(
      true,
    )
  })
})

describe('CostTableEditor — extra lines (AC-4.3)', () => {
  it('adds an extra line, focuses its description and removes it with a named button', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    await user.click(screen.getByRole('button', { name: t.costs.add }))
    expect(stored().costs.extra).toHaveLength(1)
    const description = document.activeElement as HTMLInputElement
    expect(description.tagName).toBe('INPUT')
    await user.type(description, 'Training')
    expect(stored().costs.extra[0]!.description).toBe('Training')
    const remove = screen.getAllByRole('button', { name: /Remove cost line/ })
    expect(remove).toHaveLength(1)
    await user.click(remove[0]!)
    expect(stored().costs.extra).toHaveLength(0)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.costs.add }))
  })

  it('lets the quantity of an extra line be emptied while typing', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    await user.click(screen.getByRole('button', { name: t.costs.add }))
    const group = screen.getByRole('group', { name: t.costs.lineNumber(2) })
    const quantity = within(group).getByLabelText(new RegExp(t.costs.quantity)) as HTMLInputElement
    await user.clear(quantity)
    expect(quantity.value).toBe('')
    await user.type(quantity, '4')
    expect(stored().costs.extra[0]!.quantity).toBe(4)
  })

  it('has no remove button on a template line', () => {
    render(<Form start={filled(() => undefined)} />)
    expect(screen.queryByRole('button', { name: /Remove cost line/ })).toBeNull()
  })

  it('refuses the 11th line: Add is aria-disabled with the reason', async () => {
    const user = userEvent.setup()
    // dev + scelta are template lines: eight extras make ten
    render(<Form start={filled(() => undefined)} />)
    const add = () => screen.getByRole('button', { name: t.costs.add })
    for (let i = 0; i < 8; i += 1) await user.click(add())
    expect(stored().costs.extra).toHaveLength(8)
    expect(add().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(t.costs.addLimit)).not.toBeNull()
    await user.click(add())
    expect(stored().costs.extra).toHaveLength(8)
    // the option shortcut obeys the same limit
    const addOption = screen.getByRole('button', { name: t.costs.addOption })
    expect(addOption.getAttribute('aria-disabled')).toBe('true')
    await user.click(addOption)
    expect(stored().costs.extra).toHaveLength(8)
  })

  it('"Add option line" adds a line already of the option kind, focused, flagged as counted in no total', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    await user.click(screen.getByRole('button', { name: t.costs.addOption }))
    expect(stored().costs.extra).toHaveLength(1)
    expect(stored().costs.extra[0]!.kind).toBe('option')
    const description = document.activeElement as HTMLElement
    expect(description.tagName).toBe('INPUT')
    expect((screen.getByLabelText(t.costs.kindLabel) as HTMLSelectElement).value).toBe('option')
    const line = description.closest<HTMLElement>('[role="group"]')!
    expect(within(line).getByText(t.costs.optionNote)).not.toBeNull()
  })

  it('changes the kind of an extra line and offers percent only for a discount', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    await user.click(screen.getByRole('button', { name: t.costs.add }))
    await user.selectOptions(screen.getByLabelText(t.costs.kindLabel), 'discount')
    expect(stored().costs.extra[0]!.kind).toBe('discount')
    expect(screen.getAllByRole('radio', { name: t.costs.discountPercent }).length).toBeGreaterThan(0)
  })
})

describe('CostTableEditor — layout (AC-4.1)', () => {
  it('switches the columns and the total rows on and off', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    await user.click(screen.getByRole('checkbox', { name: t.costs.position }))
    expect(stored().costs.columns.position).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: t.costs.showTotals }))
    expect(stored().costs.showTotals).toBe(false)
    expect(screen.queryByRole('listitem', { name: /TOTAL ONE/ })).toBeNull()
  })

  it('forces entered quantities to 1 when the unit columns go off', async () => {
    const user = userEvent.setup()
    render(
      <Form
        start={filled((a) => {
          a.blocks.ricorrente = true
          a.costs.lines.canone = { unitCents: 100_000, quantity: 3 }
        })}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: t.costs.unitCols }))
    expect(stored().costs.columns.unit).toBe(false)
    expect(stored().costs.lines.canone?.quantity).toBe(1)
    expect(resolveOffer(ast, stored(), context).invalid.map((issue) => issue.name)).not.toContain('cost:canone')
  })

  it('shows the validity field when no template field is bound to it', async () => {
    const user = userEvent.setup()
    render(<Form start={filled(() => undefined)} />)
    const validity = screen.getByLabelText(new RegExp(t.costs.validity.replace(/[()]/g, '\\$&')))
    fireEvent.change(validity, { target: { value: '45' } })
    expect(stored().validityDays).toBe(45)
    await user.clear(validity)
    await user.type(validity, '400')
    expect(screen.getByText(t.invalid.days_out_of_range, { selector: '.field-error' })).not.toBeNull()
    // the draft keeps the last valid value on the way to "400"
    expect(stored().validityDays).toBe(40)
  })
})

describe('CostTableEditor — whole table errors', () => {
  it('shows a table-wide error at the top of the card', () => {
    render(
      <Form
        start={filled((a) => {
          a.fields.GG = '0'
        })}
      />,
    )
    // quantity 0 on the only counted line: invalid on the line itself
    expect(within(costCard('Development of Atlas')).getByText(t.invalid.out_of_range)).not.toBeNull()
  })
})

describe('CostTableEditor — repeated lines', () => {
  const repeated = parseTemplate(`@@salutation Dear

## COSTS
@@step costs
@@costs position unit
@@line consulting one_off each=PROFILO | Consulting **[PROFILO]** | unit=[RATE] | qty=[DAYS]
@@line rel one_off | Release | unit=perRelease | qty=1
@@total **TOTAL**
@@end

@@table PROFILO
label: Profile
columns: PROFILO, DAYS, RATE

@@field DAYS
label: Days
kind: number

@@field RATE
label: Rate
kind: amount
`).ast

  it('shows one card per printed table row, headed by its key, with the cells read-only', () => {
    render(
      <Form
        template={repeated}
        start={(a) => ({
          ...a,
          tables: {
            PROFILO: [
              { id: 'r1', cells: { PROFILO: 'Senior', DAYS: '3', RATE: 50_000 } },
              { id: 'r2', cells: { PROFILO: 'Junior', DAYS: '5', RATE: 30_000 } },
            ],
          },
        })}
      />,
    )
    const senior = screen.getByRole('group', { name: 'Consulting Senior' })
    expect(within(senior).getByText(t.costs.row('Senior'))).not.toBeNull()
    expect(within(senior).getByText(formatMoney(150_000, 'CHF'))).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Consulting Junior' })).not.toBeNull()
  })

  it('edits the description and price of a release line in its card', async () => {
    const user = userEvent.setup()
    render(<Form template={repeated} />)
    const releases = Array.from(document.querySelectorAll<HTMLElement>('[data-wizard-field^="cost:rel#"]'))
    expect(releases.length).toBeGreaterThan(0)
    const first = releases[0]!
    const description = within(first).getByLabelText(t.costs.descriptionLabel)
    await user.clear(description)
    await user.type(description, 'Phase one')
    expect(stored().costs.lines.rel?.releases?.[0]?.description).toBe('Phase one')
  })
})
