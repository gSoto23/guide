import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  calendarFeed,
  createDb,
  membership,
  property,
  stay,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { JOB_QUEUES, todayIn } from "@guidesk/domain";
import {
  LocalKeyManagement,
  type EmailMessage,
  type FeedReadResponse,
  type SandboxPort,
} from "@guidesk/integrations";
import { createDataKeyStore, Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import {
  createCalendarScheduler,
  refreshFeed,
  spreadOf,
  type CalendarRefreshDeps,
} from "../../src/jobs/calendar-refresh.js";

/** Calendar refreshes against PostgreSQL (T071, FR-023, FR-024, SC-006, AC-SEC-011). */
let handle: DbHandle;
const kms = new LocalKeyManagement(Buffer.alloc(32, 9));
const FEED_LINK = "https://calendar.example.test/feed.ics?s=secret-token";
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A scripted feed reader that records the links it was asked for. */
function fakeSandbox(responses: FeedReadResponse[]) {
  const reads: string[] = [];
  const sandbox: SandboxPort = {
    readFeed: async (request) => {
      reads.push(request.url);
      return responses.shift() ?? { error: "internal" };
    },
    processFile: async () => ({ error: "internal" }),
  };
  return { sandbox, reads };
}

let ownerEmail: string;
let workspaceId: string;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
});

afterAll(async () => {
  await handle.pool.end();
});

beforeEach(async () => {
  const ownerId = `owner-${randomUUID()}`;
  ownerEmail = `${ownerId}@example.com`;
  workspaceId = randomUUID();
  await handle.db
    .insert(user)
    .values({ id: ownerId, name: "Dueña", email: ownerEmail, preferredLanguage: "es" });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
});

/** A property with one Airbnb feed whose link is encrypted like the API stores it. */
async function feedFixture(
  options: { lastSuccessAt?: Date | null; propertyStatus?: "active" | "removed" } = {},
) {
  const removed = options.propertyStatus === "removed";
  const [prop] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa Colibrí",
      timeZone: "America/Costa_Rica",
      guideLanguages: ["es"],
      setupStatus: "ready",
      source: "manual",
      status: removed ? "removed" : "active",
      removedAt: removed ? new Date() : null,
      purgeAfter: removed ? new Date(Date.now() + 30 * 86_400_000) : null,
    })
    .returning({ id: property.id });
  const feedId = randomUUID();
  const { ciphertext, dataKeyId } = await new Vault(kms).encrypt(
    createDataKeyStore(handle.db),
    { workspaceId, table: "calendar_feed", column: "url_ciphertext", rowId: feedId },
    FEED_LINK,
  );
  await handle.db.insert(calendarFeed).values({
    id: feedId,
    workspaceId,
    propertyId: prop!.id,
    channel: "airbnb",
    urlCiphertext: ciphertext,
    urlFingerprint: randomUUID(),
    displayHint: "calendar.example.test/…/feed.ics",
    dataKeyId,
    lastSuccessAt:
      options.lastSuccessAt === undefined
        ? new Date(Date.now() - 4 * 3_600_000)
        : options.lastSuccessAt,
  });
  return { propertyId: prop!.id, feedId };
}

function deps(sandbox: SandboxPort, emails: EmailMessage[], now?: () => Date): CalendarRefreshDeps {
  return {
    db: handle.db,
    decrypter: new VaultDecrypter(kms),
    sandbox,
    queueEmail: async (message) => void emails.push(message),
    portalUrl: "https://app.example.test",
    ...(now ? { now } : {}),
  };
}

async function staysOf(feedId: string) {
  return handle.db
    .select({
      uid: stay.externalUid,
      status: stay.status,
      checkInDate: stay.checkInDate,
      mayBeBlock: stay.mayBeBlock,
      channel: stay.channel,
    })
    .from(stay)
    .where(eq(stay.calendarFeedId, feedId))
    .orderBy(stay.externalUid);
}

describe("scheduling (FR-023)", () => {
  it("queues feeds whose last success is older than 3 hours, only for active properties", async () => {
    const due = await feedFixture();
    const recent = await feedFixture({ lastSuccessAt: new Date(Date.now() - 3_600_000) });
    const removed = await feedFixture({ propertyStatus: "removed" });
    const sent: { queue: string; data: { feedId: string }; options: Record<string, unknown> }[] =
      [];
    await createCalendarScheduler({
      db: handle.db,
      send: async (queue, data, options) =>
        void sent.push({ queue, data: data as { feedId: string }, options }),
    })();
    const feedIds = sent.map((entry) => entry.data.feedId);
    expect(feedIds).toContain(due.feedId);
    expect(feedIds).not.toContain(recent.feedId);
    expect(feedIds).not.toContain(removed.feedId);
    const entry = sent.find((item) => item.data.feedId === due.feedId)!;
    // One job per feed at a time (stately queue + singleton key), spread over 10 minutes.
    expect(entry).toMatchObject({
      queue: JOB_QUEUES.calendarRefresh,
      options: { singletonKey: `feed:${due.feedId}`, startAfter: spreadOf(due.feedId) },
    });
    expect(spreadOf(due.feedId)).toBeLessThan(600);
  });
});

describe("applying a read (FR-022, FR-023)", () => {
  it("adds new bookings, cancels ones that disappear, keeps hidden stays hidden, and reads the decrypted link", async () => {
    const { feedId } = await feedFixture();
    const { sandbox, reads } = fakeSandbox([
      {
        entries: [
          { uid: "a", start: day(3), end: day(5), kind: "reservation" },
          { uid: "b", start: day(10), end: day(12), kind: "unlabeled" },
          { uid: "c", start: day(20), end: day(22), kind: "reservation" },
        ],
        etag: '"v1"',
        lastModified: null,
      },
      {
        entries: [
          { uid: "b", start: day(10), end: day(12), kind: "unlabeled" },
          { uid: "c", start: day(21), end: day(23), kind: "reservation" },
          { uid: "d", start: day(30), end: day(31), kind: "reservation" },
        ],
        etag: '"v2"',
        lastModified: null,
      },
    ]);
    const emails: EmailMessage[] = [];
    expect(await refreshFeed(deps(sandbox, emails), { feedId, workspaceId })).toBe("refreshed");
    expect(reads).toEqual([FEED_LINK]);
    await handle.db.update(stay).set({ status: "hidden" }).where(eq(stay.externalUid, "b"));

    expect(await refreshFeed(deps(sandbox, emails), { feedId, workspaceId })).toBe("refreshed");
    expect(await staysOf(feedId)).toEqual([
      { uid: "a", status: "cancelled", checkInDate: day(3), mayBeBlock: false, channel: "Airbnb" },
      { uid: "b", status: "hidden", checkInDate: day(10), mayBeBlock: true, channel: "Airbnb" },
      { uid: "c", status: "active", checkInDate: day(21), mayBeBlock: false, channel: "Airbnb" },
      { uid: "d", status: "active", checkInDate: day(30), mayBeBlock: false, channel: "Airbnb" },
    ]);
    const [feed] = await handle.db
      .select({ etag: calendarFeed.etag, status: calendarFeed.status })
      .from(calendarFeed)
      .where(eq(calendarFeed.id, feedId));
    expect(feed).toEqual({ etag: '"v2"', status: "active" });
  });

  it("keeps the stays on a 304", async () => {
    const { feedId } = await feedFixture();
    const { sandbox } = fakeSandbox([
      {
        entries: [{ uid: "a", start: day(3), end: day(5), kind: "reservation" }],
        etag: '"v1"',
        lastModified: null,
      },
      { notModified: true, etag: '"v1"', lastModified: null },
    ]);
    await refreshFeed(deps(sandbox, []), { feedId, workspaceId });
    expect(await refreshFeed(deps(sandbox, []), { feedId, workspaceId })).toBe("not_modified");
    expect((await staysOf(feedId)).map((s) => [s.uid, s.status])).toEqual([["a", "active"]]);
  });

  it("never touches manual stays", async () => {
    const { feedId, propertyId } = await feedFixture();
    const [manual] = await handle.db
      .insert(stay)
      .values({
        workspaceId,
        propertyId,
        source: "manual",
        checkInDate: day(3),
        checkoutDate: day(5),
        channel: "Direct",
        guestName: "Persona Ficticia",
      })
      .returning({ id: stay.id });
    const { sandbox } = fakeSandbox([{ entries: [], etag: null, lastModified: null }]);
    await refreshFeed(deps(sandbox, []), { feedId, workspaceId });
    const [row] = await handle.db
      .select({ status: stay.status, guestName: stay.guestName })
      .from(stay)
      .where(eq(stay.id, manual!.id));
    expect(row).toEqual({ status: "active", guestName: "Persona Ficticia" });
  });
});

describe("failures (FR-024)", () => {
  it("keeps the stays, marks the feed failing, and emails owners and admins once after 24 hours", async () => {
    const { feedId } = await feedFixture();
    const start = Date.now();
    const { sandbox } = fakeSandbox([
      {
        entries: [{ uid: "a", start: day(3), end: day(5), kind: "reservation" }],
        etag: null,
        lastModified: null,
      },
      { error: "timeout" },
      { error: "timeout" },
      { error: "http_404" },
    ]);
    const emails: EmailMessage[] = [];
    await refreshFeed(
      deps(sandbox, emails, () => new Date(start)),
      { feedId, workspaceId },
    );
    expect(
      await refreshFeed(
        deps(sandbox, emails, () => new Date(start + 3_600_000)),
        { feedId, workspaceId },
      ),
    ).toBe("failed");
    const [failing] = await handle.db
      .select()
      .from(calendarFeed)
      .where(eq(calendarFeed.id, feedId));
    expect(failing).toMatchObject({ status: "failing", lastErrorCode: "timeout", alertedAt: null });
    expect(failing!.failingSince).not.toBeNull();
    expect((await staysOf(feedId)).map((s) => s.status)).toEqual(["active"]);
    expect(emails).toEqual([]);

    await refreshFeed(
      deps(sandbox, emails, () => new Date(start + 26 * 3_600_000)),
      { feedId, workspaceId },
    );
    await refreshFeed(
      deps(sandbox, emails, () => new Date(start + 27 * 3_600_000)),
      { feedId, workspaceId },
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: ownerEmail, template: "properties.feed_failing" });
    expect(emails[0]!.subject).toContain("Casa Colibrí");
    expect(emails[0]!.text).not.toContain("secret-token");
    const [alerted] = await handle.db
      .select({ alertedAt: calendarFeed.alertedAt, lastErrorCode: calendarFeed.lastErrorCode })
      .from(calendarFeed)
      .where(eq(calendarFeed.id, feedId));
    expect(alerted!.alertedAt).not.toBeNull();
    expect(alerted!.lastErrorCode).toBe("http_404");
  });
});

describe("no request for removed properties (AC-SEC-011)", () => {
  it("skips a feed whose property was removed, without reading it", async () => {
    const { feedId } = await feedFixture({ propertyStatus: "removed" });
    const { sandbox, reads } = fakeSandbox([{ entries: [], etag: null, lastModified: null }]);
    expect(await refreshFeed(deps(sandbox, []), { feedId, workspaceId })).toBe("skipped");
    expect(reads).toEqual([]);
  });

  it("uses the property's time zone for what is past", () => {
    expect(todayIn("America/Costa_Rica", new Date("2027-01-10T03:00:00Z"))).toBe("2027-01-09");
  });
});
