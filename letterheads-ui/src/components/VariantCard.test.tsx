/**
 * @vitest-environment jsdom
 *
 * The Logo and Background image sections of VariantCard (task T23; design F5, S1; AC-7.4, 7.7): the file field,
 * the asset id the form then holds, and the logo's position and height, shown only while a logo exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isDirty } from '../lib/formState'
import type { FormState } from '../lib/formState'
import { axeViolations } from '../lib/formStateAxe'
import { fullConfigFixture } from '../lib/formStateFixtures'
import { FormHarness } from '../lib/formStateHarness'
import type { FormConfig, Problem, VariantName } from '../lib/formStateTypes'
import { VariantCard } from './VariantCard'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
}))

const NEW_ID = '7b1c9d20-6f41-4d0a-9d3e-5a2f8c4e1b66'
const FULL_LOGO_ID = '3f2b8a52-9a5e-4e43-8b1d-0c5d1f2f7a10'
const FULL_BACKGROUND_ID = '9d7c6a41-52b3-4c0e-a7f4-6b1e2d3c4a55'

let latest: FormState
let uploadAnswer: () => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>

const stored = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } })

beforeEach(() => {
  let urls = 0
  URL.createObjectURL = vi.fn(() => `blob:thumbnail-${++urls}`)
  URL.revokeObjectURL = vi.fn()
  uploadAnswer = () => ({
    status: 201,
    body: { id: NEW_ID, kind: 'logo', format: 'png', width: 400, height: 150 },
  })
  apiFetch.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST') {
      const answer = await uploadAnswer()
      return new Response(JSON.stringify(answer.body), { status: answer.status })
    }
    const asset = /^\/v1\/assets\/([^/]+)$/.exec(url.pathname)
    return asset ? stored() : new Response(null, { status: 404 })
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderCard(
  name: VariantName = 'default',
  { config, problems, readOnly = false }: { config?: FormConfig; problems?: Problem[]; readOnly?: boolean } = {},
) {
  return render(
    <FormHarness config={config} problems={problems}>
      {(state) => {
        latest = state
        return (
          <fieldset disabled={readOnly}>
            <VariantCard entity="welld_ch" name={name} variant={state.config.variants[name]} />
          </fieldset>
        )
      }}
    </FormHarness>,
  )
}

const png = (name = 'logo.png') => new File([new Uint8Array(16)], name, { type: 'image/png' })
const section = (title: string) => screen.getByRole('group', { name: title })
const choose = (title: string, file = png()) =>
  userEvent.upload(
    // The hidden file input of the section's picker.
    within(section(title)).getByTestId(/-input$/) as HTMLInputElement,
    file,
  )

describe('VariantCard: Logo', () => {
  it('has a Logo section and a Background image section, each with its file field, under their own heading', () => {
    renderCard()
    expect(screen.getByRole('heading', { level: 4, name: 'Logo' })).not.toBeNull()
    expect(screen.getByRole('heading', { level: 4, name: 'Background image' })).not.toBeNull()
    expect(within(section('Logo')).getByRole('group', { name: 'Logo file' })).not.toBeNull()
    expect(within(section('Background image')).getByRole('group', { name: 'Background image file' })).not.toBeNull()
  })

  it('shows the position and the height only while there is a logo (AC-7.4)', () => {
    renderCard()
    expect(document.querySelector('[data-pointer$="/logo/position"]')).toBeNull()
    expect(document.querySelector('[data-pointer$="/logo/heightMm"]')).toBeNull()
    expect(within(section('Logo')).queryByRole('button', { name: 'Remove logo' })).toBeNull()
    cleanup()
    renderCard('default', { config: fullConfigFixture() })
    expect(document.querySelector('[data-pointer="/variants/default/logo/position"]')).not.toBeNull()
    expect(document.querySelector('[data-pointer="/variants/default/logo/heightMm"]')).not.toBeNull()
    expect(within(section('Logo')).getByRole('button', { name: 'Remove logo' })).not.toBeNull()
  })

  it('upload → thumbnail → the form holds the asset id, with a first position and height, and is dirty', async () => {
    renderCard()
    expect(isDirty(latest)).toBe(false)
    await choose('Logo')
    expect(await within(section('Logo')).findByRole('img', { name: 'Current logo' })).not.toBeNull()
    expect(within(section('Logo')).getByText('Current file: PNG, 400 × 150 px')).not.toBeNull()
    expect(latest.config.variants.default.logo).toEqual({ asset: NEW_ID, position: 'left', heightMm: 15 })
    expect(latest.config.variants.default.background).toBeNull()
    expect(isDirty(latest)).toBe(true)
    // The controls of what the logo now has.
    expect(document.querySelector('[data-pointer="/variants/default/logo/position"]')).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Height (mm)' })).toHaveProperty('value', '15')
    // The request names this entity and says it is a logo.
    const post = apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    expect(String(post[0])).toBe('http://letterhead-api.test/v1/letterheads/welld_ch/assets')
    expect((post[1].body as FormData).get('kind')).toBe('logo')
  })

  it('replacing a logo changes the file only: its position and height stay', async () => {
    renderCard('default', { config: fullConfigFixture() })
    await choose('Logo')
    await waitFor(() => expect(latest.config.variants.default.logo?.asset).toBe(NEW_ID))
    expect(latest.config.variants.default.logo).toEqual({ asset: NEW_ID, position: 'center', heightMm: 12.7 })
  })

  it('Remove logo empties the slot, takes position and height away, and puts focus on Choose file', async () => {
    renderCard('default', { config: fullConfigFixture() })
    const before = apiFetch.mock.calls.length
    await userEvent.click(within(section('Logo')).getByRole('button', { name: 'Remove logo' }))
    expect(latest.config.variants.default.logo).toBeNull()
    expect(isDirty(latest)).toBe(true)
    expect(document.querySelector('[data-pointer="/variants/default/logo/position"]')).toBeNull()
    expect(within(section('Logo')).queryByRole('img')).toBeNull()
    expect(document.activeElement).toBe(within(section('Logo')).getByRole('button', { name: 'Choose file' }))
    // Nothing is sent for a remove; the asset goes with the version only when it is saved.
    expect(apiFetch.mock.calls.slice(before).filter(([, init]) => (init as RequestInit | undefined)?.method)).toEqual(
      [],
    )
    // The background is a slot of its own.
    expect(latest.config.variants.default.background).toBe(FULL_BACKGROUND_ID)
  })

  it('a refused logo leaves the form exactly as it was', async () => {
    uploadAnswer = () => ({ status: 422, body: { status: 422, code: 'invalid_asset', reason: 'svg_script' } })
    renderCard()
    await choose('Logo')
    expect(await within(section('Logo')).findByRole('alert')).toHaveProperty(
      'textContent',
      'This SVG contains a script. Export it again as a plain SVG.',
    )
    expect(isDirty(latest)).toBe(false)
    expect(latest.config.variants.default.logo).toBeNull()
  })

  it('a logo removed while its replacement was on its way is not brought back by the late answer', async () => {
    let answer: () => void = () => undefined
    uploadAnswer = () =>
      new Promise((resolve) => {
        answer = () => resolve({ status: 201, body: { id: NEW_ID, kind: 'logo', format: 'png', width: 1, height: 1 } })
      })
    renderCard('default', { config: fullConfigFixture() })
    await choose('Logo')
    await userEvent.click(within(section('Logo')).getByRole('button', { name: 'Remove logo' }))
    answer()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(latest.config.variants.default.logo).toBeNull()
  })

  it('a logo uploaded for a page that has none starts it, and the same upload on a page that has one only replaces the file', async () => {
    const config = fullConfigFixture()
    config.variants.last!.logo = null
    renderCard('last', { config })
    await choose('Logo')
    await waitFor(() =>
      expect(latest.config.variants.last?.logo).toEqual({ asset: NEW_ID, position: 'left', heightMm: 15 }),
    )
    expect(latest.config.variants.default.logo?.asset).toBe(FULL_LOGO_ID)
  })
})

describe('VariantCard: Background image (AC-7.7)', () => {
  it('uploads a background as such, and the form holds its id', async () => {
    uploadAnswer = () => ({
      status: 201,
      body: { id: NEW_ID, kind: 'background', format: 'png', width: 2480, height: 3508 },
    })
    renderCard()
    expect(
      within(section('Background image')).getByText(
        /Drawn under everything else on the whole page\. Text stays inside the margins\./,
      ),
    ).not.toBeNull()
    await choose('Background image')
    expect(
      await within(section('Background image')).findByRole('img', { name: 'Current background image' }),
    ).not.toBeNull()
    expect(within(section('Background image')).getByText('Current file: PNG, 2480 × 3508 px')).not.toBeNull()
    expect(latest.config.variants.default.background).toBe(NEW_ID)
    expect(latest.config.variants.default.logo).toBeNull()
    const post = apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    expect((post[1].body as FormData).get('kind')).toBe('background')
  })

  it('Remove background empties the slot and leaves the logo alone', async () => {
    renderCard('default', { config: fullConfigFixture() })
    await userEvent.click(within(section('Background image')).getByRole('button', { name: 'Remove background' }))
    expect(latest.config.variants.default.background).toBeNull()
    expect(latest.config.variants.default.logo?.asset).toBe(FULL_LOGO_ID)
    expect(document.activeElement).toBe(
      within(section('Background image')).getByRole('button', { name: 'Choose file' }),
    )
  })

  it('has no setting besides the file: no position, no height', () => {
    renderCard('default', { config: fullConfigFixture() })
    expect(within(section('Background image')).queryByRole('radiogroup')).toBeNull()
    expect(within(section('Background image')).queryByRole('textbox')).toBeNull()
  })

  it('shows the refusal of a save for the background where the file is chosen', () => {
    renderCard('default', {
      config: fullConfigFixture(),
      problems: [{ path: '/variants/default/background', reason: 'asset_unknown' }],
    })
    const button = within(section('Background image')).getByRole('button', { name: 'Choose file' })
    expect(button.getAttribute('data-pointer')).toBe('/variants/default/background')
    expect(button.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('VariantCard: distance from the body', () => {
  const frame = (name: 'header' | 'footer') =>
    document.querySelector(`[data-frame="/variants/default/${name}"]`) as HTMLElement
  const gap = (name: 'header' | 'footer') =>
    within(frame(name)).getByRole('textbox', { name: 'Distance from the body (mm)' }) as HTMLInputElement

  it('is a labelled number input in the header and in the footer, 3 mm to begin with, with its range as a hint', () => {
    renderCard()
    for (const name of ['header', 'footer'] as const) {
      const field = gap(name)
      expect(field.value).toBe('3')
      expect(field.getAttribute('data-pointer')).toBe(`/variants/default/${name}/gapMm`)
      expect(field.getAttribute('inputmode')).toBe('decimal')
      expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toContain(
        'Between 0 and 40 mm.',
      )
    }
  })

  it('changing it changes that frame only, and makes the form dirty; typing the value back makes it clean', async () => {
    renderCard()
    await userEvent.clear(gap('header'))
    await userEvent.type(gap('header'), '8.5')
    expect(latest.config.variants.default.header.gapMm).toBe(8.5)
    expect(latest.config.variants.default.footer.gapMm).toBe(3)
    expect(isDirty(latest)).toBe(true)
    await userEvent.clear(gap('header'))
    await userEvent.type(gap('header'), '3')
    expect(isDirty(latest)).toBe(false)
  })

  it('keeps what is typed when it is not a number, for the service to refuse', async () => {
    renderCard()
    await userEvent.clear(gap('footer'))
    await userEvent.type(gap('footer'), 'abc')
    expect(latest.config.variants.default.footer.gapMm).toBe('abc')
    expect(gap('footer').value).toBe('abc')
  })

  it('is on the first and last page too, with their own values', () => {
    const config = fullConfigFixture()
    config.variants.first!.header.gapMm = 6
    renderCard('first', { config })
    const field = within(document.querySelector('[data-frame="/variants/first/header"]') as HTMLElement).getByRole(
      'textbox',
      { name: 'Distance from the body (mm)' },
    ) as HTMLInputElement
    expect(field.value).toBe('6')
  })

  it('shows the refusal of the service on the field, and has no accessibility violation', async () => {
    renderCard('default', {
      problems: [{ path: '/variants/default/header/gapMm', reason: 'out_of_range', name: 'gapMm' }],
    })
    const field = gap('header')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(gap('footer').getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toBe(
      'refused',
    )
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('is disabled in a read-only form', () => {
    renderCard('default', { readOnly: true })
    expect(gap('header').matches(':disabled')).toBe(true)
  })
})

describe('VariantCard: the other pages and the modes', () => {
  it('a first page that is switched off shows no file field; switched on it has its own, for its own slots', async () => {
    renderCard('first')
    expect(screen.queryByRole('heading', { name: 'Logo' })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use a different first page' }))
    await choose('Background image')
    await waitFor(() => expect(latest.config.variants.first?.background).toBe(NEW_ID))
    expect(latest.config.variants.default.background).toBeNull()
    expect(
      within(section('Background image')).getByRole('button', { name: 'Choose file' }).getAttribute('data-pointer'),
    ).toBe('/variants/first/background')
  })

  it('switching the page off while its file is on its way abandons that upload', async () => {
    let signal: AbortSignal | null | undefined
    apiFetch.mockImplementation(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      signal = init.signal
      return new Promise<Response>(() => undefined)
    })
    renderCard('first', { config: fullConfigFixture() })
    await choose('Logo')
    await waitFor(() => expect(signal).toBeDefined())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use a different first page' }))
    expect(signal?.aborted).toBe(true)
  })

  it('is inert in a read-only form: Choose file and Remove are disabled, the thumbnail is still shown', async () => {
    renderCard('default', { config: fullConfigFixture(), readOnly: true })
    expect(await within(section('Logo')).findByRole('img', { name: 'Current logo' })).not.toBeNull()
    for (const name of ['Remove logo', 'Remove background']) {
      expect(screen.getByRole('button', { name }).matches(':disabled')).toBe(true)
    }
    for (const button of screen.getAllByRole('button', { name: 'Choose file' })) {
      expect(button.matches(':disabled')).toBe(true)
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      expect(input.matches(':disabled')).toBe(true)
    }
  })

  it('has no accessibility violation with a logo and a background shown, and with a refusal showing', async () => {
    uploadAnswer = () => ({ status: 422, body: { status: 422, code: 'invalid_asset', reason: 'svg_not_allowed' } })
    const view = renderCard('default', { config: fullConfigFixture() })
    await within(section('Logo')).findByRole('img', { name: 'Current logo' })
    await within(section('Background image')).findByRole('img', { name: 'Current background image' })
    expect(await axeViolations(view.container)).toEqual([])
    await choose('Logo')
    await within(section('Logo')).findByRole('alert')
    expect(await axeViolations(view.container)).toEqual([])
  })
})
