import { useState } from 'react'
import { Field, FormDialog } from '@operai/ui'
import { errorMessage } from '../../lib/errors'
import { strings } from '../../strings'

export type FolderNameDialogProps = {
  /** `create` for a new folder, `rename` for an existing one (its current name pre-filled). */
  mode: 'create' | 'rename'
  initialName?: string
  /** Saves the name; a rejection is shown in the dialog, which stays open. */
  onSave: (name: string) => Promise<void>
  onCancel: () => void
}

/** The name of one of the person's own folders (ADR-0090): create or rename. */
export function FolderNameDialog({ mode, initialName = '', onSave, onCancel }: FolderNameDialogProps) {
  const t = strings.folders
  const copy = mode === 'create' ? t.create : t.renameDialog
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()

  const submit = async () => {
    if (trimmed === '') {
      setError(t.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(trimmed)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={copy.title}
      description={t.hint}
      size="sm"
      submitLabel={copy.submit}
      busyLabel={copy.busy}
      cancelLabel={t.cancel}
      closeLabel={t.cancel}
      busy={busy}
      canSubmit={trimmed !== '' && trimmed !== initialName.trim()}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onCancel}
      testIdPrefix={`folder-${mode}`}
    >
      <Field label={t.name} required>
        {(control) => (
          <input
            {...control}
            type="text"
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            data-testid={`folder-${mode}-name`}
          />
        )}
      </Field>
    </FormDialog>
  )
}
