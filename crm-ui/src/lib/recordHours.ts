/**
 * Record hours in place, the CRM host's half (specs/20261116-record-hours-in-place, ADR
 * 20261116-record-hours-widget-through-the-host-extension-seam): who is offered the button, and the props the widget
 * gets. Both are pure functions of the object the page already holds.
 *
 * The rule only decides whether the button SHOWS. Whether the person may record is hours-api's answer to the save,
 * asked of the owner as the caller and failing closed (ADR 20261112-time-bookability-asked-of-owners-meeting-hosts-system-route),
 * so a rule that is wrong in either direction costs a missing shortcut or a refused save, never a wrong entry.
 */
import type { ExtensionProps } from 'shell/extensions'
import type { Deal } from './types'

/** What the shell's `hours.recordHours` extension takes: six plain strings, nothing comes back. */
export type RecordHoursProps = ExtensionProps['hours.recordHours']

/**
 * A deal's page offers Record hours to its owner and to the technical contact of its estimate (D4). Anyone else who
 * can read the deal — including a person involved only through one of its tasks — records from My hours, or from the
 * task's own row (AC-2.2). `me` is null until the session has given the person's id: nothing is offered then.
 */
export function mayRecordOnDeal(deal: Deal, me: string | null): boolean {
  if (!me) return false
  return me === deal.owner.id || me === deal.estimate?.technical.id
}

/**
 * The widget's props for the deal's page header, built from ONE object so the name the person reads and the id the
 * hours are recorded on cannot come from two different deals (plan R10). Never assemble these at a call site.
 */
export function recordHoursPropsOfDeal(deal: Deal): RecordHoursProps {
  return {
    on: 'deal',
    targetId: deal.id,
    targetName: deal.title,
    activityId: '',
    activityName: '',
    placement: 'page',
  }
}
