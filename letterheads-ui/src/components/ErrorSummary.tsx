import { Banner } from '@operai/ui'
import type { Problem } from '../lib/formStateTypes'
import { strings } from '../strings'

export interface ErrorSummaryProps {
  /** The problems of the refused save, in the order the page shows them. */
  problems: readonly Problem[]
  /** The sentence for a problem, naming the setting in words (`fieldPath.describeProblem`). */
  describe: (problem: Problem) => string
  /** Moves focus to the control of the problem at `path`. */
  onGo: (path: string) => void
}

/**
 * ErrorSummary — the list of what a refused save refused (design F7.3, S4; AC-8.3). An assertive `danger`
 * banner (`role="alert"`: announced once, when it appears) whose title says that nothing was saved and how many
 * values were refused, over a list of buttons, one per problem, each reading "{Setting}: {what to do}" and
 * moving focus to its control. It is the second way in: focus has already gone to the first refused control.
 */
export function ErrorSummary({ problems, describe, onGo }: ErrorSummaryProps) {
  return (
    <Banner
      tone="danger"
      live="assertive"
      title={strings.problem.summaryTitle(problems.length)}
      titleTestId="letterheads-summary-title"
      data-testid="letterheads-summary"
    >
      <p className="m-0">{strings.problem.summaryHint}</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {problems.map((problem, index) => (
          <li key={`${problem.path}|${problem.reason}|${index}`}>
            <button
              type="button"
              className="link cursor-pointer border-0 bg-transparent p-0 text-left text-sm"
              onClick={() => onGo(problem.path)}
              data-testid="letterheads-summary-item"
            >
              {describe(problem)}
            </button>
          </li>
        ))}
      </ul>
    </Banner>
  )
}
