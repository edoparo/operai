/**
 * @vitest-environment jsdom
 *
 * ConfiguratorPage (task T21; design S1, F1, F2, F6, F10, F11; AC-5.x, 6.x, 8.3): the form on the loaded
 * version or on the catalog's starting values, a labelled control for every field of the configuration,
 * keyboard-only operation, the read-only modes and axe. Mounted through `App`, so the entity is read from
 * the address and the requests are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { catalogFixture, defaultConfigFixture, fullConfigFixture } from '../lib/formStateFixtures'
import { axeViolations } from '../lib/formStateAxe'
import { fakeApi, letterheadList, previewAnswer, problem } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import type { FormConfig } from '../lib/formStateTypes'
import type { LetterheadList } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import App from '../App'

const versionRoute = (entity: string, n: number, config: FormConfig): Record<string, FakeHandler> => ({
  [`GET /v1/letterheads/${entity}/versions/${n}`]: () => ({
    status: 200,
    body: { version: n, layoutVersion: 1, config },
  }),
})

async function renderPage({
  path = '/letterheads',
  list = letterheadList({
    welld_it: { activeVersion: null, canManage: true },
    welld_ch: { activeVersion: null, canManage: true },
  }),
  routes = {},
  catalog = catalogFixture(),
}: {
  path?: string
  list?: LetterheadList
  routes?: Record<string, FakeHandler>
  catalog?: unknown
} = {}) {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /v1/catalog': () => ({ status: 200, body: catalog }),
      'GET /v1/letterheads': () => ({ status: 200, body: list }),
      // The live preview (T22) is asked for by every form; its own tests are in PreviewPane.test.tsx.
      'POST /v1/letterheads/welld_it/preview': () => ({ status: 200, body: previewAnswer(1) }),
      'POST /v1/letterheads/welld_ch/preview': () => ({ status: 200, body: previewAnswer(1) }),
      ...routes,
    }),
  )
  window.history.pushState(null, '', path)
  const view = render(<App />)
  await screen.findByTestId('letterheads-page')
  return view
}

const form = () => screen.findByTestId('letterheads-form')
const input = (name: string | RegExp, within_: HTMLElement | undefined = undefined) =>
  within(within_ ?? document.body).getByRole('textbox', { name }) as HTMLInputElement
const dirty = () => screen.getByTestId('letterheads-status').textContent

beforeEach(() => {
  window.scrollTo = () => undefined
  // user-event walks a radio group with `CSS.escape`, which jsdom does not have.
  if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== 'function') {
    Object.assign(globalThis, { CSS: { escape: (value: string) => value } })
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Every JSON Pointer of a leaf (a value that is not an object or an array) of `value`. */
function leafPointers(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPointers(item, `${at}/${index}`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leafPointers(child, `${at}/${key}`))
  }
  return [at]
}

/** What a control is called: its label's text, its `aria-label`, or the element its `aria-labelledby` names. */
function accessibleName(element: HTMLElement): string {
  const labelled = (element.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
  const labels = Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? '')
  return [element.getAttribute('aria-label') ?? '', labelled, ...labels].join(' ').trim()
}

describe('the form on the starting values of an entity with no letterhead (G2, design S2)', () => {
  it('shows the catalog’s defaultConfig, says so, and asks for nothing from the service but the lists and the preview', async () => {
    await renderPage()
    expect(await form()).not.toBeNull()
    expect(screen.getByTestId('letterheads-empty-banner').textContent).toContain('wellD IT has no letterhead yet')
    expect(screen.getByRole('heading', { level: 2, name: 'wellD IT' })).not.toBeNull()
    expect(screen.getByText('No letterhead yet')).not.toBeNull()
    expect(input('Top').value).toBe('25')
    const left = document.querySelector('[data-zone="/variants/default/footer/left"]') as HTMLElement
    expect(input('Text, Italian', within(left).getByRole('group', { name: 'Line 1' })).value).toBe('{legal_name}')
    // The preview is asked after the form shows (a debounce, then a fetch): wait for it, or a busy machine reads two calls.
    await waitFor(() => expect(apiFetch.mock.calls).toHaveLength(3))
    const urls = apiFetch.mock.calls.map(([url]) => String(url))
    // The lists, then the live preview of the starting values (T22): the sample is the service's own (AC-8.5).
    expect(urls).toEqual([
      'http://letterhead-api.test/v1/catalog',
      'http://letterhead-api.test/v1/letterheads',
      'http://letterhead-api.test/v1/letterheads/welld_it/preview',
    ])
    expect(dirty()).toBe('No unsaved changes')
  })

  it('opens on the first entity the person may change when the address names none', async () => {
    await renderPage({
      list: letterheadList({
        welld_it: { activeVersion: null, canManage: false },
        welld_ch: { activeVersion: null, canManage: true },
      }),
    })
    expect(screen.getByRole('tab', { name: 'wellD CH' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'wellD CH' })).not.toBeNull()
  })

  it('opens on the entity of ?entity, and falls back for a value that is not an entity', async () => {
    await renderPage({ path: '/letterheads?entity=welld_ch' })
    expect(screen.getByRole('tab', { name: 'wellD CH' }).getAttribute('aria-selected')).toBe('true')
    cleanup()
    await renderPage({ path: '/letterheads?entity=nope' })
    expect(screen.getByRole('tab', { name: 'wellD IT' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('the form on the active version (design F1.3)', () => {
  const list = letterheadList({ welld_it: { activeVersion: 3, canManage: true } })

  it('shows a loading line, then the active version’s values, not the starting ones', async () => {
    const config = defaultConfigFixture()
    config.margins.top = 31.5
    config.variants.default.footer.left[0].text.it = 'Ragione sociale: {legal_name}'
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    await renderPage({
      list,
      routes: {
        'GET /v1/letterheads/welld_it/versions/3': async () => {
          await held
          return { status: 200, body: { version: 3, layoutVersion: 1, config } }
        },
      },
    })
    expect(screen.getByText('Loading letterheads…')).not.toBeNull()
    expect(screen.queryByTestId('letterheads-form')).toBeNull()
    expect(screen.getByText('Active version 3')).not.toBeNull()
    release()
    await form()
    expect(screen.queryByText('Loading letterheads…')).toBeNull()
    expect(input('Top').value).toBe('31.5')
    expect(screen.queryByTestId('letterheads-empty-banner')).toBeNull()
    expect(document.querySelector('[data-pointer="/variants/default/footer/left/0/text/it"]')).toHaveProperty(
      'value',
      'Ragione sociale: {legal_name}',
    )
    expect(apiFetch.mock.calls.map(([url]) => String(url))).toContain(
      'http://letterhead-api.test/v1/letterheads/welld_it/versions/3',
    )
  })

  it('shows a failed load with Retry, and loads again on Retry', async () => {
    let calls = 0
    await renderPage({
      list,
      routes: {
        'GET /v1/letterheads/welld_it/versions/3': () =>
          ++calls === 1
            ? problem(500, undefined, {}, 'The version is broken.')
            : { status: 200, body: { version: 3, layoutVersion: 1, config: defaultConfigFixture() } },
      },
    })
    expect((await screen.findByTestId('letterheads-load-error')).textContent).toContain('The version is broken.')
    await userEvent.click(screen.getByTestId('letterheads-load-error-retry'))
    await form()
    expect(calls).toBe(2)
  })

  it('shows a catalog that is not the one it needs as a failure to load, not a broken form', async () => {
    await renderPage({ list, catalog: { fonts: [], placeholders: [] } })
    expect(screen.getByTestId('letterheads-catalog-invalid').textContent).toContain('Could not load')
    expect(screen.queryByTestId('letterheads-form')).toBeNull()
  })
})

describe('switching entity (design F2)', () => {
  it('shows the other entity’s version, replaces ?entity, and says so politely', async () => {
    const list = letterheadList({
      welld_it: { activeVersion: 3, canManage: true },
      welld_ch: { activeVersion: 2, canManage: true },
    })
    const ch = defaultConfigFixture()
    ch.margins.top = 44
    await renderPage({
      list,
      routes: { ...versionRoute('welld_it', 3, defaultConfigFixture()), ...versionRoute('welld_ch', 2, ch) },
    })
    await form()
    expect(input('Top').value).toBe('25')
    const before = window.history.length
    await userEvent.click(screen.getByRole('tab', { name: 'wellD CH' }))
    await waitFor(() => expect(input('Top').value).toBe('44'))
    expect(window.location.search).toContain('entity=welld_ch')
    expect(window.history.length).toBe(before)
    expect(screen.getByText('Active version 2')).not.toBeNull()
    expect(screen.getByTestId('letterheads-announcer').textContent).toContain('Showing wellD CH')
  })

  it('each entity starts its own clean form', async () => {
    await renderPage()
    await form()
    await userEvent.type(input('Top'), '5')
    expect(dirty()).toBe('Unsaved changes')
    await userEvent.click(screen.getByRole('tab', { name: 'wellD CH' }))
    // The form holds changes, so the switch asks first (T24, design F9).
    await userEvent.click(await screen.findByTestId('letterheads-leave-confirm'))
    await waitFor(() => expect(dirty()).toBe('No unsaved changes'))
    expect(input('Top').value).toBe('25')
  })
})

describe('a labelled control for every field of the configuration (AC-8.3)', () => {
  const fullList = letterheadList({ welld_it: { activeVersion: 5, canManage: true } })
  // The asset ids are the file fields' (T23): the file is chosen there, never typed here.
  const assetPointers = /^\/variants\/(default|first|last)\/(logo\/asset|background)$/

  async function renderFull() {
    await renderPage({ list: fullList, routes: versionRoute('welld_it', 5, fullConfigFixture()) })
    await form()
  }

  it('has a named control at the pointer of each leaf of a configuration that uses everything', async () => {
    await renderFull()
    const leaves = leafPointers(fullConfigFixture()).filter((path) => !assetPointers.test(path))
    expect(leaves.length).toBeGreaterThan(100)
    const missing: string[] = []
    const unnamed: string[] = []
    for (const path of leaves) {
      const controls = Array.from(document.querySelectorAll<HTMLElement>(`[data-pointer="${path}"]`))
      if (controls.length === 0) missing.push(path)
      for (const control of controls) if (accessibleName(control) === '') unnamed.push(path)
    }
    expect(missing).toEqual([])
    expect(unnamed).toEqual([])
  })

  it('has no control for anything that is not a field of the configuration (apart from the two page switches)', async () => {
    await renderFull()
    const leaves = new Set(leafPointers(fullConfigFixture()))
    const strays = Array.from(document.querySelectorAll<HTMLElement>('[data-pointer]'))
      .map((element) => element.getAttribute('data-pointer')!)
      .filter((path) => !leaves.has(path) && path !== '/variants/first' && path !== '/variants/last')
    expect(strays).toEqual([])
  })

  it('has the switches of the first and last page, named, and ticked when the version has them', async () => {
    await renderFull()
    for (const [path, name] of [
      ['/variants/first', 'Use a different first page'],
      ['/variants/last', 'Use a different last page'],
    ] as const) {
      const box = document.querySelector<HTMLInputElement>(`[data-pointer="${path}"]`)!
      expect(accessibleName(box)).toBe(name)
      expect(box.checked).toBe(true)
    }
  })

  it('has a control for each of the default configuration’s leaves too, and the two switches unticked', async () => {
    await renderPage()
    await form()
    const missing = leafPointers(defaultConfigFixture())
      .filter((path) => !assetPointers.test(path))
      // A rule that is off keeps its thickness and colour out of the page; a page with no logo has no logo to place.
      .filter((path) => !/\/header\/rule\/(thicknessPt|color)$/.test(path) && !/\/logo$/.test(path))
      .filter((path) => document.querySelector(`[data-pointer="${path}"]`) === null)
    expect(missing).toEqual([])
    expect(document.querySelector<HTMLInputElement>('[data-pointer="/variants/first"]')!.checked).toBe(false)
    expect(document.querySelector<HTMLInputElement>('[data-pointer="/variants/last"]')!.checked).toBe(false)
  })

  it('offers each font of the catalog, in the three font selects, and the current value', async () => {
    await renderPage()
    await form()
    for (const name of ['Body text', 'Headings', 'Header and footer']) {
      const select = screen.getByRole('combobox', { name }) as HTMLSelectElement
      expect(Array.from(select.options).map((option) => option.value)).toEqual(catalogFixture().fonts)
    }
    expect((screen.getByRole('combobox', { name: 'Body text' }) as HTMLSelectElement).value).toBe('Noto Serif')
  })

  it('keeps a font the catalog does not list, rather than replacing it', async () => {
    const config = defaultConfigFixture()
    config.fonts.body = 'Retired Sans'
    await renderPage({ list: fullList, routes: versionRoute('welld_it', 5, config) })
    await form()
    const select = screen.getByRole('combobox', { name: 'Body text' }) as HTMLSelectElement
    expect(select.value).toBe('Retired Sans')
  })

  it('shows a rule’s thickness and colour only while the rule is ticked, and keeps their values', async () => {
    await renderPage()
    await form()
    const header = document.querySelector('[data-frame="/variants/default/header"]') as HTMLElement
    expect(header.querySelector('[data-pointer$="/rule/thicknessPt"]')).toBeNull()
    expect(header.querySelector('[data-pointer$="/rule/color"]')).toBeNull()
    await userEvent.click(within(header).getByRole('checkbox', { name: 'Draw a line between the header and the body' }))
    expect((header.querySelector('[data-pointer$="/rule/thicknessPt"]') as HTMLInputElement).value).toBe('0.5')
    expect((header.querySelector('[data-pointer$="/rule/color"]') as HTMLInputElement).value).toBe('c9cad1')
    await userEvent.click(within(header).getByRole('checkbox', { name: 'Draw a line between the header and the body' }))
    expect(header.querySelector('[data-pointer$="/rule/thicknessPt"]')).toBeNull()
  })

  it('shows a logo’s position and height only for a variant that has a logo', async () => {
    await renderPage()
    await form()
    expect(document.querySelector('[data-pointer$="/logo/position"]')).toBeNull()
    cleanup()
    await renderFull()
    expect(document.querySelectorAll('[data-pointer$="/logo/heightMm"]')).toHaveLength(3)
    const height = document.querySelector<HTMLInputElement>('[data-pointer="/variants/default/logo/heightMm"]')!
    expect(height.value).toBe('12.7')
    expect(document.getElementById(height.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Between 5 and 40 mm. It must fit the top margin together with the header lines. The width follows the proportions.',
    )
  })

  it('states the bounds of the margins from the catalog', async () => {
    await renderPage()
    await form()
    expect(screen.getByText('Between 5 and 100 mm. The body area must stay at least 100 × 150 mm.')).not.toBeNull()
  })
})

describe('editing', () => {
  it('a typed value changes the form and is dirty; typing the original back is clean', async () => {
    await renderPage()
    await form()
    const top = input('Top')
    await userEvent.clear(top)
    await userEvent.type(top, '30,5')
    expect(top.value).toBe('30,5')
    expect(dirty()).toBe('Unsaved changes')
    await userEvent.clear(top)
    await userEvent.type(top, '25.0')
    expect(dirty()).toBe('No unsaved changes')
  })

  it('never clamps: a value out of range, or not a number, stays as typed', async () => {
    await renderPage()
    await form()
    const top = input('Top')
    await userEvent.clear(top)
    await userEvent.type(top, '500')
    expect(top.value).toBe('500')
    await userEvent.clear(top)
    await userEvent.type(top, 'abc')
    expect(top.value).toBe('abc')
  })

  it('every number field takes the decimal keypad and every colour field is a six-digit text box', async () => {
    await renderPage()
    await form()
    expect(input('Top').getAttribute('inputmode')).toBe('decimal')
    expect(input('Line spacing').getAttribute('inputmode')).toBe('decimal')
    expect(input('Header row background').getAttribute('maxlength')).toBeNull()
  })

  it('a select and a radio group change the configuration', async () => {
    await renderPage()
    await form()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Headings' }), 'Syne')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'List marker (bulleted lists)' }), 'dash')
    const header = document.querySelector('[data-frame="/variants/default/header"]') as HTMLElement
    await userEvent.click(within(header).getByRole('radio', { name: 'Bottom' }))
    expect(dirty()).toBe('Unsaved changes')
    expect((screen.getByRole('combobox', { name: 'Headings' }) as HTMLSelectElement).value).toBe('Syne')
    expect((within(header).getByRole('radio', { name: 'Bottom' }) as HTMLInputElement).checked).toBe(true)
  })
})

describe('the first and last page (design F6)', () => {
  it('start off, showing only their switch and the rule; the switch has a hint', async () => {
    await renderPage()
    await form()
    const card = screen.getByTestId('variant-first')
    expect(within(card).getByRole('checkbox', { name: 'Use a different first page' })).not.toBeNull()
    expect(within(card).getByText('Not used. Its settings are kept in this form until you leave.')).not.toBeNull()
    expect(card.querySelector('[data-pointer^="/variants/first/"]')).toBeNull()
    expect(within(card).getByText('Without it, page 1 uses the default page.')).not.toBeNull()
    expect(within(screen.getByTestId('variant-last')).getByText(/never changes where pages break/)).not.toBeNull()
  })

  it('switching on shows a copy of the default page, keeps focus on the switch and says so; off restores nothing to save', async () => {
    await renderPage()
    await form()
    const box = screen.getByRole('checkbox', { name: 'Use a different first page' })
    box.focus()
    await userEvent.keyboard(' ')
    const card = screen.getByTestId('variant-first')
    expect(document.activeElement).toBe(box)
    expect(
      (card.querySelector('[data-pointer="/variants/first/footer/left/0/text/it"]') as HTMLInputElement).value,
    ).toBe('{legal_name}')
    expect(screen.getByTestId('letterheads-announcer').textContent).toContain('First page settings shown')
    expect(dirty()).toBe('Unsaved changes')
    await userEvent.keyboard(' ')
    expect(card.querySelector('[data-pointer^="/variants/first/"]')).toBeNull()
    expect(document.activeElement).toBe(box)
    expect(screen.getByTestId('letterheads-announcer').textContent).toContain('First page settings hidden')
    expect(dirty()).toBe('No unsaved changes')
  })

  it('switched off and on again, the page comes back as it was typed', async () => {
    await renderPage()
    await form()
    const box = screen.getByRole('checkbox', { name: 'Use a different last page' })
    await userEvent.click(box)
    const card = screen.getByTestId('variant-last')
    const text = () => card.querySelector('[data-pointer="/variants/last/footer/left/0/text/it"]') as HTMLInputElement
    await userEvent.clear(text())
    await userEvent.type(text(), 'Ultima pagina')
    await userEvent.click(box)
    await userEvent.click(box)
    expect(text().value).toBe('Ultima pagina')
  })

  it('a line added to the last page does not appear on the default page', async () => {
    await renderPage()
    await form()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use a different last page' }))
    const card = screen.getByTestId('variant-last')
    const footer = card.querySelector('[data-frame="/variants/last/footer"]') as HTMLElement
    await userEvent.click(
      within(within(footer).getByRole('group', { name: 'Centre zone' })).getByRole('button', { name: 'Add a line' }),
    )
    expect(footer.querySelector('[data-pointer="/variants/last/footer/center/0/text/it"]')).not.toBeNull()
    expect(document.querySelector('[data-pointer="/variants/default/footer/center/0/text/it"]')).toBeNull()
  })
})

describe('the help card (design § How the frame model is exposed)', () => {
  const open = async () => {
    await form()
    const summary = screen.getByText('Placeholders and special characters')
    await userEvent.click(summary)
    return summary.closest('details') as HTMLDetailsElement
  }

  it('is collapsed, and lists the placeholders of the catalog, with their meaning', async () => {
    await renderPage()
    await form()
    expect(
      (screen.getByText('Placeholders and special characters').closest('details') as HTMLDetailsElement).open,
    ).toBe(false)
    const details = await open()
    expect(details.open).toBe(true)
    const names = Array.from(details.querySelectorAll('dt')).map((dt) => dt.textContent)
    expect(names).toEqual(['{legal_name}', '{address}', '{vat}', '{iban}', '{contacts}', '{page}', '{pages}'])
    expect(within(details).getByText('The VAT number')).not.toBeNull()
    expect(within(details).getByText(/Examples: Page \{page\} of \{pages\}, \{page\}\/\{pages\}/)).not.toBeNull()
  })

  it('lists a placeholder the catalog adds later by its name alone', async () => {
    const catalog = catalogFixture() as Record<string, unknown[]>
    await renderPage({
      catalog: { ...catalog, placeholders: [...catalog.placeholders, { name: 'fax', perPage: false }] },
    })
    const details = await open()
    const names = Array.from(details.querySelectorAll('dt')).map((dt) => dt.textContent)
    expect(names.at(-1)).toBe('{fax}')
    expect(details.querySelectorAll('dd')[7].textContent).toBe('')
  })

  it('shows what to type for a literal brace and bracket, as the catalog gives it', async () => {
    await renderPage()
    const details = await open()
    const table = within(details).getByRole('table', { name: 'A brace or a bracket in the text' })
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((td) => td.textContent),
    )
    expect(rows).toEqual([
      ['{{', '{'],
      ['}}', '}'],
      ['[[', '['],
      [']]', ']'],
    ])
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['You type', 'It prints'])
  })

  it('explains the conditional segment, the fit rule with the catalog’s number, and the lines', async () => {
    await renderPage()
    const details = await open()
    expect(within(details).getByText(/\[VAT: \{vat\}\] prints "VAT: CHE-123.456.789"/)).not.toBeNull()
    expect(within(details).getByText(/replaced by a 40-character value/)).not.toBeNull()
    expect(
      within(details).getByText(
        'Each zone holds up to 4 lines. Each line has its own size (6 to 14 pt), weight and colour.',
      ),
    ).not.toBeNull()
  })

  it('has its summary in the tab order, so the keyboard reaches it before the form', async () => {
    await renderPage()
    await form()
    const summary = screen.getByText('Placeholders and special characters')
    ;(screen.getByRole('tab', { name: 'wellD IT' }) as HTMLElement).focus()
    await userEvent.tab() // the entity's panel
    await userEvent.tab() // the Settings | History tabs (T25)
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Settings' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(summary)
  })
})

describe('read-only modes (design F10, F11, S5)', () => {
  it('a holder of access without the manage permission sees the form inert, with the reason, and can still open the help', async () => {
    await renderPage({
      list: letterheadList({
        welld_it: { activeVersion: 3, canManage: false },
        welld_ch: { activeVersion: 1, canManage: false },
      }),
      routes: versionRoute('welld_it', 3, fullConfigFixture()),
    })
    await form()
    expect(screen.getByTestId('letterheads-readonly-banner').textContent).toContain('you cannot change it')
    expect(input('Top').matches(':disabled')).toBe(true)
    expect(input('Top').value).toBe('25')
    const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-pointer]'))
    expect(controls.length).toBeGreaterThan(100)
    expect(controls.every((control) => (control as HTMLInputElement).matches(':disabled'))).toBe(true)
    for (const button of screen.getAllByRole('button', { name: 'Add a line' }))
      expect((button as HTMLButtonElement).matches(':disabled')).toBe(true)
    const help = screen.getByText('Placeholders and special characters')
    expect(help.closest('fieldset')).toBeNull()
    await userEvent.click(help)
    expect((help.closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('a manager of one entity sees the other read-only and is told which one they can change', async () => {
    await renderPage({
      path: '/letterheads?entity=welld_ch',
      list: letterheadList({
        welld_it: { activeVersion: 3, canManage: true },
        welld_ch: { activeVersion: 1, canManage: false },
      }),
      routes: versionRoute('welld_ch', 1, defaultConfigFixture()),
    })
    await form()
    expect(screen.getByTestId('letterheads-readonly-banner').textContent).toBe(
      'You can change only the letterhead of wellD IT. This one is read-only for you.',
    )
    expect(input('Top').matches(':disabled')).toBe(true)
  })

  it('an entity with nothing saved, for someone who cannot change it, is an empty state and no form', async () => {
    await renderPage({ list: letterheadList() })
    expect(screen.getByTestId('letterheads-empty-readonly').textContent).toContain('Ask an administrator.')
    expect(screen.queryByTestId('letterheads-form')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('keyboard-only operation (AC-8.3)', () => {
  const TABBABLE =
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), button:not([disabled]), summary, [tabindex="0"]'

  it('every control is reached by Tab, in page order, with no trap and no positive tabindex', async () => {
    await renderPage({
      list: letterheadList({ welld_it: { activeVersion: 5, canManage: true } }),
      routes: versionRoute('welld_it', 5, fullConfigFixture()),
    })
    await form()
    const radios = new Set<HTMLInputElement>()
    // One radio of a group is a tab stop (the browser's rule); the others are reached with the arrows.
    const expected = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter((element) => {
      if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') === '-1') return false
      if (element instanceof HTMLInputElement && element.type === 'radio') {
        const checked = document.querySelector(`input[type="radio"][name="${element.name}"]:checked`)
        if (checked !== null && checked !== element) return false
        radios.add(element)
      }
      return true
    })
    expect(document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveLength(0)
    expect(expected.length).toBeGreaterThan(150)
    const reached: HTMLElement[] = []
    ;(screen.getByRole('tab', { name: 'wellD IT' }) as HTMLElement).focus()
    for (let step = 0; step < expected.length + 10; step += 1) {
      await userEvent.tab()
      const active = document.activeElement as HTMLElement
      if (!expected.includes(active)) break
      reached.push(active)
    }
    // The help summary comes first in the form; the tab panel itself is a stop before it.
    const inForm = reached.filter((element) => expected.includes(element))
    expect(inForm.length).toBeGreaterThanOrEqual(expected.length - 1)
    const positions = inForm.map((element) => expected.indexOf(element))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('a person can reach, change and undo a value, a switch, a radio and a line with the keyboard alone', async () => {
    await renderPage()
    await form()
    const top = input('Top')
    top.focus()
    await userEvent.keyboard('{Control>}a{/Control}40')
    expect(top.value).toBe('40')
    await userEvent.tab()
    expect(document.activeElement).toBe(input('Bottom'))

    const valign = within(document.querySelector('[data-frame="/variants/default/header"]') as HTMLElement).getByRole(
      'radio',
      { name: 'Top' },
    )
    valign.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(
      document.querySelector<HTMLInputElement>('[data-pointer="/variants/default/header/valign"]:checked')
        ?.parentElement?.textContent,
    ).toBe('Bottom')

    const first = screen.getByRole('checkbox', { name: 'Use a different first page' })
    first.focus()
    await userEvent.keyboard(' ')
    expect(document.querySelector('[data-pointer="/variants/first/margins"]')).toBeNull()
    expect(document.querySelector('[data-pointer="/variants/first/footer/left/0/text/it"]')).not.toBeNull()

    const add = within(document.querySelector('[data-zone="/variants/default/header/left"]') as HTMLElement).getByRole(
      'button',
      { name: 'Add a line' },
    )
    add.focus()
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(
      document.querySelector('[data-pointer="/variants/default/header/left/0/text/it"]'),
    )
    await userEvent.keyboard('Ciao')
    expect((document.activeElement as HTMLInputElement).value).toBe('Ciao')
    // Italian text, English text, size, bold, colour, remove: then the Add button, which stays after the lines.
    for (let step = 0; step < 6; step += 1) await userEvent.tab()
    expect(document.activeElement).toBe(add)
  })

  it('moves between the entity tabs with the arrow keys', async () => {
    await renderPage()
    await form()
    ;(screen.getByRole('tab', { name: 'wellD IT' }) as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'wellD CH' }).getAttribute('aria-selected')).toBe('true'),
    )
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'wellD CH' }))
  })
})

describe('refused values are marked next to their control', () => {
  it('has the seam: a problem at a pointer marks the control invalid with the generic sentence', async () => {
    // The page gets problems from T22 (a refused preview) and T24 (a refused save); here only the control side is checked.
    const { FormHarness } = await import('../lib/formStateHarness')
    const { NumberField } = await import('../components/VariantCardFields')
    render(
      <FormHarness problems={[{ path: '/margins/top', reason: 'out_of_range' }]}>
        {(state) => <NumberField label="Top" pointer="/margins/top" value={state.config.margins.top} />}
      </FormHarness>,
    )
    const field = screen.getByRole('textbox', { name: 'Top' })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('refused')
    await userEvent.type(field, '1')
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })
})

describe('accessibility (axe)', () => {
  it('has no violations on the starting values, with the help card open', async () => {
    const { container } = await renderPage()
    await form()
    await userEvent.click(screen.getByText('Placeholders and special characters'))
    expect(await axeViolations(container)).toEqual([])
  })

  it('has no violations on a version that uses everything', async () => {
    const { container } = await renderPage({
      list: letterheadList({ welld_it: { activeVersion: 5, canManage: true } }),
      routes: versionRoute('welld_it', 5, fullConfigFixture()),
    })
    await form()
    expect(await axeViolations(container)).toEqual([])
  })

  it('has no violations read-only', async () => {
    const { container } = await renderPage({
      list: letterheadList({ welld_it: { activeVersion: 5, canManage: false } }),
      routes: versionRoute('welld_it', 5, fullConfigFixture()),
    })
    await form()
    expect(await axeViolations(container)).toEqual([])
  })

  it('has no violations while loading, failed, empty for a reader and on an unusable catalog', async () => {
    const { container } = await renderPage({ list: letterheadList() })
    expect(await axeViolations(container)).toEqual([])
    cleanup()
    const failed = await renderPage({
      list: letterheadList({ welld_it: { activeVersion: 5, canManage: true } }),
      routes: { 'GET /v1/letterheads/welld_it/versions/5': () => problem(500) },
    })
    await screen.findByTestId('letterheads-load-error')
    expect(await axeViolations(failed.container)).toEqual([])
    cleanup()
    const broken = await renderPage({ catalog: {} })
    expect(await axeViolations(broken.container)).toEqual([])
  })
})
