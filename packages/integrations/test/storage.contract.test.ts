import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "../src/storage/local.adapter.js";
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
