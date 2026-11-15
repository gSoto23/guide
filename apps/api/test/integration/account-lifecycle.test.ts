import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, systemQuery, uniqueEmail } from "./helpers.js";
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

function latestCode(email: string, template: string): string {
  const message = [...ctx.email.sent]
    .reverse()
    .find((m) => m.to === email && m.template === template);
  return message?.text.match(/\b(\d{6})\b/)?.[1] ?? "";
}

describe("personal data (T089, T096, FR-028)", () => {
  it("exports the profile, memberships, and own events, without secrets", async () => {
    const owner = await newOwner(ctx, "export");
    const response = await api(ctx, "GET", "/api/v1/me/export", owner.cookie);
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["content-disposition"])).toContain("guidesk-export-");
    const data = response.json() as {
      profile: { email: string };
      memberships: { role: string }[];
      securityEvents: { type: string }[];
    };
    expect(data.profile.email).toBe(owner.email);
    expect(data.memberships).toEqual([expect.objectContaining({ role: "owner" })]);
    expect(data.securityEvents.map((e) => e.type)).toContain("signin.succeeded");
    expect(response.body).not.toMatch(/token|secret|code_hash|public_key/i);
  });

  it("blocks deletion while the user owns a workspace with other members", async () => {
    const owner = await newOwner(ctx, "del-shared");
    await addMember(ctx, owner, "agent", "del-shared-agent");
    const blocked = await api(ctx, "DELETE", "/api/v1/me", owner.cookie);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "owns_shared_workspace" });
  });

  it("schedules deletion, signs out everywhere, cancels on sign-in, and purges after 30 days", async () => {
    const solo = await newOwner(ctx, "del-solo");
    const scheduled = await api(ctx, "DELETE", "/api/v1/me", solo.cookie);
    expect(scheduled.statusCode, scheduled.body).toBe(202);
    expect((await api(ctx, "GET", "/api/v1/me", solo.cookie)).statusCode).toBe(401);

    // Coming back within 30 days keeps the account.
    const back = await signIn(ctx, solo.email);
    const status = await db.query<{ status: string }>(
      `SELECT r.status FROM account_deletion_request r JOIN "user" u ON u.id = r.user_id WHERE u.email = $1`,
      [solo.email],
    );
    expect(status.rows[0]?.status).toBe("cancelled");

    // Schedule again, then let 30 days pass.
    await api(ctx, "DELETE", "/api/v1/me", back);
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
      solo.email,
    ]);
    const userId = rows[0]?.id ?? "";
    await db.query(
      `UPDATE account_deletion_request SET purge_after = now() - interval '1 minute' WHERE user_id = $1`,
      [userId],
    );
    const purged = await db.query<{ pseudonym: string }>(`SELECT purge_account($1) AS pseudonym`, [
      userId,
    ]);
    const pseudonym = purged.rows[0]?.pseudonym ?? "";
    expect(pseudonym).toMatch(/^deleted:/);
    expect((await db.query(`SELECT 1 FROM "user" WHERE id = $1`, [userId])).rowCount).toBe(0);
    expect(
      (await db.query(`SELECT 1 FROM workspace WHERE id = $1`, [solo.workspaceId])).rowCount,
    ).toBe(0);
    expect(
      (await db.query(`SELECT 1 FROM security_event WHERE actor_user_id = $1`, [userId])).rowCount,
    ).toBe(0);
    expect(
      (await db.query(`SELECT 1 FROM security_event WHERE actor_user_id = $1`, [pseudonym]))
        .rowCount,
    ).toBeGreaterThan(0);
  });
});

describe("email change (T097, FR-029)", () => {
  it("verifies the new address, notifies the old one, and signs out other sessions", async () => {
    const user = await newOwner(ctx, "email-old");
    const otherDevice = await signIn(ctx, user.email);
    const newEmail = uniqueEmail("email-new");
    const requested = await api(ctx, "POST", "/api/v1/me/email-change", user.cookie, {
      newEmail: newEmail.toUpperCase(),
    });
    expect(requested.statusCode, requested.body).toBe(202);
    const code = latestCode(newEmail, "account.email_change_code");

    const wrong = await api(ctx, "POST", "/api/v1/me/email-change/confirm", user.cookie, {
      code: code === "000000" ? "111111" : "000000",
    });
    expect(wrong.statusCode).toBe(403);
    const confirmed = await api(ctx, "POST", "/api/v1/me/email-change/confirm", user.cookie, {
      code,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toEqual({ email: newEmail });

    expect((await api(ctx, "GET", "/api/v1/me", otherDevice)).statusCode).toBe(401);
    const me = (await api(ctx, "GET", "/api/v1/me", user.cookie)).json() as {
      user: { email: string };
    };
    expect(me.user.email).toBe(newEmail);
    const notice = await db.query(
      `SELECT 1 FROM pgboss.job WHERE data->>'to' = $1 AND data->>'template' = 'account.email_changed'`,
      [user.email],
    );
    expect(notice.rowCount).toBe(1);
    // The new address signs in to the same account.
    const again = await signIn(ctx, newEmail);
    const meAgain = (await api(ctx, "GET", "/api/v1/me", again)).json() as {
      lastWorkspaceId: string;
    };
    expect(meAgain.lastWorkspaceId).toBe(user.workspaceId);
  });

  it("refuses an address another account uses, only after its code is entered", async () => {
    const taken = await newOwner(ctx, "email-taken");
    const user = await newOwner(ctx, "email-wants");
    const requested = await api(ctx, "POST", "/api/v1/me/email-change", user.cookie, {
      newEmail: taken.email,
    });
    expect(requested.statusCode).toBe(202);
    const confirmed = await api(ctx, "POST", "/api/v1/me/email-change/confirm", user.cookie, {
      code: latestCode(taken.email, "account.email_change_code"),
    });
    expect(confirmed.statusCode).toBe(409);
    expect(confirmed.json()).toMatchObject({ code: "email_in_use" });
  });
});
