/**
 * Request/response pieces shared by the route groups (specs/028-activities; carried over from
 * crm-api `lib/http.ts`, minus what activities-api has no use for: no If-Match here, plan
 * D-7). Paging, text and date schemas, the person reference and the error list of the
 * OpenAPI document.
 */

import { z } from "@hono/zod-openapi";

// ─── Paging ──────────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 100_000;

/** `page` (≥ 1) and `pageSize` (1..max) query members, coerced from strings. */
export const pageQuery = (maxPageSize = MAX_PAGE_SIZE) => ({
  // Bounded so `(page - 1) * pageSize` stays a valid OFFSET: a 422, never a Postgres 500.
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(DEFAULT_PAGE_SIZE),
});

export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

export const skipTake = (page: number, pageSize: number) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

/** What a helper needs from a request: its headers (a Hono `Context` fits). */
export interface HeaderSource {
  readonly req: { header(name: string): string | undefined };
}

// ─── Shared shapes ───────────────────────────────────────────────────────────

export const PersonRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  status: z.enum(["active", "deleted", "unknown", "system"]),
});

/**
 * Postgres text cannot hold a NUL (`\u0000`): it is an error from the database, which would be a
 * 500 whose log line may carry statement context. Every free-text and id input refuses it first,
 * as a 422 naming the field (OWASP review L2).
 */
export const noNul = (value: string): boolean => !value.includes("\u0000");
export const NUL_MESSAGE = "Must not contain a NUL character";

/** A bounded id (an entity, a user, an activity): 1..max characters, no NUL. */
export const idText = (max = 64) => z.string().min(1).max(max).refine(noNul, NUL_MESSAGE);

export const IdParams = z.object({ id: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE) });

/** Optional free text: trimmed, empty → null, `null` clears (PATCH). */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .refine(noNul, NUL_MESSAGE)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()
    .optional();

export const requiredText = (max: number) =>
  z
    .string()
    .refine(noNul, NUL_MESSAGE)
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Required").max(max));

/** `YYYY-MM-DD`, a real calendar date. */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v),
    "Not a calendar date",
  );

export const toDateOnly = (value: Date | null): string | null => (value === null ? null : value.toISOString().slice(0, 10));

export const fromDateOnly = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  instance: z.string(),
  code: z.string().optional(),
});

/** The error responses every user route can give, for the OpenAPI document. */
export const commonErrors = {
  401: { description: "Missing or invalid token" },
  403: { description: "The host does not let the caller do this (code `author_only` or `forbidden`)" },
  404: { description: "No such activity, or the caller cannot read it (the two answers are identical, AC-8.3)" },
  422: { description: "Validation failed", content: { "application/json": { schema: ProblemSchema } } },
  503: { description: "The host (`host_unavailable`), the identity service or the service itself (`maintenance`) cannot answer" },
} as const;
