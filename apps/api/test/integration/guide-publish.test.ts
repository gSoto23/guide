import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuideVersionList,
  GuideView,
  LockedFieldView,
  PropertyDetail,
  PublishCheck,
  PublishResult,
  SectionWriteResult,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Publishing (feature 003 US3, T071): readiness and pending-deletion blocks (FR-049), the publish
 * check (FR-050), versions with reviewed items only and no locked value (FR-051, SC-004), drafts
 * that never change what guests read (FR-052, SC-009), stale checks, restore, unpublish, the
 * 20-version list (FR-055), the security log, and agents reading only. All codes are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;

const LOCKBOX = "7342";
const WIFI = "palmera-azul";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "publish");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Publicada",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function guideAs(member = team.owner): Promise<GuideView> {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, path());
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as GuideView;
}

function sectionOf(view: GuideView, kind: string) {
  return view.sections.find((section) => section.kind === kind)!;
}

async function addText(kind: string, body: object): Promise<SectionWriteResult> {
  const section = sectionOf(await guideAs(), kind);
  const response = await wsApi(
    ctx,
    team.owner,
    "POST",
    team.workspaceId,
    path(`/sections/${section.id}/items`),
    { revision: section.revision, kind: "text", language: "es", ...body },
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as SectionWriteResult;
}

async function check(member = team.owner): Promise<PublishCheck> {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, path("/publish-check"));
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as PublishCheck;
}

async function publish(): Promise<PublishResult> {
  const { revisionHash } = await check();
  const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/publish"), {
    expectedRevisionHash: revisionHash,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as PublishResult;
}

async function guideRow() {
  const { rows } = await db.query<{
    status: string;
    published_version_id: string | null;
    has_unpublished_changes: boolean;
  }>(
    `SELECT status, published_version_id, has_unpublished_changes FROM guide WHERE property_id = $1`,
    [propertyId],
  );
  return rows[0]!;
}

async function versionSnapshot(number: number): Promise<string> {
  const { rows } = await db.query<{ snapshot: unknown }>(
    `SELECT v.snapshot FROM guide_version v JOIN guide g ON g.id = v.guide_id
      WHERE g.property_id = $1 AND v.number = $2`,
    [propertyId, number],
  );
  return JSON.stringify(rows[0]?.snapshot);
}

async function count(type: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = $2`,
    [team.workspaceId, type],
  );
  return rows[0]?.count ?? 0;
}

/** An item as an import leaves it: needs review (FR-005). */
async function insertUnreviewed(kind: string, text: string): Promise<string> {
  const section = sectionOf(await guideAs(), kind);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO guide_item (workspace_id, section_id, kind, position, source, source_language)
     VALUES ($1, $2, 'text', 50, 'listing', 'es') RETURNING id`,
    [team.workspaceId, section.id],
  );
  const itemId = rows[0]!.id;
  await db.query(
    `INSERT INTO guide_item_text (item_id, language, workspace_id, doc, text_length, origin, state)
     VALUES ($1, 'es', $2, $3, $4, 'source', 'current')`,
    [itemId, team.workspaceId, JSON.stringify(doc(text)), text.length],
  );
  return itemId;
}

describe("publishing (US3)", () => {
  let unreviewedId: string;
  let lockboxId: string;

  it("refuses to publish before the core facts are ready (FR-049)", async () => {
    await db.query(`UPDATE property SET setup_status = 'to_confirm' WHERE id = $1`, [propertyId]);
    const result = await check();
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("not_ready");
    const refused = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/publish"), {
      expectedRevisionHash: result.revisionHash,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: "not_ready_to_publish",
      setupStatus: "to_confirm",
    });
    await db.query(`UPDATE property SET setup_status = 'ready' WHERE id = $1`, [propertyId]);
  });

  it("refuses to publish in a workspace pending deletion (FR-049)", async () => {
    const { revisionHash } = await check();
    await db.query(`UPDATE workspace SET status = 'pending_deletion' WHERE id = $1`, [
      team.workspaceId,
    ]);
    try {
      const refused = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/publish"), {
        expectedRevisionHash: revisionHash,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: "workspace_pending_deletion" });
    } finally {
      await db.query(`UPDATE workspace SET status = 'active' WHERE id = $1`, [team.workspaceId]);
    }
  });

  it("lists left-out items and every warning without blocking (FR-050)", async () => {
    const lockbox = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/locked-fields"), {
      kind: "lockbox_code",
      label: "Caja de llaves",
      value: LOCKBOX,
    });
    expect(lockbox.statusCode, lockbox.body).toBe(201);
    lockboxId = (lockbox.json() as LockedFieldView).id;
    const unset = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/locked-fields"), {
      kind: "gate_code",
      label: "Portón",
    });
    const unsetId = (unset.json() as LockedFieldView).id;
    const wifi = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/locked-fields"), {
      kind: "wifi_password",
      value: WIFI,
    });
    const wifiId = (wifi.json() as LockedFieldView).id;
    const visible = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(`/locked-fields/${wifiId}/visibility`),
      { public: true },
    );
    expect(visible.statusCode, visible.body).toBe(200);

    await addText("arrival", {
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "La llave está en la caja: " },
              { type: "lockedField", attrs: { fieldId: lockboxId } },
              { type: "text", text: " y el portón: " },
              { type: "lockedField", attrs: { fieldId: unsetId } },
            ],
          },
        ],
      },
    });
    await addText("wifi", {
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Contraseña: " },
              { type: "lockedField", attrs: { fieldId: wifiId } },
            ],
          },
        ],
      },
    });
    await addText("house_rules", { doc: doc("Reserva directo conmigo y te hago descuento.") });
    await addText("checkout", { doc: doc("El código de la puerta es 4821") });
    unreviewedId = await insertUnreviewed("parking", "Parqueo frente a la casa.");

    const result = await check();
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.revisionHash).toMatch(/^[a-f0-9]{64}$/);
    const parking = sectionOf(await guideAs(), "parking");
    expect(result.leftOut).toEqual([{ sectionId: parking.id, itemIds: [unreviewedId] }]);
    const kinds = result.warnings.map((warning) => warning.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "missing_essential",
        "unset_locked_field",
        "code_like_text",
        "off_platform",
      ]),
    );
    expect(result.warnings).toContainEqual({ kind: "unset_locked_field", fieldId: unsetId });
    expect(JSON.stringify(result)).not.toContain("4821");
  });

  it("publishes version 1 with reviewed items only and no locked value (FR-051, SC-004)", async () => {
    const before = await count("guide.published");
    expect(await publish()).toEqual({ versionNumber: 1 });
    const snapshot = await versionSnapshot(1);
    expect(snapshot).toContain(lockboxId);
    expect(snapshot).not.toContain(unreviewedId);
    expect(snapshot).not.toContain(LOCKBOX);
    expect(snapshot).not.toContain(WIFI);
    const row = await guideRow();
    expect(row).toMatchObject({ status: "published", has_unpublished_changes: false });
    expect(row.published_version_id).not.toBeNull();
    const view = await guideAs();
    expect(view).toMatchObject({
      status: "published",
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    });
    expect(await count("guide.published")).toBe(before + 1);
  });

  it("keeps the current version for a repeated publish of the same content", async () => {
    expect(await publish()).toEqual({ versionNumber: 1 });
  });

  it("leaves the published version alone when the draft changes (FR-052, SC-009)", async () => {
    const { published_version_id: publishedBefore } = await guideRow();
    const snapshotBefore = await versionSnapshot(1);
    const { revisionHash } = await check();
    await addText("appliances", { doc: doc("La cafetera está en la alacena.") });
    const row = await guideRow();
    expect(row.published_version_id).toBe(publishedBefore);
    expect(row.has_unpublished_changes).toBe(true);
    expect(await versionSnapshot(1)).toBe(snapshotBefore);
    expect(await guideAs()).toMatchObject({ status: "published", hasUnpublishedChanges: true });

    // A check older than the draft answers section_changed.
    const stale = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/publish"), {
      expectedRevisionHash: revisionHash,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "section_changed" });
  });

  it("restores version 1 as the draft without publishing it (FR-055)", async () => {
    expect(await publish()).toEqual({ versionNumber: 2 });
    expect(await versionSnapshot(2)).toContain("La cafetera");
    const { published_version_id: current } = await guideRow();
    const before = await count("guide.version_restored");

    const restored = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path("/versions/1/restore"),
    );
    expect(restored.statusCode, restored.body).toBe(200);
    const view = restored.json() as GuideView;
    expect(JSON.stringify(sectionOf(view, "appliances"))).not.toContain("La cafetera");
    expect(JSON.stringify(view)).toContain("La llave está en la caja");
    // The unreviewed item left out of version 1 is not part of the restored draft.
    expect(JSON.stringify(view)).not.toContain(unreviewedId);
    expect(view).toMatchObject({ status: "published", publishedVersion: 2 });
    expect(view.hasUnpublishedChanges).toBe(true);
    expect((await guideRow()).published_version_id).toBe(current);
    expect(await count("guide.version_restored")).toBe(before + 1);

    expect(await publish()).toEqual({ versionNumber: 3 });
    expect(await versionSnapshot(3)).not.toContain("La cafetera");
  });

  it("unpublishes, so guests are not served the guide (FR-056)", async () => {
    const before = await count("guide.unpublished");
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/unpublish"));
    expect(response.statusCode, response.body).toBe(204);
    expect(await guideRow()).toMatchObject({ status: "unpublished", published_version_id: null });
    expect(await guideAs()).toMatchObject({ status: "unpublished", publishedVersion: null });
    const preview = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      path("/preview?source=published"),
    );
    expect(preview.statusCode).toBe(404);
    expect(await count("guide.unpublished")).toBe(before + 1);
  });

  it("lists only the latest 20 versions (FR-055)", async () => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM guide WHERE property_id = $1`, [
      propertyId,
    ]);
    for (let number = 4; number <= 23; number += 1) {
      await db.query(
        `INSERT INTO guide_version (workspace_id, guide_id, number, cause, snapshot, snapshot_schema, languages)
         VALUES ($1, $2, $3, 'publish', '{"schema":1,"languages":["es"],"sections":[]}', 1, ARRAY['es'])`,
        [team.workspaceId, rows[0]!.id, number],
      );
    }
    const response = await wsApi(ctx, team.agent, "GET", team.workspaceId, path("/versions"));
    expect(response.statusCode, response.body).toBe(200);
    const list = response.json() as GuideVersionList;
    expect(list.items).toHaveLength(20);
    expect(list.items[0]?.number).toBe(23);
    expect(list.items.at(-1)?.number).toBe(4);
  });

  it("lets agents read versions and previews but not publish, unpublish, or restore (AC-SEC-001)", async () => {
    const preview = await wsApi(
      ctx,
      team.agent,
      "GET",
      team.workspaceId,
      path("/preview?source=draft"),
    );
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain(LOCKBOX);
    for (const [method, suffix, body] of [
      ["GET", "/publish-check", undefined],
      ["POST", "/publish", { expectedRevisionHash: "0".repeat(64) }],
      ["POST", "/unpublish", undefined],
      ["POST", "/versions/1/restore", undefined],
    ] as const) {
      const denied = await wsApi(ctx, team.agent, method, team.workspaceId, path(suffix), body);
      expect(denied.statusCode, `${method} ${suffix}`).toBe(403);
    }
  });
});
