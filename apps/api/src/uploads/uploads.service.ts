import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { upload, type Transaction } from "@guidesk/db";
import type { ObjectStoragePort } from "@guidesk/integrations";
import { OBJECT_STORAGE } from "./storage.provider.js";

export type UploadPurpose = "screenshot" | "csv";

/** Accepted declared types and sizes (FR-009, FR-038). The sandbox checks the real type again. */
export const UPLOAD_RULES: Record<UploadPurpose, { types: readonly string[]; maxBytes: number }> = {
  screenshot: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024 },
  csv: { types: ["text/csv", "application/vnd.ms-excel", "text/plain"], maxBytes: 2 * 1024 * 1024 },
};

export interface UploadRequest {
  contentType: string;
  size: number;
}

export interface UploadForm {
  uploadId: string;
  url: string;
  fields: Record<string, string>;
}

export interface CreateUploadsInput {
  workspaceId: string;
  purpose: UploadPurpose;
  files: UploadRequest[];
  createdBy: string;
  extractionRequestId?: string;
  importRunId?: string;
}

/**
 * Upload rows and their presigned forms (T022, research R9). The object key is
 * `uploads/{workspace_id}/{upload_id}`, never derived from a file name, and each form fixes the
 * key, the content type, and the size range. Rows expire after 24 hours (FR-015).
 */
@Injectable()
export class UploadsService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort) {}

  /** True when the declared type and size are accepted for the purpose. */
  static accepts(purpose: UploadPurpose, file: UploadRequest): boolean {
    const rules = UPLOAD_RULES[purpose];
    return rules.types.includes(file.contentType) && file.size > 0 && file.size <= rules.maxBytes;
  }

  async createUploads(tx: Transaction, input: CreateUploadsInput): Promise<UploadForm[]> {
    const forms: UploadForm[] = [];
    for (const file of input.files) {
      const id = randomUUID();
      const objectKey = `uploads/${input.workspaceId}/${id}`;
      await tx.insert(upload).values({
        id,
        workspaceId: input.workspaceId,
        purpose: input.purpose,
        objectKey,
        declaredType: file.contentType,
        declaredSize: file.size,
        createdBy: input.createdBy,
        extractionRequestId: input.extractionRequestId,
        importRunId: input.importRunId,
      });
      const post = await this.storage.createPresignedPost({
        key: objectKey,
        contentType: file.contentType,
        maxBytes: UPLOAD_RULES[input.purpose].maxBytes,
      });
      forms.push({ uploadId: id, url: post.url, fields: post.fields });
    }
    return forms;
  }
}
