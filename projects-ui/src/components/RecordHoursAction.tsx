import { cx } from '@operai/ui'
import { MY_HOURS_HREF, recordHoursResetKey } from '../lib/recordHours'
import type { RecordHoursProps } from '../lib/recordHours'
import { useExtensionSeam } from '../lib/extensionSeam'
import ExtensionContain from './ExtensionContain'
import { strings } from '../strings'

/**
 * The host's own fallback (AC-4.5, design S5): a plain link to My hours, in the slot Record hours would occupy.
 * `/hours` is the shell's, outside this remote's router basepath, so a plain anchor and never a router link.
 * On a task row it is centred in the row's actions, as that row's other plain link is.
 */
function MyHoursLink({ placement }: { placement: RecordHoursProps['placement'] }) {
  return (
    <a
      href={MY_HOURS_HREF}
      className={cx('link text-sm', placement === 'row' && 'self-center')}
      data-testid="record-hours-fallback"
    >
      {strings.recordHours.fallback}
    </a>
  )
}

/**
 * RecordHoursAction — Record hours, hours-ui's own widget, embedded through the shell's `hours.recordHours`
 * extension (specs/20261116-record-hours-in-place, ADR 20261116-record-hours-widget-through-the-host-extension-seam). The host passes six plain strings
 * (built by `recordHoursPropsOf`, from one object; exactly these six cross the seam, however the caller spreads them)
 * and nothing comes back: the widget owns the dialog, the save and
 * its message. Whether to render this at all is the page's call (`mayRecordOnProject`), made from what the page
 * already shows; hours-api decides every save.
 *
 * Nothing shows while the seam loads. A failure of any kind — the import rejected, a module without
 * `HostExtension` (a shell that predates the expose), the widget unreachable, slow or throwing — leaves the page
 * as it was and shows a link to My hours in the widget's place (AC-4.5). No retry: a failed module import is
 * cached, so the link is the whole offer; reloading the page tries again (the `MeetingsSection` posture).
 * projects-ui imports `shell/extensions` once per page through `lib/extensionSeam` (plan R1), as crm-ui does, so a
 * list of rows shares one import and a shell without it degrades the same way.
 */
export default function RecordHoursAction({
  on,
  targetId,
  targetName,
  activityId,
  activityName,
  placement,
}: RecordHoursProps) {
  const seam = useExtensionSeam()

  if (seam.status === 'loading') return null
  const link = <MyHoursLink placement={placement} />
  if (seam.status === 'failed') return link
  const { HostExtension } = seam
  // Rebuilt member by member, never the caller's object: whatever else a call site spreads in stays on this side of
  // the seam and out of the shell's boundary key (OWASP N1). Exactly the six of plan § The shell's extension.
  const props: RecordHoursProps = { on, targetId, targetName, activityId, activityName, placement }
  // Reset by WHO is recorded on, never by the names shown: a rename must not remount the widget and throw away its
  // open dialog or its message; a throw for one target still does not blank the next.
  const resetKey = recordHoursResetKey(props)
  return (
    <ExtensionContain widget="Record hours" resetKey={resetKey} fallback={link}>
      <HostExtension name="hours.recordHours" props={props} fallback={link} resetKey={resetKey} />
    </ExtensionContain>
  )
}
