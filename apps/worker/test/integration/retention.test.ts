import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createDb,
  extractionRequest,
  importItem,
  importRun,
  membership,
  property,
  stay,
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
