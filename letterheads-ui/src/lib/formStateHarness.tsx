/**
 * A test harness for the form's components (task T21; tests only): the real reducer and the real context
 * around the component under test, so a test drives it with the keyboard and reads the resulting state.
 */
import { useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { createFormState, formReducer, limitsFromCatalog } from './formState'
import type { FormState } from './formState'
import { FormContext } from './formStateContext'
import type { FormContextValue } from './formStateContext'
import { catalogFixture } from './formStateFixtures'
import { readCatalog } from './formStateTypes'
import type { FormConfig, Problem } from './formStateTypes'

export function FormHarness({
  config,
  problems,
  announce,
  children,
}: {
  config?: FormConfig
  /** Problems the form starts with, as if a save had just been refused. */
  problems?: readonly Problem[]
  announce?: (text: string) => void
  children: (state: FormState) => ReactNode
}) {
  const catalog = readCatalog(catalogFixture())!
  const [state, dispatch] = useReducer(formReducer, undefined, () => {
    const initial = createFormState(
      config ?? catalog.defaultConfig,
      limitsFromCatalog(catalog.bounds.maxLinesPerZone, catalog.bounds.lineSizePt, catalog.defaultConfig),
    )
    return problems ? formReducer(initial, { type: 'problemsSet', problems }) : initial
  })
  const context = useMemo<FormContextValue>(
    () => ({
      catalog,
      dispatch,
      problemsAt: (path) => state.problems[path] ?? [],
      describeProblem: () => 'refused',
      announce: announce ?? (() => undefined),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the catalog is a fixture, read once per harness
    [state.problems, announce],
  )
  return <FormContext.Provider value={context}>{children(state)}</FormContext.Provider>
}
