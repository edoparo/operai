import { Banner, Button, Card, SkeletonRows, VisuallyHidden } from '@operai/ui'
import { RichTextEditor } from '@operai/ui/rich-text'
import type { RichTextDoc } from '@operai/ui/rich-text'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useResource } from '../../hooks/useResource'
import { isStaleWrite } from '../../lib/api'
import { getNotes, saveNotes } from '../../lib/meetingsApi'
import type { Notes, NotesDoc } from '../../lib/types'
import { strings } from '../../strings'

/** The pause in typing after which the notes are saved. */
export const NOTES_DEBOUNCE_MS = 1_000
/** Characters of text at most (the editor stops there; the API bounds the document's size). */
export const NOTES_MAX_CHARS = 20_000
const EMPTY_JSON = 'null'

type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict'

/**
 * NotesCard — the caller's own notes on the meeting, in every status: a WYSIWYG editor (the library's
 * `RichTextEditor`: bold, italic, a heading, lists and checklists) saved by itself a moment
 * after the person stops typing (and when they leave the field or the page). Private: nobody else reads them,
 * not even the meeting's creator, and the AI never does. A save carries the version it last saw, so the same
 * person typing in two tabs gets "saved from another tab" here instead of losing what they wrote there.
 */
export default function NotesCard({ meetingId }: { meetingId: string }) {
  const t = strings.notes
  const fetcher = useCallback((signal: AbortSignal) => getNotes(meetingId, { signal }), [meetingId])
  const resource = useResource(fetcher)
  // Each load (a reload after a conflict included) starts a fresh editor from what the server holds.
  const [loads, setLoads] = useState(0)

  return (
    <Card title={t.title} data-testid="meetings-notes-card">
      {resource.status === 'ready' && resource.data !== null ? (
        <NotesEditor
          key={`${resource.data.version}:${loads}`}
          meetingId={meetingId}
          initial={resource.data}
          onReload={() => {
            setLoads((n) => n + 1)
            resource.retry()
          }}
        />
      ) : resource.status === 'error' ? (
        <Banner tone="warning" onRetry={resource.retry} retryLabel={t.reload}>
          {t.loadFailed}
        </Banner>
      ) : (
        <>
          <VisuallyHidden live>{t.loading}</VisuallyHidden>
          <SkeletonRows rows={3} />
        </>
      )}
    </Card>
  )
}

function NotesEditor({ meetingId, initial, onReload }: { meetingId: string; initial: Notes; onReload: () => void }) {
  const t = strings.notes
  const hintId = useId()
  const [state, setState] = useState<SaveState>('saved')
  const [length, setLength] = useState<number | null>(null)

  // What the server holds and what is on screen, as JSON (a document compares by its text), and the save
  // machinery: refs, so a timer or an unmount reads the latest values.
  const initialJson = initial.content === null ? EMPTY_JSON : JSON.stringify(initial.content)
  const version = useRef(initial.version)
  const savedJson = useRef(initialJson)
  const latest = useRef<{ json: string; doc: NotesDoc | null }>({ json: initialJson, doc: initial.content })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlight = useRef(false)
  const stopped = useRef(false)

  const save = useCallback(async () => {
    clearTimeout(timer.current)
    if (stopped.current || inFlight.current) return
    inFlight.current = true
    try {
      // Typed on while a save was running: save again, until what is on the server is what is on screen.
      while (latest.current.json !== savedJson.current && latest.current.doc !== null) {
        const sending = latest.current
        setState('saving')
        const saved = await saveNotes(meetingId, version.current, sending.doc as NotesDoc)
        version.current = saved.version
        savedJson.current = sending.json
      }
      setState('saved')
    } catch (failure) {
      if (isStaleWrite(failure)) {
        stopped.current = true
        setState('conflict')
      } else {
        setState('failed')
      }
    } finally {
      inFlight.current = false
    }
  }, [meetingId])

  // Leaving the meeting page (or the notes being replaced) saves what is still pending, best effort.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void save()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      void save()
    }
  }, [save])

  const change = (doc: RichTextDoc, textLength: number) => {
    const json = JSON.stringify(doc)
    latest.current = { json, doc: doc as NotesDoc }
    setLength(textLength)
    if (stopped.current) return
    setState(json === savedJson.current ? 'saved' : 'unsaved')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), NOTES_DEBOUNCE_MS)
  }

  const statusText =
    state === 'saving' ? t.status.saving : state === 'unsaved' ? t.status.unsaved : state === 'failed' ? t.status.failed : state === 'saved' ? t.status.saved : ''

  return (
    <div className="flex flex-col gap-2">
      {state === 'conflict' && (
        <Banner tone="warning" title={t.conflict.title} onRetry={onReload} retryLabel={t.reload} data-testid="meetings-notes-conflict">
          {t.conflict.body}
        </Banner>
      )}
      <p id={hintId} className="text-xs text-soft">
        {t.hint}
      </p>
      <RichTextEditor
        initialValue={initial.content as RichTextDoc | null}
        onChange={change}
        onBlur={() => void save()}
        label={t.label}
        describedBy={hintId}
        placeholder={t.placeholder}
        maxLength={NOTES_MAX_CHARS}
        readOnly={state === 'conflict'}
        copy={t.toolbar}
        testIdPrefix="meetings-notes"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-soft">
        <span role="status" aria-live="polite" data-testid="meetings-notes-status">
          {statusText}
        </span>
        {state === 'failed' && (
          <Button size="sm" variant="secondary" onClick={() => void save()} data-testid="meetings-notes-retry">
            {t.retry}
          </Button>
        )}
        {length !== null && <span>{t.count(length, NOTES_MAX_CHARS)}</span>}
      </div>
    </div>
  )
}
