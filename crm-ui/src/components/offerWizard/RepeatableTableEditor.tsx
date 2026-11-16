import { useId, useState } from 'react'
import { Badge, Button, Icon, VisuallyHidden } from '@operai/ui'
import type { OfferLanguage, WizardAnswers } from '../../lib/offerEngine/answers'
import type { OutlineItem } from '../../lib/offerEngine/outline'
import type { TemplateAst } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'
import { controlId } from './controlId'
import FieldInput, { type FieldItem } from './FieldInput'
import TemplateText from './TemplateText'
import { useFocusRequest } from './useFocusRequest'

const t = strings.offerWizard

export type TableItemDecl = Extract<OutlineItem, { type: 'table' }>
type Row = WizardAnswers['tables'][string][number]

/** Caps of the answers (plan § Offer draft): 50 rows. */
const MAX_ROWS = 50

/** A row's id is its own for good: the cells follow it when the row moves, and an issue names a cell by it. */
function newRowId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ?? `row${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export interface RepeatableTableEditorProps {
  item: TableItemDecl
  rows: readonly Row[]
  ast: TemplateAst
  language: OfferLanguage
  currency: string
  onChange: (next: Row[]) => void
  /** The text of an invalid answer by the cell's name (`TABLE#<rowId>.COLUMN`), from the engine's issue list. */
  errorOf: (name: string) => string | null
  isMissing: (name: string) => boolean
  handEditedNote?: string
}

/**
 * A repeatable table (AC-1.7): a stack of row cards, a control per column by the column field's kind, labelled
 * icon buttons to move or remove a row, and Add row. A row keeps its id while it moves, so its cells and the
 * issues that name them follow it; removing one moves focus to its neighbour. An empty row stays in the form and
 * is not printed.
 */
export default function RepeatableTableEditor({
  item,
  rows,
  ast,
  language,
  currency,
  onChange,
  errorOf,
  isMissing,
  handEditedNote,
}: RepeatableTableEditorProps) {
  const label = item.label
  const headingId = useId()
  const [announcement, setAnnouncement] = useState('')
  const { root, request } = useFocusRequest<HTMLFieldSetElement>()
  const atLimit = rows.length >= MAX_ROWS

  const add = () => {
    if (atLimit) return
    const id = newRowId()
    request(id, 'cell')
    onChange([...rows, { id, cells: {} }])
  }
  const remove = (index: number) => {
    const neighbour = rows[index + 1] ?? rows[index - 1]
    request(neighbour?.id ?? null, neighbour ? 'cell' : 'add')
    onChange(rows.filter((_, at) => at !== index))
    setAnnouncement(t.table.removedLive)
  }
  const move = (index: number, by: -1 | 1, control: 'up' | 'down') => {
    const to = index + by
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    ;[next[index], next[to]] = [next[to]!, next[index]!]
    request(rows[index]!.id, control)
    onChange(next)
  }
  const setCell = (rowId: string, column: string, value: string | number) => {
    onChange(
      rows.map((row) => {
        if (row.id !== rowId) return row
        const cells = { ...row.cells }
        if (value === '') delete cells[column]
        else cells[column] = value
        return { ...row, cells }
      }),
    )
  }

  /** A column as the field control it is: named as an issue names it, optional unless a cost line needs it. */
  const cellItem = (rowId: string, column: TableItemDecl['columns'][number]): FieldItem => ({
    type: 'field',
    name: `${item.name}#${rowId}.${column.name}`,
    label: column.label,
    hint: null,
    example: null,
    kind: column.kind,
    default: null,
    options: ast.fields.find((field) => field.name === column.name)?.options ?? null,
    optional: !column.required,
    derived: false,
    system: null,
    fills: [],
    handEditedIn: [],
  })

  return (
    <fieldset
      ref={root}
      className="field m-0 min-w-0 border-0 p-0"
      data-wizard-field={item.name}
      id={controlId(item.name)}
    >
      <legend id={headingId} className="field-label">
        <TemplateText language={language}>{label}</TemplateText>
        {item.optional ? (
          <>
            {' '}
            <Badge tone="muted">{t.field.optional}</Badge>
          </>
        ) : (
          <span aria-hidden="true" className="field-required">
            *
          </span>
        )}
      </legend>
      {item.hint ? (
        <p className="field-hint">
          <TemplateText language={language}>{item.hint}</TemplateText>
        </p>
      ) : null}
      {handEditedNote ? (
        <p className="field-hint">
          <Icon name="info" /> {handEditedNote}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-soft">{t.table.empty}</p> : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row, index) => (
          <li key={row.id} data-item-key={row.id}>
            <div role="group" aria-label={t.table.row(index + 1)} className="rounded-md border border-rule bg-ink p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex-1 text-xs text-soft">{t.table.row(index + 1)}</span>
                <Button
                  variant="ghost"
                  iconOnly
                  data-control="up"
                  aria-label={t.table.up(index + 1, label)}
                  disabled={index === 0}
                  onClick={() => move(index, -1, 'up')}
                >
                  <Icon name="arrow-up" />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  data-control="down"
                  aria-label={t.table.down(index + 1, label)}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1, 'down')}
                >
                  <Icon name="arrow-down" />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={t.table.removeNamed(index + 1, label)}
                  onClick={() => remove(index)}
                >
                  <Icon name="trash" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {item.columns.map((column) => {
                  const field = cellItem(row.id, column)
                  return (
                    <FieldInput
                      key={column.name}
                      item={field}
                      value={row.cells[column.name]}
                      language={language}
                      currency={currency}
                      error={errorOf(field.name)}
                      missing={isMissing(field.name)}
                      onChange={(value) => setCell(row.id, column.name, value)}
                    />
                  )
                })}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          data-control="add"
          aria-disabled={atLimit ? true : undefined}
          onClick={atLimit ? undefined : add}
        >
          <Icon name="plus" /> {t.table.addRow}
        </Button>
        {atLimit ? <span className="text-xs text-soft">{t.table.limit}</span> : null}
      </div>
      <VisuallyHidden live>{announcement}</VisuallyHidden>
    </fieldset>
  )
}
