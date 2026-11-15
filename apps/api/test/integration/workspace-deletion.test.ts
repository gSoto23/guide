import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { addMember, api, invitationsUrl, newOwner } from "./invitation-helpers.js";
import { createTestApp } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("workspace deletion and restore (T088, FR-027)", () => {
  it("needs the typed name, hides the workspace from members, and the owner can restore it", async () => {
    const owner = await newOwner(ctx, "del-owner");
    const agent = await addMember(ctx, owner, "agent", "del-agent");
    const url = `/api/v1/workspaces/${owner.workspaceId}`;
    const name = ((await api(ctx, "GET", url, owner.cookie)).json() as { name: string }).name;

    const wrong = await api(ctx, "DELETE", url, owner.cookie, { confirmName: "nope" });
    expect(wrong.statusCode).toBe(422);
    const byAgent = await api(ctx, "DELETE", url, agent.cookie, { confirmName: name });
    expect(byAgent.statusCode).toBe(403);

    const deleted = await api(ctx, "DELETE", url, owner.cookie, { confirmName: name });
    expect(deleted.statusCode, deleted.body).toBe(202);
    expect(deleted.json()).toMatchObject({ status: "pending_deletion" });
    expect((await api(ctx, "GET", url, agent.cookie)).statusCode).toBe(404);
    expect((await api(ctx, "GET", url, owner.cookie)).json()).toMatchObject({
      status: "pending_deletion",
    });
    // Nothing else works until it is restored.
    const invite = await api(ctx, "GET", invitationsUrl(owner.workspaceId), owner.cookie);
    expect(invite.json()).toMatchObject({ code: "workspace_pending_deletion" });
    const notices = await db.query(
      `SELECT 1 FROM pgboss.job WHERE data->>'template' = 'workspace.deletion_scheduled' AND data->>'to' IN ($1, $2)`,
      [owner.email, agent.email],
    );
    expect(notices.rowCount).toBe(2);

    const restored = await api(ctx, "POST", `${url}/restore`, owner.cookie);
    expect(restored.statusCode, restored.body).toBe(200);
    expect((await api(ctx, "GET", url, agent.cookie)).statusCode).toBe(200);
  });

  it("purges the workspace after 30 days and keeps the security log", async () => {
    const owner = await newOwner(ctx, "purge-owner");
    const url = `/api/v1/workspaces/${owner.workspaceId}`;
    const name = ((await api(ctx, "GET", url, owner.cookie)).json() as { name: string }).name;
    await api(ctx, "DELETE", url, owner.cookie, { confirmName: name });
    await db.query(`UPDATE workspace SET purge_after = now() - interval '1 minute' WHERE id = $1`, [
      owner.workspaceId,
    ]);
    expect((await api(ctx, "POST", `${url}/restore`, owner.cookie)).statusCode).toBe(410);

    const purged = await db.query<{ purged_workspace_id: string }>(
      `SELECT * FROM purge_due_workspaces()`,
    );
    expect(purged.rows.map((r) => r.purged_workspace_id)).toContain(owner.workspaceId);
    const left = await db.query(`SELECT 1 FROM workspace WHERE id = $1`, [owner.workspaceId]);
    expect(left.rowCount).toBe(0);
    const events = await db.query<{ type: string }>(
      `SELECT type FROM security_event WHERE workspace_id = $1 ORDER BY occurred_at`,
      [owner.workspaceId],
    );
    expect(events.rows.map((r) => r.type)).toEqual(
      expect.arrayContaining([
        "workspace.created",
        "workspace.deletion_scheduled",
        "workspace.purged",
      ]),
    );
  });
});
