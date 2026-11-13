import { z } from "zod";
import { checkEuResidency, isAwsS3Endpoint } from "./s3Residency";

// ─── Schema ──────────────────────────────────────────────────────────────────
//
// activities-api is a JWKS resource server with NO permission catalog of its own
// (specs/028, ADR-0081): who may see or change an activity is asked of the host as the
// caller. The host URLs (T3), the notify service client (T6) and the system-route audience
// (T10) are all validated here, so those tasks read them without editing this file.

/** "true"/"false" (any case) -> boolean; anything else is a startup error, never a silent false. */
const booleanFlag = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["true", "false"], { errorMap: () => ({ message: "must be true or false" }) }))
  .transform((v) => v === "true");

/** The notifier's credentials, all or none (crm-api's rule, ADR-0049): a half-set client is a start error. */
const NOTIFY_KEYS = ["NOTIFY_INTERNAL_URL", "SERVICE_CLIENT_ID", "SERVICE_CLIENT_SECRET"] as const;

/** The task files bucket (ADR-0089), all or none; none = file routes answer 503 `storage_unconfigured`. */
const S3_KEYS = [
  "ACTIVITIES_S3_ENDPOINT",
  "ACTIVITIES_S3_REGION",
  "ACTIVITIES_S3_BUCKET",
  "ACTIVITIES_S3_ACCESS_KEY_ID",
  "ACTIVITIES_S3_SECRET_ACCESS_KEY",
] as const;

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    ALLOWED_ORIGINS: z
      .string()
      .min(1, "ALLOWED_ORIGINS is required")
      .transform((v) =>
        v
          .split(",")
          .map((o) => o.trim())
          .filter((o) => o.length > 0),
      )
      .refine((origins) => origins.length > 0, "ALLOWED_ORIGINS is empty")
      .refine((origins) => origins.every((o) => o !== "*"), "ALLOWED_ORIGINS must not contain a wildcard"),
    // ─── Identity (JWKS resource server, ADR-0005/0010) ───────────────────────
    AUTH_JWKS_URL: z.string().url("AUTH_JWKS_URL must be a valid URL"),
    AUTH_ISSUER: z.string().url("AUTH_ISSUER must be a valid URL"),
    // Suite-wide JWT audience (ADR-0010). A token missing the claim, or carrying a different
    // value, is rejected with 401.
    AUTH_AUDIENCE: z.string().min(1, "AUTH_AUDIENCE is required"),
    // Base URL of the `auth` service: app-access-check and users/identities (T7), the service
    // token endpoint (T6).
    AUTH_BASE_URL: z.string().url("AUTH_BASE_URL must be a valid URL"),
    // ─── Hosts (T3, ADR-0081) ─────────────────────────────────────────────────
    // Where the activity-host resolve endpoints live (Railway private network). Required: with
    // no host to ask nothing can be authorised, so a missing URL stops the start rather than
    // reading as "no access".
    CRM_API_URL: z.string().url("CRM_API_URL must be a valid URL"),
    PROJECTS_API_URL: z.string().url("PROJECTS_API_URL must be a valid URL"),
    // ─── notify-api, as itself (T6, ADR-0044/0049) ────────────────────────────
    // All three or none (superRefine below); none = notifications are a no-op.
    NOTIFY_INTERNAL_URL: z.string().url("NOTIFY_INTERNAL_URL must be a valid URL").optional(),
    SERVICE_CLIENT_ID: z.string().min(1, "SERVICE_CLIENT_ID must not be empty").optional(),
    SERVICE_CLIENT_SECRET: z.string().min(32, "SERVICE_CLIENT_SECRET must be at least 32 characters").optional(),
    // ─── System routes (T10, ADR-0082) ────────────────────────────────────────
    // Audience of the scoped service JWTs crm-api presents on /system/v1/*: auth's
    // SERVICE_AUDIENCE, never the user audience (ADR-0044).
    SERVICE_AUDIENCE: z.string().min(1, "SERVICE_AUDIENCE must not be empty").optional(),
    PORT: z.coerce.number().int().positive().default(8087),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // Maintenance switch (AC-2.5, ADR-0083): true = every route but GET /health answers 503
    // `maintenance`. Absent = off. A malformed value stops the start rather than reading as off.
    ACTIVITIES_MAINTENANCE: booleanFlag.default("false"),
    // ─── Task files bucket (ADR-0089) ─────────────────────────────────────────
    // Its OWN private EU bucket, never another tool's. Residency is checked here: an AWS
    // endpoint must name an EU region, any other endpoint must match the operator-declared
    // ACTIVITIES_S3_EU_ENDPOINT_HOSTS, or the start fails (data residency, ADR-0016).
    ACTIVITIES_S3_ENDPOINT: z.string().url("ACTIVITIES_S3_ENDPOINT must be a valid URL").optional(),
    ACTIVITIES_S3_REGION: z.string().min(1).optional(),
    ACTIVITIES_S3_BUCKET: z.string().min(1).optional(),
    ACTIVITIES_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    ACTIVITIES_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    ACTIVITIES_S3_EU_ENDPOINT_HOSTS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter((h) => h.length > 0),
      ),
  })
  .superRefine((val, ctx) => {
    if (val.SERVICE_AUDIENCE !== undefined && val.SERVICE_AUDIENCE === val.AUTH_AUDIENCE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SERVICE_AUDIENCE"], message: "SERVICE_AUDIENCE must differ from AUTH_AUDIENCE (ADR-0044)" });
    }
    const set = NOTIFY_KEYS.filter((key) => val[key] !== undefined);
    if (set.length > 0 && set.length < NOTIFY_KEYS.length) {
      for (const key of NOTIFY_KEYS.filter((k) => val[k] === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when any of ${NOTIFY_KEYS.join(", ")} is set` });
      }
    }
    const s3Set = S3_KEYS.filter((key) => val[key] !== undefined);
    if (s3Set.length === 0) return;
    if (s3Set.length < S3_KEYS.length) {
      for (const key of S3_KEYS.filter((k) => val[k] === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when any ACTIVITIES_S3_* is set` });
      }
      return;
    }
    const residencyError = checkEuResidency(val.ACTIVITIES_S3_ENDPOINT!, val.ACTIVITIES_S3_REGION!, val.ACTIVITIES_S3_EU_ENDPOINT_HOSTS);
    if (residencyError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [isAwsS3Endpoint(val.ACTIVITIES_S3_ENDPOINT!) ? "ACTIVITIES_S3_REGION" : "ACTIVITIES_S3_EU_ENDPOINT_HOSTS"],
        message: residencyError,
      });
    }
  });

export type EnvResult =
  | { readonly ok: true; readonly env: z.output<typeof envSchema> }
  | { readonly ok: false; readonly errors: Readonly<Record<string, readonly string[]>> };

/** Pure: no exit, no logging. `env` below is this applied to `process.env`. */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return { ok: true, env: parsed.data };
  const errors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    // Messages only — never a received value (secrets live in this environment).
    (errors[issue.path.join(".") || "(env)"] ??= []).push(issue.message);
  }
  return { ok: false, errors };
}

const result = parseEnv(process.env);

if (!result.ok) {
  console.error("Invalid environment variables — fix before starting:");
  for (const [key, messages] of Object.entries(result.errors)) console.error(`  ${key}: ${messages.join(", ")}`);
  process.exit(1);
}

// Not frozen on purpose: the maintenance tests flip ACTIVITIES_MAINTENANCE.
export const env = result.env;
export type Env = typeof env;
