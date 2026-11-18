import { createHmac, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * The media bucket for guide images and videos (feature 003 research R9, SEC-10, SEC-11). The file
 * processor writes cleaned files here; the portal shows them through short-lived signed URLs on
 * the bucket's own origin, so the API's origin never serves user content.
 */
export const MEDIA_KEY = /^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-z0-9._-]{1,40}$/;
export const MEDIA_PREFIX = /^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/$/;
/** Signed URLs last 15 minutes (research R9). */
export const MEDIA_URL_TTL_SECONDS = 900;

export interface MediaStoragePort {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  copy(fromKey: string, toKey: string): Promise<void>;
  /** Deletes every object under a media prefix; a missing prefix is not an error. */
  deletePrefix(prefix: string): Promise<void>;
  /** A signed URL that shows the object inline with its stored type. */
  signedUrl(key: string, contentType: string): Promise<string>;
}

function checkKey(key: string): void {
  if (!MEDIA_KEY.test(key)) throw new Error("Invalid media key");
}

function checkPrefix(prefix: string): void {
  if (!MEDIA_PREFIX.test(prefix)) throw new Error("Invalid media prefix");
}

export interface S3MediaStorageOptions {
  bucket: string;
  client?: S3Client;
}

/** The media bucket in AWS. Credentials come from the task or function role. */
export class S3MediaStorage implements MediaStoragePort {
  private readonly client: S3Client;

  constructor(private readonly options: S3MediaStorageOptions) {
    this.client = options.client ?? new S3Client({ region: "us-east-1" });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    checkKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    checkKey(key);
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return output.Body ? Buffer.from(await output.Body.transformToByteArray()) : null;
    } catch (error: unknown) {
      if (error instanceof NoSuchKey) return null;
      throw new Error("Could not read the media object", { cause: error });
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    checkKey(fromKey);
    checkKey(toKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.options.bucket,
        Key: toKey,
        CopySource: `${this.options.bucket}/${fromKey}`,
      }),
    );
  }

  async deletePrefix(prefix: string): Promise<void> {
    checkPrefix(prefix);
    const listed = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: prefix, MaxKeys: 100 }),
    );
    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => !!key);
    if (keys.length === 1) {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: keys[0] }),
      );
    } else if (keys.length > 1) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.options.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    }
  }

  async signedUrl(key: string, contentType: string): Promise<string> {
    checkKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: MEDIA_URL_TTL_SECONDS },
    );
  }
}

export interface LocalMediaStorageOptions {
  /** Folder that stands in for the bucket (the same root as the local uploads). */
  dir: string;
  /** Full URL of the API's development-only media route. */
  mediaUrl: string;
  /** Secret that signs URLs; must be shared by every process that signs or verifies. */
  secret: Buffer;
  now?: () => Date;
}

/**
 * Development and test stand-in for the media bucket (STORAGE_MODE=local). Signed URLs point to a
 * development-only API route that checks an HMAC-SHA-256 signature and the expiry, like an S3
 * signed URL. Production refuses this mode.
 */
export class LocalMediaStorage implements MediaStoragePort {
  private readonly root: string;
  private readonly now: () => Date;

  constructor(private readonly options: LocalMediaStorageOptions) {
    this.root = resolve(options.dir);
    this.now = options.now ?? (() => new Date());
  }

  private pathFor(key: string): string {
    checkKey(key);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error("Invalid media key");
    return path;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.options.secret).update(payload).digest("base64url");
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const target = this.pathFor(toKey);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(this.pathFor(fromKey), target);
  }

  async deletePrefix(prefix: string): Promise<void> {
    checkPrefix(prefix);
    const path = resolve(join(this.root, prefix));
    if (!path.startsWith(this.root + sep)) throw new Error("Invalid media prefix");
    await rm(path, { recursive: true, force: true });
  }

  async signedUrl(key: string, contentType: string): Promise<string> {
    checkKey(key);
    const expires = String(Math.floor(this.now().getTime() / 1000) + MEDIA_URL_TTL_SECONDS);
    const signature = this.sign([key, contentType, expires].join("\n"));
    const url = new URL(this.options.mediaUrl);
    url.searchParams.set("key", key);
    url.searchParams.set("type", contentType);
    url.searchParams.set("expires", expires);
    url.searchParams.set("signature", signature);
    return url.toString();
  }

  /** Checks a signed URL's query; returns the key and type when it is valid and not expired. */
  verify(query: Record<string, string | undefined>): { key: string; contentType: string } | null {
    const key = query.key ?? "";
    const contentType = query.type ?? "";
    const expires = query.expires ?? "";
    if (!MEDIA_KEY.test(key) || !/^\d+$/.test(expires)) return null;
    const expected = Buffer.from(this.sign([key, contentType, expires].join("\n")));
    const given = Buffer.from(query.signature ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (Number(expires) * 1000 < this.now().getTime()) return null;
    return { key, contentType };
  }
}
