import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  guide,
  guideAiRequest,
  guideDocument,
  guideItem,
  guideItemText,
  guideSection,
  guideSharedLink,
  guideTopicMark,
  guideVersion,
  interviewSession,
  interviewTurn,
  mediaObject,
  membership,
  property,
  restrictedValue,
  restrictedValuePublic,
  sharedBlock,
  user,
  withRlsContext,
  workspace,
  workspaceDataKey,
  type DbHandle,
  type Transaction,
} from "../../src/index.js";

/**
 * RLS on the 13 feature 003 tables and the locked-field changes to `restricted_value` (T007,
 * SEC-14, AC-SEC-011). Every request query runs as guidesk_app through withRlsContext; setup runs
 * in the system context (owner connection).
 */
let handle: DbHandle;

const ana = `ana-${randomUUID()}`; // owner of A
const alba = `alba-${randomUUID()}`; // admin of A
const aldo = `aldo-${randomUUID()}`; // agent of A
const beto = `beto-${randomUUID()}`; // owner of B
const cora = `cora-${randomUUID()}`; // owner of C, pending deletion
const wsA = randomUUID();
const wsB = randomUUID();
const wsC = randomUUID();

interface Fixture {
  propertyId: string;
  guideId: string;
  sectionId: string;
  itemId: string;
  versionId: string;
  blockId: string;
  blockItemId: string;
  mediaId: string;
  documentId: string;
  sessionId: string;
  turnId: string;
  aiRequestId: string;
  lockedFieldId: string;
}

const fixtures: Record<string, Fixture> = {};

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(error, "expected the query to fail").toBeDefined();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
};

/** Seeds one workspace's rows of every new table, in the system context. */
async function seed(workspaceId: string, createdBy: string): Promise<Fixture> {
  const db = handle.db;
  const [dataKey] = await db
    .insert(workspaceDataKey)
    .values({ workspaceId, wrappedKey: randomBytes(48), kmsKeyId: "local" })
    .returning({ id: workspaceDataKey.id });
  const [prop] = await db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa de prueba",
      guideLanguages: ["es", "en"],
      setupStatus: "ready",
      source: "manual",
      createdBy,
    })
    .returning({ id: property.id });
  const propertyId = prop!.id;
  const [g] = await db
    .insert(guide)
    .values({ workspaceId, propertyId })
    .returning({ id: guide.id });
  const guideId = g!.id;
  const [section] = await db
    .insert(guideSection)
    .values({ workspaceId, guideId, kind: "arrival", position: 0 })
    .returning({ id: guideSection.id });
  const [item] = await db
    .insert(guideItem)
    .values({
      workspaceId,
      sectionId: section!.id,
      kind: "text",
      position: 0,
      source: "host",
      reviewedAt: new Date(),
      sourceLanguage: "es",
    })
    .returning({ id: guideItem.id });
  await db.insert(guideItemText).values({
    itemId: item!.id,
    language: "es",
    workspaceId,
    doc,
    textLength: 4,
    origin: "source",
  });
  await db
    .insert(guideTopicMark)
    .values({ guideId, workspaceId, topicId: "parking.where", mark: "not_applicable" });
  const [version] = await db
    .insert(guideVersion)
    .values({
      workspaceId,
      guideId,
      number: 1,
      cause: "publish",
      snapshot: { sections: [] },
      snapshotSchema: 1,
      languages: ["es", "en"],
      publishedBy: createdBy,
    })
    .returning({ id: guideVersion.id });
  const [block] = await db
    .insert(sharedBlock)
    .values({ workspaceId, sectionKind: "checkout", name: "Salida" })
    .returning({ id: sharedBlock.id });
  const [blockItem] = await db
    .insert(guideItem)
    .values({
      workspaceId,
      sharedBlockId: block!.id,
      kind: "text",
      position: 0,
      source: "host",
      reviewedAt: new Date(),
      sourceLanguage: "es",
    })
    .returning({ id: guideItem.id });
  await db
    .insert(guideSharedLink)
    .values({ guideId, sharedBlockId: block!.id, workspaceId, mode: "exclude" });
  const mediaId = randomUUID();
  await db.insert(mediaObject).values({
    id: mediaId,
    workspaceId,
    kind: "image",
    status: "ready",
    objectPrefix: `media/${workspaceId}/${mediaId}/`,
    bytes: 1000,
  });
  const [document] = await db
    .insert(guideDocument)
    .values({ workspaceId, guideId, fileName: "manual.pdf", kind: "pdf" })
    .returning({ id: guideDocument.id });
  const [session] = await db
    .insert(interviewSession)
    .values({ workspaceId, guideId, startedBy: createdBy })
    .returning({ id: interviewSession.id });
  const [turn] = await db
    .insert(interviewTurn)
    .values({ workspaceId, sessionId: session!.id, topicId: "appliances.ac", answerKind: "text" })
    .returning({ id: interviewTurn.id });
  const [ai] = await db
    .insert(guideAiRequest)
    .values({ workspaceId, guideId, kind: "translation", model: "claude-opus-5-5", outcome: "ok" })
    .returning({ id: guideAiRequest.id });
  const [locked] = await db
    .insert(restrictedValue)
    .values({
      workspaceId,
      propertyId,
      kind: "lockbox_code",
      label: "Caja de llaves",
      valueCiphertext: randomBytes(40),
      dataKeyId: dataKey!.id,
      source: "host",
      sectionKind: "arrival",
      valueSetAt: new Date(),
      updatedBy: createdBy,
    })
    .returning({ id: restrictedValue.id });
  return {
    propertyId,
    guideId,
    sectionId: section!.id,
    itemId: item!.id,
    versionId: version!.id,
    blockId: block!.id,
    blockItemId: blockItem!.id,
    mediaId,
    documentId: document!.id,
    sessionId: session!.id,
    turnId: turn!.id,
    aiRequestId: ai!.id,
    lockedFieldId: locked!.id,
  };
}

/** The IDs of every new table a request context can see. */
async function visibleIds(tx: Transaction): Promise<Record<string, string[]>> {
  const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((row) => row.id);
  return {
    guide: await ids(tx.select({ id: guide.id }).from(guide)),
    guide_section: await ids(tx.select({ id: guideSection.id }).from(guideSection)),
    guide_item: await ids(tx.select({ id: guideItem.id }).from(guideItem)),
    guide_item_text: await ids(tx.select({ id: guideItemText.itemId }).from(guideItemText)),
    guide_topic_mark: await ids(tx.select({ id: guideTopicMark.guideId }).from(guideTopicMark)),
    guide_version: await ids(tx.select({ id: guideVersion.id }).from(guideVersion)),
    shared_block: await ids(tx.select({ id: sharedBlock.id }).from(sharedBlock)),
    guide_shared_link: await ids(
      tx.select({ id: guideSharedLink.sharedBlockId }).from(guideSharedLink),
    ),
    media_object: await ids(tx.select({ id: mediaObject.id }).from(mediaObject)),
    guide_document: await ids(tx.select({ id: guideDocument.id }).from(guideDocument)),
    interview_session: await ids(tx.select({ id: interviewSession.id }).from(interviewSession)),
    interview_turn: await ids(tx.select({ id: interviewTurn.id }).from(interviewTurn)),
    guide_ai_request: await ids(tx.select({ id: guideAiRequest.id }).from(guideAiRequest)),
    restricted_value_public: await ids(
      tx.select({ id: restrictedValuePublic.id }).from(restrictedValuePublic),
    ),
  };
}

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  const db = handle.db;
  await db
    .insert(user)
    .values(
      [ana, alba, aldo, beto, cora].map((id) => ({ id, name: id, email: `${id}@example.com` })),
    );
  await db.insert(workspace).values([
    { id: wsA, name: "Espacio A", createdBy: ana },
    { id: wsB, name: "Espacio B", createdBy: beto },
    { id: wsC, name: "Espacio C", createdBy: cora },
  ]);
  await db.insert(membership).values([
    { workspaceId: wsA, userId: ana, role: "owner" },
    { workspaceId: wsA, userId: alba, role: "admin" },
    { workspaceId: wsA, userId: aldo, role: "agent" },
    { workspaceId: wsB, userId: beto, role: "owner" },
    { workspaceId: wsC, userId: cora, role: "owner" },
  ]);
  fixtures.A = await seed(wsA, ana);
  fixtures.B = await seed(wsB, beto);
  fixtures.C = await seed(wsC, cora);
  await db
    .update(workspace)
    .set({
      status: "pending_deletion",
      deletedAt: new Date(),
      purgeAfter: new Date(Date.now() + 30 * 86_400_000),
    })
    .where(eq(workspace.id, wsC));
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 003 RLS (T007, SEC-14)", () => {
  it("shows a member of workspace A nothing of workspace B, even with B's ID as context", async () => {
    const bIds = new Set(Object.values(fixtures.B!));
    for (const context of [
      { userId: ana, workspaceId: wsA },
      { userId: ana, workspaceId: wsB },
      { userId: ana },
    ]) {
      const visible = await withRlsContext(handle.db, context, visibleIds);
      for (const [table, ids] of Object.entries(visible)) {
        expect(
          ids.filter((id) => bIds.has(id)),
          `${table} leaks B rows`,
        ).toEqual([]);
      }
    }
  });

  it("lets every member read guides, and only owners and admins read AI usage", async () => {
    const a = fixtures.A!;
    const owner = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, visibleIds);
    const agent = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, visibleIds);
    expect(owner.guide).toContain(a.guideId);
    expect(owner.guide_ai_request).toContain(a.aiRequestId);
    expect(agent.guide).toContain(a.guideId);
    expect(agent.guide_item).toEqual(expect.arrayContaining([a.itemId, a.blockItemId]));
    expect(agent.guide_version).toContain(a.versionId);
    expect(agent.restricted_value_public).toContain(a.lockedFieldId);
    expect(agent.guide_ai_request).toEqual([]);
  });

  it("refuses every write to agents", async () => {
    const a = fixtures.A!;
    const asAgent = <T>(fn: (tx: Transaction) => Promise<T>) =>
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, fn);
    await expectDbError(
      asAgent((tx) =>
        tx.insert(guideSection).values({
          workspaceId: wsA,
          guideId: a.guideId,
          kind: "custom",
          title: { es: "Piscina" },
          position: 9,
        }),
      ),
      /row-level security/,
    );
    const updated = await asAgent((tx) =>
      tx
        .update(guideItem)
        .set({ position: 5 })
        .where(eq(guideItem.id, a.itemId))
        .returning({ id: guideItem.id }),
    );
    expect(updated).toEqual([]);
    const deleted = await asAgent((tx) =>
      tx
        .delete(guideSection)
        .where(eq(guideSection.id, a.sectionId))
        .returning({ id: guideSection.id }),
    );
    expect(deleted).toEqual([]);
    await expectDbError(
      asAgent((tx) =>
        tx.insert(guideVersion).values({
          workspaceId: wsA,
          guideId: a.guideId,
          number: 99,
          cause: "publish",
          snapshot: {},
          snapshotSchema: 1,
          languages: ["es"],
        }),
      ),
      /row-level security/,
    );
    const lockedChanged = await asAgent((tx) =>
      tx
        .update(restrictedValue)
        .set({ label: "Otra" })
        .where(eq(restrictedValue.id, a.lockedFieldId))
        .returning({ id: restrictedValue.id }),
    );
    expect(lockedChanged).toEqual([]);
  });

  it("lets owners and admins write guides and locked fields", async () => {
    const a = fixtures.A!;
    await withRlsContext(handle.db, { userId: alba, workspaceId: wsA }, async (tx) => {
      const [custom] = await tx
        .insert(guideSection)
        .values({
          workspaceId: wsA,
          guideId: a.guideId,
          kind: "custom",
          title: { es: "Piscina" },
          position: 9,
        })
        .returning({ id: guideSection.id });
      expect(custom?.id).toBeDefined();
      const changed = await tx
        .update(restrictedValue)
        .set({ label: "Caja de la entrada", valueSetAt: new Date() })
        .where(eq(restrictedValue.id, a.lockedFieldId))
        .returning({ id: restrictedValue.id });
      expect(changed).toHaveLength(1);
    });
  });

  it("never lets a request read a locked value or a public Wi-Fi password", async () => {
    for (const userId of [ana, aldo]) {
      await expectDbError(
        withRlsContext(handle.db, { userId, workspaceId: wsA }, (tx) =>
          tx.execute(sql`SELECT value_ciphertext FROM restricted_value`),
        ),
        /permission denied/,
      );
      await expectDbError(
        withRlsContext(handle.db, { userId, workspaceId: wsA }, (tx) =>
          tx.execute(sql`SELECT public_value FROM restricted_value`),
        ),
        /permission denied/,
      );
    }
    const columns = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.execute(sql`SELECT * FROM restricted_value_public LIMIT 1`),
    );
    const names = columns.fields.map((field) => field.name);
    expect(names).not.toContain("value_ciphertext");
    expect(names).not.toContain("public_value");
    expect(names).toContain("is_set");
  });

  it("refuses updates to published versions, even for owners", async () => {
    const a = fixtures.A!;
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.update(guideVersion).set({ number: 7 }).where(eq(guideVersion.id, a.versionId)),
      ),
      /permission denied/,
    );
  });

  it("refuses writes in a workspace pending deletion, even for its owner", async () => {
    const c = fixtures.C!;
    const asOwner = <T>(fn: (tx: Transaction) => Promise<T>) =>
      withRlsContext(handle.db, { userId: cora, workspaceId: wsC }, fn);
    await expectDbError(
      asOwner((tx) =>
        tx.insert(guideSection).values({
          workspaceId: wsC,
          guideId: c.guideId,
          kind: "custom",
          title: { es: "Piscina" },
          position: 9,
        }),
      ),
      /row-level security/,
    );
    const updated = await asOwner((tx) =>
      tx
        .update(guideItem)
        .set({ position: 3 })
        .where(eq(guideItem.id, c.itemId))
        .returning({ id: guideItem.id }),
    );
    expect(updated).toEqual([]);
  });

  it("refuses an item with both or neither owners", async () => {
    const a = fixtures.A!;
    const base = {
      workspaceId: wsA,
      kind: "text" as const,
      position: 1,
      source: "host" as const,
      reviewedAt: new Date(),
      sourceLanguage: "es" as const,
    };
    await expectDbError(
      handle.db
        .insert(guideItem)
        .values({ ...base, sectionId: a.sectionId, sharedBlockId: a.blockId }),
      /guide_item_one_owner/,
    );
    await expectDbError(handle.db.insert(guideItem).values(base), /guide_item_one_owner/);
  });
});
