/**
 * @vitest-environment jsdom
 *
 * The Template step (specs/20261115-crm-offer-wizard T49; AC-1.1, AC-2.4, AC-6.5, AC-7.3, DD-9): the active wizard
 * templates of the deal's entity as cards grouped by language, the classic templates of a language that has no
 * wizard template, the estimate gate, the unsent-newest-offer notice, and the confirmed switch of a draft's template.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import TemplateStep, { type TemplateStepProps } from './TemplateStep'
import { sampleAnswers, sampleContext } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { ApiError } from '../../lib/api'
import type { Deal, Offer, WizardTemplate } from '../../lib/types'
import { ScopeContext } from '../../hooks/scopeContext'
import { ADA, fakeApi, problemAnswer, type FakeHandler } from '../../test-support/fakeApi'
import { strings } from '../../strings'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

// The step has no router of its own in these tests: a link is an anchor to its target.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string; params?: unknown }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

// The legacy dialog is the 018 form, unchanged and tested elsewhere: here it only has to be opened with the deal.
vi.mock('../GenerateOfferDialog', () => ({
  default: ({ deal, onCancel }: { deal: Deal; onCancel: () => void }) => (
    <div role="dialog" aria-label="Classic offer form" data-testid="classic-dialog">
      {deal.id}
      <button type="button" onClick={onCancel}>
        Close classic
      </button>
    </div>
  ),
}))

const t = strings.offerWizard

const DEAL = { id: 'd1', entity: 'welld_ch', company: { id: 'c1', name: 'Acme SA' } } as unknown as Deal

const wizardTemplate = (overrides: Partial<WizardTemplate> & { id: string }): WizardTemplate => ({
  entity: 'welld_ch',
  name: 'Progetto a corpo',
  language: 'it',
  format: 'wizard',
  description: 'Sviluppo a prezzo fisso',
  uses: ['Sviluppo', 'Manutenzione'],
  source: '',
  seeded: true,
  showTotal: true,
  annex: false,
  version: 1,
  archived: false,
  updatedBy: ADA,
  updatedAt: '2026-11-01T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
})

const classicRow = (overrides: Record<string, unknown>) => ({
  id: 'k1',
  entity: 'welld_ch',
  name: 'Fixed price',
  language: 'en',
  format: 'sections',
  archived: false,
  version: 1,
  updatedBy: ADA,
  updatedAt: '2026-10-01T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
})

const FIXED = wizardTemplate({ id: 'w1' })
const TRAINING = wizardTemplate({ id: 'w2', name: 'Formazione', description: null, uses: [] })
const CLASSIC_EN = classicRow({ id: 'k1', name: 'Fixed price', language: 'en' })
// a classic Italian template next to a wizard one is archived by the server (DD-9): never offered even if it is not
const CLASSIC_IT = classicRow({ id: 'k2', name: 'Vecchio a corpo', language: 'it' })

let onChoose: ReturnType<typeof vi.fn<(template: WizardTemplate) => Promise<void>>>
let onEditLatest: ReturnType<typeof vi.fn<() => void>>
let onClassicGenerated: ReturnType<typeof vi.fn<(offer: Offer) => void>>

const mount = (
  overrides: Partial<TemplateStepProps> = {},
  routes: Record<string, FakeHandler> = {},
  scope = { deal: ['welld_ch'] as ('welld_ch' | 'welld_it')[], canErase: false },
) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /offer-templates': () => ({ status: 200, body: { items: [FIXED, TRAINING, CLASSIC_EN, CLASSIC_IT] } }),
      ...routes,
    }),
  )
  return render(
    <ScopeContext.Provider value={scope}>
      <TemplateStep
        deal={DEAL}
        estimateState="ready"
        latestOffer={null}
        target={null}
        currentTemplateId={null}
        onChoose={onChoose}
        onEditLatest={onEditLatest}
        onClassicGenerated={onClassicGenerated}
        {...overrides}
      />
    </ScopeContext.Provider>,
  )
}

beforeEach(() => {
  onChoose = vi.fn(async () => undefined)
  onEditLatest = vi.fn()
  onClassicGenerated = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const useButton = (name: string) => screen.findByRole('button', { name: t.template.useOf(name) })

describe('the template cards (AC-1.1)', () => {
  it('asks for both formats of the deal’s entity and groups the wizard templates by language, with name, description and uses', async () => {
    mount()
    const group = await screen.findByRole('region', { name: t.template.heading('Italian') })
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/offer-templates?entity=welld_ch&includeArchived=false&formats=sections%2Cwizard'),
      expect.anything(),
    )
    const fixed = within(group).getByRole('region', { name: 'Progetto a corpo' })
    expect(fixed.textContent).toContain('Sviluppo a prezzo fisso')
    expect(within(fixed).getByText(t.template.uses)).not.toBeNull()
    expect(within(fixed).getByText('Sviluppo')).not.toBeNull()
    expect(within(fixed).getByText('Manutenzione')).not.toBeNull()
    // a template with no description or uses shows only its name and the action
    const training = within(group).getByRole('region', { name: 'Formazione' })
    expect(within(training).queryByText(t.template.uses)).toBeNull()
    expect(within(training).getByRole('button', { name: t.template.useOf('Formazione') })).not.toBeNull()
  })

  it('lays the cards out by the width of the column they sit in, not of the screen (QE D18)', async () => {
    mount()
    const group = await screen.findByRole('region', { name: t.template.heading('Italian') })
    // jsdom has no layout: the contract is the container query itself. The step sits in the half-width form column
    // once the preview is beside it, and a viewport breakpoint (`md:`) put two squeezed cards there.
    expect(group.className).toContain('@container')
    const grid = within(group).getByRole('region', { name: 'Progetto a corpo' }).parentElement!
    expect(grid.className).toContain('@lg:grid-cols-2')
    expect(grid.className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols/)
  })

  it('shows at most six uses per template', async () => {
    const many = wizardTemplate({ id: 'w9', name: 'Many', uses: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'] })
    mount({}, { 'GET /offer-templates': () => ({ status: 200, body: { items: [many] } }) })
    const card = await screen.findByRole('region', { name: 'Many' })
    expect(within(card).queryByText('u7')).toBeNull()
    expect(within(card).getByText('u6')).not.toBeNull()
  })

  it('never offers an archived template', async () => {
    const archived = wizardTemplate({ id: 'w3', name: 'Old wizard', archived: true })
    mount({}, { 'GET /offer-templates': () => ({ status: 200, body: { items: [FIXED, archived] } }) })
    await useButton('Progetto a corpo')
    expect(screen.queryByText('Old wizard')).toBeNull()
  })

  it('picking a template with no draft yet hands it to the page, busy while it starts', async () => {
    let finish: () => void = () => undefined
    onChoose.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    mount()
    await userEvent.click(await useButton('Progetto a corpo'))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose.mock.calls[0]![0].id).toBe('w1')
    const busy = await screen.findByRole('button', { name: t.template.useOf('Progetto a corpo') })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.textContent).toBe(t.template.starting)
    finish()
    await waitFor(() => expect(busy.getAttribute('aria-busy')).not.toBe('true'))
  })

  it('shows why a template could not be started and keeps the cards usable', async () => {
    onChoose.mockRejectedValue(new ApiError({ status: 409, title: 'x', code: 'draft_exists' }))
    mount()
    await userEvent.click(await useButton('Progetto a corpo'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(strings.offers.errors.draftExists)
    expect(
      screen.getByRole('button', { name: t.template.useOf('Formazione') }).getAttribute('aria-disabled'),
    ).toBeNull()
  })
})

describe('classic templates (DD-9)', () => {
  it('lists the classic templates of a language with no wizard template and opens the legacy dialog', async () => {
    mount()
    const classic = await screen.findByRole('region', { name: t.template.classic.title })
    expect(classic.textContent).toContain(t.template.classic.intro)
    expect(within(classic).getByText('Fixed price')).not.toBeNull()
    // Italian has wizard templates: its classic template is not offered
    expect(within(classic).queryByText('Vecchio a corpo')).toBeNull()
    await userEvent.click(within(classic).getByRole('button', { name: t.template.classic.useOf('Fixed price') }))
    expect((await screen.findByTestId('classic-dialog')).textContent).toContain('d1')
    await userEvent.click(screen.getByRole('button', { name: 'Close classic' }))
    expect(screen.queryByTestId('classic-dialog')).toBeNull()
  })

  it('has no classic card when every language has a wizard template', async () => {
    mount({}, { 'GET /offer-templates': () => ({ status: 200, body: { items: [FIXED] } }) })
    await useButton('Progetto a corpo')
    expect(screen.queryByRole('region', { name: t.template.classic.title })).toBeNull()
  })
})

describe('the estimate gate (AC-2.4)', () => {
  it('with no ready estimate shows the banner and link, and every card’s action is aria-disabled and does nothing', async () => {
    mount({ estimateState: 'missing' })
    const banner = await screen.findByText(t.estimate.missing)
    expect(banner).not.toBeNull()
    expect(screen.getByRole('link', { name: t.estimate.go })).not.toBeNull()
    const button = await useButton('Progetto a corpo')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('aria-describedby')).toBeTruthy()
    await userEvent.click(button)
    expect(onChoose).not.toHaveBeenCalled()
    const classic = screen.getByRole('button', { name: t.template.classic.useOf('Fixed price') })
    expect(classic.getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(classic)
    expect(screen.queryByTestId('classic-dialog')).toBeNull()
  })

  it('names the reason for the disabled card in its description', async () => {
    mount({ estimateState: 'missing' })
    const button = await useButton('Progetto a corpo')
    const reason = document.getElementById(button.getAttribute('aria-describedby')!.split(' ')[0]!)
    expect(reason?.textContent).toContain(t.estimate.missing)
  })

  it('an admin’s override keeps the cards usable and says figures from the estimate are not available', async () => {
    mount({ estimateState: 'override' })
    expect(await screen.findByText(t.estimate.override)).not.toBeNull()
    await userEvent.click(await useButton('Progetto a corpo'))
    expect(onChoose).toHaveBeenCalledTimes(1)
  })
})

describe('the unsent newest offer (018 AC-7.1)', () => {
  const latest = { id: 'o1', reference: '0007/2026', sent: false, version: 2, origin: 'wizard' as const }

  it('names it, offers to edit it instead and disables the cards', async () => {
    mount({ latestOffer: latest })
    expect(await screen.findByText(t.unsent.body('0007/2026'))).not.toBeNull()
    expect((await useButton('Progetto a corpo')).getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: t.unsent.editInstead }))
    expect(onEditLatest).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: t.template.useOf('Progetto a corpo') }))
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('says nothing about a sent offer', async () => {
    mount({ latestOffer: { ...latest, sent: true } })
    await useButton('Progetto a corpo')
    expect(screen.queryByText(t.unsent.body('0007/2026'))).toBeNull()
  })

  it('is not shown when the step was entered to re-template an offer (the target says what to do)', async () => {
    mount({ latestOffer: latest, target: { reference: '0007/2026', reason: 'legacy' } })
    await useButton('Progetto a corpo')
    expect(screen.queryByText(t.unsent.body('0007/2026'))).toBeNull()
    expect(
      screen.getByRole('button', { name: t.template.useOf('Progetto a corpo') }).getAttribute('aria-disabled'),
    ).toBeNull()
  })
})

describe('entered with a target (AC-7.3)', () => {
  it('a classic offer says to pick a template to continue it', async () => {
    mount({ target: { reference: '0003/2026', reason: 'legacy' } })
    expect(await screen.findByText(t.target.legacy('0003/2026'))).not.toBeNull()
    await userEvent.click(await useButton('Progetto a corpo'))
    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it('a wizard offer whose template was archived says so', async () => {
    mount({ target: { reference: '0004/2026', reason: 'archived' } })
    expect(await screen.findByText(t.target.archived('0004/2026'))).not.toBeNull()
  })
})

describe('switching the template of a draft (AC-6.5)', () => {
  it('marks the current template and gives it no button', async () => {
    mount({ currentTemplateId: 'w1' })
    const card = await screen.findByRole('region', { name: 'Progetto a corpo' })
    expect(within(card).getByText(t.template.current)).not.toBeNull()
    expect(within(card).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: t.template.useOf('Formazione') })).not.toBeNull()
  })

  it('asks first, says what is replaced and what is kept, and switches only on confirm', async () => {
    mount({ currentTemplateId: 'w1' })
    await userEvent.click(await useButton('Formazione'))
    const dialog = await screen.findByRole('alertdialog', { name: t.template.switch.title })
    expect(dialog.textContent).toContain(t.template.switch.body('Formazione'))
    expect(onChoose).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t.template.switch.confirm }))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose.mock.calls[0]![0].id).toBe('w2')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((await screen.findByRole('status')).textContent).toContain(t.template.switch.done('Formazione'))
  })

  it('cancel switches nothing', async () => {
    mount({ currentTemplateId: 'w1' })
    await userEvent.click(await useButton('Formazione'))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: strings.common.cancel }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with the refusal when the switch fails', async () => {
    onChoose.mockRejectedValue(new ApiError({ status: 409, title: 'x', code: 'template_archived' }))
    mount({ currentTemplateId: 'w1' })
    await userEvent.click(await useButton('Formazione'))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t.template.switch.confirm }))
    await waitFor(() =>
      expect(within(screen.getByRole('alertdialog')).getByRole('alert').textContent).toContain(
        strings.offers.errors.templateArchived,
      ),
    )
  })
})

describe('states', () => {
  it('shows a polite loading line first', async () => {
    mount({}, { 'GET /offer-templates': () => new Promise(() => undefined) as never })
    expect((await screen.findByTestId('crm-loading')).textContent).toContain(t.page.loading)
  })

  it('a failed load is a warning with Retry that loads again', async () => {
    let calls = 0
    mount(
      {},
      {
        'GET /offer-templates': () => {
          calls += 1
          return calls === 1 ? problemAnswer(500, 'boom') : { status: 200, body: { items: [FIXED] } }
        },
      },
    )
    await userEvent.click(await screen.findByRole('button', { name: strings.common.retry }))
    await useButton('Progetto a corpo')
    expect(calls).toBe(2)
  })

  it('403 replaces the step with the permission-denied panel', async () => {
    mount({}, { 'GET /offer-templates': () => problemAnswer(403, 'forbidden') })
    expect(await screen.findByTestId('crm-permission-denied')).not.toBeNull()
  })

  it('with no active template at all says so and, for a manager, links to Settings', async () => {
    mount({}, { 'GET /offer-templates': () => ({ status: 200, body: { items: [] } }) })
    expect(await screen.findByRole('heading', { name: t.template.empty.title('wellD CH') })).not.toBeNull()
    expect(screen.getByRole('link', { name: t.template.openSettings })).not.toBeNull()
  })

  it('does not offer Settings to someone who cannot manage deals of the entity', async () => {
    mount({}, { 'GET /offer-templates': () => ({ status: 200, body: { items: [] } }) }, { deal: [], canErase: false })
    await screen.findByRole('heading', { name: t.template.empty.title('wellD CH') })
    expect(screen.queryByRole('link', { name: t.template.openSettings })).toBeNull()
  })
})

describe('inside the wizard', () => {
  const SOURCE = `@@salutation Dear

## SCOPE
@@step scope
We deliver [OGGETTO].

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=? | qty=1
@@total **TOTAL**
@@end

@@field OGGETTO
label: Object
`
  const ast = parseTemplate(SOURCE).ast

  const wizard = (readOnly: boolean) => {
    apiFetch.mockImplementation(
      fakeApi({ 'GET /offer-templates': () => ({ status: 200, body: { items: [FIXED, TRAINING] } }) }),
    )
    return render(
      <ScopeContext.Provider value={{ deal: ['welld_ch'], canErase: false }}>
        <OfferWizard
          mode="deal"
          ast={ast}
          answers={sampleAnswers(ast, 'en')}
          onAnswersChange={() => undefined}
          context={sampleContext('en')}
          step="template"
          readOnly={readOnly}
          templateStep={{
            deal: DEAL,
            estimateState: 'ready',
            latestOffer: null,
            target: null,
            currentTemplateId: 'w1',
            onChoose,
            onEditLatest,
            onClassicGenerated,
          }}
        />
      </ScopeContext.Provider>,
    )
  }

  it('is the wizard’s own Template panel', async () => {
    wizard(false)
    expect(await useButton('Formazione')).not.toBeNull()
  })

  it('stays usable when the rest of the draft is read-only (an archived template must be replaceable)', async () => {
    wizard(true)
    const button = await useButton('Formazione')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(button)
    expect(await screen.findByRole('alertdialog')).not.toBeNull()
  })
})
