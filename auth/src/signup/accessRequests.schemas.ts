/**
 * Zod wire schemas for the access-request admin API (T7, specs/20261105-signup-gate —
 * plan.md § API contracts).
 */

import { z } from "zod";
import { InvitationDetailSchema, ProblemJsonSchema } from "../invitations/invitations.schemas";

export const ACCESS_REQUEST_STATUS_VALUES = ["pending", "approved", "rejected"] as const;
export const ACCESS_REQUEST_PROVIDER_VALUES = ["google", "github", "unknown"] as const;

export const ListAccessRequestsQuerySchema = z.object({
  status: z.enum(ACCESS_REQUEST_STATUS_VALUES).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const AccessRequestIdParamSchema = z.object({ id: z.string().min(1) });

export const ApproveAccessRequestBodySchema = z.object({
  roleIds: z.array(z.string().min(1)).optional().default([]),
  departmentIds: z.array(z.string().min(1)).optional().default([]),
});

export const AccessRequestDetailSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  provider: z.enum(ACCESS_REQUEST_PROVIDER_VALUES),
  status: z.enum(ACCESS_REQUEST_STATUS_VALUES),
  firstRequestedAt: z.string().datetime(),
  requestedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  decidedBy: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  invitationId: z.string().nullable(),
});

export const AccessRequestListResponseSchema = z.object({
  items: z.array(AccessRequestDetailSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const ApproveAccessRequestResponseSchema = z.object({
  request: AccessRequestDetailSchema,
  invitation: InvitationDetailSchema,
});

/** A problem with the optional machine-readable extensions admin-ui branches on (never on `detail`). */
export const AccessRequestProblemSchema = ProblemJsonSchema.extend({
  code: z
    .enum(["already_decided", "active_user_exists", "pending_invitation_exists", "domain_not_allowed"])
    .optional(),
  allowedDomains: z.array(z.string()).optional(),
});

export type AccessRequestDetail = z.infer<typeof AccessRequestDetailSchema>;
