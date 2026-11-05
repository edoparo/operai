/**
 * specs/023-signup-gate T10 — the waiting-list journeys through the real shell.
 *
 *   AC-3.2   an admin approves a pending request choosing a role: it moves to
 *            Approved and an invitation (with that role) appears under Invitations
 *   AC-3.4   an admin rejects another request: it moves to Rejected, no invitation
 *   AC-3.10  a non-admin never reaches the screen and the API answers 403
 *   AC-1.9   (the whole suite) `/test-auth/session` still mints `employee` users
 *            outside the gate: this file seeds its admin and non-admin that way.
 *
 * Real OAuth cannot run here, so the waiting-list rows are seeded straight into
 * the database (helpers/accessRequestFixtures.ts); the gate itself is proven at
 * integration level (plan.md R5). The invitation email is stubbed locally
 * (EMAIL_ENABLED=false), so only what the admin sees is asserted.
 */
import { test, expect } from '@playwright/test'
import { seedAdminSession, seedUserSession, applySessionCookie } from './helpers/adminSession'
import { cleanupFixtures } from './helpers/inviteFixtures'
import { seedAccessRequest, clearAccessRequests } from './helpers/accessRequestFixtures'

const AUTH_URL = (
  process.env['E2E_AUTH_URL'] ?? process.env['VITE_AUTH_URL'] ?? 'http://localhost:3001'
).replace(/\/$/, '')

const RUN = Date.now().toString(36)
const ADMIN_EMAIL = `ar-admin-${RUN}@operai.test`
const EMPLOYEE_EMAIL = `ar-employee-${RUN}@operai.test`

test.describe('specs/023-signup-gate — waiting list e2e (T10)', () => {
  test.afterAll(() => {
    clearAccessRequests(RUN)
    cleanupFixtures(RUN)
  })

  test('an admin approves a seeded request with a role: it moves to Approved and an invitation with that role appears', async ({
    page,
    context,
  }) => {
    const admin = await seedAdminSession(ADMIN_EMAIL, 'QE Access Admin')
    await applySessionCookie(context, admin)

    // An allowed-domain address: approval refuses any other (AC-5.1), and the account
    // only has to exist once the person signs in, which this journey never does.
    const email = `ar-approve-${RUN}@welld.ch`
    const request = seedAccessRequest(email, 'Alba Approvata')

    // A uniquely named role through the real admin API, so the invitation's role is provably chosen.
    const roleName = `qe-access-role-${RUN}`
    const roleRes = await fetch(`${AUTH_URL}/admin/roles`, {
      method: 'POST',
      headers: { Cookie: admin.cookieHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roleName }),
    })
    const roleBody = await roleRes.text()
    expect(roleRes.status, roleBody).toBe(201)
    const role = JSON.parse(roleBody) as { id: string }

    await page.goto('/admin/users/access-requests')
    await expect(page.getByTestId('admin-access-requests-page')).toBeVisible({ timeout: 20_000 })

    // The seeded request is listed under the default (Pending) filter.
    await expect(page.getByTestId('access-requests-status-filter')).toHaveValue('pending')
    const approveButton = page.getByTestId(`access-request-approve-${request.id}`)
    await expect(approveButton).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('access-requests-table')).toContainText(email)

    await approveButton.click()
    await expect(page.getByTestId('approve-access-request-modal')).toBeVisible()
    await page.getByTestId(`approve-access-request-role-${role.id}`).check()
    await page.getByTestId('approve-access-request-submit').click()

    await expect(page.getByTestId('approve-access-request-modal')).toBeHidden({ timeout: 10_000 })
    await expect(page.getByTestId('access-requests-announcement')).toContainText(email)
    // It left the Pending list.
    await expect(page.getByTestId(`access-request-approve-${request.id}`)).toHaveCount(0)

    // It is now under Approved.
    await page.getByTestId('access-requests-status-filter').selectOption('approved')
    const approvedRow = page.locator('tr').filter({ hasText: email })
    await expect(approvedRow).toBeVisible({ timeout: 10_000 })
    await expect(approvedRow).toContainText('Approved')

    // And an invitation with exactly that role exists under Invitations.
    await page.goto('/admin/users/invitations')
    await expect(page.getByTestId('admin-invitations-page')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('invitations-search-input').fill(email)
    const invitationRow = page.locator('tr').filter({ hasText: email })
    await expect(invitationRow).toBeVisible({ timeout: 10_000 })
    await expect(invitationRow).toContainText('Pending')
    await expect(invitationRow).toContainText(roleName)
  })

  test('an admin rejects a seeded request: it moves to Rejected and no invitation is created', async ({
    page,
    context,
  }) => {
    const admin = await seedAdminSession(ADMIN_EMAIL, 'QE Access Admin')
    await applySessionCookie(context, admin)

    const email = `ar-reject-${RUN}@welld.ch`
    const request = seedAccessRequest(email, 'Rita Rifiutata', 'github')

    await page.goto('/admin/users/access-requests')
    await expect(page.getByTestId('admin-access-requests-page')).toBeVisible({ timeout: 20_000 })
    const rejectButton = page.getByTestId(`access-request-reject-${request.id}`)
    await expect(rejectButton).toBeVisible({ timeout: 10_000 })

    await rejectButton.click()
    await page.getByTestId('access-request-reject-dialog-confirm').click()

    await expect(page.getByTestId('access-requests-announcement')).toContainText(email, { timeout: 10_000 })
    await expect(page.getByTestId(`access-request-reject-${request.id}`)).toHaveCount(0)

    await page.getByTestId('access-requests-status-filter').selectOption('rejected')
    const rejectedRow = page.locator('tr').filter({ hasText: email })
    await expect(rejectedRow).toBeVisible({ timeout: 10_000 })
    await expect(rejectedRow).toContainText('Rejected')

    // Rejecting sends nothing and creates nothing: no invitation for this address.
    await page.goto('/admin/users/invitations')
    await expect(page.getByTestId('admin-invitations-page')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('invitations-search-input').fill(email)
    await expect(page.locator('tr').filter({ hasText: email })).toHaveCount(0)
  })

  test('a non-admin never reaches the screen and the API refuses them (AC-3.10, AC-1.9)', async ({
    page,
    context,
  }) => {
    // AC-1.9: the dev-only session mint still creates this user, outside the gate.
    const employee = await seedUserSession(EMPLOYEE_EMAIL, 'QE Access Employee')
    await applySessionCookie(context, employee)

    const request = seedAccessRequest(`ar-hidden-${RUN}@operai.test`, 'Hidden Person')

    await page.goto('/admin/users/access-requests')
    await expect(page).not.toHaveURL(/\/admin\//, { timeout: 20_000 })
    await expect(page.getByTestId('admin-access-requests-page')).toHaveCount(0)

    for (const [method, path] of [
      ['GET', '/admin/access-requests'],
      ['POST', `/admin/access-requests/${request.id}/approve`],
      ['POST', `/admin/access-requests/${request.id}/reject`],
    ] as const) {
      const res = await fetch(`${AUTH_URL}${path}`, {
        method,
        headers: { Cookie: employee.cookieHeader, 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })
})
