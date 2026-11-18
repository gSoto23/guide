import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { withRlsContext, type DbHandle } from "@guidesk/db";
import { REQUEST_DB_HANDLE } from "../../src/database/database.module.js";
import { systemQuery, uniqueEmail } from "./helpers.js";
import { api, invitationsUrl, newOwner } from "./invitation-helpers.js";
import { insertFeed, insertPmsConnection, insertProperty, insertStay } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Every workspace endpoint answers 404 for another workspace's IDs, without confirming that they
 * exist, and logs the attempt (T080, AC-SEC-004, FR-017).
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let alice: Awaited<ReturnType<typeof newOwner>>;
let bruno: Awaited<ReturnType<typeof newOwner>>;
let brunoInvitationId: string;
const MISSING = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), { PMS_BEDS24: "true", PMS_HOSTEX: "true" });
  db = systemQuery(inject("databaseUrl"));
  alice = await newOwner(ctx, "tenant-a");
  bruno = await newOwner(ctx, "tenant-b");
  const created = await api(ctx, "POST", invitationsUrl(bruno.workspaceId), bruno.cookie, {
    email: uniqueEmail("tenant-b-invitee"),
    role: "agent",
  });
  brunoInvitationId = (created.json() as { id: string }).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

async function deniedCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM security_event e JOIN "user" u ON u.id = e.actor_user_id
     WHERE u.email = $1 AND e.type = 'access.cross_workspace_denied'`,
    [alice.email],
  );
  return rows[0]?.n ?? 0;
}

describe("cross-workspace access (T080, AC-SEC-004)", () => {
  const foreignWorkspaceCalls = () =>
    [
      ["GET", `/api/v1/workspaces/${bruno.workspaceId}`, undefined],
      ["PATCH", `/api/v1/workspaces/${bruno.workspaceId}`, { name: "Taken over" }],
      ["GET", `/api/v1/workspaces/${bruno.workspaceId}/members`, undefined],
      ["GET", invitationsUrl(bruno.workspaceId), undefined],
      ["POST", invitationsUrl(bruno.workspaceId), { email: uniqueEmail("x"), role: "agent" }],
      ["POST", `${invitationsUrl(bruno.workspaceId)}/${brunoInvitationId}/resend`, undefined],
      ["DELETE", `${invitationsUrl(bruno.workspaceId)}/${brunoInvitationId}`, undefined],
      ["PUT", "/api/v1/me/current-workspace", { workspaceId: bruno.workspaceId }],
      ["PATCH", `/api/v1/workspaces/${bruno.workspaceId}/members/${MISSING}`, { role: "admin" }],
      ["DELETE", `/api/v1/workspaces/${bruno.workspaceId}/members/${MISSING}`, undefined],
      ["POST", `/api/v1/workspaces/${bruno.workspaceId}/leave`, undefined],
      [
        "POST",
        `/api/v1/workspaces/${bruno.workspaceId}/ownership-transfer`,
        { membershipId: MISSING },
      ],
      ["DELETE", `/api/v1/workspaces/${bruno.workspaceId}`, { confirmName: "x" }],
      ["POST", `/api/v1/workspaces/${bruno.workspaceId}/restore`, undefined],
      ["GET", `/api/v1/workspaces/${bruno.workspaceId}/security-events`, undefined],
    ] as const;

  it("answers 404 on every endpoint of another workspace and logs each attempt", async () => {
    for (const [method, url, payload] of foreignWorkspaceCalls()) {
      const before = await deniedCount();
      const response = await ctx.fastify.inject({
        method,
        url,
        headers: {
          origin: "http://localhost:3000",
          cookie: alice.cookie,
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json(), `${method} ${url}`).toMatchObject({ code: "not_found" });
      expect(await deniedCount(), `${method} ${url} logged`).toBe(before + 1);
    }
    // Nothing changed in Bruno's workspace.
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM workspace WHERE id = $1`, [
      bruno.workspaceId,
    ]);
    expect(rows[0]?.name).not.toBe("Taken over");
    const invitation = await db.query<{ status: string }>(
      `SELECT status FROM invitation WHERE id = $1`,
      [brunoInvitationId],
    );
    expect(invitation.rows[0]?.status).toBe("pending");
  });

  it("answers 404 for another workspace's invitation ID under the caller's own workspace, and logs it", async () => {
    for (const [method, suffix] of [
      ["POST", `${brunoInvitationId}/resend`],
      ["DELETE", brunoInvitationId],
    ] as const) {
      const before = await deniedCount();
      const response = await api(
        ctx,
        method,
        `${invitationsUrl(alice.workspaceId)}/${suffix}`,
        alice.cookie,
      );
      expect(response.statusCode).toBe(404);
      expect(await deniedCount()).toBe(before + 1);
    }
  });

  it("gives the same answer for a missing ID as for a foreign one", async () => {
    const foreign = await api(
      ctx,
      "DELETE",
      `${invitationsUrl(alice.workspaceId)}/${brunoInvitationId}`,
      alice.cookie,
    );
    const missing = await api(
      ctx,
      "DELETE",
      `${invitationsUrl(alice.workspaceId)}/${MISSING}`,
      alice.cookie,
    );
    expect(missing.statusCode).toBe(foreign.statusCode);
    expect(missing.json()).toEqual(foreign.json());
    const unknownWorkspace = await api(ctx, "GET", `/api/v1/workspaces/${MISSING}`, alice.cookie);
    const foreignWorkspace = await api(
      ctx,
      "GET",
      `/api/v1/workspaces/${bruno.workspaceId}`,
      alice.cookie,
    );
    expect(unknownWorkspace.json()).toEqual(foreignWorkspace.json());
  });
});

/**
 * Feature 002 routes (T123, AC-SEC-009): a property, feed, stay, PMS connection, import run, or
 * extraction of another workspace gets the same `404` as one that does not exist, under either
 * workspace's path, and the attempt is logged.
 */
describe("feature 002 resources across workspaces (T123, AC-SEC-009)", () => {
  let ids: {
    property: string;
    feed: string;
    stay: string;
    connection: string;
    run: string;
    extraction: string;
  };

  beforeAll(async () => {
    const property = await insertProperty(db, bruno.workspaceId, { name: "Casa de Bruno" });
    const feed = await insertFeed(db, bruno.workspaceId, property);
    const stay = await insertStay(db, bruno.workspaceId, property, {
      checkInDate: "2026-12-10",
      checkoutDate: "2026-12-12",
      guestName: "Huésped de Bruno",
    });
    const connection = await insertPmsConnection(db, bruno.workspaceId);
    const { rows: runs } = await db.query<{ id: string }>(
      `INSERT INTO import_run (workspace_id, kind, status) VALUES ($1, 'csv', 'awaiting_confirmation')
       RETURNING id`,
      [bruno.workspaceId],
    );
    const { rows: extractions } = await db.query<{ id: string }>(
      `INSERT INTO extraction_request (workspace_id, status, error_code) VALUES ($1, 'failed', 'timeout')
       RETURNING id`,
      [bruno.workspaceId],
    );
    ids = { property, feed, stay, connection, run: runs[0]!.id, extraction: extractions[0]!.id };
  });

  /** Every new route that names a resource, as [method, path, body] under workspace `ws`. */
  const routes = (ws: string) => {
    const w = `/api/v1/workspaces/${ws}`;
    const { property: p, feed: f, stay: s, connection: c, run: r, extraction: e } = ids;
    return [
      ["GET", `${w}/properties/${p}`, undefined],
      ["PATCH", `${w}/properties/${p}`, { name: "Tomada" }],
      ["GET", `${w}/properties/${p}/duplicate-draft`, undefined],
      ["DELETE", `${w}/properties/${p}?dryRun=true`, undefined],
      ["POST", `${w}/properties/${p}/restore`, undefined],
      ["GET", `${w}/properties/${p}/restricted-values`, undefined],
      ["GET", `${w}/properties/${p}/listing-content`, undefined],
      ["GET", `${w}/properties/${p}/calendar-feeds`, undefined],
      ["POST", `${w}/properties/${p}/calendar-feeds/refresh`, undefined],
      ["GET", `${w}/properties/${p}/stays`, undefined],
      ["PATCH", `${w}/calendar-feeds/${f}`, { channelLabel: "Tomado" }],
      ["DELETE", `${w}/calendar-feeds/${f}`, undefined],
      ["PATCH", `${w}/stays/${s}`, { status: "hidden" }],
      ["POST", `${w}/stays/${s}/cancel`, undefined],
      ["POST", `${w}/stays/${s}/remove-guest-name`, undefined],
      ["GET", `${w}/pms-connections/${c}/listings`, undefined],
      ["POST", `${w}/pms-connections/${c}/imports`, { externalIds: ["1"] }],
      ["POST", `${w}/pms-connections/${c}/refresh`, undefined],
      ["GET", `${w}/imports/${r}`, undefined],
      ["GET", `${w}/imports/${r}/items`, undefined],
      ["POST", `${w}/imports/${r}/validate`, undefined],
      ["POST", `${w}/imports/${r}/confirm`, {}],
      ["POST", `${w}/imports/${r}/cancel`, undefined],
      ["GET", `${w}/imports/${r}/error-file`, undefined],
      ["GET", `${w}/extractions/${e}`, undefined],
      ["POST", `${w}/extractions/${e}/retry`, undefined],
    ] as const;
  };

  function call(method: string, url: string, payload: object | undefined) {
    return ctx.fastify.inject({
      method: method as "GET",
      url,
      headers: {
        origin: "http://localhost:3000",
        cookie: alice.cookie,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  }

  it("answers 404 under the other workspace's path, and logs each attempt", async () => {
    for (const [method, url, payload] of routes(bruno.workspaceId)) {
      const before = await deniedCount();
      const response = await call(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json(), `${method} ${url}`).toMatchObject({ code: "not_found" });
      expect(await deniedCount(), `${method} ${url} logged`).toBe(before + 1);
    }
  });

  it("answers the same 404 for another workspace's IDs under the caller's own path, and logs each", async () => {
    for (const [method, url, payload] of routes(alice.workspaceId)) {
      const before = await deniedCount();
      const response = await call(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json(), `${method} ${url}`).toMatchObject({ code: "not_found" });
      expect(await deniedCount(), `${method} ${url} logged`).toBe(before + 1);
    }
    // Nothing of Bruno's changed.
    const { rows } = await db.query(
      `SELECT p.name, p.status, s.status AS stay_status, s.guest_name, r.status AS run_status
         FROM property p, stay s, import_run r WHERE p.id = $1 AND s.id = $2 AND r.id = $3`,
      [ids.property, ids.stay, ids.run],
    );
    expect(rows).toEqual([
      {
        name: "Casa de Bruno",
        status: "active",
        stay_status: "active",
        guest_name: "Huésped de Bruno",
        run_status: "awaiting_confirmation",
      },
    ]);
  });

  it("gives a missing ID the same answer as a foreign one", async () => {
    const swap = (url: string) =>
      url.replace(/[0-9a-f-]{36}(?=[/?]|$)/g, (id) => (id === alice.workspaceId ? id : MISSING));
    for (const [method, url, payload] of routes(alice.workspaceId)) {
      const foreign = await call(method, url, payload);
      const missing = await call(method, swap(url), payload);
      expect(missing.statusCode, `${method} ${url}`).toBe(foreign.statusCode);
      expect(missing.json(), `${method} ${url}`).toEqual(foreign.json());
    }
  });

  it("shows only the caller's workspace in the calendar_feed_public view", async () => {
    const requestDb = ctx.app.get<DbHandle>(REQUEST_DB_HANDLE);
    const { rows } = await db.query<{ user_id: string }>(
      `SELECT user_id FROM membership WHERE workspace_id = $1 AND role = 'owner'`,
      [alice.workspaceId],
    );
    const aliceId = rows[0]!.user_id;
    const own = await insertProperty(db, alice.workspaceId);
    const ownFeed = await insertFeed(db, alice.workspaceId, own);
    const visible = (workspaceId: string) =>
      withRlsContext(requestDb.db, { userId: aliceId, workspaceId }, async (tx) => {
        const result = await tx.execute<{ id: string; workspace_id: string }>(
          sql`SELECT id, workspace_id FROM calendar_feed_public`,
        );
        return result.rows;
      });
    const inOwn = await visible(alice.workspaceId);
    expect(inOwn.map((row) => row.id)).toContain(ownFeed);
    expect(inOwn.every((row) => row.workspace_id === alice.workspaceId)).toBe(true);
    // In a workspace she is not a member of, the view shows nothing at all.
    expect(await visible(bruno.workspaceId)).toEqual([]);
  });
});

/**
 * Feature 003 routes (T121, AC-SEC-011): another workspace's guide, section, item, locked field,
 * version, media, interview, document, or shared block gets the same `404` as one that does not
 * exist, under either workspace's path, and the attempt is logged.
 */
describe("feature 003 resources across workspaces (T121, AC-SEC-011)", () => {
  let ids: {
    property: string;
    section: string;
    item: string;
    field: string;
    media: string;
    session: string;
    document: string;
    block: string;
  };

  beforeAll(async () => {
    const created = await api(
      ctx,
      "POST",
      `/api/v1/workspaces/${bruno.workspaceId}/properties`,
      bruno.cookie,
      {
        name: "Casa de Bruno",
        addressLine1: "Calle Ficticia 9",
        city: "Sámara",
        country: "CR",
        timeZone: "America/Costa_Rica",
        checkInTime: "15:00",
        checkoutTime: "11:00",
        maxGuests: 4,
        guideLanguages: ["es", "en"],
        source: "manual",
      },
    );
    const property = (created.json() as { id: string }).id;
    const { rows: guides } = await db.query<{ id: string }>(
      `SELECT id FROM guide WHERE property_id = $1`,
      [property],
    );
    const guideId = guides[0]!.id;
    const { rows: sections } = await db.query<{ id: string }>(
      `SELECT id FROM guide_section WHERE guide_id = $1 AND kind = 'checkout'`,
      [guideId],
    );
    const section = sections[0]!.id;
    const { rows: items } = await db.query<{ id: string }>(
      `INSERT INTO guide_item (workspace_id, section_id, kind, position, source, source_language, reviewed_at)
       VALUES ($1, $2, 'text', 9, 'host', 'es', now()) RETURNING id`,
      [bruno.workspaceId, section],
    );
    await db.query(
      `INSERT INTO guide_item_text (item_id, language, workspace_id, doc, text_length, origin, state)
       VALUES ($1, 'es', $2, '{"type":"doc","content":[]}', 0, 'source', 'current')`,
      [items[0]!.id, bruno.workspaceId],
    );
    const { rows: fields } = await db.query<{ id: string }>(
      `INSERT INTO restricted_value (workspace_id, property_id, kind, label, source)
       VALUES ($1, $2, 'wifi_password', 'Wi-Fi de Bruno', 'host') RETURNING id`,
      [bruno.workspaceId, property],
    );
    await db.query(
      `INSERT INTO guide_version (workspace_id, guide_id, number, cause, snapshot, snapshot_schema, languages)
       VALUES ($1, $2, 1, 'publish', '{"schema":1,"languages":["es"],"sections":[]}', 1, ARRAY['es'])`,
      [bruno.workspaceId, guideId],
    );
    const { rows: media } = await db.query<{ id: string }>(
      `INSERT INTO media_object (workspace_id, kind, status, object_prefix)
       VALUES ($1::uuid, 'image', 'ready', 'media/' || $1::text || '/' || gen_random_uuid() || '/') RETURNING id`,
      [bruno.workspaceId],
    );
    const { rows: sessions } = await db.query<{ id: string }>(
      `INSERT INTO interview_session (workspace_id, guide_id) VALUES ($1, $2) RETURNING id`,
      [bruno.workspaceId, guideId],
    );
    const { rows: documents } = await db.query<{ id: string }>(
      `INSERT INTO guide_document (workspace_id, guide_id, file_name, kind) VALUES ($1, $2, 'manual.pdf', 'pdf') RETURNING id`,
      [bruno.workspaceId, guideId],
    );
    const { rows: blocks } = await db.query<{ id: string }>(
      `INSERT INTO shared_block (workspace_id, section_kind, name) VALUES ($1, 'checkout', 'Bloque de Bruno') RETURNING id`,
      [bruno.workspaceId],
    );
    ids = {
      property,
      section,
      item: items[0]!.id,
      field: fields[0]!.id,
      media: media[0]!.id,
      session: sessions[0]!.id,
      document: documents[0]!.id,
      block: blocks[0]!.id,
    };
  });

  /** Every feature 003 route that names a resource, as [method, path, body] under `ws`. */
  const routes = (ws: string) => {
    const w = `/api/v1/workspaces/${ws}`;
    const g = `${w}/properties/${ids.property}/guide`;
    const { section: s, item: i, field: f, media: m, session: x, document: d, block: b } = ids;
    const doc = { type: "doc", content: [] };
    return [
      ["GET", g, undefined],
      ["GET", `${g}/completeness`, undefined],
      ["GET", `${g}/preview?source=draft`, undefined],
      ["GET", `${g}/publish-check`, undefined],
      ["POST", `${g}/publish`, { expectedRevisionHash: "0".repeat(64) }],
      ["POST", `${g}/unpublish`, undefined],
      ["GET", `${g}/versions`, undefined],
      ["GET", `${g}/versions/1`, undefined],
      ["POST", `${g}/versions/1/restore`, undefined],
      ["POST", `${g}/sections`, { title: { es: "Tomada" } }],
      ["PATCH", `${g}/sections/${s}`, { revision: 0, hidden: true }],
      ["POST", `${g}/sections/${s}/items`, { revision: 0, kind: "text", language: "es", doc }],
      ["PATCH", `${g}/items/${i}`, { revision: 0, language: "es", doc }],
      ["POST", `${g}/items/${i}/approve`, { revision: 0 }],
      ["POST", `${g}/items/${i}/translations/en`, { revision: 0, action: "translate_again" }],
      ["PUT", `${g}/topics/wifi.troubleshooting`, { mark: "covered" }],
      ["GET", `${g}/locked-fields`, undefined],
      ["POST", `${g}/locked-fields`, { kind: "door_code", label: "Tomada" }],
      ["POST", `${g}/locked-fields/${f}/reveal`, undefined],
      ["PUT", `${g}/locked-fields/${f}/visibility`, { public: true }],
      ["GET", `${g}/media/${m}`, undefined],
      ["POST", `${g}/interview`, {}],
      ["GET", `${g}/interview/${x}`, undefined],
      ["GET", `${g}/documents`, undefined],
      ["DELETE", `${g}/documents/${d}`, undefined],
      ["POST", `${g}/shared-blocks/${b}/exclude`, undefined],
      ["GET", `${w}/shared-blocks/${b}`, undefined],
      ["PATCH", `${w}/shared-blocks/${b}`, { revision: 0, name: "Tomado" }],
      ["POST", `${w}/shared-blocks/${b}/publish`, undefined],
      ["GET", `${w}/shared-blocks/${b}/properties`, undefined],
      ["DELETE", `${w}/shared-blocks/${b}`, undefined],
    ] as const;
  };

  function call(method: string, url: string, payload: object | undefined) {
    return ctx.fastify.inject({
      method: method as "GET",
      url,
      headers: {
        origin: "http://localhost:3000",
        cookie: alice.cookie,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  }

  it("answers 404 under the other workspace's path, and logs each attempt", async () => {
    for (const [method, url, payload] of routes(bruno.workspaceId)) {
      const before = await deniedCount();
      const response = await call(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json(), `${method} ${url}`).toMatchObject({ code: "not_found" });
      expect(await deniedCount(), `${method} ${url} logged`).toBe(before + 1);
    }
  });

  it("answers the same 404 for another workspace's IDs under the caller's own path, and logs each", async () => {
    for (const [method, url, payload] of routes(alice.workspaceId)) {
      const before = await deniedCount();
      const response = await call(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json(), `${method} ${url}`).toMatchObject({ code: "not_found" });
      expect(await deniedCount(), `${method} ${url} logged`).toBe(before + 1);
    }
    // Nothing of Bruno's changed.
    const { rows } = await db.query(
      `SELECT g.status, s.hidden, b.name, (SELECT count(*)::int FROM guide_version v WHERE v.guide_id = g.id) AS versions
         FROM guide g, guide_section s, shared_block b
        WHERE g.property_id = $1 AND s.id = $2 AND b.id = $3`,
      [ids.property, ids.section, ids.block],
    );
    expect(rows).toEqual([
      { status: "draft", hidden: false, name: "Bloque de Bruno", versions: 1 },
    ]);
  });

  it("gives a missing ID the same answer as a foreign one", async () => {
    const swap = (url: string) =>
      url.replace(/[0-9a-f-]{36}(?=[/?]|$)/g, (id) => (id === alice.workspaceId ? id : MISSING));
    for (const [method, url, payload] of routes(alice.workspaceId)) {
      const foreign = await call(method, url, payload);
      const missing = await call(method, swap(url), payload);
      expect(missing.statusCode, `${method} ${url}`).toBe(foreign.statusCode);
      expect(missing.json(), `${method} ${url}`).toEqual(foreign.json());
    }
  });
});
