import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { ObjectSource } from "./handler.js";

export interface S3ObjectSourceOptions {
  bucket: string;
  /** Largest object the processor accepts; at most one byte more is ever read. */
  maxBytes: number;
  client?: S3Client;
}

/**
 * The uploads bucket as the file processor sees it (research R2, R9, SEC-10). The function's
 * role may only `s3:GetObject` and `s3:DeleteObject` on `uploads/*` (infra/sandbox.ts), and the
 * credentials come from that role.
 */
export class S3ObjectSource implements ObjectSource {
  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectSourceOptions) {
    // The region comes from the Lambda environment (`AWS_REGION`).
    this.client = options.client ?? new S3Client({});
  }

  /**
   * Reads the object with a range request for its first `maxBytes + 1` bytes, so an oversized
   * object is never buffered whole: the handler sees one byte too many and answers `too_large`.
   *
   * A missing object is null. The role has no `s3:ListBucket`, so S3 answers `403 AccessDenied`
   * rather than `404 NoSuchKey` for a key that does not exist; both mean "not there". An empty
   * object cannot satisfy a range (`416 InvalidRange`) and is returned as an empty buffer.
   */
  async get(key: string): Promise<Buffer | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Range: `bytes=0-${this.options.maxBytes}`,
        }),
      );
      if (!output.Body) return Buffer.alloc(0);
      return Buffer.from(await output.Body.transformToByteArray());
    } catch (error: unknown) {
      if (error instanceof S3ServiceException) {
        if (error.name === "NoSuchKey" || error.name === "AccessDenied") return null;
        if (error.name === "InvalidRange") return Buffer.alloc(0);
      }
      throw new Error("Could not read the uploaded object", { cause: error });
    }
  }

  /** Deletes the object; S3 treats deleting a missing key as success. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
