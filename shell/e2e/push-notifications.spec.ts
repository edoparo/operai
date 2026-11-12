/**
 * T10 — Push notifications end-to-end (specs/029-push-notifications; plan § Test strategy, E2E note).
 *
 * Drives the REAL shell (My profile, `/account`) against the REAL auth and notify-api `/push/*` routes.
 * Only the browser's push machinery is faked (helpers/pushFixtures.ts `installFakePush`): headless
 * Chromium cannot get a real subscription; real delivery is the manual cross-browser check (AC-2.1, T12).
 *
 * Covers: AC-1.1 (nothing asked on load), AC-1.2 (turn on -> subscribed and listed), AC-1.5 (turn off ->
 * gone from the server and the list), AC-3.2 (remove a device from the list), and AC-4.3 (a signed-out
 * visit to a deep link lands on sign-in and returns to it).
 *
 * STACK REQUIREMENT: notify-api running with PUSH_ENABLED=true and a valid VAPID pair (a notify-api started
 * before that env was set answers `GET /push/config` with `enabled:false`, and the push journeys then fail at
 * the first test with an explicit message rather than on a missing control).
 */

import { test, expect, type Page } from '@playwright/test'
import { seedSession } from './helpers/seedSession'
import {
  deleteTrackedPushDevices,
  installFakePush,
  listServerDevices,
  readPushConfig,
  tokenFor,
  trackPushDevices,
} from './helpers/pushFixtures'

const SHELL_ORIGIN = `http://localhost:${process.env['E2E_SHELL_PORT'] ?? '5173'}`
const AUTH_ORIGIN = (process.env['E2E_AUTH_URL'] ?? process.env['VITE_AUTH_URL'] ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
)

const section = (page: Page) => page.getByTestId('account-push-section')
const status = (page: Page) => page.getByTestId('account-push-status')
const toggle = (page: Page) => page.getByTestId('account-push-toggle')

test.describe('My profile: push notifications (AC-1.1, AC-1.2, AC-1.5, AC-3.2)', () => {
  let token = ''
  let deviceIds: string[] = []

  test.beforeEach(async ({ context, page }) => {
    const cookies = await seedSession(context)
    token = await tokenFor(`${cookies[0].name}=${cookies[0].value}`)
    const config = await readPushConfig(token)
    expect(
      config.enabled,
      'ENV: notify-api answers GET /push/config with enabled:false. It must run with PUSH_ENABLED=true and a valid ' +
        'VAPID pair (restart it after setting them).',
    ).toBe(true)
    // Start from a clean slate for this user, so "one device" assertions are exact.
    await deleteTrackedPushDevices(
      token,
      (await listServerDevices(token)).map((device) => device.id),
    )
    await installFakePush(context, SHELL_ORIGIN)
    deviceIds = trackPushDevices(page)
  })

  test.afterEach(async () => {
    if (token) await deleteTrackedPushDevices(token, deviceIds)
  })

  test('turn on lists this browser, a reload keeps it on, turn off removes it', async ({ page }) => {
    await page.goto('/account')
    await expect(section(page)).toBeVisible({ timeout: 15_000 })
    await expect(status(page)).toHaveText('Off')
    await expect(page.getByText('No devices yet')).toBeVisible()
    // AC-1.1: opening the page asked for nothing and registered nothing.
    expect(await listServerDevices(token)).toHaveLength(0)

    await toggle(page).click()
    await expect(status(page)).toHaveText('On', { timeout: 15_000 })
    await expect(toggle(page)).toHaveText('Turn off')
    await expect.poll(() => deviceIds.length).toBe(1)
    const [deviceId] = deviceIds
    const row = page.getByTestId(`account-push-device-${deviceId}`)
    await expect(row).toBeVisible()
    await expect(row.getByText('This browser')).toBeVisible()
    // The server really holds it (the list endpoint, not just the UI).
    expect((await listServerDevices(token)).map((device) => device.id)).toEqual([deviceId])

    // Reload: boot reconciliation finds the stored device and the subscription, and shows it on.
    await page.reload()
    await expect(section(page)).toBeVisible({ timeout: 15_000 })
    await expect(status(page)).toHaveText('On', { timeout: 15_000 })
    await expect(page.getByTestId(`account-push-device-${deviceId}`)).toBeVisible()
    expect(await listServerDevices(token)).toHaveLength(1)

    // Turn off (AC-1.5): the server row and the list entry go.
    await toggle(page).click()
    await expect(status(page)).toHaveText('Off', { timeout: 15_000 })
    await expect(toggle(page)).toHaveText('Turn on')
    await expect(page.getByTestId(`account-push-device-${deviceId}`)).toHaveCount(0)
    await expect(page.getByText('No devices yet')).toBeVisible()
    expect(await listServerDevices(token)).toHaveLength(0)

    // And it stays off after a reload.
    await page.reload()
    await expect(status(page)).toHaveText('Off', { timeout: 15_000 })
  })

  test('removing this browser from the device list turns it off (AC-3.2)', async ({ page }) => {
    await page.goto('/account')
    await expect(section(page)).toBeVisible({ timeout: 15_000 })
    await toggle(page).click()
    await expect(status(page)).toHaveText('On', { timeout: 15_000 })
    await expect.poll(() => deviceIds.length).toBe(1)
    const [deviceId] = deviceIds

    await page.getByTestId(`account-push-device-remove-${deviceId}`).click()
    await page.getByTestId('account-push-remove-confirm').click()

    await expect(page.getByTestId(`account-push-device-${deviceId}`)).toHaveCount(0, { timeout: 15_000 })
    await expect(status(page)).toHaveText('Off')
    await expect(page.getByText('No devices yet')).toBeVisible()
    expect(await listServerDevices(token)).toHaveLength(0)

    await page.reload()
    await expect(status(page)).toHaveText('Off', { timeout: 15_000 })
    await expect(page.getByTestId(`account-push-device-${deviceId}`)).toHaveCount(0)
  })
})

test.describe('AC-4.3: a signed-out visit to a notification deep link', () => {
  test('lands on sign-in, and after signing in returns to /notify', async ({ page, context }) => {
    await page.goto('/notify')
    await expect(page).toHaveURL(new RegExp(`^${AUTH_ORIGIN}/sign-in`), { timeout: 15_000 })
    const redirect = new URL(page.url()).searchParams.get('redirect')
    expect(redirect).toBe(`${SHELL_ORIGIN}/notify`)

    // The hosted page is OAuth-only, so sign in with a seeded session, then follow the redirect it carries.
    await seedSession(context)
    await page.goto(redirect ?? '')
    await expect(page).toHaveURL(`${SHELL_ORIGIN}/notify`, { timeout: 15_000 })
    // The guard let the signed-in user through and stays out of the way: no second bounce to sign-in once the
    // shell's session bootstrap has settled. What notify-ui then draws is notifications.spec.ts's business
    // (a dev-mode `mise run dev` stack can fail to share one router instance with a remote, which would turn a
    // heading assertion here into a test of the dev server rather than of the deep link).
    // (not `networkidle`: the notification SSE stream keeps the network busy for good)
    await page.waitForTimeout(2_000)
    await expect(page).toHaveURL(`${SHELL_ORIGIN}/notify`)
  })
})
