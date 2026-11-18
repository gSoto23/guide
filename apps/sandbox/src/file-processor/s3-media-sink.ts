import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MediaSink } from "./media-image.js";

const MEDIA_KEY = /^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-z0-9._-]{1,40}$/;

/**
 * The media bucket as the file processor sees it (feature 003 research R9): the function's role
 * may only `s3:PutObject` on `media/*` (infra/sandbox.ts).
 */
export class S3MediaSink implements MediaSink {
  private readonly client: S3Client;

  constructor(private readonly options: { bucket: string; client?: S3Client }) {
    this.client = options.client ?? new S3Client({});
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    if (!MEDIA_KEY.test(key)) throw new Error("Invalid media key");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }
}
