import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { signIn, systemQuery, totpCode, uniqueEmail } from "./helpers.js";
import { createTestApp, PORTAL_URL, updateCookies } from "./test-app.js";

/** Regression tests for the spec 001 security review (T103, checklists/security.md). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
const MINUTE = 60 * 1000;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

afterEach(() => {
  vi.useRealTimers();
});

function call(
  method: "GET" | "POST",
  url: string,
  cookie: string,
  payload?: object,
  headers: Record<string, string> = {},
) {
  return ctx.fastify.inject({
    method,
    url,
    headers: {
      origin: PORTAL_URL,
      cookie,
      ...(payload ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(payload ? { payload } : {}),
  });
}

/** Signs in and enrolls an authenticator app; returns the session cookie and otpauth URI. */
async function withTotp(prefix: string) {
  const email = uniqueEmail(prefix);
  let cookie = await signIn(ctx, email);
  const enable = await call("POST", "/api/auth/two-factor/enable", cookie, {});
  expect(enable.statusCode, enable.body).toBe(200);
  const { totpURI } = enable.json() as { totpURI: string };
  const verify = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
    code: totpCode(totpURI),
  });
  expect(verify.statusCode, verify.body).toBe(200);
  cookie = updateCookies(cookie, verify.headers["set-cookie"]);
  return { email, cookie, totpURI };
}

describe("unused library endpoints are off (T103 finding A1, A7)", () => {
  it("never returns the authenticator secret again, and offers no password or verify-email flows", async () => {
    const { cookie } = await withTotp("no-uri");
    for (const path of [
      "/api/auth/two-factor/get-totp-uri",
      "/api/auth/email-otp/check-verification-otp",
      "/api/auth/email-otp/request-password-reset",
      "/api/auth/forget-password/email-otp",
      "/api/auth/email-otp/reset-password",
      "/api/auth/update-user",
    ]) {
      expect((await call("POST", path, cookie, {})).statusCode, path).toBe(404);
    }
    const otherType = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin: PORTAL_URL, "content-type": "application/json" },
      payload: { email: uniqueEmail("type"), type: "forget-password" },
    });
    expect(otherType.statusCode).toBe(400);
  });
});

describe("changing sign-in factors (T103 finding A1)", () => {
  it("needs a recent re-authentication", async () => {
    const cookie = await signIn(ctx, uniqueEmail("factor-stale"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 11 * MINUTE));
    for (const path of [
      "/api/auth/two-factor/enable",
      "/api/auth/passkey/generate-register-options",
    ]) {
      const response = await call(path.includes("passkey") ? "GET" : "POST", path, cookie, {});
      expect(response.statusCode, path).toBe(403);
      expect(response.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    }
  });

  it("needs the existing second factor, not just an email code, once the user has one", async () => {
    const { email, totpURI } = await withTotp("factor-swap");
    // An attacker with access to the inbox signs in with an email code...
    const emailOnly = await signIn(ctx, email);
    for (const [method, path] of [
      ["POST", "/api/auth/two-factor/generate-backup-codes"],
      ["GET", "/api/auth/passkey/generate-register-options"],
      ["POST", "/api/auth/two-factor/disable"],
    ] as const) {
      const response = await call(method, path, emailOnly, method === "POST" ? {} : undefined);
      expect(response.statusCode, path).toBe(403);
      expect(response.json()).toMatchObject({ code: "SECOND_FACTOR_REQUIRED" });
    }
    // ...while the owner, after using the authenticator app, can manage factors.
    const stepUp = await call("POST", "/api/auth/two-factor/verify-totp", emailOnly, {
      code: totpCode(totpURI, Date.now() + 30_000),
    });
    expect(stepUp.statusCode, stepUp.body).toBe(200);
    const codes = await call("POST", "/api/auth/two-factor/generate-backup-codes", emailOnly, {});
    expect(codes.statusCode, codes.body).toBe(200);
  });

  it("revokes every other session when a factor is removed (FR-013)", async () => {
    const { email, cookie, totpURI } = await withTotp("factor-remove");
    const other = await signIn(ctx, email);
    const stepUp = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI, Date.now() + 30_000),
    });
    expect(stepUp.statusCode, stepUp.body).toBe(200);
    const disable = await call("POST", "/api/auth/two-factor/disable", cookie, {});
    expect(disable.statusCode, disable.body).toBe(200);
    const kept = updateCookies(cookie, disable.headers["set-cookie"]);
    expect((await call("GET", "/api/v1/me", kept)).statusCode).toBe(200);
    expect((await call("GET", "/api/v1/me", other)).statusCode).toBe(401);
  });
});

describe("session rotation is not a sign-in (T103 finding A3)", () => {
  it("keeps the original authentication time when enabling the authenticator app rotates the session", async () => {
    const email = uniqueEmail("rotation");
    let cookie = await signIn(ctx, email);
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(start + 9 * MINUTE));
    const enable = await call("POST", "/api/auth/two-factor/enable", cookie, {});
    expect(enable.statusCode, enable.body).toBe(200);
    const { totpURI } = enable.json() as { totpURI: string };
    const verify = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI, start + 9 * MINUTE),
    });
    expect(verify.statusCode, verify.body).toBe(200);
    cookie = updateCookies(cookie, verify.headers["set-cookie"]);

    // 11 minutes after the sign-in, the rotated session is no longer fresh.
    vi.setSystemTime(new Date(start + 11 * MINUTE));
    expect((await call("GET", "/api/probe/sensitive", cookie)).statusCode).toBe(403);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event e JOIN "user" u ON u.id = e.actor_user_id
       WHERE u.email = $1 AND e.type = 'signin.succeeded'`,
      [email],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });
});

describe("second-factor lockout (T103 finding A4, AC-SEC-001)", () => {
  it("blocks the authenticator app after 5 wrong codes and emails the owner", async () => {
    const { email, cookie, totpURI } = await withTotp("totp-lock");
    for (let i = 0; i < 5; i += 1) {
      const wrong = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
        code: "000000",
      });
      expect(wrong.statusCode).toBe(401);
    }
    const right = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI, Date.now() + 30_000),
    });
    expect(right.statusCode).toBe(429);
    const jobs = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'email.send' AND data->>'to' = $1 AND data->>'template' = 'auth.lockout'`,
      [email],
    );
    expect(jobs.rowCount).toBe(1);
  });

  it("counts parallel wrong step-up codes without losing any (atomic counter)", async () => {
    const email = uniqueEmail("parallel");
    const cookie = await signIn(ctx, email);
    const sent = await call("POST", "/api/v1/me/step-up/challenge", cookie, {
      method: "email_otp",
    });
    expect(sent.statusCode).toBe(202);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        call("POST", "/api/v1/me/step-up/verify", cookie, { method: "email_otp", code: "000000" }),
      ),
    );
    const challenge = await db.query<{ attempts: number }>(
      `SELECT c.attempts FROM step_up_challenge c JOIN "user" u ON u.id = c.user_id WHERE u.email = $1`,
      [email],
    );
    expect(challenge.rows[0]?.attempts).toBeLessThanOrEqual(5);
    const lock = await db.query<{ locked: boolean }>(
      `SELECT locked_until > now() AS locked FROM auth_lockout l JOIN "user" u ON l.key = 'user:' || u.id WHERE u.email = $1`,
      [email],
    );
    expect(lock.rows[0]?.locked).toBe(true);
  });
});

describe("request hardening (T103 findings A10, D1, D4)", () => {
  it("refuses cross-origin and form-encoded state changes", async () => {
    const cookie = await signIn(ctx, uniqueEmail("csrf"));
    const crossOrigin = await call(
      "POST",
      "/api/v1/me/step-up/challenge",
      cookie,
      { method: "email_otp" },
      { origin: "https://guide.example.com" },
    );
    expect(crossOrigin.statusCode).toBe(403);
    const sameSite = await call(
      "POST",
      "/api/v1/me/step-up/challenge",
      cookie,
      { method: "email_otp" },
      { "sec-fetch-site": "same-site" },
    );
    expect(sameSite.statusCode).toBe(403);
    const form = await ctx.fastify.inject({
      method: "POST",
      url: "/api/v1/me/step-up/challenge",
      headers: {
        origin: PORTAL_URL,
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "method=email_otp",
    });
    expect(form.statusCode).toBe(415);
  });

  it("sends security headers and no-store on API responses", async () => {
    const cookie = await signIn(ctx, uniqueEmail("headers"));
    const response = await call("GET", "/api/v1/me", cookie);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("serves a burst of concurrent signed-in requests without exhausting the pool", async () => {
    const cookie = await signIn(ctx, uniqueEmail("burst"));
    const responses = await Promise.all(
      Array.from({ length: 40 }, () => call("GET", "/api/v1/me", cookie)),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
  }, 20_000);
});
