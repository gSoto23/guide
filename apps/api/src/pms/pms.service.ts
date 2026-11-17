import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type {
  CreatedPmsConnection,
  CreatePmsConnectionBody,
  ImportRun,
  PmsConnection,
  PmsConnectionList,
  PmsDisconnectResult,
  PmsListingList,
  PmsListingOption,
} from "@guidesk/contracts";
import { importItem, importRun, lockPropertySlots, pmsConnection, property } from "@guidesk/db";
import {
  JOB_QUEUES,
  propertyLimit,
  REFRESH_NOW_INTERVAL_MS,
  REFRESH_NOW_PRIORITY,
  type Role,
} from "@guidesk/domain";
import {
  PMS_HELP_URLS,
  PMS_TOKEN_INSTRUCTIONS,
  PmsCredentialError,
  type PmsListingSummary,
  type PmsPort,
  type PmsProvider,
} from "@guidesk/integrations";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { assertUuid } from "../common/ids.js";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { PMS_ADAPTERS, VAULT } from "../integrations/integrations.module.js";
import { toImportRun } from "../imports/import-runs.service.js";
import { JobCallError, JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

interface Caller {
  userId: string;
  role: Role;
}

/** The worker answers listing and revoke calls within this time (contracts, research R5). */
export const PMS_CALL_TIMEOUT_MS = 15_000;

/** Every column a request may read; the credential ciphertext is never selected (AC-SEC-008). */
const CONNECTION_COLUMNS = {
  id: pmsConnection.id,
  provider: pmsConnection.provider,
  accountLabel: pmsConnection.accountLabel,
  status: pmsConnection.status,
  lastRefreshAt: pmsConnection.lastRefreshAt,
  failingSince: pmsConnection.failingSince,
  lastErrorCode: pmsConnection.lastErrorCode,
  manualRefreshAt: pmsConnection.manualRefreshAt,
  connectedAt: pmsConnection.connectedAt,
};

interface ConnectionRow {
  id: string;
  provider: PmsProvider;
  accountLabel: string;
  status: "active" | "failing" | "disconnected";
  lastRefreshAt: Date | null;
  failingSince: Date | null;
  lastErrorCode: string | null;
  manualRefreshAt: Date | null;
  connectedAt: Date;
}

function toConnection(row: ConnectionRow): PmsConnection {
  return {
    id: row.id,
    provider: row.provider,
    accountLabel: row.accountLabel,
    status: row.status,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    failingSince: row.failingSince?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    connectedAt: row.connectedAt.toISOString(),
  };
}

/**
 * PMS connections (feature 002 FR-027 to FR-036, T093). The API sees the host's credential once,
 * on connect: it validates it with the provider, encrypts it, and never reads it back. Listing
 * again and revoking go through the worker, the only process that decrypts (research R5).
 */
@Injectable()
export class PmsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly jobs: JobQueueService,
    private readonly securityLog: SecurityLogService,
    @Inject(VAULT) private readonly vault: Vault,
    @Inject(PMS_ADAPTERS) private readonly adapters: Record<PmsProvider, PmsPort>,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private enabled(provider: PmsProvider): boolean {
    const flags = this.config.integrations.flags;
    return provider === "beds24" ? flags.pmsBeds24 : flags.pmsHostex;
  }

  /** A connection of this workspace whose provider is enabled; otherwise 404. */
  private async load(workspaceId: string, connectionId: string): Promise<ConnectionRow> {
    assertUuid(connectionId);
    const [row] = (await this.requestDb
      .current()
      .select(CONNECTION_COLUMNS)
      .from(pmsConnection)
      .where(and(eq(pmsConnection.id, connectionId), eq(pmsConnection.workspaceId, workspaceId)))
      .limit(1)) as ConnectionRow[];
    if (!row || !this.enabled(row.provider)) throw new ApiProblem(404, "not_found");
    return row;
  }

  private async withImported(
    workspaceId: string,
    provider: PmsProvider,
    listings: readonly PmsListingSummary[],
  ): Promise<PmsListingOption[]> {
    const ids = listings.map((listing) => listing.externalId);
    const existing =
      ids.length === 0
        ? []
        : await this.requestDb
            .current()
            .select({ id: property.id, externalId: property.externalId })
            .from(property)
            .where(
              and(
                eq(property.workspaceId, workspaceId),
                eq(property.sourceProvider, provider),
                eq(property.status, "active"),
                isNotNull(property.externalId),
                inArray(property.externalId, ids),
              ),
            );
    const byExternal = new Map(existing.map((row) => [row.externalId, row.id]));
    return listings.map((listing) => ({
      externalId: listing.externalId,
      name: listing.name.slice(0, 120),
      alreadyImported: byExternal.has(listing.externalId),
      propertyId: byExternal.get(listing.externalId) ?? null,
    }));
  }

  async list(workspaceId: string): Promise<PmsConnectionList> {
    const rows = (await this.requestDb
      .current()
      .select(CONNECTION_COLUMNS)
      .from(pmsConnection)
      .where(eq(pmsConnection.workspaceId, workspaceId))) as ConnectionRow[];
    return {
      items: rows
        .filter((row) => this.enabled(row.provider))
        .sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())
        .map(toConnection),
    };
  }

  async connect(
    caller: Caller,
    workspaceId: string,
    body: CreatePmsConnectionBody,
  ): Promise<CreatedPmsConnection> {
    if (!this.enabled(body.provider)) {
      throw new ApiProblem(422, "validation_failed", "This PMS is not available yet.", {
        fields: { provider: ["not_available"] },
      });
    }
    const adapter = this.adapters[body.provider];
    let connected;
    try {
      connected = await adapter.validateCredential(body.credential);
    } catch (error) {
      if (error instanceof PmsCredentialError) {
        throw new ApiProblem(422, "invalid_credential", undefined, {
          details: { provider: body.provider, helpUrl: PMS_HELP_URLS[body.provider] },
        });
      }
      throw new ApiProblem(502, "provider_unavailable");
    }
    // Listings are read with the value still in memory; it is never read back once stored.
    let listings: PmsListingSummary[];
    try {
      listings = await adapter.listListings(connected.credential);
    } catch {
      throw new ApiProblem(502, "provider_unavailable");
    }

    const tx = this.requestDb.current();
    const [current] = await tx
      .select({ id: pmsConnection.id })
      .from(pmsConnection)
      .where(
        and(
          eq(pmsConnection.workspaceId, workspaceId),
          eq(pmsConnection.provider, body.provider),
          eq(pmsConnection.externalAccountId, connected.externalAccountId),
          ne(pmsConnection.status, "disconnected"),
        ),
      )
      .limit(1);
    // Connecting the same account again replaces its credential (reconnect, T101).
    const id = current?.id ?? randomUUID();
    const { ciphertext, dataKeyId } = await this.vault.encrypt(
      createDataKeyStore(tx),
      { workspaceId, table: "pms_connection", column: "credential_ciphertext", rowId: id },
      connected.credential,
    );
    const values = {
      accountLabel: connected.accountLabel.slice(0, 80) || body.provider,
      credentialCiphertext: ciphertext,
      dataKeyId,
      status: "active" as const,
      failingSince: null,
      alertedAt: null,
      lastErrorCode: null,
      connectedBy: caller.userId,
      connectedAt: new Date(),
    };
    const [row] = (
      current
        ? await tx
            .update(pmsConnection)
            .set(values)
            .where(eq(pmsConnection.id, id))
            .returning(CONNECTION_COLUMNS)
        : await tx
            .insert(pmsConnection)
            .values({
              ...values,
              id,
              workspaceId,
              provider: body.provider,
              externalAccountId: connected.externalAccountId.slice(0, 120),
            })
            .returning(CONNECTION_COLUMNS)
    ) as ConnectionRow[];
    await this.securityLog.record({
      type: "integration.connected",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "pms_connection",
      targetId: id,
      metadata: { provider: body.provider },
    });
    return {
      ...toConnection(row!),
      listings: await this.withImported(workspaceId, body.provider, listings),
    };
  }

  /** The PMS listings again, for a later import (FR-033): asked of the worker. */
  async listings(workspaceId: string, connectionId: string): Promise<PmsListingList> {
    const connection = await this.load(workspaceId, connectionId);
    if (connection.status === "disconnected") throw new ApiProblem(409, "conflict");
    let listings: PmsListingSummary[] | undefined;
    try {
      const answer = await this.jobs.call<{ listings?: PmsListingSummary[] }>(
        JOB_QUEUES.pmsListings,
        { connectionId, workspaceId },
        PMS_CALL_TIMEOUT_MS,
      );
      listings = answer?.listings;
    } catch (error) {
      if (error instanceof JobCallError) throw new ApiProblem(502, "provider_unavailable");
      throw error;
    }
    if (!Array.isArray(listings)) throw new ApiProblem(502, "provider_unavailable");
    return { items: await this.withImported(workspaceId, connection.provider, listings) };
  }

  /** Starts a background import of the selected listings, capped at the free slots (FR-028). */
  async startImport(
    caller: Caller,
    workspaceId: string,
    connectionId: string,
    externalIds: readonly string[],
  ): Promise<ImportRun> {
    const connection = await this.load(workspaceId, connectionId);
    if (connection.status === "disconnected") throw new ApiProblem(409, "conflict");
    const tx = this.requestDb.current();
    const slots = await lockPropertySlots(tx, workspaceId);
    if (!slots) throw new ApiProblem(404, "not_found");
    if (slots.workspaceStatus === "pending_deletion") {
      throw new ApiProblem(409, "workspace_pending_deletion");
    }
    const limit = propertyLimit(slots.propertyLimit);
    const unique = [...new Set(externalIds)];
    // Listings already imported are updated, not created, so they take no slot (FR-033).
    const imported = await this.withImported(
      workspaceId,
      connection.provider,
      unique.map((externalId) => ({ externalId, name: externalId })),
    );
    let free = Math.max(0, limit - slots.used);
    if (free === 0 && imported.every((listing) => !listing.alreadyImported)) {
      throw new ApiProblem(409, "plan_limit_reached", undefined, {
        details: { limit, used: slots.used },
      });
    }
    const items = imported.map((listing) => {
      const fits = listing.alreadyImported || free > 0;
      if (!listing.alreadyImported && fits) free -= 1;
      return { listing, fits };
    });
    const now = new Date();
    const [run] = await tx
      .insert(importRun)
      .values({
        workspaceId,
        kind: "pms",
        pmsConnectionId: connectionId,
        status: "running",
        total: items.length,
        processed: items.filter((item) => !item.fits).length,
        skipped: items.filter((item) => !item.fits).length,
        startedBy: caller.userId,
        startedAt: now,
      })
      .returning();
    await tx.insert(importItem).values(
      items.map(({ listing, fits }) => ({
        workspaceId,
        importRunId: run!.id,
        externalId: listing.externalId,
        // The worker replaces it with the listing's name.
        label: listing.externalId.slice(0, 120),
        outcome: fits ? ("pending" as const) : ("skipped" as const),
        reasonCode: fits ? null : "plan_limit",
        propertyId: listing.propertyId,
      })),
    );
    await this.jobs.send(
      JOB_QUEUES.pmsImport,
      { importRunId: run!.id, workspaceId },
      // It starts after this request commits, so the worker sees the run and its items.
      { singletonKey: `import:${run!.id}`, startAfter: 2, retryLimit: 3, retryDelay: 5 },
    );
    await this.securityLog.record({
      type: "import.started",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "import_run",
      targetId: run!.id,
      metadata: { kind: "pms", total: items.length },
    });
    return toImportRun(run!, connection.provider, null);
  }

  /** "Refresh now" for reservations, once every 5 minutes per connection (FR-035). */
  async refreshNow(workspaceId: string, connectionId: string): Promise<void> {
    const connection = await this.load(workspaceId, connectionId);
    if (connection.status === "disconnected") throw new ApiProblem(409, "conflict");
    const now = new Date();
    if (
      connection.manualRefreshAt &&
      now.getTime() - connection.manualRefreshAt.getTime() < REFRESH_NOW_INTERVAL_MS
    ) {
      const retryAfterSeconds = Math.ceil(
        (connection.manualRefreshAt.getTime() + REFRESH_NOW_INTERVAL_MS - now.getTime()) / 1000,
      );
      throw new ApiProblem(409, "refresh_too_soon", undefined, {
        details: { retryAfterSeconds },
        retryAfterSeconds,
      });
    }
    await this.requestDb
      .current()
      .update(pmsConnection)
      .set({ manualRefreshAt: now })
      .where(eq(pmsConnection.id, connectionId));
    await this.jobs.send(
      JOB_QUEUES.pmsRefresh,
      { connectionId, workspaceId, full: true },
      { priority: REFRESH_NOW_PRIORITY, singletonKey: `pms:${connectionId}` },
    );
  }

  /**
   * Disconnect (FR-036). Beds24's token is revoked through the worker first, waiting up to 15
   * seconds; then, whatever happened, the credential is set to null in one statement. When the
   * provider did not revoke it, the host is told to delete it there too.
   */
  async disconnect(
    caller: Caller,
    workspaceId: string,
    connectionId: string,
  ): Promise<PmsDisconnectResult> {
    const connection = await this.load(workspaceId, connectionId);
    if (connection.status === "disconnected") {
      return {
        providerRevoked: false,
        instructionsUrl: PMS_TOKEN_INSTRUCTIONS[connection.provider],
      };
    }
    let providerRevoked = false;
    if (connection.provider === "beds24") {
      try {
        const result = await this.jobs.call<{ providerRevoked?: boolean }>(
          JOB_QUEUES.pmsRevoke,
          { connectionId, workspaceId },
          PMS_CALL_TIMEOUT_MS,
        );
        providerRevoked = result?.providerRevoked === true;
      } catch {
        providerRevoked = false;
      }
    }
    await this.requestDb
      .current()
      .update(pmsConnection)
      .set({
        credentialCiphertext: null,
        status: "disconnected",
        disconnectedAt: new Date(),
        disconnectedBy: caller.userId,
      })
      .where(eq(pmsConnection.id, connectionId));
    await this.securityLog.record({
      type: "integration.disconnected",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "pms_connection",
      targetId: connectionId,
      metadata: { provider: connection.provider, providerRevoked },
    });
    return {
      providerRevoked,
      instructionsUrl: providerRevoked ? null : PMS_TOKEN_INSTRUCTIONS[connection.provider],
    };
  }
}
