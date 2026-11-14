/**
 * Person references in responses (specs/20261101-crm, D-15): collect every user id a
 * response mentions, resolve them in one `resolveIdentities` call (fail soft),
 * then map each id to its `PersonRef`.
 */

import type { HeaderSource } from "./http";
import { resolveIdentities, type Identity } from "./identities";

export type PersonRef = Identity;

export type People = (id: string) => PersonRef;
export type OptionalPeople = (id: string | null) => PersonRef | null;

/** Resolves `ids` (nulls ignored) and returns a lookup that never misses. */
export async function loadPeople(
  c: HeaderSource,
  ids: readonly (string | null | undefined)[],
): Promise<{ person: People; maybe: OptionalPeople }> {
  const wanted = ids.filter((id): id is string => typeof id === "string" && id !== "");
  const resolved =
    wanted.length > 0
      ? await resolveIdentities(c.req.header("Authorization") ?? "", wanted)
      : new Map<string, Identity>();
  const person: People = (id) => resolved.get(id) ?? { id, name: null, status: "unknown" };
  return { person, maybe: (id) => (id === null ? null : person(id)) };
}
