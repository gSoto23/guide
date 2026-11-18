import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuideView,
  MediaUpload,
  MediaView,
  PropertyDetail,
  SectionWriteResult,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/** Guide media through the API (feature 003 T043, FR-009, FR-065, research R9). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guide-media");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Foto",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix: string) => `/properties/${propertyId}/guide${suffix}`;

async function readyMedia(kind: "image" | "video"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO media_object (workspace_id, kind, status, object_prefix, bytes, variants)
     VALUES ($1::uuid, $2, 'ready', 'media/' || $1::text || '/' || gen_random_uuid() || '/', 100, '{}'::jsonb)
     RETURNING id`,
    [team.workspaceId, kind],
  );
  return rows[0]!.id;
}

describe("guide media", () => {
  it("gives a presigned form for an image and refuses wrong types and sizes", async () => {
    const ok = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/media"), {
      kind: "image",
      contentType: "image/jpeg",
      size: 2_000_000,
      fileName: "entrada.jpg",
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const form = ok.json() as MediaUpload;
    expect(form.upload.fields).toMatchObject({ "Content-Type": "image/jpeg" });
    const { rows } = await db.query<{ status: string; object_prefix: string }>(
      `SELECT status, object_prefix FROM media_object WHERE id = $1`,
      [form.mediaId],
    );
    expect(rows[0]).toEqual({
      status: "uploading",
      object_prefix: `media/${team.workspaceId}/${form.mediaId}/`,
    });
    for (const body of [
      { kind: "image", contentType: "video/mp4", size: 100, fileName: "x.mp4" },
      { kind: "image", contentType: "image/jpeg", size: 11 * 1024 * 1024, fileName: "x.jpg" },
      { kind: "video", contentType: "image/gif", size: 100, fileName: "x.gif" },
    ]) {
      const refused = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/media"), body);
      expect(refused.statusCode, JSON.stringify(body)).toBe(422);
    }
  });

  it("queues processing on completion and shows the media as processing", async () => {
    const created = (
      await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/media"), {
        kind: "video",
        contentType: "video/mp4",
        size: 5_000_000,
        fileName: "cafetera.mp4",
      })
    ).json() as MediaUpload;
    const done = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/media/${created.mediaId}/complete`),
    );
    expect(done.statusCode, done.body).toBe(202);
    expect((done.json() as MediaView).status).toBe("processing");
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'media.process' AND data->>'mediaId' = $1`,
      [created.mediaId],
    );
    expect(rows[0]?.count).toBe(1);
    const again = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/media/${created.mediaId}/complete`),
    );
    expect(again.statusCode).toBe(409);
  });

  it("refuses media over the storage limit (FR-065)", async () => {
    await db.query(`UPDATE workspace SET media_storage_limit_mb = 1 WHERE id = $1`, [
      team.workspaceId,
    ]);
    const refused = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/media"), {
      kind: "image",
      contentType: "image/png",
      size: 2 * 1024 * 1024,
      fileName: "grande.png",
    });
    expect(refused.json()).toMatchObject({ code: "storage_limit_reached" });
    await db.query(`UPDATE workspace SET media_storage_limit_mb = NULL WHERE id = $1`, [
      team.workspaceId,
    ]);
  });

  it("adds media items and limits videos to 3 per section (FR-009)", async () => {
    const view = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path(""))
    ).json() as GuideView;
    let section = view.sections.find((candidate) => candidate.kind === "appliances")!;
    for (let index = 0; index < 3; index += 1) {
      const added = await wsApi(
        ctx,
        team.owner,
        "POST",
        team.workspaceId,
        path(`/sections/${section.id}/items`),
        {
          revision: section.revision,
          kind: "video",
          language: "es",
          mediaId: await readyMedia("video"),
        },
      );
      expect(added.statusCode, added.body).toBe(201);
      section = (added.json() as SectionWriteResult).section;
    }
    const fourth = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${section.id}/items`),
      {
        revision: section.revision,
        kind: "video",
        language: "es",
        mediaId: await readyMedia("video"),
      },
    );
    expect(fourth.json()).toMatchObject({ code: "item_limit" });
  });

  it("lets agents view media but not upload", async () => {
    const refused = await wsApi(ctx, team.agent, "POST", team.workspaceId, path("/media"), {
      kind: "image",
      contentType: "image/jpeg",
      size: 100,
      fileName: "x.jpg",
    });
    expect(refused.statusCode).toBe(403);
    const mediaId = await readyMedia("image");
    const viewed = await wsApi(ctx, team.agent, "GET", team.workspaceId, path(`/media/${mediaId}`));
    expect(viewed.statusCode).toBe(200);
  });
});
