/**
 * projectsApi — typed calls for every projects-api route of specs/021-projects
 * (tasks.md § API contracts) and of specs/022-projects-handoff (the to-start
 * queue, taking a deal), plus the directory read on `auth`. Every write of
 * an existing project or contract passes the record's `version` (sent as
 * `If-Match`, AC-1.7); creating a project or a contract has no precondition.
 *
 * There is deliberately no contract delete (AC-2.10): a contract ends by setting
 * its end date.
 */
import { getAuthBaseUrl } from 'shell/session'
import { getJson, query, requestJson, sendJson } from './api'
import type {
  CompanyChoice,
  Contract,
  ContractTermsInput,
  DealContractInput,
  DealProjectType,
  DirectoryUser,
  Entity,
  Page,
  Person,
  Project,
  ProjectState,
  ProjectSummary,
  ProjectType,
  QueueList,
  Scope,
} from './types'

type Init = { signal?: AbortSignal }

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`
const contractPath = (projectId: string, contractId: string) =>
  `${projectPath(projectId)}/contracts/${encodeURIComponent(contractId)}`

// ─── Scope ──────────────────────────────────────────────────────────────────

export const getScope = (init?: Init) => getJson<Scope>('/scope', init)

// ─── Companies (CRM, through projects-api; needs project:manage) ────────────

export const listCompanies = (q: string, init?: Init) =>
  getJson<{ items: CompanyChoice[] }>(`/companies${query({ q })}`, init)

// ─── Projects ───────────────────────────────────────────────────────────────

export type ProjectListQuery = {
  page?: number
  q?: string
  type?: ProjectType | ''
  state?: ProjectState | ''
  projectManagerId?: string
}

export type CreateProjectInput = {
  name: string
  type: ProjectType
  entity: Entity
  /** Required for a client type, refused for `saas` and `internal`. */
  companyId?: string
  /** Defaults to the caller. */
  projectManagerId?: string
}

export type UpdateProjectInput = { name?: string; projectManagerId?: string }

export const listProjects = (params: ProjectListQuery, init?: Init) =>
  getJson<Page<ProjectSummary>>(`/projects${query(params)}`, init)
/** The distinct project managers of all projects, by name: feeds the list's filter for every reader (AC-1.4). */
export const getProjectManagers = (init?: Init) => getJson<{ items: Person[] }>('/project-managers', init)
export const getProject = (id: string, init?: Init) => getJson<Project>(projectPath(id), init)
export const createProject = (input: CreateProjectInput) => sendJson<Project>('/projects', 'POST', input)
export const updateProject = (id: string, version: number, input: UpdateProjectInput) =>
  sendJson<Project>(projectPath(id), 'PATCH', input, version)
export const transitionProject = (id: string, version: number, to: ProjectState) =>
  sendJson<Project>(`${projectPath(id)}/transitions`, 'POST', { to }, version)
/** The one allowed type change: `internal` → `saas` (AC-1.2). */
export const changeTypeToSaas = (id: string, version: number) =>
  sendJson<Project>(`${projectPath(id)}/type`, 'PUT', { type: 'saas' }, version)
export const replaceTeam = (id: string, version: number, memberIds: string[]) =>
  sendJson<Project>(`${projectPath(id)}/team`, 'PUT', { memberIds }, version)

// ─── Contracts ──────────────────────────────────────────────────────────────

export type CreateContractInput = {
  /** A client project's own company by default; required for `saas`. */
  companyId?: string
  startDate: string
  endDate?: string | null
  terms?: ContractTermsInput
}

/** `terms`, when given, replaces the contract's terms; `endDate` ends it (or `null` reopens it). */
export type UpdateContractInput = {
  startDate?: string
  endDate?: string | null
  terms?: ContractTermsInput
}

export const getContract = (projectId: string, contractId: string, init?: Init) =>
  getJson<Contract>(contractPath(projectId, contractId), init)
export const createContract = (projectId: string, input: CreateContractInput) =>
  sendJson<Contract>(`${projectPath(projectId)}/contracts`, 'POST', input)
export const updateContract = (projectId: string, contractId: string, version: number, input: UpdateContractInput) =>
  sendJson<Contract>(contractPath(projectId, contractId), 'PATCH', input, version)
/** Needs `contract:bexio` (`Scope.bexio`); `null` clears the id. */
export const setBexioOrderId = (projectId: string, contractId: string, version: number, bexioOrderId: string | null) =>
  sendJson<Contract>(`${contractPath(projectId, contractId)}/bexio-order`, 'PUT', { bexioOrderId }, version)

// ─── The to-start queue and taking a deal (specs/022) ───────────────────────

export type QueueQuery = { q?: string; entity?: Entity | '' }

export type TakeDealAsProjectInput = {
  name: string
  type: DealProjectType
  /** Defaults to the caller. */
  projectManagerId?: string
  contract: DealContractInput
}

export type AttachDealInput = { projectId: string; contract: DealContractInput }

/** Won deals no project has taken, newest won first; read live from the CRM, so 503 `crm_unavailable` when it is down. */
export const listQueue = (params: QueueQuery, init?: Init) => getJson<QueueList>(`/queue${query(params)}`, init)

const queuePath = (dealId: string) => `/queue/${encodeURIComponent(dealId)}`

/** A new `planned` project with the deal's company and entity and one contract made from the deal (AC-1.2, AC-1.3). */
export const takeDealAsProject = (dealId: string, input: TakeDealAsProjectInput) =>
  sendJson<Project>(`${queuePath(dealId)}/project`, 'POST', input)

/** A contract of the project's type made from the deal (AC-1.4). Neither take carries `If-Match`: both create. */
export const attachDeal = (dealId: string, input: AttachDealInput) =>
  sendJson<Contract>(`${queuePath(dealId)}/attach`, 'POST', input)

// ─── auth: the user directory (PM and team pickers, ADR-0053/0055) ──────────

/** Only users who hold `(projects, "access")` (ADR-0055): a PM and a member must hold it (AC-1.6). */
export const listDirectory = (init?: Init) =>
  requestJson<{ users: DirectoryUser[] }>(
    getAuthBaseUrl(),
    `/authz/users/directory${query({ appId: 'projects' })}`,
    init,
  )
