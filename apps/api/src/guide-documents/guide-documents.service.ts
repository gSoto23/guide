import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type {
  CreateDocumentsBody,
  DocumentList,
  DocumentUpload,
  DocumentView,
} from "@guidesk/contracts";
import { guideDocument, guideItem, upload } from "@guidesk/db";
import { JOB_QUEUES, type GuideDocumentJob } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { GuideViewService, type Caller } from "../guides/guide-view.service.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { UploadsService } from "../uploads/uploads.service.js";

type DocumentRow = typeof guideDocument.$inferSelect;

/** A file name safe for labels: no paths, no control characters, at most 120 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (clean || "file").slice(0, 120);
}

/**
 * Manuals and photos read for knowledge (feature 003 US6, contract "Documents", FR-039 to
 * FR-043): presigned forms to the uploads bucket, then `guide.document` reads the text in the
 * sandbox and suggests section content. No file bytes pass through the API.
 */
@Injectable()
export class GuideDocumentsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly uploads: UploadsService,
    private readonly jobs: JobQueueService,
    private readonly crossTenant: CrossTenantService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  async create(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: CreateDocumentsBody,
  ): Promise<DocumentUpload[]> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const created: DocumentUpload[] = [];
    for (const file of body.files) {
      const pdf = file.contentType === "application/pdf";
      const purpose = pdf ? "document" : "photo";
      if (!UploadsService.accepts(purpose, file)) {
        throw new ApiProblem(422, "validation_failed", "This file type or size is not accepted.", {
          fields: { files: ["Not accepted"] },
        });
      }
      const documentId = randomUUID();
      await this.tx.insert(guideDocument).values({
        id: documentId,
        workspaceId,
        guideId: ctx.guide.id,
        fileName: cleanFileName(file.fileName),
        kind: pdf ? "pdf" : "photo",
        uploadedBy: caller.userId,
      });
      const [form] = await this.uploads.createUploads(this.tx, {
        workspaceId,
        purpose,
        files: [{ contentType: file.contentType, size: file.size }],
        createdBy: caller.userId,
        guideDocumentId: documentId,
      });
      created.push({ documentId, upload: { url: form!.url, fields: form!.fields } });
    }
    return created;
  }

  /** Queues the reading once the file is uploaded (FR-040). */
  async complete(
    workspaceId: string,
    propertyId: string,
    documentId: string,
  ): Promise<DocumentView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const row = await this.load(workspaceId, ctx.guide.id, documentId);
    const [form] = await this.tx
      .select({ id: upload.id, status: upload.status })
      .from(upload)
      .where(eq(upload.guideDocumentId, row.id))
      .limit(1);
    if (row.status !== "checking" || !form || form.status !== "pending") {
      throw new ApiProblem(409, "conflict", "This file was already sent.");
    }
    await this.tx.update(upload).set({ status: "received" }).where(eq(upload.id, form.id));
    await this.jobs.send(
      JOB_QUEUES.guideDocument,
      { workspaceId, documentId } satisfies GuideDocumentJob,
      // The malware scan can take up to 2 minutes (research R9): retries wait for it.
      { startAfter: 1, retryLimit: 12, retryDelay: 10 },
    );
    return this.viewOf(row, []);
  }

  async list(workspaceId: string, propertyId: string): Promise<DocumentList> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const rows = await this.tx
      .select()
      .from(guideDocument)
      .where(eq(guideDocument.guideId, ctx.guide.id))
      .orderBy(desc(guideDocument.createdAt))
      .limit(100);
    const suggestions = rows.length
      ? await this.tx
          .select({ id: guideItem.id, documentId: guideItem.documentId })
          .from(guideItem)
          .where(
            and(
              inArray(
                guideItem.documentId,
                rows.map((row) => row.id),
              ),
              isNull(guideItem.reviewedAt),
            ),
          )
      : [];
    return {
      items: rows.map((row) =>
        this.viewOf(
          row,
          suggestions.filter((item) => item.documentId === row.id).map((item) => item.id),
        ),
      ),
    };
  }

  /** Removes the file record and its unreviewed suggestions (FR-041). */
  async remove(workspaceId: string, propertyId: string, documentId: string): Promise<void> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const row = await this.load(workspaceId, ctx.guide.id, documentId);
    await this.tx
      .delete(guideItem)
      .where(and(eq(guideItem.documentId, row.id), isNull(guideItem.reviewedAt)));
    await this.tx.delete(guideDocument).where(eq(guideDocument.id, row.id));
  }

  private async load(workspaceId: string, guideId: string, documentId: string) {
    const [row] = await this.tx
      .select()
      .from(guideDocument)
      .where(and(eq(guideDocument.id, documentId), eq(guideDocument.guideId, guideId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(
        this.tx,
        workspaceId,
        "guide_document",
        documentId,
      );
    }
    return row;
  }

  private viewOf(row: DocumentRow, suggestionItemIds: string[]): DocumentView {
    return {
      id: row.id,
      fileName: row.fileName,
      kind: row.kind,
      status: row.status,
      rejectReason: row.rejectReason,
      pages: row.pages,
      scannedPages: row.scannedPages,
      redactions: row.redactions,
      suggestionItemIds,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
