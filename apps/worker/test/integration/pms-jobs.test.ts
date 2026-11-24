import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  calendarFeed,
  createDb,
  importItem,
  importRun,
  listingContent,
  membership,
  pmsConnection,
  property,
  restrictedValue,
  securityEvent,
  stay,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  LocalKeyManagement,
  PmsCredentialError,
  type EmailMessage,
  type PmsListing,
  type PmsPort,
  type PmsReservation,
  type PmsReservationQuery,
} from "@guidesk/integrations";
import { createDataKeyStore, Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { createPmsListingsHandler, createPmsRevokeHandler } from "../../src/jobs/pms-calls.js";
import { runPmsImport, type PmsImportDeps } from "../../src/jobs/pms-import.js";
import {
  createPmsScheduler,
  refreshPmsConnection,
  type PmsRefreshDeps,
} from "../../src/jobs/pms-refresh.js";

/**
 * The PMS import and refresh jobs (T086, T087; FR-028 to FR-036, FR-053, AC-SEC-011,
 * AC-SEC-012). A controlled fake port stands in for the provider; the adapters' own parsing is
 * covered by their contract tests. All data is fictional.
 */
const kms = new LocalKeyManagement(Buffer.alloc(32, 7));
const CREDENTIAL = "fake-refresh-token";
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

class FakePms implements PmsPort {
  readonly provider = "beds24" as const;
  calls: string[] = [];
  listings: PmsListing[] = [];
  reservations: PmsReservation[] = [];
  failure: Error | null = null;

  async validateCredential(): Promise<never> {
    throw new Error("not used");
  }
  async listListings(credential: string) {
    this.calls.push(`listings:${credential}`);
    if (this.failure) throw this.failure;
    return this.listings;
  }
  async getListing(_credential: string, externalId: string) {
    return this.listings.find((listing) => listing.externalId === externalId) ?? null;
  }
  async listReservations(_credential: string, query: PmsReservationQuery) {
    this.calls.push(`reservations:${query.modifiedSince ? "changed" : "full"}`);
    if (this.failure) throw this.failure;
    return this.reservations.filter((r) => query.listingExternalIds.includes(r.listingExternalId));
  }
  async revoke() {
    return { providerRevoked: true };
  }
}

function listing(externalId: string, overrides: Partial<PmsListing> = {}): PmsListing {
  return {
    externalId,
    name: "Casa Colibrí",
    facts: {
      addressLine1: "Calle Ficticia 123",
      city: "Sámara",
      region: "Guanacaste",
      postalCode: "50205",
      country: "CR",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
    },
    texts: [
      {
        kind: "title",
        language: "es",
        body: "Casa Colibrí frente al mar",
        sourceField: "beds24:texts.headline",
      },
      {
        kind: "house_rules",
        language: "es",
        body: "No fumar adentro.\nDoor code 4821\nSilencio después de las 10 pm.",
        sourceField: "beds24:texts.houseRules",
      },
    ],
    amenities: ["wifi", "pool"],
    ...overrides,
  };
}

function reservation(
  externalUid: string,
  listingId: string,
  overrides: Partial<PmsReservation> = {},
): PmsReservation {
  return {
    externalUid,
    listingExternalId: listingId,
    status: "active",
    checkInDate: day(5),
    checkoutDate: day(8),
    guestCount: 3,
    guestName: "Ana Prueba",
    bookingReference: externalUid,
    channel: "Airbnb",
    ...overrides,
  };
}

let handle: DbHandle;
let workspaceId: string;
let ownerId: string;
let pms: FakePms;
let emails: EmailMessage[];

beforeAll(() => {
  handle = createDb(inject("databaseUrl"), { max: 3 });
});

afterAll(async () => {
  await handle.pool.end();
});

async function seedWorkspace(propertyLimit: number | null = null) {
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
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId, propertyLimit });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
}

beforeEach(async () => {
  await seedWorkspace(10);
  pms = new FakePms();
  emails = [];
});

/** A connection whose credential is encrypted like the API stores it. */
async function connection(
  status: "active" | "failing" | "disconnected" = "active",
  lastRefreshAt: Date | null = null,
) {
  const id = randomUUID();
  const { ciphertext, dataKeyId } = await new Vault(kms).encrypt(
    createDataKeyStore(handle.db),
    { workspaceId, table: "pms_connection", column: "credential_ciphertext", rowId: id },
    CREDENTIAL,
  );
  await handle.db.insert(pmsConnection).values({
    id,
    workspaceId,
    provider: "beds24",
    externalAccountId: `acct-${id.slice(0, 8)}`,
    accountLabel: "Beds24 1234",
    credentialCiphertext: status === "disconnected" ? null : ciphertext,
    dataKeyId: status === "disconnected" ? null : dataKeyId,
    status,
    lastRefreshAt,
    ...(status === "disconnected" ? { disconnectedAt: new Date() } : {}),
  });
  return id;
}

async function runWith(connectionId: string, externalIds: string[]) {
  const [run] = await handle.db
    .insert(importRun)
    .values({
      workspaceId,
      kind: "pms",
      pmsConnectionId: connectionId,
      status: "running",
      total: externalIds.length,
      startedBy: ownerId,
    })
    .returning({ id: importRun.id });
  await handle.db.insert(importItem).values(
    externalIds.map((externalId) => ({
      workspaceId,
      importRunId: run!.id,
      externalId,
      label: externalId,
    })),
  );
  return run!.id;
}

function importDeps(): PmsImportDeps {
  return {
    db: handle.db,
    decrypter: new VaultDecrypter(kms),
    vault: new Vault(kms),
    adapters: { beds24: pms, hostex: pms as unknown as PmsPort },
    queueEmail: async (message) => void emails.push(message),
    portalUrl: "https://app.example.test",
  };
}

function refreshDeps(now?: () => Date): PmsRefreshDeps {
  return { ...importDeps(), ...(now ? { now } : {}) };
}

async function itemsOf(runId: string) {
  return handle.db
    .select({
      externalId: importItem.externalId,
      outcome: importItem.outcome,
      reason: importItem.reasonCode,
      label: importItem.label,
      propertyId: importItem.propertyId,
    })
    .from(importItem)
    .where(eq(importItem.importRunId, runId))
    .orderBy(importItem.externalId);
}

describe("importing listings (T086, FR-028 to FR-031)", () => {
  it("creates properties with facts, labeled content, encrypted codes, and upcoming stays", async () => {
    const connectionId = await connection();
    pms.listings = [
      listing("101:201"),
      // No country: the time zone cannot be suggested, so it needs details.
      listing("102:301", {
        name: "Hotel Las Olas",
        facts: { ...listing("x").facts, country: null },
      }),
    ];
    pms.reservations = [
      reservation("bk-1", "101:201"),
      reservation("bk-2", "101:201", { status: "cancelled" }),
      reservation("bk-3", "101:201", { checkInDate: day(-10), checkoutDate: day(-7) }),
    ];
    const runId = await runWith(connectionId, ["101:201", "102:301"]);

    expect(await runPmsImport(importDeps(), { importRunId: runId, workspaceId })).toBe("completed");

    const items = await itemsOf(runId);
    expect(items.map((item) => [item.externalId, item.outcome, item.label])).toEqual([
      ["101:201", "created", "Casa Colibrí"],
      ["102:301", "needs_details", "Hotel Las Olas"],
    ]);
    const [colibri] = await handle.db
      .select()
      .from(property)
      .where(eq(property.id, items[0]!.propertyId!));
    expect(colibri).toMatchObject({
      source: "pms",
      sourceProvider: "beds24",
      externalId: "101:201",
      timeZone: "America/Costa_Rica",
      setupStatus: "to_confirm",
      pmsStatus: "linked",
    });

    // Content is labeled with the provider; the code left the content and is stored encrypted.
    const content = await handle.db
      .select({
        kind: listingContent.kind,
        body: listingContent.body,
        items: listingContent.items,
        source: listingContent.source,
      })
      .from(listingContent)
      .where(eq(listingContent.propertyId, colibri!.id));
    expect(content.every((row) => row.source === "pms")).toBe(true);
    const rules = content.find((row) => row.kind === "house_rules");
    expect(rules?.body).toBe("No fumar adentro.\nSilencio después de las 10 pm.");
    expect(JSON.stringify(content)).not.toContain("4821");
    expect(content.find((row) => row.kind === "amenities")?.items).toEqual(["Wi-Fi", "Piscina"]);
    const [code] = await handle.db
      .select()
      .from(restrictedValue)
      .where(eq(restrictedValue.propertyId, colibri!.id));
    expect(code).toMatchObject({
      kind: "door_code",
      source: "pms",
      sourceField: "beds24:texts.houseRules",
    });
    const value = await new VaultDecrypter(kms).decryptText(
      createDataKeyStore(handle.db),
      {
        workspaceId,
        table: "restricted_value",
        column: "value_ciphertext",
        rowId: code!.id,
        dataKeyId: code!.dataKeyId,
      },
      code!.valueCiphertext,
    );
    expect(value).toBe("4821");

    // Only the upcoming active stay, with only the fields Guidesk keeps (AC-SEC-012).
    const stays = await handle.db
      .select({
        uid: stay.externalUid,
        status: stay.status,
        guestName: stay.guestName,
        guestCount: stay.guestCount,
        reference: stay.bookingReference,
        channel: stay.channel,
      })
      .from(stay)
      .where(eq(stay.propertyId, colibri!.id));
    expect(stays).toEqual([
      {
        uid: "bk-1",
        status: "active",
        guestName: "Ana Prueba",
        guestCount: 3,
        reference: "bk-1",
        channel: "Airbnb",
      },
    ]);

    const [run] = await handle.db.select().from(importRun).where(eq(importRun.id, runId));
    expect(run).toMatchObject({
      status: "completed",
      processed: 2,
      created: 1,
      needsDetails: 1,
      failed: 0,
    });
    expect(run!.notifiedAt).not.toBeNull();
    const events = await handle.db
      .select({ type: securityEvent.type, metadata: securityEvent.metadata })
      .from(securityEvent)
      .where(
        and(eq(securityEvent.workspaceId, workspaceId), eq(securityEvent.type, "import.finished")),
      );
    expect(events[0]?.metadata).toMatchObject({
      kind: "pms",
      total: 2,
      created: 1,
      needsDetails: 1,
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.template).toBe("properties.import_finished");
    expect(`${emails[0]!.text}${emails[0]!.html}`).not.toMatch(
      /4821|Ana Prueba|fake-refresh-token/,
    );
  });

  it("skips listings over the plan limit with plan_limit (FR-047)", async () => {
    await seedWorkspace(1);
    const connectionId = await connection();
    pms.listings = [listing("101:201"), listing("102:301", { name: "Hotel Las Olas" })];
    const runId = await runWith(connectionId, ["101:201", "102:301"]);
    await runPmsImport(importDeps(), { importRunId: runId, workspaceId });
    expect((await itemsOf(runId)).map((item) => [item.outcome, item.reason])).toEqual([
      ["created", null],
      ["skipped", "plan_limit"],
    ]);
  });

  it("fails every item with reconnect_pms when the PMS refuses the credential", async () => {
    const connectionId = await connection();
    pms.failure = new PmsCredentialError("beds24");
    const runId = await runWith(connectionId, ["101:201", "102:301"]);
    expect(await runPmsImport(importDeps(), { importRunId: runId, workspaceId })).toBe("failed");
    expect((await itemsOf(runId)).map((item) => [item.outcome, item.reason])).toEqual([
      ["failed", "reconnect_pms"],
      ["failed", "reconnect_pms"],
    ]);
    const [row] = await handle.db
      .select()
      .from(pmsConnection)
      .where(eq(pmsConnection.id, connectionId));
    expect(row).toMatchObject({ status: "failing", lastErrorCode: "invalid_credential" });
  });

  it("re-imports without duplicates and keeps edited facts and reviewed content (FR-033)", async () => {
    const connectionId = await connection();
    pms.listings = [listing("101:201")];
    await runPmsImport(importDeps(), {
      importRunId: await runWith(connectionId, ["101:201"]),
      workspaceId,
    });
    const [first] = await handle.db
      .select()
      .from(property)
      .where(and(eq(property.workspaceId, workspaceId), eq(property.externalId, "101:201")));
    await handle.db
      .update(property)
      .set({ name: "Mi Casa Colibrí", editedFacts: ["name"] })
      .where(eq(property.id, first!.id));
    await handle.db
      .update(listingContent)
      .set({ body: "Texto revisado por la anfitriona.", reviewState: "edited" })
      .where(and(eq(listingContent.propertyId, first!.id), eq(listingContent.kind, "title")));

    pms.listings = [
      listing("101:201", {
        name: "Casa Colibrí (nuevo nombre)",
        facts: { ...listing("x").facts, maxGuests: 6 },
      }),
    ];
    const again = await runWith(connectionId, ["101:201"]);
    await runPmsImport(importDeps(), { importRunId: again, workspaceId });

    const rows = await handle.db
      .select()
      .from(property)
      .where(and(eq(property.workspaceId, workspaceId), eq(property.externalId, "101:201")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Mi Casa Colibrí", maxGuests: 6 });
    const [title] = await handle.db
      .select({ body: listingContent.body })
      .from(listingContent)
      .where(and(eq(listingContent.propertyId, first!.id), eq(listingContent.kind, "title")));
    expect(title!.body).toBe("Texto revisado por la anfitriona.");
    expect((await itemsOf(again))[0]!.outcome).toBe("updated");
    // The code found again in the same field is not stored twice.
    const codes = await handle.db
      .select()
      .from(restrictedValue)
      .where(eq(restrictedValue.propertyId, first!.id));
    expect(codes).toHaveLength(1);
  });

  it("imports the same listing into two workspaces separately", async () => {
    pms.listings = [listing("101:201")];
    const firstWorkspace = workspaceId;
    await runPmsImport(importDeps(), {
      importRunId: await runWith(await connection(), ["101:201"]),
      workspaceId,
    });
    await seedWorkspace(10);
    await runPmsImport(importDeps(), {
      importRunId: await runWith(await connection(), ["101:201"]),
      workspaceId,
    });
    const rows = await handle.db
      .select({ workspaceId: property.workspaceId })
      .from(property)
      .where(
        and(
          inArray(property.workspaceId, [firstWorkspace, workspaceId]),
          eq(property.externalId, "101:201"),
        ),
      );
    expect(rows.map((row) => row.workspaceId).sort()).toEqual([firstWorkspace, workspaceId].sort());
  });
});

describe("refreshing reservations (T087, FR-034, FR-035, FR-053)", () => {
  async function imported(connectionId: string, externalIds = ["101:201"]) {
    pms.listings = externalIds.map((id) => listing(id));
    await runPmsImport(importDeps(), {
      importRunId: await runWith(connectionId, externalIds),
      workspaceId,
    });
    const [row] = await handle.db
      .select()
      .from(property)
      .where(and(eq(property.workspaceId, workspaceId), eq(property.externalId, externalIds[0]!)));
    return row!;
  }

  it("queues connections due every 3 hours and never disconnected ones", async () => {
    const due = await connection("active", new Date(Date.now() - 4 * 3_600_000));
    await connection("active", new Date(Date.now() - 3_600_000));
    await connection("disconnected");
    const sent: string[] = [];
    await createPmsScheduler({
      db: handle.db,
      send: async (_queue, data) => void sent.push((data as { connectionId: string }).connectionId),
    })();
    expect(sent).toContain(due);
    expect(sent).toHaveLength(new Set(sent).size);
    const ours = await handle.db
      .select({ id: pmsConnection.id })
      .from(pmsConnection)
      .where(eq(pmsConnection.workspaceId, workspaceId));
    expect(sent.filter((id) => ours.some((row) => row.id === id))).toEqual([due]);
  });

  it("applies new, changed, and cancelled reservations, and leaves facts, content, and manual stays alone", async () => {
    const connectionId = await connection();
    const prop = await imported(connectionId);
    await handle.db.insert(stay).values({
      workspaceId,
      propertyId: prop.id,
      source: "manual",
      checkInDate: day(30),
      checkoutDate: day(33),
      channel: "Direct",
    });
    pms.reservations = [
      reservation("bk-1", "101:201"),
      reservation("bk-2", "101:201", { checkInDate: day(12), checkoutDate: day(14) }),
    ];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    pms.reservations = [
      reservation("bk-1", "101:201", { checkoutDate: day(9) }),
      reservation("bk-2", "101:201", {
        status: "cancelled",
        checkInDate: day(12),
        checkoutDate: day(14),
      }),
      reservation("bk-4", "101:201", { checkInDate: day(20), checkoutDate: day(22) }),
    ];
    pms.listings = [listing("101:201", { name: "Otro nombre en el PMS" })];
    expect(
      await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true }),
    ).toBe("refreshed");

    const stays = await handle.db
      .select({
        uid: stay.externalUid,
        source: stay.source,
        status: stay.status,
        checkoutDate: stay.checkoutDate,
      })
      .from(stay)
      .where(eq(stay.propertyId, prop.id))
      .orderBy(stay.checkInDate);
    expect(stays).toEqual([
      { uid: "bk-1", source: "pms", status: "active", checkoutDate: day(9) },
      { uid: "bk-2", source: "pms", status: "cancelled", checkoutDate: day(14) },
      { uid: "bk-4", source: "pms", status: "active", checkoutDate: day(22) },
      { uid: null, source: "manual", status: "active", checkoutDate: day(33) },
    ]);
    const [after] = await handle.db.select().from(property).where(eq(property.id, prop.id));
    expect(after!.name).toBe("Casa Colibrí");
    const [conn] = await handle.db
      .select()
      .from(pmsConnection)
      .where(eq(pmsConnection.id, connectionId));
    expect(conn).toMatchObject({ status: "active", lastErrorCode: null });
    expect(conn!.lastRefreshAt).not.toBeNull();
  });

  it("never restores a guest name removed on request, even when the PMS changes it (FR-053)", async () => {
    const connectionId = await connection();
    const prop = await imported(connectionId);
    pms.reservations = [reservation("bk-1", "101:201")];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    await handle.db
      .update(stay)
      .set({ guestName: null, guestNameRemovedAt: new Date() })
      .where(eq(stay.propertyId, prop.id));
    pms.reservations = [
      reservation("bk-1", "101:201", { guestName: "Ana María Prueba", guestCount: 4 }),
    ];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    const [row] = await handle.db.select().from(stay).where(eq(stay.propertyId, prop.id));
    expect(row).toMatchObject({ guestName: null, guestCount: 4 });
  });

  it("keeps the name and number of guests the host typed in Guidesk (feature 018 FR-016)", async () => {
    const connectionId = await connection();
    const prop = await imported(connectionId);
    pms.reservations = [reservation("bk-1", "101:201")];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    const [first] = await handle.db.select().from(stay).where(eq(stay.propertyId, prop.id));
    expect(first?.guestDetailsSource).toBe("pms");
    await handle.db
      .update(stay)
      .set({ guestName: "Ana Corregida", guestCount: 2, guestDetailsSource: "host" })
      .where(eq(stay.propertyId, prop.id));
    pms.reservations = [
      reservation("bk-1", "101:201", { guestName: "Ana María Prueba", guestCount: 4 }),
    ];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    const [row] = await handle.db.select().from(stay).where(eq(stay.propertyId, prop.id));
    expect(row).toMatchObject({
      guestName: "Ana Corregida",
      guestCount: 2,
      guestDetailsSource: "host",
      bookingReference: "bk-1",
    });
  });

  it("marks a matching feed stay as a duplicate of the PMS stay", async () => {
    const connectionId = await connection();
    const prop = await imported(connectionId);
    const feedId = randomUUID();
    await handle.db.insert(calendarFeed).values({
      id: feedId,
      workspaceId,
      propertyId: prop.id,
      channel: "airbnb",
      urlCiphertext: Buffer.from("x"),
      urlFingerprint: randomUUID(),
      displayHint: "…/a.ics",
      dataKeyId: (
        await handle.db
          .select({ id: pmsConnection.dataKeyId })
          .from(pmsConnection)
          .where(eq(pmsConnection.id, connectionId))
      )[0]!.id!,
    });
    const [feedStay] = await handle.db
      .insert(stay)
      .values({
        workspaceId,
        propertyId: prop.id,
        source: "ical",
        calendarFeedId: feedId,
        externalUid: "feed-1",
        checkInDate: day(5),
        checkoutDate: day(8),
        channel: "Airbnb",
      })
      .returning({ id: stay.id });
    pms.reservations = [reservation("bk-1", "101:201")];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    const [pmsStay] = await handle.db
      .select({ id: stay.id })
      .from(stay)
      .where(and(eq(stay.workspaceId, workspaceId), eq(stay.externalUid, "bk-1")));
    const [marked] = await handle.db
      .select({ duplicateOfId: stay.duplicateOfId })
      .from(stay)
      .where(eq(stay.id, feedStay!.id));
    expect(marked!.duplicateOfId).toBe(pmsStay!.id);
  });

  it("flags a listing gone from the PMS and stops refreshing its stays", async () => {
    const connectionId = await connection();
    const prop = await imported(connectionId);
    pms.listings = [];
    pms.calls = [];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    const [row] = await handle.db.select().from(property).where(eq(property.id, prop.id));
    expect(row!.pmsStatus).toBe("not_found");
    expect(pms.calls).toEqual([`listings:${CREDENTIAL}`]);
    pms.calls = [];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    expect(pms.calls).toEqual([]);
  });

  it("reads only changes after the day's first full read", async () => {
    const connectionId = await connection();
    await imported(connectionId);
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId });
    pms.calls = [];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId });
    expect(pms.calls).toEqual(["reservations:changed"]);
  });

  it("emails owners once after 24 hours of failures", async () => {
    const connectionId = await connection();
    await imported(connectionId);
    pms.failure = new Error("down");
    const start = Date.now();
    await refreshPmsConnection(
      refreshDeps(() => new Date(start)),
      { connectionId, workspaceId, full: true },
    );
    expect(emails.filter((email) => email.template === "properties.pms_reconnect")).toHaveLength(0);
    await refreshPmsConnection(
      refreshDeps(() => new Date(start + 25 * 3_600_000)),
      { connectionId, workspaceId, full: true },
    );
    await refreshPmsConnection(
      refreshDeps(() => new Date(start + 28 * 3_600_000)),
      { connectionId, workspaceId, full: true },
    );
    expect(emails.filter((email) => email.template === "properties.pms_reconnect")).toHaveLength(1);
    const [conn] = await handle.db
      .select()
      .from(pmsConnection)
      .where(eq(pmsConnection.id, connectionId));
    expect(conn).toMatchObject({ status: "failing", lastErrorCode: "provider_error" });
  });

  it("makes no request for a disconnected connection or a removed property (AC-SEC-011)", async () => {
    const disconnected = await connection("disconnected");
    pms.calls = [];
    expect(
      await refreshPmsConnection(refreshDeps(), { connectionId: disconnected, workspaceId }),
    ).toBe("skipped");
    const connectionId = await connection();
    const prop = await imported(connectionId);
    await handle.db
      .update(property)
      .set({
        status: "removed",
        removedAt: new Date(),
        purgeAfter: new Date(Date.now() + 30 * 86_400_000),
      })
      .where(eq(property.id, prop.id));
    pms.calls = [];
    await refreshPmsConnection(refreshDeps(), { connectionId, workspaceId, full: true });
    expect(pms.calls).toEqual([]);
  });
});

describe("answering the API's calls (T096)", () => {
  it("returns listing names as an object, which pg-boss stores as the job's output", async () => {
    const connectionId = await connection();
    pms.listings = [listing("101:201")];
    const output = await createPmsListingsHandler(importDeps())([
      { id: "job-1", data: { connectionId, workspaceId } },
    ]);
    expect(output).toEqual({ listings: [{ externalId: "101:201", name: "Casa Colibrí" }] });
  });

  it("revokes through the adapter, and reports false for a disconnected connection", async () => {
    const active = await connection();
    expect(
      await createPmsRevokeHandler(importDeps())([
        { id: "j", data: { connectionId: active, workspaceId } },
      ]),
    ).toEqual({
      providerRevoked: true,
    });
    const gone = await connection("disconnected");
    expect(
      await createPmsRevokeHandler(importDeps())([
        { id: "j", data: { connectionId: gone, workspaceId } },
      ]),
    ).toEqual({
      providerRevoked: false,
    });
  });
});
