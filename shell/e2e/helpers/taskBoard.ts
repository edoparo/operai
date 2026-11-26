/**
 * Driving projects-ui's task board (the project page's Tasks card and My tasks): Open, In progress and Done lanes of
 * compact cards, each opening a drawer with the whole task and every action (projects-ui `TaskBoard`, `TaskDrawer`).
 *
 * Test ids (projects-ui): a card is `<prefix>-<id>` (`project-task` on the project page, `my-task` on My tasks), the
 * drawer is `task-drawer` (× `task-drawer-close`), its content `<prefix>-<id>-details`, its actions
 * `<prefix>-<id>-progress|toggle|edit|delete|meeting|crm|deal|waiting`; a lane is `<base>-lane-<open|in_progress|done>`
 * (`project-tasks` / `my-tasks`), the Done lane's "Show older" `<base>-show-older`.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export type TaskLane = 'open' | 'in_progress' | 'done'

/** The open drawer (one at a time). */
export const taskDrawer = (page: Page): Locator => page.getByTestId('task-drawer')

/** A lane of the board on the page: `base` is `project-tasks` or `my-tasks`. */
export const taskLane = (page: Page, base: 'project-tasks' | 'my-tasks', lane: TaskLane): Locator =>
  page.getByTestId(`${base}-lane-${lane}`)

/**
 * Opens a task's drawer from its card and returns the drawer's content (`<prefix>-<id>-details`), where the task's
 * facts and actions are. A dialog the drawer opens (delete's confirmation, the edit form) is outside it: use `page`.
 */
export async function openTaskCard(page: Page, prefix: 'project-task' | 'my-task', id: string): Promise<Locator> {
  await page.getByTestId(`${prefix}-${id}`).click()
  const details = page.getByTestId(`${prefix}-${id}-details`)
  await expect(details).toBeVisible({ timeout: 15_000 })
  return details
}

/** Closes the open drawer with its × and waits for it to go. */
export async function closeTaskDrawer(page: Page): Promise<void> {
  await page.getByTestId('task-drawer-close').click()
  await expect(taskDrawer(page)).toHaveCount(0)
}

/** The drawer's action group (Start, Mark done, Edit, Delete, links, Record hours), named after the task. */
export const taskActions = (details: Locator, subject: string): Locator =>
  details.getByRole('group', { name: `Actions for ${subject}` })
