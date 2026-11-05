/**
 * The single serializer for `InvitationDetail` — shared by the invitation admin
 * routes and the access-request approval so the wire shape never drifts.
 * Kept out of any router module so routers do not import each other.
 */

import { db } from "../lib/db";
import type { Invitation } from "../lib/generated/prisma/client";
import { effectiveInvitationStatus } from "./invitations.repo";

async function summarizeRoles(ids: string[]) {
  if (ids.length === 0) return [];
  return db.role.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function summarizeDepartments(ids: string[]) {
  if (ids.length === 0) return [];
  return db.department.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function summarizeInviter(userId: string | null) {
  if (!userId) return null;
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
}

/** The single serializer for `InvitationDetail` — used by create/resend/revoke/list so the wire shape never drifts between endpoints. */
export async function serializeInvitation(invitation: Invitation) {
  const [roles, departments, invitedBy] = await Promise.all([
    summarizeRoles(invitation.roleIds),
    summarizeDepartments(invitation.departmentIds),
    summarizeInviter(invitation.invitedByUserId),
  ]);

  const effectiveStatus = effectiveInvitationStatus(invitation);

  return {
    id: invitation.id,
    email: invitation.email,
    status: effectiveStatus,
    roles,
    departments,
    invitedBy,
    invitedAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.status === "accepted" ? invitation.updatedAt.toISOString() : null,
    emailDelivery: (invitation.lastEmailStatus as "sent" | "failed" | null) ?? null,
  };
}
