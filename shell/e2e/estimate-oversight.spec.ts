/**
 * specs/20261108-estimate-list-oversight T10 — the admin's "All estimates" journey.
 *
 * An owner creates an estimate through the API; an admin who neither owns nor
 * collaborates on it switches the list to All, opens it read-only (ADR 20261108-estimai-oversight-permission-amends-0036:
 * `access: "oversight"`, no close, no sharing), then the owner closes it and
 * the admin finds it under All + Closed. The Deal badge is covered at
 * integration level: this stack has no crm-api → estimai-api service credential.
 *
 * Needs the whole stack up (`mise run dev`) with specs/20261108-estimate-list-oversight deployed locally:
 * the estimai-api migration applied and auth re-seeded (`estimate:read-all`).
 */
import { test, expect, type Page } from '@playwright/test'
import { applySessionCookie, seedAdminSession, seedUserSession } from './helpers/adminSession'
import { grantEstimaiAccess } from './helpers/estimaiFixtures'

const API_ORIGIN = (process.env['E2E_API_URL'] ?? process.env['VITE_API_URL'] ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
)

const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const minimalContent = {
  params: {
    parallelism: 0.7,
    sprintDays: 10,
    workingDaysMonth: 20,
    qaDeployDays: 0,
    qaTestDays: 0,
    pmDays: 0,
    aiCostCoef: 10,
    aiGain: 0.3,
  },
  releases: [],
  acts: [],
}

async function api(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`[estimate-oversight] ${method} ${path} → ${res.status}: ${await res.text()}`)
  return (await res.json()) as { id: string; version: number }
}

/** Resolves once the list's own GET /estimates (any filters) has answered 200. */
async function whenListLoaded(page: Page, action: () => Promise<unknown>): Promise<void> {
  const listLoaded = page.waitForResponse(
    (resp) =>
      resp.request().method() === 'GET' && new URL(resp.url()).pathname === '/estimates' && resp.status() === 200,
    { timeout: 15_000 },
  )
  await action()
  await listLoaded
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.describe('specs/20261108-estimate-list-oversight T10', () => {
  test('an admin lists every estimate, opens a stranger’s read-only, and finds it under Closed once closed (AC-1.1/1.4/2.1/2.2)', async ({
    browser,
  }) => {
    const suffix = uniqueSuffix()
    const owner = await seedUserSession(`oversight-owner-${suffix}@operai.test`, 'Oversight Owner')
    grantEstimaiAccess(owner.email)
    const admin = await seedAdminSession(`oversight-admin-${suffix}@operai.test`, 'Oversight Admin')
    grantEstimaiAccess(admin.email)

    const name = `Oversight ${suffix}`
    const created = await api(owner.token, 'POST', '/estimates', {
      name,
      author: 'Oversight Owner',
      content: minimalContent,
    })

    const context = await browser.newContext()
    await applySessionCookie(context, admin)
    const page = await context.newPage()

    // AC-1.1: Mine by default; the stranger's estimate is not there.
    await whenListLoaded(page, () => page.goto('/estimai/estimates'))
    await expect(page.getByRole('heading', { name: 'My estimates' })).toBeVisible()
    await expect(page.getByText(name)).toHaveCount(0)

    // All: the heading follows and the stranger's estimate is listed.
    await whenListLoaded(page, () => page.getByLabel('Whose estimates').selectOption('all'))
    await expect(page).toHaveURL(/whose=all/)
    await expect(page.getByRole('heading', { name: 'All estimates' })).toBeVisible()
    await expect(page.getByText(name)).toBeVisible()

    // AC-1.4: opened read-only — the oversight banner, no close, no sharing.
    await page.getByRole('link', { name }).first().click()
    await expect(page).toHaveURL(new RegExp(`/estimai/estimates/${created.id}$`), { timeout: 15_000 })
    await expect(page.getByTestId('estimate-oversight-banner')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('close-estimate-button')).toHaveCount(0)
    await expect(page.getByTestId('collaborators-button')).toHaveCount(0)
    await expect(page.getByTestId('collaborators-chip')).toHaveCount(0)

    // AC-2.2: the owner closes it; under All + Open it is gone, under All + Closed it is there.
    await api(owner.token, 'POST', `/estimates/${created.id}/close`, undefined, { 'If-Match': `"${created.version}"` })

    await whenListLoaded(page, () => page.goto('/estimai/estimates?whose=all'))
    await expect(page.getByText(name)).toHaveCount(0)
    await whenListLoaded(page, () => page.getByLabel('Status').selectOption('closed'))
    await expect(page).toHaveURL(/status=closed/)
    await expect(page.getByText(name)).toBeVisible()
    await expect(page.getByTestId('estimate-closed-badge').first()).toBeVisible()

    await context.close()
  })
})
