/**
 * @vitest-environment jsdom
 *
 * SaveBarApi (task T24; plan § Person routes, `routes/write.rs` `save`): the request of a save, and what each
 * way the service can answer other than 201 comes to for the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { defaultConfigFixture } from '../lib/formStateFixtures'
import { en } from '../strings'
import { classifySaveFailure, saveVersion } from './SaveBarApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({ apiFetch, getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test' }))

afterEach(() => vi.clearAllMocks())

const failure = (status: number, code?: string, extras: Record<string, unknown> = {}) =>
  new ApiError({ status, title: 'Problem', code, extras })

describe('saveVersion', () => {
  it('posts { baseVersion, config } to the versions route of the entity and resolves the version it made', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ version: 4 }), { status: 201 }))
    const config = defaultConfigFixture()
    await expect(saveVersion('welld_ch', 3, config)).resolves.toBe(4)
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://letterhead-api.test/v1/letterheads/welld_ch/versions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ baseVersion: 3, config })
  })

  it('sends baseVersion 0 for an entity with no version (G2)', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 201 }))
    await saveVersion('welld_it', 0, defaultConfigFixture())
    expect(JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string).baseVersion).toBe(0)
  })

  it('takes baseVersion + 1 for a 201 whose body it cannot read: the save happened', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 201 }))
    await expect(saveVersion('welld_it', 6, defaultConfigFixture())).resolves.toBe(7)
  })

  it('throws what the service refused with, as an ApiError', async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 409, code: 'version_conflict', currentVersion: 5 }), { status: 409 }),
    )
    await expect(saveVersion('welld_it', 3, defaultConfigFixture())).rejects.toMatchObject({
      status: 409,
      code: 'version_conflict',
      extras: { currentVersion: 5 },
    })
  })
})

describe('classifySaveFailure', () => {
  it('reads a conflict with the newest version, or without it', () => {
    expect(classifySaveFailure(failure(409, 'version_conflict', { currentVersion: 7 }))).toEqual({
      kind: 'conflict',
      currentVersion: 7,
    })
    expect(classifySaveFailure(failure(409, 'version_conflict'))).toEqual({ kind: 'conflict', currentVersion: null })
    expect(classifySaveFailure(failure(409, 'version_conflict', { currentVersion: 'x' }))).toEqual({
      kind: 'conflict',
      currentVersion: null,
    })
    // A 409 that is not a conflict is not read as one.
    expect(classifySaveFailure(failure(409, 'something_else')).kind).toBe('failed')
  })

  it('reads the refused values, and an empty or unreadable list as a refusal of the request', () => {
    expect(
      classifySaveFailure(
        failure(422, 'invalid_letterhead', { problems: [{ path: '/margins/top', reason: 'out_of_range' }] }),
      ),
    ).toEqual({ kind: 'refused', problems: [{ path: '/margins/top', reason: 'out_of_range' }] })
    for (const problems of [[], 'nope', undefined, [{ nope: 1 }]]) {
      expect(classifySaveFailure(failure(422, 'invalid_letterhead', { problems }))).toEqual({
        kind: 'failed',
        message: en.save.rejected,
        retryable: false,
      })
    }
  })

  it('reads either 403 as the grant being gone', () => {
    expect(classifySaveFailure(failure(403, 'forbidden'))).toEqual({ kind: 'lost' })
    expect(classifySaveFailure(failure(403, 'out_of_scope'))).toEqual({ kind: 'lost' })
    expect(classifySaveFailure(failure(403))).toEqual({ kind: 'lost' })
  })

  it('has a sentence for each request-shape refusal, and the generic one for the rest', () => {
    const rejected = { kind: 'failed', message: en.save.rejected, retryable: false }
    expect(classifySaveFailure(failure(422, 'invalid_request'))).toEqual(rejected)
    expect(classifySaveFailure(failure(422, 'unknown_entity'))).toEqual(rejected)
    expect(classifySaveFailure(failure(400, 'bad_request'))).toEqual(rejected)
    expect(classifySaveFailure(failure(404, 'letterhead_version_not_found'))).toEqual(rejected)
    expect(classifySaveFailure(failure(422, 'unknown_layout'))).toEqual({
      kind: 'failed',
      message: en.save.unknownLayout,
      retryable: false,
    })
    expect(classifySaveFailure(failure(413, 'request_too_large'))).toEqual({
      kind: 'failed',
      message: en.save.tooLarge,
      retryable: false,
    })
    const retryable = { kind: 'failed', message: en.save.failedBody, retryable: true }
    expect(classifySaveFailure(failure(408, 'request_timeout'))).toEqual(retryable)
    expect(classifySaveFailure(failure(503, 'service_unavailable'))).toEqual(retryable)
    expect(classifySaveFailure(failure(500, 'internal_error'))).toEqual(retryable)
    expect(classifySaveFailure(failure(500, 'stored_version_unusable'))).toEqual(retryable)
    expect(classifySaveFailure(new TypeError('Failed to fetch'))).toEqual(retryable)
    expect(classifySaveFailure(failure(429, 'busy'))).toEqual({
      kind: 'failed',
      message: en.save.busy,
      retryable: true,
    })
  })
})
