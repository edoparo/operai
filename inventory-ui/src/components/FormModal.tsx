/**
 * FormModal — the form `dialog` shell (T25, specs/20261006-hardware-inventory;
 * design.md § Component inventory: "Form modal pattern —
 * admin-ui/src/components/AddRateEntryModal.tsx"). The Assign, Edit, new-rule
 * and dispose dialogs render their fields inside it.
 *
 * Re-authored from admin-ui's AddRateEntryModal's shell (backdrop,
 * `role="dialog"`, header / body / footer, Escape = Cancel) and made generic:
 * the entity-specific props become `title`, `description`, `children`, the
 * submit labels and `generalError`. Presentational — the page owns the field
 * state and the request, and maps a 422 onto its own field errors; the
 * dialog stays open with every typed value on a failure (design.md § Screens
 * & states), because it never unmounts the children itself.
 *
 * A11y (design.md § Accessibility "Dialogs"):
 *   - `role="dialog"`, `aria-modal`, labelled by the title and, when a notice
 *     is given, described by it (an irreversible-action notice belongs there);
 *   - default focus on the first field (`data-autofocus` wins when a child sets
 *     it; Cancel when the body has no field);
 *   - Tab / Shift+Tab are trapped over the REAL focusable set, so a disabled
 *     submit is not a stop, and focus that has escaped is pulled back in;
 *   - Escape and the backdrop cancel — except in flight, when the dialog is
 *     not dismissible, the fields and buttons are disabled and the submit
 *     button is `aria-busy`;
 *   - a `generalError` is a `role="alert"` above the footer;
 *   - closing returns focus to the element that had it when the dialog opened,
 *     if it is still in the page.
 *
 * Now a thin adapter over @operai/ui's `FormDialog` (ADR 20261031-shared-ui-library-consumed-as-source), which was
 * extracted from this component: same props, copy and data-testids
 * (`-backdrop`, `-cancel`, `-submit`, `-error`; the × is `-close`).
 */

import type { ReactNode } from 'react'
import { FormDialog } from '@operai/ui'
import { strings } from '../strings'

export type FormModalProps = {
  /** The dialog's accessible name and heading. */
  title: string
  /** A notice shown under the heading and used as the dialog's description (e.g. "cannot be edited once saved"). */
  description?: ReactNode
  /** The fields. They are disabled as a group while `submitting`. */
  children: ReactNode
  /** Label of the submit button. Defaults to strings.common.formModal.defaultSubmitLabel. */
  submitLabel?: string
  /** Label of the submit button in flight. Defaults to strings.common.formModal.defaultSubmittingLabel. */
  submittingLabel?: string
  /** Whether the request is currently in flight. */
  submitting: boolean
  /** False keeps the submit button disabled (a required field is empty). Defaults to true. */
  canSubmit?: boolean
  /** A non-field error (503, network, a conflict banner); null = none. */
  generalError: string | null
  onSubmit: () => void
  /** Called on Cancel, ×, the backdrop and Escape — never while `submitting`. */
  onCancel: () => void
  /** Namespaces the `data-testid`s. Defaults to `'form-modal'`. */
  testIdPrefix?: string
}

export default function FormModal({
  title,
  description,
  children,
  submitLabel,
  submittingLabel,
  submitting,
  canSubmit = true,
  generalError,
  onSubmit,
  onCancel,
  testIdPrefix = 'form-modal',
}: FormModalProps) {
  const t = strings.common.formModal

  return (
    <FormDialog
      title={title}
      description={description}
      submitLabel={submitLabel ?? t.defaultSubmitLabel}
      busyLabel={submittingLabel ?? t.defaultSubmittingLabel}
      cancelLabel={t.cancelLabel}
      closeLabel={t.closeAriaLabel}
      busy={submitting}
      canSubmit={canSubmit}
      error={generalError}
      onSubmit={onSubmit}
      onCancel={onCancel}
      testIdPrefix={testIdPrefix}
    >
      {children}
    </FormDialog>
  )
}
