import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  agentTrace,
  assistantInstructionVersion,
  assistantSettings,
  assistantTest,
  chatMessage,
  chatUsageDaily,
  conversation,
  createDb,
  createGuideForProperty,
  extractionRequest,
  guide,
  guideAiRequest,
  guideDocument,
  guideItem,
  guideLink,
  guideSession,
  guideSection,
  guideVersion,
  interviewSession,
  interviewTurn,
  mediaObject,
  importItem,
  importRun,
  membership,
  property,
  stay,
  stayLink,
  upload,
  user,
  workspace,
  workspaceDataKey,
  type DbHandle,
} from "@guidesk/db";
import type { ObjectStoragePort } from "@guidesk/integrations";
import { runRetention } from "../../src/jobs/retention.js";

/**
 * The daily retention job (T121, data model §6). Each rule is checked on both sides of its
 * limit. All data is fictional.
 */
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const dateDaysAgo = (days: number) => daysAgo(days).toISOString().slice(0, 10);

let handle: DbHandle;
let workspaceId: string;
let ownerId: string;
let propertyId: string;
let deletedObjects: string[];

const storage: ObjectStoragePort = {
  createPresignedPost: async () => {
    throw new Error("not used");
  },
  get: async () => null,
  delete: async (key) => void deletedObjects.push(key),
};

beforeAll(() => {
  handle = createDb(inject("databaseUrl"), { max: 3 });
});

afterAll(async () => {
  await handle.pool.end();
});

beforeEach(async () => {
  deletedObjects = [];
  ownerId = `owner-${randomUUID()}`;
  workspaceId = randomUUID();
  await handle.db.insert(user).values({
    id: ownerId,
    name: "Dueña",
    email: `${ownerId}@example.com`,
    preferredLanguage: "es",
  });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  const [created] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa Colibrí",
      guideLanguages: ["es"],
      setupStatus: "needs_details",
      missingFacts: ["addressLine1"],
      source: "manual",
    })
    .returning({ id: property.id });
  propertyId = created!.id;
});

const run = () => runRetention({ db: handle.db, storage });

describe("retention.daily (data model §6)", () => {
  it("clears extraction input 7 days after the request, and keeps newer input", async () => {
    const [old, recent] = await handle.db
      .insert(extractionRequest)
      .values([
        {
          workspaceId,
          status: "failed",
          inputText: "Casa frente al mar",
          recognizedText: "texto de una captura",
          requestedBy: ownerId,
          createdAt: daysAgo(8),
        },
        {
          workspaceId,
          status: "failed",
          inputText: "Cabina en el bosque",
          requestedBy: ownerId,
          createdAt: daysAgo(6),
        },
      ])
      .returning({ id: extractionRequest.id });
    await run();
    const rows = await handle.db
      .select()
      .from(extractionRequest)
      .where(inArray(extractionRequest.id, [old!.id, recent!.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(old!.id)).toMatchObject({ inputText: null, recognizedText: null });
    expect(byId.get(old!.id)!.inputDeletedAt).toBeInstanceOf(Date);
    expect(byId.get(recent!.id)).toMatchObject({
      inputText: "Cabina en el bosque",
      inputDeletedAt: null,
    });
  });

  it("removes guest names 12 months after checkout (OQ-35)", async () => {
    const stays = await handle.db
      .insert(stay)
      .values(
        [
          { checkIn: 373, checkout: 370, name: "Ana Prueba" },
          { checkIn: 303, checkout: 300, name: "Bea Prueba" },
        ].map((item) => ({
          workspaceId,
          propertyId,
          source: "manual" as const,
          checkInDate: dateDaysAgo(item.checkIn),
          checkoutDate: dateDaysAgo(item.checkout),
          channel: "Direct",
          guestName: item.name,
        })),
      )
      .returning({ id: stay.id });
    await run();
    const rows = await handle.db
      .select({ id: stay.id, guestName: stay.guestName, checkoutDate: stay.checkoutDate })
      .from(stay)
      .where(
        inArray(
          stay.id,
          stays.map((row) => row.id),
        ),
      )
      .orderBy(stay.checkoutDate);
    expect(rows.map((row) => row.guestName)).toEqual([null, "Bea Prueba"]);
  });

  it("deletes expired uploads with their objects, and leaves current ones", async () => {
    const expiredKey = `uploads/${workspaceId}/${randomUUID()}`;
    const currentKey = `uploads/${workspaceId}/${randomUUID()}`;
    await handle.db.insert(upload).values([
      {
        workspaceId,
        purpose: "screenshot",
        objectKey: expiredKey,
        declaredType: "image/png",
        declaredSize: 1000,
        createdBy: ownerId,
        expiresAt: daysAgo(1),
      },
      {
        workspaceId,
        purpose: "csv",
        objectKey: currentKey,
        declaredType: "text/csv",
        declaredSize: 1000,
        createdBy: ownerId,
      },
    ]);
    await run();
    expect(deletedObjects).toContain(expiredKey);
    expect(deletedObjects).not.toContain(currentKey);
    const rows = await handle.db
      .select({ key: upload.objectKey, status: upload.status })
      .from(upload)
      .where(inArray(upload.objectKey, [expiredKey, currentKey]));
    expect(new Map(rows.map((row) => [row.key, row.status]))).toEqual(
      new Map([
        [expiredKey, "deleted"],
        [currentKey, "pending"],
      ]),
    );
  });

  it("cancels CSV runs left waiting for 7 days, and clears their calendar links", async () => {
    const [key] = await handle.db
      .insert(workspaceDataKey)
      .values({ workspaceId, wrappedKey: randomBytes(60), kmsKeyId: "local" })
      .returning({ id: workspaceDataKey.id });
    const runs = await handle.db
      .insert(importRun)
      .values([
        { workspaceId, kind: "csv", status: "awaiting_confirmation", createdAt: daysAgo(8) },
        { workspaceId, kind: "csv", status: "validating", createdAt: daysAgo(9) },
        { workspaceId, kind: "csv", status: "awaiting_confirmation", createdAt: daysAgo(2) },
      ])
      .returning({ id: importRun.id });
    for (const runRow of runs) {
      await handle.db.insert(importItem).values({
        workspaceId,
        importRunId: runRow.id,
        rowNumber: 2,
        label: "Casa Prueba",
        rowValues: { name: "Casa Prueba" },
        calendarUrlCiphertext: randomBytes(32),
        dataKeyId: key!.id,
      });
    }
    await run();
    const states = await handle.db
      .select({ id: importRun.id, status: importRun.status })
      .from(importRun)
      .where(
        inArray(
          importRun.id,
          runs.map((row) => row.id),
        ),
      );
    const status = new Map(states.map((row) => [row.id, row.status]));
    expect(runs.map((row) => status.get(row.id))).toEqual([
      "cancelled",
      "cancelled",
      "awaiting_confirmation",
    ]);
    const items = await handle.db
      .select({ runId: importItem.importRunId, link: importItem.calendarUrlCiphertext })
      .from(importItem)
      .where(
        inArray(
          importItem.importRunId,
          runs.map((row) => row.id),
        ),
      );
    const links = new Map(items.map((item) => [item.runId, item.link !== null]));
    expect(runs.map((row) => links.get(row.id))).toEqual([false, false, true]);
  });

  it("clears row values 7 days after a run finishes", async () => {
    const runs = await handle.db
      .insert(importRun)
      .values([
        { workspaceId, kind: "csv", status: "completed", finishedAt: daysAgo(8) },
        { workspaceId, kind: "csv", status: "completed", finishedAt: daysAgo(3) },
      ])
      .returning({ id: importRun.id });
    for (const runRow of runs) {
      await handle.db.insert(importItem).values({
        workspaceId,
        importRunId: runRow.id,
        rowNumber: 2,
        label: "Casa Prueba",
        rowValues: { name: "Casa Prueba", city: "Sámara" },
      });
    }
    await run();
    const items = await handle.db
      .select({ runId: importItem.importRunId, values: importItem.rowValues })
      .from(importItem)
      .where(
        inArray(
          importItem.importRunId,
          runs.map((row) => row.id),
        ),
      );
    const values = new Map(items.map((item) => [item.runId, item.values]));
    expect(values.get(runs[0]!.id)).toBeNull();
    expect(values.get(runs[1]!.id)).toEqual({ name: "Casa Prueba", city: "Sámara" });
  });

  it("is safe to run again", async () => {
    await run();
    const second = await run();
    const [ws] = await handle.db.select().from(workspace).where(eq(workspace.id, workspaceId));
    expect(ws).toBeDefined();
    expect(second.cancelledRuns).toBe(0);
  });
});

describe("retention.daily for the guide builder (feature 003 T120)", () => {
  let guideId: string;
  let deletedPrefixes: string[];
  const media = {
    put: async () => undefined,
    get: async () => null,
    copy: async () => undefined,
    deletePrefix: async (prefix: string) => void deletedPrefixes.push(prefix),
    signedUrl: async () => "",
  };
  const runAll = () => runRetention({ db: handle.db, storage, media });

  beforeEach(async () => {
    deletedPrefixes = [];
    guideId = (
      await createGuideForProperty(handle.db, { workspaceId, propertyId, guideLanguages: ["es"] })
    ).guideId;
  });

  it("clears interview answers and transcripts after 7 days, and keeps newer ones", async () => {
    const [session] = await handle.db
      .insert(interviewSession)
      .values({ workspaceId, guideId, startedBy: ownerId })
      .returning({ id: interviewSession.id });
    const [old, fresh] = await handle.db
      .insert(interviewTurn)
      .values([
        {
          workspaceId,
          sessionId: session!.id,
          topicId: "checkout.steps",
          answerKind: "voice",
          answerText: null,
          transcript: "Dejen las llaves en la mesa.",
          createdAt: daysAgo(8),
        },
        {
          workspaceId,
          sessionId: session!.id,
          topicId: "checkout.time",
          answerKind: "text",
          answerText: "A las once.",
          createdAt: daysAgo(2),
        },
      ])
      .returning({ id: interviewTurn.id });
    expect((await runAll()).interviewContent).toBe(1);
    const rows = await handle.db
      .select()
      .from(interviewTurn)
      .where(inArray(interviewTurn.id, [old!.id, fresh!.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(old!.id)).toMatchObject({ transcript: null, answerText: null });
    expect(byId.get(old!.id)?.contentDeletedAt).not.toBeNull();
    expect(byId.get(fresh!.id)?.answerText).toBe("A las once.");
  });

  it("clears text read from documents after 7 days", async () => {
    const [old, fresh] = await handle.db
      .insert(guideDocument)
      .values([
        {
          workspaceId,
          guideId,
          fileName: "viejo.pdf",
          kind: "pdf",
          status: "done",
          text: "Texto viejo.",
          readAt: daysAgo(9),
        },
        {
          workspaceId,
          guideId,
          fileName: "nuevo.pdf",
          kind: "pdf",
          status: "done",
          text: "Texto nuevo.",
          readAt: daysAgo(1),
        },
      ])
      .returning({ id: guideDocument.id });
    expect((await runAll()).documentText).toBe(1);
    const rows = await handle.db
      .select({ id: guideDocument.id, text: guideDocument.text })
      .from(guideDocument)
      .where(inArray(guideDocument.id, [old!.id, fresh!.id]));
    expect(rows.find((row) => row.id === old!.id)?.text).toBeNull();
    expect(rows.find((row) => row.id === fresh!.id)?.text).toBe("Texto nuevo.");
  });

  it("keeps the latest 20 versions and the one guests read", async () => {
    const snapshot = { schema: 1, languages: ["es"], sections: [] };
    const versions = await handle.db
      .insert(guideVersion)
      .values(
        Array.from({ length: 23 }, (_, index) => ({
          workspaceId,
          guideId,
          number: index + 1,
          cause: "publish" as const,
          snapshot,
          snapshotSchema: 1,
          languages: ["es" as const],
        })),
      )
      .returning({ id: guideVersion.id, number: guideVersion.number });
    // Guests read version 2, which is older than the latest 20.
    await handle.db
      .update(guide)
      .set({ status: "published", publishedVersionId: versions.find((v) => v.number === 2)!.id })
      .where(eq(guide.id, guideId));
    expect((await runAll()).versions).toBe(2);
    const left = await handle.db
      .select({ number: guideVersion.number })
      .from(guideVersion)
      .where(eq(guideVersion.guideId, guideId));
    expect(left.map((row) => row.number).sort((a, b) => a - b)).toEqual([
      2,
      ...Array.from({ length: 20 }, (_, index) => index + 4),
    ]);
  });

  it("deletes media 24 hours after nothing uses it, and keeps media in use", async () => {
    const used = randomUUID();
    const unused = randomUUID();
    const inVersion = randomUUID();
    await handle.db.insert(mediaObject).values(
      [used, unused, inVersion].map((id) => ({
        id,
        workspaceId,
        kind: "image" as const,
        status: "ready" as const,
        objectPrefix: `media/${workspaceId}/${id}/`,
        createdAt: daysAgo(3),
      })),
    );
    const [section] = await handle.db
      .select({ id: guideSection.id })
      .from(guideSection)
      .where(eq(guideSection.guideId, guideId))
      .limit(1);
    await handle.db.insert(guideItem).values({
      workspaceId,
      sectionId: section!.id,
      kind: "image",
      position: 50,
      source: "host",
      reviewedAt: new Date(),
      sourceLanguage: "es",
      mediaId: used,
    });
    await handle.db.insert(guideVersion).values({
      workspaceId,
      guideId,
      number: 1,
      cause: "publish",
      snapshot: {
        schema: 1,
        languages: ["es"],
        sections: [
          {
            id: section!.id,
            kind: "arrival",
            items: [
              {
                id: randomUUID(),
                kind: "image",
                mediaId: inVersion,
                texts: {},
                sourceLanguage: "es",
              },
            ],
          },
        ],
      },
      snapshotSchema: 1,
      languages: ["es"],
    });
    const first = await runAll();
    expect(first.unusedMedia).toBe(1);
    expect(first.deletedMedia).toBe(0);
    // A day later, the unused media goes with its objects.
    await handle.db
      .update(mediaObject)
      .set({ unreferencedSince: daysAgo(2) })
      .where(eq(mediaObject.id, unused));
    const second = await runAll();
    expect(second.deletedMedia).toBe(1);
    expect(deletedPrefixes).toEqual([`media/${workspaceId}/${unused}/`]);
    const left = await handle.db
      .select({ id: mediaObject.id })
      .from(mediaObject)
      .where(eq(mediaObject.workspaceId, workspaceId));
    expect(left.map((row) => row.id).sort()).toEqual([used, inVersion].sort());
  });

  it("deletes AI usage rows after 12 months", async () => {
    await handle.db.insert(guideAiRequest).values([
      {
        workspaceId,
        guideId,
        kind: "translation",
        model: "fake",
        outcome: "ok",
        createdAt: daysAgo(400),
      },
      {
        workspaceId,
        guideId,
        kind: "translation",
        model: "fake",
        outcome: "ok",
        createdAt: daysAgo(30),
      },
    ]);
    expect((await runAll()).aiRequests).toBe(1);
    const left = await handle.db
      .select({ id: guideAiRequest.id })
      .from(guideAiRequest)
      .where(eq(guideAiRequest.workspaceId, workspaceId));
    expect(left).toHaveLength(1);
  });
});

describe("retention.daily for the guest guide (feature 004 T066)", () => {
  let dataKeyId: string;

  beforeEach(async () => {
    const [dataKey] = await handle.db
      .insert(workspaceDataKey)
      .values({ workspaceId, wrappedKey: randomBytes(48), kmsKeyId: "local" })
      .returning({ id: workspaceDataKey.id });
    dataKeyId = dataKey!.id;
  });

  async function stayWithLink(
    checkoutDaysAgo: number,
    link: { status?: "active" | "revoked" | "replaced"; endedDaysAgo?: number } = {},
  ) {
    const [row] = await handle.db
      .insert(stay)
      .values({
        workspaceId,
        propertyId,
        source: "manual",
        checkInDate: dateDaysAgo(checkoutDaysAgo + 3),
        checkoutDate: dateDaysAgo(checkoutDaysAgo),
        channel: "Directo",
      })
      .returning({ id: stay.id });
    const id = randomUUID();
    const status = link.status ?? "active";
    await handle.db.insert(stayLink).values({
      id,
      workspaceId,
      propertyId,
      stayId: row!.id,
      tokenHash: randomBytes(32).toString("hex"),
      tokenCiphertext: randomBytes(40),
      dataKeyId,
      status,
      endedAt: status === "active" ? null : daysAgo(link.endedDaysAgo ?? 0),
    });
    await handle.db.insert(guideSession).values({
      workspaceId,
      propertyId,
      stayLinkId: id,
      cookieHash: randomBytes(32).toString("hex"),
    });
    return id;
  }

  it("deletes stay links and their sessions 30 days after the window or after ending", async () => {
    const old = await stayWithLink(40);
    const recent = await stayWithLink(10);
    const revokedLongAgo = await stayWithLink(-5, { status: "revoked", endedDaysAgo: 31 });
    const revokedRecently = await stayWithLink(-5, { status: "revoked", endedDaysAgo: 3 });
    const counts = await run();
    expect(counts.stayLinks).toBeGreaterThanOrEqual(2);
    const left = await handle.db
      .select({ id: stayLink.id })
      .from(stayLink)
      .where(eq(stayLink.workspaceId, workspaceId));
    expect(left.map((row) => row.id).sort()).toEqual([recent, revokedRecently].sort());
    const sessions = await handle.db
      .select({ id: guideSession.id })
      .from(guideSession)
      .where(inArray(guideSession.stayLinkId, [old, revokedLongAgo]));
    expect(sessions).toHaveLength(0);
  });

  it("deletes replaced property links after 30 days and keeps the active one", async () => {
    const id = () =>
      Array.from(randomBytes(26), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte % 32]).join("");
    await handle.db.insert(guideLink).values([
      { workspaceId, propertyId, publicId: id() },
      { workspaceId, propertyId, publicId: id(), status: "replaced", replacedAt: daysAgo(40) },
      { workspaceId, propertyId, publicId: id(), status: "replaced", replacedAt: daysAgo(5) },
    ]);
    await run();
    const left = await handle.db
      .select({ status: guideLink.status })
      .from(guideLink)
      .where(eq(guideLink.propertyId, propertyId));
    expect(left.map((row) => row.status).sort()).toEqual(["active", "replaced"]);
  });
});

describe("retention.daily for the in-guide chat (feature 005 T045)", () => {
  async function chat(options: { checkoutDaysAgo?: number; lastMessageDaysAgo: number }) {
    let stayId: string | null = null;
    if (options.checkoutDaysAgo !== undefined) {
      const [row] = await handle.db
        .insert(stay)
        .values({
          workspaceId,
          propertyId,
          source: "manual",
          checkInDate: dateDaysAgo(options.checkoutDaysAgo + 3),
          checkoutDate: dateDaysAgo(options.checkoutDaysAgo),
          channel: "Directo",
        })
        .returning({ id: stay.id });
      stayId = row!.id;
    }
    const [conv] = await handle.db
      .insert(conversation)
      .values({
        workspaceId,
        propertyId,
        stayId,
        cookieHash: randomBytes(32).toString("hex"),
        language: "es",
        lastMessageAt: daysAgo(options.lastMessageDaysAgo),
      })
      .returning({ id: conversation.id });
    await handle.db.insert(chatMessage).values({
      workspaceId,
      conversationId: conv!.id,
      seq: 1,
      author: "guest",
      body: "Hola",
    });
    await handle.db.insert(agentTrace).values({
      workspaceId,
      conversationId: conv!.id,
      decision: "greeting",
      autonomy: "draft",
    });
    return conv!.id;
  }

  it("deletes conversations 12 months after checkout, or after the last message without a stay", async () => {
    const pastStay = await chat({ checkoutDaysAgo: 400, lastMessageDaysAgo: 10 });
    const recentStay = await chat({ checkoutDaysAgo: 300, lastMessageDaysAgo: 300 });
    const oldNoStay = await chat({ lastMessageDaysAgo: 380 });
    const recentNoStay = await chat({ lastMessageDaysAgo: 20 });
    await run();
    const left = await handle.db
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.workspaceId, workspaceId));
    expect(left.map((row) => row.id).sort()).toEqual([recentStay, recentNoStay].sort());
    const orphans = await handle.db
      .select({ id: chatMessage.id })
      .from(chatMessage)
      .where(inArray(chatMessage.conversationId, [pastStay, oldNoStay]));
    expect(orphans).toEqual([]);
    const traces = await handle.db
      .select({ id: agentTrace.id })
      .from(agentTrace)
      .where(inArray(agentTrace.conversationId, [pastStay, oldNoStay]));
    expect(traces).toEqual([]);
  });

  it("deletes daily chat usage after 13 months", async () => {
    await handle.db.insert(chatUsageDaily).values([
      { workspaceId, propertyId, day: dateDaysAgo(420), replies: 3 },
      { workspaceId, propertyId, day: dateDaysAgo(30), replies: 5 },
    ]);
    await run();
    const left = await handle.db
      .select({ replies: chatUsageDaily.replies })
      .from(chatUsageDaily)
      .where(eq(chatUsageDaily.propertyId, propertyId));
    expect(left).toEqual([{ replies: 5 }]);
  });
});

describe("retention.daily for agent settings (feature 007 T046)", () => {
  it("deletes tests and their traces after 30 days", async () => {
    const [old, recent] = await handle.db
      .insert(assistantTest)
      .values([
        {
          workspaceId,
          propertyId,
          createdBy: ownerId,
          question: "¿Salida?",
          createdAt: daysAgo(31),
        },
        { workspaceId, propertyId, createdBy: ownerId, question: "¿Wifi?", createdAt: daysAgo(2) },
      ])
      .returning({ id: assistantTest.id });
    await handle.db.insert(agentTrace).values({
      workspaceId,
      assistantTestId: old!.id,
      decision: "answered",
      autonomy: "auto",
    });
    await run();
    const left = await handle.db
      .select({ id: assistantTest.id })
      .from(assistantTest)
      .where(inArray(assistantTest.id, [old!.id, recent!.id]));
    expect(left.map((row) => row.id)).toEqual([recent!.id]);
    const traces = await handle.db
      .select({ id: agentTrace.id })
      .from(agentTrace)
      .where(eq(agentTrace.assistantTestId, old!.id));
    expect(traces).toEqual([]);
  });

  it("keeps current and traced instruction versions, and deletes the rest", async () => {
    const versions = await handle.db
      .insert(assistantInstructionVersion)
      .values([
        { workspaceId, text: "Actual" },
        { workspaceId, text: "Citada por una traza" },
        { workspaceId, text: "Vieja y sin uso" },
      ])
      .returning({ id: assistantInstructionVersion.id });
    const [current, traced, unused] = versions.map((row) => row.id);
    await handle.db
      .insert(assistantSettings)
      .values({ workspaceId, instructionVersionId: current! })
      .onConflictDoUpdate({
        target: [assistantSettings.workspaceId, assistantSettings.propertyId],
        set: { instructionVersionId: current! },
      });
    const [test] = await handle.db
      .insert(assistantTest)
      .values({ workspaceId, propertyId, createdBy: ownerId, question: "Hola" })
      .returning({ id: assistantTest.id });
    await handle.db.insert(agentTrace).values({
      workspaceId,
      assistantTestId: test!.id,
      decision: "greeting",
      autonomy: "draft",
      workspaceInstructionVersionId: traced!,
    });
    await run();
    const left = await handle.db
      .select({ id: assistantInstructionVersion.id })
      .from(assistantInstructionVersion)
      .where(inArray(assistantInstructionVersion.id, [current!, traced!, unused!]));
    expect(left.map((row) => row.id).sort()).toEqual([current!, traced!].sort());
  });
});
