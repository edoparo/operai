import type { RecordHoursProps } from '../lib/recordHours'
import { recordHoursResetKey } from '../lib/recordHours'
import { useExtensionSeam } from '../lib/extensionSeam'
import ExtensionContain from './ExtensionContain'
import { strings } from '../strings'

/**
 * The host's own fallback (design S5): a plain link to My hours where the button would have been. A real anchor, so it
 * works with the widget gone; when hours-ui is down it lands on the shell's own remote-failure state, the right place
 * to retry.
 */
function FallbackLink({ placement }: { placement: RecordHoursProps['placement'] }) {
  return (
    <a
      href="/hours"
      className={placement === 'row' ? 'link self-center text-sm' : 'link text-sm'}
      data-testid="crm-record-hours-fallback"
    >
      {strings.recordHours.fallbackLink}
    </a>
  )
}

/**
 * RecordHoursAction — Record hours on a CRM page or row (specs/20261116-record-hours-in-place AC-4.5; ADR
 * 20261116-record-hours-widget-through-the-host-extension-seam). The button, its dialog and its message are hours-ui's
 * own, a federated widget loaded through the shell's `shell/extensions` seam as `hours.recordHours`
 * (ADR 20261104-host-extension-federated-panel-through-the-shell): this wrapper only imports the seam, hands it six plain strings
 * and keeps the host's fallback. The caller decides WHETHER to render it (`mayRecordOn…`); hours-api decides every save.
 *
 * Nothing shows while the widget loads, then the button; a shell that predates the extension, a failing import, a
 * module without `HostExtension`, a widget that throws, or one that does not answer in 5 s shows a link to My hours
 * instead (the shell's `HostExtension` supplies the last two), and the rest of the page is unaffected.
 *
 * Props come from `recordHoursPropsOf…` in `lib/recordHours.ts`, built from one object so the name shown and the id
 * recorded on belong together (plan R10); they cross the seam as exactly these six strings.
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
  const fallback = <FallbackLink placement={placement} />
  if (seam.status === 'failed') return fallback
  const { HostExtension } = seam
  const props: RecordHoursProps = { on, targetId, targetName, activityId, activityName, placement }
  // Reset by WHO is recorded on, never by the names shown: a rename (the deal's title, a task's subject) must not
  // remount the widget and throw away its open dialog or its message; a throw for one target still does not blank the next.
  const resetKey = recordHoursResetKey(props)
  return (
    <ExtensionContain widget="Record hours" resetKey={resetKey} fallback={fallback}>
      <HostExtension name="hours.recordHours" props={props} fallback={fallback} resetKey={resetKey} />
    </ExtensionContain>
  )
}
