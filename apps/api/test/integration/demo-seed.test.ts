import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { AnalyticsSummary } from "@guidesk/contracts";
import type { DbHandle } from "@guidesk/db";
import type { Vault } from "@guidesk/vault";
import { formatResult, main } from "../../src/cli/demo-seed.js";
import { DB_HANDLE } from "../../src/database/database.module.js";
import {
  assertDemoAllowed,
  DemoSeedError,
  seedDemo,
  type DemoSeedResult,
} from "../../src/demo/seed.js";
import { VAULT } from "../../src/integrations/integrations.module.js";
import { exchange, guest } from "./guest-helpers.js";
import { systemQuery, uniqueEmail } from "./helpers.js";
import { newOwner } from "./invitation-helpers.js";
import { wsApi, type Member } from "./property-helpers.js";
import { createTestApp, GUIDE_URL } from "./test-app.js";

/**
 * The founder's demo command (feature 014 US3, T021): a complete workspace from synthetic data, in
 * one transaction, with door codes and stay links sealed by the vault, no secret in the output,
 * and refusals before any write. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let deps: { db: DbHandle["db"]; vault: Vault };
let owner: Member;
let result: DemoSeedResult;
let emailsBefore = 0;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  const created = await newOwner(ctx, "demo-seed");
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    created.email,
  ]);
  owner = { email: created.email, cookie: created.cookie, userId: rows[0]!.id };
  deps = { db: ctx.app.get<DbHandle>(DB_HANDLE).db, vault: ctx.app.get<Vault>(VAULT) };
  emailsBefore = ctx.email.sent.length;
  const started = Date.now();
  result = await seedDemo(deps, { email: owner.email.toUpperCase(), guideUrl: GUIDE_URL });
  // Plan Performance Budget: the local run stays within 60 seconds.
  expect(Date.now() - started).toBeLessThan(60_000);
}, 120_000);

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const properties = async () =>
  (
    await db.query<{ id: string; name: string; setup_status: string; time_zone: string }>(
      `SELECT id, name, setup_status, time_zone FROM property WHERE workspace_id = $1 ORDER BY name`,
      [result.workspaceId],
    )
  ).rows;

describe("demo workspace (feature 014 US3)", () => {
  it("is a Pro workspace marked as demo, with the account as its only owner", async () => {
    expect(result.workspaceName).toBe("Demo · Guidesk");
    const { rows } = await db.query<{ demo: boolean; plan: string; age: number }>(
      `SELECT demo, plan, extract(day FROM now() - created_at)::int AS age FROM workspace WHERE id = $1`,
      [result.workspaceId],
    );
    expect(rows[0]).toMatchObject({ demo: true, plan: "pro" });
    expect(rows[0]!.age).toBeGreaterThanOrEqual(74);
    const members = await db.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM membership WHERE workspace_id = $1`,
      [result.workspaceId],
    );
    expect(members.rows).toEqual([{ user_id: owner.userId, role: "owner" }]);
  });

  it("has two ready properties in Costa Rica with published bilingual guides and links", async () => {
    const rows = await properties();
    expect(rows.map((row) => [row.name, row.setup_status, row.time_zone])).toEqual([
      ["Casa Brisa", "ready", "America/Costa_Rica"],
      ["Loft Escazú", "ready", "America/Costa_Rica"],
    ]);
    const guides = await db.query<{ status: string; languages: string[]; sections: number }>(
      `SELECT g.status, v.languages, jsonb_array_length(v.snapshot->'sections') AS sections
         FROM guide g JOIN guide_version v ON v.id = g.published_version_id
        WHERE g.workspace_id = $1`,
      [result.workspaceId],
    );
    expect(guides.rows).toHaveLength(2);
    for (const row of guides.rows) {
      expect(row).toMatchObject({ status: "published", languages: ["es", "en"] });
      expect(row.sections).toBe(9);
    }
    expect(result.properties.map((entry) => entry.guideUrl)).toEqual([
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:3001\/g\/[a-z2-7]{26}$/),
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:3001\/g\/[a-z2-7]{26}$/),
    ]);
  });

  it("has past, current, and upcoming stays with fictional first names and no contact data", async () => {
    const { rows } = await db.query<{ past: number; current: number; upcoming: number }>(
      `SELECT count(*) FILTER (WHERE checkout_date < current_date)::int AS past,
              count(*) FILTER (WHERE check_in_date <= current_date AND checkout_date > current_date)::int AS current,
              count(*) FILTER (WHERE check_in_date > current_date)::int AS upcoming
         FROM stay WHERE workspace_id = $1`,
      [result.workspaceId],
    );
    expect(rows[0]!.past).toBeGreaterThanOrEqual(6);
    expect(rows[0]!.current).toBe(2);
    expect(rows[0]!.upcoming).toBe(2);
    const links = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stay_link WHERE workspace_id = $1 AND status = 'active'`,
      [result.workspaceId],
    );
    expect(links.rows[0]!.n).toBe(4);
  });

  it("lets a guest with the current stay link see the door code (copied from the portal)", async () => {
    const brisa = (await properties()).find((row) => row.name === "Casa Brisa")!;
    const { rows } = await db.query<{ stay_id: string; door: string; public_id: string }>(
      `SELECT s.id AS stay_id,
              (SELECT id FROM restricted_value WHERE property_id = $1 AND kind = 'door_code') AS door,
              (SELECT public_id FROM guide_link WHERE property_id = $1 AND status = 'active') AS public_id
         FROM stay s WHERE s.property_id = $1
          AND s.check_in_date <= current_date AND s.checkout_date > current_date`,
      [brisa.id],
    );
    const copy = await wsApi(
      ctx,
      owner,
      "POST",
      result.workspaceId,
      `/properties/${brisa.id}/share/stays/${rows[0]!.stay_id}/link`,
    );
    expect(copy.statusCode, copy.body).toBe(200);
    const token = (copy.json() as { url: string }).url.split("/s/")[1]!;
    const session = await exchange(ctx, token);
    expect(session.response.statusCode, session.response.body).toBe(200);
    const reveal = await guest(ctx, "POST", "/api/v1/guest/reveals", {
      payload: { publicId: rows[0]!.public_id, fieldId: rows[0]!.door },
      cookie: session.cookie!,
    });
    expect(reveal.statusCode, reveal.body).toBe(200);
    expect(reveal.json()).toEqual({ value: "4821" });

    // AC-SEC-003: stored ciphertext never contains the token or the code.
    const sealed = await db.query<{ token: Buffer; door: Buffer }>(
      `SELECT l.token_ciphertext AS token, r.value_ciphertext AS door
         FROM stay_link l, restricted_value r
        WHERE l.stay_id = $1 AND r.id = $2`,
      [rows[0]!.stay_id, rows[0]!.door],
    );
    expect(sealed.rows[0]!.token.includes(Buffer.from(token))).toBe(false);
    expect(sealed.rows[0]!.door.includes(Buffer.from("4821"))).toBe(false);
  });

  it("waits in the inbox with one malfunction and an open draft", async () => {
    const { rows } = await db.query<{ reason: string; drafts: number }>(
      `SELECT c.needs_host_reason AS reason,
              (SELECT count(*)::int FROM agent_draft d WHERE d.conversation_id = c.id AND d.status = 'open') AS drafts
         FROM conversation c WHERE c.workspace_id = $1 AND c.status = 'needs_host'`,
      [result.workspaceId],
    );
    expect(rows).toEqual([{ reason: "malfunction", drafts: 1 }]);
  });

  it("fills every Analytics block for 30 days, with a comparison", async () => {
    const response = await wsApi(ctx, owner, "GET", result.workspaceId, "/analytics?period=30");
    expect(response.statusCode, response.body).toBe(200);
    const s = response.json() as AnalyticsSummary;
    expect(s.comparable).toBe(true);
    for (const count of [
      s.views.property,
      s.views.stay,
      s.questions.total,
      s.questions.automatic,
      s.questions.escalated,
      s.explore.opens,
    ]) {
      expect(count.current).toBeGreaterThan(0);
      expect(count.previous).toBeGreaterThan(0);
    }
    expect(s.staysOpened.current).toBeGreaterThan(0);
    expect(s.topics.length).toBeGreaterThanOrEqual(5);
    expect(s.escalations.length).toBeGreaterThanOrEqual(4);
    expect(s.unanswered).toBeGreaterThan(0);
    expect(new Set(s.explore.clicks.map((entry) => entry.partner))).toEqual(
      new Set(["viator", "civitatis"]),
    );
    expect(s.requests.byStatus.map((entry) => entry.status)).toEqual(
      expect.arrayContaining(["waiting", "confirmed"]),
    );
    // AI replies stay under the Pro pool for two properties (600 a month).
    const usage = await db.query<{ replies: number }>(
      `SELECT coalesce(sum(replies), 0)::int AS replies FROM chat_usage_daily
        WHERE workspace_id = $1 AND day > current_date - 30`,
      [result.workspaceId],
    );
    expect(usage.rows[0]!.replies).toBeLessThan(600);
  });

  it("has extras and requests in several states, and records one security event", async () => {
    const extras = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM extra WHERE workspace_id = $1`,
      [result.workspaceId],
    );
    expect(extras.rows[0]!.n).toBe(5);
    const statuses = await db.query<{ status: string }>(
      `SELECT DISTINCT status FROM service_request WHERE workspace_id = $1`,
      [result.workspaceId],
    );
    expect(statuses.rows.map((row) => row.status).sort()).toEqual([
      "confirmed",
      "declined",
      "waiting",
    ]);
    const events = await db.query<{ actor: string; metadata: Record<string, number> }>(
      `SELECT actor_user_id AS actor, metadata FROM security_event
        WHERE workspace_id = $1 AND type = 'workspace.demo_seeded'`,
      [result.workspaceId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      actor: owner.userId,
      metadata: { properties: 2, stays: result.stays },
    });
  });

  it("prints names and guide links, never a code or a stay link, and sends no email", () => {
    const text = formatResult(result, owner.email);
    expect(text).toContain("Demo workspace created: Demo · Guidesk");
    expect(text).toContain("Casa Brisa guide: http://127.0.0.1:3001/g/");
    expect(text).not.toContain("/s/");
    expect(text).not.toContain("4821");
    expect(text).not.toContain("7395");
    expect(ctx.email.sent.length).toBe(emailsBefore);
  });
});

describe("demo command refusals (AC-SEC-001, AC-SEC-002, AC-SEC-008)", () => {
  const demoCount = async () =>
    (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM workspace w JOIN membership m ON m.workspace_id = w.id
          WHERE w.demo AND m.user_id = $1`,
        [owner.userId],
      )
    ).rows[0]!.n;

  it("refuses the production stage, and a deployed stage without STAGE", async () => {
    expect(() => assertDemoAllowed({ NODE_ENV: "production", STAGE: "production" })).toThrow(
      DemoSeedError,
    );
    expect(() => assertDemoAllowed({ NODE_ENV: "production" })).toThrow(DemoSeedError);
    expect(() => assertDemoAllowed({ NODE_ENV: "production", STAGE: "staging" })).not.toThrow();
    expect(() => assertDemoAllowed({ NODE_ENV: "test" })).not.toThrow();
    const before = await demoCount();
    expect(await main(["--email", owner.email], { ...process.env, STAGE: "production" })).toBe(3);
    expect(await main([], process.env)).toBe(2);
    expect(await demoCount()).toBe(before);
  });

  it("refuses an unknown or unverified account and writes nothing", async () => {
    await expect(
      seedDemo(deps, { email: uniqueEmail("nobody"), guideUrl: GUIDE_URL }),
    ).rejects.toMatchObject({ code: "unknown_account" });
    const unverified = uniqueEmail("unverified");
    await db.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Sin verificar', $2, false)`,
      [`demo-unverified-${Date.now()}`, unverified],
    );
    await expect(seedDemo(deps, { email: unverified, guideUrl: GUIDE_URL })).rejects.toMatchObject({
      code: "unverified_account",
    });
  });

  it("leaves nothing behind when the run fails midway", async () => {
    const before = await demoCount();
    await expect(
      seedDemo(deps, { email: owner.email, guideUrl: GUIDE_URL, failAfterWorkspace: true }),
    ).rejects.toThrow("forced failure");
    expect(await demoCount()).toBe(before);
  });

  it("numbers a second demo workspace and leaves the first one alone", async () => {
    const second = await seedDemo(deps, { email: owner.email, guideUrl: GUIDE_URL });
    expect(second.workspaceName).toBe("Demo · Guidesk 2");
    expect(second.workspaceId).not.toBe(result.workspaceId);
    const first = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM property WHERE workspace_id = $1`,
      [result.workspaceId],
    );
    expect(first.rows[0]!.n).toBe(2);
  }, 120_000);
});
