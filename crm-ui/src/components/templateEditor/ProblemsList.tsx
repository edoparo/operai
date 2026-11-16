import { useId, type Ref } from 'react'
import { Button, Card, Icon } from '@operai/ui'
import type { Problem } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'
import { problemMessage } from './problemMessage'

const w = strings.templates.wizardEditor

export interface ProblemsListProps {
  problems: readonly Problem[]
  /** Moves the caret to the problem's line in the text. */
  onSelect: (problem: Problem) => void
  /** The heading takes focus when Save is refused or "go to problems" is chosen. */
  headingRef: Ref<HTMLHeadingElement>
}

/**
 * The problems of the text (design S13; AC-8.3): one button per problem — severity as an icon and a word, the line
 * and what is wrong — and a summary that says "No problems" or how many. Warnings are listed but never block Save.
 */
export default function ProblemsList({ problems, onSelect, headingRef }: ProblemsListProps) {
  const headingId = useId()
  const errors = problems.filter((problem) => problem.severity === 'error').length
  const warnings = problems.length - errors

  return (
    <Card aria-labelledby={headingId} data-testid="crm-template-problems">
      <div className="card-header">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="card-title">
          {w.problems}
        </h3>
      </div>
      <div className="flex flex-col gap-2">
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-text">
          {problems.length === 0 ? (
            <>
              <span className="text-grn-text">
                <Icon name="check-circle" />
              </span>
              {w.noProblems}
            </>
          ) : (
            w.problemsSummary(errors, warnings)
          )}
        </p>
        {problems.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {problems.map((problem) => (
              <li key={`${problem.line}:${problem.code}:${problem.name ?? ''}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-left"
                  onClick={() => onSelect(problem)}
                >
                  <span className={problem.severity === 'error' ? 'text-red-text' : 'text-org-text'}>
                    <Icon name={problem.severity === 'error' ? 'x-circle' : 'alert'} />
                  </span>
                  <span>{problem.severity === 'error' ? w.error : w.warning}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{w.line(problem.line)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{problemMessage(problem)}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  )
}
