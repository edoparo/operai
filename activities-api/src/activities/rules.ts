/**
 * Who may do what with an activity (specs/20261110-activities plan § Access; AC-3.2, AC-3.3, AC-3.8, AC-8.1).
 *
 * Pure functions of three things: the host's REGISTRY entry (the rule it follows: `editBy`,
 * `completeBy`, `assignees`, `types`), the host's ANSWER about this entity for this caller
 * (`may`, `writable`, `assignees`) and the activity row. There is no `if (app === "crm")`
 * anywhere: a rule that differs between the CRM and Projects is a field of the registry, so a
 * third host adds data, not branches. The `may` flags of a view and the checks of a write are
 * the same functions, so the UI can never be told something the server then refuses.
 */

import type { ActivityHost } from "../hosts/registry";
import { ProblemError } from "../lib/problem";
import type { OpenEntity } from "./access";

export interface RuleRow {
  readonly type: string;
  readonly authorUserId: string;
  readonly assigneeUserId: string | null;
}

export interface MayFlags {
  readonly edit: boolean;
  readonly delete: boolean;
  readonly complete: boolean;
}

/** Creating on this entity: the host's `write` (CRM: `crm:access`; Projects: manage the entity). */
export const mayCreate = (entity: OpenEntity): boolean => entity.may.write;

/**
 * Editing, reassigning, deleting (before the `writable` test): the author, for a host that
 * lets the author change what they wrote; a manager of the entity, for a host that makes it a
 * managed record.
 */
export function mayChange(host: ActivityHost, entity: OpenEntity, row: RuleRow, userId: string): boolean {
  return host.editBy === "author" ? entity.may.write && row.authorUserId === userId : entity.may.manage;
}

/** Completing or reopening: any reader, or the assignee or a manager of the entity. A task only. */
export function mayComplete(host: ActivityHost, entity: OpenEntity, row: RuleRow, userId: string): boolean {
  if (row.type !== "task") return false;
  return host.completeBy === "reader" || row.assigneeUserId === userId || entity.may.manage;
}

/** What the view tells the caller: the same rules, with `writable` applied to edit and delete (AC-3.8). */
export function mayFlags(host: ActivityHost, entity: OpenEntity | undefined, row: RuleRow, userId: string): MayFlags {
  if (!entity) return { edit: false, delete: false, complete: false };
  const change = entity.writable && mayChange(host, entity, row, userId);
  return { edit: change, delete: change, complete: mayComplete(host, entity, row, userId) };
}

/** 403: `author_only` where the author owns the record (017 AC-4.2), `forbidden` where a manager does (028 AC-3.2). */
export const changeRefused = (host: ActivityHost): ProblemError =>
  host.editBy === "author"
    ? new ProblemError({ status: 403, code: "author_only", detail: "Only the author can change this activity" })
    : new ProblemError({ status: 403, code: "forbidden", detail: "You are not allowed to change this" });

export const completeRefused = (): ProblemError =>
  new ProblemError({ status: 403, code: "forbidden", detail: "Only the assignee or a manager can mark this done" });

export const createRefused = (): ProblemError =>
  new ProblemError({ status: 403, code: "forbidden", detail: "You are not allowed to add this here" });

/** 409: the entity is closed or cancelled; creating, editing, reassigning and deleting are refused (AC-3.8). */
export const hostReadOnly = (): ProblemError =>
  new ProblemError({
    status: 409,
    code: "host_read_only",
    detail: "This is closed or cancelled; its tasks can be marked done or not done, nothing else",
  });
