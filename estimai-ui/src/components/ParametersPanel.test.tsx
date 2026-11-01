/**
 * @vitest-environment jsdom
 *
 * ParametersPanel's parameters are labelled controls in library Fields
 * (INC-16): each number input is reachable by its label and described by its
 * hint. They are quantities, not money, so they stay type="number" (INC-17).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ParametersPanel from './ParametersPanel'
import { DEF_PARAMS } from '../lib/projects'

afterEach(cleanup)

describe('ParametersPanel', () => {
  it('labels every parameter input and describes it by its hint', () => {
    render(<ParametersPanel params={{ ...DEF_PARAMS }} onUpdate={vi.fn()} />)

    const input = screen.getByLabelText('AI cost coefficient') as HTMLInputElement
    expect(input.type).toBe('number')
    const hintId = input.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    expect(document.getElementById(hintId!)?.textContent).toContain('Cost per FTE per elapsed day')

    expect(screen.getByLabelText('Parallelism factor')).toBeDefined()
    expect(screen.getByLabelText('AI productivity gain')).toBeDefined()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(8)
  })

  it('passes the edited value to onUpdate with its parameter name', () => {
    const onUpdate = vi.fn()
    render(<ParametersPanel params={{ ...DEF_PARAMS }} onUpdate={onUpdate} />)

    fireEvent.change(screen.getByLabelText('Sprint duration (working days)'), { target: { value: '15' } })
    expect(onUpdate).toHaveBeenCalledWith('sprintDays', '15')
  })

  it('renders in Italian when the document language is Italian (INC-25: the library resolves the locale once)', async () => {
    document.documentElement.lang = 'it'
    try {
      vi.resetModules()
      const { default: ItalianPanel } = await import('./ParametersPanel')
      render(<ItalianPanel params={{ ...DEF_PARAMS }} onUpdate={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2, name: 'Parametri del modello' })).toBeDefined()
      expect(screen.getByLabelText('Coefficiente di costo AI')).toBeDefined()
      expect(screen.getByLabelText('Durata dello sprint (giorni lavorativi)')).toBeDefined()
      expect(screen.queryByText('Model parameters')).toBeNull()
    } finally {
      document.documentElement.lang = ''
      vi.resetModules()
    }
  })

  it('makes every input read-only (not disabled) for a viewer', () => {
    render(<ParametersPanel params={{ ...DEF_PARAMS }} onUpdate={vi.fn()} readOnly />)
    for (const input of screen.getAllByRole('spinbutton') as HTMLInputElement[]) {
      expect(input.readOnly).toBe(true)
      expect(input.disabled).toBe(false)
    }
  })
})
