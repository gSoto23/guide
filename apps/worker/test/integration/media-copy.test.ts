import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, mediaObject, membership, user, workspace, type DbHandle } from "@guidesk/db";
import { LocalMediaStorage } from "@guidesk/integrations";
import { runMediaCopy } from "../../src/jobs/media-copy.js";

/**
 * Media for a duplicated property (feature 003 FR-067, T119): every variant is copied to the new
 * object's keys, so deleting one property never takes the other's images. Synthetic bytes only.
 */
let handle: DbHandle;
let dir: string;
let media: LocalMediaStorage;
let workspaceId: string;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  dir = await mkdtemp(join(tmpdir(), "guidesk-media-copy-"));
  media = new LocalMediaStorage({
    dir,
    mediaUrl: "http://localhost/media",
    secret: Buffer.alloc(32, 2),
  });
});

afterAll(async () => {
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

describe("media.copy (T119)", () => {
  it("copies every variant to the new prefix and marks the copy ready", async () => {
    const sourceId = randomUUID();
    const targetId = randomUUID();
    const sourcePrefix = `media/${workspaceId}/${sourceId}/`;
    await media.put(`${sourcePrefix}large.webp`, Buffer.from("grande"), "image/webp");
    await media.put(`${sourcePrefix}small.webp`, Buffer.from("chica"), "image/webp");
    await handle.db.insert(mediaObject).values([
      {
        id: sourceId,
        workspaceId,
        kind: "image",
        status: "ready",
        objectPrefix: sourcePrefix,
        variants: {
          large: { key: `${sourcePrefix}large.webp`, bytes: 6, width: 1600, height: 900 },
          small: { key: `${sourcePrefix}small.webp`, bytes: 5, width: 640, height: 360 },
        },
        bytes: 11,
        width: 1600,
        height: 900,
      },
      {
        id: targetId,
        workspaceId,
        kind: "image",
        status: "processing",
        objectPrefix: `media/${workspaceId}/${targetId}/`,
      },
    ]);
    expect(
      await runMediaCopy(
        { db: handle.db, media },
        { workspaceId, mediaId: targetId, sourceMediaId: sourceId },
      ),
    ).toBe("copied");
    const [copy] = await handle.db.select().from(mediaObject).where(eq(mediaObject.id, targetId));
    expect(copy).toMatchObject({ status: "ready", bytes: 11, width: 1600 });
    expect(copy?.variants.large?.key).toBe(`media/${workspaceId}/${targetId}/large.webp`);
    expect((await media.get(`media/${workspaceId}/${targetId}/small.webp`))?.toString()).toBe(
      "chica",
    );
  });

  it("rejects the copy when the source is gone", async () => {
    const targetId = randomUUID();
    await handle.db.insert(mediaObject).values({
      id: targetId,
      workspaceId,
      kind: "image",
      status: "processing",
      objectPrefix: `media/${workspaceId}/${targetId}/`,
    });
    expect(
      await runMediaCopy(
        { db: handle.db, media },
        { workspaceId, mediaId: targetId, sourceMediaId: randomUUID() },
      ),
    ).toBe("source_missing");
    const [copy] = await handle.db.select().from(mediaObject).where(eq(mediaObject.id, targetId));
    expect(copy?.status).toBe("rejected");
  });
});
