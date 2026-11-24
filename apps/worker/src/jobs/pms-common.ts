import { and, eq, inArray, sql } from "drizzle-orm";
import { pmsConnection, securityEvent, stay, type Database } from "@guidesk/db";
import {
  assertSafeMetadata,
  planPmsStays,
  type PmsReservationInput,
  type SecurityEventType,
} from "@guidesk/domain";
import type { PmsPort, PmsProvider } from "@guidesk/integrations";
import { createDataKeyStore } from "@guidesk/vault";
import type { VaultDecrypter } from "@guidesk/vault/decrypt";
import { reconcileDuplicates } from "./calendar-refresh.js";

/** What every PMS job needs (research R5, R7). Only the worker decrypts credentials. */
export interface PmsJobDeps {
  db: Database;
  decrypter: VaultDecrypter;
  adapters: Record<PmsProvider, PmsPort>;
  now?: () => Date;
}

export interface LoadedConnection {
  id: string;
  workspaceId: string;
  provider: PmsProvider;
  accountLabel: string;
  status: "active" | "failing" | "disconnected";
  lastRefreshAt: Date | null;
  failingSince: Date | null;
  alertedAt: Date | null;
  /** Null when the connection is disconnected: nothing may be requested (AC-SEC-011). */
  credential: string | null;
}

/** Loads a connection of a workspace and decrypts its credential, if it still has one. */
export async function loadConnection(
  deps: PmsJobDeps,
  workspaceId: string,
  connectionId: string,
): Promise<LoadedConnection | null> {
  const [row] = await deps.db
    .select()
    .from(pmsConnection)
    .where(and(eq(pmsConnection.id, connectionId), eq(pmsConnection.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const credential =
    row.status !== "disconnected" && row.credentialCiphertext && row.dataKeyId
      ? await deps.decrypter.decryptText(
          createDataKeyStore(deps.db),
          {
            workspaceId,
            table: "pms_connection",
            column: "credential_ciphertext",
            rowId: row.id,
            dataKeyId: row.dataKeyId,
          },
          row.credentialCiphertext,
        )
      : null;
  return {
    id: row.id,
    workspaceId,
    provider: row.provider,
    accountLabel: row.accountLabel,
    status: row.status,
    lastRefreshAt: row.lastRefreshAt,
    failingSince: row.failingSince,
    alertedAt: row.alertedAt,
    credential,
  };
}

/** A security event from the worker, with the same metadata rules as the API (T015). */
export async function recordEvent(
  db: Database,
  event: {
    type: SecurityEventType;
    workspaceId: string;
    actorUserId?: string | null;
    targetType: string;
    targetId: string;
    metadata: Record<string, string | number | boolean>;
  },
): Promise<void> {
  assertSafeMetadata(event.metadata, event.type);
  await db.insert(securityEvent).values({
    type: event.type,
    outcome: "success",
    actorUserId: event.actorUserId ?? null,
    workspaceId: event.workspaceId,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata,
  });
}

/**
 * Applies reservations to the stays of a connection's properties (FR-030, FR-034, FR-053), then
 * reconciles duplicates with feed stays, where the PMS stay wins.
 */
export async function applyReservations(
  db: Database,
  input: {
    workspaceId: string;
    connectionId: string;
    propertyByListing: ReadonlyMap<string, string>;
    reservations: readonly PmsReservationInput[];
    today: string;
    fullRead: boolean;
    now: Date;
  },
): Promise<{ created: number; updated: number; cancelled: number }> {
  const propertyIds = [...new Set(input.propertyByListing.values())];
  if (propertyIds.length === 0) return { created: 0, updated: 0, cancelled: 0 };
  const existing = await db
    .select({
      id: stay.id,
      externalUid: stay.externalUid,
      propertyId: stay.propertyId,
      status: stay.status,
      checkInDate: stay.checkInDate,
      checkoutDate: stay.checkoutDate,
      guestCount: stay.guestCount,
      guestName: stay.guestName,
      guestNameRemovedAt: stay.guestNameRemovedAt,
      bookingReference: stay.bookingReference,
      channel: stay.channel,
    })
    .from(stay)
    .where(
      and(eq(stay.pmsConnectionId, input.connectionId), inArray(stay.propertyId, propertyIds)),
    );
  const plan = planPmsStays({
    today: input.today,
    propertyByListing: input.propertyByListing,
    fullRead: input.fullRead,
    reservations: input.reservations,
    existing: existing.map((row) => ({
      id: row.id,
      externalUid: row.externalUid ?? "",
      propertyId: row.propertyId,
      status: row.status,
      checkInDate: row.checkInDate,
      checkoutDate: row.checkoutDate,
      guestCount: row.guestCount,
      guestName: row.guestName,
      guestNameRemoved: row.guestNameRemovedAt !== null,
      bookingReference: row.bookingReference,
      channel: row.channel,
    })),
  });
  await db.transaction(async (tx) => {
    if (plan.create.length > 0) {
      await tx.insert(stay).values(
        plan.create.map((entry) => ({
          workspaceId: input.workspaceId,
          propertyId: entry.propertyId,
          source: "pms" as const,
          pmsConnectionId: input.connectionId,
          externalUid: entry.externalUid,
          checkInDate: entry.checkInDate,
          checkoutDate: entry.checkoutDate,
          channel: entry.channel,
          guestCount: entry.guestCount,
          guestName: entry.guestName ?? null,
          guestDetailsSource:
            entry.guestName || entry.guestCount !== null ? ("pms" as const) : null,
          bookingReference: entry.bookingReference,
          lastSeenAt: input.now,
        })),
      );
    }
    for (const change of plan.update) {
      await tx
        .update(stay)
        .set({
          checkInDate: change.checkInDate,
          checkoutDate: change.checkoutDate,
          // Feature 018 FR-016: details the host typed in Guidesk win over the PMS.
          guestCount: sql`CASE WHEN ${stay.guestDetailsSource} = 'host' THEN ${stay.guestCount} ELSE ${change.guestCount} END`,
          bookingReference: change.bookingReference,
          channel: change.channel,
          ...(change.guestName !== undefined
            ? {
                guestName: sql`CASE WHEN ${stay.guestDetailsSource} = 'host' THEN ${stay.guestName} ELSE ${change.guestName} END`,
              }
            : {}),
          guestDetailsSource: sql`CASE WHEN ${stay.guestDetailsSource} = 'host' THEN 'host' WHEN ${change.guestName ?? null}::text IS NOT NULL OR ${change.guestCount}::int IS NOT NULL THEN 'pms' ELSE ${stay.guestDetailsSource} END`,
          status: "active",
          cancelledAt: null,
          lastSeenAt: input.now,
        })
        .where(eq(stay.id, change.id));
    }
    if (plan.cancel.length > 0) {
      await tx
        .update(stay)
        .set({ status: "cancelled", cancelledAt: input.now })
        .where(inArray(stay.id, plan.cancel));
    }
    for (const propertyId of propertyIds) {
      await reconcileDuplicates(tx as unknown as Database, propertyId);
    }
  });
  return {
    created: plan.create.length,
    updated: plan.update.length,
    cancelled: plan.cancel.length,
  };
}

/** `YYYY-MM-DD` a number of days after a date, in UTC. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "Today" for PMS reads: yesterday in UTC, so a stay checking out today in any time zone still
 * counts as upcoming. One day of extra past stays is harmless; a missing current stay is not.
 */
export function pmsToday(now: Date): string {
  return addDays(now.toISOString().slice(0, 10), -1);
}
