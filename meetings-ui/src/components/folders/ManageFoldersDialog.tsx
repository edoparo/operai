import { Button, Dialog, Icon } from '@operai/ui'
import type { MeetingFolder } from '../../lib/types'
import { strings } from '../../strings'

export type ManageFoldersDialogProps = {
  folders: readonly MeetingFolder[]
  onCreate: () => void
  onRename: (folder: MeetingFolder) => void
  onDelete: (folder: MeetingFolder) => void
  onClose: () => void
}

/**
 * Every one of the person's own folders (ADR 20261113-personal-meeting-folders), each with its rename and delete actions. Those open their own
 * dialog on top of this one (dialogs stack, design-system § Dialogs), so this stays open behind them.
 */
export function ManageFoldersDialog({ folders, onCreate, onRename, onDelete, onClose }: ManageFoldersDialogProps) {
  const t = strings.folders
  return (
    <Dialog
      title={t.manageDialog.title}
      description={t.hint}
      onClose={onClose}
      closeLabel={t.manageDialog.close}
      testIdPrefix="folders-manage"
      dialogTestId="folders-manage"
    >
      <div className="dialog-body">
        {folders.length === 0 ? (
          <p className="text-sm text-soft" data-testid="folders-manage-empty">
            {t.manageDialog.empty}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule" aria-label={t.manageDialog.title}>
            {folders.map((folder) => (
              <li key={folder.id} className="flex items-center gap-2 py-2" data-testid={`folders-manage-row-${folder.id}`}>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{folder.name}</span>
                <span className="text-2xs text-soft">{t.manageDialog.count(folder.meetingCount)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label={t.manageDialog.rename(folder.name)}
                  aria-haspopup="dialog"
                  onClick={() => onRename(folder)}
                  data-testid={`folders-manage-rename-${folder.id}`}
                >
                  <Icon name="pencil" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label={t.manageDialog.delete(folder.name)}
                  aria-haspopup="dialog"
                  onClick={() => onDelete(folder)}
                  data-testid={`folders-manage-delete-${folder.id}`}
                >
                  <Icon name="trash" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="dialog-footer">
        <Button onClick={onCreate} aria-haspopup="dialog" data-testid="folders-manage-new">
          {t.newFolder}
        </Button>
        <Button variant="primary" onClick={onClose} data-testid="folders-manage-done">
          {t.manageDialog.close}
        </Button>
      </div>
    </Dialog>
  )
}
