import { StatePanel } from '@operai/ui'
import { strings } from '../strings'

/**
 * PermissionDenied — the 403 state (T25, specs/20261006-hardware-inventory;
 * design.md § Screens & states: "PermissionDenied in place of the content, no
 * Retry (not transient)"). Re-authored from refund-ui's component: same
 * `role="alert"`, heading focused on mount, no controls. It also renders for a
 * deep link to a tab the caller's capabilities hide (T28), where the server
 * would 403 the same way.
 *
 * Now a thin adapter over @operai/ui's `StatePanel role="alert" focusOnMount`
 * (ADR 20261031-shared-ui-library-consumed-as-source): same copy and data-testids.
 */
export default function PermissionDenied() {
  return (
    <StatePanel
      role="alert"
      focusOnMount
      headingLevel={2}
      title={strings.common.permissionDenied.heading}
      testId="permission-denied"
      headingTestId="permission-denied-heading"
    >
      {strings.common.permissionDenied.body}
    </StatePanel>
  )
}
