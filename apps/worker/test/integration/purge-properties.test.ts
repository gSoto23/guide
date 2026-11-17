import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  calendarFeed,
  createDb,
  listingContent,
  membership,
  property,
  restrictedValue,
  securityEvent,
  stay,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { LocalKeyManagement } from "@guidesk/integrations";
import { createDataKeyStore, Vault } from "@guidesk/vault";
import { runPropertiesPurge } from "../../src/jobs/purge-properties.js";

/**
 * The daily purge of removed properties (T114, FR-045, data model §6): after `purge_after`, the
 * property goes with its stays, listing content, feeds, and restricted values. All data is
 * fictional.
 */
const vault = new Vault(new LocalKeyManagement(Buffer.alloc(32, 9)));
const DAY = 86_400_000;

let handle: DbHandle;
let workspaceId: string;
let ownerId: string;

beforeAll(() => {
  handle = createDb(inject("databaseUrl"), { max: 3 });
});

afterAll(async () => {
  await handle.pool.end();
});

beforeEach(async () => {
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
});

/** A property with a feed, a stay, content, and a code; removed `removedDaysAgo` days ago. */
async function propertyWithData(removedDaysAgo: number | null): Promise<string> {
  const id = randomUUID();
  const removedAt = removedDaysAgo === null ? null : new Date(Date.now() - removedDaysAgo * DAY);
  await handle.db.insert(property).values({
    id,
    workspaceId,
    name: `Casa ${id.slice(0, 4)}`,
    guideLanguages: ["es"],
    setupStatus: "needs_details",
    missingFacts: ["addressLine1"],
    source: "manual",
    status: removedAt ? "removed" : "active",
    removedAt,
    removedBy: removedAt ? ownerId : null,
    purgeAfter: removedAt ? new Date(removedAt.getTime() + 30 * DAY) : null,
  });
  const keys = createDataKeyStore(handle.db);
  const feedId = randomUUID();
  const link = await vault.encrypt(
    keys,
    { workspaceId, table: "calendar_feed", column: "url_ciphertext", rowId: feedId },
    "https://www.airbnb.com/calendar/ical/1.ics?s=fictional",
  );
  await handle.db.insert(calendarFeed).values({
    id: feedId,
    workspaceId,
    propertyId: id,
    channel: "airbnb",
    urlCiphertext: link.ciphertext,
    urlFingerprint: randomUUID(),
    displayHint: "airbnb.com/…/1.ics",
    dataKeyId: link.dataKeyId,
  });
  await handle.db.insert(stay).values({
    workspaceId,
    propertyId: id,
    source: "ical",
    calendarFeedId: feedId,
    externalUid: `uid-${id}`,
    checkInDate: "2026-12-01",
    checkoutDate: "2026-12-04",
    channel: "Airbnb",
  });
  await handle.db.insert(listingContent).values({
    workspaceId,
    propertyId: id,
    kind: "description",
    body: "Casa frente al mar.",
    source: "listing_text",
  });
  const valueId = randomUUID();
  const code = await vault.encrypt(
    keys,
    { workspaceId, table: "restricted_value", column: "value_ciphertext", rowId: valueId },
    "4821",
  );
  await handle.db.insert(restrictedValue).values({
    id: valueId,
    workspaceId,
    propertyId: id,
    kind: "door_code",
    valueCiphertext: code.ciphertext,
    dataKeyId: code.dataKeyId,
    source: "pms",
    sourceField: "beds24:texts.houseRules",
  });
  return id;
}

async function remaining(ids: string[]) {
  const count = async (
    table: typeof stay | typeof listingContent | typeof calendarFeed | typeof restrictedValue,
  ) =>
    (await handle.db.select({ id: table.id }).from(table).where(inArray(table.propertyId, ids)))
      .length;
  return {
    properties: (
      await handle.db.select({ id: property.id }).from(property).where(inArray(property.id, ids))
    ).length,
    stays: await count(stay),
    content: await count(listingContent),
    feeds: await count(calendarFeed),
    codes: await count(restrictedValue),
  };
}

describe("properties.purge (FR-045)", () => {
  it("deletes a property past purge_after with everything it holds, and logs it", async () => {
    const due = await propertyWithData(31);
    expect(await runPropertiesPurge({ db: handle.db })).toBeGreaterThanOrEqual(1);
    expect(await remaining([due])).toEqual({
      properties: 0,
      stays: 0,
      content: 0,
      feeds: 0,
      codes: 0,
    });
    const events = await handle.db
      .select()
      .from(securityEvent)
      .where(and(eq(securityEvent.type, "property.purged"), eq(securityEvent.targetId, due)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workspaceId,
      targetType: "property",
      outcome: "success",
      actorUserId: null,
    });
  });

  it("keeps removed properties still inside their 30 days, and active ones", async () => {
    const recent = await propertyWithData(29);
    const active = await propertyWithData(null);
    await runPropertiesPurge({ db: handle.db });
    expect(await remaining([recent])).toEqual({
      properties: 1,
      stays: 1,
      content: 1,
      feeds: 1,
      codes: 1,
    });
    expect(await remaining([active])).toEqual({
      properties: 1,
      stays: 1,
      content: 1,
      feeds: 1,
      codes: 1,
    });
  });

  it("uses the clock it is given", async () => {
    const recent = await propertyWithData(29);
    await runPropertiesPurge({ db: handle.db, now: () => new Date(Date.now() + 2 * DAY) });
    expect((await remaining([recent])).properties).toBe(0);
  });
});
