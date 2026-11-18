import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  PRESIGNED_POST_TTL_SECONDS,
  type ObjectStoragePort,
  type PresignedPost,
  type PresignedPostInput,
  type ScanStatus,
} from "./port.js";

export interface S3StorageOptions {
  bucket: string;
  client?: S3Client;
  now?: () => Date;
}

/** The private uploads bucket (research R9). Credentials come from the task or function role. */
export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;
  private readonly now: () => Date;

  constructor(private readonly options: S3StorageOptions) {
    this.client = options.client ?? new S3Client({ region: "us-east-1" });
    this.now = options.now ?? (() => new Date());
  }

  async createPresignedPost(input: PresignedPostInput): Promise<PresignedPost> {
    const expiresAt = new Date(this.now().getTime() + PRESIGNED_POST_TTL_SECONDS * 1000);
    // `Key` adds an exact key condition; the content type and size range are fixed too.
    const post = await createPresignedPost(this.client, {
      Bucket: this.options.bucket,
      Key: input.key,
      Fields: { "Content-Type": input.contentType },
      Conditions: [
        ["eq", "$Content-Type", input.contentType],
        ["content-length-range", 1, input.maxBytes],
      ],
      Expires: PRESIGNED_POST_TTL_SECONDS,
    });
    return { url: post.url, fields: post.fields, expiresAt };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!output.Body) return null;
      return Buffer.from(await output.Body.transformToByteArray());
    } catch (error: unknown) {
      if (error instanceof NoSuchKey) return null;
      throw new Error("Could not read the uploaded object", { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async scanStatus(key: string): Promise<ScanStatus> {
    const output = await this.client.send(
      new GetObjectTaggingCommand({ Bucket: this.options.bucket, Key: key }),
    );
    const tag = output.TagSet?.find((entry) => entry.Key === "GuardDutyMalwareScanStatus")?.Value;
    if (!tag) return "pending";
    if (tag === "NO_THREATS_FOUND") return "clean";
    if (tag === "THREATS_FOUND") return "threats";
    return "failed";
  }
}
