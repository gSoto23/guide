import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery, uniqueEmail } from "./helpers.js";
import { api, invitationsUrl, newOwner } from "./invitation-helpers.js";
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
  ctx = await createTestApp(inject("databaseUrl"));
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
