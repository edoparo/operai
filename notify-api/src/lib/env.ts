import { createECDH } from "node:crypto";
import { z } from "zod";
import { ORIGIN_APPS } from "../notifications/notifications.schemas";

// ─── Web push (specs/029, ADR-0084) ──────────────────────────────────────────
// VAPID keys as `web-push generate-vapid-keys` prints them: P-256, unpadded
// base64url — a 32-byte private scalar and a 65-byte uncompressed public point.
const decodeB64Url = (v: string, bytes: number): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return null;
  const buf = Buffer.from(v, "base64url");
  // Round trip rejects non-canonical spellings (stray bits) as well as wrong lengths.
  return buf.length === bytes && buf.toString("base64url") === v ? buf : null;
};

/** True when `priv` is the private key of `pub`. Never throws, never reveals either. */
const privateKeyDerivesPublic = (priv: Buffer, pub: Buffer): boolean => {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    return ecdh.getPublicKey().equals(pub);
  } catch {
    return false;
  }
};

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(",").map((o) => o.trim())),
  AUTH_JWKS_URL: z.string().url("AUTH_JWKS_URL must be a valid URL"),
  AUTH_ISSUER: z.string().url("AUTH_ISSUER must be a valid URL"),
  // ADR-0010: notify-api is the suite's first real second JWKS resource server —
  // tokens are structurally cross-valid between estimai-api and notify-api unless
  // both verify a shared `aud` claim. Required, not optional: ADR-0010 fires the
  // deferred ADR-0005/ADR-0007 hardening trigger now rather than deferring again.
  // Value MUST exactly match the `AUTH_AUDIENCE` the `auth` service stamps.
  AUTH_AUDIENCE: z.string().min(1, "AUTH_AUDIENCE is required"),
  // SSE stream bound lifetime (seconds) — plan.md §API contracts: "Server closes
  // the stream at MAX_STREAM_DURATION (env, ~30 min) forcing a re-ticket."
  MAX_STREAM_DURATION: z.coerce.number().int().positive().default(1800),
  PORT: z.coerce.number().int().positive().default(8081),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // ─── Email channel (T2, specs/006-user-invitations, ADR-0011) ──────────────
  // EMAIL_ENABLED gates whether the `email` channel actually calls Resend.
  // Default OFF: test/local runs never need a real Resend key — with it off,
  // the channel stubs the send and still records an EmailDelivery row
  // (status "sent", a synthetic id) so callers/tests observe the same shape.
  //
  // NOTE: deliberately NOT z.coerce.boolean() — that coerces via Boolean(str),
  // so the literal string "false" (any non-empty string) would parse to
  // `true` and silently enable real Resend sends. Only the literal string
  // "true" (case-insensitive) is truthy; anything else (including unset,
  // "false", "0") is false.
  EMAIL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === "true"),
  // Required only when EMAIL_ENABLED is true (enforced below, not here) —
  // optional at the schema level so test/local can leave them unset.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  // ─── System-to-system auth: scoped service JWT (specs/015, ADR-0044; the only credential since specs/016) ─
  // `aud` that `auth` stamps on service tokens (POST /system/service-token and
  // its in-process self-mint). MUST differ from AUTH_AUDIENCE so a user JWT is
  // never a system credential and a service token is never a user credential
  // (enforced below; the process exits otherwise). Required: it is now the
  // only credential for both internal routes once the shared token is retired.
  SERVICE_AUDIENCE: z.string().min(1, "SERVICE_AUDIENCE is required"),
  // ─── Email notices (specs/019-crm-notifications, ADR-0056) ─────────────────
  // Optional group, ALL FOUR or none (enforced below): what notify-api needs to
  // resolve a recipient's address from `auth` (POST /system/users/contact, as
  // its own service client) and to build the absolute link in the email.
  // Without the group `email: true` on POST /system/notifications answers
  // `emailStatus: "skipped"` — local dev and existing tests keep working.
  APP_BASE_URL: z
    .string()
    .url("APP_BASE_URL must be an absolute URL")
    .refine((v) => /^https?:\/\//i.test(v), "APP_BASE_URL must be an http(s) URL")
    .optional(),
  AUTH_BASE_URL: z.string().url("AUTH_BASE_URL must be a valid URL").optional(),
  SERVICE_CLIENT_ID: z.string().min(1, "SERVICE_CLIENT_ID must not be empty").optional(),
  SERVICE_CLIENT_SECRET: z
    .string()
    .min(32, "SERVICE_CLIENT_SECRET must be at least 32 characters")
    .optional(),
  // ─── Web push (specs/029, ADR-0084) ────────────────────────────────────────
  // Same literal-"true" parsing as EMAIL_ENABLED (never z.coerce.boolean()).
  // Default OFF: with it off no VAPID variable is read and no push is attempted.
  PUSH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === "true"),
  // Required when enabled (enforced below); P-256 base64url, validated below.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // Optional CSV of originApp values that never push; unknown values are refused
  // even while push is off, so a typo cannot sit unnoticed until it is enabled.
  PUSH_EXCLUDED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o !== ""),
    )
    .pipe(
      z.array(
        z.enum(ORIGIN_APPS, {
          message: `PUSH_EXCLUDED_ORIGINS entries must each be one of: ${ORIGIN_APPS.join(", ")}`,
        }),
      ),
    ),
}).superRefine((v, ctx) => {
  // All four or none — and all four when push is enabled (the activity check,
  // AC-5.2, resolves the recipient through auth). Names the missing ones, never a value.
  const group = ["APP_BASE_URL", "AUTH_BASE_URL", "SERVICE_CLIENT_ID", "SERVICE_CLIENT_SECRET"] as const;
  const missing = group.filter((k) => v[k] === undefined);
  if (v.PUSH_ENABLED && missing.length > 0) {
    for (const key of missing) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required when PUSH_ENABLED=true (push resolves the recipient through auth, like email notices)`,
      });
    }
  } else if (missing.length > 0 && missing.length < group.length) {
    for (const key of missing) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required when any of ${group.join(", ")} is set (email notices need all four)`,
      });
    }
  }
  if (v.PUSH_ENABLED) {
    for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const) {
      if (!v[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when PUSH_ENABLED=true` });
      }
    }
    if (v.VAPID_SUBJECT && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+\S*)$/i.test(v.VAPID_SUBJECT)) {
      ctx.addIssue({
        code: "custom",
        path: ["VAPID_SUBJECT"],
        message: "VAPID_SUBJECT must be a mailto: address or an https: URL",
      });
    }
    if (v.VAPID_PUBLIC_KEY && v.VAPID_PRIVATE_KEY) {
      const pub = decodeB64Url(v.VAPID_PUBLIC_KEY, 65);
      const priv = decodeB64Url(v.VAPID_PRIVATE_KEY, 32);
      if (!pub) {
        ctx.addIssue({
          code: "custom",
          path: ["VAPID_PUBLIC_KEY"],
          message: "VAPID_PUBLIC_KEY must be an unpadded base64url P-256 uncompressed point (65 bytes)",
        });
      }
      if (!priv) {
        ctx.addIssue({
          code: "custom",
          path: ["VAPID_PRIVATE_KEY"],
          message: "VAPID_PRIVATE_KEY must be an unpadded base64url P-256 private key (32 bytes)",
        });
      }
      if (pub && priv && !privateKeyDerivesPublic(priv, pub)) {
        ctx.addIssue({
          code: "custom",
          path: ["VAPID_PRIVATE_KEY"],
          message: "VAPID_PRIVATE_KEY does not derive VAPID_PUBLIC_KEY (rotate both together)",
        });
      }
    }
  }
  if (v.SERVICE_AUDIENCE === v.AUTH_AUDIENCE) {
    ctx.addIssue({
      code: "custom",
      path: ["SERVICE_AUDIENCE"],
      message: "SERVICE_AUDIENCE must differ from AUTH_AUDIENCE (ADR-0044)",
    });
  }
  // Cross-field: EMAIL_ENABLED=true means real sends are attempted, so the
  // Resend credentials become mandatory (they stay optional at rest so
  // test/local can run with the channel stubbed, per ADR-0011/T2).
  if (v.EMAIL_ENABLED) {
    if (!v.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required when EMAIL_ENABLED=true",
      });
    }
    if (!v.RESEND_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_FROM"],
        message: "RESEND_FROM is required when EMAIL_ENABLED=true",
      });
    }
  }
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Invalid environment variables — fix before starting:");
  for (const [key, messages] of Object.entries(
    result.error.flatten().fieldErrors,
  )) {
    console.error(`  ${key}: ${messages?.join(", ")}`);
  }
  process.exit(1);
}

export const env = result.data;

if (env.APP_BASE_URL === undefined) {
  console.warn(
    "[env] APP_BASE_URL, AUTH_BASE_URL, SERVICE_CLIENT_ID and SERVICE_CLIENT_SECRET are not set — email notices are disabled (emailStatus: \"skipped\")",
  );
}
export type Env = typeof env;
