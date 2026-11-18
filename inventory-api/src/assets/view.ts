/**
 * The `AssetView` serializer (T11, specs/20261006-hardware-inventory; plan.md § Shared
 * shapes). It builds everything EXCEPT `ledger`: that projection depends on the
 * caller holding `ledger:manage` and is added by T12's `ledgerView.ts`, so an
 * inventory manager's response can never carry a schedule by construction.
 *
 * Holder and assignee names are resolved live (ADR 20260807-live-identity-resolution-by-id-fail-soft) by the caller and passed
 * in as a map; this module does no I/O.
 */

import type { Asset } from "../lib/generated/prisma/client";
import type { Identity } from "../lib/identities";
import { formatDate } from "../depreciation/rules.schemas";
import { nextReminderAt } from "../assignments/reminderClock";

/** An asset row with the file link the view needs. */
export type AssetRow = Asset & {
  readonly invoiceFile: { readonly id: string; readonly fileName: string } | null;
  readonly holderOffice: OfficeRef | null;
};

/**
 * An office as an asset shows it (specs/20261006-hardware-inventory US-14): id and name only. The office's entity is
 * not repeated on the asset, so an asset's view never names the other entity (the office list carries it).
 */
export interface OfficeRef {
  readonly id: string;
  readonly name: string;
}

/** The relations every asset read uses: its invoice file and the office holding it. */
export const ASSET_INCLUDE = {
  invoiceFile: { select: { id: true, fileName: true } },
  holderOffice: { select: { id: true, name: true } },
} as const;

export interface PendingAssignmentRow {
  readonly id: string;
  readonly assigneeUserId: string;
  readonly createdAt: Date;
  /** Reminders to confirm (US-15); absent on rows read without them. */
  readonly lastReminderAt?: Date | null;
  readonly reminderCount?: number;
}

export interface AssetViewBase {
  id: string;
  entity: "welld_ch" | "welld_it";
  currency: "CHF" | "EUR";
  category: Asset["category"];
  description: string;
  serialNumber: string | null;
  purchaseDate: string;
  purchasePriceCents: number;
  status: Asset["status"];
  holder: Identity | null;
  /** The office holding the asset; never together with `holder`. */
  office: OfficeRef | null;
  pendingAssignment: {
    id: string;
    assignee: Identity;
    createdAt: string;
    /** US-15: how many reminders went out, the last one, and when the next automatic one is due. */
    reminderCount: number;
    lastReminderAt: string | null;
    nextReminderAt: string | null;
  } | null;
  locationNote: string | null;
  supplier: string | null;
  invoiceRef: string | null;
  invoiceFile: { id: string; fileName: string } | null;
  toVerify: boolean;
  disposal: {
    disposedOn: string;
    reason: NonNullable<Asset["disposalReason"]>;
    salePriceCents: number | null;
  } | null;
}

const unknownIdentity = (id: string): Identity => ({ id, name: null, status: "unknown" });

/** Every user id a set of rows needs resolved (holders and pending assignees). */
export function identityIdsOf(
  rows: readonly Pick<Asset, "holderUserId">[],
  pendings: readonly PendingAssignmentRow[],
): string[] {
  const ids = new Set<string>();
  for (const row of rows) if (row.holderUserId) ids.add(row.holderUserId);
  for (const pending of pendings) ids.add(pending.assigneeUserId);
  return [...ids];
}

export function toAssetView(
  row: AssetRow,
  context: {
    readonly identities: ReadonlyMap<string, Identity>;
    readonly pending: PendingAssignmentRow | null;
  },
): AssetViewBase {
  const identity = (id: string): Identity => context.identities.get(id) ?? unknownIdentity(id);
  return {
    id: row.id,
    entity: row.entity,
    currency: row.currency,
    category: row.category,
    description: row.description,
    serialNumber: row.serialNumber,
    purchaseDate: formatDate(row.purchaseDate),
    purchasePriceCents: row.purchasePriceCents,
    status: row.status,
    holder: row.holderUserId ? identity(row.holderUserId) : null,
    office: row.holderOffice ? { id: row.holderOffice.id, name: row.holderOffice.name } : null,
    pendingAssignment: context.pending
      ? {
          id: context.pending.id,
          assignee: identity(context.pending.assigneeUserId),
          createdAt: context.pending.createdAt.toISOString(),
          reminderCount: context.pending.reminderCount ?? 0,
          lastReminderAt: context.pending.lastReminderAt?.toISOString() ?? null,
          nextReminderAt:
            nextReminderAt({ status: "pending", createdAt: context.pending.createdAt, lastReminderAt: context.pending.lastReminderAt ?? null })?.toISOString() ?? null,
        }
      : null,
    locationNote: row.locationNote,
    supplier: row.supplier,
    invoiceRef: row.invoiceRef,
    invoiceFile: row.invoiceFile ? { id: row.invoiceFile.id, fileName: row.invoiceFile.fileName } : null,
    toVerify: row.toVerify,
    disposal:
      row.disposedOn && row.disposalReason
        ? {
            disposedOn: formatDate(row.disposedOn),
            reason: row.disposalReason,
            salePriceCents: row.salePriceCents,
          }
        : null,
  };
}
