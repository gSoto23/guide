import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ExtraInput, GuestServiceRequests, MemberExtra } from "@guidesk/contracts";
import { EXTRA_LIMITS } from "@guidesk/domain";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  crDate,
  exchange,
  guest,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 008 on the API side (T025): AC-SEC-001 (session, property, and window
 * required), AC-SEC-002 (price, currency, and stay never from the body), AC-SEC-003 (notes stored and
 * returned as text), AC-SEC-004 (agents can't change the catalog, logged; other workspaces in
 * cross-tenant.test.ts), AC-SEC-005 (a stay sees only its own requests), and AC-SEC-006 (per-stay
 * limits). Rendering notes as text is covered in the guest app's extras.test.tsx and the portal's React
 * text nodes. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let other: PublishedGuide;
let cookieA = "";
let cookieB = "";
let stayA = "";
let extraId = "";

const free: ExtraInput = {
  sourceLanguage: "es",
  name: { es: "Toallas de playa" },
  description: {},
  price: 5,
  currency: "USD",
  leadTimeHours: 0,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  needsDate: false,
  needsTime: false,
  dateRange: "stay",
  maxPerStay: 10,
  preApproved: false,
  turnover: null,
  visible: true,
};

async function sessionFor(propertyId: string, start: number, nights: number) {
  const stayId = await addStay(ctx, team, propertyId, start, nights);
  const link = await copyStayLink(ctx, team, propertyId, stayId);
  return { stayId, cookie: (await exchange(ctx, link.token)).cookie! };
}

/**
 * Identical requests within a minute are refused as duplicates (FR-024); these checks repeat the same
 * extra on purpose, so earlier rows are aged two minutes before each call.
 */
async function request(cookie: string, payload: object = {}, publicId = published.publicId) {
  await db.query(
    `UPDATE service_request SET created_at = created_at - interval '2 minutes' WHERE workspace_id = $1`,
    [team.workspaceId],
  );
  return guest(ctx, "POST", "/api/v1/guest/extras/requests?lang=es", {
    payload: { publicId, extraId, quantity: 1, ...payload },
    ...(cookie ? { cookie } : {}),
  });
}

const countFor = async (stayId: string) =>
  (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_request WHERE stay_id = $1`,
      [stayId],
    )
  ).rows[0]!.n;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview008");
  published = await publishedGuide(ctx, team);
  other = await publishedGuide(ctx, team, { name: "Casa Vecina" });
  const created = await wsApi(
    ctx,
    team.owner,
    "POST",
    team.workspaceId,
    `/properties/${published.propertyId}/extras`,
    free,
  );
  extraId = (created.json() as MemberExtra).id;
  const a = await sessionFor(published.propertyId, 0, 4);
  stayA = a.stayId;
  cookieA = a.cookie;
  cookieB = (await sessionFor(published.propertyId, 0, 4)).cookie;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("feature 008 security review (API)", () => {
  it("AC-SEC-001: no session, another property's session, or an ended stay can't request or cancel", async () => {
    const before = await countFor(stayA);
    expect((await request("")).statusCode).toBe(401);
    const neighbour = await sessionFor(other.propertyId, 0, 3);
    const foreign = await request(neighbour.cookie);
    expect(foreign.statusCode).toBe(401);
    expect(await countFor(neighbour.stayId)).toBe(0);

    // A session whose stay has since ended (its dates moved into the past).
    const ended = await sessionFor(published.propertyId, 0, 2);
    await db.query(`UPDATE stay SET check_in_date = $2, checkout_date = $3 WHERE id = $1`, [
      ended.stayId,
      crDate(-6),
      crDate(-4),
    ]);
    const late = await request(ended.cookie);
    expect([401, 409]).toContain(late.statusCode);
    expect(await countFor(ended.stayId)).toBe(0);

    const made = await request(cookieA);
    expect(made.statusCode).toBe(201);
    const { id } = made.json() as { id: string };
    for (const cookie of ["", neighbour.cookie]) {
      const cancel = await guest(ctx, "POST", `/api/v1/guest/extras/requests/${id}/cancel`, {
        payload: { publicId: published.publicId },
        ...(cookie ? { cookie } : {}),
      });
      expect(cancel.statusCode).toBe(401);
    }
    expect(await countFor(stayA)).toBe(before + 1);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM service_request WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ status: "waiting" }]);
  });

  it("AC-SEC-002: a body with a price, a currency, or a stay is refused; stored values come from the catalog", async () => {
    const before = await countFor(stayA);
    for (const extra of [
      { price: 0 },
      { currency: "CRC" },
      { stayId: "00000000-0000-4000-8000-000000000000" },
      { status: "confirmed" },
    ]) {
      const refused = await request(cookieA, extra);
      expect(refused.statusCode, JSON.stringify(extra)).toBe(422);
      expect(refused.json()).toMatchObject({ code: "validation_failed" });
    }
    expect(await countFor(stayA)).toBe(before);
    const made = await request(cookieA, { quantity: 2 });
    const { rows } = await db.query<{ price: string; currency: string; stay_id: string }>(
      `SELECT price, currency, stay_id FROM service_request WHERE id = $1`,
      [(made.json() as { id: string }).id],
    );
    expect(rows).toEqual([{ price: "5.00", currency: "USD", stay_id: stayA }]);
  });

  it("AC-SEC-003: notes with markup are stored and returned verbatim as JSON text", async () => {
    const note = '<img src=x onerror="alert(1)"><script>x()</script> https://evil.example';
    const made = await request(cookieA, { note });
    expect(made.statusCode).toBe(201);
    expect(made.headers["content-type"]).toContain("application/json");
    const page = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      "/service-requests?status=waiting",
    );
    expect(page.headers["content-type"]).toContain("application/json");
    const items = (page.json() as { items: { id: string; note: string | null }[] }).items;
    const stored = items.find((item) => item.id === (made.json() as { id: string }).id);
    expect(stored?.note).toBe(note);
  });

  it("AC-SEC-004: an agent can't change the catalog, and the denial is logged", async () => {
    const before = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
      [team.workspaceId],
    );
    const base = `/properties/${published.propertyId}/extras`;
    const attempts = [
      ["POST", base, free],
      ["PUT", `${base}/${extraId}`, { version: 1, extra: { ...free, price: 0 } }],
      ["PUT", `${base}/order`, { ids: [extraId] }],
      ["DELETE", `${base}/${extraId}`, undefined],
      ["POST", `${base}/${extraId}/copy`, { propertyIds: [other.propertyId] }],
    ] as const;
    for (const [method, path, payload] of attempts) {
      const refused = await wsApi(ctx, team.agent, method, team.workspaceId, path, payload);
      expect(refused.statusCode, `${method} ${path}`).toBe(403);
    }
    const after = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
      [team.workspaceId],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n + attempts.length);
    const { rows } = await db.query<{ price: string; version: number }>(
      `SELECT price, version FROM extra WHERE id = $1`,
      [extraId],
    );
    expect(rows).toEqual([{ price: "5.00", version: 1 }]);
    // Agents still read the catalog and answer requests.
    const read = await wsApi(ctx, team.agent, "GET", team.workspaceId, base);
    expect(read.statusCode).toBe(200);
  });

  it("AC-SEC-005: a stay link lists only its own stay's requests", async () => {
    await request(cookieB, { note: "Solo de la estadía B" });
    const listA = (
      await guest(ctx, "GET", `/api/v1/guest/extras/requests?publicId=${published.publicId}`, {
        cookie: cookieA,
      })
    ).json() as GuestServiceRequests;
    const listB = (
      await guest(ctx, "GET", `/api/v1/guest/extras/requests?publicId=${published.publicId}`, {
        cookie: cookieB,
      })
    ).json() as GuestServiceRequests;
    const idsA = new Set(listA.requests.map((item) => item.id));
    expect(listB.requests.length).toBeGreaterThan(0);
    for (const item of listB.requests) expect(idsA.has(item.id)).toBe(false);
    expect(listA.requests.length).toBe(await countFor(stayA));
    expect(JSON.stringify(listA)).not.toContain("Solo de la estadía B");
  });

  it("AC-SEC-006: past the per-stay limit, requests are refused and nothing is stored or alerted", async () => {
    const fresh = await sessionFor(published.propertyId, 1, 3);
    for (let i = 0; i < EXTRA_LIMITS.waitingPerStay; i += 1) {
      const made = await request(fresh.cookie, { note: `Pedido ${i + 1}` });
      expect(made.statusCode, `request ${i + 1}`).toBe(201);
    }
    const refused = await request(fresh.cookie, { note: "Uno de más" });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: "too_many_requests" });
    expect(await countFor(fresh.stayId)).toBe(EXTRA_LIMITS.waitingPerStay);
    // Alerts go out per stored request only (the worker's tick), so a refused one sends none.
    const pending = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_request WHERE stay_id = $1 AND note = 'Uno de más'`,
      [fresh.stayId],
    );
    expect(pending.rows[0]!.n).toBe(0);
  });
});
