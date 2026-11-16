/**
 * crmApi — typed calls for every crm-api route of specs/20261101-crm/plan.md
 * § API contract, plus the directory read on `auth`. Mutations of an existing
 * company, contact or deal pass the record's `version` (sent as `If-Match`).
 */
import { getAuthBaseUrl, getCrmApiBaseUrl } from 'shell/session'
import { getJson, ifMatch, query, requestAnswered, requestJson, sendJson } from './api'
import { isPdfBytes, MAX_LETTERHEAD_BYTES } from './letterhead/renderLetterhead'
import { offerIncompleteOf } from './offerErrors'
import type {
  Company,
  CompanyStatus,
  CompanySummary,
  Contact,
  ContactSummary,
  Currency,
  Attachment,
  Deal,
  DealStage,
  DealSummary,
  DirectoryUser,
  Entity,
  EntityProfile,
  LeadSource,
  Offer,
  OfferDraft,
  OfferForm,
  OfferSection,
  OfferTemplate,
  OfferTemplateContent,
  OfferTemplateRow,
  OfferDraftSummary,
  OfferDraftView,
  OfferIncomplete,
  DraftTargetInput,
  WizardContextResponse,
  WizardTemplate,
  WizardTemplateInput,
  CostColumns,
  CostKind,
  Page,
  PageQuery,
  PersonRef,
  Pipeline,
  Scope,
} from './types'

type Init = { signal?: AbortSignal }
export type ArchivedFilter = 'false' | 'true' | 'all'

// ─── Scope ──────────────────────────────────────────────────────────────────

export const getScope = (init?: Init) => getJson<Scope>('/scope', init)

// ─── Companies ──────────────────────────────────────────────────────────────

/** A list's order (specs/20261101-crm US-9): the server sorts, so the order covers every page. */
export type ListOrder<S extends string> = { sort?: S; order?: 'asc' | 'desc' }
export type CompanySort = 'name' | 'status' | 'entity' | 'industry' | 'city'
export type ContactSort = 'name' | 'company' | 'jobTitle' | 'email'

export type CompanyListQuery = PageQuery &
  ListOrder<CompanySort> & {
    q?: string
    status?: CompanyStatus | ''
    archived?: ArchivedFilter
    ownerId?: string
  }

export type CompanyInput = {
  name: string
  status: CompanyStatus
  entity: Entity
  website?: string | null
  industry?: string | null
  city?: string | null
  country?: string | null
  notes?: string | null
  legalName?: string | null
  street?: string | null
  postalCode?: string | null
  /** specs/20261101-crm US-7. */
  source?: LeadSource | null
  sourceDetail?: string | null
  ownerUserId?: string
}

export const listCompanies = (params: CompanyListQuery, init?: Init) =>
  getJson<Page<CompanySummary>>(`/companies${query(params)}`, init)
/** The people who own a company, by name: the owner filter's choices (US-9). */
export const listCompanyOwners = (init?: Init) => getJson<{ items: PersonRef[] }>('/companies/owners', init)
export const getCompany = (id: string, init?: Init) => getJson<Company>(`/companies/${encodeURIComponent(id)}`, init)
export const createCompany = (input: CompanyInput) => sendJson<Company>('/companies', 'POST', input)
export const updateCompany = (id: string, version: number, input: Partial<CompanyInput>) =>
  sendJson<Company>(`/companies/${encodeURIComponent(id)}`, 'PATCH', input, version)
export const setCompanyArchived = (id: string, version: number, archived: boolean) =>
  sendJson<Company>(
    `/companies/${encodeURIComponent(id)}/${archived ? 'archive' : 'unarchive'}`,
    'POST',
    undefined,
    version,
  )

// ─── Contacts ───────────────────────────────────────────────────────────────

export type ContactListQuery = PageQuery &
  ListOrder<ContactSort> & { q?: string; companyId?: string; archived?: ArchivedFilter }

export type ContactInput = {
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  jobTitle?: string | null
  companyId?: string | null
  notes?: string | null
}

export const listContacts = (params: ContactListQuery, init?: Init) =>
  getJson<Page<ContactSummary>>(`/contacts${query(params)}`, init)
export const getContact = (id: string, init?: Init) => getJson<Contact>(`/contacts/${encodeURIComponent(id)}`, init)
export const createContact = (input: ContactInput) => sendJson<Contact>('/contacts', 'POST', input)
export const updateContact = (id: string, version: number, input: Partial<ContactInput>) =>
  sendJson<Contact>(`/contacts/${encodeURIComponent(id)}`, 'PATCH', input, version)
export const setContactArchived = (id: string, version: number, archived: boolean) =>
  sendJson<Contact>(
    `/contacts/${encodeURIComponent(id)}/${archived ? 'archive' : 'unarchive'}`,
    'POST',
    undefined,
    version,
  )
/** Erasure (D-13): no precondition — the record is gone either way. */
export const eraseContact = (id: string) => sendJson<void>(`/contacts/${encodeURIComponent(id)}`, 'DELETE')

// ─── Deals and pipeline ─────────────────────────────────────────────────────

export type DealListQuery = PageQuery & {
  q?: string
  stage?: DealStage | ''
  open?: boolean
  /** Open deals plus the won and lost ones of `year`, this year by default (the pipeline board). */
  board?: boolean
  year?: number
  companyId?: string
  ownerId?: string
  entity?: Entity | ''
}

export type DealInput = {
  companyId: string
  title: string
  /** Optional: a lead often has no figure yet (specs/20261101-crm AC-3.2). */
  amountCents?: number | null
  currency: Currency
  stage?: DealStage
  entity?: Entity
  expectedCloseDate?: string | null
  ownerUserId?: string
  notes?: string | null
  /** specs/20261101-crm US-7. */
  source?: LeadSource | null
  sourceDetail?: string | null
}

export type DealUpdate = Partial<Omit<DealInput, 'companyId' | 'stage'>>

export const listDeals = (params: DealListQuery, init?: Init) =>
  getJson<Page<DealSummary>>(`/deals${query(params)}`, init)
export const getDeal = (id: string, init?: Init) => getJson<Deal>(`/deals/${encodeURIComponent(id)}`, init)
export const createDeal = (input: DealInput) => sendJson<Deal>('/deals', 'POST', input)
export const updateDeal = (id: string, version: number, input: DealUpdate) =>
  sendJson<Deal>(`/deals/${encodeURIComponent(id)}`, 'PATCH', input, version)
export const moveDealStage = (id: string, version: number, stage: DealStage, lostReason?: string) =>
  sendJson<Deal>(
    `/deals/${encodeURIComponent(id)}/stage`,
    'POST',
    lostReason !== undefined && lostReason !== '' ? { stage, lostReason } : { stage },
    version,
  )
/** `year`: whose won and lost deals count (specs/20261101-crm AC-3.6); this year when absent. `companyId`: one company's deals. */
export const getPipeline = (entity?: Entity | '', init?: Init, year?: number, companyId?: string) =>
  getJson<Pipeline>(
    `/pipeline${query({ entity, ...(year !== undefined ? { year } : {}), ...(companyId ? { companyId } : {}) })}`,
    init,
  )

// ─── auth: the user directory (owner/assignee picker, ADR 20261006-user-directory-endpoint-capability-gated/0053) ─────────

/** `appId` keeps only users who hold `(appId, "access")` (specs/20261101-crm-sales-flow, ADR 20261101-app-access-check-by-user-id-and-directory-app-filter). */
export const listDirectory = (appId?: string, init?: Init) =>
  requestJson<{ users: DirectoryUser[] }>(getAuthBaseUrl(), `/authz/users/directory${query({ appId })}`, init)

// ─── Estimates (specs/20261101-crm-sales-flow US-3): every call answers with the updated deal ────

const estimatePath = (dealId: string) => `/deals/${encodeURIComponent(dealId)}/estimate`
export const requestEstimate = (dealId: string, technicalUserId: string) =>
  sendJson<Deal>(estimatePath(dealId), 'POST', { technicalUserId })
export const overrideEstimateGate = (dealId: string, reason: string) =>
  sendJson<Deal>(`${estimatePath(dealId)}/override`, 'POST', { reason })
export const unlinkEstimate = (dealId: string) => sendJson<Deal>(estimatePath(dealId), 'DELETE')

// ─── Offers (deal:financials) ───────────────────────────────────────────────

const offersPath = (dealId: string) => `/deals/${encodeURIComponent(dealId)}/offers`

/** A cost line as sent: a discount carries `unitCents` OR `percentBp`, every other kind `unitCents` (never null). */
export type OfferCostLineInput = {
  description: string
  kind: CostKind
  unitCents?: number
  percentBp?: number
  quantity: number
}

export type OfferInput = {
  templateId: string
  salutation: string
  clientLines: string[]
  contactIds: string[]
  opening: string
  sections: OfferSection[]
  costColumns: CostColumns
  showTotal: boolean
  costLines: OfferCostLineInput[]
  acceptanceLabel: string | null
  annex: boolean
  attachmentIds: string[]
  validityDays: number
  aiAssisted: boolean
}

export const getOfferDraft = (dealId: string, templateId: string, aiAssisted: boolean, init?: Init) =>
  getJson<OfferDraft>(`${offersPath(dealId)}/draft${query({ templateId, aiAssisted })}`, init)

export const listOffers = (dealId: string, init?: Init) => getJson<{ items: Offer[] }>(offersPath(dealId), init)
export const generateOffer = (dealId: string, input: OfferInput) => sendJson<Offer>(offersPath(dealId), 'POST', input)
/** specs/20261101-crm US-7: the details already written for a source, most used first (matched in the browser). */
export type SourceDetailSuggestion = { value: string; count: number }
export const listSourceDetails = (source: 'event' | 'referral' | 'other', init?: Init) =>
  getJson<{ items: SourceDetailSuggestion[] }>(`/source-details${query({ source })}`, init)
/** specs/20261102-crm-offer-document US-8: where an entity's offer numbers continue from. */
export type OfferSequence = { entity: Entity; year: number; next: number; lowestAllowed: number }
export const getOfferSequence = (entity: Entity, init?: Init) =>
  getJson<OfferSequence>(`/offer-sequences/${encodeURIComponent(entity)}`, init)
export const setOfferSequence = (entity: Entity, year: number, next: number) =>
  sendJson<OfferSequence>(`/offer-sequences/${encodeURIComponent(entity)}`, 'PUT', { year, next })
/** specs/20261102-crm-offer-document US-7: an offer's own content, to edit it or to start the next revision from it. */
export const getOfferForm = (dealId: string, offerId: string, init?: Init) =>
  getJson<OfferForm>(`${offersPath(dealId)}/${encodeURIComponent(offerId)}/form`, init)
/** Re-generates an offer that has not been sent: same reference, new PDF. */
export const editOffer = (dealId: string, offerId: string, version: number, input: OfferInput) =>
  sendJson<Offer>(`${offersPath(dealId)}/${encodeURIComponent(offerId)}`, 'PUT', input, version)
/** Freezes the offer; the deal moves to "Offer sent" when it was before it. */
export const markOfferSent = (dealId: string, offerId: string) =>
  sendJson<Offer>(`${offersPath(dealId)}/${encodeURIComponent(offerId)}/sent`, 'POST')
export const getOfferDownload = (dealId: string, offerId: string) =>
  getJson<{ url: string }>(`${offersPath(dealId)}/${encodeURIComponent(offerId)}/download`)
export const deleteOffer = (dealId: string, offerId: string) =>
  sendJson<void>(`${offersPath(dealId)}/${encodeURIComponent(offerId)}`, 'DELETE')

// ─── Attachments ────────────────────────────────────────────────────────────

export type AttachmentUpload = { attachmentId: string; upload: { url: string; fields: Record<string, string> } }

const attachmentsPath = (dealId: string) => `/deals/${encodeURIComponent(dealId)}/attachments`
export const listAttachments = (dealId: string, init?: Init) =>
  getJson<{ items: Attachment[] }>(attachmentsPath(dealId), init)
export const startAttachmentUpload = (
  dealId: string,
  file: { fileName: string; contentType: string; sizeBytes: number },
) => sendJson<AttachmentUpload>(attachmentsPath(dealId), 'POST', file)
export const confirmAttachment = (dealId: string, attachmentId: string) =>
  sendJson<Attachment>(`${attachmentsPath(dealId)}/${encodeURIComponent(attachmentId)}/confirm`, 'POST')
export const getAttachmentDownload = (dealId: string, attachmentId: string) =>
  getJson<{ url: string }>(`${attachmentsPath(dealId)}/${encodeURIComponent(attachmentId)}/download`)
export const deleteAttachment = (dealId: string, attachmentId: string) =>
  sendJson<void>(`${attachmentsPath(dealId)}/${encodeURIComponent(attachmentId)}`, 'DELETE')

/**
 * The bucket upload: a presigned POST straight to object storage. NOT `apiFetch` —
 * the bucket is not a trusted API origin and must never see the Bearer token.
 * The file is the last form part, as S3 requires.
 */
export async function postToBucket(upload: AttachmentUpload['upload'], file: Blob): Promise<void> {
  const form = new FormData()
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
  form.append('file', file)
  const response = await fetch(upload.url, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`bucket upload failed: ${response.status}`)
}

// ─── Entity profiles (settings) ─────────────────────────────────────────────

export type EntityProfileInput = {
  legalName: string
  addressLines: string[]
  vatNumber?: string | null
  iban?: string | null
  offerTermsEn?: string | null
  offerTermsIt?: string | null
  placeOfIssue?: string | null
}

export const listEntityProfiles = (init?: Init) => getJson<{ items: EntityProfile[] }>('/entity-profiles', init)
export const saveEntityProfile = (entity: Entity, input: EntityProfileInput) =>
  sendJson<EntityProfile>(`/entity-profiles/${entity}`, 'PUT', input)

// ─── Letterhead: three calls, like a deal attachment (specs/20261102-crm-offer-document AC-2.5) ──────

export type LetterheadUpload = { key: string; upload: { url: string; fields: Record<string, string> } }

const letterheadPath = (entity: Entity) => `/entity-profiles/${entity}/letterhead`
export const startLetterheadUpload = (entity: Entity) => sendJson<LetterheadUpload>(letterheadPath(entity), 'POST')
export const confirmLetterhead = (entity: Entity, key: string) =>
  sendJson<EntityProfile>(`${letterheadPath(entity)}/confirm`, 'POST', { key })
export const getLetterheadDownload = (entity: Entity, init?: Init) =>
  getJson<{ url: string }>(letterheadPath(entity), init)

/**
 * The letterhead's bytes from the presigned link (DD-54). Plain `fetch`, NOT `apiFetch`: the bucket is not a trusted
 * API origin and must never see the Bearer token. No credentials, no referrer, no cache, no redirect; stops reading
 * once more than `MAX_LETTERHEAD_BYTES` have arrived; the first bytes must be `%PDF-`. Errors carry no link.
 */
export async function fetchLetterheadBytes(url: string, init: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    signal: init.signal,
  })
  if (!response.ok) throw new Error('letterhead_unavailable')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_LETTERHEAD_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new Error('letterhead_too_large')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_LETTERHEAD_BYTES) {
        void reader.cancel().catch(() => {})
        throw new Error('letterhead_too_large')
      }
      chunks.push(value)
    }
  } else {
    const whole = new Uint8Array(await response.arrayBuffer())
    if (whole.length > MAX_LETTERHEAD_BYTES) throw new Error('letterhead_too_large')
    chunks.push(whole)
    total = whole.length
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  if (!isPdfBytes(bytes)) throw new Error('letterhead_not_pdf')
  return bytes
}

// ─── Offer templates (specs/20261102-crm-offer-document US-2) ───────────────────────────────────────

/** Templates are saved whole; a new one names its entity beside the content. */
export type OfferTemplateInput = OfferTemplateContent

const templatePath = (id: string) => `/offer-templates/${encodeURIComponent(id)}`
export const listOfferTemplates = (entity: Entity, includeArchived: boolean, init?: Init) =>
  getJson<{ items: OfferTemplate[] }>(`/offer-templates${query({ entity, includeArchived })}`, init)
export const getOfferTemplate = (id: string, init?: Init) => getJson<OfferTemplate>(templatePath(id), init)
export const createOfferTemplate = (entity: Entity, input: OfferTemplateInput) =>
  sendJson<OfferTemplate>('/offer-templates', 'POST', { ...input, entity })
export const duplicateOfferTemplate = (id: string) => sendJson<OfferTemplate>(`${templatePath(id)}/duplicate`, 'POST')
export const updateOfferTemplate = (id: string, version: number, input: OfferTemplateInput) =>
  sendJson<OfferTemplate>(templatePath(id), 'PUT', input, version)
export const setOfferTemplateArchived = (id: string, version: number, archived: boolean) =>
  sendJson<OfferTemplate>(`${templatePath(id)}/${archived ? 'archive' : 'restore'}`, 'POST', undefined, version)

/** The formats a template list may ask for (the default is the classic ones, so older callers are unchanged). */
export type TemplateFormats = 'sections' | 'wizard' | 'sections,wizard'
/** An entity's templates in the formats asked: `wizard` for the Template step, both for Settings. */
export const listOfferTemplatesOf = (entity: Entity, includeArchived: boolean, formats: TemplateFormats, init?: Init) =>
  getJson<{ items: OfferTemplateRow[] }>(`/offer-templates${query({ entity, includeArchived, formats })}`, init)
export const getWizardTemplate = (id: string, init?: Init) => getJson<WizardTemplate>(templatePath(id), init)
/** A new template is always a wizard template (DD-9); a 422 `template_invalid` lists the text's problems. */
export const createWizardTemplate = (entity: Entity, input: WizardTemplateInput) =>
  sendJson<WizardTemplate>('/offer-templates', 'POST', { ...input, entity })
export const updateWizardTemplate = (id: string, version: number, input: WizardTemplateInput) =>
  sendJson<WizardTemplate>(templatePath(id), 'PUT', input, version)

// ─── The offer wizard: context and the deal's one draft (specs/20261115-crm-offer-wizard plan § API contracts) ──

/** A draft and the `ETag` it came with: the version the next write names. */
export type WizardDraftAnswer = { draft: OfferDraftView; etag: string }

const draftPath = (dealId: string) => `/deals/${encodeURIComponent(dealId)}/offer-draft`

/** A call with a JSON body and a precondition header: `If-Match` of a version, or `If-None-Match: *` to create. */
function draftCall(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  options: { body?: unknown; version?: number; create?: boolean; signal?: AbortSignal } = {},
) {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.version !== undefined) headers['If-Match'] = ifMatch(options.version)
  if (options.create) headers['If-None-Match'] = '*'
  return requestAnswered<OfferDraftView>(getCrmApiBaseUrl(), path, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
}

const asDraft = ({ body, etag }: { body: OfferDraftView; etag: string | null }): WizardDraftAnswer => ({
  draft: body,
  etag: etag ?? ifMatch(body.version),
})

export const getWizardContext = (dealId: string, init?: Init) =>
  getJson<WizardContextResponse>(`/deals/${encodeURIComponent(dealId)}/offer-wizard/context`, init)

export const getWizardDraft = async (dealId: string, init?: Init) =>
  asDraft(await draftCall(draftPath(dealId), 'GET', init))

/** `{ draft: null }` is the common answer on a deal page, and has no ETag. */
export async function getWizardDraftSummary(dealId: string, init?: Init) {
  const answered = await requestAnswered<{ draft: OfferDraftSummary | null }>(
    getCrmApiBaseUrl(),
    `${draftPath(dealId)}/summary`,
    init,
  )
  return { draft: answered.body.draft, etag: answered.body.draft ? answered.etag : null }
}

/** `templateId` is required for a new offer and optional for an edit or revision (DD-28). 409 `draft_exists` names who and when. */
export const createWizardDraft = async (dealId: string, input: { templateId?: string; target?: DraftTargetInput }) =>
  asDraft(await draftCall(draftPath(dealId), 'POST', { body: input, create: true }))

export type DraftSaveInput = { templateVersion: number; target: DraftTargetInput; answers: OfferDraftView['answers'] }
/** The whole document under `If-Match`; a body equal to the stored draft is a no-op on the server (200, same version). */
export const saveWizardDraft = async (dealId: string, version: number, input: DraftSaveInput, init?: Init) =>
  asDraft(await draftCall(draftPath(dealId), 'PUT', { body: input, version, ...init }))

export const switchWizardDraftTemplate = async (dealId: string, version: number, templateId: string) =>
  asDraft(await draftCall(`${draftPath(dealId)}/template`, 'POST', { body: { templateId }, version }))

export const discardWizardDraft = async (dealId: string, version: number): Promise<void> => {
  await requestAnswered<void>(getCrmApiBaseUrl(), draftPath(dealId), {
    method: 'DELETE',
    headers: { 'If-Match': ifMatch(version) },
  })
}

export type GenerateWizardResult =
  | { kind: 'generated'; offer: Offer; etag: string | null; created: boolean }
  | ({ kind: 'incomplete' } & OfferIncomplete)

/**
 * Generates the offer from the STORED draft at `version` — nothing in the request says what it contains. 201 is a new
 * offer or a revision, 200 an edit. A 422 `offer_incomplete` is a normal answer, returned typed (DD-32); every other
 * refusal is an `ApiError` for the page to switch on.
 */
export async function generateWizardDraft(dealId: string, version: number): Promise<GenerateWizardResult> {
  try {
    const answered = await requestAnswered<Offer>(getCrmApiBaseUrl(), `${draftPath(dealId)}/generate`, {
      method: 'POST',
      headers: { 'If-Match': ifMatch(version) },
    })
    return { kind: 'generated', offer: answered.body, etag: answered.etag, created: answered.status === 201 }
  } catch (error) {
    const incomplete = offerIncompleteOf(error)
    if (incomplete) return { kind: 'incomplete', ...incomplete }
    throw error
  }
}
