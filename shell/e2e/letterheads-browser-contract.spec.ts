/**
 * specs/20261116-letterhead-service T26 — the one thing between the shell and letterhead-api that neither side's own tests
 * can see: the BROWSER's rules for a call from the shell's origin to the service's.
 *
 * Every call letterheads-ui makes goes through `shell/session`'s `apiFetch`, which attaches the Bearer token and sends
 * `credentials: 'include'` to every trusted origin (shell/src/lib/session.ts). For a cross-origin request in credentials mode
 * the browser accepts the answer only when the preflight AND the answer carry `Access-Control-Allow-Origin: <that origin>`
 * (never `*`) AND `Access-Control-Allow-Credentials: true`. letterhead-api's own CORS tests and the shell's tests each pass
 * without the other; without this header the configurator cannot load a single thing in a real browser ("Could not load").
 *
 * The check is made twice: on the headers (what the service says), and by a real `fetch` from the shell's page the way
 * `apiFetch` makes it (what the browser does with it: a refused CORS check is a rejected `fetch`, an accepted one answers,
 * here 401 for a token that is not one). The prerequisites are letterheads.spec.ts's.
 */
import { expect, test } from '@playwright/test'
import { LETTERHEADS_API_URL, contextFor, setUpPeople, type People } from './fixtures/letterheads'

const SHELL_ORIGIN = `http://localhost:${process.env['E2E_SHELL_PORT'] ?? '5173'}`

let people: People

test.beforeAll(async () => {
  test.setTimeout(180_000)
  people = await setUpPeople()
})

test.describe('specs/20261116-letterhead-service T26: the browser may call the service from the shell (credentials mode)', () => {
  test('the preflight and the answer allow the shell origin with credentials, and no other origin', async ({ playwright }) => {
    const request = await playwright.request.newContext()
    const asked = `${LETTERHEADS_API_URL}/v1/letterheads`

    const preflight = await request.fetch(asked, {
      method: 'OPTIONS',
      headers: {
        Origin: SHELL_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    expect(preflight.status()).toBeLessThan(300)
    expect(preflight.headers()['access-control-allow-origin']).toBe(SHELL_ORIGIN)
    expect(preflight.headers()['access-control-allow-credentials'], 'apiFetch sends credentials: include').toBe('true')
    expect(preflight.headers()['access-control-allow-headers']?.toLowerCase()).toContain('authorization')
    // Writes are POSTs only (no version is ever changed or deleted): never PUT, PATCH or DELETE.
    expect(preflight.headers()['access-control-allow-methods']).not.toMatch(/PUT|PATCH|DELETE/)

    // The answer itself (here a 401: no token) carries the same two members, so the browser hands it to the page.
    const answer = await request.get(asked, { headers: { Origin: SHELL_ORIGIN } })
    expect(answer.status()).toBe(401)
    expect(answer.headers()['access-control-allow-origin']).toBe(SHELL_ORIGIN)
    expect(answer.headers()['access-control-allow-credentials']).toBe('true')

    // Another origin is not allowed anything.
    const stranger = await request.fetch(asked, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    })
    expect(stranger.headers()['access-control-allow-origin']).toBeUndefined()
    expect(stranger.headers()['access-control-allow-credentials']).toBeUndefined()
    await request.dispose()
  })

  test('a real fetch from the shell page, as apiFetch makes it, is let through by the browser', async ({ browser }) => {
    const context = await contextFor(browser, people.viewer)
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Tool navigation' })).toBeVisible({ timeout: 30_000 })

    const outcome = await page.evaluate(async (url) => {
      try {
        const response = await fetch(`${url}/v1/catalog`, {
          credentials: 'include',
          headers: { Authorization: 'Bearer not-a-token' },
        })
        return { status: response.status }
      } catch (error) {
        return { rejected: String(error) }
      }
    }, LETTERHEADS_API_URL)

    // A 401 the page could read: the browser's CORS check passed. A rejected fetch is the check refusing it.
    expect(outcome).toEqual({ status: 401 })
    await context.close()
  })
})
