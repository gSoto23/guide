import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, systemQuery, uniqueEmail } from "./helpers.js";
import { createTestApp } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
  await db.close();
});

async function workspacesOf(email: string) {
  return db.query<{
    workspace_id: string;
    role: string;
    name: string;
    last_workspace_id: string | null;
  }>(
    `SELECT m.workspace_id, m.role, w.name, u.last_workspace_id
       FROM "user" u JOIN membership m ON m.user_id = u.id JOIN workspace w ON w.id = m.workspace_id
      WHERE u.email = $1`,
    [email],
  );
}

describe("sign-up creates a workspace (T031, FR-004)", () => {
  it("creates exactly one workspace with the new user as owner on first sign-up", async () => {
    const email = uniqueEmail("ana");
    await signIn(ctx, email);

    const { rows } = await workspacesOf(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("owner");
    expect(rows[0]?.last_workspace_id).toBe(rows[0]?.workspace_id);

    const events = await db.query(
      `SELECT 1 FROM security_event WHERE type = 'workspace.created' AND workspace_id = $1`,
      [rows[0]?.workspace_id],
    );
    expect(events.rowCount).toBe(1);
  });

  it("does not create another workspace when the user signs in again", async () => {
    const email = uniqueEmail("marco");
    await signIn(ctx, email);
    await signIn(ctx, email);
    const { rows } = await workspacesOf(email);
    expect(rows).toHaveLength(1);
  });

  it("does not create a workspace for a sign-up that comes from an invitation (FR-020)", async () => {
    const email = uniqueEmail("invitee");
    await signIn(ctx, email, { "x-guidesk-invitation": "pending" });
    const { rows } = await workspacesOf(email);
    expect(rows).toHaveLength(0);
  });
});
