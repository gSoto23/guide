import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  PRESIGNED_POST_TTL_SECONDS,
  type ObjectStoragePort,
  type PresignedPost,
  type PresignedPostInput,
} from "./port.js";

export interface LocalStorageOptions {
  /** Folder that stands in for the bucket. */
  dir: string;
  /** Full URL of the API's development-only upload route. */
  uploadUrl: string;
  /** Secret that signs the forms; a random one per process when omitted. */
  secret?: Buffer;
  now?: () => Date;
}

/** What a signed local form allows, as checked by `verifyUpload`. */
export interface LocalUploadGrant {
  key: string;
  contentType: string;
  maxBytes: number;
}

export type LocalUploadRefusal =
  "invalid_token" | "expired" | "wrong_content_type" | "too_large" | "empty";

const KEY_PATTERN = /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/**
 * Development and test stand-in for S3 (STORAGE_MODE=local). Forms post to a development-only
 * API route, which enforces the same rules as an S3 policy: one key, one content type, a size
 * range, and a 10-minute expiry, signed with HMAC-SHA-256. Production refuses this mode (T006).
 */
export class LocalObjectStorage implements ObjectStoragePort {
  private readonly secret: Buffer;
  private readonly now: () => Date;
  private readonly root: string;

  constructor(private readonly options: LocalStorageOptions) {
    this.secret = options.secret ?? randomBytes(32);
    this.now = options.now ?? (() => new Date());
    this.root = resolve(options.dir);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid upload key");
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error("Invalid upload key");
    return path;
  }

  async createPresignedPost(input: PresignedPostInput): Promise<PresignedPost> {
    const expiresAt = new Date(this.now().getTime() + PRESIGNED_POST_TTL_SECONDS * 1000);
    const expires = String(Math.floor(expiresAt.getTime() / 1000));
    const payload = [input.key, input.contentType, String(input.maxBytes), expires].join("\n");
    return {
      url: this.options.uploadUrl,
      fields: {
        key: input.key,
        "Content-Type": input.contentType,
        "x-max-bytes": String(input.maxBytes),
        "x-expires": expires,
        "x-signature": this.sign(payload),
      },
      expiresAt,
    };
  }

  /** Checks a posted form and file against its signed grant, then stores the file. */
  async acceptUpload(
    fields: Record<string, string>,
    file: { contentType: string; bytes: Buffer },
  ): Promise<{ ok: true; key: string } | { ok: false; reason: LocalUploadRefusal }> {
    const key = fields.key ?? "";
    const contentType = fields["Content-Type"] ?? "";
    const maxBytes = fields["x-max-bytes"] ?? "";
    const expires = fields["x-expires"] ?? "";
    const expected = Buffer.from(this.sign([key, contentType, maxBytes, expires].join("\n")));
    const given = Buffer.from(fields["x-signature"] ?? "");
    if (
      !KEY_PATTERN.test(key) ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      return { ok: false, reason: "invalid_token" };
    }
    if (Number(expires) * 1000 < this.now().getTime()) return { ok: false, reason: "expired" };
    if (file.contentType !== contentType) return { ok: false, reason: "wrong_content_type" };
    if (file.bytes.length === 0) return { ok: false, reason: "empty" };
    if (file.bytes.length > Number(maxBytes)) return { ok: false, reason: "too_large" };
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
    return { ok: true, key };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
