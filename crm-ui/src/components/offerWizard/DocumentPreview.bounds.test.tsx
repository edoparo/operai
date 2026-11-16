/**
 * @vitest-environment jsdom
 *
 * The preview resolves in the browser on every change (specs/20261115-crm-offer-wizard QE D1 / security M-1): a template
 * that repeats a 20 000-character answer 49 000 times must not freeze the tab, so the document it draws is bounded.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DocumentPreview from './DocumentPreview'
import { initialAnswers, type WizardContext } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import answerVectors from '../../lib/offerEngine/vectors/answers.json'

afterEach(cleanup)

const context = answerVectors.context as unknown as WizardContext

const SOURCE = [
  '@@salutation S',
  '@@acceptance C',
  '',
  '## UNO',
  '@@step scope',
  '[D]'.repeat(49_000),
  '',
  '## COSTI',
  '@@step costs',
  '@@costs',
  '@@line a one_off | A | unit=100 | qty=1',
  '@@total **T**',
  '@@end',
  '',
  '@@field D',
  'label: Dd',
].join('\n')

describe('DocumentPreview with an amplifying template', () => {
  it('draws a bounded document without waiting on the amplified text', () => {
    const { ast } = parseTemplate(SOURCE)
    const answers = initialAnswers(ast, context)
    answers.fields.D = 'x'.repeat(20_000)
    const started = performance.now()
    render(<DocumentPreview ast={ast} answers={answers} context={context} />)
    expect(performance.now() - started).toBeLessThan(5_000)
    const text = screen.getByTestId('crm-wizard-preview').textContent ?? ''
    expect(text.length).toBeGreaterThan(1_000)
    expect(text.length).toBeLessThan(100_000)
  })
})
