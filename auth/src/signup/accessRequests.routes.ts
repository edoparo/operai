/**
 * Access-request admin API (T7, specs/20261105-signup-gate — AC-2.5, AC-3.1–3.7,
 * AC-3.9, AC-3.10; plan.md § Admin API and approval; ADR 20261105-access-only-by-invitation-waiting-list).
 *
 *   GET  /admin/access-requests               the waiting list, filtered by status
 *   POST /admin/access-requests/:id/approve   creates the invitation, then decides
 *   POST /admin/access-requests/:id/reject    decides, sends nothing
 *
 * Every route sits behind `sessionMiddleware` + `requireAuth` + `requireAdmin`
 * like the other `/admin/*` routers. Approval reuses specs/20260713-user-invitations's invitation
 * creation (`../invitations/createInvitation`): there is still no user row until
 * the person's own first sign-in matches the invitation.
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { User } from "better-auth";
import { withAudit } from "../authz/audit";
import { requireAdmin, requireAuth, sessionMiddleware } from "../auth/auth.middleware";
import {
  createInvitationInTx,
  deliverInvitationEmail,
  isUniqueConstraintViolation,
  validateInvitation,
} from "../invitations/createInvitation";
import { serializeInvitation } from "../invitations/serialize";
import { generateInvitationToken } from "../invitations/token";
import {
  decideIfPending,
  findAccessRequestById,
  linkInvitation,
  listAccessRequests,
} from "./accessRequests.repo";
import type { AccessRequestWithDecider } from "./accessRequests.repo";
import {
  AccessRequestDetailSchema,
  AccessRequestIdParamSchema,
  AccessRequestListResponseSchema,
  AccessRequestProblemSchema,
  ApproveAccessRequestBodySchema,
  ApproveAccessRequestResponseSchema,
  ListAccessRequestsQuerySchema,
} from "./accessRequests.schemas";
import type { AccessRequestDetail } from "./accessRequests.schemas";

// ─── Problem-JSON helpers ─────────────────────────────────────────────────────

type ProblemCode = "already_decided" | "active_user_exists" | "pending_invitation_exists" | "domain_not_allowed";

function problem(
  status: 404 | 409 | 422,
  title: string,
  instance: string,
  detail: string,
  extra: { code?: ProblemCode; allowedDomains?: string[] } = {},
) {
  return {
    type: `https://httpstatuses.com/${status}`,
    title,
    status,
    detail,
    instance,
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.allowedDomains !== undefined ? { allowedDomains: extra.allowedDomains } : {}),
  };
}

const alreadyDecided = (instance: string) =>
  problem(409, "Conflict", instance, "This request has already been decided", { code: "already_decided" });

/** Thrown inside the approval transaction so every write rolls back. */
class AlreadyDecidedError extends Error {}

// ─── Serialization ────────────────────────────────────────────────────────────

function serializeAccessRequest(row: AccessRequestWithDecider): AccessRequestDetail {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    provider: row.provider as AccessRequestDetail["provider"],
    status: row.status as AccessRequestDetail["status"],
    firstRequestedAt: row.firstRequestedAt.toISOString(),
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy,
    invitationId: row.invitationId,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const accessRequestsRouter = new OpenAPIHono<{
  Variables: { user: User | null };
}>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          type: "https://httpstatuses.com/400",
          title: "Bad Request",
          status: 400,
          detail: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          instance: c.req.path,
        },
        400,
      );
    }
    return undefined;
  },
});

accessRequestsRouter.use("/admin/access-requests", sessionMiddleware, requireAuth, requireAdmin);
accessRequestsRouter.use("/admin/access-requests/*", sessionMiddleware, requireAuth, requireAdmin);

const problemResponse = (description: string) => ({
  content: { "application/json": { schema: AccessRequestProblemSchema } },
  description,
});
const authResponses = {
  401: problemResponse("No valid session"),
  403: problemResponse("Caller does not hold the admin role"),
} as const;

// ─── GET /admin/access-requests ───────────────────────────────────────────────

const listRoute = createRoute({
  method: "get",
  path: "/admin/access-requests",
  tags: ["Admin"],
  summary: "List access requests (the waiting list), filtered by status",
  request: { query: ListAccessRequestsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: AccessRequestListResponseSchema } },
      description: "A page of access requests",
    },
    ...authResponses,
  },
});

accessRequestsRouter.openapi(listRoute, async (c) => {
  const { status, page, pageSize } = c.req.valid("query");
  const { items, total } = await listAccessRequests({ status, page, pageSize });
  return c.json({ items: items.map(serializeAccessRequest), page, pageSize, total }, 200);
});

// ─── POST /admin/access-requests/:id/approve ──────────────────────────────────

const approveRoute = createRoute({
  method: "post",
  path: "/admin/access-requests/{id}/approve",
  tags: ["Admin"],
  summary: "Approve an access request: creates the invitation and emails it",
  request: {
    params: AccessRequestIdParamSchema,
    body: { content: { "application/json": { schema: ApproveAccessRequestBodySchema } }, required: false },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ApproveAccessRequestResponseSchema } },
      description: "The approved request and its invitation (`emailDelivery` sent or failed)",
    },
    ...authResponses,
    404: problemResponse("No access request with this id"),
    409: problemResponse("`already_decided`, `active_user_exists` or `pending_invitation_exists` (AC-3.5, AC-3.6)"),
    422: problemResponse("Unknown role/department id(s), or `domain_not_allowed` (the list may have shrunk)"),
  },
});

accessRequestsRouter.openapi(approveRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json") ?? { roleIds: [], departmentIds: [] };
  const actor = c.get("user")!;

  const existing = await findAccessRequestById(id);
  if (!existing) return c.json(problem(404, "Not Found", c.req.path, `No access request with id "${id}"`), 404);
  if (existing.status !== "pending") return c.json(alreadyDecided(c.req.path), 409);

  // The same checks `POST /admin/invitations` makes (AC-3.5, AC-5.1).
  const validated = await validateInvitation({
    email: existing.email,
    roleIds: body.roleIds,
    departmentIds: body.departmentIds,
  });
  if (!validated.ok) {
    const refusal = validated.problem;
    if (refusal.status === 409) {
      return c.json(
        problem(409, "Conflict", c.req.path, refusal.detail, { code: refusal.code }),
        409,
      );
    }
    const { detail, code, allowedDomains } = refusal;
    return c.json(
      problem(422, "Unprocessable Entity", c.req.path, detail, {
        ...(code !== undefined ? { code } : {}),
        ...(allowedDomains !== undefined ? { allowedDomains } : {}),
      }),
      422,
    );
  }
  const { value } = validated;

  const token = await generateInvitationToken();
  let created;
  try {
    created = await withAudit({
      affectedUserIds: [],
      mutate: async (tx) => {
        // 1. CAS: exactly one decision wins; a throw below rolls this back.
        const won = await decideIfPending(tx, { id, status: "approved", decidedByUserId: actor.id });
        if (!won) throw new AlreadyDecidedError();
        // 2-3. The invitation, exactly as a direct invite creates it, then link it.
        const invitation = await createInvitationInTx(tx, { value, invitedByUserId: actor.id, token });
        await linkInvitation(tx, id, invitation.id);
        return invitation;
      },
      entry: (invitation) => [
        {
          actorUserId: actor.id,
          action: "invitation.create",
          targetType: "invitation",
          targetId: invitation.id,
          summary: `Invited ${invitation.email}`,
          data: { roleIds: value.roleIds, departmentIds: value.departmentIds },
        },
        {
          actorUserId: actor.id,
          action: "access_request.approve",
          targetType: "access_request",
          targetId: id,
          summary: `Approved access request from ${value.email}`,
          data: {
            email: value.email,
            invitationId: invitation.id,
            roleIds: value.roleIds,
            departmentIds: value.departmentIds,
          },
        },
      ],
    });
  } catch (error) {
    if (error instanceof AlreadyDecidedError) return c.json(alreadyDecided(c.req.path), 409);
    // A concurrent direct invite won the partial unique index between check and insert.
    if (isUniqueConstraintViolation(error)) {
      return c.json(
        problem(409, "Conflict", c.req.path, `A pending invitation already exists for "${value.email}"`, {
          code: "pending_invitation_exists",
        }),
        409,
      );
    }
    throw error;
  }

  // After commit: a failed send leaves the request approved and the invitation resendable (AC-3.7).
  const delivered = await deliverInvitationEmail(created, token.raw, actor.name);
  const decided = (await findAccessRequestById(id))!;
  return c.json(
    { request: serializeAccessRequest(decided), invitation: await serializeInvitation(delivered) },
    200,
  );
});

// ─── POST /admin/access-requests/:id/reject ───────────────────────────────────

const rejectRoute = createRoute({
  method: "post",
  path: "/admin/access-requests/{id}/reject",
  tags: ["Admin"],
  summary: "Reject an access request (sends nothing)",
  request: { params: AccessRequestIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: AccessRequestDetailSchema } },
      description: "The rejected request",
    },
    ...authResponses,
    404: problemResponse("No access request with this id"),
    409: problemResponse("`already_decided` (AC-3.6)"),
  },
});

accessRequestsRouter.openapi(rejectRoute, async (c) => {
  const { id } = c.req.valid("param");
  const actor = c.get("user")!;

  const existing = await findAccessRequestById(id);
  if (!existing) return c.json(problem(404, "Not Found", c.req.path, `No access request with id "${id}"`), 404);

  try {
    await withAudit({
      affectedUserIds: [],
      mutate: async (tx) => {
        const won = await decideIfPending(tx, { id, status: "rejected", decidedByUserId: actor.id });
        if (!won) throw new AlreadyDecidedError();
      },
      entry: {
        actorUserId: actor.id,
        action: "access_request.reject",
        targetType: "access_request",
        targetId: id,
        summary: `Rejected access request from ${existing.email}`,
        data: { email: existing.email },
      },
    });
  } catch (error) {
    if (error instanceof AlreadyDecidedError) return c.json(alreadyDecided(c.req.path), 409);
    throw error;
  }

  return c.json(serializeAccessRequest((await findAccessRequestById(id))!), 200);
});
