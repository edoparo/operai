import { RadioGroupField } from '@operai/ui'
import type { OfferLanguage } from '../../lib/offerEngine/answers'
import TemplateText from './TemplateText'

export interface BlockChoiceOption {
  block: string
  label: string
  explain: string | null
  /** What choosing it fills (`Fills: …`), already in words; absent when it fills nothing. */
  fillsNote?: string
}

export interface BlockChoiceProps {
  name: string
  label: string
  language: OfferLanguage
  options: readonly BlockChoiceOption[]
  /** The option that is on: exactly one. */
  selected: string
  onChoose: (block: string) => void
}

/**
 * A choice between blocks (AC-1.4): a radio group, exactly one option on, each with its label, explanation and
 * what it fills. What sits inside an option is NOT nested here: the outline lists it beside the choice (DD-43),
 * and the form places it where the outline says.
 */
export default function BlockChoice({ name, label, language, options, selected, onChoose }: BlockChoiceProps) {
  return (
    <RadioGroupField label={<TemplateText language={language}>{label}</TemplateText>}>
      {options.map((option) => (
        <label key={option.block} className="items-start">
          <input
            type="radio"
            name={`wiz-choice-${name}`}
            data-wizard-field={option.block === selected ? name : undefined}
            checked={option.block === selected}
            onChange={() => onChoose(option.block)}
          />
          <span className="flex flex-col gap-1">
            <span>
              <TemplateText language={language}>{option.label}</TemplateText>
            </span>
            {option.explain ? (
              <span className="text-xs text-soft">
                <TemplateText language={language}>{option.explain}</TemplateText>
              </span>
            ) : null}
            {option.fillsNote ? <span className="text-xs text-soft">{option.fillsNote}</span> : null}
          </span>
        </label>
      ))}
    </RadioGroupField>
  )
}
