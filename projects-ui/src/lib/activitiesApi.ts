/**
 * activitiesApi — typed calls for the activities-api routes projects-ui uses
 * (specs/028-activities, plan § API contracts): the tasks of one project, and
 * create / edit / delete / complete / reopen for a project task.
 *
 * Same transport as projectsApi (`requestJson` → `shell/session`'s `apiFetch`,
 * Problem JSON → `ApiError`), against the activities origin the shell exposes
 * (`getActivitiesApiBaseUrl()`, T15). There is no `If-Match` here: activities-api
 * keeps crm-api's last-write-wins on activities (plan D-7). Authorization is the
 * server's: every task view carries `may {edit, delete, complete}`, the UI never
 * infers them.
 */
import { getActivitiesApiBaseUrl } from 'shell/session'
import { query, requestJson } from './api'
import type { Page } from './types'

type Init = { signal?: AbortSignal }

/** A user as activities-api reports them, resolved live and failing soft (ADR-0039). */
export type PersonRef = {
  id: string
  name: string | null
  status: 'active' | 'deleted' | 'unknown' | 'system'
}

export type TaskBlockerRef = { id: string; subject: string; completed: boolean }

export type TaskDetails = {
  dueDate: string | null
  assignee: PersonRef | null
  completedAt: string | null
  completedBy: PersonRef | null
  /** The tasks it waits on; `blocked` while any of them is open (AC-4.2). */
  blockedBy?: TaskBlockerRef[]
  blocked?: boolean
}

/** What the caller may do with one task, computed by the server for this caller (design G4). */
export type TaskMay = { edit: boolean; delete: boolean; complete: boolean }

/** One project task: the `ActivityView` of an `operational` activity (plan § API contracts). */
export type ProjectTask = {
  id: string
  kind: 'operational'
  type: 'task'
  /** The task's title. */
  subject: string
  body: string | null
  occurredAt: string
  project: { id: string; name: string | null } | null
  author: PersonRef
  participants?: PersonRef[]
  task: TaskDetails
  may: TaskMay
  createdAt: string
  updatedAt: string
}

export type TaskStatus = 'open' | 'done'

export type ProjectTaskQuery = { status: TaskStatus; page?: number; pageSize?: number }

/** A CRM company reference on a pre-sales task; `name` is null when the CRM no longer returns it. */
export type CompanyRef = { id: string; name: string | null }

/**
 * One pre-sales task as My tasks lists it (AC-7.2): the `ActivityView` of a CRM
 * activity with a task. It has a company instead of a project; the project module
 * only marks it done / not done and links to the CRM (AC-7.3).
 */
export type PreSalesTask = Omit<ProjectTask, 'kind' | 'project'> & {
  kind: 'pre_sales'
  project?: null
  company: CompanyRef | null
  deal?: { id: string; title: string | null } | null
}

/** A row of My tasks: either kind, told apart by `kind`. */
export type MyTask = ProjectTask | PreSalesTask

/** `unavailable` names the hosts whose items were left out because they could not be resolved (AC-7.5). */
export type MyTasksPage = Page<MyTask> & { unavailable?: string[] }

export type MyTasksQuery = { status: TaskStatus; page?: number; pageSize?: number }

const activityPath = (id: string) => `/activities/${encodeURIComponent(id)}`

const send = <T>(path: string, method: string, body?: unknown): Promise<T> =>
  requestJson<T>(getActivitiesApiBaseUrl(), path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })

/**
 * The tasks of one project (AC-3.4): open ones earliest due first and no due date last,
 * done ones most recent first — the order is the server's, the page never sorts.
 */
export const listProjectTasks = (projectId: string, params: ProjectTaskQuery, init?: Init) =>
  requestJson<Page<ProjectTask>>(getActivitiesApiBaseUrl(), `/tasks${query({ projectId, ...params })}`, init)

/**
 * The caller's tasks of both kinds in one list (AC-7.2): assigned to them or where they
 * take part, in the order of AC-3.4. A host the server could not resolve is left out and
 * named in `unavailable`; a host the caller cannot read contributes nothing and says nothing (AC-7.4).
 */
export const listMyTasks = (params: MyTasksQuery, init?: Init) =>
  requestJson<MyTasksPage>(
    getActivitiesApiBaseUrl(),
    `/tasks${query({ kind: 'all', assignee: 'me', ...params })}`,
    init,
  )

export type CreateTaskInput = {
  type: 'task'
  projectId: string
  subject: string
  dueDate: string | null
  /** Left out, the task is assigned to its author (AC-3.1). */
  assigneeUserId?: string
  /** The whole set of tasks this one waits on (AC-4.1). */
  blockedByIds: string[]
  /** The whole set of colleagues who take part (AC-5.1). */
  participantIds: string[]
}

export type UpdateTaskInput = {
  subject: string
  dueDate: string | null
  /** Resent unchanged, an assignee who has left the team is accepted (AC-3.7). */
  assigneeUserId?: string
  blockedByIds: string[]
  participantIds: string[]
}

export const createTask = (input: CreateTaskInput) => send<ProjectTask>('/activities', 'POST', input)
export const updateTask = (id: string, input: UpdateTaskInput) => send<ProjectTask>(activityPath(id), 'PATCH', input)
export const deleteTask = (id: string) => send<void>(activityPath(id), 'DELETE')
/** Done (`completed: true`) or not done (reopen); assignee or manager, also on a closed project (AC-3.3, AC-3.8). */
export const setTaskCompleted = (id: string, completed: boolean) =>
  send<ProjectTask>(`${activityPath(id)}/${completed ? 'complete' : 'reopen'}`, 'POST')
