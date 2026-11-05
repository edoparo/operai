/**
 * Shared invitation creation (T6, specs/023-signup-gate — AC-5.1, AC-5.2, AC-3.2;
 * plan.md "Invitations limited to allowed domains"; ADR-0071).
 *
 * Extracted from `POST /admin/invitations` so the route and the access-request
 * approval (T7) create an invitation the same way:
 *
 *   1. {@link validateInvitation}   — normalise + validate, no write
 *   2. {@link createInvitationInTx} — reconcile expired + insert, in a transaction
 *                                     the CALLER owns (so approve can add its own writes)
 *   3. {@link deliverInvitationEmail} — send AFTER commit and store the outcome;
 *                                     a failed send never undoes the invitation
 *
 * {@link createInvitation} composes all three for the plain route.
 */

import { withAudit } from "../authz/audit";
import { db } from "../lib/db";
import { Prisma } from "../lib/generated/prisma/client";
import type { Invitation } from "../lib/generated/prisma/client";
import { env } from "../lib/env";
import { sendInvitationEmail } from "../lib/notify";
import { isAllowedDomain } from "../signup/allowedDomains";
import {
  createInvitationRow,
  findLivePendingInvitationByEmail,
  INVITATION_TTL_MS,
  normalizeEmail,
  reconcileExpiredPending,
  updateEmailDelivery,
} from "./invitations.repo";
import { generateInvitationToken } from "./token";
import type { InvitationToken } from "./token";

export interface InvitationInput {
  email: string;
  roleIds: readonly string[];
  departmentIds: readonly string[];
}

/** A refusal, mapped to RFC 7807 by the caller. `code` and `allowedDomains` are machine-readable extras. */
export interface InvitationProblem {
  status: 409 | 422;
  detail: string;
  code?: "domain_not_allowed";
  allowedDomains?: string[];
}

export interface ValidInvitation {
  email: string;
  roleIds: string[];
  departmentIds: string[];
}

export type ValidationResult =
  | { ok: true; value: ValidInvitation }
  | { ok: false; problem: InvitationProblem };

/** True for a Prisma unique-constraint violation (P2002) — the concurrent-create race (specs/006 fix #7). */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function fail(
  status: 409 | 422,
  detail: string,
  extra: Pick<InvitationProblem, "code" | "allowedDomains"> = {},
): ValidationResult {
  return { ok: false, problem: { status, detail, ...extra } };
}

/**
 * Normalise and validate. Writes nothing. The domain check comes first so an
 * outside address never reaches a database read (AC-5.1).
 */
export async function validateInvitation(
  input: InvitationInput,
  allowedDomains: readonly string[] = env.ALLOWED_SIGNUP_DOMAINS,
): Promise<ValidationResult> {
  const email = normalizeEmail(input.email);
  const roleIds = Array.from(new Set(input.roleIds));
  const departmentIds = Array.from(new Set(input.departmentIds));

  // ── 422 — the address must be in an allowed domain (AC-5.1) ─────────────
  if (!isAllowedDomain(email, allowedDomains)) {
    return fail(422, `Invitations can only be sent to ${allowedDomains.join(", ")} addresses`, {
      code: "domain_not_allowed",
      allowedDomains: [...allowedDomains],
    });
  }

  // ── 422 — role/department ids must exist ────────────────────────────────
  if (roleIds.length > 0) {
    const found = await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
    const foundIds = new Set(found.map((r) => r.id));
    const missing = roleIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) return fail(422, `Unknown role id(s): ${missing.join(", ")}`);
  }
  if (departmentIds.length > 0) {
    const found = await db.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((d) => d.id));
    const missing = departmentIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) return fail(422, `Unknown department id(s): ${missing.join(", ")}`);
  }

  // ── 409 — an active user already owns this email (specs/006 AC-1.3) ────
  const activeUser = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
    select: { id: true },
  });
  if (activeUser) return fail(409, `An active user already exists with email "${email}"`);

  // ── 409 — a live pending invitation already exists (specs/006 AC-1.4) ──
  const existingPending = await findLivePendingInvitationByEmail(db, email);
  if (existingPending) {
    return fail(
      409,
      `A pending invitation already exists for "${email}" (id: ${existingPending.id})`,
    );
  }

  return { ok: true, value: { email, roleIds, departmentIds } };
}

/**
 * Insert the invitation inside the caller's transaction. Reconcile-on-write
 * (ADR-0013) runs in the same transaction so the partial-unique index never
 * sees a stale row. May throw a P2002 ({@link isUniqueConstraintViolation}).
 */
export async function createInvitationInTx(
  tx: Prisma.TransactionClient,
  params: { value: ValidInvitation; invitedByUserId: string; token: InvitationToken },
): Promise<Invitation> {
  const { value, invitedByUserId, token } = params;
  await reconcileExpiredPending(tx, value.email);
  return createInvitationRow(tx, {
    email: value.email,
    roleIds: value.roleIds,
    departmentIds: value.departmentIds,
    invitedByUserId,
    tokenHash: token.hash,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  });
}

/** Builds the invite-link URL: `<BETTER_AUTH_URL>/invite?id=<invId>&token=<raw>`. */
export function buildInviteUrl(invitationId: string, rawToken: string): string {
  const url = new URL("/invite", env.BETTER_AUTH_URL);
  url.searchParams.set("id", invitationId);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

/** Send the invitation email AFTER commit and store the outcome. Never throws on a send failure. */
export async function deliverInvitationEmail(
  created: Invitation,
  rawToken: string,
  inviterName: string,
): Promise<Invitation> {
  const delivery = await sendInvitationEmail({
    to: created.email,
    template: "invitation",
    inviteUrl: buildInviteUrl(created.id, rawToken),
    inviterName,
    expiresAt: created.expiresAt.toISOString(),
  });
  return updateEmailDelivery(created.id, delivery);
}

export type CreateInvitationResult =
  | { ok: true; invitation: Invitation }
  | { ok: false; problem: InvitationProblem };

/** The whole `POST /admin/invitations` flow: validate → audited transaction → email after commit. */
export async function createInvitation(
  input: InvitationInput,
  actor: { id: string; name: string },
): Promise<CreateInvitationResult> {
  const validated = await validateInvitation(input);
  if (!validated.ok) return validated;
  const { value } = validated;

  const token = await generateInvitationToken();

  let created: Invitation;
  try {
    created = await withAudit({
      affectedUserIds: [],
      mutate: (tx) => createInvitationInTx(tx, { value, invitedByUserId: actor.id, token }),
      entry: (invitation) => ({
        actorUserId: actor.id,
        action: "invitation.create",
        targetType: "invitation",
        targetId: invitation.id,
        summary: `Invited ${invitation.email}`,
        data: { roleIds: value.roleIds, departmentIds: value.departmentIds },
      }),
    });
  } catch (error) {
    // Two concurrent creates for one email both pass the pre-check; the partial
    // unique index lets one commit. The loser is the same 409, never a 500.
    if (isUniqueConstraintViolation(error)) {
      return {
        ok: false,
        problem: { status: 409, detail: `A pending invitation already exists for "${value.email}"` },
      };
    }
    throw error;
  }

  return { ok: true, invitation: await deliverInvitationEmail(created, token.raw, actor.name) };
}
