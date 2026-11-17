/**
 * Record hours on a project's page (specs/20261116-record-hours-in-place US-1, ADR 20261116-record-hours-widget-through-the-host-extension-seam).
 *
 * The widget is hours-ui's own, embedded through the shell's `hours.recordHours` extension; this module is the
 * host's half: WHETHER the page offers it, and the six plain strings it is given. Both are a convenience of the
 * page, never an authority — hours-api asks the project's owner as the caller on every save and refuses with
 * `not_on_project` (specs/20261112-time-tracking, ADR 20261112-time-bookability-asked-of-owners-meeting-hosts-system-route). The rule is a pure
 * function of what the page already holds and the person's id (D4, no new read).
 */
import type { ExtensionProps } from 'shell/extensions'
import type { Project } from './types'

/** The props the shell's `hours.recordHours` extension takes: plain strings, nothing comes back. */
export type RecordHoursProps = ExtensionProps['hours.recordHours']

/**
 * My hours, where the fallback link goes when the widget cannot be loaded (AC-4.5). A fixed path in the shell,
 * outside this remote's router basepath, so a plain `<a href>` and never a router link (`lib/links.ts`).
 */
export const MY_HOURS_HREF = '/hours'

/**
 * Whether the project page offers Record hours (AC-1.1, AC-1.2): the project's manager and the members of its
 * team. Anyone else who can read the project does not (AC-1.2); `false` too while the session has not given the
 * person's id yet (`me` is `null`) and for a project that awaits its manager (`projectManager` is `null`) — an
 * absent id never matches a present one. The project's state does not matter (A5).
 */
export const mayRecordOnProject = (project: Project, me: string | null): boolean =>
  me !== null && (project.projectManager?.id === me || project.team.some((member) => member.id === me))

/**
 * The props of the widget on a project's page: the id and the name come from the ONE project the page holds,
 * built here and never assembled at the call site, because the widget shows the name and records on the id and
 * cannot check they belong together (plan R10).
 */
export const recordHoursPropsOf = (project: Project): RecordHoursProps => ({
  on: 'project',
  targetId: project.id,
  targetName: project.name,
  activityId: '',
  activityName: '',
  placement: 'page',
})
