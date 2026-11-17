import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PgBoss } from "pg-boss";
import type {
  CreatedPmsConnection,
  ImportRun,
  PmsConnectionList,
  PmsDisconnectResult,
  PmsListingList,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  captureLogs,
  insertProperty,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * US4: PMS connections (T085, FR-027, FR-033, FR-035, FR-036, AC-SEC-001, AC-SEC-007,
 * AC-SEC-008), with the recorded-fixture adapters (PMS_MODE=fixtures). The worker's answers to
 * listing and revoke calls come from a pg-boss responder in this process, so these tests cover
 * the API's side of the call; the jobs themselves are tested in the worker.
 */
const BEDS24_INVITE = "FIXTURE-BEDS24-INVITE";
const BEDS24_REFRESH = "fixture-beds24-refresh";
const HOSTEX_TOKEN = "FIXTURE-HOSTEX-TOKEN";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let responder: PgBoss;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), { PMS_BEDS24: "true", PMS_HOSTEX: "true" });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "pms");
  responder = new PgBoss(inject("databaseUrl"));
  await responder.start();
});

afterAll(async () => {
  await responder.stop({ graceful: false });
  await db.close();
  await ctx.app.close();
});

const connect = (team: TeamWorkspace, body: object) =>
  wsApi(ctx, team.owner, "POST", team.workspaceId, "/pms-connections", body);

async function countEvents(type: string, workspaceId = team.workspaceId) {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE type = $1 AND workspace_id = $2`,
    [type, workspaceId],
  );
  return rows[0]!.count;
}

/** Answers a worker queue from this process, as the worker would; returns how to stop it. */
async function answer(queue: string, output: object): Promise<() => Promise<void>> {
  await responder.createQueue(queue).catch(() => undefined);
  const id = await responder.work(queue, async () => output);
  return () => responder.offWork(queue, { id });
}

describe("connecting a PMS (FR-027, US4 scenario 3)", () => {
  it("refuses agents with 404 and logs the refusal (AC-SEC-001)", async () => {
    const before = await countEvents("access.role_denied");
    const attempts = [
      wsApi(ctx, team.agent, "GET", team.workspaceId, "/pms-connections"),
      wsApi(ctx, team.agent, "POST", team.workspaceId, "/pms-connections", {
        provider: "beds24",
        credential: BEDS24_INVITE,
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(404);
    }
    expect(await countEvents("access.role_denied")).toBe(before + attempts.length);
  });

  it("asks for a recent sign-in first (AC-SEC-007)", async () => {
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.admin.userId],
    );
    const response = await wsApi(ctx, team.admin, "POST", team.workspaceId, "/pms-connections", {
      provider: "beds24",
      credential: BEDS24_INVITE,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "step_up_required" });
    await db.query(`UPDATE session_assurance SET strong_auth_at = now() WHERE user_id = $1`, [
      team.admin.userId,
    ]);
  });

  it("asks for a second factor once the workspace has 3 properties (FR-048)", async () => {
    const big = await seedTeam(ctx, db, "pms-mfa");
    for (let i = 0; i < 3; i += 1) await insertProperty(db, big.workspaceId);
    const response = await connect(big, { provider: "beds24", credential: BEDS24_INVITE });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "mfa_enrollment_required" });
  });

  it("refuses an invalid credential and stores nothing (US4 scenario 3)", async () => {
    const response = await connect(team, { provider: "beds24", credential: "not-a-real-invite" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "invalid_credential",
      provider: "beds24",
      helpUrl: expect.stringMatching(/^https:\/\//),
    });
    const { rows } = await db.query(`SELECT 1 FROM pms_connection WHERE workspace_id = $1`, [
      team.workspaceId,
    ]);
    expect(rows).toEqual([]);
  });

  it("stores only the encrypted refresh token and returns the listings (AC-SEC-008)", async () => {
    const logs = captureLogs();
    const response = await connect(team, { provider: "beds24", credential: BEDS24_INVITE });
    logs.stop();
    expect(response.statusCode, response.body).toBe(201);
    const created = response.json() as CreatedPmsConnection;
    expect(created).toMatchObject({ provider: "beds24", status: "active" });
    expect(created.listings.length).toBeGreaterThan(0);
    expect(created.listings.every((listing) => listing.alreadyImported === false)).toBe(true);
    expect(response.body).not.toContain(BEDS24_INVITE);
    expect(response.body).not.toContain(BEDS24_REFRESH);
    logs.expectNoSecrets([BEDS24_INVITE, BEDS24_REFRESH]);

    const { rows } = await db.query<{ credential_ciphertext: Buffer }>(
      `SELECT credential_ciphertext FROM pms_connection WHERE id = $1`,
      [created.id],
    );
    const stored = rows[0]!.credential_ciphertext.toString("latin1");
    expect(stored).not.toContain(BEDS24_REFRESH);
    expect(stored).not.toContain(BEDS24_INVITE);
    expect(await countEvents("integration.connected")).toBe(1);

    const list = await wsApi(ctx, team.owner, "GET", team.workspaceId, "/pms-connections");
    expect((list.json() as PmsConnectionList).items).toHaveLength(1);
    expect(list.body).not.toContain("credential");
  });
});

describe("listings, imports, and refresh (FR-028, FR-033, FR-035)", () => {
  let connectionId: string;

  beforeAll(async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM pms_connection WHERE workspace_id = $1 AND provider = 'beds24'`,
      [team.workspaceId],
    );
    connectionId = rows[0]!.id;
  });

  it("lists the PMS listings through the worker and marks the imported ones", async () => {
    await insertProperty(db, team.workspaceId, {
      sourceProvider: "beds24",
      externalId: "9001:1",
      pmsConnectionId: connectionId,
    });
    const stop = await answer("pms.listings", {
      listings: [
        { externalId: "9001:1", name: "Casa Colibrí" },
        { externalId: "9002:1", name: "Hotel Las Olas" },
      ],
    });
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/pms-connections/${connectionId}/listings`,
    );
    await stop();
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as PmsListingList).items).toEqual([
      {
        externalId: "9001:1",
        name: "Casa Colibrí",
        alreadyImported: true,
        propertyId: expect.any(String),
      },
      { externalId: "9002:1", name: "Hotel Las Olas", alreadyImported: false, propertyId: null },
    ]);
  });

  it("caps an import at the free slots and runs it in the background (FR-028)", async () => {
    // One property already exists; the Free plan allows 2. The already-imported one takes no slot.
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/pms-connections/${connectionId}/imports`,
      { externalIds: ["9001:1", "9002:1", "9003:1"] },
      { "idempotency-key": crypto.randomUUID() },
    );
    expect(response.statusCode, response.body).toBe(202);
    const run = response.json() as ImportRun;
    expect(run).toMatchObject({
      kind: "pms",
      provider: "beds24",
      status: "running",
      total: 3,
      skipped: 1,
    });
    const { rows } = await db.query<{
      external_id: string;
      outcome: string;
      reason_code: string | null;
    }>(
      `SELECT external_id, outcome, reason_code FROM import_item WHERE import_run_id = $1 ORDER BY external_id`,
      [run.id],
    );
    expect(rows).toEqual([
      { external_id: "9001:1", outcome: "pending", reason_code: null },
      { external_id: "9002:1", outcome: "pending", reason_code: null },
      { external_id: "9003:1", outcome: "skipped", reason_code: "plan_limit" },
    ]);
    const jobs = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'pms.import' AND data->>'importRunId' = $1`,
      [run.id],
    );
    expect(jobs.rows).toHaveLength(1);
    expect(await countEvents("import.started")).toBe(1);

    const progress = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports?status=running`,
    );
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toMatchObject({ items: [expect.objectContaining({ id: run.id })] });
  });

  it("allows Refresh now once every 5 minutes (FR-035)", async () => {
    const path = `/pms-connections/${connectionId}/refresh`;
    const first = await wsApi(ctx, team.owner, "POST", team.workspaceId, path);
    expect(first.statusCode).toBe(202);
    const second = await wsApi(ctx, team.owner, "POST", team.workspaceId, path);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "refresh_too_soon" });
  });
});

describe("disconnecting (FR-036, SEC-13)", () => {
  it("revokes Beds24's token through the worker and deletes Guidesk's copy", async () => {
    const solo = await seedTeam(ctx, db, "pms-revoke");
    const created = (
      await connect(solo, { provider: "beds24", credential: BEDS24_INVITE })
    ).json() as CreatedPmsConnection;
    const linked = await insertProperty(db, solo.workspaceId, {
      sourceProvider: "beds24",
      externalId: "7001:1",
      pmsConnectionId: created.id,
    });
    const stop = await answer("pms.revoke", { providerRevoked: true });
    const response = await wsApi(
      ctx,
      solo.owner,
      "DELETE",
      solo.workspaceId,
      `/pms-connections/${created.id}`,
    );
    await stop();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json() as PmsDisconnectResult).toEqual({
      providerRevoked: true,
      instructionsUrl: null,
    });
    const { rows } = await db.query<{ status: string; credential_ciphertext: Buffer | null }>(
      `SELECT status, credential_ciphertext FROM pms_connection WHERE id = $1`,
      [created.id],
    );
    expect(rows[0]).toEqual({ status: "disconnected", credential_ciphertext: null });
    const events = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE type = 'integration.disconnected' AND workspace_id = $1`,
      [solo.workspaceId],
    );
    expect(events.rows[0]!.metadata).toEqual({ provider: "beds24", providerRevoked: true });
    // Imported properties stay, with their source label.
    const kept = await db.query<{ source: string; source_provider: string }>(
      `SELECT source, source_provider FROM property WHERE id = $1`,
      [linked],
    );
    expect(kept.rows[0]).toEqual({ source: "pms", source_provider: "beds24" });
  });

  it("tells the host to delete Hostex's token, which has no revoke endpoint", async () => {
    const solo = await seedTeam(ctx, db, "pms-hostex");
    const connected = await connect(solo, { provider: "hostex", credential: HOSTEX_TOKEN });
    expect(connected.statusCode, connected.body).toBe(201);
    const created = connected.json() as CreatedPmsConnection;
    const response = await wsApi(
      ctx,
      solo.owner,
      "DELETE",
      solo.workspaceId,
      `/pms-connections/${created.id}`,
    );
    expect(response.json()).toEqual({
      providerRevoked: false,
      instructionsUrl: expect.stringMatching(/^https:\/\//),
    });
    const { rows } = await db.query<{ credential_ciphertext: Buffer | null }>(
      `SELECT credential_ciphertext FROM pms_connection WHERE id = $1`,
      [created.id],
    );
    expect(rows[0]!.credential_ciphertext).toBeNull();
  });

  it(
    "still deletes the credential when the worker does not answer within 15 seconds",
    { timeout: 40_000 },
    async () => {
      const solo = await seedTeam(ctx, db, "pms-down");
      const created = (
        await connect(solo, { provider: "beds24", credential: BEDS24_INVITE })
      ).json() as CreatedPmsConnection;
      const response = await wsApi(
        ctx,
        solo.owner,
        "DELETE",
        solo.workspaceId,
        `/pms-connections/${created.id}`,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        providerRevoked: false,
        instructionsUrl: expect.any(String),
      });
      const { rows } = await db.query<{ status: string; credential_ciphertext: Buffer | null }>(
        `SELECT status, credential_ciphertext FROM pms_connection WHERE id = $1`,
        [created.id],
      );
      expect(rows[0]).toEqual({ status: "disconnected", credential_ciphertext: null });
    },
  );
});
