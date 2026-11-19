import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type {
  CreateExtractionBody,
  CreatedExtraction,
  Extraction,
  ExtractionResult,
} from "@guidesk/contracts";
import { derivedBasis, extractionRequest, workspaceLimitInputs } from "@guidesk/db";
import {
  extractionLimit,
  extractionLimitKey,
  extractionLimitResetsAt,
  isUrlOnly,
  JOB_QUEUES,
  redactRestrictedValues,
  type ExtractionRunJob,
  type Role,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { UploadsService } from "../uploads/uploads.service.js";

interface Caller {
  userId: string;
  role: Role;
}

type Row = typeof extractionRequest.$inferSelect;

/** Errors after which "Try again" makes sense (FR-016). */
const RETRYABLE = new Set(["timeout", "ai_unavailable"]);

function toExtraction(row: Row): Extraction {
  return {
    id: row.id,
    status: row.status,
    errorCode: row.errorCode,
    urlOnly: row.urlOnly,
    redactions: row.redactions,
    screenshotCount: row.screenshotCount,
    failedScreenshots: row.failedScreenshots,
    result: (row.result as ExtractionResult | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/**
 * Listing extraction requests (US2, T058). Text is redacted before it is stored or sent anywhere
 * (FR-012); a URL alone makes no request and no AI call (FR-011, PC-12); the daily limit is
 * counted per workspace and UTC day (FR-017).
 */
@Injectable()
export class ExtractionsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly uploads: UploadsService,
    private readonly rateLimit: RateLimitService,
    private readonly jobs: JobQueueService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private async load(caller: Caller, workspaceId: string, extractionId: string): Promise<Row> {
    const [row] = await this.requestDb
      .current()
      .select()
      .from(extractionRequest)
      .where(
        and(eq(extractionRequest.id, extractionId), eq(extractionRequest.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!row)
      throw await this.crossTenant.notFound(
        caller.userId,
        workspaceId,
        "extraction_request",
        extractionId,
      );
    return row;
  }

  /** Takes one extraction from today's limit, or refuses with the reset time (AC-SEC-010). */
  private async consumeLimit(workspaceId: string): Promise<void> {
    const inputs = await workspaceLimitInputs(this.requestDb.current(), workspaceId);
    if (!inputs) throw new ApiProblem(404, "not_found");
    const now = new Date();
    const limit = extractionLimit(derivedBasis(inputs));
    const result = await this.rateLimit.consume(
      extractionLimitKey(workspaceId, now),
      limit,
      86_400,
    );
    if (!result.allowed) {
      const resetsAt = extractionLimitResetsAt(now);
      throw new ApiProblem(429, "extraction_limit_reached", undefined, {
        details: { limit, resetsAt: resetsAt.toISOString() },
        retryAfterSeconds: Math.ceil((resetsAt.getTime() - now.getTime()) / 1000),
      });
    }
  }

  async create(
    caller: Caller,
    workspaceId: string,
    body: CreateExtractionBody,
  ): Promise<CreatedExtraction> {
    if (body.screenshots.length > 0 && !this.config.integrations.flags.extractionScreenshots) {
      throw new ApiProblem(422, "validation_failed", "Screenshots are not available yet.", {
        fields: { screenshots: ["Not available"] },
      });
    }
    const tx = this.requestDb.current();
    const text = body.text?.trim() ?? "";

    // A URL alone: Guidesk never opens listing pages, so nothing is fetched or sent (FR-011).
    if (body.screenshots.length === 0 && isUrlOnly(text)) {
      const [row] = await tx
        .insert(extractionRequest)
        .values({
          workspaceId,
          status: "failed",
          errorCode: "url_only",
          urlOnly: true,
          requestedBy: caller.userId,
          completedAt: new Date(),
        })
        .returning();
      return {
        extractionId: row!.id,
        status: row!.status,
        urlOnly: true,
        redactions: {},
        uploads: [],
      };
    }

    await this.consumeLimit(workspaceId);
    const redacted = text ? redactRestrictedValues(text) : { text: "", counts: {} };
    const [row] = await tx
      .insert(extractionRequest)
      .values({
        workspaceId,
        status: "awaiting_uploads",
        inputText: redacted.text || null,
        redactions: redacted.counts as Record<string, number>,
        screenshotCount: body.screenshots.length,
        requestedBy: caller.userId,
      })
      .returning();
    const forms = await this.uploads.createUploads(tx, {
      workspaceId,
      purpose: "screenshot",
      files: body.screenshots,
      createdBy: caller.userId,
      extractionRequestId: row!.id,
    });
    return {
      extractionId: row!.id,
      status: row!.status,
      urlOnly: false,
      redactions: row!.redactions,
      uploads: forms,
    };
  }

  /** Called after the uploads finish; the worker takes it from here (60-second limit, FR-016). */
  async submit(caller: Caller, workspaceId: string, extractionId: string): Promise<void> {
    const row = await this.load(caller, workspaceId, extractionId);
    if (row.status !== "awaiting_uploads") {
      throw new ApiProblem(409, "conflict", "This extraction was already submitted.");
    }
    await this.requestDb
      .current()
      .update(extractionRequest)
      .set({ status: "queued" })
      .where(eq(extractionRequest.id, extractionId));
    await this.jobs.send(
      JOB_QUEUES.extractionRun,
      { extractionId, workspaceId } satisfies ExtractionRunJob,
      { retryLimit: 0, startAfter: 1 },
    );
  }

  async get(caller: Caller, workspaceId: string, extractionId: string): Promise<Extraction> {
    return toExtraction(await this.load(caller, workspaceId, extractionId));
  }

  /**
   * "Try again" after a timeout or an AI failure (FR-016): a new request from the stored redacted
   * text and recognized text, without uploading the screenshots again. It counts toward the limit.
   */
  async retry(
    caller: Caller,
    workspaceId: string,
    extractionId: string,
  ): Promise<{ extractionId: string }> {
    const row = await this.load(caller, workspaceId, extractionId);
    if (
      row.status !== "failed" ||
      !row.errorCode ||
      !RETRYABLE.has(row.errorCode) ||
      row.inputDeletedAt
    ) {
      throw new ApiProblem(
        409,
        "conflict",
        "Only an extraction that timed out or could not reach the AI can be retried.",
      );
    }
    await this.consumeLimit(workspaceId);
    const [created] = await this.requestDb
      .current()
      .insert(extractionRequest)
      .values({
        workspaceId,
        status: "queued",
        inputText: row.inputText,
        recognizedText: row.recognizedText,
        redactions: row.redactions,
        retryOfId: row.id,
        requestedBy: caller.userId,
      })
      .returning({ id: extractionRequest.id });
    await this.jobs.send(
      JOB_QUEUES.extractionRun,
      { extractionId: created!.id, workspaceId } satisfies ExtractionRunJob,
      { retryLimit: 0, startAfter: 1 },
    );
    return { extractionId: created!.id };
  }
}
