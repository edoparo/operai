import { useState, type ReactNode } from 'react'
import { Badge, Button, Icon, VisuallyHidden } from '@operai/ui'
import type { OfferLanguage } from '../../lib/offerEngine/answers'
import type { OutlineItem } from '../../lib/offerEngine/outline'
import { strings } from '../../strings'
import { controlId } from './controlId'
import TemplateText from './TemplateText'
import { useFocusRequest } from './useFocusRequest'

const t = strings.offerWizard

export type ListItemDecl = Extract<OutlineItem, { type: 'list' }>

/** Caps of the answers (plan § Offer draft): 50 items of at most 2 000 characters. */
const MAX_LIST_ITEMS = 50
const MAX_ITEM_CHARS = 2_000

let keySeed = 0
const newKey = (): string => `k${++keySeed}`

export interface ListFieldEditorProps {
  item: ListItemDecl
  items: readonly string[]
  language: OfferLanguage
  onChange: (next: string[]) => void
  /** The resolver would print the list and it has no item. Shown as "Required" once the person has left it. */
  missing?: boolean
  handEditedNote?: string
  /** Overrides of the answers' caps where a list has its own (the client block: 8 lines of 200 characters). */
  maxItems?: number
  maxChars?: number
  /** Items that cannot be removed (the client block keeps one line: the server refuses a draft with none). */
  minItems?: number
  limitText?: string
}

/**
 * A list field (AC-1.7): one input per item with labelled icon buttons to move it up or down and to remove it, and
 * Add. Items keep a key of their own while they move, so focus stays with the item the person moved; removing
 * one moves focus to its neighbour. An empty item stays in the form and is simply not printed (the engine
 * drops it).
 */
export default function ListFieldEditor({
  item,
  items,
  language,
  onChange,
  missing = false,
  handEditedNote,
  maxItems = MAX_LIST_ITEMS,
  maxChars = MAX_ITEM_CHARS,
  minItems = 0,
  limitText = t.list.limit,
}: ListFieldEditorProps) {
  const label = item.label
  const [keys, setKeys] = useState<string[]>(() => items.map(newKey))
  const [announcement, setAnnouncement] = useState('')
  const [touched, setTouched] = useState(false)
  const { root, request } = useFocusRequest<HTMLFieldSetElement>()
  // the answers can change under the editor (a reload, a reconcile): then the keys fall back to positions
  const rowKeys = keys.length === items.length ? keys : items.map((_, index) => `p${index}`)

  const commit = (nextItems: string[], nextKeys: string[], key: string | null, control: string) => {
    setKeys(nextKeys)
    request(key, control)
    onChange(nextItems)
  }

  const add = () => {
    if (items.length >= maxItems) return
    const key = newKey()
    commit([...items, ''], [...rowKeys, key], key, 'input')
  }
  const atFloor = items.length <= minItems
  const remove = (index: number) => {
    if (atFloor) return
    const neighbour = rowKeys[index + 1] ?? rowKeys[index - 1] ?? null
    commit(
      items.filter((_, at) => at !== index),
      rowKeys.filter((_, at) => at !== index),
      neighbour,
      neighbour === null ? 'add' : 'input',
    )
    setAnnouncement(t.list.removedLive)
  }
  const move = (index: number, by: -1 | 1, control: 'up' | 'down') => {
    const to = index + by
    if (to < 0 || to >= items.length) return
    const nextItems = [...items]
    const nextKeys = [...rowKeys]
    ;[nextItems[index], nextItems[to]] = [nextItems[to]!, nextItems[index]!]
    ;[nextKeys[index], nextKeys[to]] = [nextKeys[to]!, nextKeys[index]!]
    commit(nextItems, nextKeys, rowKeys[index]!, control)
  }
  const edit = (index: number, text: string) => {
    onChange(items.map((current, at) => (at === index ? text : current)))
  }

  const atLimit = items.length >= maxItems
  const legend: ReactNode = (
    <>
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
    </>
  )

  return (
    <fieldset
      ref={root}
      className="field m-0 min-w-0 border-0 p-0"
      data-wizard-field={item.name}
      id={controlId(item.name)}
    >
      <legend className="field-label">{legend}</legend>
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
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((text, index) => (
          <li key={rowKeys[index]} data-item-key={rowKeys[index]} className="flex items-center gap-2">
            <input
              type="text"
              className="min-w-0 flex-1"
              aria-label={t.list.item(index + 1, label)}
              maxLength={maxChars}
              value={text}
              onChange={(event) => edit(index, event.target.value)}
              onBlur={() => setTouched(true)}
            />
            <Button
              variant="ghost"
              iconOnly
              data-control="up"
              aria-label={t.list.up(index + 1, label)}
              disabled={index === 0}
              onClick={() => move(index, -1, 'up')}
            >
              <Icon name="arrow-up" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              data-control="down"
              aria-label={t.list.down(index + 1, label)}
              disabled={index === items.length - 1}
              onClick={() => move(index, 1, 'down')}
            >
              <Icon name="arrow-down" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              aria-label={t.list.remove(index + 1, label)}
              aria-disabled={atFloor ? true : undefined}
              onClick={() => remove(index)}
            >
              <Icon name="trash" />
            </Button>
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
          <Icon name="plus" /> {t.list.add}
        </Button>
        {atLimit ? <span className="text-xs text-soft">{limitText}</span> : null}
      </div>
      {missing && touched ? <p className="field-error">{t.invalid.required}</p> : null}
      <VisuallyHidden live>{announcement}</VisuallyHidden>
    </fieldset>
  )
}
