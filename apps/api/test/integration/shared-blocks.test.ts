import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuideView,
  PropertyDetail,
  PublishCheck,
  SectionWriteResult,
  SharedBlockList,
  SharedBlockProperties,
  SharedBlockPublishResult,
  SharedBlockView,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Shared content (feature 003 T112, research R14, FR-057 to FR-062): blocks with their own items,
 * locked fields refused, the 50-block limit, publishing with the fan-out job queued, inherited
 * items in drafts marked shared, override with its revision and "The shared version changed",
 * exclude and reset, delete, the security log, other workspaces, and agents reading only.
 * Fictional text only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let other: TeamWorkspace;
let first: string;
let second: string;
let blockId: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "shared");
  other = await seedTeam(ctx, db, "shared-other");
  await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [team.workspaceId]);
  for (const name of ["Casa Uno", "Casa Dos"]) {
    const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      name,
    });
    const id = (created.json() as PropertyDetail).id;
    if (name === "Casa Uno") first = id;
    else second = id;
  }
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const blocks = (suffix = "") => `/shared-blocks${suffix}`;
const guidePath = (propertyId: string, suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function block(): Promise<SharedBlockView> {
  return (
    await wsApi(ctx, team.owner, "GET", team.workspaceId, blocks(`/${blockId}`))
  ).json() as SharedBlockView;
}

async function guideOf(propertyId: string): Promise<GuideView> {
  return (
    await wsApi(ctx, team.owner, "GET", team.workspaceId, guidePath(propertyId))
  ).json() as GuideView;
}

function checkout(view: GuideView) {
  return view.sections.find((section) => section.kind === "checkout")!;
}

async function events(type: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = $2`,
    [team.workspaceId, type],
  );
  return rows[0]?.count ?? 0;
}

describe("shared content (US7)", () => {
  it("creates a block and adds items, refusing locked fields (FR-057)", async () => {
    const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, blocks(), {
      sectionKind: "checkout",
      name: "Pasos de salida",
    });
    expect(created.statusCode, created.body).toBe(201);
    const view = created.json() as SharedBlockView;
    blockId = view.id;
    expect(view).toMatchObject({ status: "draft", revision: 0, sectionKind: "checkout" });

    const added = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      blocks(`/${blockId}/items`),
      { revision: 0, kind: "text", language: "es", doc: doc("Dejen las llaves en la mesa.") },
    );
    expect(added.statusCode, added.body).toBe(201);
    expect((added.json() as SharedBlockView).items).toHaveLength(1);

    const locked = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      blocks(`/${blockId}/items`),
      {
        revision: 1,
        kind: "text",
        language: "es",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "lockedField", attrs: { fieldId: "00000000-0000-4000-8000-000000000000" } },
              ],
            },
          ],
        },
      },
    );
    expect(locked.statusCode).toBe(422);

    const stale = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      blocks(`/${blockId}/items`),
      { revision: 0, kind: "text", language: "es", doc: doc("Tarde.") },
    );
    expect(stale.statusCode).toBe(409);
  });

  it("stops at 50 blocks (422 shared_block_limit)", async () => {
    await db.query(
      `INSERT INTO shared_block (workspace_id, section_kind, name, position)
       SELECT $1, 'amenities', 'Bloque ' || n, n FROM generate_series(1, 49) AS n`,
      [team.workspaceId],
    );
    const refused = await wsApi(ctx, team.owner, "POST", team.workspaceId, blocks(), {
      sectionKind: "wifi",
      name: "Uno más",
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ code: "shared_block_limit", limit: 50 });
    await db.query(`DELETE FROM shared_block WHERE workspace_id = $1 AND name LIKE 'Bloque %'`, [
      team.workspaceId,
    ]);
  });

  it("shows a published block in every draft, marked shared, and queues the fan-out (FR-058, FR-060)", async () => {
    // Not inherited while it is a draft.
    expect(JSON.stringify(checkout(await guideOf(first)))).not.toContain("Dejen las llaves");
    const before = await events("shared_block.published");
    const published = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      blocks(`/${blockId}/publish`),
    );
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json() as SharedBlockPublishResult).toEqual({
      publishedRevision: 1,
      guidesToUpdate: 0,
    });
    expect(await events("shared_block.published")).toBe(before + 1);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'shared-block.publish' AND data->>'sharedBlockId' = $1`,
      [blockId],
    );
    expect(rows[0]?.count).toBe(1);

    for (const propertyId of [first, second]) {
      const view = await guideOf(propertyId);
      const items = checkout(view).items.filter((item) => item.sharedBlockId === blockId);
      expect(items).toHaveLength(1);
      expect(view.sharedBlocks).toContainEqual(
        expect.objectContaining({ id: blockId, mode: "inherit", behind: false }),
      );
    }
    // Inherited content goes into the next publish.
    const check = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, guidePath(first, "/publish-check"))
    ).json() as PublishCheck;
    const publish = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      guidePath(first, "/publish"),
      {
        expectedRevisionHash: check.revisionHash,
      },
    );
    expect(publish.statusCode, publish.body).toBe(201);
    const { rows: snapshot } = await db.query<{ snapshot: unknown }>(
      `SELECT v.snapshot FROM guide_version v JOIN guide g ON g.id = v.guide_id WHERE g.property_id = $1`,
      [first],
    );
    expect(JSON.stringify(snapshot[0]?.snapshot)).toContain(blockId);
  });

  it("overrides a block with reviewed copies, then shows when the shared version changed (FR-059, FR-061)", async () => {
    const overridden = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      guidePath(second, `/shared-blocks/${blockId}/override`),
    );
    expect(overridden.statusCode, overridden.body).toBe(200);
    const section = (overridden.json() as SectionWriteResult).section;
    expect(section.items.filter((item) => item.sharedBlockId === blockId)).toHaveLength(0);
    const copy = section.items.find((item) => item.source === "copy")!;
    expect(copy).toMatchObject({ reviewed: true, sourceDetail: "Pasos de salida" });
    expect((await guideOf(second)).sharedBlocks).toContainEqual(
      expect.objectContaining({ id: blockId, mode: "override", behind: false }),
    );

    // The block changes and is published again: the override is behind.
    const current = await block();
    await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      blocks(`/items/${current.items[0]!.id}`),
      {
        revision: current.revision,
        language: "es",
        doc: doc("Dejen las llaves en la mesa del comedor."),
      },
    );
    expect((await block()).hasUnpublishedChanges).toBe(true);
    await wsApi(ctx, team.owner, "POST", team.workspaceId, blocks(`/${blockId}/publish`));
    expect((await guideOf(second)).sharedBlocks).toContainEqual(
      expect.objectContaining({ id: blockId, mode: "override", behind: true }),
    );
    const properties = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, blocks(`/${blockId}/properties`))
    ).json() as SharedBlockProperties;
    expect(properties.override).toEqual([
      expect.objectContaining({ propertyId: second, behind: true }),
    ]);
    expect(properties.inherit.map((entry) => entry.propertyId)).toContain(first);
  });

  it("excludes a block and resets it to shared", async () => {
    const excluded = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      guidePath(second, `/shared-blocks/${blockId}/exclude`),
    );
    expect(excluded.statusCode, excluded.body).toBe(200);
    const section = (excluded.json() as SectionWriteResult).section;
    expect(section.items.some((item) => item.source === "copy")).toBe(false);
    expect(section.items.some((item) => item.sharedBlockId === blockId)).toBe(false);

    const reset = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      guidePath(second, `/shared-blocks/${blockId}/link`),
    );
    expect(reset.statusCode, reset.body).toBe(200);
    expect(
      (reset.json() as SectionWriteResult).section.items.filter(
        (item) => item.sharedBlockId === blockId,
      ),
    ).toHaveLength(1);
    const list = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, blocks())
    ).json() as SharedBlockList;
    expect(list.items.find((item) => item.id === blockId)?.counts).toEqual({
      inherit: 2,
      override: 0,
      exclude: 0,
    });
  });

  it("keeps other workspaces out and lets agents read only (AC-SEC-001)", async () => {
    const foreign = await wsApi(ctx, other.owner, "GET", other.workspaceId, blocks(`/${blockId}`));
    expect(foreign.statusCode).toBe(404);
    const read = await wsApi(ctx, team.agent, "GET", team.workspaceId, blocks(`/${blockId}`));
    expect(read.statusCode).toBe(200);
    for (const [method, suffix] of [
      ["POST", blocks(`/${blockId}/publish`)],
      ["DELETE", blocks(`/${blockId}`)],
      ["POST", guidePath(first, `/shared-blocks/${blockId}/exclude`)],
    ] as const) {
      const denied = await wsApi(ctx, team.agent, method, team.workspaceId, suffix);
      expect(denied.statusCode, `${method} ${suffix}`).toBe(403);
    }
  });

  it("deletes a block from every draft and queues its removal from published guides", async () => {
    const before = await events("shared_block.deleted");
    const removed = await wsApi(ctx, team.owner, "DELETE", team.workspaceId, blocks(`/${blockId}`));
    expect(removed.statusCode).toBe(204);
    expect(await events("shared_block.deleted")).toBe(before + 1);
    expect(JSON.stringify(checkout(await guideOf(first)))).not.toContain(blockId);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'shared-block.publish' AND data->>'change' = 'deleted' AND data->>'sharedBlockId' = $1`,
      [blockId],
    );
    expect(rows[0]?.count).toBe(1);
  });
});
