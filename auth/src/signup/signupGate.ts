/**
 * The sign-up gate (specs/023, ADR-0071): `databaseHooks.user.create.before`.
 * It runs only when better-auth is about to create a user row for an identity
 * it has never seen, so existing users are untouched (AC-1.6, AC-1.7).
 *
 * Order matters; see plan.md § The sign-up gate:
 *   1. domain not allowed        -> refuse (even with a live invitation)
 *   2. verified + live invitation-> allow (user.create.after applies it)
 *   3. verified bootstrap admin  -> allow
 *   4. otherwise                 -> record on the waiting list, refuse
 *
 * Any error other than the deliberate refusals propagates, so a failure here
 * creates no user: the gate fails closed. better-auth turns the thrown
 * `APIError` into `/sign-in?error=<message words joined by _>`.
 */

import { APIError } from "better-auth/api";
import { findLivePendingInvitationByEmail } from "../invitations/invitations.repo";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { isAllowedDomain } from "./allowedDomains";
import { recordAccessRequest } from "./accessRequests.repo";
import type { AccessRequestProvider } from "./accessRequests.repo";

/** The messages double as the sign-in page's error codes (words joined by `_`). */
export const SIGNUP_REFUSAL_MESSAGES = {
  domain_not_allowed: "signup domain not allowed",
  access_request_pending: "access request pending",
  access_request_rejected: "access request rejected",
} as const;

type RefusalReason = keyof typeof SIGNUP_REFUSAL_MESSAGES;

/** The slice of the profile better-auth is about to persist that the gate reads. */
export interface SignupCandidate {
  readonly email: string;
  readonly name?: string | null;
  readonly emailVerified?: boolean | null;
}

/** Structured and without email or name (data residency; same posture as `logSessionDenied`). */
function logSignupRefused(reason: RefusalReason, accessRequestId?: string): void {
  console.log(
    JSON.stringify({
      event: "auth.signup_refused",
      reason,
      ...(accessRequestId ? { accessRequestId } : {}),
      timestamp: new Date().toISOString(),
    }),
  );
}

function refuse(reason: RefusalReason, accessRequestId?: string): never {
  logSignupRefused(reason, accessRequestId);
  throw new APIError("FORBIDDEN", { message: SIGNUP_REFUSAL_MESSAGES[reason] });
}

/** The provider id comes from the callback's route param; anything else is `unknown` (R6). */
function providerFrom(context: unknown): AccessRequestProvider {
  const id = (context as { params?: { id?: unknown } } | null | undefined)?.params?.id;
  return id === "google" || id === "github" ? id : "unknown";
}

export async function enforceSignupGate(user: SignupCandidate, context: unknown): Promise<void> {
  const email = user.email.trim().toLowerCase();
  const verified = user.emailVerified === true;

  if (!isAllowedDomain(email, env.ALLOWED_SIGNUP_DOMAINS)) refuse("domain_not_allowed");

  if (verified && (await findLivePendingInvitationByEmail(db, email))) return;

  const bootstrap = env.BOOTSTRAP_ADMIN_EMAIL;
  if (verified && bootstrap !== undefined && email === bootstrap.trim().toLowerCase()) return;

  const recorded = await recordAccessRequest({
    email,
    name: user.name,
    provider: providerFrom(context),
  });
  refuse(
    recorded.status === "rejected" ? "access_request_rejected" : "access_request_pending",
    recorded.id,
  );
}
