/**
 * @vitest-environment jsdom
 *
 * The attachments card: the list with its AI badges and expiry, links as text or as external links, the
 * client-side refusal of a file, the upload order (files → bucket → confirm), the link dialog and removal.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, AttachmentList } from '../../lib/types'
import { en } from '../../strings'
import { fakeApi, problem } from '../../test-support/fakeApi'
import type { FakeHandler } from '../../test-support/fakeApi'
import AttachmentsCard from './AttachmentsCard'
import { contentTypeOf, parseWebUrl } from './attachmentRules'

const session = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('shell/session', () => ({
  apiFetch: session.apiFetch,
  getMeetingsApiBaseUrl: () => 'http://meetings-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
}))

const t = en.attachments
const PDF = 'application/pdf'
const MD = 'text/markdown'

const file = (over: Partial<Extract<Attachment, { kind: 'file' }>> = {}): Attachment => ({
  id: 'f1',
  kind: 'file',
  name: 'agenda.pdf',
  contentType: PDF,
  sizeBytes: 2048,
  addedByUserId: 'u1',
  addedAt: '2026-11-10T10:00:00Z',
  expiresAt: '2026-12-09T10:00:00Z',
  expired: false,
  aiContext: 'used',
  ...over,
})

const link = (over: Partial<Extract<Attachment, { kind: 'link' }>> = {}): Attachment => ({
  id: 'l1',
  kind: 'link',
  url: 'https://example.com/deck',
  label: 'Q3 deck',
  addedByUserId: 'u1',
  addedAt: '2026-11-10T10:00:00Z',
  aiContext: 'label_only',
  ...over,
})

const list = (attachments: Attachment[] = [], edit = true): AttachmentList => ({
  attachments,
  can: { edit },
  limits: { maxFiles: 10, maxLinks: 10, maxFileBytes: 1000, contentTypes: [PDF, MD], aiContentTypes: [PDF] },
})

const calls = vi.fn()

function serve(routes: Record<string, FakeHandler>) {
  const api = fakeApi(routes)
  session.apiFetch.mockImplementation(api)
  return api
}

beforeEach(() => {
  session.apiFetch.mockReset()
  calls.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const user = () => userEvent.setup({ applyAccept: false })

describe('the list', () => {
  it('shows name, size, dates, the AI badge and a download for a file', async () => {
    serve({ 'GET /meetings/:id/attachments': () => ({ status: 200, body: list([file()]) }) })
    render(<AttachmentsCard meetingId="m1" />)
    const row = await screen.findByTestId('meetings-attachment-f1')
    expect(within(row).getByText('agenda.pdf')).toBeTruthy()
    expect(within(row).getByText('2 kB')).toBeTruthy()
    expect(within(row).getByText(t.addedOn('10.11.2026'))).toBeTruthy()
    expect(within(row).getByText(t.availableUntil('09.12.2026'))).toBeTruthy()
    expect(within(row).getByText(t.ai.used)).toBeTruthy()
    expect(within(row).getByRole('button', { name: t.downloadLabel('agenda.pdf') })).toBeTruthy()
  })

  it('says each AI context in words, with the PDF hint for an unsupported file', async () => {
    serve({
      'GET /meetings/:id/attachments': () => ({
        status: 200,
        body: list([file({ id: 'a', aiContext: 'not_supported' }), file({ id: 'b', aiContext: 'too_large' }), link()]),
      }),
    })
    render(<AttachmentsCard meetingId="m1" />)
    await screen.findByText(t.ai.not_supported)
    expect(screen.getByText(t.ai.too_large)).toBeTruthy()
    expect(screen.getByText(t.ai.label_only)).toBeTruthy()
    expect(screen.getByText(t.aiHint.not_supported)).toBeTruthy()
  })

  it('shows an expired file as expired with no download, removal still offered', async () => {
    serve({
      'GET /meetings/:id/attachments': () => ({
        status: 200,
        body: list([file({ expired: true, aiContext: 'expired' })]),
      }),
    })
    render(<AttachmentsCard meetingId="m1" />)
    const row = await screen.findByTestId('meetings-attachment-f1')
    expect(within(row).getByText(t.ai.expired)).toBeTruthy()
    expect(within(row).getByText(t.expiredFile)).toBeTruthy()
    expect(within(row).queryByRole('button', { name: t.downloadLabel('agenda.pdf') })).toBeNull()
    expect(within(row).getByRole('button', { name: t.removeLabel('agenda.pdf') })).toBeTruthy()
  })

  it('renders an https link as an external link and any other scheme as plain text', async () => {
    serve({
      'GET /meetings/:id/attachments': () => ({
        status: 200,
        body: list([link(), link({ id: 'l2', url: 'javascript:alert(1)', label: '' })]),
      }),
    })
    render(<AttachmentsCard meetingId="m1" />)
    const anchor = await screen.findByRole('link', { name: t.openLinkLabel('Q3 deck') })
    expect(anchor.getAttribute('href')).toBe('https://example.com/deck')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
    const plain = screen.getByText('javascript:alert(1)')
    expect(plain.closest('a')).toBeNull()
  })

  it('hides every control from someone who cannot edit', async () => {
    serve({ 'GET /meetings/:id/attachments': () => ({ status: 200, body: list([file()], false) }) })
    render(<AttachmentsCard meetingId="m1" />)
    await screen.findByText('agenda.pdf')
    expect(screen.queryByTestId('meetings-attachments-add-file')).toBeNull()
    expect(screen.queryByTestId('meetings-attachments-add-link')).toBeNull()
    expect(screen.queryByTestId('meetings-attachment-remove-f1')).toBeNull()
    expect(screen.getByRole('button', { name: t.downloadLabel('agenda.pdf') })).toBeTruthy()
  })

  it('invites an editor to attach something when there is nothing', async () => {
    serve({ 'GET /meetings/:id/attachments': () => ({ status: 200, body: list([]) }) })
    render(<AttachmentsCard meetingId="m1" />)
    expect((await screen.findByTestId('meetings-attachments-empty')).textContent).toBe(t.emptyEditor)
  })

  it('downloads by asking for the URL and then going there', async () => {
    const navigate = vi.fn()
    serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: list([file()]) }),
      'GET /meetings/:id/attachments/:aid/download': () => ({
        status: 200,
        body: { url: 'https://bucket.test/x', expiresAt: '2026-11-10T10:01:00Z' },
      }),
    })
    render(<AttachmentsCard meetingId="m1" navigate={navigate} />)
    await user().click(await screen.findByRole('button', { name: t.downloadLabel('agenda.pdf') }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://bucket.test/x'))
  })
})

describe('adding a file', () => {
  const policy = { url: 'https://bucket.test/up', fields: { key: 'k', policy: 'p' }, expiresAt: '2026-11-10T10:05:00Z' }

  it('refuses an unsupported type, an oversized and an empty file before any request', async () => {
    const api = serve({ 'GET /meetings/:id/attachments': () => ({ status: 200, body: list([]) }) })
    render(<AttachmentsCard meetingId="m1" />)
    const input = await screen.findByTestId('meetings-attachments-input')
    await user().upload(input, [
      new File(['x'], 'tool.exe', { type: 'application/x-msdownload' }),
      new File(['x'.repeat(2000)], 'big.pdf', { type: PDF }),
      new File([], 'empty.pdf', { type: PDF }),
    ])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(t.refused.unsupportedType('tool.exe'))
    expect(alert.textContent).toContain(t.refused.tooLarge('big.pdf', '1,000 byte'))
    expect(alert.textContent).toContain(t.refused.empty('empty.pdf'))
    expect(api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('posts the file to the bucket after the policy and confirms only after that', async () => {
    const order: string[] = []
    let listed = list([])
    serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: listed }),
      'POST /meetings/:id/attachments/files': (_url, init) => {
        order.push('files')
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'notes.md', contentType: MD, sizeBytes: 5 })
        return { status: 201, body: { attachmentId: 'f9', upload: policy } }
      },
      'POST /meetings/:id/attachments/:aid/confirm': () => {
        order.push('confirm')
        listed = list([file({ id: 'f9', name: 'notes.md', contentType: MD })])
        return { status: 200, body: listed.attachments[0] }
      },
    })
    const bucket = vi.fn(async (_url: string, init: RequestInit) => {
      order.push('bucket')
      const body = init.body as FormData
      expect([...body.keys()]).toEqual(['key', 'policy', 'file'])
      expect(init.credentials).toBe('omit')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', bucket)
    render(<AttachmentsCard meetingId="m1" />)
    // The browser gave no type for a .md file: the extension decides.
    await user().upload(
      await screen.findByTestId('meetings-attachments-input'),
      new File(['hello'], 'notes.md', { type: '' }),
    )
    await screen.findByText('notes.md')
    expect(order).toEqual(['files', 'bucket', 'confirm'])
    expect(bucket.mock.calls[0]![0]).toBe(policy.url)
  })

  it('does not confirm when the bucket refuses, and says so', async () => {
    const api = serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: list([]) }),
      'POST /meetings/:id/attachments/files': () => ({ status: 201, body: { attachmentId: 'f9', upload: policy } }),
      'POST /meetings/:id/attachments/:aid/confirm': () => ({ status: 200, body: file() }),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    )
    render(<AttachmentsCard meetingId="m1" />)
    await user().upload(
      await screen.findByTestId('meetings-attachments-input'),
      new File(['hello'], 'a.pdf', { type: PDF }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(t.refused.bucketFailed('a.pdf'))
    expect(api.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  })

  it('maps a server refusal to its copy', async () => {
    serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: list([]) }),
      'POST /meetings/:id/attachments/files': () => ({ status: 409, body: problem(409, 'too_many_files') }),
    })
    render(<AttachmentsCard meetingId="m1" />)
    await user().upload(
      await screen.findByTestId('meetings-attachments-input'),
      new File(['hello'], 'a.pdf', { type: PDF }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(en.common.errors.too_many_files)
  })
})

describe('adding a link', () => {
  it('validates the address before any request, then adds it with the label', async () => {
    let listed = list([])
    const api = serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: listed }),
      'POST /meetings/:id/attachments/links': (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://example.com/deck', label: 'Q3 deck' })
        listed = list([link()])
        return { status: 201, body: link() }
      },
    })
    render(<AttachmentsCard meetingId="m1" />)
    const u = user()
    await u.click(await screen.findByTestId('meetings-attachments-add-link'))
    await u.type(screen.getByTestId('meetings-attachments-link-url'), 'ftp://example.com')
    await u.click(screen.getByTestId('meetings-attachments-link-dialog-submit'))
    expect(await screen.findByText(t.linkDialog.urlInvalid)).toBeTruthy()
    expect(api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)

    await u.clear(screen.getByTestId('meetings-attachments-link-url'))
    await u.type(screen.getByTestId('meetings-attachments-link-url'), 'https://example.com/deck')
    await u.type(screen.getByTestId('meetings-attachments-link-label'), 'Q3 deck')
    await u.click(screen.getByTestId('meetings-attachments-link-dialog-submit'))
    expect(await screen.findByRole('link', { name: t.openLinkLabel('Q3 deck') })).toBeTruthy()
  })
})

describe('removing', () => {
  it('asks first, then deletes and reads the list again', async () => {
    let listed = list([file()])
    const api = serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: listed }),
      'DELETE /meetings/:id/attachments/:aid': () => {
        listed = list([])
        return { status: 204 }
      },
    })
    render(<AttachmentsCard meetingId="m1" />)
    const u = user()
    await u.click(await screen.findByTestId('meetings-attachment-remove-f1'))
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await u.click(screen.getByTestId('meetings-attachments-remove-confirm'))
    await screen.findByTestId('meetings-attachments-empty')
    expect(
      api.mock.calls.some(([url, init]) => String(url).endsWith('/attachments/f1') && init?.method === 'DELETE'),
    ).toBe(true)
  })

  it('keeps the dialog open with the error when storage is unavailable', async () => {
    serve({
      'GET /meetings/:id/attachments': () => ({ status: 200, body: list([file()]) }),
      'DELETE /meetings/:id/attachments/:aid': () => ({ status: 503, body: problem(503, 'storage_unavailable') }),
    })
    render(<AttachmentsCard meetingId="m1" />)
    const u = user()
    await u.click(await screen.findByTestId('meetings-attachment-remove-f1'))
    await u.click(screen.getByTestId('meetings-attachments-remove-confirm'))
    expect((await screen.findByTestId('meetings-attachments-remove-error')).textContent).toBe(
      en.common.errors.storage_unavailable,
    )
  })
})

describe('rules', () => {
  it('reads the type from the extension when the browser gives none', () => {
    expect(contentTypeOf({ name: 'x.PPTX', type: '' })).toContain('presentationml')
    expect(contentTypeOf({ name: 'noext', type: '' })).toBeNull()
  })
  it('accepts only http and https addresses', () => {
    expect(parseWebUrl('https://a.b')).not.toBeNull()
    expect(parseWebUrl('javascript:alert(1)')).toBeNull()
    expect(parseWebUrl('nope')).toBeNull()
  })
})
