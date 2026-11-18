import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  createDb,
  guideSession,
  property,
  stay,
  stayLink,
  user,
  workspace,
  workspaceDataKey,
  type DbHandle,
} from "../../src/index.js";

/**
 * Migration 0034 (feature 010 T003, research R4): the backfill sets each stay's first guide open from
 * the earliest session of any of its stay links, leaves stays without sessions empty, and never
 * overwrites a value already set. Fictional data only.
 */
let handle: DbHandle;
let backfill = "";
const here = path.dirname(fileURLToPath(import.meta.url));

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  const migration = await readFile(path.join(here, "../../migrations/0034_analytics.sql"), "utf8");
  backfill = migration.slice(migration.indexOf('UPDATE "stay"'));
});

afterAll(async () => {
  await handle.pool.end();
});

describe("stay.guide_opened_at backfill (migration 0034)", () => {
  it("takes the earliest session per stay and keeps values already set", async () => {
    const db = handle.db;
    const owner = `owner-${randomUUID()}`;
    const workspaceId = randomUUID();
    await db.insert(user).values({ id: owner, name: "Ana", email: `${owner}@example.com` });
    await db.insert(workspace).values({ id: workspaceId, name: "Hospedajes", createdBy: owner });
    const [prop] = await db
      .insert(property)
      .values({
        workspaceId,
        name: "Casa Colibrí",
        guideLanguages: ["es"],
        setupStatus: "ready",
        source: "manual",
        createdBy: owner,
      })
      .returning({ id: property.id });
    const [key] = await db
      .insert(workspaceDataKey)
      .values({ workspaceId, wrappedKey: randomBytes(60), kmsKeyId: "local" })
      .returning({ id: workspaceDataKey.id });
    const stays = await db
      .insert(stay)
      .values(
        [0, 1, 2].map(() => ({
          workspaceId,
          propertyId: prop!.id,
          source: "manual" as const,
          checkInDate: "2026-11-10",
          checkoutDate: "2026-11-14",
          channel: "Directo",
        })),
      )
      .returning({ id: stay.id });
    const [withSessions, withoutSessions, alreadySet] = stays.map((row) => row.id) as [
      string,
      string,
      string,
    ];
    const kept = new Date("2026-11-09T12:00:00Z");
    await db.update(stay).set({ guideOpenedAt: kept }).where(eq(stay.id, alreadySet));
    // One active link per stay: earlier links are replaced (ended) before a new one.
    const link = async (stayId: string) => {
      await db
        .update(stayLink)
        .set({ status: "replaced", endedAt: new Date() })
        .where(sql`${stayLink.stayId} = ${stayId} AND ${stayLink.status} = 'active'`);
      const id = randomUUID();
      await db.insert(stayLink).values({
        id,
        workspaceId,
        propertyId: prop!.id,
        stayId,
        tokenHash: randomBytes(32).toString("hex"),
        tokenCiphertext: randomBytes(40),
        dataKeyId: key!.id,
      });
      return id;
    };
    const session = (stayLinkId: string, createdAt: Date) =>
      db.insert(guideSession).values({
        workspaceId,
        propertyId: prop!.id,
        stayLinkId,
        cookieHash: randomBytes(32).toString("hex"),
        createdAt,
      });
    const first = await link(withSessions);
    const second = await link(withSessions);
    await session(first, new Date("2026-11-11T15:00:00Z"));
    await session(second, new Date("2026-11-10T20:00:00Z"));
    await session(await link(alreadySet), new Date("2026-11-12T08:00:00Z"));

    await db.execute(sql.raw(backfill));
    await db.execute(sql.raw(backfill));

    const rows = await db
      .select({ id: stay.id, openedAt: stay.guideOpenedAt })
      .from(stay)
      .where(inArray(stay.id, [withSessions, withoutSessions, alreadySet]));
    const byId = new Map(rows.map((row) => [row.id, row.openedAt?.toISOString() ?? null]));
    expect(byId.get(withSessions)).toBe("2026-11-10T20:00:00.000Z");
    expect(byId.get(withoutSessions)).toBeNull();
    expect(byId.get(alreadySet)).toBe(kept.toISOString());
  });
});
