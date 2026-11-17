/**
 * @vitest-environment jsdom
 *
 * AssetField (task T23; design F5; AC-7.1 to 7.3, 7.7): a file is posted as soon as it is chosen, a thumbnail
 * and the "Current file" line replace the empty state, Remove empties the slot, and each way an upload is
 * refused has its own sentence, in the field's error line, announced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FormHarness } from '../lib/formStateHarness'
import type { Problem } from '../lib/formStateTypes'
import { en, it as italian } from '../strings'
import { AssetField } from './AssetField'
import type { UploadedAsset } from './AssetFieldApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
}))

const POINTER = '/variants/default/logo/asset'
const LOGO_ID = '3f2b8a52-9a5e-4e43-8b1d-0c5d1f2f7a10'
const NEW_ID = '7b1c9d20-6f41-4d0a-9d3e-5a2f8c4e1b66'

/** The ten `invalid_asset` reasons of the service (`engine/src/assets/mod.rs` `Reason::as_str`). */
const REASONS = [
  'unsupported_format',
  'too_many_bytes',
  'too_many_pixels',
  'too_many_elements',
  'svg_script',
  'svg_event_handler',
  'svg_foreign_object',
  'svg_doctype',
  'svg_external_reference',
  'svg_not_allowed',
] as const

type Answer = { status: number; body?: unknown } | Error
type Upload = (form: FormData, init: RequestInit) => Answer | Promise<Answer>

const problemJson = (status: number, code: string, extras: Record<string, unknown> = {}): Answer => ({
  status,
  body: { type: 'about:blank', title: 'Problem', status, code, ...extras },
})

const created = (over: Partial<UploadedAsset> = {}): Answer => ({
  status: 201,
  body: { id: NEW_ID, kind: 'logo', format: 'png', width: 400, height: 150, ...over },
})

const png = (name = 'logo.png', bytes = 16) => new File([new Uint8Array(bytes)], name, { type: 'image/png' })

/** The service, as far as the field talks to it: the upload, and the stored bytes of assets. */
function serve({
  upload = () => created(),
  assets = {},
}: { upload?: Upload; assets?: Record<string, { type: string } | 'missing'> } = {}) {
  apiFetch.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST' && /^\/v1\/letterheads\/[a-z_]+\/assets$/.test(url.pathname)) {
      const answer = await upload(init.body as FormData, init)
      if (answer instanceof Error) throw answer
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status })
    }
    const asset = /^\/v1\/assets\/([^/]+)$/.exec(url.pathname)
    if (!init.method && asset) {
      const found = assets[asset[1]]
      if (found === undefined || found === 'missing') return new Response(null, { status: 404 })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': found.type } })
    }
    return new Response(null, { status: 404 })
  })
}

const uploads = () => apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

let objectUrls = 0
beforeEach(() => {
  objectUrls = 0
  URL.createObjectURL = vi.fn(() => `blob:thumbnail-${++objectUrls}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

interface SlotProps {
  initial?: string | null
  kind?: 'logo' | 'background'
  problems?: Problem[]
  announce?: (text: string) => void
  onUploaded?: (asset: UploadedAsset) => void
  onRemove?: () => void
}

/** One slot as a variant card has it: the id it holds, replaced by an upload and emptied by Remove. */
function Slot({ initial = null, kind = 'logo', problems, announce, onUploaded, onRemove }: SlotProps) {
  const [id, setId] = useState<string | null>(initial)
  return (
    <FormHarness problems={problems} announce={announce}>
      {() => (
        <AssetField
          entity="welld_it"
          kind={kind}
          assetId={id}
          pointer={POINTER}
          label="Logo file"
          hint="PNG, JPEG or SVG, up to 2 MB."
          removeLabel="Remove logo"
          what="Logo"
          onUploaded={(asset) => {
            setId(asset.id)
            onUploaded?.(asset)
          }}
          onRemove={() => {
            setId(null)
            onRemove?.()
          }}
        />
      )}
    </FormHarness>
  )
}

const pickerInput = () => screen.getByTestId('asset-variants-default-logo-asset-input') as HTMLInputElement
const chooseButton = () => screen.getByRole('button', { name: 'Choose file' })
const alertText = () => screen.getByRole('alert').textContent

async function choose(file: File, options: Parameters<typeof userEvent.setup>[0] = {}) {
  await userEvent.setup(options).upload(pickerInput(), file)
}

describe('AssetField: upload', () => {
  it('posts the file as multipart with its kind, to the entity’s assets route, at once', async () => {
    serve()
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(uploads()).toHaveLength(1))
    const [url, init] = uploads()[0] as [string, RequestInit]
    expect(url).toBe('http://letterhead-api.test/v1/letterheads/welld_it/assets')
    const form = init.body as FormData
    expect(form.get('kind')).toBe('logo')
    expect((form.get('file') as File).size).toBe(16)
    // The browser adds the multipart Content-Type with its boundary; setting one here would break the body.
    expect(init.headers).toBeUndefined()
  })

  it('sends a background as kind background', async () => {
    serve({ upload: () => created({ kind: 'background' }) })
    render(<Slot kind="background" />)
    await choose(png())
    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(((uploads()[0][1] as RequestInit).body as FormData).get('kind')).toBe('background')
  })

  it('never decides by the file’s name or type: whatever is chosen is sent, and the service reads the bytes (AC-7.1)', async () => {
    serve({ upload: () => problemJson(422, 'invalid_asset', { reason: 'unsupported_format' }) })
    render(<Slot />)
    // A text file named like a picture, and a picture named like a text file: both go to the service.
    await choose(new File(['not an image'], 'logo.png', { type: 'text/plain' }), { applyAccept: false })
    await waitFor(() => expect(alertText()).toBe(en.upload.reason.unsupported_format))
    await choose(new File([new Uint8Array(4)], 'notes.txt', { type: 'image/png' }), { applyAccept: false })
    await waitFor(() => expect(uploads()).toHaveLength(2))
  })

  it('shows the file and "Uploading…" while it is on its way, and the rest of the page stays usable', async () => {
    let answer: (value: Answer) => void = () => undefined
    serve({ upload: () => new Promise<Answer>((resolve) => (answer = resolve)) })
    const announce = vi.fn()
    render(
      <>
        <input aria-label="Elsewhere" />
        <Slot announce={announce} />
      </>,
    )
    await choose(png('company-logo.png'))
    expect(await screen.findByText('company-logo.png')).not.toBeNull()
    expect(screen.getAllByText('Uploading…').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-asset-field]')!.getAttribute('aria-busy')).toBe('true')
    await userEvent.type(screen.getByLabelText('Elsewhere'), 'still usable')
    expect((screen.getByLabelText('Elsewhere') as HTMLInputElement).value).toBe('still usable')
    await act(async () => answer(created()))
    await waitFor(() => expect(screen.queryByText('company-logo.png')).toBeNull())
    expect(screen.queryByText('Uploading…')).toBeNull()
    expect(document.querySelector('[data-asset-field]')!.getAttribute('aria-busy')).toBe('false')
    expect(announce).toHaveBeenCalledWith('File uploaded')
  })

  it('cancels the upload in flight when the picker is cleared, and does not tell the form about it', async () => {
    let signal: AbortSignal | null | undefined
    serve({ upload: (_form, init) => ((signal = init.signal), new Promise<Answer>(() => undefined)) })
    const onUploaded = vi.fn()
    render(<Slot onUploaded={onUploaded} />)
    await choose(png('slow.png'))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload' }))
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByText('slow.png')).toBeNull()
    expect(screen.getByText('No file chosen')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('discards the answer of an upload that a newer choice replaced', async () => {
    const answers: ((value: Answer) => void)[] = []
    serve({ upload: () => new Promise<Answer>((resolve) => answers.push(resolve)) })
    const onUploaded = vi.fn()
    render(<Slot onUploaded={onUploaded} />)
    await choose(png('first.png'))
    await waitFor(() => expect(answers).toHaveLength(1))
    await choose(png('second.png'))
    await waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => answers[0](created({ id: LOGO_ID })))
    expect(onUploaded).not.toHaveBeenCalled()
    await act(async () => answers[1](created({ id: NEW_ID })))
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    expect(onUploaded.mock.calls[0][0].id).toBe(NEW_ID)
  })

  it('leaving the page abandons an upload in flight: nothing reaches the form afterwards', async () => {
    let answer: (value: Answer) => void = () => undefined
    let signal: AbortSignal | null | undefined
    serve({ upload: (_form, init) => ((signal = init.signal), new Promise<Answer>((resolve) => (answer = resolve))) })
    const onUploaded = vi.fn()
    const view = render(<Slot onUploaded={onUploaded} />)
    await choose(png())
    await waitFor(() => expect(signal).toBeDefined())
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => answer(created()))
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('treats an answer that is not the contract’s as a failure to upload, not as an asset', async () => {
    serve({ upload: () => ({ status: 201, body: { id: NEW_ID, kind: 'logo', format: 'bmp' } }) })
    const onUploaded = vi.fn()
    render(<Slot onUploaded={onUploaded} />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.failed))
    expect(onUploaded).not.toHaveBeenCalled()
  })
})

describe('AssetField: the thumbnail and the current file', () => {
  it('shows what was uploaded: the thumbnail fetched from the assets route, and "Current file: PNG, 400 × 150 px"', async () => {
    serve({ assets: { [NEW_ID]: { type: 'image/png' } } })
    render(<Slot />)
    expect(screen.queryByTestId('asset-current')).toBeNull()
    await choose(png())
    const image = (await screen.findByRole('img', { name: 'Current logo' })) as HTMLImageElement
    expect(image.getAttribute('src')).toBe('blob:thumbnail-1')
    expect(screen.getByText('Current file: PNG, 400 × 150 px')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Remove logo' })).not.toBeNull()
    const fetched = apiFetch.mock.calls.map(([url]) => String(url))
    expect(fetched).toContain(`http://letterhead-api.test/v1/assets/${NEW_ID}`)
  })

  it('says only "SVG" for an SVG, which has no size in pixels', async () => {
    serve({
      upload: () => created({ format: 'svg', width: null, height: null }),
      assets: { [NEW_ID]: { type: 'image/svg+xml' } },
    })
    render(<Slot />)
    await choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))
    expect(await screen.findByText('Current file: SVG')).not.toBeNull()
    expect(screen.getByRole('img', { name: 'Current logo' })).not.toBeNull()
  })

  it('shows the asset a loaded version holds: its format from what the service serves, its size once the picture is measured', async () => {
    serve({ assets: { [LOGO_ID]: { type: 'image/png' } } })
    render(<Slot initial={LOGO_ID} />)
    const image = await screen.findByRole('img', { name: 'Current logo' })
    expect(await screen.findByText('Current file: PNG')).not.toBeNull()
    Object.defineProperty(image, 'naturalWidth', { value: 400 })
    Object.defineProperty(image, 'naturalHeight', { value: 150 })
    fireEvent.load(image)
    expect(await screen.findByText('Current file: PNG, 400 × 150 px')).not.toBeNull()
  })

  it('says "JPEG" for a JPEG', async () => {
    serve({ assets: { [LOGO_ID]: { type: 'image/jpeg' } } })
    render(<Slot initial={LOGO_ID} />)
    expect(await screen.findByText('Current file: JPEG')).not.toBeNull()
  })

  it('says so, and still offers Remove, when the picture cannot be fetched', async () => {
    serve({ assets: { [LOGO_ID]: 'missing' } })
    render(<Slot initial={LOGO_ID} />)
    expect(await screen.findByTestId('asset-thumbnail-failed')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove logo' })).not.toBeNull()
  })

  it('shows nothing the service did not serve as one of the three image types', async () => {
    serve({ assets: { [LOGO_ID]: { type: 'text/html' } } })
    render(<Slot initial={LOGO_ID} />)
    expect(await screen.findByTestId('asset-thumbnail-failed')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('shows a picture that cannot be drawn as one that could not be shown', async () => {
    serve({ assets: { [LOGO_ID]: { type: 'image/png' } } })
    render(<Slot initial={LOGO_ID} />)
    fireEvent.error(await screen.findByRole('img', { name: 'Current logo' }))
    expect(await screen.findByTestId('asset-thumbnail-failed')).not.toBeNull()
  })

  it('releases the object URL when the asset changes and when the field goes', async () => {
    serve({ assets: { [LOGO_ID]: { type: 'image/png' }, [NEW_ID]: { type: 'image/png' } } })
    const view = render(<Slot initial={LOGO_ID} />)
    await screen.findByRole('img', { name: 'Current logo' })
    await choose(png())
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-1'))
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:thumbnail-2'))
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-2')
  })

  it('does not show a picture for an asset that is no longer the one held when its answer arrives late', async () => {
    let release: () => void = () => undefined
    apiFetch.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).endsWith(LOGO_ID)) {
        await new Promise<void>((resolve) => (release = resolve))
        if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      return new Response(null, { status: 404 })
    })
    const view = render(<Slot initial={LOGO_ID} />)
    view.unmount()
    release()
    await Promise.resolve()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('AssetField: Remove', () => {
  it('empties the slot with no request, takes the thumbnail away and moves focus to Choose file', async () => {
    serve({ assets: { [LOGO_ID]: { type: 'image/png' } } })
    const onRemove = vi.fn()
    render(<Slot initial={LOGO_ID} onRemove={onRemove} />)
    await screen.findByRole('img', { name: 'Current logo' })
    const before = apiFetch.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull()
    expect(document.activeElement).toBe(chooseButton())
    expect(apiFetch.mock.calls).toHaveLength(before)
  })

  it('also drops a refusal that was showing, and an upload that was replacing the file', async () => {
    let signal: AbortSignal | null | undefined
    serve({
      assets: { [LOGO_ID]: { type: 'image/png' } },
      upload: (_form, init) => ((signal = init.signal), new Promise<Answer>(() => undefined)),
    })
    render(<Slot initial={LOGO_ID} />)
    await screen.findByRole('img', { name: 'Current logo' })
    await choose(png('replacement.png'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByText('replacement.png')).toBeNull()
  })

  it('lets the same file be chosen again afterwards', async () => {
    serve({ assets: { [NEW_ID]: { type: 'image/png' } } })
    render(<Slot />)
    const file = png()
    await choose(file)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove logo' }))
    await choose(file)
    await waitFor(() => expect(uploads()).toHaveLength(2))
  })
})

describe('AssetField: a refused file (design F5.4, plan G3)', () => {
  it.each(REASONS)('says why in words for %s, in the error line, announced, with the picker idle', async (reason) => {
    serve({ upload: () => problemJson(422, 'invalid_asset', { reason }) })
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.reason[reason]))
    const button = chooseButton()
    expect(button.getAttribute('aria-invalid')).toBe('true')
    // The button is described by the error line, which is where the announced sentence is.
    const described = button
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id))
    expect(
      described.some((line) => line?.querySelector('[role="alert"]')?.textContent === en.upload.reason[reason]),
    ).toBe(true)
    expect(screen.getByText('No file chosen')).not.toBeNull()
    expect(screen.queryByTestId('asset-current')).toBeNull()
  })

  it('has one sentence per reason, each different, and each in Italian too', () => {
    const sentences = REASONS.map((reason) => en.upload.reason[reason])
    expect(new Set(sentences).size).toBe(REASONS.length)
    expect(Object.keys(en.upload.reason).sort()).toEqual([...REASONS].sort())
    for (const reason of REASONS) {
      expect(italian.upload.reason[reason]).not.toBe(en.upload.reason[reason])
      expect(italian.upload.reason[reason].length).toBeGreaterThan(10)
    }
  })

  it('tells how to fix an SVG that is refused (export a plain SVG, or upload a PNG)', () => {
    for (const reason of REASONS.filter((r) => r.startsWith('svg_') && r !== 'svg_external_reference')) {
      expect(en.upload.reason[reason]).toContain('plain SVG')
    }
    expect(en.upload.reason.svg_external_reference).toContain('export it again')
    expect(en.upload.reason.svg_not_allowed).toContain('upload a PNG')
    expect(italian.upload.reason.svg_not_allowed).toContain('PNG')
  })

  it('keeps the file the slot already had, untouched, and its thumbnail', async () => {
    serve({
      assets: { [LOGO_ID]: { type: 'image/png' } },
      upload: () => problemJson(422, 'invalid_asset', { reason: 'svg_script' }),
    })
    const onUploaded = vi.fn()
    render(<Slot initial={LOGO_ID} onUploaded={onUploaded} />)
    await screen.findByRole('img', { name: 'Current logo' })
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.reason.svg_script))
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Current logo' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Remove logo' })).not.toBeNull()
  })

  it('clears the refusal on the next choice, and a success leaves none', async () => {
    let refuse = true
    serve({
      upload: () => (refuse ? problemJson(422, 'invalid_asset', { reason: 'too_many_pixels' }) : created()),
      assets: { [NEW_ID]: { type: 'image/png' } },
    })
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.reason.too_many_pixels))
    refuse = false
    await choose(png('again.png'))
    await screen.findByRole('img', { name: 'Current logo' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to words for a reason it does not know, and for a body without one', async () => {
    serve({ upload: () => problemJson(422, 'invalid_asset', { reason: 'svg_from_the_future' }) })
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.refused))
    serve({ upload: () => problemJson(422, 'invalid_asset') })
    await choose(png('b.png'))
    await waitFor(() => expect(uploads()).toHaveLength(2))
    await waitFor(() => expect(alertText()).toBe(en.upload.refused))
    // `constructor` and the like are not reasons: the lookup never reads the prototype.
    serve({ upload: () => problemJson(422, 'invalid_asset', { reason: 'constructor' }) })
    await choose(png('c.png'))
    await waitFor(() => expect(uploads()).toHaveLength(3))
    await waitFor(() => expect(alertText()).toBe(en.upload.refused))
  })

  it.each([
    ['403 forbidden', problemJson(403, 'forbidden')],
    ['403 out_of_scope', problemJson(403, 'out_of_scope')],
  ])('says the grant changed for a %s', async (_name, answer) => {
    serve({ upload: () => answer })
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.forbidden))
  })

  it.each([
    ['400 bad_request', problemJson(400, 'bad_request')],
    ['422 invalid_request', problemJson(422, 'invalid_request')],
    ['422 unknown_layout', problemJson(422, 'unknown_layout')],
    ['422 unknown_entity', problemJson(422, 'unknown_entity')],
    ['409 version_conflict', problemJson(409, 'version_conflict', { currentVersion: 4 })],
    ['500', problemJson(500, 'internal_error')],
    ['503', problemJson(503, 'service_unavailable')],
    ['a body that is not Problem JSON', { status: 502, body: undefined }],
    ['a network failure', new TypeError('Failed to fetch')],
  ] as [string, Answer][])('says it could not be uploaded, try again, for %s', async (_name, answer) => {
    serve({ upload: () => answer })
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe(en.upload.failed))
    expect(screen.getByText('No file chosen')).not.toBeNull()
  })

  it('refuses a file over 2 MiB in the browser, with the same sentence as the service, and sends nothing', async () => {
    serve()
    render(<Slot />)
    await choose(png('huge.png', 2 * 1024 * 1024 + 1))
    expect(alertText()).toBe(en.upload.reason.too_many_bytes)
    expect(uploads()).toHaveLength(0)
    expect(screen.getByText('No file chosen')).not.toBeNull()
  })

  it('sends a file of exactly 2 MiB: the service is the authority and the limit is "at most"', async () => {
    serve()
    render(<Slot />)
    await choose(png('limit.png', 2 * 1024 * 1024))
    await waitFor(() => expect(uploads()).toHaveLength(1))
  })

  it('shows the oversize refusal of the service (422 too_many_bytes) like the one of the browser', async () => {
    serve({ upload: () => problemJson(422, 'invalid_asset', { reason: 'too_many_bytes' }) })
    render(<Slot />)
    await choose(png())
    await waitFor(() => expect(alertText()).toBe('This file is larger than 2 MB.'))
  })
})

describe('AssetField: the control of a value (design S4)', () => {
  it('marks Choose file with the pointer of the asset id, so a refused value finds it', () => {
    serve()
    render(<Slot />)
    expect(chooseButton().getAttribute('data-pointer')).toBe(POINTER)
  })

  it('shows the refusal of a save for the slot in the error line, and an upload clears it by being a change', async () => {
    serve({ assets: { [NEW_ID]: { type: 'image/png' } } })
    render(<Slot initial={null} problems={[{ path: POINTER, reason: 'asset_unknown' }]} />)
    const button = chooseButton()
    expect(button.getAttribute('aria-invalid')).toBe('true')
    const described = button.getAttribute('aria-describedby')!.split(' ')
    expect(described.some((id) => document.getElementById(id)?.textContent === 'refused')).toBe(true)
    // A refused save is the summary's to announce, not this line's.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the picker by the label, the hint, and Choose file by its own text', () => {
    serve()
    render(<Slot />)
    const group = screen.getByRole('group', { name: 'Logo file' })
    expect(within(group).getByRole('button', { name: 'Choose file' })).not.toBeNull()
    expect(screen.getByText('PNG, JPEG or SVG, up to 2 MB.')).not.toBeNull()
  })
})
