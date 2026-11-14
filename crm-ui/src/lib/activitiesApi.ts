/**
 * activitiesApi — typed calls for the activity and task routes of activities-api
 * (specs/20261110-activities/plan.md § API contracts). These moved out of `crmApi.ts`:
 * activities-api owns them now, crm-api only answers its host `resolve` call.
 *
 * Same transport as crm-api (`apiFetch` through `shell/session`, Problem JSON →
 * `ApiError`); only the base URL differs. There is no If-Match on activities
 * (crm-api's rule is kept). crm-ui lists CRM work only, so every task read sends
 * `kind=pre_sales` — the Tasks page must not start showing project tasks.
 */
import { getActivitiesApiBaseUrl } from 'shell/session'
import { query, requestJson } from './api'
import type { RichTextDoc } from '@operai/ui/rich-text'
import type { Activity, ActivityType, Page, PageQuery, PersonRef, TaskFile } from './types'

type Init = { signal?: AbortSignal }

const getJson = <T>(path: string, init?: Init): Promise<T> => requestJson<T>(getActivitiesApiBaseUrl(), path, init)

const sendJson = <T>(path: string, method: string, body?: unknown): Promise<T> =>
  requestJson<T>(getActivitiesApiBaseUrl(), path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })

export type ActivityTarget = { companyId: string } | { contactId: string } | { dealId: string }

export type ActivityInput = {
  type: ActivityType
  subject: string
  companyId: string
  body?: string | null
  /** Tasks only: the rich description (ADR 20261113-task-description-files-in-activities-api-bucket); it may show only images the task already has. */
  description?: RichTextDoc | null
  occurredAt?: string
  contactId?: string | null
  dealId?: string | null
  dueDate?: string | null
  assigneeUserId?: string
  /** Tasks only: the whole set of tasks this one waits on (specs/20261101-crm US-6). */
  blockedByIds?: string[]
  /** The whole set of colleagues who took part (specs/20261101-crm US-8). */
  participantIds?: string[]
}

export type ActivityUpdate = {
  subject?: string
  body?: string | null
  description?: RichTextDoc | null
  occurredAt?: string
  dueDate?: string | null
  assigneeUserId?: string
  blockedByIds?: string[]
  participantIds?: string[]
  /** One of the activity's company's contacts or deals, or null to clear it (AC-4.2). */
  contactId?: string | null
  dealId?: string | null
}

/** `type: 'task', open: true`: a company's open tasks, the choices for "blocked by". */
export type ActivityFilter = PageQuery & { type?: ActivityType; open?: true }

export const listActivities = (target: ActivityTarget, params: ActivityFilter, init?: Init) =>
  getJson<Page<Activity>>(`/activities${query({ ...target, ...params })}`, init)
export const createActivity = (input: ActivityInput) => sendJson<Activity>('/activities', 'POST', input)
export const updateActivity = (id: string, input: ActivityUpdate) =>
  sendJson<Activity>(`/activities/${encodeURIComponent(id)}`, 'PATCH', input)
export const deleteActivity = (id: string) => sendJson<void>(`/activities/${encodeURIComponent(id)}`, 'DELETE')
export const setTaskCompleted = (id: string, completed: boolean) =>
  sendJson<Activity>(`/activities/${encodeURIComponent(id)}/${completed ? 'complete' : 'reopen'}`, 'POST')

/** `assignee`: `me`, `any`, or one person's auth user id. */
export type TaskListQuery = PageQuery & { status?: 'open' | 'done'; assignee?: string }
export const listTasks = (params: TaskListQuery, init?: Init) =>
  getJson<Page<Activity>>(`/tasks${query({ ...params, kind: 'pre_sales' })}`, init)
/** Everyone CRM tasks have been assigned to, by name (the task filter's colleagues). */
export const listTaskAssignees = (init?: Init) =>
  getJson<{ items: PersonRef[] }>(`/tasks/assignees${query({ kind: 'pre_sales' })}`, init)

// ─── A task's files (ADR 20261113-task-description-files-in-activities-api-bucket) ───────────────────────────────────────────────
// Two phases, like a deal's attachments: activities-api mints a presigned POST, the browser sends
// the bytes straight to the bucket (plain `fetch`, never the Bearer token), then confirms.

export type TaskFileUpload = { fileId: string; upload: { url: string; fields: Record<string, string> } }

const filesPath = (activityId: string) => `/activities/${encodeURIComponent(activityId)}/files`

export const startTaskFile = (activityId: string, input: { kind: TaskFile['kind']; fileName: string; contentType: string; sizeBytes: number }) =>
  sendJson<TaskFileUpload>(filesPath(activityId), 'POST', input)
export const confirmTaskFile = (activityId: string, fileId: string) =>
  sendJson<TaskFile>(`${filesPath(activityId)}/${encodeURIComponent(fileId)}/confirm`, 'POST')
export const getTaskFileUrl = (activityId: string, fileId: string) =>
  getJson<{ url: string; expiresAt: string }>(`${filesPath(activityId)}/${encodeURIComponent(fileId)}/url`)
export const deleteTaskFile = (activityId: string, fileId: string) =>
  sendJson<void>(`${filesPath(activityId)}/${encodeURIComponent(fileId)}`, 'DELETE')
