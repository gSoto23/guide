import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { UnansweredPage } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { crDate } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 010 (T021): AC-SEC-002 (only 7, 30, or 90 days and only this
 * workspace's data, whatever the query or cursor says), AC-SEC-003 and AC-SEC-004 (guest text only in
 * the unanswered list, as stored, and gone with its conversation; covered in analytics.test.ts too), and
 * removed members losing access at once. AC-SEC-001 is in cross-tenant.test.ts and AC-SEC-005 in the
 * db package's pilot-report.test.ts. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let other: TeamWorkspace;
let propertyId = "";
let otherTrace = "";

async function unansweredIn(
  workspace: TeamWorkspace,
  property: string,
  text: string,
): Promise<string> {
  const conversation = await db.query<{ id: string }>(
    `INSERT INTO conversation (workspace_id, property_id, cookie_hash, language)
     VALUES ($1, $2, md5(random()::text) || md5(random()::text), 'es') RETURNING id`,
    [workspace.workspaceId, property],
  );
  const message = await db.query<{ id: string }>(
    `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, body)
     VALUES ($1, $2, 1, 'guest', $3) RETURNING id`,
    [workspace.workspaceId, conversation.rows[0]!.id, text],
  );
  const trace = await db.query<{ id: string }>(
    `INSERT INTO agent_trace (workspace_id, conversation_id, guest_message_id, decision, reason,
       autonomy, created_at)
     VALUES ($1, $2, $3, 'held', 'not_confident', 'auto', $4) RETURNING id`,
    [
      workspace.workspaceId,
      conversation.rows[0]!.id,
      message.rows[0]!.id,
      `${crDate(-1)}T18:00:00Z`,
    ],
  );
  return trace.rows[0]!.id;
}

const insertProperty = async (workspace: TeamWorkspace, name: string) =>
  (
    await db.query<{ id: string }>(
      `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, country, time_zone)
       VALUES ($1, $2, ARRAY['es'], 'ready', 'manual', 'CR', 'America/Costa_Rica') RETURNING id`,
      [workspace.workspaceId, name],
    )
  ).rows[0]!.id;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview010");
  other = await seedTeam(ctx, db, "secreview010b");
  propertyId = await insertProperty(team, "Casa Revisada");
  await unansweredIn(team, propertyId, "¿Dónde compro protector solar?");
  otherTrace = await unansweredIn(
    other,
    await insertProperty(other, "Casa Ajena"),
    "Texto de otro espacio",
  );
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("feature 010 security review (API)", () => {
  it("AC-SEC-002: refuses periods and keys outside the contract", async () => {
    for (const query of [
      "period=1",
      "period=365",
      "period=30;DROP TABLE stay",
      "period=30&workspaceId=x",
      `period=30&propertyId=not-a-uuid`,
    ]) {
      const refused = await wsApi(ctx, team.owner, "GET", team.workspaceId, `/analytics?${query}`);
      expect(refused.statusCode, query).toBe(422);
    }
  });

  it("AC-SEC-002: a cursor built from another workspace's question reads nothing of theirs", async () => {
    const forged = Buffer.from(`2099-01-01T00:00:00.000Z|${otherTrace}`).toString("base64url");
    const page = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/analytics/unanswered?period=90&cursor=${forged}`,
    );
    expect(page.statusCode).toBe(200);
    const body = page.json() as UnansweredPage;
    expect(JSON.stringify(body)).not.toContain("Texto de otro espacio");
    expect(body.items.map((item) => item.text)).toEqual(["¿Dónde compro protector solar?"]);
  });

  it("AC-SEC-003: the summary carries no guest text", async () => {
    const summary = await wsApi(ctx, team.owner, "GET", team.workspaceId, "/analytics?period=7");
    expect(summary.statusCode).toBe(200);
    expect(summary.body).not.toContain("protector solar");
    expect(summary.headers["content-type"]).toContain("application/json");
  });

  it("removed members lose access at once", async () => {
    const before = await wsApi(ctx, team.agent, "GET", team.workspaceId, "/analytics?period=7");
    expect(before.statusCode).toBe(200);
    await db.query(`DELETE FROM membership WHERE workspace_id = $1 AND user_id = $2`, [
      team.workspaceId,
      team.agent.userId,
    ]);
    for (const path of ["/analytics?period=7", "/analytics/unanswered?period=7"]) {
      const after = await wsApi(ctx, team.agent, "GET", team.workspaceId, path);
      expect(after.statusCode, path).toBe(404);
    }
  });
});
