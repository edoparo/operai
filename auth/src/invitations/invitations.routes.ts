/**
 * Invitation admin API (T6, specs/20260713-user-invitations — refs US-1
 * (AC-1.1–1.14), US-3 (AC-3.1–3.6), US-4 (AC-4.1–4.4); plan.md "Invitation
 * admin API"; ADR 20260714-invitation-activation-hooks-soft-delete-lifecycle, ADR 20260714-invitation-lifecycle-derived-expiry-state).
 *
 * Every route is guarded by `sessionMiddleware` + `requireAuth` +
 * `requireAdmin` (specs/20260713-auth-roles-permissions, T4) — non-admins get RFC 7807 `403`, mirroring
 * every other `admin/*` router in this service.
 *
 *   POST   /admin/invitations              create + send the invite email
 *   GET    /admin/invitations               paginated, `?status=`/`?q=`
 *   POST   /admin/invitations/:id/resend    rotate token, +72h, re-send
 *   POST   /admin/invitations/:id/revoke    terminal, invalidates the link
 *
 * Every mutating route routes its domain write through `withAudit()`
 * (specs/20260713-auth-roles-permissions, `../authz/audit.ts`) so the write and its `audit_log` row
 * commit atomically (AC-1.7/AC-3.5/AC-1.12). `affectedUserIds` is always
 * `[]` here — creating/resending/revoking an INVITATION never changes any
 * EXISTING user's effective permissions (that only happens later, at
 * acceptance — T8's activation hook, which bumps `permissionEpoch` itself).
 *
 * Email send ordering (plan.md "Failure handling", risk R5): the invitation
 * row is committed FIRST (inside `withAudit`'s transaction); the notify-api
 * call happens SECOND, outside that transaction, so a Resend/network
 * failure can NEVER roll back or block invitation creation. The delivery
 * outcome is then written back to `lastEmailStatus`/`lastEmailError` via a
 * plain, non-audited update (`../invitations/invitations.repo.ts`'s
 * `updateEmailDelivery`) — this is metadata about a side effect, not a
 * domain mutation.
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { User } from "better-auth";
import {
  requireAdmin,
  requireAuth,
  sessionMiddleware,
} from "../auth/auth.middleware";
import type { Invitation } from "../lib/generated/prisma/client";
import { withAudit } from "../authz/audit";
import { env } from "../lib/env";
import { sendInvitationEmail } from "../lib/notify";
import { buildInviteUrl, createInvitation } from "./createInvitation";
import { serializeInvitation } from "./serialize";
import {
  effectiveInvitationStatus,
  findInvitationById,
  INVITATION_TTL_MS,
  isTerminalStatus,
  listInvitations,
  updateEmailDelivery,
  updateForResend,
  updateForRevoke,
} from "./invitations.repo";
import { generateInvitationToken } from "./token";
import {
  CreateInvitationBodySchema,
  InvitationConflictSchema,
  InvitationDetailSchema,
  InvitationIdParamSchema,
  InvitationListResponseSchema,
  InvitationUnprocessableSchema,
  ListInvitationsQuerySchema,
  ProblemJsonSchema,
} from "./invitations.schemas";

// ─── Problem-JSON helpers ─────────────────────────────────────────────────────

function notFound(instance: string, detail: string) {
  return {
    type: "https://httpstatuses.com/404",
    title: "Not Found",
    status: 404,
    detail,
    instance,
  } as const;
}

function conflict(instance: string, detail: string) {
  return {
    type: "https://httpstatuses.com/409",
    title: "Conflict",
    status: 409,
    detail,
    instance,
  } as const;
}

function unprocessable(instance: string, detail: string) {
  return {
    type: "https://httpstatuses.com/422",
    title: "Unprocessable Entity",
    status: 422,
    detail,
    instance,
  } as const;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const invitationsRouter = new OpenAPIHono<{
  Variables: { user: User | null };
}>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          type: "https://httpstatuses.com/400",
          title: "Bad Request",
          status: 400,
          detail: result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          instance: c.req.path,
        },
        400,
      );
    }
    return undefined;
  },
});

invitationsRouter.use(
  "/admin/invitations",
  sessionMiddleware,
  requireAuth,
  requireAdmin,
);
invitationsRouter.use(
  "/admin/invitations/*",
  sessionMiddleware,
  requireAuth,
  requireAdmin,
);

// ─── POST /admin/invitations ──────────────────────────────────────────────────

const createInvitationRoute = createRoute({
  method: "post",
  path: "/admin/invitations",
  tags: ["Admin"],
  summary: "Invite a new user by email",
  request: {
    body: {
      content: { "application/json": { schema: CreateInvitationBodySchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: InvitationDetailSchema } },
      description: "The created (pending) invitation",
    },
    401: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No valid session",
    },
    403: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Caller does not hold the admin role",
    },
    409: {
      content: { "application/json": { schema: InvitationConflictSchema } },
      description:
        "An active user already exists for this email (AC-1.3), or a live " +
        "pending invitation already exists for it (AC-1.4)",
    },
    422: {
      content: { "application/json": { schema: InvitationUnprocessableSchema } },
      description:
        "One or more roleIds/departmentIds do not exist, or the email is outside the " +
        'allowed sign-up domains (`code: "domain_not_allowed"` + `allowedDomains`, AC-5.1)',
    },
  },
});

invitationsRouter.openapi(createInvitationRoute, async (c) => {
  const body = c.req.valid("json");
  const actor = c.get("user")!;

  // Validation, the audited transaction and the after-commit email live in
  // `createInvitation.ts`, shared with the access-request approval (specs/20261105-signup-gate).
  const result = await createInvitation(body, actor);
  if (!result.ok) {
    const problem = result.problem;
    if (problem.status === 409) {
      return c.json({ ...conflict(c.req.path, problem.detail), code: problem.code }, 409);
    }
    const { detail, code, allowedDomains } = problem;
    return c.json(
      {
        ...unprocessable(c.req.path, detail),
        ...(code !== undefined ? { code } : {}),
        ...(allowedDomains !== undefined ? { allowedDomains } : {}),
      },
      422,
    );
  }

  return c.json(await serializeInvitation(result.invitation), 201);
});

// ─── GET /admin/invitations ────────────────────────────────────────────────────

const listInvitationsRoute = createRoute({
  method: "get",
  path: "/admin/invitations",
  tags: ["Admin"],
  summary: "List invitations (paginated, filterable by effective status, searchable by email)",
  request: { query: ListInvitationsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: InvitationListResponseSchema } },
      description: "A page of invitations",
    },
    401: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No valid session",
    },
    403: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Caller does not hold the admin role",
    },
  },
});

invitationsRouter.openapi(listInvitationsRoute, async (c) => {
  const { page, pageSize, status, q } = c.req.valid("query");

  const { items, total } = await listInvitations({
    page,
    pageSize,
    ...(status !== undefined ? { status } : {}),
    ...(q !== undefined ? { q } : {}),
  });
  const serialized = await Promise.all(items.map(serializeInvitation));

  return c.json({ items: serialized, page, pageSize, total }, 200);
});

// ─── POST /admin/invitations/:id/resend ────────────────────────────────────────

const resendInvitationRoute = createRoute({
  method: "post",
  path: "/admin/invitations/{id}/resend",
  tags: ["Admin"],
  summary: "Resend an invitation — rotates the token, resets the 72h window",
  request: { params: InvitationIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: InvitationDetailSchema } },
      description: "The invitation, re-sent with a fresh token/expiry",
    },
    401: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No valid session",
    },
    403: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Caller does not hold the admin role",
    },
    404: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No invitation with this id",
    },
    422: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "The invitation's effective status is already accepted or revoked (AC-3.4)",
    },
  },
});

invitationsRouter.openapi(resendInvitationRoute, async (c) => {
  const { id } = c.req.valid("param");
  const actor = c.get("user")!;

  const existing = await findInvitationById(id);
  if (!existing) {
    return c.json(notFound(c.req.path, `No invitation with id "${id}"`), 404);
  }

  const effective = effectiveInvitationStatus(existing);
  if (isTerminalStatus(effective)) {
    return c.json(
      unprocessable(
        c.req.path,
        `Cannot resend an invitation that is already ${effective}`,
      ),
      422,
    );
  }

  const token = await generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const updated = await withAudit({
    affectedUserIds: [],
    mutate: (tx) =>
      updateForResend(tx, id, {
        tokenHash: token.hash,
        expiresAt,
        invitedByUserId: actor.id,
      }),
    entry: {
      actorUserId: actor.id,
      action: "invitation.resend",
      targetType: "invitation",
      targetId: id,
      summary: `Resent invitation to ${existing.email}`,
    },
  });

  const delivery = await sendInvitationEmail({
    to: updated.email,
    template: "invitation_resend",
    inviteUrl: buildInviteUrl(updated.id, token.raw),
    inviterName: actor.name,
    expiresAt: updated.expiresAt.toISOString(),
  });

  const withDelivery = await updateEmailDelivery(id, delivery);

  return c.json(await serializeInvitation(withDelivery), 200);
});

// ─── POST /admin/invitations/:id/revoke ────────────────────────────────────────

const revokeInvitationRoute = createRoute({
  method: "post",
  path: "/admin/invitations/{id}/revoke",
  tags: ["Admin"],
  summary: "Revoke an invitation — terminal, invalidates the link immediately",
  request: { params: InvitationIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: InvitationDetailSchema } },
      description: "The now-revoked invitation",
    },
    401: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No valid session",
    },
    403: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Caller does not hold the admin role",
    },
    404: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No invitation with this id",
    },
    422: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "The invitation's effective status is already accepted or revoked (AC-1.10/1.11)",
    },
  },
});

invitationsRouter.openapi(revokeInvitationRoute, async (c) => {
  const { id } = c.req.valid("param");
  const actor = c.get("user")!;

  const existing = await findInvitationById(id);
  if (!existing) {
    return c.json(notFound(c.req.path, `No invitation with id "${id}"`), 404);
  }

  const effective = effectiveInvitationStatus(existing);
  if (isTerminalStatus(effective)) {
    return c.json(
      unprocessable(
        c.req.path,
        `Cannot revoke an invitation that is already ${effective}`,
      ),
      422,
    );
  }

  const updated = await withAudit({
    affectedUserIds: [],
    mutate: (tx) => updateForRevoke(tx, id),
    entry: {
      actorUserId: actor.id,
      action: "invitation.revoke",
      targetType: "invitation",
      targetId: id,
      summary: `Revoked invitation to ${existing.email}`,
    },
  });

  return c.json(await serializeInvitation(updated), 200);
});
