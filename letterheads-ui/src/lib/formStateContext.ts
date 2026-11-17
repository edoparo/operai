/**
 * What the form's controls read from the page that owns the reducer (task T21): the catalog, `dispatch`,
 * the problems at a pointer and the polite announcement line. A control is given its slice of the
 * configuration as props and its pointer; it never holds state of its own beyond the text of a number.
 */
import { createContext, useContext } from 'react'
import type { Dispatch } from 'react'
import type { FormAction } from './formState'
import type { FormCatalog, Problem } from './formStateTypes'

export interface FormContextValue {
  catalog: FormCatalog
  dispatch: Dispatch<FormAction>
  /** The problems the service reported for the value at `pointer`. */
  problemsAt: (pointer: string) => readonly Problem[]
  /** The sentence for a problem (T24 replaces the generic one with the words of `fieldPath`). */
  describeProblem: (problem: Problem) => string
  /** Says `message` in the page's polite live region ("Line removed"). */
  announce: (message: string) => void
  /**
   * A write of the form (an upload) was refused with 403: the person's grant changed, so the page turns
   * read-only (design F7.5, F10, F11; T24). Absent where nothing reacts to it (the form's own tests).
   */
  accessLost?: () => void
}

export const FormContext = createContext<FormContextValue | null>(null)

export function useForm(): FormContextValue {
  const value = useContext(FormContext)
  if (value === null) throw new Error('useForm must be used inside the configurator form')
  return value
}

/** The error text of the control at `pointer`, or `undefined` when nothing is refused there. */
export function useFieldError(path: string): string | undefined {
  const { problemsAt, describeProblem } = useForm()
  const problems = problemsAt(path)
  return problems.length === 0 ? undefined : problems.map(describeProblem).join(' ')
}
