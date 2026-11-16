/**
 * @vitest-environment jsdom
 *
 * useOfferDraft (specs/20261115-crm-offer-wizard T40; AC-6.1, AC-6.3, AC-6.7, AC-8.4; plan DD-31; design S9):
 * the autosave timing, one request in flight, the stale `ETag`, the failures and what each one stops. The clock
 * is faked; the requests go through the real client to the fake draft server of `test-support/fakeApi`.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
}))

import { initialAnswers, sampleContext, setField, type WizardAnswers } from '../lib/offerEngine/answers'
import { parseTemplate } from '../lib/offerEngine/syntax'
import type { OfferDraftView } from '../lib/types'
import {
  ADA,
  draftView,
  fakeApi,
  offerDraftServer,
  problemAnswer,
  type FakeDraftServer,
  type FakeHandler,
} from '../test-support/fakeApi'
import {
  AUTOSAVE_MAX_WAIT_MS,
  RETRY_BACKOFF_MS,
  RETRY_BANNER_AFTER_MS,
  useOfferDraft,
  type UseOfferDraft,
} from './useOfferDraft'

const V1 = `@@salutation Dear

## SCOPE
@@step scope
We deliver [OGGETTO].

## TERMS
@@step conditions
Payment: [PAGAMENTO].

@@field OGGETTO
label: Object

@@field PAGAMENTO
label: Payment
`
// version 2 of the template: the payment field is gone
const V2 = V1.replace('Payment: [PAGAMENTO].', 'Payment: net 30.').replace('@@field PAGAMENTO\nlabel: Payment\n', '')

const AST_V1 = parseTemplate(V1).ast
const START = initialAnswers(AST_V1, sampleContext('it'))
const FILLED: WizardAnswers = {
  ...setField(AST_V1, setField(AST_V1, START, 'OGGETTO', 'A shop'), 'PAGAMENTO', 'net 15'),
}

const templateRow = (source: string, version: number) => ({
  id: 't1',
  entity: 'welld_ch',
  name: 'Progetto a corpo',
  language: 'it',
  format: 'wizard',
  description: null,
  uses: [],
  source,
  seeded: false,
  showTotal: true,
  annex: false,
  version,
  archived: false,
  updatedBy: ADA,
  updatedAt: '2026-11-15T08:00:00.000Z',
  createdAt: '2026-11-15T08:00:00.000Z',
})

const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

type Mounted = {
  result: { current: UseOfferDraft }
  server: FakeDraftServer
  routes: Record<string, FakeHandler>
  unmount: () => void
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function mount(
  options: {
    draft?: OfferDraftView | null
    templateSource?: string
    templateVersion?: number
    wrap?: (routes: Record<string, FakeHandler>) => void
  } = {},
): Promise<Mounted> {
  const {
    draft = draftView({ answers: FILLED, templateVersion: 1 }),
    templateSource = V1,
    templateVersion = 1,
  } = options
  const { server, routes } = offerDraftServer(draft)
  routes['GET /offer-templates/t1'] = () => ({ status: 200, body: templateRow(templateSource, templateVersion) })
  options.wrap?.(routes)
  apiFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fakeApi(routes)(input, init))
  const rendered = renderHook(() => useOfferDraft('d1'))
  await advance(0)
  return { result: rendered.result, server, routes, unmount: rendered.unmount }
}

const typeObject = (mounted: Mounted, text: string) =>
  act(() => {
    const { ast } = mounted.result.current
    mounted.result.current.setAnswers((answers) => setField(ast!, answers, 'OGGETTO', text))
  })

const putCount = (server: FakeDraftServer) => server.saves.length
const putUrl = 'PUT /deals/d1/offer-draft'

beforeEach(() => {
  vi.useFakeTimers()
  apiFetch.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('loading', () => {
  it('opens the stored draft on the step of its last content change, saved', async () => {
    const { result } = await mount({ draft: draftView({ answers: { ...FILLED, lastStep: 'conditions' } }) })
    expect(result.current).toMatchObject({
      load: 'ready',
      status: 'saved',
      step: 'conditions',
      readOnly: false,
      pending: false,
    })
    expect(result.current.answers).toEqual({ ...FILLED, lastStep: 'conditions' })
    expect(result.current.ast).not.toBeNull()
    expect(result.current.draft).toMatchObject({ version: 1, target: { kind: 'new' } })
    expect(result.current.notice).toBeNull()
  })

  it('a deal without a draft is `none`, not an error', async () => {
    const { result } = await mount({ draft: null })
    expect(result.current).toMatchObject({ load: 'none', draft: null, answers: null })
  })

  it('a failed load is `error`, with the cause', async () => {
    const { result } = await mount({
      wrap: (routes) => (routes['GET /deals/d1/offer-draft'] = () => problemAnswer(503, 'authz_unavailable')),
    })
    expect(result.current.load).toBe('error')
    expect(result.current.loadError).toMatchObject({ status: 503 })
  })
})

describe('autosave timing (AC-6.1)', () => {
  it('saves 1 s after the last change, with If-Match of the draft’s version', async () => {
    const m = await mount()
    typeObject(m, 'A bigger shop')
    expect(m.result.current).toMatchObject({ status: 'saving', pending: true })
    await advance(999)
    expect(putCount(m.server)).toBe(0)
    await advance(1)
    expect(putCount(m.server)).toBe(1)
    expect(m.server.saves[0]!.ifMatch).toBe('"1"')
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('A bigger shop')
    expect(m.result.current).toMatchObject({ status: 'saved', pending: false })
    expect(m.result.current.draft?.version).toBe(2)
  })

  it('every change inside the second pushes the save back', async () => {
    const m = await mount()
    typeObject(m, 'A')
    await advance(800)
    typeObject(m, 'AB')
    await advance(800)
    expect(putCount(m.server)).toBe(0)
    await advance(200)
    expect(putCount(m.server)).toBe(1)
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('AB')
  })

  it('a person who keeps typing is still saved within 5 s', async () => {
    const m = await mount()
    // a change every 800 ms never leaves a quiet second…
    for (let at = 0; at < AUTOSAVE_MAX_WAIT_MS - 200; at += 800) {
      typeObject(m, `text ${at}`)
      await advance(800)
    }
    expect(putCount(m.server)).toBe(0)
    // …and the change at 4.8 s is saved when 5 s have passed since the first one
    typeObject(m, 'final')
    await advance(AUTOSAVE_MAX_WAIT_MS - 4_800 - 1)
    expect(putCount(m.server)).toBe(0)
    await advance(1)
    expect(putCount(m.server)).toBe(1)
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('final')
  })

  it('a step change alone saves nothing, however long we wait (DD-31)', async () => {
    const m = await mount()
    act(() => m.result.current.setStep('scope'))
    act(() => m.result.current.setStep('conditions'))
    await advance(30_000)
    expect(putCount(m.server)).toBe(0)
    expect(m.result.current).toMatchObject({ status: 'saved', step: 'conditions', pending: false })
  })

  it('the step travels with the next content save as lastStep', async () => {
    const m = await mount()
    act(() => m.result.current.setStep('conditions'))
    typeObject(m, 'changed')
    await advance(1_000)
    expect(m.server.saves[0]!.body.answers.lastStep).toBe('conditions')
  })

  it('typing back what the server has leaves nothing to save', async () => {
    const m = await mount()
    typeObject(m, 'changed')
    typeObject(m, 'A shop')
    await advance(10_000)
    expect(putCount(m.server)).toBe(0)
    expect(m.result.current.status).toBe('saved')
  })

  it('the target and the template version of the draft are sent back as they are', async () => {
    const m = await mount({
      draft: draftView({
        answers: FILLED,
        target: { kind: 'edit', offerId: 'o7', offerVersion: 3, reference: '0007/2026' },
      }),
    })
    typeObject(m, 'x')
    await advance(1_000)
    expect(m.server.saves[0]!.body).toMatchObject({ templateVersion: 1, target: { kind: 'edit', offerId: 'o7' } })
  })
})

describe('one request in flight', () => {
  it('a change made while a save is out waits for it, then goes with the version the server answered', async () => {
    const gate = deferred()
    const m = await mount({
      wrap: (routes) => {
        const put = routes[putUrl]!
        routes[putUrl] = async (url, init) => {
          await gate.promise
          return put(url, init)
        }
      },
    })
    typeObject(m, 'first')
    await advance(1_000) // the PUT is out, held by the gate
    expect(m.result.current.status).toBe('saving')
    typeObject(m, 'second')
    await advance(5_000)
    expect(putCount(m.server)).toBe(0) // the first has not even been answered yet
    gate.release()
    await advance(0)
    await advance(1_000)
    expect(putCount(m.server)).toBe(2)
    expect(m.server.saves.map((save) => save.ifMatch)).toEqual(['"1"', '"2"'])
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('first')
    expect(m.server.saves[1]!.body.answers.fields['OGGETTO']).toBe('second')
    expect(m.result.current).toMatchObject({ status: 'saved', pending: false })
    expect(m.result.current.draft?.version).toBe(3)
  })
})

describe('a stale draft (AC-6.3)', () => {
  it('409 stops autosave, makes the form read-only and says so; later typing is not sent', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(409, 'version_conflict', { currentVersion: 5 }))
    typeObject(m, 'mine')
    await advance(1_000)
    expect(m.result.current).toMatchObject({ status: 'conflict', readOnly: true, pending: true })
    typeObject(m, 'more of mine')
    await advance(30_000)
    expect(putCount(m.server)).toBe(0)
    expect(m.result.current.answers!.fields['OGGETTO']).toBe('mine') // read-only: the second edit was refused
  })

  it('428 is the same stop', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(428, 'precondition_required'))
    typeObject(m, 'mine')
    await advance(1_000)
    expect(m.result.current.status).toBe('conflict')
  })

  it('Reload draft takes the other person’s draft, drops the unsaved changes and writes again', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(409, 'version_conflict'))
    typeObject(m, 'mine')
    await advance(1_000)
    // meanwhile the colleague saved
    m.server.draft = draftView({
      version: 4,
      answers: { ...FILLED, fields: { ...FILLED.fields, OGGETTO: 'theirs' }, lastStep: 'costs' },
    })
    await act(async () => {
      await m.result.current.reload()
    })
    expect(m.result.current).toMatchObject({
      load: 'ready',
      status: 'saved',
      readOnly: false,
      pending: false,
      step: 'costs',
    })
    expect(m.result.current.answers!.fields['OGGETTO']).toBe('theirs')
    expect(m.result.current.draft?.version).toBe(4)
    typeObject(m, 'theirs and mine')
    await advance(1_000)
    expect(m.server.saves.at(-1)!.ifMatch).toBe('"4"')
  })

  it('404 on a save means the draft is gone: read-only, nothing retried', async () => {
    const m = await mount()
    m.server.draft = null
    typeObject(m, 'x')
    await advance(1_000)
    expect(m.result.current).toMatchObject({ status: 'gone', readOnly: true })
    await advance(60_000)
    expect(putCount(m.server)).toBe(0)
  })
})

describe('a refused save', () => {
  it('422 answers_invalid pauses autosave with the path; the next content change tries again', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(422, 'answers_invalid', { path: 'fields.OGGETTO', reason: 'shape' }))
    typeObject(m, 'bad')
    await advance(1_000)
    expect(m.result.current).toMatchObject({
      status: 'rejected',
      rejection: { kind: 'invalid', path: 'fields.OGGETTO' },
      readOnly: false,
    })
    await advance(60_000)
    expect(putCount(m.server)).toBe(0) // nothing retried by itself
    typeObject(m, 'good')
    expect(m.result.current.status).toBe('saving')
    expect(m.result.current.rejection).toBeNull()
    await advance(1_000)
    expect(putCount(m.server)).toBe(1)
    expect(m.result.current.status).toBe('saved')
  })

  it('413 draft_too_large is its own rejection', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(413, 'draft_too_large'))
    typeObject(m, 'x')
    await advance(1_000)
    expect(m.result.current).toMatchObject({ status: 'rejected', rejection: { kind: 'tooLarge' } })
  })

  it('any other refusal is shown with the server’s words, not retried', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(409, 'draft_invalid'))
    typeObject(m, 'x')
    await advance(1_000)
    expect(m.result.current.rejection).toMatchObject({ kind: 'other' })
    expect(m.result.current.status).toBe('rejected')
  })
})

describe('failures that may pass', () => {
  it('a network failure retries after 2, 4, 8 s with the changes kept, and says it is retrying', async () => {
    const m = await mount()
    m.server.failNext('PUT', 'network', 'network', 'network')
    typeObject(m, 'offline')
    await advance(1_000)
    expect(m.result.current).toMatchObject({ status: 'retrying', pending: true, retryingLong: false })
    // retry 1 after 2 s
    await advance(RETRY_BACKOFF_MS[0] - 1)
    expect(m.result.current.status).toBe('retrying')
    await advance(1)
    expect(putCount(m.server)).toBe(0) // the second attempt failed too (still a network failure)
    // retry 2 after 4 s: not before
    await advance(RETRY_BACKOFF_MS[1] - 1)
    expect(m.result.current.status).toBe('retrying')
    await advance(1)
    // retry 3 after 8 s
    await advance(RETRY_BACKOFF_MS[2] - 1)
    expect(putCount(m.server)).toBe(0)
    await advance(1)
    expect(putCount(m.server)).toBe(1)
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('offline')
    expect(m.result.current).toMatchObject({ status: 'saved', retryingLong: false, pending: false })
  })

  it('after 10 s of failing the page may show the banner; success clears it', async () => {
    const m = await mount()
    m.server.failNext('PUT', 'network', 'network', 'network')
    typeObject(m, 'offline')
    await advance(1_000)
    await advance(RETRY_BANNER_AFTER_MS - 1)
    expect(m.result.current.retryingLong).toBe(false)
    await advance(1)
    expect(m.result.current.retryingLong).toBe(true)
    await advance(RETRY_BACKOFF_MS[2] + 4_000)
    expect(m.result.current).toMatchObject({ status: 'saved', retryingLong: false })
  })

  it('text typed while it retries goes with the next attempt, not a new one', async () => {
    const m = await mount()
    m.server.failNext('PUT', 'network')
    typeObject(m, 'one')
    await advance(1_000)
    typeObject(m, 'one two')
    await advance(500)
    expect(putCount(m.server)).toBe(0) // the debounce does not fire inside the backoff
    await advance(1_500)
    expect(putCount(m.server)).toBe(1)
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('one two')
  })

  it('a 503 is retried like a network failure', async () => {
    const m = await mount()
    m.server.failNext('PUT', problemAnswer(503, 'authz_unavailable'))
    typeObject(m, 'x')
    await advance(1_000)
    expect(m.result.current.status).toBe('retrying')
    await advance(2_000)
    expect(m.result.current.status).toBe('saved')
  })

  it('the waits stop growing at 16 s', async () => {
    const m = await mount()
    m.server.failNext('PUT', ...Array<'network'>(6).fill('network'))
    typeObject(m, 'x')
    await advance(1_000)
    for (const wait of [2_000, 4_000, 8_000, 16_000, 16_000]) await advance(wait)
    expect(putCount(m.server)).toBe(0)
    await advance(15_999)
    expect(putCount(m.server)).toBe(0)
    await advance(1)
    expect(putCount(m.server)).toBe(1)
  })
})

describe('leaving the page', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('beforeunload is held while something is unsaved and let go when it is saved', async () => {
    const m = await mount()
    expect(unload()).toBe(false)
    typeObject(m, 'x')
    expect(unload()).toBe(true)
    await advance(1_000)
    expect(unload()).toBe(false)
  })

  it('and while a save is failing', async () => {
    const m = await mount()
    m.server.failNext('PUT', 'network')
    typeObject(m, 'x')
    await advance(1_000)
    expect(unload()).toBe(true)
  })

  it('unmounting saves what is left without waiting for the debounce', async () => {
    const m = await mount()
    typeObject(m, 'last words')
    m.unmount()
    await advance(0)
    expect(putCount(m.server)).toBe(1)
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('last words')
  })

  it('and unmounting a saved draft sends nothing', async () => {
    const m = await mount()
    m.unmount()
    await advance(10_000)
    expect(putCount(m.server)).toBe(0)
  })
})

describe('a template that changed since the draft was saved (AC-8.4)', () => {
  const stale = () =>
    draftView({ answers: FILLED, templateVersion: 1, template: { ...draftView().template, version: 2 } })

  it('keeps the answers whose field still exists, names the ones it dropped, and saves the result', async () => {
    const m = await mount({ draft: stale(), templateSource: V2, templateVersion: 2 })
    const { result } = m
    expect(result.current.answers!.fields['OGGETTO']).toBe('A shop')
    expect(result.current.answers!.fields['PAGAMENTO']).toBeUndefined()
    expect(result.current.notice).toEqual({ dropped: ['PAGAMENTO'], orphanedEdits: [] })
    expect(result.current.status).toBe('saving')
    expect(result.current.pending).toBe(true)
    await advance(1_000)
    expect(m.server.saves).toHaveLength(1)
    expect(m.server.saves[0]!.body.templateVersion).toBe(2)
    expect(m.server.saves[0]!.body.answers.fields['PAGAMENTO']).toBeUndefined()
    expect(result.current.status).toBe('saved')
    // the notice stays until the person closes it
    expect(result.current.notice).not.toBeNull()
    act(() => result.current.dismissNotice())
    expect(result.current.notice).toBeNull()
  })

  it('a template that did not change is left alone: no notice, no save', async () => {
    const m = await mount()
    await advance(10_000)
    expect(m.result.current.notice).toBeNull()
    expect(putCount(m.server)).toBe(0)
  })

  it('a template edited without dropping anything still saves its version, with an empty list', async () => {
    const m = await mount({ draft: stale(), templateSource: V1, templateVersion: 2 })
    expect(m.result.current.notice).toEqual({ dropped: [], orphanedEdits: [] })
    await advance(1_000)
    expect(m.server.saves[0]!.body.templateVersion).toBe(2)
  })
})

describe('actions on the draft', () => {
  it('generate saves what was typed first, then generates from the version that save returned', async () => {
    const m = await mount()
    typeObject(m, 'final text')
    let outcome: Awaited<ReturnType<UseOfferDraft['generate']>> | undefined
    await act(async () => {
      outcome = await m.result.current.generate()
    })
    expect(m.server.saves).toHaveLength(1)
    expect(m.server.saves[0]!.body.answers.fields['OGGETTO']).toBe('final text')
    expect(outcome).toMatchObject({ kind: 'generated', created: true })
    expect(m.server.draft).toBeNull() // the fake consumed it at version 2: the call carried If-Match "2"
    expect(m.result.current).toMatchObject({ readOnly: true, pending: false })
    typeObject(m, 'too late')
    await advance(10_000)
    expect(putCount(m.server)).toBe(1)
  })

  it('generate does not call the server when the save did not go through', async () => {
    const m = await mount()
    m.server.failNext('PUT', 'network')
    typeObject(m, 'x')
    const outcome = await act(async () => m.result.current.generate())
    expect(outcome).toEqual({ kind: 'unsaved' })
    expect(m.server.draft).not.toBeNull()
    expect(m.result.current.readOnly).toBe(false)
  })

  it('a 422 offer_incomplete comes back typed and leaves the draft editable', async () => {
    const m = await mount()
    const missing = [{ name: 'OGGETTO', label: 'Object', step: 'scope' }]
    m.server.failNext('POST generate', problemAnswer(422, 'offer_incomplete', { missing, invalid: [] }))
    let outcome: Awaited<ReturnType<UseOfferDraft['generate']>> | undefined
    await act(async () => {
      outcome = await m.result.current.generate()
    })
    expect(outcome).toEqual({ kind: 'incomplete', missing, invalid: [] })
    expect(m.result.current).toMatchObject({ readOnly: false, generating: false })
    expect(m.server.draft).not.toBeNull()
  })

  it('a generate on a draft someone else changed is a conflict', async () => {
    const m = await mount()
    m.server.draft = draftView({ answers: FILLED, version: 7 })
    const error = await act(async () => m.result.current.generate().catch((e: unknown) => e))
    expect(error).toMatchObject({ status: 409, code: 'version_conflict' })
    expect(m.result.current).toMatchObject({ status: 'conflict', readOnly: true })
  })

  it('create starts the draft (If-None-Match) and opens it', async () => {
    const m = await mount({ draft: null })
    expect(m.result.current.load).toBe('none')
    await act(async () => {
      await m.result.current.create({ templateId: 't1' })
    })
    expect(m.result.current).toMatchObject({ load: 'ready', status: 'saved' })
    expect(m.result.current.draft?.template.id).toBe('t1')
    expect(m.result.current.ast).not.toBeNull()
  })

  it('create refuses a second draft with the server’s draft_exists', async () => {
    const m = await mount()
    const error = await act(async () => m.result.current.create({ templateId: 't1' }).catch((e: unknown) => e))
    expect(error).toMatchObject({ status: 409, code: 'draft_exists' })
  })

  it('switching the template saves first, then asks the server with the new version', async () => {
    const m = await mount({
      wrap: (routes) =>
        (routes['GET /offer-templates/t1b'] = () => ({ status: 200, body: { ...templateRow(V1, 1), id: 't1b' } })),
    })
    typeObject(m, 'before the switch')
    let ok: boolean | undefined
    await act(async () => {
      ok = await m.result.current.switchTemplate('t1b')
    })
    expect(ok).toBe(true)
    expect(m.server.saves).toHaveLength(1)
    expect(m.server.draft?.template.id).toBe('t1b')
    expect(m.server.draft?.version).toBe(3)
  })
})

describe('nothing of the draft is kept in the browser (AC-6.7)', () => {
  it('a whole editing session touches neither web storage nor cookies', async () => {
    const touched = vi.fn()
    const spies = (['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const).map((name) =>
      vi.spyOn(Storage.prototype, name).mockImplementation(touched),
    )
    const cookie = vi.spyOn(document, 'cookie', 'set')
    try {
      const m = await mount()
      typeObject(m, 'private')
      await advance(1_000)
      act(() => m.result.current.setStep('costs'))
      m.server.failNext('PUT', 'network')
      typeObject(m, 'private again')
      await advance(10_000)
      m.unmount()
      expect(touched).not.toHaveBeenCalled()
      expect(cookie).not.toHaveBeenCalled()
      expect(Object.keys(window.localStorage)).toEqual([])
      expect(Object.keys(window.sessionStorage)).toEqual([])
    } finally {
      for (const spy of spies) spy.mockRestore()
      cookie.mockRestore()
    }
  })
})
