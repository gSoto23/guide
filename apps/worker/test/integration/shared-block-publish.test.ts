import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  createDb,
  createGuideForProperty,
  guide,
  guideSharedLink,
  guideVersion,
  membership,
  property,
  sharedBlock,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import type { GuideSnapshot } from "@guidesk/domain";
import { runSharedBlockPublish } from "../../src/jobs/shared-block-publish.js";

/**
 * Shared-block fan-out (feature 003 T112, T113, research R14, FR-060, SC-007): every published
 * guide that inherits the block gets a new version made from its previous published snapshot;
 * draft edits never go live; overriding, excluding, and unpublished guides are left alone; a
 * deleted block leaves every published guide; 50 guides within 1 minute. Fictional text only.
 */
let handle: DbHandle;
let workspaceId: string;
let ownerId: string;
let blockId: string;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
});

afterAll(async () => {
  await handle.pool.end();
});

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function snapshotWith(text: string): GuideSnapshot {
  return {
    schema: 1,
    languages: ["es"],
    sections: [
      {
        id: randomUUID(),
        kind: "checkout",
        items: [
          {
            id: randomUUID(),
            kind: "text",
            texts: { es: paragraph(text) as never },
            sourceLanguage: "es",
          },
        ],
      },
    ],
  };
}

async function publishedGuide(text: string, status: "published" | "unpublished" = "published") {
  const [row] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: `Casa ${randomUUID().slice(0, 6)}`,
      guideLanguages: ["es"],
      setupStatus: "ready",
      source: "manual",
    })
    .returning({ id: property.id });
  const { guideId } = await createGuideForProperty(handle.db, {
    workspaceId,
    propertyId: row!.id,
    guideLanguages: ["es"],
  });
  const [version] = await handle.db
    .insert(guideVersion)
    .values({
      workspaceId,
      guideId,
      number: 1,
      cause: "publish",
      snapshot: snapshotWith(text),
      snapshotSchema: 1,
      languages: ["es"],
      publishedBy: ownerId,
    })
    .returning({ id: guideVersion.id });
  await handle.db
    .update(guide)
    .set({
      status,
      publishedVersionId: status === "published" ? version!.id : null,
      hasUnpublishedChanges: true,
    })
    .where(eq(guide.id, guideId));
  return guideId;
}

async function latest(guideId: string) {
  const [row] = await handle.db
    .select({
      number: guideVersion.number,
      cause: guideVersion.cause,
      snapshot: guideVersion.snapshot,
      publishedBy: guideVersion.publishedBy,
      sharedBlockId: guideVersion.sharedBlockId,
    })
    .from(guideVersion)
    .where(eq(guideVersion.guideId, guideId))
    .orderBy(desc(guideVersion.number))
    .limit(1);
  return row!;
}

beforeEach(async () => {
  ownerId = `owner-${randomUUID()}`;
  workspaceId = randomUUID();
  await handle.db
    .insert(user)
    .values({ id: ownerId, name: "Dueña", email: `${ownerId}@example.com` });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId, propertyLimit: 60 });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  const [row] = await handle.db
    .insert(sharedBlock)
    .values({
      workspaceId,
      sectionKind: "checkout",
      name: "Pasos de salida",
      status: "published",
      revision: 3,
      publishedRevision: 3,
      publishedSnapshot: {
        items: [
          {
            id: randomUUID(),
            kind: "text",
            texts: { es: paragraph("Dejen las llaves en la mesa.") },
            sourceLanguage: "es",
          },
        ],
      },
    })
    .returning({ id: sharedBlock.id });
  blockId = row!.id;
});

describe("the shared-block fan-out (T112)", () => {
  it("adds the block to every inheriting published guide from its published snapshot (FR-060)", async () => {
    const guideId = await publishedGuide("Salida a las 11.");
    const result = await runSharedBlockPublish(
      { db: handle.db },
      { workspaceId, sharedBlockId: blockId, change: "published" },
    );
    expect(result).toEqual({ guidesUpdated: 1 });
    const version = await latest(guideId);
    expect(version).toMatchObject({
      number: 2,
      cause: "shared_block",
      publishedBy: null,
      sharedBlockId: blockId,
    });
    const text = JSON.stringify(version.snapshot);
    expect(text).toContain("Salida a las 11.");
    expect(text).toContain("Dejen las llaves en la mesa.");
    const [row] = await handle.db
      .select({ hasUnpublishedChanges: guide.hasUnpublishedChanges })
      .from(guide)
      .where(eq(guide.id, guideId));
    expect(row?.hasUnpublishedChanges).toBe(true);

    // Publishing the same content again writes nothing.
    expect(
      await runSharedBlockPublish(
        { db: handle.db },
        { workspaceId, sharedBlockId: blockId, change: "published" },
      ),
    ).toEqual({ guidesUpdated: 0 });
  });

  it("leaves overriding, excluding, and unpublished guides alone", async () => {
    const overriding = await publishedGuide("Mi salida propia.");
    const excluding = await publishedGuide("Sin bloque.");
    const unpublished = await publishedGuide("No publicada.", "unpublished");
    await handle.db.insert(guideSharedLink).values([
      {
        guideId: overriding,
        sharedBlockId: blockId,
        workspaceId,
        mode: "override",
        basedOnRevision: 3,
      },
      { guideId: excluding, sharedBlockId: blockId, workspaceId, mode: "exclude" },
    ]);
    expect(
      await runSharedBlockPublish(
        { db: handle.db },
        { workspaceId, sharedBlockId: blockId, change: "published" },
      ),
    ).toEqual({ guidesUpdated: 0 });
    for (const guideId of [overriding, excluding, unpublished]) {
      expect((await latest(guideId)).number).toBe(1);
    }
  });

  it("removes a deleted block from every published guide", async () => {
    const guideId = await publishedGuide("Salida a las 11.");
    await runSharedBlockPublish(
      { db: handle.db },
      { workspaceId, sharedBlockId: blockId, change: "published" },
    );
    await handle.db.delete(sharedBlock).where(eq(sharedBlock.id, blockId));
    expect(
      await runSharedBlockPublish(
        { db: handle.db },
        { workspaceId, sharedBlockId: blockId, change: "deleted" },
      ),
    ).toEqual({ guidesUpdated: 1 });
    const version = await latest(guideId);
    expect(version).toMatchObject({ number: 3, cause: "shared_block_removed" });
    expect(JSON.stringify(version.snapshot)).not.toContain("Dejen las llaves");
    expect(JSON.stringify(version.snapshot)).toContain("Salida a las 11.");
  });

  it("updates 50 published guides within 1 minute (SC-007)", async () => {
    const guides: string[] = [];
    for (let index = 0; index < 50; index += 1) guides.push(await publishedGuide(`Casa ${index}.`));
    const started = performance.now();
    const result = await runSharedBlockPublish(
      { db: handle.db },
      { workspaceId, sharedBlockId: blockId, change: "published" },
    );
    const elapsed = performance.now() - started;
    console.info(`shared-block fan-out: ${guides.length} guides in ${elapsed.toFixed(0)} ms`);
    expect(result.guidesUpdated).toBe(50);
    expect(elapsed).toBeLessThan(60_000);
    const [check] = await handle.db
      .select({ cause: guideVersion.cause })
      .from(guideVersion)
      .where(and(eq(guideVersion.guideId, guides[49]!), eq(guideVersion.number, 2)));
    expect(check?.cause).toBe("shared_block");
  }, 120_000);
});
