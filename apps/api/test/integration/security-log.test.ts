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

type Page = {
  events: { type: string; actor: { email: string } | null }[];
  nextCursor: string | null;
};

describe("security log (T090, T098, FR-030)", () => {
  it("is append-only, even for the system connection", async () => {
    const owner = await newOwner(ctx, "log-append");
    for (const statement of [
      `UPDATE security_event SET outcome = 'failure' WHERE workspace_id = $1`,
      `DELETE FROM security_event WHERE workspace_id = $1`,
    ]) {
      await expect(db.query(statement, [owner.workspaceId])).rejects.toThrow(/append-only/);
    }
  });

  it("shows owners their workspace's events with the actor, and refuses agents", async () => {
    const owner = await newOwner(ctx, "log-owner");
    const agent = await addMember(ctx, owner, "agent", "log-agent");
    const url = `/api/v1/workspaces/${owner.workspaceId}/security-events`;
    const page = (await api(ctx, "GET", url, owner.cookie)).json() as Page;
    expect(page.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["workspace.created", "invitation.sent", "invitation.accepted"]),
    );
    expect(page.events.find((e) => e.type === "invitation.sent")?.actor?.email).toBe(owner.email);
    expect((await api(ctx, "GET", url, agent.cookie)).statusCode).toBe(403);

    const filtered = (
      await api(ctx, "GET", `${url}?type=invitation.sent`, owner.cookie)
    ).json() as Page;
    expect(filtered.events.every((e) => e.type === "invitation.sent")).toBe(true);
  });

  it("pages with a cursor and shows each user only their own account events", async () => {
    const owner = await newOwner(ctx, "log-mine");
    await signIn(ctx, owner.email); // a second account-level event
    const first = (
      await api(ctx, "GET", "/api/v1/me/security-events?limit=1", owner.cookie)
    ).json() as Page;
    expect(first.events).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await api(
        ctx,
        "GET",
        `/api/v1/me/security-events?limit=1&cursor=${first.nextCursor}`,
        owner.cookie,
      )
    ).json() as Page;
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).not.toEqual(first.events[0]);
    const all = (await api(ctx, "GET", "/api/v1/me/security-events", owner.cookie)).json() as Page;
    expect(all.events.every((e) => e.actor === null)).toBe(true);
    expect(all.events.map((e) => e.type)).not.toContain("workspace.created");
  });
});
