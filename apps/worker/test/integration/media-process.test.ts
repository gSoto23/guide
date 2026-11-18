import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  mediaObject,
  membership,
  upload,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  InProcessSandbox,
  LocalMediaStorage,
  LocalObjectStorage,
  type ObjectStoragePort,
  type ScanStatus,
} from "@guidesk/integrations";
import { createFileProcessor, TesseractRecognizer } from "@guidesk/sandbox/in-process";
import { runMediaProcess, ScanPendingError } from "../../src/jobs/media-process.js";

/**
 * media.process (feature 003 T043, research R9, FR-065, AC-SEC-010): the scan wait, cleaning into
 * the media bucket, the storage limit with the real size, and rejections with a reason.
 */
let handle: DbHandle;
let dir: string;
let storage: LocalObjectStorage;
let media: LocalMediaStorage;
let sandbox: InProcessSandbox;
let recognizer: TesseractRecognizer;
let workspaceId: string;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  dir = await mkdtemp(join(tmpdir(), "guidesk-media-job-"));
  storage = new LocalObjectStorage({ dir, uploadUrl: "http://localhost/unused" });
  media = new LocalMediaStorage({
    dir,
    mediaUrl: "http://localhost/media",
    secret: Buffer.alloc(32, 1),
  });
  recognizer = new TesseractRecognizer();
  sandbox = new InProcessSandbox({
    readFeed: async () => ({ error: "internal" }),
    processFile: createFileProcessor({ storage, recognizer, mediaSink: media }),
  });
});

afterAll(async () => {
  await recognizer.terminate();
  await rm(dir, { recursive: true, force: true });
  await handle.pool.end();
});

beforeEach(async () => {
  const ownerId = `owner-${randomUUID()}`;
  workspaceId = randomUUID();
  await handle.db
    .insert(user)
    .values({ id: ownerId, name: "Dueña", email: `${ownerId}@example.com` });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
});

/** A media row in `processing` with its uploaded file on disk. */
async function seedMedia(bytes: Buffer, kind: "image" | "video" = "image") {
  const mediaId = randomUUID();
  const uploadId = randomUUID();
  const objectKey = `uploads/${workspaceId}/${uploadId}`;
  await mkdir(dirname(join(dir, objectKey)), { recursive: true });
  await writeFile(join(dir, objectKey), bytes);
  await handle.db.insert(mediaObject).values({
    id: mediaId,
    workspaceId,
    kind,
    status: "processing",
    objectPrefix: `media/${workspaceId}/${mediaId}/`,
  });
  await handle.db.insert(upload).values({
    id: uploadId,
    workspaceId,
    purpose: "media",
    objectKey,
    declaredType: "image/jpeg",
    declaredSize: bytes.length,
    status: "received",
    mediaObjectId: mediaId,
  });
  await handle.db.update(mediaObject).set({ uploadId }).where(eq(mediaObject.id, mediaId));
  return { mediaId, objectKey };
}

/** A synthetic JPEG with GPS coordinates in its EXIF block (apps/sandbox/test/fixtures/media). */
const ENTRANCE = readFileSync(
  new URL("../../../sandbox/test/fixtures/media/entrance-gps.jpg", import.meta.url),
);
const jpeg = async () => ENTRANCE;

function scanning(status: ScanStatus): ObjectStoragePort {
  return new Proxy(storage, {
    get: (target, property) =>
      property === "scanStatus" ? async () => status : Reflect.get(target, property, target),
  }) as ObjectStoragePort;
}

async function row(mediaId: string) {
  const [result] = await handle.db.select().from(mediaObject).where(eq(mediaObject.id, mediaId));
  return result!;
}

describe("media.process", () => {
  it("cleans an image into the media bucket and marks it ready", async () => {
    const { mediaId, objectKey } = await seedMedia(await jpeg());
    const outcome = await runMediaProcess(
      { db: handle.db, sandbox, storage, media, requireScan: false },
      { workspaceId, mediaId },
    );
    expect(outcome).toBe("ready");
    const ready = await row(mediaId);
    expect(ready).toMatchObject({ status: "ready", width: 1200, height: 800 });
    expect(Object.keys(ready.variants)).toEqual(["large", "small"]);
    const large = await media.get(`media/${workspaceId}/${mediaId}/large.webp`);
    expect(large!.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(ENTRANCE.includes(Buffer.from("Synthetic test camera"))).toBe(true);
    expect(large!.includes(Buffer.from("EXIF"))).toBe(false);
    expect(large!.includes(Buffer.from("Synthetic test camera"))).toBe(false);
    expect(await storage.get(objectKey)).toBeNull();
  });

  it("waits for the malware scan, and rejects files with threats", async () => {
    const pending = await seedMedia(await jpeg());
    await expect(
      runMediaProcess(
        { db: handle.db, sandbox, storage: scanning("pending"), media, requireScan: true },
        { workspaceId, mediaId: pending.mediaId },
      ),
    ).rejects.toBeInstanceOf(ScanPendingError);
    const infected = await seedMedia(await jpeg());
    expect(
      await runMediaProcess(
        { db: handle.db, sandbox, storage: scanning("threats"), media, requireScan: true },
        { workspaceId, mediaId: infected.mediaId },
      ),
    ).toBe("rejected");
    expect(await row(infected.mediaId)).toMatchObject({
      status: "rejected",
      rejectReason: "malware",
    });
    expect(await storage.get(infected.objectKey)).toBeNull();
  });

  it("rejects a file that is not what it claims, with its reason", async () => {
    const { mediaId } = await seedMedia(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
    await runMediaProcess(
      { db: handle.db, sandbox, storage, media, requireScan: false },
      { workspaceId, mediaId },
    );
    expect(await row(mediaId)).toMatchObject({
      status: "rejected",
      rejectReason: "unsupported_type",
    });
  });

  it("rejects media over the storage limit with its real size (FR-065)", async () => {
    await handle.db
      .update(workspace)
      .set({ mediaStorageLimitMb: 1 })
      .where(eq(workspace.id, workspaceId));
    await handle.db.insert(mediaObject).values({
      workspaceId,
      kind: "image",
      status: "ready",
      objectPrefix: `media/${workspaceId}/${randomUUID()}/`,
      bytes: 1024 * 1024 - 10,
    });
    const { mediaId } = await seedMedia(await jpeg());
    await runMediaProcess(
      { db: handle.db, sandbox, storage, media, requireScan: false },
      { workspaceId, mediaId },
    );
    expect(await row(mediaId)).toMatchObject({ status: "rejected", rejectReason: "storage_limit" });
    expect(await media.get(`media/${workspaceId}/${mediaId}/large.webp`)).toBeNull();
  });
});
