import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { CreateMediaBody, MediaUpload, MediaView } from "@guidesk/contracts";
import { mediaObject, upload } from "@guidesk/db";
import { JOB_QUEUES, type MediaProcessJob } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { GuideLimitsService } from "../guides/guide-limits.service.js";
import { GuideViewService, type Caller } from "../guides/guide-view.service.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { UploadsService } from "../uploads/uploads.service.js";

/**
 * Guide media (feature 003 contract "Media", FR-009, FR-065, research R9): a presigned form to the
 * uploads bucket, then `media.process` checks, cleans, and moves the file to the media bucket.
 * No file bytes pass through the API.
 */
@Injectable()
export class GuideMediaService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly uploads: UploadsService,
    private readonly limits: GuideLimitsService,
    private readonly jobs: JobQueueService,
    private readonly crossTenant: CrossTenantService,
  ) {}

  async create(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: CreateMediaBody,
  ): Promise<MediaUpload> {
    await this.views.load(workspaceId, propertyId);
    const file = {
      contentType: body.contentType,
      size: body.size,
      maxBytes: body.kind === "image" ? 10 * 1024 * 1024 : 150 * 1024 * 1024,
    };
    if (!UploadsService.accepts("media", file)) {
      throw new ApiProblem(422, "validation_failed", "This file type or size is not accepted.", {
        fields: { contentType: ["Not accepted"] },
      });
    }
    await this.limits.assertMediaRoom(workspaceId, body.size);
    const tx = this.requestDb.current();
    const mediaId = randomUUID();
    await tx.insert(mediaObject).values({
      id: mediaId,
      workspaceId,
      kind: body.kind,
      status: "uploading",
      objectPrefix: `media/${workspaceId}/${mediaId}/`,
      createdBy: caller.userId,
    });
    const [form] = await this.uploads.createUploads(tx, {
      workspaceId,
      purpose: "media",
      files: [file],
      createdBy: caller.userId,
      mediaObjectId: mediaId,
    });
    await tx
      .update(mediaObject)
      .set({ uploadId: form!.uploadId })
      .where(eq(mediaObject.id, mediaId));
    return { mediaId, upload: { url: form!.url, fields: form!.fields } };
  }

  async complete(workspaceId: string, propertyId: string, mediaId: string): Promise<MediaView> {
    await this.views.load(workspaceId, propertyId);
    const row = await this.load(workspaceId, mediaId);
    if (row.status !== "uploading")
      throw new ApiProblem(409, "conflict", "This media was already sent.");
    const tx = this.requestDb.current();
    await tx.update(mediaObject).set({ status: "processing" }).where(eq(mediaObject.id, mediaId));
    if (row.uploadId)
      await tx.update(upload).set({ status: "received" }).where(eq(upload.id, row.uploadId));
    await this.jobs.send(
      JOB_QUEUES.mediaProcess,
      { workspaceId, mediaId } satisfies MediaProcessJob,
      // The malware scan can take up to 2 minutes (research R9): retries wait for it.
      { startAfter: 1, retryLimit: 12, retryDelay: 10 },
    );
    return this.view(workspaceId, propertyId, mediaId);
  }

  async view(workspaceId: string, propertyId: string, mediaId: string): Promise<MediaView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const row = await this.load(workspaceId, mediaId);
    return this.views.mediaViewOf({ ...ctx, media: [row] }, row);
  }

  private async load(workspaceId: string, mediaId: string) {
    const tx = this.requestDb.current();
    const [row] = await tx
      .select()
      .from(mediaObject)
      .where(and(eq(mediaObject.id, mediaId), eq(mediaObject.workspaceId, workspaceId)))
      .limit(1);
    if (!row)
      throw await this.crossTenant.notFoundInRequest(tx, workspaceId, "media_object", mediaId);
    return row;
  }
}
