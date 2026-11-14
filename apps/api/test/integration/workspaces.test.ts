import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, uniqueEmail } from "./helpers.js";
import { api, invitationsUrl, invitationTokenFor, newOwner } from "./invitation-helpers.js";
import { createTestApp } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
});

type Me = {
  lastWorkspaceId: string;
  memberships: { workspaceId: string; workspaceName: string; role: string }[];
};

async function me(cookie: string): Promise<Me> {
  return (await api(ctx, "GET", "/api/v1/me", cookie)).json() as Me;
}

describe("several workspaces (US4, FR-022 to FR-024)", () => {
  it("creates another workspace owned by the caller and switches to it (FR-023)", async () => {
    const owner = await newOwner(ctx, "ws-create");
    const created = await api(ctx, "POST", "/api/v1/workspaces", owner.cookie, {
      name: "  Casa de Playa  ",
    });
    expect(created.statusCode, created.body).toBe(201);
    const workspace = created.json() as { id: string; name: string; role: string };
    expect(workspace).toMatchObject({ name: "Casa de Playa", role: "owner", status: "active" });
    const after = await me(owner.cookie);
    expect(after.lastWorkspaceId).toBe(workspace.id);
    expect(after.memberships.map((m) => m.role)).toEqual(["owner", "owner"]);
    // Seat limits apply to each workspace separately.
    const seats = (await api(ctx, "GET", invitationsUrl(workspace.id), owner.cookie)).json() as {
      seats: { used: number };
    };
    expect(seats.seats.used).toBe(1);
  });

  it("switches the current workspace and reopens it at the next sign-in (FR-024)", async () => {
    const owner = await newOwner(ctx, "ws-switch");
    const second = (
      await api(ctx, "POST", "/api/v1/workspaces", owner.cookie, { name: "Segundo" })
    ).json() as { id: string };
    const back = await api(ctx, "PUT", "/api/v1/me/current-workspace", owner.cookie, {
      workspaceId: owner.workspaceId,
    });
    expect(back.statusCode).toBe(204);
    expect((await me(owner.cookie)).lastWorkspaceId).toBe(owner.workspaceId);
    await api(ctx, "PUT", "/api/v1/me/current-workspace", owner.cookie, { workspaceId: second.id });
    const again = await signIn(ctx, owner.email);
    expect((await me(again)).lastWorkspaceId).toBe(second.id);
  });

  it("applies the role of each workspace: an agent there can read it but not change it", async () => {
    const owner = await newOwner(ctx, "ws-roles");
    const agentEmail = uniqueEmail("ws-roles-agent");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: agentEmail,
      role: "agent",
    });
    const token = invitationTokenFor(ctx, agentEmail);
    // The agent also owns a workspace of their own.
    const agent = await signIn(ctx, agentEmail);
    const accepted = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, agent);
    expect(accepted.statusCode).toBe(200);
    const memberships = (await me(agent)).memberships;
    expect(memberships.map((m) => m.role).sort()).toEqual(["agent", "owner"]);

    const read = await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}`, agent);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ role: "agent" });
    const rename = await api(ctx, "PATCH", `/api/v1/workspaces/${owner.workspaceId}`, agent, {
      name: "Mine now",
    });
    expect(rename.statusCode).toBe(403);
    const byOwner = await api(
      ctx,
      "PATCH",
      `/api/v1/workspaces/${owner.workspaceId}`,
      owner.cookie,
      {
        name: "Casa Marco",
      },
    );
    expect(byOwner.json()).toMatchObject({ name: "Casa Marco", role: "owner" });
  });

  it("validates names and limits new workspaces to 5 per day", async () => {
    const owner = await newOwner(ctx, "ws-limit");
    const blank = await api(ctx, "POST", "/api/v1/workspaces", owner.cookie, { name: "   " });
    expect(blank.statusCode).toBe(422);
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await api(ctx, "POST", "/api/v1/workspaces", owner.cookie, { name: `WS ${i}` }))
          .statusCode,
      ).toBe(201);
    }
    const sixth = await api(ctx, "POST", "/api/v1/workspaces", owner.cookie, { name: "Too many" });
    expect(sixth.statusCode).toBe(429);
  });
});
