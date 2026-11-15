import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, systemQuery } from "./helpers.js";
import { addMember, api, newOwner } from "./invitation-helpers.js";
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

describe("member role changes and removal (T086, T092, FR-025)", () => {
  it("removes a member, whose every session loses the workspace at once (SC-006)", async () => {
    const owner = await newOwner(ctx, "rm-owner");
    const member = await addMember(ctx, owner, "agent", "rm-agent");
    const otherDevice = await signIn(ctx, member.email);
    const workspaceUrl = `/api/v1/workspaces/${owner.workspaceId}`;
    expect((await api(ctx, "GET", workspaceUrl, otherDevice)).statusCode).toBe(200);

    const removed = await api(
      ctx,
      "DELETE",
      `${workspaceUrl}/members/${member.membershipId}`,
      owner.cookie,
    );
    expect(removed.statusCode).toBe(204);
    for (const session of [member.cookie, otherDevice]) {
      expect((await api(ctx, "GET", workspaceUrl, session)).statusCode).toBe(404);
    }
    const me = (await api(ctx, "GET", "/api/v1/me", otherDevice)).json() as {
      memberships: unknown[];
      lastWorkspaceId: string | null;
    };
    expect(me.memberships).toEqual([]);
    expect(me.lastWorkspaceId).toBeNull();
    const notice = await db.query(
      `SELECT 1 FROM pgboss.job WHERE data->>'to' = $1 AND data->>'template' = 'team.member_removed'`,
      [member.email],
    );
    expect(notice.rowCount).toBe(1);
  });

  it("changes roles between admin and agent, never the owner's (AC-SEC-003)", async () => {
    const owner = await newOwner(ctx, "role-owner");
    const admin = await addMember(ctx, owner, "admin", "role-admin");
    const agent = await addMember(ctx, owner, "agent", "role-agent");
    const membersUrl = `/api/v1/workspaces/${owner.workspaceId}/members`;

    const promoted = await api(ctx, "PATCH", `${membersUrl}/${agent.membershipId}`, owner.cookie, {
      role: "admin",
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(promoted.json()).toMatchObject({ role: "admin" });

    const ownerRow = (
      (await api(ctx, "GET", membersUrl, owner.cookie)).json() as {
        members: { membershipId: string; role: string }[];
      }
    ).members.find((m) => m.role === "owner");
    const demoteOwner = await api(
      ctx,
      "PATCH",
      `${membersUrl}/${ownerRow?.membershipId}`,
      admin.cookie,
      {
        role: "agent",
      },
    );
    expect(demoteOwner.statusCode).toBe(403);
    const removeOwner = await api(
      ctx,
      "DELETE",
      `${membersUrl}/${ownerRow?.membershipId}`,
      admin.cookie,
    );
    expect(removeOwner.statusCode).toBe(403);
    const denied = await db.query(
      `SELECT 1 FROM security_event WHERE workspace_id = $1 AND outcome = 'denied'
       AND type IN ('member.role_changed', 'member.removed')`,
      [owner.workspaceId],
    );
    expect(denied.rowCount).toBe(2);

    const role = await db.query<{ role: string }>(`SELECT role FROM membership WHERE id = $1`, [
      ownerRow?.membershipId,
    ]);
    expect(role.rows[0]?.role).toBe("owner");
  });

  it("lets members leave, but not the owner (FR-026)", async () => {
    const owner = await newOwner(ctx, "leave-owner");
    const agent = await addMember(ctx, owner, "agent", "leave-agent");
    const leaveUrl = `/api/v1/workspaces/${owner.workspaceId}/leave`;
    const ownerLeaves = await api(ctx, "POST", leaveUrl, owner.cookie);
    expect(ownerLeaves.statusCode).toBe(409);
    expect(ownerLeaves.json()).toMatchObject({ code: "owner_must_transfer" });
    expect((await api(ctx, "POST", leaveUrl, agent.cookie)).statusCode).toBe(204);
    expect(
      (await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}`, agent.cookie)).statusCode,
    ).toBe(404);
  });
});
