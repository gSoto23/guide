import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  calendarFeed,
  calendarFeedPublic,
  createDb,
  extractionRequest,
  importItem,
  importRun,
  listingContent,
  membership,
  pmsConnection,
  property,
  restrictedValue,
  stay,
  upload,
  user,
  withRlsContext,
  workspace,
  workspaceDataKey,
  type DbHandle,
  type Transaction,
} from "../../src/index.js";

/**
 * RLS on the 11 feature 002 tables (T009, SEC-14, AC-SEC-009). Every request query runs as
 * guidesk_app through withRlsContext; setup runs in the system context (owner connection).
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
  removedPropertyId: string;
  dataKeyId: string;
  feedId: string;
  icalBlockStayId: string;
  icalReservationStayId: string;
  pmsStayId: string;
  manualStayId: string;
  connectionId: string;
  runId: string;
  itemId: string;
  uploadId: string;
  extractionId: string;
  contentId: string;
  restrictedId: string;
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

const facts = {
  addressLine1: "Calle Ficticia 1",
  city: "Sámara",
  country: "CR",
  timeZone: "America/Costa_Rica",
  checkInTime: "15:00",
  checkoutTime: "11:00",
  maxGuests: 4,
  guideLanguages: ["es", "en"] as ("es" | "en")[],
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
      ...facts,
      setupStatus: "ready",
      source: "manual",
      createdBy,
    })
    .returning({ id: property.id });
  const [removed] = await db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa retirada",
      guideLanguages: ["es"],
      setupStatus: "needs_details",
      source: "manual",
      status: "removed",
      removedAt: new Date(),
      purgeAfter: new Date(Date.now() + 30 * 86_400_000),
    })
    .returning({ id: property.id });
  const propertyId = prop!.id;
  const dataKeyId = dataKey!.id;
  const [feed] = await db
    .insert(calendarFeed)
    .values({
      workspaceId,
      propertyId,
      channel: "airbnb",
      urlCiphertext: randomBytes(64),
      urlFingerprint: randomBytes(16).toString("hex"),
      displayHint: "airbnb.com/…/a1b2.ics",
      dataKeyId,
    })
    .returning({ id: calendarFeed.id });
  const [connection] = await db
    .insert(pmsConnection)
    .values({
      workspaceId,
      provider: "beds24",
      externalAccountId: `acct-${randomUUID()}`,
      accountLabel: "Cuenta de prueba",
      credentialCiphertext: randomBytes(64),
      dataKeyId,
    })
    .returning({ id: pmsConnection.id });
  const stays = await db
    .insert(stay)
    .values([
      {
        workspaceId,
        propertyId,
        source: "ical",
        calendarFeedId: feed!.id,
        externalUid: "uid-block",
        checkInDate: "2027-01-10",
        checkoutDate: "2027-01-12",
        channel: "Airbnb",
        mayBeBlock: true,
      },
      {
        workspaceId,
        propertyId,
        source: "ical",
        calendarFeedId: feed!.id,
        externalUid: "uid-reservation",
        checkInDate: "2027-02-10",
        checkoutDate: "2027-02-12",
        channel: "Airbnb",
      },
      {
        workspaceId,
        propertyId,
        source: "pms",
        pmsConnectionId: connection!.id,
        externalUid: "booking-1",
        checkInDate: "2027-03-10",
        checkoutDate: "2027-03-12",
        channel: "Booking.com",
        guestName: "Huésped Ficticio",
        guestCount: 2,
        bookingReference: "REF-1",
      },
      {
        workspaceId,
        propertyId,
        source: "manual",
        checkInDate: "2027-04-10",
        checkoutDate: "2027-04-12",
        channel: "Direct",
        guestName: "Otra Persona",
        createdBy,
      },
    ])
    .returning({ id: stay.id });
  const [run] = await db
    .insert(importRun)
    .values({ workspaceId, kind: "csv", status: "awaiting_confirmation", total: 1 })
    .returning({ id: importRun.id });
  const [item] = await db
    .insert(importItem)
    .values({
      workspaceId,
      importRunId: run!.id,
      rowNumber: 2,
      label: "Fila 2",
      rowValues: { name: "Fila 2" },
      calendarUrlCiphertext: randomBytes(64),
      dataKeyId,
    })
    .returning({ id: importItem.id });
  const uploadId = randomUUID();
  await db.insert(upload).values({
    id: uploadId,
    workspaceId,
    purpose: "screenshot",
    objectKey: `uploads/${workspaceId}/${uploadId}`,
    declaredType: "image/jpeg",
    declaredSize: 1000,
  });
  const [extraction] = await db
    .insert(extractionRequest)
    .values({ workspaceId, status: "succeeded", inputText: "Texto [door code removed]" })
    .returning({ id: extractionRequest.id });
  const [content] = await db
    .insert(listingContent)
    .values({ workspaceId, propertyId, kind: "title", body: "Casa", source: "listing_text" })
    .returning({ id: listingContent.id });
  const [restricted] = await db
    .insert(restrictedValue)
    .values({
      workspaceId,
      propertyId,
      kind: "door_code",
      label: "Beds24 · house_rules",
      valueCiphertext: randomBytes(64),
      dataKeyId,
      source: "pms",
      sourceField: "beds24:houseRules",
    })
    .returning({ id: restrictedValue.id });
  return {
    propertyId,
    removedPropertyId: removed!.id,
    dataKeyId,
    feedId: feed!.id,
    icalBlockStayId: stays[0]!.id,
    icalReservationStayId: stays[1]!.id,
    pmsStayId: stays[2]!.id,
    manualStayId: stays[3]!.id,
    connectionId: connection!.id,
    runId: run!.id,
    itemId: item!.id,
    uploadId,
    extractionId: extraction!.id,
    contentId: content!.id,
    restrictedId: restricted!.id,
  };
}

/** Reads the IDs of every new table visible in the request context, without restricted columns. */
async function visibleIds(tx: Transaction): Promise<Record<string, string[]>> {
  const ids = async (query: Promise<{ id: string }[]>) => (await query).map((row) => row.id);
  return {
    property: await ids(tx.select({ id: property.id }).from(property)),
    listing_content: await ids(tx.select({ id: listingContent.id }).from(listingContent)),
    restricted_value: await ids(tx.select({ id: restrictedValue.id }).from(restrictedValue)),
    workspace_data_key: await ids(tx.select({ id: workspaceDataKey.id }).from(workspaceDataKey)),
    upload: await ids(tx.select({ id: upload.id }).from(upload)),
    extraction_request: await ids(tx.select({ id: extractionRequest.id }).from(extractionRequest)),
    calendar_feed: await ids(tx.select({ id: calendarFeed.id }).from(calendarFeed)),
    stay: await ids(tx.select({ id: stay.id }).from(stay)),
    pms_connection: await ids(tx.select({ id: pmsConnection.id }).from(pmsConnection)),
    import_run: await ids(tx.select({ id: importRun.id }).from(importRun)),
    import_item: await ids(tx.select({ id: importItem.id }).from(importItem)),
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

describe("feature 002 RLS (T009, SEC-14)", () => {
  it("shows a member of workspace A nothing of workspace B, even with B's ID as context", async () => {
    const b = fixtures.B!;
    const bIds = new Set(Object.values(b));
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

  it("gives owners and admins every table of their workspace, agents only what they may read", async () => {
    const a = fixtures.A!;
    const owner = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, visibleIds);
    const admin = await withRlsContext(handle.db, { userId: alba, workspaceId: wsA }, visibleIds);
    const agent = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, visibleIds);
    for (const visible of [owner, admin]) {
      expect(visible.property).toEqual(expect.arrayContaining([a.propertyId, a.removedPropertyId]));
      for (const table of Object.keys(visible)) {
        expect(visible[table]!.length, `${table} for owners and admins`).toBeGreaterThan(0);
      }
    }
    // Agents read active properties, listing content, and stays (FR-046), and nothing else.
    expect(agent.property).toEqual([a.propertyId]);
    expect(agent.listing_content).toEqual([a.contentId]);
    expect(agent.stay).toHaveLength(4);
    for (const table of [
      "restricted_value",
      "workspace_data_key",
      "upload",
      "extraction_request",
      "calendar_feed",
      "pms_connection",
      "import_run",
      "import_item",
    ]) {
      expect(agent[table], `${table} for agents`).toEqual([]);
    }
  });

  it("does not let agents insert or update any of the new tables (AC-SEC-001)", async () => {
    const a = fixtures.A!;
    const asAgent = <T>(fn: (tx: Transaction) => Promise<T>) =>
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, fn);
    const refused = /row-level security|permission denied/;

    await expectDbError(
      asAgent((tx) =>
        tx.insert(property).values({
          workspaceId: wsA,
          name: "Intrusa",
          guideLanguages: ["es"],
          setupStatus: "needs_details",
          source: "manual",
        }),
      ),
      refused,
    );
    await expectDbError(
      asAgent((tx) =>
        tx.insert(stay).values({
          workspaceId: wsA,
          propertyId: a.propertyId,
          source: "manual",
          checkInDate: "2027-05-01",
          checkoutDate: "2027-05-02",
          channel: "Direct",
        }),
      ),
      refused,
    );
    await expectDbError(
      asAgent((tx) =>
        tx.insert(listingContent).values({
          workspaceId: wsA,
          propertyId: a.propertyId,
          kind: "description",
          body: "x",
          source: "listing_text",
        }),
      ),
      refused,
    );
    await expectDbError(
      asAgent((tx) =>
        tx.insert(importRun).values({ workspaceId: wsA, kind: "csv", status: "validating" }),
      ),
      refused,
    );
    await expectDbError(
      asAgent((tx) => tx.insert(extractionRequest).values({ workspaceId: wsA, status: "queued" })),
      refused,
    );
    await expectDbError(
      asAgent((tx) =>
        tx.insert(workspaceDataKey).values({
          workspaceId: wsA,
          wrappedKey: randomBytes(48),
          kmsKeyId: "local",
          status: "retired",
        }),
      ),
      refused,
    );

    const updates = await asAgent(async (tx) => [
      await tx
        .update(property)
        .set({ name: "Cambiada" })
        .where(eq(property.id, a.propertyId))
        .returning({ id: property.id }),
      await tx
        .update(stay)
        .set({ channel: "Otro" })
        .where(eq(stay.id, a.manualStayId))
        .returning({ id: stay.id }),
      await tx
        .update(listingContent)
        .set({ body: "Cambiada" })
        .where(eq(listingContent.id, a.contentId))
        .returning({ id: listingContent.id }),
      await tx
        .update(calendarFeed)
        .set({ channelLabel: null })
        .where(eq(calendarFeed.id, a.feedId))
        .returning({ id: calendarFeed.id }),
      await tx
        .update(pmsConnection)
        .set({ accountLabel: "x" })
        .where(eq(pmsConnection.id, a.connectionId))
        .returning({ id: pmsConnection.id }),
      await tx
        .update(importRun)
        .set({ status: "cancelled" })
        .where(eq(importRun.id, a.runId))
        .returning({ id: importRun.id }),
      await tx
        .update(importItem)
        .set({ selected: false })
        .where(eq(importItem.id, a.itemId))
        .returning({ id: importItem.id }),
      await tx
        .update(upload)
        .set({ status: "rejected" })
        .where(eq(upload.id, a.uploadId))
        .returning({ id: upload.id }),
      await tx
        .update(extractionRequest)
        .set({ status: "failed" })
        .where(eq(extractionRequest.id, a.extractionId))
        .returning({ id: extractionRequest.id }),
    ]);
    for (const updated of updates) expect(updated).toEqual([]);
  });

  it("lets agents read feeds only through calendar_feed_public, which has no link columns (FR-025)", async () => {
    const a = fixtures.A!;
    const rows = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.select().from(calendarFeedPublic),
    );
    expect(rows.map((row) => row.id)).toEqual([a.feedId]);
    expect(Object.keys(rows[0] ?? {})).not.toContain("urlCiphertext");
    const columns = await handle.db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'calendar_feed_public'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain("url_ciphertext");
    expect(names).not.toContain("url_fingerprint");
    expect(names).not.toContain("display_hint");
  });

  it("returns no rows of B through the view, and nothing without a workspace context", async () => {
    const own = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.select({ id: calendarFeedPublic.id }).from(calendarFeedPublic),
    );
    const guessed = await withRlsContext(handle.db, { userId: ana, workspaceId: wsB }, (tx) =>
      tx.select({ id: calendarFeedPublic.id }).from(calendarFeedPublic),
    );
    const noContext = await withRlsContext(handle.db, { userId: ana }, (tx) =>
      tx.select({ id: calendarFeedPublic.id }).from(calendarFeedPublic),
    );
    expect(own.map((row) => row.id)).toEqual([fixtures.A!.feedId]);
    expect(guessed).toEqual([]);
    expect(noContext).toEqual([]);
  });

  it("never lets guidesk_app select a ciphertext column, even as owner (SEC-06)", async () => {
    const asOwner = <T>(fn: (tx: Transaction) => Promise<T>) =>
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, fn);
    await expectDbError(
      asOwner((tx) => tx.select({ value: calendarFeed.urlCiphertext }).from(calendarFeed)),
      /permission denied/,
    );
    await expectDbError(
      asOwner((tx) => tx.select({ value: pmsConnection.credentialCiphertext }).from(pmsConnection)),
      /permission denied/,
    );
    await expectDbError(
      asOwner((tx) => tx.select({ value: restrictedValue.valueCiphertext }).from(restrictedValue)),
      /permission denied/,
    );
    await expectDbError(
      asOwner((tx) => tx.select({ value: importItem.calendarUrlCiphertext }).from(importItem)),
      /permission denied/,
    );
  });

  it("allows only hiding and guest name removal on feed and PMS stays in the request context (FR-053)", async () => {
    const a = fixtures.A!;
    const asAdmin = <T>(fn: (tx: Transaction) => Promise<T>) =>
      withRlsContext(handle.db, { userId: alba, workspaceId: wsA }, fn);

    await asAdmin((tx) =>
      tx.update(stay).set({ status: "hidden" }).where(eq(stay.id, a.icalBlockStayId)),
    );
    await expectDbError(
      asAdmin((tx) =>
        tx.update(stay).set({ status: "hidden" }).where(eq(stay.id, a.icalReservationStayId)),
      ),
      /stay_change_not_allowed/,
    );
    await expectDbError(
      asAdmin((tx) =>
        tx
          .update(stay)
          .set({ checkInDate: "2027-02-09" })
          .where(eq(stay.id, a.icalReservationStayId)),
      ),
      /stay_change_not_allowed/,
    );
    await asAdmin((tx) =>
      tx
        .update(stay)
        .set({ guestName: null, guestNameRemovedAt: new Date() })
        .where(eq(stay.id, a.pmsStayId)),
    );
    await expectDbError(
      asAdmin((tx) => tx.update(stay).set({ guestCount: 9 }).where(eq(stay.id, a.pmsStayId))),
      /stay_change_not_allowed/,
    );
    // Manual stays stay editable (FR-052).
    const edited = await asAdmin((tx) =>
      tx
        .update(stay)
        .set({ checkoutDate: "2027-04-13", guestName: "Nombre Nuevo" })
        .where(eq(stay.id, a.manualStayId))
        .returning({ id: stay.id }),
    );
    expect(edited).toHaveLength(1);
  });

  it("lets the system context used by refreshes update and cancel feed and PMS stays", async () => {
    const a = fixtures.A!;
    const updated = await handle.db
      .update(stay)
      .set({ status: "cancelled", cancelledAt: new Date(), checkInDate: "2027-02-11" })
      .where(eq(stay.id, a.icalReservationStayId))
      .returning({ id: stay.id });
    expect(updated).toHaveLength(1);
    // A removed guest name is never written again, not even by a refresh (FR-053).
    await expectDbError(
      handle.db.update(stay).set({ guestName: "Restaurado" }).where(eq(stay.id, a.pmsStayId)),
      /stay_guest_name_removed/,
    );
  });

  it("refuses a new property in a workspace pending deletion (FR-049)", async () => {
    await expectDbError(
      withRlsContext(handle.db, { userId: cora, workspaceId: wsC }, (tx) =>
        tx.insert(property).values({
          workspaceId: wsC,
          name: "Nueva",
          guideLanguages: ["es"],
          setupStatus: "needs_details",
          source: "manual",
        }),
      ),
      /row-level security/,
    );
  });

  it("allows at most 5 feeds per property (FR-020)", async () => {
    const a = fixtures.A!;
    const insertOther = (label: string) =>
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.insert(calendarFeed).values({
          workspaceId: wsA,
          propertyId: a.propertyId,
          channel: "other",
          channelLabel: label,
          urlCiphertext: randomBytes(64),
          urlFingerprint: randomBytes(16).toString("hex"),
          displayHint: "example.test/…/x.ics",
          dataKeyId: a.dataKeyId,
        }),
      );
    for (const label of ["Uno", "Dos", "Tres", "Cuatro"]) await insertOther(label);
    await expectDbError(insertOther("Cinco"), /feed_limit_reached/);
  });
});
