import { Injectable } from "@nestjs/common";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { stringify } from "csv-stringify/sync";
import type {
  ConfirmCsvImportBody,
  CreateCsvImportBody,
  CreatedCsvImport,
  ImportRun,
} from "@guidesk/contracts";
import { importItem, importRun, lockPropertySlots, upload } from "@guidesk/db";
import {
  csvDelimiter,
  csvErrorFileRows,
  csvTemplateRows,
  JOB_QUEUES,
  roomLeft,
  type CsvIssue,
  type CsvLanguage,
} from "@guidesk/domain";
import { assertUuid } from "../common/ids.js";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { UploadsService } from "../uploads/uploads.service.js";
import { toImportRun } from "./import-runs.service.js";

interface Caller {
  userId: string;
}

/** The error file can be downloaded for 7 days after the run finishes (data model §4). */
const ERROR_FILE_DAYS = 7;
const DAY_MS = 86_400_000;

/** A UTF-8 byte-order mark, so spreadsheets read accents correctly. */
const BOM = "\ufeff";

/** Writes rows as a CSV file for spreadsheets: byte-order mark, CRLF, and the host's separator. */
function toCsvFile(rows: string[][], language: CsvLanguage): string {
  return BOM + stringify(rows, { delimiter: csvDelimiter(language), record_delimiter: "windows" });
}

/**
 * CSV import (feature 002 US5, contracts/http-api.md, T109): the template, the upload form,
 * validation, confirming the rows within the free slots, cancelling, and the error file. Parsing
 * and creation run in the worker (`csv.validate`, `csv.import`).
 *
 * Calendar links are never selected here: `import_item.calendar_url_ciphertext` is not readable
 * by the API's role. Confirming and cancelling only set it to null.
 */
@Injectable()
export class CsvImportsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly uploads: UploadsService,
    private readonly jobs: JobQueueService,
    private readonly securityLog: SecurityLogService,
    private readonly crossTenant: CrossTenantService,
  ) {}

  /** The template in the host's language (FR-037). */
  template(language: CsvLanguage): string {
    return toCsvFile(csvTemplateRows(language), language);
  }

  private async loadRun(workspaceId: string, importRunId: string) {
    assertUuid(importRunId);
    const [run] = await this.requestDb
      .current()
      .select()
      .from(importRun)
      .where(and(eq(importRun.id, importRunId), eq(importRun.workspaceId, workspaceId)))
      .limit(1);
    if (!run) {
      // The same 404 for another workspace's run, which is logged there (AC-SEC-009).
      throw await this.crossTenant.notFoundInRequest(
        this.requestDb.current(),
        workspaceId,
        "import_run",
        importRunId,
      );
    }
    return run;
  }

  private async loadCsvRun(workspaceId: string, importRunId: string) {
    const run = await this.loadRun(workspaceId, importRunId);
    if (run.kind !== "csv") throw new ApiProblem(404, "not_found");
    return run;
  }

  /** Creates the run and the upload form for one file of at most 2 MB (FR-038). */
  async create(
    caller: Caller,
    workspaceId: string,
    body: CreateCsvImportBody,
  ): Promise<CreatedCsvImport> {
    if (!UploadsService.accepts("csv", body)) {
      throw new ApiProblem(422, "validation_failed", "Upload a CSV file of at most 2 MB.", {
        fields: { file: ["Use a CSV file of at most 2 MB"] },
      });
    }
    const tx = this.requestDb.current();
    const [run] = await tx
      .insert(importRun)
      .values({ workspaceId, kind: "csv", status: "validating", startedBy: caller.userId })
      .returning({ id: importRun.id });
    const [form] = await this.uploads.createUploads(tx, {
      workspaceId,
      purpose: "csv",
      files: [body],
      createdBy: caller.userId,
      importRunId: run!.id,
    });
    await tx.update(importRun).set({ uploadId: form!.uploadId }).where(eq(importRun.id, run!.id));
    return { importRunId: run!.id, upload: form! };
  }

  /** Called once the upload is done: the worker reads and validates the file (FR-039). */
  async validate(workspaceId: string, importRunId: string): Promise<void> {
    const run = await this.loadCsvRun(workspaceId, importRunId);
    if (run.status !== "validating" || !run.uploadId) {
      throw new ApiProblem(409, "conflict", "This file was already sent for validation.");
    }
    const [received] = await this.requestDb
      .current()
      .update(upload)
      .set({ status: "received" })
      .where(and(eq(upload.id, run.uploadId), eq(upload.status, "pending")))
      .returning({ id: upload.id });
    if (!received) {
      throw new ApiProblem(409, "conflict", "This file was already sent for validation.");
    }
    await this.jobs.send(
      JOB_QUEUES.csvValidate,
      { importRunId, workspaceId },
      // It starts after this request commits, so the worker sees the upload as received.
      { singletonKey: `csv-validate:${importRunId}`, startAfter: 1, retryLimit: 3, retryDelay: 2 },
    );
  }

  /**
   * Creates the valid rows in the background (FR-040). When they are more than the free slots,
   * the host chooses which (US5 scenario 5); rows left out are skipped, and every calendar link
   * that will not be read is set to null now.
   */
  async confirm(
    caller: Caller,
    workspaceId: string,
    importRunId: string,
    body: ConfirmCsvImportBody,
  ): Promise<ImportRun> {
    const run = await this.loadCsvRun(workspaceId, importRunId);
    if (run.status !== "awaiting_confirmation") {
      throw new ApiProblem(409, "conflict", "This file is not waiting for confirmation.");
    }
    const tx = this.requestDb.current();
    const slots = await lockPropertySlots(tx, workspaceId);
    if (!slots) throw new ApiProblem(404, "not_found");
    if (slots.workspaceStatus === "pending_deletion") {
      throw new ApiProblem(409, "workspace_pending_deletion");
    }
    const limit = slots.limit;
    const free = roomLeft(limit, slots.used);
    const valid = await tx
      .select({ id: importItem.id, rowNumber: importItem.rowNumber })
      .from(importItem)
      .where(and(eq(importItem.importRunId, run.id), eq(importItem.outcome, "pending")));
    if (valid.length === 0) {
      throw new ApiProblem(409, "conflict", "No row of this file can be created.");
    }
    if (free === 0) {
      throw new ApiProblem(409, "plan_limit_reached", undefined, {
        details: { limit, used: slots.used },
      });
    }
    const chooseRows = (message: string): never => {
      throw new ApiProblem(422, "validation_failed", "Choose which rows to create.", {
        fields: { rowNumbers: [message] },
        details: { free, limit },
      });
    };
    let chosen = valid;
    if (body.rowNumbers) {
      const wanted = new Set(body.rowNumbers);
      chosen = valid.filter((item) => item.rowNumber !== null && wanted.has(item.rowNumber));
      if (chosen.length !== wanted.size) chooseRows("Choose rows that can be created");
      if (chosen.length > free) chooseRows(`Choose up to ${free} rows`);
    } else if (valid.length > free) {
      chooseRows(`Choose up to ${free} rows`);
    }

    const chosenIds = chosen.map((item) => item.id);
    const left = valid.length - chosen.length;
    if (left > 0) {
      await tx
        .update(importItem)
        .set({ outcome: "skipped", reasonCode: "not_selected", selected: false })
        .where(
          and(
            eq(importItem.importRunId, run.id),
            eq(importItem.outcome, "pending"),
            notInArray(importItem.id, chosenIds),
          ),
        );
    }
    // Rows that will not be created keep no calendar link (data model §6).
    await tx
      .update(importItem)
      .set({ calendarUrlCiphertext: null, dataKeyId: null })
      .where(and(eq(importItem.importRunId, run.id), notInArray(importItem.id, chosenIds)));
    await tx.update(importItem).set({ selected: true }).where(inArray(importItem.id, chosenIds));
    const [started] = await tx
      .update(importRun)
      .set({
        status: "running",
        startedAt: new Date(),
        processed: sql`${importRun.processed} + ${left}`,
        skipped: sql`${importRun.skipped} + ${left}`,
      })
      .where(eq(importRun.id, run.id))
      .returning();
    await this.jobs.send(
      JOB_QUEUES.csvImport,
      { importRunId, workspaceId },
      { singletonKey: `import:${importRunId}`, startAfter: 2, retryLimit: 3, retryDelay: 5 },
    );
    await this.securityLog.record({
      type: "import.started",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "import_run",
      targetId: importRunId,
      metadata: { kind: "csv", total: chosen.length },
    });
    return toImportRun(started!, null, null);
  }

  /** Cancels a file before any row is created, clearing every calendar link it held. */
  async cancel(workspaceId: string, importRunId: string): Promise<ImportRun> {
    const run = await this.loadCsvRun(workspaceId, importRunId);
    if (run.status !== "validating" && run.status !== "awaiting_confirmation") {
      throw new ApiProblem(409, "conflict", "This import can no longer be cancelled.");
    }
    const tx = this.requestDb.current();
    await tx
      .update(importItem)
      .set({ calendarUrlCiphertext: null, dataKeyId: null })
      .where(eq(importItem.importRunId, run.id));
    const [cancelled] = await tx
      .update(importRun)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(importRun.id, run.id))
      .returning();
    return toImportRun(cancelled!, null, null);
  }

  /**
   * Every row with an error, with its reasons in the host's language, neutralized cells, and
   * empty calendar links (FR-039, FR-041, FR-042). Gone 7 days after the run finishes.
   */
  async errorFile(
    workspaceId: string,
    importRunId: string,
    language: CsvLanguage,
  ): Promise<string> {
    const run = await this.loadCsvRun(workspaceId, importRunId);
    const expired =
      run.finishedAt !== null && Date.now() - run.finishedAt.getTime() > ERROR_FILE_DAYS * DAY_MS;
    if (expired) throw new ApiProblem(410, "gone", "This error file is no longer available.");
    const items = await this.requestDb
      .current()
      .select({
        rowNumber: importItem.rowNumber,
        values: importItem.rowValues,
        errors: importItem.errors,
      })
      .from(importItem)
      .where(
        and(eq(importItem.importRunId, run.id), sql`jsonb_array_length(${importItem.errors}) > 0`),
      )
      .orderBy(importItem.rowNumber);
    // Row values are removed with the run's retention (data model §6).
    if (items.some((item) => item.values === null)) {
      throw new ApiProblem(410, "gone", "This error file is no longer available.");
    }
    const rows = csvErrorFileRows(
      items.map((item) => ({
        rowNumber: item.rowNumber ?? 0,
        values: item.values,
        errors: item.errors as CsvIssue[],
      })),
      language,
    );
    return toCsvFile(rows, language);
  }
}
