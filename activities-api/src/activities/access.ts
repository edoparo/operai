/**
 * Asking the host (specs/028 plan § Access, ADR-0081; AC-8.1, AC-8.2, AC-8.3).
 *
 * activities-api holds no permission of its own: whether the caller may read an entity, and
 * what they may do with it, is the answer of the host that owns it, asked as the caller on
 * every request. A `HostSession` is one request's worth of those answers: it asks each
 * (host, entity) once, remembers the answer for the rest of the request (never across
 * requests, nothing is cached beyond them) and turns the two failures into the two problems:
 *
 *   - the host cannot answer (timeout, any status but 200, a body that breaks the contract,
 *     an unanswered id): 503 `host_unavailable`, fail CLOSED, nothing has been written;
 *   - the host says the caller cannot read at all (`reader:false`), or the entity is missing:
 *     404, the SAME problem as for an activity that does not exist (AC-8.3), so a caller
 *     learns nothing by asking.
 */

import { hostRegistry, type ActivityHost, type HostApp, type HostEntity, type HostRegistry, type HostRelated, type RelatedType } from "../hosts/registry";
import { resolve } from "../hosts/client";
import { ProblemError, notFound } from "../lib/problem";

export type OpenEntity = Extract<HostEntity, { state: "open" }>;

/** The one 404 of this module: a missing activity, a missing entity and an unreadable one are indistinguishable. */
export const notFoundProblem = (): ProblemError => notFound("Not found");

export const hostUnavailable = (): ProblemError =>
  new ProblemError({
    status: 503,
    code: "host_unavailable",
    detail: "The tool this activity belongs to could not confirm your access. Nothing was changed. Try again in a moment.",
  });

export type RelatedIds = Readonly<Partial<Record<RelatedType, Iterable<string>>>>;

const entityKey = (host: ActivityHost, id: string) => `${host.app}/${host.entityType}/${id}`;
const relatedKey = (type: RelatedType, id: string) => `${type}/${id}`;

/** Why the last `load` of a session threw, and for which host: what a list that mixes hosts needs to leave that one out. */
export interface HostFailure {
  readonly app: HostApp;
  readonly state: "unavailable" | "not_reader";
}

export class HostSession {
  /** Set just before `load` throws the host's 503 / 404; undefined until a load fails. */
  lastFailure: HostFailure | undefined;
  private readonly entities = new Map<string, HostEntity>();
  private readonly related = new Map<string, HostRelated>();
  /** Related ids already asked about (found or not): never asked twice in one request. */
  private readonly askedRelated = new Set<string>();
  private readonly notReader = new Set<string>();
  /** Hosts that have answered "reader" at least once in this request. */
  private readonly answered = new Set<string>();

  constructor(
    private readonly authorization: string,
    readonly registry: HostRegistry = hostRegistry(),
  ) {}

  /**
   * Makes the answers for `ids` (and the related contacts/deals under them) available.
   * Throws 404 when the caller cannot read this host's activities, 503 when the host cannot say.
   * An empty `ids` asks only "may I read at all?".
   */
  async load(host: ActivityHost, ids: Iterable<string>, related: RelatedIds = {}): Promise<void> {
    if (this.notReader.has(host.app)) {
      this.lastFailure = { app: host.app, state: "not_reader" };
      throw notFoundProblem();
    }
    const wanted = [...new Set(ids)];
    const newEntities = wanted.filter((id) => !this.entities.has(entityKey(host, id)));
    const newRelated: Partial<Record<RelatedType, string[]>> = {};
    let asksRelated = false;
    for (const type of host.relatedTypes) {
      const list = [...new Set(related[type] ?? [])].filter((id) => !this.askedRelated.has(relatedKey(type, id)));
      if (list.length > 0) {
        newRelated[type] = list;
        asksRelated = true;
      }
    }
    // A related item is only returned under a company that is asked about in the same call.
    const ask = asksRelated ? wanted : newEntities;
    if (ask.length === 0 && this.answered.has(host.app)) return;

    const result = await resolve(host, this.authorization, { ids: ask, related: newRelated });
    if (result.state === "unavailable") {
      this.lastFailure = { app: host.app, state: "unavailable" };
      throw hostUnavailable();
    }
    if (result.state === "not_reader") {
      this.notReader.add(host.app);
      this.lastFailure = { app: host.app, state: "not_reader" };
      throw notFoundProblem();
    }
    this.answered.add(host.app);
    for (const [id, entity] of result.entities) this.entities.set(entityKey(host, id), entity);
    for (const item of result.related) this.related.set(relatedKey(item.type, item.id), item);
    for (const [type, list] of Object.entries(newRelated) as Array<[RelatedType, string[]]>) {
      for (const id of list) this.askedRelated.add(relatedKey(type, id));
    }
  }

  entity(host: ActivityHost, id: string): HostEntity | undefined {
    return this.entities.get(entityKey(host, id));
  }

  /** The entity if the host reports it open; the 404 otherwise. */
  open(host: ActivityHost, id: string): OpenEntity {
    const entity = this.entity(host, id);
    if (!entity || entity.state !== "open") throw notFoundProblem();
    return entity;
  }

  /** A contact or deal the host found under `parentId`, or undefined. */
  relatedOf(type: RelatedType, id: string, parentId: string): HostRelated | undefined {
    const item = this.related.get(relatedKey(type, id));
    return item && item.parentId === parentId ? item : undefined;
  }
}
