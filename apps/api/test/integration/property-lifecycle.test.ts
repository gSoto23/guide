import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  DuplicateDraft,
  PropertyDetail,
  PropertyList,
  PropertyRemoval,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  insertDataKey,
  insertFeed,
  insertPmsConnection,
  insertProperty,
  insertStay,
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * US6: duplicate, remove, and restore (T113; FR-043 to FR-045, AC-SEC-001, AC-SEC-007,
 * AC-SEC-011). The purge after 30 days runs in the worker. All data is fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  // The second-factor threshold (FR-048) is covered elsewhere; a fixed count keeps it out.
  ctx = await createTestApp(inject("databaseUrl"), {}, { propertyCount: 0 });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "lifecycle");
  await setLimit(team.workspaceId, 20);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function setLimit(workspaceId: string, limit: number | null) {
  await db.query(`UPDATE workspace SET property_limit = $2 WHERE id = $1`, [workspaceId, limit]);
}

async function countEvents(type: string, workspaceId = team.workspaceId) {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE type = $1 AND workspace_id = $2`,
    [type, workspaceId],
  );
  return rows[0]!.count;
}

/** A property with everything a duplicate must leave out: feed, stays, a code, and a PMS link. */
async function fullProperty(workspaceId = team.workspaceId) {
  const connectionId = await insertPmsConnection(db, workspaceId);
  const propertyId = await insertProperty(db, workspaceId, {
    name: "Torre Mar 4B",
    source: "pms",
    sourceProvider: "beds24",
    externalId: `listing-${randomBytes(4).toString("hex")}`,
    pmsConnectionId: connectionId,
  });
  await db.query(
    `UPDATE property SET address_unit = '4B', region = 'Guanacaste', postal_code = '50205',
       max_guests = 6, guide_languages = '{en,es}' WHERE id = $1`,
    [propertyId],
  );
  const feedId = await insertFeed(db, workspaceId, propertyId);
  await insertStay(db, workspaceId, propertyId, {
    source: "ical",
    calendarFeedId: feedId,
    checkInDate: day(3),
    checkoutDate: day(6),
  });
  await insertStay(db, workspaceId, propertyId, {
    checkInDate: day(10),
    checkoutDate: day(12),
    guestName: "Ana Prueba",
    guestCount: 2,
  });
  // Past and cancelled stays are not warned about.
  await insertStay(db, workspaceId, propertyId, { checkInDate: day(-9), checkoutDate: day(-6) });
  await insertStay(db, workspaceId, propertyId, {
    checkInDate: day(20),
    checkoutDate: day(22),
    status: "cancelled",
  });
  const keyId = await insertDataKey(db, workspaceId);
  await db.query(
    `INSERT INTO restricted_value (workspace_id, property_id, kind, label, value_ciphertext,
       data_key_id, source, source_field)
     VALUES ($1, $2, 'door_code', 'Beds24 · house_rules', $3, $4, 'pms', 'beds24:texts.houseRules')`,
    [workspaceId, propertyId, randomBytes(48), keyId],
  );
  await db.query(
    `INSERT INTO listing_content (workspace_id, property_id, kind, body, language, source)
     VALUES ($1, $2, 'description', 'Apartamento frente al mar con balcón.', 'es', 'pms'),
            ($1, $2, 'house_rules', 'No fumar adentro.', 'es', 'pms')`,
    [workspaceId, propertyId],
  );
  await db.query(
    `INSERT INTO listing_content (workspace_id, property_id, kind, items, language, source)
     VALUES ($1, $2, 'amenities', '{Wifi,Piscina}', 'es', 'pms')`,
    [workspaceId, propertyId],
  );
  return { propertyId, connectionId };
}

/** The draft's facts with a new address, as the confirmation step sends them. */
function confirmedCopy(draft: DuplicateDraft) {
  return {
    name: draft.name,
    addressLine1: "Calle Ficticia 500",
    city: "Sámara",
    country: draft.country,
    timeZone: draft.timeZone,
    checkInTime: draft.checkInTime,
    checkoutTime: draft.checkoutTime,
    maxGuests: draft.maxGuests,
    guideLanguages: draft.guideLanguages,
    source: "duplicate",
    duplicateOf: draft.duplicateOf,
  };
}

describe("duplicating (FR-043, US6 scenarios 1 and 2)", () => {
  it("drafts the facts without the address, with the content, named “Copia de …”", async () => {
    const { propertyId } = await fullProperty();
    const response = await wsApi(
      ctx,
      team.admin,
      "GET",
      team.workspaceId,
      `/properties/${propertyId}/duplicate-draft?lang=es`,
    );
    expect(response.statusCode, response.body).toBe(200);
    const draft = response.json() as DuplicateDraft;
    expect(draft).toEqual({
      duplicateOf: propertyId,
      sourceName: "Torre Mar 4B",
      name: "Copia de Torre Mar 4B",
      country: READY_FACTS.country,
      timeZone: READY_FACTS.timeZone,
      checkInTime: READY_FACTS.checkInTime,
      checkoutTime: READY_FACTS.checkoutTime,
      maxGuests: 6,
      guideLanguages: ["en", "es"],
      content: [
        {
          kind: "description",
          body: "Apartamento frente al mar con balcón.",
          items: null,
          language: "es",
        },
        { kind: "house_rules", body: "No fumar adentro.", items: null, language: "es" },
        { kind: "amenities", body: null, items: ["Wifi", "Piscina"], language: "es" },
      ],
    });
    // Nothing excluded is even in the response (FR-043).
    expect(response.body).not.toMatch(
      /Calle Ficticia 123|50205|Guanacaste|Ana Prueba|feed|beds24/i,
    );

    const english = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/properties/${propertyId}/duplicate-draft?lang=en`,
    );
    expect((english.json() as DuplicateDraft).name).toBe("Copy of Torre Mar 4B");
  });

  it("creates the copy with source duplicate, its content, and none of the excluded data", async () => {
    const { propertyId } = await fullProperty();
    const draft = (
      await wsApi(
        ctx,
        team.admin,
        "GET",
        team.workspaceId,
        `/properties/${propertyId}/duplicate-draft`,
      )
    ).json() as DuplicateDraft;
    const response = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      "/properties",
      confirmedCopy(draft),
    );
    expect(response.statusCode, response.body).toBe(201);
    const copy = response.json() as PropertyDetail;
    expect(copy).toMatchObject({
      name: "Copia de Torre Mar 4B",
      source: "duplicate",
      sourceProvider: null,
      pmsStatus: null,
      setupStatus: "ready",
      addressLine1: "Calle Ficticia 500",
      addressUnit: null,
      maxGuests: 6,
      counts: { stays: 0, feeds: 0, restrictedValues: 0 },
    });

    const { rows: links } = await db.query(
      `SELECT duplicated_from_id, pms_connection_id, external_id FROM property WHERE id = $1`,
      [copy.id],
    );
    expect(links).toEqual([
      { duplicated_from_id: propertyId, pms_connection_id: null, external_id: null },
    ]);
    const { rows: content } = await db.query(
      `SELECT kind, body, items, source, review_state FROM listing_content
        WHERE property_id = $1 ORDER BY kind`,
      [copy.id],
    );
    expect(content).toEqual([
      {
        kind: "amenities",
        body: null,
        items: ["Wifi", "Piscina"],
        source: "duplicate",
        review_state: "unreviewed",
      },
      {
        kind: "description",
        body: "Apartamento frente al mar con balcón.",
        items: null,
        source: "duplicate",
        review_state: "unreviewed",
      },
      {
        kind: "house_rules",
        body: "No fumar adentro.",
        items: null,
        source: "duplicate",
        review_state: "unreviewed",
      },
    ]);
    for (const table of ["calendar_feed", "stay", "restricted_value"]) {
      const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE property_id = $1`, [copy.id]);
      expect(rows, table).toEqual([]);
    }
  });

  it("refuses a duplicate of a property from another workspace, or a removed one", async () => {
    const other = await seedTeam(ctx, db, "lifecycle-other");
    const foreign = await insertProperty(db, other.workspaceId);
    const removed = await insertProperty(db, team.workspaceId, { status: "removed" });
    for (const id of [foreign, removed]) {
      const draft = await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/properties/${id}/duplicate-draft`,
      );
      expect(draft.statusCode).toBe(404);
      const create = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
        ...READY_FACTS,
        source: "duplicate",
        duplicateOf: id,
      });
      expect(create.statusCode).toBe(404);
    }
  });

  it("counts the copy toward the limit", async () => {
    const small = await seedTeam(ctx, db, "lifecycle-small");
    await setLimit(small.workspaceId, 1);
    const propertyId = await insertProperty(db, small.workspaceId);
    const response = await wsApi(ctx, small.owner, "POST", small.workspaceId, "/properties", {
      ...READY_FACTS,
      name: "Copia",
      source: "duplicate",
      duplicateOf: propertyId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "plan_limit_reached" });
  });
});

describe("removing (FR-044, US6 scenario 3)", () => {
  it("lists the upcoming stays on a dry run, without removing", async () => {
    const { propertyId } = await fullProperty();
    const response = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      `/properties/${propertyId}?dryRun=true`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      removed: false,
      purgeAfter: null,
      upcomingStays: [
        { checkInDate: day(3), checkoutDate: day(6), channel: "Airbnb" },
        { checkInDate: day(10), checkoutDate: day(12), channel: "Direct" },
      ],
    });
    const { rows } = await db.query(`SELECT status FROM property WHERE id = $1`, [propertyId]);
    expect(rows).toEqual([{ status: "active" }]);
  });

  it("needs the typed name, and a recent sign-in (AC-SEC-007)", async () => {
    const propertyId = await insertProperty(db, team.workspaceId, { name: "Casa Garza" });
    const wrong = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      `/properties/${propertyId}`,
      {
        typedName: "Casa Garzas",
      },
    );
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({ code: "confirmation_mismatch" });

    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.admin.userId],
    );
    const stale = await wsApi(
      ctx,
      team.admin,
      "DELETE",
      team.workspaceId,
      `/properties/${propertyId}`,
      {
        typedName: "Casa Garza",
      },
    );
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ code: "step_up_required" });
    // A dry run only reads, so it needs no recent sign-in.
    const dryRun = await wsApi(
      ctx,
      team.admin,
      "DELETE",
      team.workspaceId,
      `/properties/${propertyId}?dryRun=true`,
    );
    expect(dryRun.statusCode).toBe(200);
    await db.query(`UPDATE session_assurance SET strong_auth_at = now() WHERE user_id = $1`, [
      team.admin.userId,
    ]);
    const { rows } = await db.query(`SELECT status FROM property WHERE id = $1`, [propertyId]);
    expect(rows).toEqual([{ status: "active" }]);
  });

  it("removes for 30 days, logs it, and frees the slot (FR-045, US6 scenario 5)", async () => {
    const small = await seedTeam(ctx, db, "lifecycle-remove");
    await setLimit(small.workspaceId, 1);
    const propertyId = await insertProperty(db, small.workspaceId, { name: "Casa Garza" });
    const before = await countEvents("property.removed", small.workspaceId);

    const response = await wsApi(
      ctx,
      small.owner,
      "DELETE",
      small.workspaceId,
      `/properties/${propertyId}`,
      {
        typedName: "  Casa Garza ",
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    const removal = response.json() as PropertyRemoval;
    expect(removal.removed).toBe(true);
    const days = (new Date(removal.purgeAfter!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(await countEvents("property.removed", small.workspaceId)).toBe(before + 1);

    const { rows } = await db.query(
      `SELECT status, removed_by, removed_at IS NOT NULL AS has_removed_at FROM property WHERE id = $1`,
      [propertyId],
    );
    expect(rows).toEqual([
      { status: "removed", removed_by: small.owner.userId, has_removed_at: true },
    ]);
    const limits = await wsApi(ctx, small.owner, "GET", small.workspaceId, "/properties/limits");
    expect(limits.json()).toMatchObject({ limit: 1, used: 0 });

    // The active list leaves it out; the removed list shows it to owners and admins only.
    const active = (
      await wsApi(ctx, small.owner, "GET", small.workspaceId, "/properties")
    ).json() as PropertyList;
    expect(active.items.map((item) => item.id)).not.toContain(propertyId);
    const removedList = (
      await wsApi(ctx, small.admin, "GET", small.workspaceId, "/properties?status=removed")
    ).json() as PropertyList;
    expect(removedList.items).toEqual([
      expect.objectContaining({
        id: propertyId,
        status: "removed",
        purgeAfter: removal.purgeAfter,
      }),
    ]);
    const agentList = await wsApi(
      ctx,
      small.agent,
      "GET",
      small.workspaceId,
      "/properties?status=removed",
    );
    expect(agentList.statusCode).toBe(403);

    const again = await wsApi(
      ctx,
      small.owner,
      "DELETE",
      small.workspaceId,
      `/properties/${propertyId}`,
      {
        typedName: "Casa Garza",
      },
    );
    expect(again.statusCode).toBe(404);
  });

  it("stops the removed property's refreshes and edits (AC-SEC-011)", async () => {
    const { propertyId } = await fullProperty();
    await wsApi(ctx, team.owner, "DELETE", team.workspaceId, `/properties/${propertyId}`, {
      typedName: "Torre Mar 4B",
    });
    const refresh = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${propertyId}/calendar-feeds/refresh`,
    );
    expect(refresh.statusCode).toBe(404);
    const { rows } = await db.query(
      `SELECT 1 FROM pgboss.job j JOIN calendar_feed f ON f.id::text = j.data->>'feedId'
        WHERE j.name = 'calendar.refresh' AND f.property_id = $1`,
      [propertyId],
    );
    expect(rows).toEqual([]);
    const edit = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      `/properties/${propertyId}`,
      {
        name: "Otro nombre",
      },
    );
    expect(edit.statusCode).toBe(404);
  });
});

describe("restoring (FR-045, US6 scenario 4)", () => {
  async function removedProperty(workspaceId: string, daysAgo = 1) {
    const propertyId = await insertProperty(db, workspaceId, { status: "removed" });
    await db.query(
      `UPDATE property SET removed_at = now() - make_interval(days => $2),
         purge_after = now() - make_interval(days => $2) + interval '30 days' WHERE id = $1`,
      [propertyId, daysAgo],
    );
    return propertyId;
  }

  it("restores within 30 days when a slot is free, and logs it", async () => {
    const propertyId = await removedProperty(team.workspaceId);
    const before = await countEvents("property.restored");
    const response = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      `/properties/${propertyId}/restore`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: propertyId, status: "active", purgeAfter: null });
    expect(await countEvents("property.restored")).toBe(before + 1);
    const { rows } = await db.query(
      `SELECT status, removed_at, removed_by, purge_after FROM property WHERE id = $1`,
      [propertyId],
    );
    expect(rows).toEqual([
      { status: "active", removed_at: null, removed_by: null, purge_after: null },
    ]);
  });

  it("needs a free slot", async () => {
    const full = await seedTeam(ctx, db, "lifecycle-full");
    await setLimit(full.workspaceId, 1);
    await insertProperty(db, full.workspaceId);
    const propertyId = await removedProperty(full.workspaceId);
    const response = await wsApi(
      ctx,
      full.owner,
      "POST",
      full.workspaceId,
      `/properties/${propertyId}/restore`,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "plan_limit_reached", limit: 1 });
  });

  it("cannot restore after 30 days, or an active property", async () => {
    const expired = await removedProperty(team.workspaceId, 31);
    const late = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${expired}/restore`,
    );
    expect(late.statusCode).toBe(410);
    const active = await insertProperty(db, team.workspaceId);
    const notRemoved = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${active}/restore`,
    );
    expect(notRemoved.statusCode).toBe(409);
  });
});

describe("roles (AC-SEC-001)", () => {
  it("refuses agents duplicating, removing, and restoring, and logs each refusal", async () => {
    const propertyId = await insertProperty(db, team.workspaceId, { name: "Casa Agente" });
    const removed = await insertProperty(db, team.workspaceId, { status: "removed" });
    const before = await countEvents("access.role_denied");
    const attempts = [
      wsApi(ctx, team.agent, "GET", team.workspaceId, `/properties/${propertyId}/duplicate-draft`),
      wsApi(ctx, team.agent, "POST", team.workspaceId, "/properties", {
        ...READY_FACTS,
        source: "duplicate",
        duplicateOf: propertyId,
      }),
      wsApi(ctx, team.agent, "DELETE", team.workspaceId, `/properties/${propertyId}`, {
        typedName: "Casa Agente",
      }),
      wsApi(ctx, team.agent, "DELETE", team.workspaceId, `/properties/${propertyId}?dryRun=true`),
      wsApi(ctx, team.agent, "POST", team.workspaceId, `/properties/${removed}/restore`),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(403);
    }
    expect(await countEvents("access.role_denied")).toBe(before + attempts.length);
    const { rows } = await db.query(`SELECT status FROM property WHERE id = $1`, [propertyId]);
    expect(rows).toEqual([{ status: "active" }]);
  });
});
