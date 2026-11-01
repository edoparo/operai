import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from '../components/Card'
import { RadioGroupField } from '../components/Field'
import { LOCALES, catalogGaps, resolveLocale, selectStrings } from '../lib/i18n'
import type { Locale } from '../lib/i18n'

/**
 * The suite speaks English and Italian. Each app keeps its copy in a strings
 * module with one catalog per language, the Italian typed as the English, and
 * picks the person's catalog once with `selectStrings`. `resolveLocale()`
 * reads `<html lang>` (set by the shell), then the browser's preferred
 * languages, else English. `catalogGaps(en, it)` is the parity check each
 * app's test runs: `[]` means the translation is complete.
 */
const meta: Meta = {
  title: 'Foundations/Languages',
  parameters: { controls: { disable: true } },
}
export default meta

const en = {
  heading: 'Items',
  newItem: 'New item',
  count: (n: number) => (n === 1 ? '1 item' : `${n} items`),
}

const it: typeof en = {
  heading: 'Articoli',
  newItem: 'Nuovo articolo',
  count: (n: number) => (n === 1 ? '1 articolo' : `${n} articoli`),
}

// A deliberately incomplete translation, to show what catalogGaps reports.
const itIncomplete = { heading: 'Articoli', newItem: '', count: 'articoli', extra: 'Altro' }

function SelectStringsDemo() {
  const [locale, setLocale] = useState<Locale>('en')
  const strings = selectStrings({ en, it }, locale)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card title="selectStrings({ en, it }, locale)">
        <RadioGroupField label="Language">
          {LOCALES.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="story-locale"
                value={option}
                checked={locale === option}
                onChange={() => setLocale(option)}
              />
              {option === 'en' ? 'English' : 'Italiano'}
            </label>
          ))}
        </RadioGroupField>
        <dl className="fact-list">
          <div>
            <dt>strings.heading</dt>
            <dd>{strings.heading}</dd>
          </div>
          <div>
            <dt>strings.newItem</dt>
            <dd>{strings.newItem}</dd>
          </div>
          <div>
            <dt>strings.count(3)</dt>
            <dd>{strings.count(3)}</dd>
          </div>
        </dl>
      </Card>
      <pre className="overflow-x-auto rounded-md border border-rule bg-ink-soft p-3 font-mono text-xs">
        {`const en = { heading: 'Items', count: (n: number) => … }
const it: typeof en = { heading: 'Articoli', count: (n: number) => … }
export const strings = selectStrings({ en, it })`}
      </pre>
    </div>
  )
}

export const SelectStrings: StoryObj = {
  name: 'selectStrings',
  render: () => <SelectStringsDemo />,
}

export const CatalogGaps: StoryObj = {
  name: 'catalogGaps',
  render: () => {
    const complete = catalogGaps(en, it)
    const gaps = catalogGaps(en, itIncomplete)
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <Card title="A complete translation">
          <code className="font-mono text-xs">catalogGaps(en, it)</code>
          <p className="text-sm">{complete.length === 0 ? '[] — nothing missing' : complete.join(', ')}</p>
        </Card>
        <Card title="An incomplete translation">
          <code className="font-mono text-xs">catalogGaps(en, itIncomplete)</code>
          <ul className="list-disc pl-5 font-mono text-xs">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </Card>
      </div>
    )
  },
}

export const ResolveLocale: StoryObj = {
  name: 'resolveLocale',
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card title="In this Storybook">
        <dl className="fact-list">
          <div>
            <dt>resolveLocale()</dt>
            <dd className="font-mono">{resolveLocale()}</dd>
          </div>
          <div>
            <dt>{'<html lang>'}</dt>
            <dd className="font-mono">{document.documentElement.lang || '(not set)'}</dd>
          </div>
          <div>
            <dt>LOCALES</dt>
            <dd className="font-mono">{LOCALES.join(', ')}</dd>
          </div>
        </dl>
      </Card>
      <p className="text-sm text-soft">
        Order: <code className="font-mono">{'<html lang>'}</code> when the shell has set it, then the first of{' '}
        <code className="font-mono">navigator.languages</code> the suite has, then English. Resolve once, at the app
        level; components never detect the language on their own.
      </p>
    </div>
  ),
}
