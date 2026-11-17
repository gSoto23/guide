import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ListingContentList } from "@guidesk/contracts";
import { createDb, upsertListingContent, type DbHandle } from "@guidesk/db";
import { systemQuery } from "./helpers.js";
import { insertProperty, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/** Listing content review and the re-import rule (T028, FR-013, FR-018, FR-033). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let system: DbHandle;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  system = createDb(inject("databaseUrl"), { max: 1 });
  team = await seedTeam(ctx, db, "content");
});

afterAll(async () => {
  await system.pool.end();
  await db.close();
  await ctx.app.close();
});

/** A property with a title from the listing and a description and amenities from Beds24. */
async function propertyWithContent() {
  const propertyId = await insertProperty(db, team.workspaceId);
  const base = { workspaceId: team.workspaceId, propertyId };
  await upsertListingContent(system.db, {
    ...base,
    kind: "title",
    body: "Casa junto al mar",
    source: "listing_text",
  });
  await upsertListingContent(system.db, {
    ...base,
    kind: "description",
    body: "Vista al mar.",
    source: "pms",
  });
  await upsertListingContent(system.db, {
    ...base,
    kind: "amenities",
    items: ["Wi-Fi", "Piscina"],
    source: "pms",
  });
  return propertyId;
}

const path = (propertyId: string, suffix = "") =>
  `/properties/${propertyId}/listing-content${suffix}`;

async function roleDenials(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
    [team.workspaceId],
  );
  return rows[0]?.count ?? 0;
}

describe("listing content (T028)", () => {
  it("lists items in order with their source, for every role", async () => {
    const propertyId = await propertyWithContent();
    for (const member of [team.owner, team.agent]) {
      const response = await wsApi(ctx, member, "GET", team.workspaceId, path(propertyId));
      expect(response.statusCode).toBe(200);
      const list = response.json() as ListingContentList;
      expect(list.items.map((item) => [item.kind, item.source, item.reviewState])).toEqual([
        ["title", "listing_text", "unreviewed"],
        ["description", "pms", "unreviewed"],
        ["amenities", "pms", "unreviewed"],
      ]);
    }
  });

  it("marks an edit as edited and an approval as approved (US2 scenario 7)", async () => {
    const propertyId = await propertyWithContent();
    const edited = await wsApi(
      ctx,
      team.admin,
      "PUT",
      team.workspaceId,
      path(propertyId, "/description"),
      {
        body: "Vista al mar y al atardecer.",
      },
    );
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({
      body: "Vista al mar y al atardecer.",
      reviewState: "edited",
      source: "pms",
    });

    const approved = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(propertyId, "/title/approve"),
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ reviewState: "approved" });
  });

  it("refuses text that looks like a code and points to the locked fields (FR-013)", async () => {
    const propertyId = await propertyWithContent();
    const response = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(propertyId, "/description"),
      {
        body: "Llegada fácil. Door code 4821.",
      },
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "validation_failed",
      fields: { body: ["restricted_value"] },
      detail: expect.stringContaining("locked fields"),
    });
    const list = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path(propertyId))
    ).json() as ListingContentList;
    expect(list.items.find((item) => item.kind === "description")?.body).toBe("Vista al mar.");
  });

  it("gives agents read-only access and logs their refused edits (AC-SEC-001)", async () => {
    const propertyId = await propertyWithContent();
    const before = await roleDenials();
    const edit = await wsApi(ctx, team.agent, "PUT", team.workspaceId, path(propertyId, "/title"), {
      body: "x",
    });
    const approve = await wsApi(
      ctx,
      team.agent,
      "POST",
      team.workspaceId,
      path(propertyId, "/title/approve"),
    );
    expect(edit.statusCode).toBe(403);
    expect(approve.statusCode).toBe(403);
    expect(await roleDenials()).toBe(before + 2);
  });

  it("never lets a re-import overwrite edited or approved content (FR-033)", async () => {
    const propertyId = await propertyWithContent();
    await wsApi(ctx, team.owner, "PUT", team.workspaceId, path(propertyId, "/description"), {
      body: "Texto del anfitrión.",
    });
    await wsApi(ctx, team.owner, "POST", team.workspaceId, path(propertyId, "/title/approve"));

    const base = { workspaceId: team.workspaceId, propertyId, source: "pms" as const };
    expect(
      await upsertListingContent(system.db, {
        ...base,
        kind: "description",
        body: "Nuevo texto del PMS.",
      }),
    ).toBe(false);
    expect(
      await upsertListingContent(system.db, { ...base, kind: "title", body: "Nuevo título" }),
    ).toBe(false);
    expect(
      await upsertListingContent(system.db, {
        ...base,
        kind: "amenities",
        items: ["Wi-Fi", "Aire acondicionado"],
      }),
    ).toBe(true);

    const list = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path(propertyId))
    ).json() as ListingContentList;
    const byKind = Object.fromEntries(list.items.map((item) => [item.kind, item]));
    expect(byKind.description).toMatchObject({
      body: "Texto del anfitrión.",
      reviewState: "edited",
    });
    expect(byKind.title).toMatchObject({ body: "Casa junto al mar", reviewState: "approved" });
    expect(byKind.amenities).toMatchObject({
      items: ["Wi-Fi", "Aire acondicionado"],
      reviewState: "unreviewed",
    });
  });

  it("answers 404 for another workspace's property", async () => {
    const other = await seedTeam(ctx, db, "content-other");
    const foreign = await insertProperty(db, other.workspaceId);
    const response = await wsApi(ctx, team.owner, "GET", team.workspaceId, path(foreign));
    expect(response.statusCode).toBe(404);
  });
});
