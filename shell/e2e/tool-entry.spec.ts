/**
 * Every tool opens from its bare URL (specs/029 D-5).
 *
 * EstimAI, Refund, Inventory, CRM and Admin each have an index route that redirects (`/inventory` to
 * `/inventory/assets`, and so on). The shell mounts a remote inside a Suspense boundary and suspends it on every
 * URL change, which hides the remote's tree and reveals it again; a remote whose router was torn down by that
 * hide came back as a second router that never loaded, and the page stayed empty. Reaching a tool by its sidebar
 * link, a notification link or a reload of the bare URL is the path, so that is what runs here: against the
 * REAL shell, the REAL remotes and the REAL auth, nothing mocked.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedAdminSession, applySessionCookie } from './helpers/adminSession'

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

interface Tool {
  /** The sidebar link's accessible name. */
  link: string
  bare: string
  target: string
  /** Something only the redirect target renders, inside the shell's main area. */
  content: RegExp
}

const TOOLS: Tool[] = [
  { link: 'EstimAI', bare: '/estimai', target: '/estimai/estimates', content: /My estimates/ },
  { link: 'Refund', bare: '/refund', target: '/refund/requests', content: /My requests/ },
  { link: 'Inventory', bare: '/inventory', target: '/inventory/assets', content: /Depreciation rules/ },
  { link: 'CRM', bare: '/crm', target: '/crm/companies', content: /Companies/ },
  { link: 'Admin', bare: '/admin', target: '/admin/roles', content: /Departments/ },
]

async function expectRendered(page: Page, tool: Tool) {
  await expect(page).toHaveURL(new RegExp(`${tool.target}$`))
  const main = page.locator('#shell-main-content')
  await expect(main).toContainText(tool.content)
  await expect(main.locator('> *')).not.toHaveCount(0)
}

test.describe('every tool opens from its bare URL', () => {
  test.beforeEach(async ({ context }) => {
    const admin = await seedAdminSession(`tool-entry-${runId}@operai.test`, 'Tool Entry Admin')
    await applySessionCookie(context, admin)
  })

  for (const tool of TOOLS) {
    test(`${tool.bare}: a full load lands on ${tool.target} and renders it`, async ({ page }) => {
      await page.goto(tool.bare)
      await expectRendered(page, tool)
    })

    test(`${tool.bare}: the sidebar link from another screen renders ${tool.target}`, async ({ page }) => {
      await page.goto('/account')
      await page.getByRole('link', { name: tool.link, exact: true }).click()
      await expectRendered(page, tool)
    })
  }

  test('a tool left and returned to renders again, on every visit', async ({ page }) => {
    await page.goto('/account')
    for (let visit = 0; visit < 3; visit++) {
      for (const tool of [TOOLS[2]!, TOOLS[3]!]) {
        await page.getByRole('link', { name: tool.link, exact: true }).click()
        await expectRendered(page, tool)
      }
    }
  })
})
