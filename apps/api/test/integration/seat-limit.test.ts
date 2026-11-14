import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery, uniqueEmail } from "./helpers.js";
import { api, invitationsUrl, newOwner } from "./invitation-helpers.js";
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

describe("seat limit (T068, FR-021)", () => {
  it("blocks invitations once members and open invitations fill the seats", async () => {
    const owner = await newOwner(ctx, "seats");
    await db.query(`UPDATE workspace SET seat_limit = 2 WHERE id = $1`, [owner.workspaceId]);

    const first = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: uniqueEmail("seat-1"),
      role: "agent",
    });
    expect(first.statusCode).toBe(201);
    const blocked = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: uniqueEmail("seat-2"),
      role: "agent",
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "seat_limit_reached" });

    const list = (
      await api(ctx, "GET", invitationsUrl(owner.workspaceId), owner.cookie)
    ).json() as {
      seats: { used: number; limit: number };
    };
    expect(list.seats).toEqual({ used: 2, limit: 2 });

    // Revoking frees the seat.
    const { id } = first.json() as { id: string };
    await api(ctx, "DELETE", `${invitationsUrl(owner.workspaceId)}/${id}`, owner.cookie);
    const again = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: uniqueEmail("seat-3"),
      role: "agent",
    });
    expect(again.statusCode).toBe(201);
  });
});
