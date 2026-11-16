/**
 * useOfferDraft — the wizard's draft in memory, saved by itself (specs/20261115-crm-offer-wizard AC-6.1, AC-6.3,
 * AC-6.7, AC-8.4; plan DD-7, DD-8, DD-31; design F5, F6, S9).
 *
 * The answers live here, in this page's memory, and nowhere else in the browser (AC-6.7: no web storage, no
 * IndexedDB; `noBrowserStorage.test.ts` scans for it). Every content change is saved to crm-api whole:
 *
 *   - 1 s after the last change, and at most 5 s after the first unsaved one while the person keeps typing;
 *   - one request in flight, always carrying the latest `ETag` the server answered with; a change made meanwhile
 *     waits for it;
 *   - a step change alone saves nothing — the current step rides on the next content save as `lastStep` (DD-31);
 *   - 409 `version_conflict` (or 428) stops autosave for good: the form is read-only until `reload()`;
 *   - 404 `draft_not_found` means someone discarded it or generated the offer: read-only, gone;
 *   - 422 `answers_invalid` / 413 `draft_too_large` pause autosave; the next content change tries again;
 *   - a network failure or a 5xx retries after 2, 4, 8, then every 16 s, with the unsaved changes kept;
 *   - `beforeunload` asks for confirmation while anything is unsaved.
 *
 * A draft whose template was edited since it was saved is reconciled against the template as it is now
 * (`reconcileAnswers`, AC-8.4): answers whose field is gone are dropped, named in `notice`, and the result is saved
 * (with the template's version) so that generating is not refused as `template_changed`.
 *
 * The state is a plain object outside React (`DraftSession`) read through `useSyncExternalStore`: the timers and
 * the in-flight request need the latest values synchronously, which a render-bound closure cannot give them.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ApiError } from '../lib/api'
import {
  createWizardDraft,
  generateWizardDraft,
  getWizardDraft,
  getWizardTemplate,
  saveWizardDraft,
  switchWizardDraftTemplate,
  type GenerateWizardResult,
  type WizardDraftAnswer,
} from '../lib/crmApi'
import { errorMessage } from '../lib/errors'
import { answersInvalidPathOf, answersNulRefused } from '../lib/offerErrors'
import { reconcileAnswers, type WizardAnswers } from '../lib/offerEngine/answers'
import { parseTemplate, type TemplateAst } from '../lib/offerEngine/syntax'
import type { DraftTarget, DraftTargetInput, OfferDraftView, WizardTemplate } from '../lib/types'
import { strings } from '../strings'

/** Autosave waits this long after the last content change… */
export const AUTOSAVE_DEBOUNCE_MS = 1_000
/** …but never longer than this after the first unsaved one, so a long burst of typing still gets saved. */
export const AUTOSAVE_MAX_WAIT_MS = 5_000
/** The waits after a failed save: 2, 4, 8 s, then every 16 s until it goes through. */
export const RETRY_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000] as const
/** After this long without a save the page may say so with a banner (design S9). */
export const RETRY_BANNER_AFTER_MS = 10_000

export type DraftStep = WizardAnswers['lastStep']

/** What autosave is doing. `saved` / `saving` / `retrying` are the header line; the rest are banners and a read-only form. */
export type DraftStatus = 'saved' | 'saving' | 'retrying' | 'conflict' | 'gone' | 'rejected'

/** Why a save was refused and will not be retried by itself. */
export type DraftRejection =
  { kind: 'invalid'; path: string | null; nul: boolean } | { kind: 'tooLarge' } | { kind: 'other'; message: string }

/** The template changed under the draft (F8): what the reconcile dropped, and the hand edits whose section is gone. */
export type TemplateChangedNotice = { dropped: string[]; orphanedEdits: WizardAnswers['orphanedEdits'] }

export type DraftMeta = Omit<OfferDraftView, 'answers'>

export type DraftSnapshot = {
  /** `loading` until the first answer; `none` = the deal has no draft yet; `error`: could not load it or its template. */
  load: 'loading' | 'ready' | 'none' | 'error'
  loadError: unknown
  draft: DraftMeta | null
  answers: WizardAnswers | null
  template: WizardTemplate | null
  ast: TemplateAst | null
  step: DraftStep
  status: DraftStatus
  rejection: DraftRejection | null
  /** `true` once a save has been failing for `RETRY_BANNER_AFTER_MS`. */
  retryingLong: boolean
  /** Instant of the last save the server took (its `updatedAt`), for the status line's title. */
  savedAt: string | undefined
  notice: TemplateChangedNotice | null
  /** Conflict, gone, generating or generated: the form must not take input. */
  readOnly: boolean
  generating: boolean
  /** Something typed has not reached the server: `beforeunload` asks first. */
  pending: boolean
}

export type GenerateOutcome = GenerateWizardResult | { kind: 'unsaved' }

const INITIAL: DraftSnapshot = {
  load: 'loading',
  loadError: null,
  draft: null,
  answers: null,
  template: null,
  ast: null,
  step: 'client',
  status: 'saved',
  rejection: null,
  retryingLong: false,
  savedAt: undefined,
  notice: null,
  readOnly: false,
  generating: false,
  pending: false,
}

/** The answers without `lastStep`: what counts as a content change (DD-31). */
const contentKey = (answers: WizardAnswers): string => JSON.stringify({ ...answers, lastStep: null })

const targetInputOf = (target: DraftTarget): DraftTargetInput =>
  target.kind === 'new' ? { kind: 'new' } : { kind: target.kind, offerId: target.offerId }

type Blocked = null | 'conflict' | 'gone' | 'rejected'

/** A save that failed in a way a later attempt may fix: no answer at all, or the server itself in trouble. */
const isTransient = (error: unknown): boolean =>
  !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 429

export class DraftSession {
  private snapshot: DraftSnapshot = INITIAL
  private readonly listeners = new Set<() => void>()

  // what the server has, and what this page holds
  private view: OfferDraftView | null = null
  private answers: WizardAnswers | null = null
  private step: DraftStep = 'client'
  private template: WizardTemplate | null = null
  private ast: TemplateAst | null = null
  private version = 0
  private templateVersion = 0
  private savedKey = ''
  private savedTemplateVersion = 0
  private savedAt: string | undefined
  private notice: TemplateChangedNotice | null = null
  private load: DraftSnapshot['load'] = 'loading'
  private loadError: unknown = null

  // saving
  private blocked: Blocked = null
  private rejection: DraftRejection | null = null
  private inFlight: Promise<void> | null = null
  private firstDirtyAt: number | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private bannerTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private retryingLong = false
  private generating = false
  private finished = false
  private loadRun = 0
  private abort: AbortController | null = null

  private readonly dealId: string

  constructor(dealId: string) {
    this.dealId = dealId
  }

  // ─── store ─────────────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): DraftSnapshot => this.snapshot

  private publish(): void {
    const dirty = this.isDirty()
    const status: DraftStatus =
      this.blocked ?? (this.retryAttempt > 0 ? 'retrying' : dirty || this.inFlight ? 'saving' : 'saved')
    const readOnly = this.blocked === 'conflict' || this.blocked === 'gone' || this.generating || this.finished
    const { view } = this
    const next: DraftSnapshot = {
      load: this.load,
      loadError: this.loadError,
      draft: view
        ? {
            dealId: view.dealId,
            template: view.template,
            templateVersion: this.templateVersion,
            target: view.target,
            version: this.version,
            updatedBy: view.updatedBy,
            updatedAt: this.savedAt ?? view.updatedAt,
            createdAt: view.createdAt,
          }
        : null,
      answers: this.answers,
      template: this.template,
      ast: this.ast,
      step: this.step,
      status,
      rejection: this.rejection,
      retryingLong: this.retryingLong,
      savedAt: this.savedAt,
      notice: this.notice,
      readOnly,
      generating: this.generating,
      pending: !this.finished && (dirty || this.inFlight !== null),
    }
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  /** Content that is not what the server stored: different answers, or a template version it has not been told. */
  private isDirty(): boolean {
    return (
      this.answers !== null &&
      (contentKey(this.answers) !== this.savedKey || this.templateVersion !== this.savedTemplateVersion)
    )
  }

  // ─── loading ───────────────────────────────────────────────────────────────

  /** Reads the deal's draft and its template. Safe to call again (strict mode, `reload`). */
  start(): void {
    this.abort?.abort()
    this.abort = new AbortController()
    this.finished = false
    void this.read(this.abort.signal)
  }

  private async read(signal: AbortSignal): Promise<void> {
    const run = ++this.loadRun
    try {
      const answer = await getWizardDraft(this.dealId, { signal })
      const template = await getWizardTemplate(answer.draft.template.id, { signal })
      if (signal.aborted || run !== this.loadRun) return
      this.adopt(answer.draft, template)
      this.load = 'ready'
      this.loadError = null
    } catch (error) {
      if (signal.aborted || run !== this.loadRun) return
      if (error instanceof ApiError && error.status === 404 && error.code === 'draft_not_found') {
        this.load = 'none'
        this.loadError = null
        this.clearDraft()
      } else {
        this.load = 'error'
        this.loadError = error
      }
    }
    this.publish()
  }

  /** The draft's template can be read when the deal's draft is: a template archived since is still there. */
  private adopt(view: OfferDraftView, template: WizardTemplate): void {
    this.clearTimers()
    this.ast = parseTemplate(template.source).ast
    this.template = template
    this.view = view
    this.version = view.version
    this.step = view.answers.lastStep
    this.savedAt = view.updatedAt
    this.blocked = null
    this.rejection = null
    this.retryAttempt = 0
    this.retryingLong = false
    this.firstDirtyAt = null
    this.notice = null
    this.finished = false
    this.generating = false
    this.savedKey = contentKey(view.answers)
    this.savedTemplateVersion = view.templateVersion
    this.templateVersion = view.templateVersion
    this.answers = view.answers
    if (template.version !== view.templateVersion) {
      // The template was edited since this draft was saved (AC-8.4): keep what still exists, say what went, and save
      // the result against the template's version, so that generating is not refused as `template_changed`.
      const { answers, dropped } = reconcileAnswers(this.ast, view.answers)
      this.answers = answers
      this.templateVersion = template.version
      this.notice = { dropped, orphanedEdits: answers.orphanedEdits }
      this.schedule()
    }
  }

  private clearDraft(): void {
    this.clearTimers()
    this.view = null
    this.answers = null
    this.template = null
    this.ast = null
    this.notice = null
    this.blocked = null
    this.rejection = null
    this.retryAttempt = 0
    this.retryingLong = false
    this.savedKey = ''
  }

  /** Throws the unsaved changes away and takes the server's draft (the banner's **Reload draft**, F6). */
  async reload(): Promise<void> {
    this.abort?.abort()
    this.abort = new AbortController()
    this.load = 'loading'
    this.loadError = null
    this.publish()
    await this.read(this.abort.signal)
  }

  // ─── content ───────────────────────────────────────────────────────────────

  /** A content change: kept in memory, saved by the timers below. Ignored while the form is read-only. */
  setAnswers = (update: WizardAnswers | ((current: WizardAnswers) => WizardAnswers)): void => {
    if (!this.answers || this.snapshot.readOnly) return
    this.answers = typeof update === 'function' ? update(this.answers) : update
    if (this.blocked === 'rejected') {
      // "The next content change retries" (design S9).
      this.blocked = null
      this.rejection = null
    }
    if (this.isDirty()) {
      this.schedule()
    } else if (!this.inFlight) {
      // Typed back to what the server has: nothing is waiting to be saved.
      this.clearTimers()
      this.retryAttempt = 0
      this.retryingLong = false
      this.firstDirtyAt = null
    }
    this.publish()
  }

  /** Moves to a step. It saves nothing by itself: the step travels with the next content save (DD-31). */
  setStep = (step: DraftStep): void => {
    if (this.step === step) return
    this.step = step
    this.publish()
  }

  dismissNotice = (): void => {
    this.notice = null
    this.publish()
  }

  // ─── saving ────────────────────────────────────────────────────────────────

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
    this.debounceTimer = this.retryTimer = this.bannerTimer = null
  }

  /** Arms the debounce: 1 s from now, but no later than 5 s after the first unsaved change. */
  private schedule(): void {
    if (this.blocked === 'conflict' || this.blocked === 'gone' || this.finished) return
    if (this.retryTimer) return // a retry is already waiting and will carry the latest changes
    const now = Date.now()
    this.firstDirtyAt ??= now
    const delay = Math.min(AUTOSAVE_DEBOUNCE_MS, Math.max(0, this.firstDirtyAt + AUTOSAVE_MAX_WAIT_MS - now))
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.send()
    }, delay)
  }

  /** One save of what is in memory now, if there is something to save. Resolves when the attempt is over. */
  private async send(): Promise<void> {
    if (this.inFlight) return this.inFlight // the change made meanwhile is scheduled again when it lands
    const { view } = this
    if (!view || !this.answers || this.blocked === 'conflict' || this.blocked === 'gone' || this.finished) return
    if (!this.isDirty()) {
      this.clearTimers()
      this.retryAttempt = 0
      this.retryingLong = false
      this.publish()
      return
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.debounceTimer = this.retryTimer = null
    this.firstDirtyAt = null

    const sent = { ...this.answers, lastStep: this.step }
    const sentKey = contentKey(sent)
    const sentTemplateVersion = this.templateVersion
    const attempt = (async () => {
      try {
        const { draft } = await saveWizardDraft(this.dealId, this.version, {
          templateVersion: sentTemplateVersion,
          target: targetInputOf(view.target),
          answers: sent,
        })
        this.version = draft.version
        this.savedKey = sentKey
        this.savedTemplateVersion = sentTemplateVersion
        this.savedAt = draft.updatedAt
        this.view = { ...view, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt }
        this.blocked = null
        this.rejection = null
        this.retryAttempt = 0
        this.retryingLong = false
        if (this.bannerTimer) clearTimeout(this.bannerTimer)
        this.bannerTimer = null
      } catch (error) {
        this.failed(error)
      }
    })()
    this.inFlight = attempt
    this.publish()
    await attempt
    this.inFlight = null
    // Typed while the request was out: it goes next.
    if (this.isDirty() && !this.blocked) this.schedule()
    this.publish()
  }

  private failed(error: unknown): void {
    if (isTransient(error)) {
      this.retryAttempt += 1
      const wait = RETRY_BACKOFF_MS[Math.min(this.retryAttempt - 1, RETRY_BACKOFF_MS.length - 1)]!
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.send()
      }, wait)
      this.bannerTimer ??= setTimeout(() => {
        this.retryingLong = true
        this.publish()
      }, RETRY_BANNER_AFTER_MS)
      return
    }
    this.retryAttempt = 0
    this.noteRefusal(error)
  }

  /** A refusal that retrying cannot fix: the page says which. */
  private noteRefusal(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.status === 428 || (error.status === 409 && error.code === 'version_conflict')) {
        this.blocked = 'conflict'
        return
      }
      if (error.status === 404 && error.code === 'draft_not_found') {
        this.blocked = 'gone'
        return
      }
      this.blocked = 'rejected'
      this.rejection =
        error.status === 413
          ? { kind: 'tooLarge' }
          : error.code === 'answers_invalid'
            ? { kind: 'invalid', path: answersInvalidPathOf(error), nul: answersNulRefused(error) }
            : { kind: 'other', message: errorMessage(error) }
      return
    }
    this.blocked = 'rejected'
    this.rejection = { kind: 'other', message: errorMessage(error) }
  }

  /**
   * Saves what is waiting now, once, and says whether the server then has everything. A network failure is not
   * waited through (the status line says it is retrying): the caller — a generate, a template switch — stops.
   */
  async flush(): Promise<boolean> {
    for (let round = 0; round < 3; round += 1) {
      if (this.inFlight) await this.inFlight
      if (!this.isDirty()) return true
      if (this.blocked) return false
      await this.send()
      if (this.retryAttempt > 0) return false
    }
    return !this.isDirty()
  }

  /** Called when the page goes away: saves what is left without waiting for the debounce. */
  dispose(): void {
    this.abort?.abort()
    this.loadRun += 1
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
    this.debounceTimer = this.retryTimer = this.bannerTimer = null
    if (this.isDirty() && !this.inFlight && !this.blocked && !this.finished) void this.send()
  }

  // ─── actions that change the draft on the server ───────────────────────────

  /** The server refused a write on the draft's version: stale, or the draft is gone. Rethrows everything. */
  private guard(error: unknown): never {
    if (error instanceof ApiError) {
      if (error.status === 428 || (error.status === 409 && error.code === 'version_conflict')) this.blocked = 'conflict'
      else if (error.status === 404 && error.code === 'draft_not_found') this.blocked = 'gone'
      this.publish()
    }
    throw error
  }

  private async adoptAnswer(answer: WizardDraftAnswer): Promise<OfferDraftView> {
    const template = await getWizardTemplate(answer.draft.template.id)
    this.adopt(answer.draft, template)
    this.load = 'ready'
    this.loadError = null
    this.publish()
    return answer.draft
  }

  /** Starts the deal's draft (`If-None-Match: *`): 409 `draft_exists` and the others reach the caller as `ApiError`. */
  async create(input: { templateId?: string; target?: DraftTargetInput }): Promise<OfferDraftView> {
    return this.adoptAnswer(await createWizardDraft(this.dealId, input))
  }

  /**
   * Moves the draft to another template (AC-6.5). What was typed is saved first; when it cannot be, nothing is
   * switched and `false` says so (the status line says why).
   */
  async switchTemplate(templateId: string): Promise<boolean> {
    this.generating = true
    this.publish()
    try {
      if (!(await this.flush())) return false
      try {
        await this.adoptAnswer(await switchWizardDraftTemplate(this.dealId, this.version, templateId))
      } catch (error) {
        this.guard(error)
      }
      return true
    } finally {
      this.generating = false
      this.publish()
    }
  }

  /**
   * Generates the offer from the STORED draft: what was typed is saved first, so the stored draft is what the
   * person sees. `unsaved` = it could not be saved, nothing was sent. 422 `offer_incomplete` comes back typed.
   */
  async generate(): Promise<GenerateOutcome> {
    this.generating = true
    this.publish()
    try {
      if (!(await this.flush())) return { kind: 'unsaved' }
      let outcome: GenerateWizardResult
      try {
        outcome = await generateWizardDraft(this.dealId, this.version)
      } catch (error) {
        this.guard(error)
      }
      if (outcome.kind === 'generated') {
        // The draft is gone with the offer made from it: nothing more to save.
        this.finished = true
        this.clearTimers()
      }
      return outcome
    } finally {
      this.generating = false
      this.publish()
    }
  }
}

export type UseOfferDraft = DraftSnapshot & {
  setAnswers: DraftSession['setAnswers']
  setStep: DraftSession['setStep']
  dismissNotice: () => void
  reload: () => Promise<void>
  create: DraftSession['create']
  switchTemplate: DraftSession['switchTemplate']
  generate: DraftSession['generate']
  flush: DraftSession['flush']
}

/** The one draft of a deal, loaded and autosaved. The page owns what to show for each `load`, `status` and `notice`. */
export function useOfferDraft(dealId: string): UseOfferDraft {
  const session = useMemo(() => new DraftSession(dealId), [dealId])
  useEffect(() => {
    session.start()
    return () => session.dispose()
  }, [session])
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)

  // "Changes are still being saved": the browser asks before closing the tab or leaving the site.
  const { pending } = snapshot
  useEffect(() => {
    if (!pending) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = strings.offerWizard.save.leave
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pending])

  return {
    ...snapshot,
    setAnswers: session.setAnswers,
    setStep: session.setStep,
    dismissNotice: session.dismissNotice,
    reload: () => session.reload(),
    create: (input) => session.create(input),
    switchTemplate: (templateId) => session.switchTemplate(templateId),
    generate: () => session.generate(),
    flush: () => session.flush(),
  }
}
