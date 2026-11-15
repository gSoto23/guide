import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { jsonHeaders, requestCode, signIn, systemQuery, uniqueEmail } from "./helpers.js";
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

afterEach(() => {
  vi.useRealTimers();
});

describe("sign-in lockout (T048, AC-SEC-001)", () => {
  it("blocks sign-in for 15 minutes after 5 wrong codes and emails the account owner", async () => {
    const email = uniqueEmail("locked");
    await signIn(ctx, email);
    await requestCode(ctx, email);
    for (let i = 0; i < 5; i += 1) {
      const wrong = await ctx.fastify.inject({
        method: "POST",
        url: "/api/auth/sign-in/email-otp",
        headers: jsonHeaders,
        payload: { email, otp: "000000" },
      });
      expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    }

    const blocked = await requestCode(ctx, email);
    expect(blocked.statusCode).toBe(429);

    const events = await db.query(
      `SELECT 1 FROM security_event e JOIN "user" u ON u.id = e.actor_user_id WHERE u.email = $1 AND e.type = 'signin.locked'`,
      [email],
    );
    expect(events.rowCount).toBe(1);
    await vi.waitFor(async () => {
      const jobs = await db.query(
        `SELECT 1 FROM pgboss.job WHERE name = 'email.send' AND data->>'template' = 'auth.lockout' AND data->>'to' = $1`,
        [email],
      );
      expect(jobs.rowCount).toBe(1);
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000));
    expect((await requestCode(ctx, email)).statusCode).toBe(200);
  });

  it("answers the same for a locked unknown email, without sending anything", async () => {
    const email = uniqueEmail("locked-unknown");
    expect((await requestCode(ctx, email)).statusCode).toBe(200);
    for (let i = 0; i < 5; i += 1) {
      await ctx.fastify.inject({
        method: "POST",
        url: "/api/auth/sign-in/email-otp",
        headers: jsonHeaders,
        payload: { email, otp: "000000" },
      });
    }
    expect((await requestCode(ctx, email)).statusCode).toBe(429);
    const jobs = await db.query(`SELECT 1 FROM pgboss.job WHERE data->>'to' = $1`, [email]);
    expect(jobs.rowCount).toBe(0);
  });

  it("does not count guesses when no code is pending, so nobody can lock out a victim (T103)", async () => {
    const email = uniqueEmail("no-pending");
    for (let i = 0; i < 6; i += 1) {
      await ctx.fastify.inject({
        method: "POST",
        url: "/api/auth/sign-in/email-otp",
        headers: jsonHeaders,
        payload: { email, otp: "000000" },
      });
    }
    expect((await requestCode(ctx, email)).statusCode).toBe(200);
  });

  it("limits sign-in codes to 5 per hour per email, with the same answer for unknown emails (AC-SEC-008)", async () => {
    const email = uniqueEmail("send-limit");
    for (let i = 0; i < 5; i += 1) {
      expect((await requestCode(ctx, email)).statusCode).toBe(200);
    }
    expect((await requestCode(ctx, email)).statusCode).toBe(429);
  });
});
