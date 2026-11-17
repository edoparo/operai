/**
 * The preview pane of the configurator (task T22; design S1, S7, F3, F4): the sample document drawn by the
 * service on the form as it is now, in `PagePreview`. It shows
 * - one sentence saying the company data is sample data (AC-8.5);
 * - the preview language, a viewing choice that is not saved (F4, AC-5.8);
 * - the pages, each a figure with its "Page N of M" alt and its text (AC-8.6);
 * - a polite notice, no summary, when the form holds refused values (info) or the preview could not be
 *   made (warning, with Try again). Neither moves focus; the form stays usable and Save stays available.
 * The same component is the wide `aside` and the body of the narrow Drawer; both read one request.
 */
import { useId } from 'react'
import { Banner, PagePreview, RadioGroupField } from '@operai/ui'
import type { PagePreviewLabels } from '@operai/ui'
import type { PreviewLanguage, PreviewView } from './PreviewPaneRequest'
import { strings } from '../strings'

const labels = (): PagePreviewLabels => ({
  region: strings.preview.region,
  loading: strings.preview.loading,
  updating: strings.preview.updating,
  failed: strings.preview.failedShort,
  pageCount: strings.preview.pages,
  pageAlt: strings.preview.pageAlt,
})

export interface PreviewPaneProps {
  view: PreviewView
  language: PreviewLanguage
  onLanguage: (language: PreviewLanguage) => void
  onRetry: () => void
  /** The pane's own heading (the wide aside); the Drawer has its title already. */
  heading?: boolean
  className?: string
  testId?: string
}

export function PreviewPane({
  view,
  language,
  onLanguage,
  onRetry,
  heading = false,
  className,
  testId,
}: PreviewPaneProps) {
  const radioName = useId()
  const options: { value: PreviewLanguage; label: string }[] = [
    { value: 'it', label: strings.preview.it },
    { value: 'en', label: strings.preview.en },
  ]
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {heading && <h3 className="m-0 text-base font-semibold text-text">{strings.preview.title}</h3>}
      <p className="m-0 text-sm text-soft" data-testid="letterheads-preview-sample">
        {strings.preview.sample}
      </p>
      <RadioGroupField label={strings.preview.language}>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={radioName}
              data-testid={`letterheads-preview-language-${option.value}`}
              checked={option.value === language}
              onChange={() => onLanguage(option.value)}
            />
            {option.label}
          </label>
        ))}
      </RadioGroupField>
      <PagePreview
        pages={view.pages}
        state={view.state}
        labels={labels()}
        lang={view.lang}
        className={className}
        testId="letterheads-preview"
      >
        {view.refused !== null && (
          <Banner
            tone="info"
            live="off"
            title={strings.problem.previewTitle}
            data-testid="letterheads-preview-refused"
            className="mb-2"
          >
            {strings.problem.previewBody}
          </Banner>
        )}
        {view.failed && (
          <Banner
            tone="warning"
            live="polite"
            title={strings.preview.failedTitle}
            onRetry={onRetry}
            retryLabel={strings.preview.retry}
            retryTestId="letterheads-preview-retry"
            data-testid="letterheads-preview-failed"
            className="mb-2"
          >
            {view.pages.length === 0 ? strings.preview.failedFirstBody : strings.preview.failedBody}
          </Banner>
        )}
      </PagePreview>
    </div>
  )
}
