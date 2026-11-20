import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuestExtras,
  GuestGuide,
  MemberExtra,
  PropertyCover,
  PropertyDetail,
  PropertyList,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Feature 016: property covers and extras photos (FR-001 to FR-010). Media rows are inserted
 * directly as `ready`, standing in for the upload pipeline that spec 003 already tests. All values
 * are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let other: TeamWorkspace;
let published: PublishedGuide;

async function insertMedia(
  workspaceId: string,
  options: { kind?: "image" | "video"; status?: "ready" | "processing" } = {},
): Promise<string> {
  const id = randomUUID();
  const prefix = `media/${workspaceId}/${id}/`;
  await db.query(
    `INSERT INTO media_object (id, workspace_id, kind, status, object_prefix, variants, bytes, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, 1000, 1600, 900)`,
    [
      id,
      workspaceId,
      options.kind ?? "image",
      options.status ?? "ready",
      prefix,
      JSON.stringify({
        large: { key: `${prefix}large.webp`, bytes: 800, width: 1600, height: 900 },
        small: { key: `${prefix}small.webp`, bytes: 200, width: 640, height: 360 },
      }),
    ],
  );
  return id;
}

const setCover = (mediaId: string | null, alt?: string, workspace = team) =>
  wsApi(
    ctx,
    workspace.owner,
    "PUT",
    workspace.workspaceId,
    `/properties/${published.propertyId}/cover`,
    {
      mediaId,
      ...(alt ? { alt } : {}),
    },
  );

const EXTRA = {
  sourceLanguage: "es",
  name: { es: "Alquiler de tabla de surf" },
  description: { es: "Tabla de 7 pies para principiantes." },
  price: 15,
  currency: "USD",
  leadTimeHours: 0,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  needsDate: false,
  needsTime: false,
  dateRange: "stay",
  maxPerStay: 2,
  preApproved: true,
  turnover: null,
  visible: true,
};

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "photos");
  other = await seedTeam(ctx, db, "photosother");
  published = await publishedGuide(ctx, team, { name: "Casa Brisa" });
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("property cover (US1)", () => {
  it("refuses media from another workspace, videos, and photos still processing", async () => {
    const foreign = await insertMedia(other.workspaceId);
    const video = await insertMedia(team.workspaceId, { kind: "video" });
    const processing = await insertMedia(team.workspaceId, { status: "processing" });
    expect((await setCover(foreign)).json()).toMatchObject({ code: "invalid_media" });
    expect((await setCover(video)).json()).toMatchObject({ code: "invalid_media" });
    const response = await setCover(processing);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "media_not_ready" });
  });

  it("sets a cover with a default description and shows it in the detail and the list", async () => {
    const mediaId = await insertMedia(team.workspaceId);
    const response = await setCover(mediaId);
    expect(response.statusCode, response.body).toBe(200);
    const { cover } = response.json() as { cover: PropertyCover };
    expect(cover).toMatchObject({ mediaId, alt: "Casa Brisa" });
    expect(cover.url).toBeTruthy();
    expect(cover.smallUrl).toBeTruthy();

    const detail = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, `/properties/${published.propertyId}`)
    ).json() as PropertyDetail;
    expect(detail.cover).toMatchObject({ mediaId, alt: "Casa Brisa" });
    const list = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, "/properties")
    ).json() as PropertyList;
    expect(list.items.find((item) => item.id === published.propertyId)?.cover?.mediaId).toBe(
      mediaId,
    );
  });

  it("gives guests the cover on the gated media path and serves it", async () => {
    const mediaId = await insertMedia(team.workspaceId);
    await setCover(mediaId, "Fachada con palmeras");
    const read = await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}?lang=es`);
    const guide = read.json() as GuestGuide;
    expect(guide.cover).toEqual({
      url: `/api/v1/guest/media/${published.publicId}/${mediaId}/large`,
      smallUrl: `/api/v1/guest/media/${published.publicId}/${mediaId}/small`,
      width: 1600,
      height: 900,
      alt: "Fachada con palmeras",
    });
    const served = await guest(ctx, "GET", guide.cover!.url);
    expect(served.statusCode).toBe(302);

    // Media the guide does not use stays unavailable to guests.
    const unused = await insertMedia(team.workspaceId);
    const refused = await guest(
      ctx,
      "GET",
      `/api/v1/guest/media/${published.publicId}/${unused}/large`,
    );
    expect(refused.statusCode).toBe(404);
  });

  it("removes the cover", async () => {
    const response = await setCover(null);
    expect(response.json()).toEqual({ cover: null });
    const guide = (
      await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}?lang=es`)
    ).json() as GuestGuide;
    expect(guide.cover).toBeNull();
  });

  it("lets only managers set the cover", async () => {
    const mediaId = await insertMedia(team.workspaceId);
    const response = await wsApi(
      ctx,
      team.agent,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/cover`,
      { mediaId },
    );
    expect(response.statusCode).toBe(403);
  });
});

describe("extras photos (US2)", () => {
  it("keeps a photo on an extra and shows it to members and guests", async () => {
    const mediaId = await insertMedia(team.workspaceId);
    const created = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${published.propertyId}/extras`,
      { ...EXTRA, mediaId },
    );
    expect(created.statusCode, created.body).toBe(201);
    const extra = created.json() as MemberExtra;
    expect(extra.mediaId).toBe(mediaId);
    expect(extra.media?.url).toBeTruthy();

    const guestList = (
      await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}/extras?lang=es`)
    ).json() as GuestExtras;
    const shown = guestList.extras.find((item) => item.id === extra.id);
    expect(shown?.image).toMatchObject({
      url: `/api/v1/guest/media/${published.publicId}/${mediaId}/large`,
      width: 1600,
    });
    expect((await guest(ctx, "GET", shown!.image!.url)).statusCode).toBe(302);

    // Removing the photo hides it from guests.
    const updated = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/extras/${extra.id}`,
      { version: extra.version, extra: { ...EXTRA, mediaId: null } },
    );
    expect(updated.statusCode, updated.body).toBe(200);
    expect((updated.json() as MemberExtra).media).toBeNull();
    expect((await guest(ctx, "GET", shown!.image!.url)).statusCode).toBe(404);
  });

  it("refuses a photo from another workspace", async () => {
    const foreign = await insertMedia(other.workspaceId);
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${published.propertyId}/extras`,
      { ...EXTRA, mediaId: foreign },
    );
    expect(response.json()).toMatchObject({ code: "invalid_media" });
  });
});
