import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "../src/storage/local.adapter.js";
import { LocalMediaStorage, S3MediaStorage } from "../src/storage/media.js";
import { S3ObjectStorage } from "../src/storage/s3.adapter.js";

const key = `uploads/${randomUUID()}/${randomUUID()}`;
const now = new Date("2026-11-16T12:00:00.000Z");

describe("S3 presigned POST forms (T021, research R9)", () => {
  const storage = new S3ObjectStorage({
    bucket: "guidesk-uploads-test",
    now: () => now,
    // Test-only credentials: forms are signed locally, nothing is sent to AWS.
    client: new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
    }),
  });

  it("fixes the key, the content type, and the size range, and expires after 10 minutes", async () => {
    const before = Date.now();
    const post = await storage.createPresignedPost({
      key,
      contentType: "image/jpeg",
      maxBytes: 10 * 1024 * 1024,
    });
    expect(post.url).toContain("guidesk-uploads-test");
    expect(post.fields).toMatchObject({ key, "Content-Type": "image/jpeg" });
    expect(post.expiresAt.toISOString()).toBe("2026-11-16T12:10:00.000Z");
    const policy = JSON.parse(Buffer.from(post.fields.Policy ?? "", "base64").toString("utf8")) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        { bucket: "guidesk-uploads-test" },
        { key },
        ["eq", "$Content-Type", "image/jpeg"],
        ["content-length-range", 1, 10 * 1024 * 1024],
      ]),
    );
    const expiresInSeconds = (Date.parse(policy.expiration) - before) / 1000;
    expect(expiresInSeconds).toBeGreaterThan(590);
    expect(expiresInSeconds).toBeLessThanOrEqual(601);
  });
});

describe("local storage stand-in (T021, development and test only)", () => {
  let dir: string;
  let clock = now;
  let storage: LocalObjectStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "guidesk-uploads-"));
    storage = new LocalObjectStorage({
      dir,
      uploadUrl: "http://localhost:4000/api/v1/local-uploads",
      now: () => clock,
    });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function form(contentType = "image/png", maxBytes = 100) {
    clock = now;
    return storage.createPresignedPost({ key, contentType, maxBytes });
  }

  it("stores a file that matches its signed form, then reads and deletes it", async () => {
    const post = await form();
    expect(post.url).toBe("http://localhost:4000/api/v1/local-uploads");
    const accepted = await storage.acceptUpload(post.fields, {
      contentType: "image/png",
      bytes: Buffer.from("png-bytes"),
    });
    expect(accepted).toEqual({ ok: true, key });
    expect((await storage.get(key))?.toString()).toBe("png-bytes");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await storage.delete(key);
  });

  it("refuses another key, content type, size, or an expired form", async () => {
    const post = await form();
    const file = { contentType: "image/png", bytes: Buffer.from("x") };
    const otherKey = `uploads/${randomUUID()}/${randomUUID()}`;
    expect(await storage.acceptUpload({ ...post.fields, key: otherKey }, file)).toEqual({
      ok: false,
      reason: "invalid_token",
    });
    expect(
      await storage.acceptUpload({ ...post.fields, key: "uploads/../../etc/passwd" }, file),
    ).toEqual({ ok: false, reason: "invalid_token" });
    expect(
      await storage.acceptUpload(post.fields, {
        contentType: "application/zip",
        bytes: file.bytes,
      }),
    ).toEqual({ ok: false, reason: "wrong_content_type" });
    expect(
      await storage.acceptUpload(post.fields, {
        contentType: "image/png",
        bytes: Buffer.alloc(101),
      }),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(await storage.acceptUpload({ ...post.fields, "x-max-bytes": "999999" }, file)).toEqual({
      ok: false,
      reason: "invalid_token",
    });
    clock = new Date(now.getTime() + 11 * 60 * 1000);
    expect(await storage.acceptUpload(post.fields, file)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("media storage (feature 003 T034, research R9)", () => {
  const ws = randomUUID();
  const mediaId = randomUUID();
  const key = `media/${ws}/${mediaId}/large.webp`;
  let dir: string;
  let clock = new Date("2026-11-17T12:00:00Z");
  let media: LocalMediaStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "guidesk-media-"));
    media = new LocalMediaStorage({
      dir,
      mediaUrl: "http://localhost:4000/api/v1/dev/media",
      secret: Buffer.alloc(32, 9),
      now: () => clock,
    });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("puts, reads, copies, and deletes by prefix", async () => {
    await media.put(key, Buffer.from("image"), "image/webp");
    expect((await media.get(key))?.toString()).toBe("image");
    const copyKey = `media/${ws}/${randomUUID()}/large.webp`;
    await media.copy(key, copyKey);
    expect((await media.get(copyKey))?.toString()).toBe("image");
    await media.deletePrefix(`media/${ws}/${mediaId}/`);
    expect(await media.get(key)).toBeNull();
    expect(await media.get(copyKey)).not.toBeNull();
  });

  it("refuses keys outside the media layout", async () => {
    await expect(media.put("uploads/x/y", Buffer.from("x"), "image/webp")).rejects.toThrow();
    await expect(media.get(`media/${ws}/../../etc/passwd`)).rejects.toThrow();
    await expect(media.deletePrefix(`media/${ws}/`)).rejects.toThrow();
  });

  it("signs URLs that expire after 15 minutes and refuses tampering", async () => {
    const url = new URL(await media.signedUrl(key, "image/webp"));
    const query = Object.fromEntries(url.searchParams.entries());
    expect(media.verify(query)).toEqual({ key, contentType: "image/webp" });
    expect(media.verify({ ...query, type: "text/html" })).toBeNull();
    expect(media.verify({ ...query, key: `media/${ws}/${randomUUID()}/large.webp` })).toBeNull();
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    expect(media.verify(query)).toBeNull();
  });

  it("signs S3 GET URLs inline with the stored type for 15 minutes", async () => {
    const s3 = new S3MediaStorage({
      bucket: "guidesk-media-test",
      client: new S3Client({
        region: "us-east-1",
        credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
      }),
    });
    const url = new URL(await s3.signedUrl(key, "image/webp"));
    expect(url.hostname).toContain("guidesk-media-test");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("response-content-type")).toBe("image/webp");
    expect(url.searchParams.get("response-content-disposition")).toBe("inline");
  });

  it("reports local uploads as unscanned", async () => {
    const local = new LocalObjectStorage({ dir, uploadUrl: "http://localhost:4000/upload" });
    expect(await local.scanStatus()).toBe("unscanned");
  });
});
