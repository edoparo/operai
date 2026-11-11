/**
 * The rows of one write get the same `now()` from Postgres, so "in the order they were given"
 * (participants, blockers: both read back `ORDER BY createdAt`) would be lost on read; a
 * millisecond apart each keeps it.
 */
export const staggered = <T extends string>(ids: readonly T[]): { id: T; createdAt: Date }[] => {
  const start = Date.now();
  return ids.map((id, index) => ({ id, createdAt: new Date(start + index) }));
};
