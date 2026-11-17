import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ImportItemList, ImportRun, ImportRunList } from "@guidesk/contracts";
import { importItem, importRun, pmsConnection, upload } from "@guidesk/db";
import { JOB_QUEUES } from "@guidesk/domain";
import type { PmsProvider } from "@guidesk/integrations";
import { assertUuid } from "../common/ids.js";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";

type RunRow = typeof importRun.$inferSelect;

export function toImportRun(
  row: RunRow,
  provider: PmsProvider | null,
  rejectReason: string | null,
): ImportRun {
  return {
    id: row.id,
    kind: row.kind,
    provider,
    status: row.status,
    total: row.total,
    processed: row.processed,
    created: row.created,
    needsDetails: row.needsDetails,
    failed: row.failed,
    skipped: row.skipped,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    // Why a CSV file could not be used, kept on its upload (data model §2).
    errorCode: row.status === "failed" && row.kind === "csv" ? rejectReason : null,
  };
}

/**
 * Import runs shared by PMS and CSV imports (feature 002 FR-029, FR-032, T094): the portal's
 * progress banner, per-item results, and retrying one failed PMS listing.
 */
@Injectable()
export class ImportRunsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly jobs: JobQueueService,
  ) {}

  private runs() {
    return this.requestDb
      .current()
      .select({
        run: importRun,
        provider: pmsConnection.provider,
        rejectReason: upload.rejectReason,
      })
      .from(importRun)
      .leftJoin(pmsConnection, eq(pmsConnection.id, importRun.pmsConnectionId))
      .leftJoin(upload, eq(upload.id, importRun.uploadId));
  }

  async list(workspaceId: string, status?: ImportRun["status"]): Promise<ImportRunList> {
    const rows = await this.runs()
      .where(
        and(
          eq(importRun.workspaceId, workspaceId),
          ...(status ? [eq(importRun.status, status)] : []),
        ),
      )
      .orderBy(desc(importRun.createdAt))
      .limit(20);
    return {
      items: rows.map(({ run, provider, rejectReason }) =>
        toImportRun(run, provider, rejectReason),
      ),
    };
  }

  async get(workspaceId: string, importRunId: string): Promise<ImportRun> {
    assertUuid(importRunId);
    const [row] = await this.runs()
      .where(and(eq(importRun.id, importRunId), eq(importRun.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    return toImportRun(row.run, row.provider, row.rejectReason);
  }

  async items(
    workspaceId: string,
    importRunId: string,
    outcome?: ImportItemList["items"][number]["outcome"],
  ): Promise<ImportItemList> {
    await this.get(workspaceId, importRunId);
    const rows = await this.requestDb
      .current()
      .select({
        id: importItem.id,
        externalId: importItem.externalId,
        rowNumber: importItem.rowNumber,
        label: importItem.label,
        selected: importItem.selected,
        outcome: importItem.outcome,
        reasonCode: importItem.reasonCode,
        propertyId: importItem.propertyId,
        errors: importItem.errors,
        warnings: importItem.warnings,
      })
      .from(importItem)
      .where(
        and(
          eq(importItem.importRunId, importRunId),
          ...(outcome ? [eq(importItem.outcome, outcome)] : []),
        ),
      )
      .orderBy(importItem.rowNumber, importItem.label);
    return { items: rows };
  }

  /** Retries one failed PMS listing (FR-032): the item goes back to pending and the run resumes. */
  async retryItem(workspaceId: string, importRunId: string, itemId: string): Promise<ImportRun> {
    assertUuid(importRunId);
    assertUuid(itemId);
    const tx = this.requestDb.current();
    const [row] = await this.runs()
      .where(and(eq(importRun.id, importRunId), eq(importRun.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    if (row.run.kind !== "pms") throw new ApiProblem(409, "conflict");
    const [item] = await tx
      .update(importItem)
      .set({ outcome: "pending", reasonCode: null })
      .where(
        and(
          eq(importItem.id, itemId),
          eq(importItem.importRunId, importRunId),
          eq(importItem.outcome, "failed"),
        ),
      )
      .returning({ id: importItem.id });
    if (!item) throw new ApiProblem(409, "conflict", "Only a failed listing can be retried.");
    const [run] = await tx
      .update(importRun)
      .set({
        status: "running",
        failed: sql`greatest(${importRun.failed} - 1, 0)`,
        processed: sql`greatest(${importRun.processed} - 1, 0)`,
        finishedAt: null,
      })
      .where(eq(importRun.id, importRunId))
      .returning();
    await this.jobs.send(
      JOB_QUEUES.pmsImport,
      { importRunId, workspaceId },
      { singletonKey: `import:${importRunId}`, startAfter: 2, retryLimit: 3, retryDelay: 5 },
    );
    return toImportRun(run!, row.provider, null);
  }
}
