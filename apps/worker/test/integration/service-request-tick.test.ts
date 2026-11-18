import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  extra,
  pushSubscription,
  serviceRequest,
  serviceRequestDaily,
  stay,
  type DbHandle,
} from "@guidesk/db";
import type { NotificationPushJob } from "@guidesk/domain";
import type { EmailMessage, PushMessage, PushPort } from "@guidesk/integrations";
import { runNotificationPush } from "../../src/jobs/notification-push.js";
import { runServiceRequestTick } from "../../src/jobs/service-request-tick.js";
import { seed, setSettings, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * Add-on requests in the worker (feature 008 US3, T019): alerts to the escalation contacts once,
 * held during quiet hours, expiry, cancellation when the stay ends, the daily counts, and the push
 * text, which never carries the guest's note. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

/** 23:10 in Costa Rica (UTC-6), inside quiet hours 22:00 to 07:00; noon is outside. */
const lateNight = new Date("2026-11-19T05:10:00Z");
const noon = new Date("2026-11-19T18:00:00Z");
const quiet = { start: "22:00", end: "07:00" };

async function request(
  s: Seeded,
  options: {
    status?: "waiting" | "confirmed";
    expiresAt?: Date;
    stayStatus?: "active" | "cancelled";
    note?: string;
  } = {},
) {
  const db = handle.db;
  const [st] = await db
    .insert(stay)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      source: "manual",
      checkInDate: "2026-11-20",
      checkoutDate: "2026-11-24",
      channel: "Directo",
      status: options.stayStatus ?? "active",
    })
    .returning({ id: stay.id });
  const [ex] = await db
    .insert(extra)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      sourceLanguage: "es",
      name: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
      price: 85,
      currency: "USD",
    })
    .returning({ id: extra.id });
  const [row] = await db
    .insert(serviceRequest)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      stayId: st!.id,
      extraId: ex!.id,
      extraName: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
      sourceLanguage: "es",
      price: 85,
      currency: "USD",
      requestedDate: "2026-11-20",
      requestedTime: "14:30",
      quantity: 2,
      note: options.note ?? null,
      status: options.status ?? "waiting",
      expiresAt: options.expiresAt ?? new Date("2026-11-20T08:30:00Z"),
    })
    .returning();
  return row!;
}

function deps(now: Date) {
  const emails: EmailMessage[] = [];
  const pushes: NotificationPushJob[] = [];
  return {
    emails,
    pushes,
    deps: {
      db: handle.db,
      queueEmail: async (message: EmailMessage) => {
        emails.push(message);
      },
      queuePush: async (job: NotificationPushJob) => {
        pushes.push(job);
      },
      portalUrl: "https://app.example.test",
      now: () => now,
    },
  };
}

const mine = (s: Seeded, emails: EmailMessage[]) =>
  emails.filter((email) => email.to === s.ownerEmail || email.to === s.agentEmail);

describe("alerts for new requests (feature 008 FR-015)", () => {
  it("emails and pushes every contact once, in their language, without the guest's note", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    const r = await request(s, { note: "Llegamos con un perro pequeño" });
    const first = deps(noon);
    await runServiceRequestTick(first.deps);
    const sent = mine(s, first.emails);
    expect(sent.map((email) => email.to).sort()).toEqual([s.agentEmail, s.ownerEmail].sort());
    const spanish = sent.find((email) => email.to === s.ownerEmail)!;
    const english = sent.find((email) => email.to === s.agentEmail)!;
    expect(spanish.subject).toBe("Nueva solicitud en Casa Colibrí: Recogida en el aeropuerto");
    expect(english.subject).toBe("New request at Casa Colibrí: Airport pickup");
    expect(english.text).toContain("Airport pickup × 2, 2026-11-20 14:30.");
    expect(english.text).toContain("https://app.example.test/en/requests");
    for (const email of sent) {
      expect(email.template).toBe("service_request.new");
      expect(email.text).not.toContain("perro");
      expect(email.html).not.toContain("perro");
    }
    const pushes = first.pushes.filter((job) => job.requestId === r.id);
    expect(pushes).toHaveLength(2);
    expect(pushes[0]).toMatchObject({ kind: "service_request", propertyId: s.propertyId });

    const [stored] = await handle.db
      .select({ notifiedAt: serviceRequest.notifiedAt })
      .from(serviceRequest)
      .where(eq(serviceRequest.id, r.id));
    expect(stored!.notifiedAt).toEqual(noon);
    const again = deps(new Date(noon.getTime() + 60_000));
    await runServiceRequestTick(again.deps);
    expect(mine(s, again.emails)).toHaveLength(0);
  });

  it("follows the chosen contacts and says when a request was pre-approved", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(s, "workspace", { contacts: [s.agentMembershipId] });
    await request(s, { status: "confirmed" });
    const run = deps(noon);
    await runServiceRequestTick(run.deps);
    const sent = mine(s, run.emails);
    expect(sent.map((email) => email.to)).toEqual([s.agentEmail]);
    expect(sent[0]!.text).toContain("confirmed automatically");
  });

  it("holds alerts during quiet hours and sends them when the window ends", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(s, "workspace", { quiet });
    const r = await request(s);
    const night = deps(lateNight);
    const report = await runServiceRequestTick(night.deps);
    expect(mine(s, night.emails)).toHaveLength(0);
    expect(report.held).toBeGreaterThanOrEqual(1);
    const morning = deps(new Date("2026-11-19T13:00:30Z"));
    await runServiceRequestTick(morning.deps);
    expect(mine(s, morning.emails)).toHaveLength(2);
    expect(morning.pushes.filter((job) => job.requestId === r.id)).toHaveLength(2);
  });
});

describe("expiry and stays that end (feature 008 FR-018, FR-019)", () => {
  it("expires waiting requests whose time passed and counts them in the property's day", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    const due = await request(s, { expiresAt: new Date("2026-11-19T04:00:00Z") });
    const later = await request(s, { expiresAt: new Date("2026-11-21T04:00:00Z") });
    const confirmed = await request(s, {
      status: "confirmed",
      expiresAt: new Date("2026-11-19T04:00:00Z"),
    });
    await runServiceRequestTick(deps(lateNight).deps);
    const statuses = await handle.db
      .select({ id: serviceRequest.id, status: serviceRequest.status })
      .from(serviceRequest)
      .where(eq(serviceRequest.propertyId, s.propertyId));
    const byId = new Map(statuses.map((row) => [row.id, row.status]));
    expect(byId.get(due.id)).toBe("expired");
    expect(byId.get(later.id)).toBe("waiting");
    expect(byId.get(confirmed.id)).toBe("confirmed");
    const counts = await handle.db
      .select()
      .from(serviceRequestDaily)
      .where(eq(serviceRequestDaily.propertyId, s.propertyId));
    // 23:10 on 18 November in Costa Rica, though it is already the 19th in UTC.
    expect(counts).toEqual([
      expect.objectContaining({ day: "2026-11-18", status: "expired", count: 1 }),
    ]);
  });

  it("cancels waiting requests of a cancelled stay with the stay reason", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    const r = await request(s, { stayStatus: "cancelled" });
    const report = await runServiceRequestTick(deps(noon).deps);
    expect(report.cancelled).toBeGreaterThanOrEqual(1);
    const [row] = await handle.db
      .select({ status: serviceRequest.status, reasonCode: serviceRequest.reasonCode })
      .from(serviceRequest)
      .where(eq(serviceRequest.id, r.id));
    expect(row).toEqual({ status: "cancelled", reasonCode: "stay" });
  });
});

describe("push text (feature 008 research R5)", () => {
  it("names the property and the extra in the member's language and opens Requests", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    const r = await request(s, { note: "Llegamos con un perro pequeño" });
    await handle.db.insert(pushSubscription).values({
      userId: s.agentId,
      endpoint: `https://push.example.test/${r.id}`,
      p256dh: "TEST-0000",
      auth: "TEST-0000",
      device: "Firefox en Linux",
    });
    const sent: PushMessage[] = [];
    const push: PushPort = {
      publicKey: "TEST-0000",
      send: async (_device, message) => {
        sent.push(message);
        return "sent";
      },
    };
    const report = await runNotificationPush(
      { db: handle.db, push, portalUrl: "https://app.example.test" },
      {
        userId: s.agentId,
        kind: "service_request",
        workspaceId: s.workspaceId,
        propertyId: s.propertyId,
        requestId: r.id,
      },
    );
    expect(report.sent).toBe(1);
    expect(sent[0]!.url).toBe("https://app.example.test/en/requests");
    expect(sent[0]!.tag).toBe(`request-${r.id}`);
    expect(JSON.stringify(sent[0])).toContain("Airport pickup");
    expect(JSON.stringify(sent[0])).not.toContain("perro");
  });
});
