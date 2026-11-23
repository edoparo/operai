/**
 * Starting a meeting from Projects (specs/20261104-meetings A18). A meeting is linked to a PROJECT
 * (host `projects/project`); started from a task, it is linked to the task's project and its title
 * starts as the task's. The new-meeting page belongs to Meetings, at `/meetings/new`, outside this
 * router's basepath: a plain anchor, which the shell routes.
 */
import { usePermissions } from 'shell/session'

export const MEETINGS_HOST = { hostApp: 'projects', entityType: 'project' } as const

/** The new-meeting page, linked to a project, with an optional suggested title. */
export const newMeetingHref = (projectId: string, title?: string): string => {
  const params = new URLSearchParams({ hostApp: MEETINGS_HOST.hostApp, hostType: MEETINGS_HOST.entityType, hostId: projectId })
  if (title && title.trim() !== '') params.set('title', title.trim())
  return `/meetings/new?${params.toString()}`
}

/** UX gating only (meetings-api decides): who holds `meetings:access` may start one. */
export const useCanStartMeetings = (): boolean =>
  usePermissions().permissions.some((p) => p.resource === 'meetings' && p.action === 'access')
