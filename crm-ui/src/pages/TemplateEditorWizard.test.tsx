/**
 * @vitest-environment jsdom
 *
 * Settings › Templates and the wizard template editor (specs/20261115-crm-offer-wizard T52; AC-8.1, AC-8.2, AC-8.3,
 * AC-9.2): the list shows each template's format, Create and Duplicate open the wizard editor and a classic row keeps
 * the 018 one; the editor keeps the text, the outline of what the wizard will ask and the problem list in step with
 * what is typed, blocks Save while the text has errors and maps the server's refusals — all through the real router
 * and request code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from '../components/CrmShell'
import { createAppRouter } from '../router'
import { parseTemplate } from '../lib/offerEngine/syntax'
import { ADA, fakeApi, nulRefusalAnswer, problemAnswer } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { strings } from '../strings'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const t = strings.templates
const w = t.wizardEditor

const MANAGER = { deal: ['welld_ch'], financials: true, managesAll: false, canErase: false }

const SOURCE = `@@salutation Spett.le

Offerta per [CLIENTE].

## OGGETTO
@@step scope
Realizziamo [PROGETTO].
{{extra::Inoltre [NOTA_EXTRA].}}

## CORRISPETTIVO
@@step costs
@@costs position unit
@@line main one_off | Sviluppo | unit=? | qty=1
@@total **TOTALE**
@@end

@@field CLIENTE
label: Cliente
source: client

@@field PROGETTO
label: Progetto
hint: Il nome del progetto

@@block extra
label: Seconda voce
explain: Aggiunge una riga
default: off
fills: NOTA_EXTRA = da definire

@@field NOTA_EXTRA
label: Nota extra
`

const WIZARD = {
  id: 'w1',
  entity: 'welld_ch',
  name: 'Progetto a corpo',
  language: 'it',
  format: 'wizard',
  description: 'Sviluppo a prezzo fisso',
  uses: ['Sviluppo', 'Manutenzione'],
  source: SOURCE,
  salutation: null,
  opening: null,
  sections: null,
  costLines: null,
  costColumns: null,
  showTotal: false,
  acceptanceLabel: null,
  annex: false,
  seeded: true,
  version: 3,
  archived: false,
  updatedBy: ADA,
  updatedAt: '2026-10-30T10:00:00.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
}

const CLASSIC = {
  id: 'k1',
  entity: 'welld_ch',
  name: 'Fixed price',
  language: 'en',
  format: 'sections',
  description: null,
  uses: [],
  source: null,
  salutation: 'Dear Sir,',
  opening: 'Thank you.',
  sections: [{ heading: 'Costs', body: '', costs: true }],
  costLines: [{ description: 'Development', kind: 'one_off', amount: 'deal', quantity: 1 }],
  costColumns: { position: true, unit: false },
  showTotal: false,
  acceptanceLabel: null,
  annex: false,
  version: 2,
  archived: false,
  updatedBy: ADA,
  updatedAt: '2026-10-29T10:00:00.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
}

const PROFILE = {
  entity: 'welld_ch',
  legalName: 'wellD SA',
  addressLines: ['Via Nassa 1'],
  vatNumber: null,
  iban: null,
  offerTermsEn: null,
  offerTermsIt: null,
  placeOfIssue: 'Lugano',
  letterhead: null,
  updatedAt: '2026-11-01T09:00:00.000Z',
}

const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as Record<string, unknown>
const header = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name] ?? null

const open = (path: string, extra: Record<string, FakeHandler> = {}, scope = MANAGER) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: scope }),
      'GET /entity-profiles': () => ({ status: 200, body: { items: [PROFILE] } }),
      'GET /offer-templates': () => ({ status: 200, body: { items: [WIZARD, CLASSIC] } }),
      'GET /offer-templates/w1': () => ({ status: 200, body: WIZARD }),
      'GET /offer-templates/k1': () => ({ status: 200, body: CLASSIC }),
      ...extra,
    }),
  )
  window.history.pushState(null, '', path)
  render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
}

const textArea = async () => (await screen.findByRole('textbox', { name: w.text })) as HTMLTextAreaElement
/** Types a whole new text into the template box, as a paste would. */
const setText = async (value: string) => fireEvent.change(await textArea(), { target: { value } })
const save = () => screen.getByTestId('crm-template-save')

beforeEach(() => {
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the fixture', () => {
  it('is a template the shared parser reads without errors', () => {
    expect(parseTemplate(SOURCE).problems.filter((problem) => problem.severity === 'error')).toEqual([])
  })
})

describe('Settings › Templates (AC-9.2)', () => {
  it('shows the format of each row, the description of a wizard template and what the card is about', async () => {
    const queries: string[] = []
    open('/settings', {
      'GET /offer-templates': (url) => {
        queries.push(url.search)
        return { status: 200, body: { items: [WIZARD, CLASSIC] } }
      },
    })
    const table = await screen.findByTestId('crm-templates-welld_ch-table')
    expect(queries[0]).toBe('?entity=welld_ch&includeArchived=false&formats=sections%2Cwizard')
    const rows = within(table).getAllByRole('row')
    const wizard = rows.find((row) => row.textContent?.includes('Progetto a corpo'))!
    const classic = rows.find((row) => row.textContent?.includes('Fixed price'))!
    expect(within(wizard).getByText(t.list.wizard)).not.toBeNull()
    expect(within(wizard).getByText('Sviluppo a prezzo fisso')).not.toBeNull()
    expect(within(classic).getByText(t.list.classic)).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: t.list.format })).not.toBeNull()
    expect(screen.getByTestId('crm-templates-welld_ch').textContent).toContain(t.list.description)
  })

  it('opens a wizard row in the wizard editor and a classic row in the classic one', async () => {
    open('/settings')
    fireEvent.click(await screen.findByTestId('crm-template-open-w1'))
    expect(await textArea()).not.toBeNull()
    expect(screen.queryByTestId('crm-template-sections')).toBeNull()
    cleanup()
    open('/settings/templates/k1')
    expect(await screen.findByTestId('crm-template-sections')).not.toBeNull()
    expect(screen.queryByRole('textbox', { name: w.text })).toBeNull()
  })

  it('New template opens the wizard editor of the entity', async () => {
    open('/settings')
    fireEvent.click(await screen.findByTestId('crm-template-new-welld_ch'))
    expect(await textArea()).not.toBeNull()
    expect(window.location.pathname).toBe('/settings/templates/new/welld_ch')
  })

  it('Duplicate of a wizard template opens the copy in the wizard editor; of a classic one only says it was created', async () => {
    open('/settings', {
      'POST /offer-templates/w1/duplicate': () => ({
        status: 201,
        body: { ...WIZARD, id: 'w9', name: 'Progetto a corpo (copia)' },
      }),
      'GET /offer-templates/w9': () => ({
        status: 200,
        body: { ...WIZARD, id: 'w9', name: 'Progetto a corpo (copia)' },
      }),
      'POST /offer-templates/k1/duplicate': () => ({
        status: 201,
        body: { ...CLASSIC, id: 'k9', name: 'Fixed price (copy)' },
      }),
    })
    fireEvent.click(await screen.findByTestId('crm-template-duplicate-k1'))
    expect(await screen.findByText('Template Fixed price (copy) created.')).not.toBeNull()
    expect(window.location.pathname).toBe('/settings')
    fireEvent.click(await screen.findByTestId('crm-template-duplicate-w1'))
    await waitFor(() => expect(window.location.pathname).toBe('/settings/templates/w9'))
    expect(((await textArea()) as HTMLTextAreaElement).value).toBe(SOURCE)
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Progetto a corpo (copia)')
  })

  it('says why the last template of a language cannot be archived', async () => {
    open('/settings', {
      'POST /offer-templates/w1/archive': () => problemAnswer(409, 'last_template'),
    })
    fireEvent.click(await screen.findByTestId('crm-template-archive-w1'))
    expect((await screen.findByTestId('crm-templates-error')).textContent).toContain(
      t.list.errors.last_template(strings.offers.languageName.it),
    )
  })

  it('says why a classic template cannot be restored while a wizard one is active', async () => {
    open('/settings', {
      'GET /offer-templates': () => ({
        status: 200,
        body: { items: [WIZARD, { ...CLASSIC, language: 'it', archived: true }] },
      }),
      'POST /offer-templates/k1/restore': () => problemAnswer(409, 'template_superseded'),
    })
    fireEvent.click(await screen.findByTestId('crm-template-restore-k1'))
    expect((await screen.findByTestId('crm-templates-error')).textContent).toContain(
      t.list.errors.template_superseded(strings.offers.languageName.it),
    )
  })
})

describe('the wizard editor (AC-8.1)', () => {
  it('loads the template into its fields and starts with no problems', async () => {
    open('/settings/templates/w1')
    expect(((await textArea()) as HTMLTextAreaElement).value).toBe(SOURCE)
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Progetto a corpo')
    expect((screen.getByLabelText(new RegExp(`^${w.description}`)) as HTMLInputElement).value).toBe(
      'Sviluppo a prezzo fisso',
    )
    expect((screen.getByLabelText(/^Language/) as HTMLSelectElement).value).toBe('it')
    expect((screen.getByLabelText('Item 1 of Typical uses') as HTMLInputElement).value).toBe('Sviluppo')
    expect(screen.getByText(w.noProblems)).not.toBeNull()
  })

  it('saves name, language, description, uses and text with the template’s version as If-Match, then adopts the new one', async () => {
    const puts: { body: Record<string, unknown>; ifMatch: string | null }[] = []
    open('/settings/templates/w1', {
      'PUT /offer-templates/w1': (_url, init) => {
        puts.push({ body: body(init), ifMatch: header(init, 'If-Match') })
        return { status: 200, body: { ...WIZARD, ...body(init), version: 3 + puts.length } }
      },
    })
    await textArea()
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Progetto a corpo v2' } })
    fireEvent.click(save())
    expect(await screen.findByText(t.editor.saved)).not.toBeNull()
    fireEvent.click(save())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[0]!.ifMatch).toBe('"3"')
    expect(puts[1]!.ifMatch).toBe('"4"')
    expect(puts[0]!.body).toEqual({
      name: 'Progetto a corpo v2',
      language: 'it',
      description: 'Sviluppo a prezzo fisso',
      uses: ['Sviluppo', 'Manutenzione'],
      source: SOURCE,
      documentTitle: { it: null, en: null },
    })
  })

  it('shows the cursor’s line and column and the length against the 150 000 limit', async () => {
    open('/settings/templates/w1')
    const box = await textArea()
    const status = await screen.findByTestId('crm-template-text-status')
    expect(status.textContent).toBe(w.status(1, 1, SOURCE.length, 150000))
    box.focus()
    box.setSelectionRange(SOURCE.indexOf('## OGGETTO') + 3, SOURCE.indexOf('## OGGETTO') + 3)
    fireEvent.select(box)
    expect(status.textContent).toContain('Line 5, column 4')
  })

  it('opens the syntax reference with the template grammar, not a form', async () => {
    open('/settings/templates/w1')
    await textArea()
    fireEvent.click(screen.getByRole('button', { name: w.syntax }))
    const drawer = await screen.findByRole('dialog', { name: t.markup.wizard.summary })
    expect(drawer.textContent).toContain('@@OPT_START')
    expect(drawer.textContent).toContain('@@costs')
    expect(drawer.textContent).toContain('@@choice')
    fireEvent.click(within(drawer).getByRole('button', { name: w.syntaxClose }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is read-only for an entity the caller does not manage', async () => {
    open('/settings/templates/w1', {
      'GET /offer-templates/w1': () => ({ status: 200, body: { ...WIZARD, entity: 'welld_it' } }),
    })
    expect((await textArea()).disabled).toBe(true)
    expect(screen.getByText(/you do not manage deals for this entity/)).not.toBeNull()
    expect(screen.queryByTestId('crm-template-save')).toBeNull()
  })

  it('is read-only while archived', async () => {
    open('/settings/templates/w1', {
      'GET /offer-templates/w1': () => ({ status: 200, body: { ...WIZARD, archived: true } }),
    })
    expect((await textArea()).disabled).toBe(true)
    expect(screen.getByText(t.editor.archivedNotice)).not.toBeNull()
  })
})

describe('what the wizard will ask (AC-8.2)', () => {
  const outline = async () => within(await screen.findByRole('region', { name: w.outline }))

  it('lists each step with its sections and the items in text order, nested under their block', async () => {
    open('/settings/templates/w1')
    const view = await outline()
    const scope = view.getByRole('heading', { name: strings.offerWizard.steps.scope })
    expect(scope).not.toBeNull()
    const costs = view.getByRole('heading', { name: strings.offerWizard.steps.costs })
    expect(costs).not.toBeNull()
    // steps come in the wizard's order
    expect(scope.compareDocumentPosition(costs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(view.getByText('OGGETTO')).not.toBeNull()
    expect(view.getByText('CORRISPETTIVO')).not.toBeNull()
    const project = view.getByText('Progetto').closest('li')!
    expect(project.textContent).toContain(w.kind.text)
    const block = view.getByText('Seconda voce').closest('li')!
    expect(block.textContent).toContain(w.kind.block)
    expect(block.textContent).toContain('Aggiunge una riga')
    // the field the block's text uses is listed under the block, though the block is off
    expect(within(block).getByText('Nota extra')).not.toBeNull()
    expect(block.textContent).toContain(w.fills('Nota extra'))
    // the cost table shows its lines and the total row labels
    const table = view.getByText(w.kind.costs(1)).closest('li')!
    expect(table.textContent).toContain('main')
    expect(table.textContent).toContain(w.costTotal('TOTALE'))
    // the client's own place is not asked here
    expect(view.queryByText('Cliente')).toBeNull()
  })

  it('marks an optional field and a calculated one', async () => {
    const text = SOURCE.replace(
      '{{extra::Inoltre [NOTA_EXTRA].}}',
      '{{extra::Inoltre [NOTA_EXTRA].}}\n{{?GIORNI::Giorni [GIORNI].}}\nTotale [CALCOLO].',
    ).concat(
      '\n@@field GIORNI\nlabel: Giorni\nkind: number\n\n@@field CALCOLO\nlabel: Calcolato\nkind: number\ncompute: GIORNI + 1\n',
    )
    open('/settings/templates/w1', {
      'GET /offer-templates/w1': () => ({ status: 200, body: { ...WIZARD, source: text } }),
    })
    const view = await outline()
    expect(view.getByText('Giorni').closest('li')!.textContent).toContain(w.optional)
    expect(view.getByText('Calcolato').closest('li')!.textContent).toContain(w.kind.derived)
  })

  it('follows the text as it is typed', async () => {
    open('/settings/templates/w1')
    const view = await outline()
    expect(view.queryByText('Scadenza')).toBeNull()
    await setText(
      SOURCE.replace('Realizziamo [PROGETTO].', 'Realizziamo [PROGETTO] entro [SCADENZA].').concat(
        '\n@@field SCADENZA\nlabel: Scadenza\nkind: date\n',
      ),
    )
    expect(await view.findByText('Scadenza')).not.toBeNull()
    expect(view.getByText('Scadenza').closest('li')!.textContent).toContain(w.kind.date)
  })

  it('says there is nothing to ask for a text with no declarations', async () => {
    open('/settings/templates/new/welld_ch')
    expect(await screen.findByText(w.outlineEmpty.title)).not.toBeNull()
  })

  it('keeps the last readable version while the text has errors, and says so', async () => {
    open('/settings/templates/w1')
    const view = await outline()
    await setText(SOURCE.replace('{{extra::Inoltre [NOTA_EXTRA].}}', '@@OPT_START extra\nInoltre [NOTA_EXTRA].'))
    expect(await screen.findByText(w.outlineStale)).not.toBeNull()
    expect(view.getByText('Progetto')).not.toBeNull()
  })
})

describe('the outline’s "Supplied by the CRM" group in the editor (AC-12.1, AC-12.9; G17)', () => {
  const ISSUER = SOURCE.replace('Realizziamo [PROGETTO].', 'Fornitore [EMITTENTE]. Realizziamo [PROGETTO].').concat(
    '\n@@field EMITTENTE\nlabel: Emittente\nsource: issuer\n',
  )
  const group = () => screen.queryByRole('region', { name: w.supplied.title })

  it('follows the text as it is typed: a use makes the group, removing it takes the group away', async () => {
    open('/settings/templates/w1')
    await textArea()
    expect(group()).toBeNull()
    await setText(ISSUER)
    await waitFor(() => expect(group()).not.toBeNull())
    expect(within(group()!).getByText('Emittente')).not.toBeNull()
    await setText(SOURCE)
    await waitFor(() => expect(group()).toBeNull())
  })

  it('keeps the last readable version while the text has errors, like the rest of the outline', async () => {
    open('/settings/templates/w1')
    await textArea()
    await setText(ISSUER)
    await waitFor(() => expect(group()).not.toBeNull())
    await setText(ISSUER.replace('{{extra::Inoltre [NOTA_EXTRA].}}', '@@OPT_START extra\nInoltre [NOTA_EXTRA].'))
    expect(await screen.findByText(w.outlineStale)).not.toBeNull()
    expect(group()).not.toBeNull()
  })
})

describe('problems (AC-8.3)', () => {
  const UNCLOSED = SOURCE.replace('{{extra::Inoltre [NOTA_EXTRA].}}', '@@OPT_START extra\nInoltre [NOTA_EXTRA].')
  const problems = async () => within(await screen.findByRole('region', { name: w.problems }))

  it('lists an unclosed block with its line, and selecting it puts the caret on that line', async () => {
    open('/settings/templates/w1')
    await textArea()
    await setText(UNCLOSED)
    const list = await problems()
    const line = UNCLOSED.split('\n').findIndex((row) => row.startsWith('@@OPT_START')) + 1
    const item = await list.findByRole('button', {
      name: new RegExp(`${w.error}.*${w.line(line)}.*${w.problem.block_not_closed('extra')}`),
    })
    await userEvent.click(item)
    const box = await textArea()
    expect(document.activeElement).toBe(box)
    const start =
      UNCLOSED.split('\n')
        .slice(0, line - 1)
        .join('\n').length + 1
    expect(box.selectionStart).toBe(start)
    expect(box.selectionEnd).toBe(start + '@@OPT_START extra'.length)
  })

  it('blocks Save while there are errors: aria-disabled, with the reason, no request, focus to the problems', async () => {
    open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => ({ status: 200, body: WIZARD }) })
    await textArea()
    await setText(UNCLOSED)
    await waitFor(() => expect(save().getAttribute('aria-disabled')).toBe('true'))
    const reason = document.getElementById(save().getAttribute('aria-describedby')!)
    expect(reason?.textContent).toContain(w.saveBlocked(1))
    await userEvent.click(save())
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: w.problems }))
  })

  it('checks the text typed a moment ago too: Save does not wait for the live check', async () => {
    open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => ({ status: 200, body: WIZARD }) })
    await textArea()
    await setText(UNCLOSED)
    // pressed at once, before the debounce lets the list catch up
    fireEvent.click(save())
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
    expect(await screen.findByText(w.problem.block_not_closed('extra'))).not.toBeNull()
  })

  it('"n errors — go to problems" moves focus to the problems heading', async () => {
    open('/settings/templates/w1')
    await textArea()
    await setText(UNCLOSED)
    fireEvent.click(await screen.findByRole('button', { name: w.goToProblems(1) }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: w.problems }))
  })

  it('a warning is listed but does not block Save', async () => {
    const warned = SOURCE.concat('\n@@field MAI_USATO\nlabel: Mai usato\n')
    const puts: unknown[] = []
    open('/settings/templates/w1', {
      'PUT /offer-templates/w1': (_url, init) => {
        puts.push(body(init))
        return { status: 200, body: { ...WIZARD, version: 4 } }
      },
    })
    await textArea()
    await setText(warned)
    const list = await problems()
    await list.findByRole('button', { name: new RegExp(`${w.warning}.*${w.problem.declared_unused('MAI_USATO')}`) })
    expect(save().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(save())
    await waitFor(() => expect(puts).toHaveLength(1))
  })

  it('shows the server’s problems on a 422 template_invalid, and drops them once the text changes', async () => {
    open('/settings/templates/w1', {
      'PUT /offer-templates/w1': () =>
        problemAnswer(422, 'template_invalid', {
          problems: [{ line: 7, code: 'field_undeclared', severity: 'error', name: 'ALTRO' }],
        }),
    })
    await textArea()
    fireEvent.click(save())
    const list = await problems()
    await list.findByRole('button', { name: new RegExp(`${w.line(7)}.*${w.problem.field_undeclared('ALTRO')}`) })
    await setText(`${SOURCE}\n`)
    await waitFor(() => expect(list.queryByText(w.problem.field_undeclared('ALTRO'))).toBeNull())
  })

  it('never lists the same problem twice when the server agrees with the editor', async () => {
    const text = SOURCE.concat('\n@@field MAI_USATO\nlabel: Mai usato\n')
    const mine = parseTemplate(text).problems
    expect(mine).toHaveLength(1)
    open('/settings/templates/w1', {
      'PUT /offer-templates/w1': () =>
        problemAnswer(422, 'template_invalid', { problems: [{ ...mine[0], severity: 'warning' }] }),
    })
    await textArea()
    await setText(text)
    await screen.findByText(w.problem.declared_unused('MAI_USATO'))
    fireEvent.click(save())
    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(true),
    )
    expect(screen.getAllByText(w.problem.declared_unused('MAI_USATO'))).toHaveLength(1)
  })
})

describe('refusals (AC-8.1)', () => {
  it('a stale save shows the reload banner and keeps what was typed until reloaded', async () => {
    let version = 3
    open('/settings/templates/w1', {
      'GET /offer-templates/w1': () => ({
        status: 200,
        body: { ...WIZARD, version, name: version === 3 ? 'Progetto a corpo' : 'Edited elsewhere' },
      }),
      'PUT /offer-templates/w1': () => problemAnswer(409, 'version_conflict'),
    })
    await textArea()
    version = 5
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Mine' } })
    fireEvent.click(save())
    expect(await screen.findByTestId('crm-stale-write')).not.toBeNull()
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Mine')
    fireEvent.click(screen.getByTestId('crm-stale-write-reload'))
    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Edited elsewhere'))
  })

  it('a taken name lands on the name field', async () => {
    open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => problemAnswer(409, 'template_name_taken') })
    await textArea()
    fireEvent.click(save())
    expect(await screen.findByText(t.editor.errors.nameTaken)).not.toBeNull()
  })

  it('moving the only active template out of its language is refused with the reason', async () => {
    open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => problemAnswer(409, 'last_template') })
    await textArea()
    fireEvent.change(screen.getByLabelText(/^Language/), { target: { value: 'en' } })
    fireEvent.click(save())
    expect((await screen.findByTestId('crm-template-error')).textContent).toContain(
      t.list.errors.last_template(strings.offers.languageName.it),
    )
  })

  describe('a character the server cannot store (QE F2)', () => {
    const RAW = /NUL|Must not contain|Not text/

    it('in the text: our sentence under the text box, focus on the box, never the server line or its key', async () => {
      open('/settings/templates/w1', {
        'PUT /offer-templates/w1': () => nulRefusalAnswer('source', 'Must not contain a NUL character'),
      })
      const box = await textArea()
      fireEvent.click(save())
      await waitFor(() => expect(document.activeElement).toBe(box))
      expect(box.getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByText(strings.common.validation.noNul)).not.toBeNull()
      expect(screen.queryByTestId('crm-template-error')).toBeNull()
      expect(document.body.textContent).not.toMatch(RAW)
      // editing the text withdraws the sentence: it was about the text that was sent
      fireEvent.change(box, { target: { value: `${box.value} ` } })
      expect(screen.queryByText(strings.common.validation.noNul)).toBeNull()
    })

    it('in the name: our sentence at the name field, with focus there', async () => {
      open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => nulRefusalAnswer('name') })
      await textArea()
      fireEvent.click(save())
      const name = screen.getByLabelText(/^Name/)
      await waitFor(() => expect(document.activeElement).toBe(name))
      expect(screen.getByText(strings.common.validation.noNul)).not.toBeNull()
      expect(document.body.textContent).not.toMatch(RAW)
    })

    it('in a list entry (a field the form does not own): a banner in our words, never the key', async () => {
      open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => nulRefusalAnswer('uses.0') })
      await textArea()
      fireEvent.click(save())
      const banner = await screen.findByTestId('crm-template-error')
      expect(banner.textContent).toBe(strings.common.validation.noNul)
      expect(document.body.textContent).not.toMatch(/uses\.0|NUL/)
    })
  })

  it('requires a name before it asks the server', async () => {
    open('/settings/templates/w1', { 'PUT /offer-templates/w1': () => ({ status: 200, body: WIZARD }) })
    await textArea()
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '  ' } })
    fireEvent.click(save())
    expect(await screen.findByText('This field is required.')).not.toBeNull()
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
  })
})

describe('the document title (one field per language)', () => {
  const titleIt = () => screen.getByLabelText(w.documentTitle.field(strings.offers.languageName.it)) as HTMLInputElement
  const titleEn = () => screen.getByLabelText(w.documentTitle.field(strings.offers.languageName.en)) as HTMLInputElement
  const putOf = (puts: Record<string, unknown>[]) => ({
    'PUT /offer-templates/w1': (_url: URL, init?: RequestInit) => {
      puts.push(body(init))
      return { status: 200, body: { ...WIZARD, ...body(init), version: 4 } }
    },
  })

  it('shows a field per language, each with the default words as its placeholder and the hint spelling what is added', async () => {
    open('/settings/templates/w1')
    await textArea()
    expect(titleIt().placeholder).toBe('CONTRATTO DI FORNITURA')
    expect(titleEn().placeholder).toBe('SUPPLY CONTRACT')
    expect(titleIt().value).toBe('')
    expect(titleEn().value).toBe('')
    expect(screen.getByTestId('crm-template-title-it').textContent).toContain(w.documentTitle.hint(' – Rif. 0017/2026'))
    expect(screen.getByTestId('crm-template-title-en').textContent).toContain(w.documentTitle.hint(' – Ref. 0017/2026'))
  })

  it('loads the words the template has, and none for a template that predates them', async () => {
    open('/settings/templates/w1', {
      'GET /offer-templates/w1': () => ({ status: 200, body: { ...WIZARD, documentTitle: { it: 'OFFERTA', en: null } } }),
    })
    await textArea()
    expect(titleIt().value).toBe('OFFERTA')
    expect(titleEn().value).toBe('')
  })

  it('saves what is typed, trimmed, and a blank language as null; both languages travel in the one body', async () => {
    const puts: Record<string, unknown>[] = []
    open('/settings/templates/w1', putOf(puts))
    await textArea()
    fireEvent.change(titleIt(), { target: { value: '  OFFERTA  ' } })
    fireEvent.change(titleEn(), { target: { value: '   ' } })
    fireEvent.click(save())
    expect(await screen.findByText(t.editor.saved)).not.toBeNull()
    expect(puts[0]!['documentTitle']).toEqual({ it: 'OFFERTA', en: null })
    // clearing a stored one sends null: the default again
    fireEvent.change(titleIt(), { target: { value: '' } })
    fireEvent.click(save())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]!['documentTitle']).toEqual({ it: null, en: null })
  })

  it('counts the characters against the limit and refuses more, naming the limit, before it asks the server', async () => {
    const puts: Record<string, unknown>[] = []
    open('/settings/templates/w1', putOf(puts))
    await textArea()
    fireEvent.change(titleEn(), { target: { value: 'x'.repeat(61) } })
    expect(screen.getByTestId('crm-template-title-en').textContent).toContain(w.documentTitle.count(61, 60))
    fireEvent.click(save())
    expect(await screen.findByText(strings.common.validation.tooLong(60))).not.toBeNull()
    expect(titleEn().getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(titleEn()))
    expect(puts).toEqual([])
    // exactly the limit is fine, and the error goes away with the next keystroke
    fireEvent.change(titleEn(), { target: { value: 'x'.repeat(60) } })
    expect(titleEn().getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(save())
    await waitFor(() => expect(puts).toHaveLength(1))
  })

  it('refuses a character the document cannot print, in our words', async () => {
    const puts: Record<string, unknown>[] = []
    open('/settings/templates/w1', putOf(puts))
    await textArea()
    fireEvent.change(titleIt(), { target: { value: 'OFFERTA 日本' } })
    fireEvent.click(save())
    expect(await screen.findByText(w.documentTitle.unprintable)).not.toBeNull()
    expect(puts).toEqual([])
  })

  it('puts the server’s refusal of a title on its field, and keeps what was typed', async () => {
    open('/settings/templates/w1', {
      'PUT /offer-templates/w1': () =>
        problemAnswer(422, 'validation_failed', { detail: 'documentTitle.en: Must be one line', field: 'documentTitle.en' }),
    })
    await textArea()
    fireEvent.change(titleEn(), { target: { value: 'OFFER' } })
    fireEvent.click(save())
    expect(await screen.findByText('documentTitle.en: Must be one line')).not.toBeNull()
    expect(titleEn().value).toBe('OFFER')
    expect(titleEn().getAttribute('aria-invalid')).toBe('true')
  })

  it('is read-only with the rest of the form for an entity the caller does not manage', async () => {
    open('/settings/templates/w1', {
      'GET /offer-templates/w1': () => ({ status: 200, body: { ...WIZARD, entity: 'welld_it', documentTitle: { it: 'OFFERTA', en: null } } }),
    })
    await textArea()
    expect(titleIt().matches(':disabled')).toBe(true)
    expect(titleIt().value).toBe('OFFERTA')
  })

  it('a new template starts with both empty and creates with them as null', async () => {
    let posted: Record<string, unknown> | null = null
    open('/settings/templates/new/welld_ch', {
      'POST /offer-templates': (_url, init) => {
        posted = body(init)
        return { status: 201, body: { ...WIZARD, id: 'w7', name: 'Brand new', version: 1 } }
      },
      'GET /offer-templates/w7': () => ({ status: 200, body: { ...WIZARD, id: 'w7', name: 'Brand new', version: 1 } }),
    })
    await textArea()
    expect(titleIt().value).toBe('')
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Brand new' } })
    fireEvent.change(titleEn(), { target: { value: 'OFFER' } })
    await setText(SOURCE)
    await waitFor(() => expect(save().getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(save())
    await waitFor(() => expect(window.location.pathname).toBe('/settings/templates/w7'))
    expect((posted as unknown as Record<string, unknown>)['documentTitle']).toEqual({ it: null, en: 'OFFER' })
  })
})

describe('a new template', () => {
  it('is created in the entity of the path with only the readable fields, then opened', async () => {
    let posted: Record<string, unknown> | null = null
    open('/settings/templates/new/welld_ch', {
      'POST /offer-templates': (_url, init) => {
        posted = body(init)
        return { status: 201, body: { ...WIZARD, id: 'w7', name: 'Brand new', version: 1 } }
      },
      'GET /offer-templates/w7': () => ({ status: 200, body: { ...WIZARD, id: 'w7', name: 'Brand new', version: 1 } }),
    })
    await textArea()
    // nothing typed yet: the text has errors (no salutation, no cost section), so Save waits
    await waitFor(() => expect(save().getAttribute('aria-disabled')).toBe('true'))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Brand new' } })
    fireEvent.change(screen.getByLabelText(new RegExp(`^${w.description}`)), { target: { value: 'Fresh' } })
    await setText(SOURCE)
    await waitFor(() => expect(save().getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(save())
    await waitFor(() => expect(window.location.pathname).toBe('/settings/templates/w7'))
    expect(posted).toEqual({
      entity: 'welld_ch',
      name: 'Brand new',
      language: 'it',
      description: 'Fresh',
      uses: [],
      source: SOURCE,
      documentTitle: { it: null, en: null },
    })
  })

  it('refuses an entity that does not exist', async () => {
    open('/settings/templates/new/nowhere')
    expect(await screen.findByText(t.editor.unknownEntity)).not.toBeNull()
  })

  it('warns that saving archives the classic templates of the language when it is the first wizard one', async () => {
    const classicIt = { ...CLASSIC, id: 'k2', name: 'Vecchio', language: 'it' }
    open('/settings/templates/new/welld_ch', {
      'GET /offer-templates': () => ({
        status: 200,
        body: { items: [classicIt, { ...classicIt, id: 'k3', name: 'Vecchio 2' }] },
      }),
    })
    expect(await screen.findByText(w.supersede(strings.offers.languageName.it, 2))).not.toBeNull()
    fireEvent.change(screen.getByLabelText(/^Language/), { target: { value: 'en' } })
    expect(screen.queryByText(/will be archived/)).toBeNull()
  })

  it('does not warn when the language already has a wizard template', async () => {
    open('/settings/templates/new/welld_ch', {
      'GET /offer-templates': () => ({ status: 200, body: { items: [WIZARD, { ...CLASSIC, language: 'it' }] } }),
    })
    await textArea()
    await waitFor(() => expect(apiFetch.mock.calls.some(([url]) => String(url).includes('formats='))).toBe(true))
    expect(screen.queryByText(/will be archived/)).toBeNull()
  })
})
