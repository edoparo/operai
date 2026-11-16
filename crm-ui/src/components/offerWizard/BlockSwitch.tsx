import { useId, type ReactNode } from 'react'
import type { OfferLanguage } from '../../lib/offerEngine/answers'
import { controlId } from './controlId'
import TemplateText from './TemplateText'

export interface BlockSwitchProps {
  name: string
  label: string
  explain: string | null
  language: OfferLanguage
  on: boolean
  /** What switching it on fills (`Fills: …`), already in words. */
  fillsNote?: string
  onChange: (on: boolean) => void
  /** The fields used only inside the block; present only while it is on. */
  children?: ReactNode
}

/**
 * An optional block as a switch (AC-1.4, AC-1.5): a checkbox card with the block's label and explanation, and,
 * while it is on, the fields that exist only for it, nested under it. Off, those fields are not in the DOM.
 */
export default function BlockSwitch({
  name,
  label,
  explain,
  language,
  on,
  fillsNote,
  onChange,
  children,
}: BlockSwitchProps) {
  const groupId = useId()
  const hasChildren = on && children !== undefined && children !== null && children !== false
  return (
    <div className="rounded-md border border-rule p-3">
      <label className="flex items-start gap-3">
        <input
          id={controlId(name)}
          type="checkbox"
          className="mt-1"
          data-wizard-field={name}
          checked={on}
          aria-expanded={on}
          aria-controls={hasChildren ? groupId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm text-text">
            <TemplateText language={language}>{label}</TemplateText>
          </span>
          {explain ? (
            <span className="text-xs text-soft">
              <TemplateText language={language}>{explain}</TemplateText>
            </span>
          ) : null}
          {fillsNote ? <span className="text-xs text-soft">{fillsNote}</span> : null}
        </span>
      </label>
      {hasChildren ? (
        <div id={groupId} className="ml-6 mt-3 flex flex-col gap-4 border-l-2 border-acc/45 pl-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}
