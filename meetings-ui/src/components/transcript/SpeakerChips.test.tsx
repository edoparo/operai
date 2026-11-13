/**
 * @vitest-environment jsdom
 *
 * The speakers' chips once a transcript has more labels than people: one chip per person (labels assigned to the
 * same participant, or renamed alike, are one), a chip that shows only that person's lines, a Listen that plays
 * their longest line and stops at its end, and a rename of a merged chip that renames every label in it.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getMeetingsApiBaseUrl: () => 'http://meetings.test',
  getAuthBaseUrl: () => 'http://auth.test',
}))

import { apiFetch } from 'shell/session'
import type { Transcript } from '../../lib/types'
import { en } from '../../strings'
import { CAN_NONE, fakeApi, readyMeeting, segment, transcript, type FakeHandler } from '../../test-support/fakeApi'
import TranscriptView from './TranscriptView'

const serve = (routes: Record<string, FakeHandler>) => {
  const api = fakeApi(routes)
  vi.mocked(apiFetch).mockImplementation(api as unknown as typeof apiFetch)
  return api
}

const f = en.transcript.speakerFilter
const PARTICIPANTS = [
  { id: 'p1', kind: 'external' as const, name: 'Ada Lovelace', organisation: null },
  { id: 'p2', kind: 'external' as const, name: 'Alan Turing', organisation: null },
]

/** Four labels for two people: s1 and s3 are both Ada, s2 is Alan, s4 is still "Speaker 4". */
const fourLabels = (): Transcript =>
  transcript({
    segments: [
      segment({ id: 'a', ordinal: 1, startMs: 0, endMs: 4_000, speakerKey: 's1', text: 'Ada, short.' }),
      segment({ id: 'b', ordinal: 2, startMs: 5_000, endMs: 8_000, speakerKey: 's2', text: 'Alan speaks.' }),
      segment({ id: 'c', ordinal: 3, startMs: 9_000, endMs: 30_000, speakerKey: 's3', text: 'Ada, a long line.' }),
      segment({ id: 'd', ordinal: 4, startMs: 31_000, endMs: 33_000, speakerKey: 's4', text: 'Someone else.' }),
    ],
    speakers: [
      { key: 's1', label: { kind: 'participant', participantId: 'p1' }, parts: [1], joined: false },
      { key: 's2', label: { kind: 'participant', participantId: 'p2' }, parts: [1], joined: false },
      { key: 's3', label: { kind: 'participant', participantId: 'p1' }, parts: [1], joined: false },
      { key: 's4', label: { kind: 'default', index: 4 }, parts: [1], joined: false },
    ],
  })

const audioRoute = {
  'GET /meetings/:id/audio': () => ({
    status: 200,
    body: { url: 'https://audio.test/a1', expiresAt: '2026-11-13T09:45:00.000Z' },
  }),
}

const view = (meeting = readyMeeting({ participants: PARTICIPANTS })) =>
  render(<TranscriptView meeting={meeting} focusSegmentId={null} onBackToAnswer={null} />)

const chips = () => screen.getAllByTestId('meetings-speaker-chip')
const chipOf = (name: string) => chips().find((chip) => chip.textContent?.includes(name))!
const rows = () => [...document.querySelectorAll<HTMLElement>('ol > li')]

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})
afterEach(cleanup)

describe('one chip per person', () => {
  it('labels assigned to the same participant are one chip, with the lines of both; an unnamed label stays its own', async () => {
    serve({ 'GET /meetings/:id/transcript': () => ({ status: 200, body: fourLabels() }), ...audioRoute })
    view()
    await screen.findByText('Ada, a long line.')
    expect(chips().map((chip) => within(chip).getByTestId('meetings-speaker-filter').textContent)).toEqual([
      `Ada Lovelace${f.lines(2)}`,
      `Alan Turing${f.lines(1)}`,
      `Speaker 4${f.lines(1)}`,
    ])
    expect(chipOf('Ada Lovelace').textContent).toContain(f.merged(2))
    expect(chipOf('Alan Turing').textContent).not.toContain(f.merged(2))
  })
})

describe('only one speaker', () => {
  it('a chip shows only that person’s lines, says so, and Show all brings everything back', async () => {
    serve({ 'GET /meetings/:id/transcript': () => ({ status: 200, body: fourLabels() }), ...audioRoute })
    view()
    await screen.findByText('Ada, a long line.')
    const filter = within(chipOf('Ada Lovelace')).getByTestId('meetings-speaker-filter')
    expect(filter.getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(filter)
    expect(filter.getAttribute('aria-pressed')).toBe('true')
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ada, short.'),
      expect.stringContaining('Ada, a long line.'),
    ])
    expect(screen.getByRole('status').textContent).toBe(f.showing('Ada Lovelace', 2))

    // another chip switches the filter; the same chip again, or Show all, ends it
    await userEvent.click(within(chipOf('Alan Turing')).getByTestId('meetings-speaker-filter'))
    expect(rows()).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: f.showAll }))
    expect(rows()).toHaveLength(4)
  })

  it('a reader can filter too, with nothing to rename', async () => {
    serve({ 'GET /meetings/:id/transcript': () => ({ status: 200, body: fourLabels() }) })
    view(readyMeeting({ role: 'participant', can: CAN_NONE, audio: { state: 'none' }, participants: PARTICIPANTS }))
    await screen.findByText('Ada, a long line.')
    await userEvent.click(within(chipOf('Alan Turing')).getByTestId('meetings-speaker-filter'))
    expect(rows()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull()
    expect(screen.queryByTestId('meetings-speaker-listen')).toBeNull()
  })
})

describe('Listen', () => {
  it('plays the person’s longest line and stops at its end', async () => {
    serve({ 'GET /meetings/:id/transcript': () => ({ status: 200, body: fourLabels() }), ...audioRoute })
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    view()
    await screen.findByText('Ada, a long line.')
    await waitFor(() => expect(document.querySelector('audio')).not.toBeNull())
    const audio = document.querySelector('audio')!

    await userEvent.click(within(chipOf('Ada Lovelace')).getByRole('button', { name: f.listenLabel('Ada Lovelace') }))
    expect(audio.currentTime).toBe(9)
    expect(play).toHaveBeenCalledTimes(1)

    audio.currentTime = 20
    fireEvent.timeUpdate(audio)
    expect(pause).not.toHaveBeenCalled()
    audio.currentTime = 30
    fireEvent.timeUpdate(audio)
    expect(pause).toHaveBeenCalledTimes(1)
    play.mockRestore()
    pause.mockRestore()
  })

  it('is not offered once the audio is gone', async () => {
    serve({ 'GET /meetings/:id/transcript': () => ({ status: 200, body: fourLabels() }) })
    view(readyMeeting({ participants: PARTICIPANTS, audio: { state: 'deleted' } }))
    await screen.findByText('Ada, a long line.')
    expect(screen.queryByTestId('meetings-speaker-listen')).toBeNull()
  })
})

describe('renaming a merged chip', () => {
  it('renames every label in it, so the person stays one chip', async () => {
    const seen: string[] = []
    serve({
      'GET /meetings/:id/transcript': () => ({ status: 200, body: fourLabels() }),
      ...audioRoute,
      'PUT /meetings/:id/transcript/speakers/:key': (_url, _init, params) => {
        seen.push(params['key']!)
        return {
          status: 200,
          body: { key: params['key'], label: { kind: 'text', text: 'Ada L.' }, parts: [1], joined: false },
        }
      },
    })
    view()
    await screen.findByText('Ada, a long line.')
    await userEvent.click(screen.getByRole('button', { name: en.transcript.rename('Ada Lovelace') }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), '@custom')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(en.transcript.nameLabel) }), 'Ada L.')
    await userEvent.click(within(dialog).getByRole('button', { name: en.transcript.renameSubmit }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(seen).toEqual(['s1', 's3'])
    expect(chips().filter((chip) => chip.textContent?.includes('Ada L.'))).toHaveLength(1)
  })
})
