import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { signIn, uniqueEmail } from "./helpers.js";
import { createTestApp, PORTAL_URL } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
});

afterEach(() => {
  vi.useRealTimers();
});

function call(method: "GET" | "POST", url: string, cookie: string, payload?: object) {
  return ctx.fastify.inject({
    method,
    url,
    headers: {
      origin: PORTAL_URL,
      cookie,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { payload } : {}),
  });
}

describe("step-up re-authentication (T049, FR-011)", () => {
  it("allows sensitive actions right after sign-in, then requires re-authentication after 10 minutes", async () => {
    const email = uniqueEmail("stepup");
    const cookie = await signIn(ctx, email);
    expect((await call("GET", "/api/probe/sensitive", cookie)).statusCode).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
    const blocked = await call("GET", "/api/probe/sensitive", cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "step_up_required", methods: ["email_otp"] });

    const challenge = await call("POST", "/api/v1/me/step-up/challenge", cookie, {
      method: "email_otp",
    });
    expect(challenge.statusCode, challenge.body).toBe(202);
    const code = ctx.email.lastCodeFor(email);

    const verify = await call("POST", "/api/v1/me/step-up/verify", cookie, {
      method: "email_otp",
      code,
    });
    expect(verify.statusCode, verify.body).toBe(200);
    expect(verify.json()).toHaveProperty("strongAuthAt");
    expect((await call("GET", "/api/probe/sensitive", cookie)).statusCode).toBe(200);
  });

  it("rejects a wrong code and locks after 5 failures (AC-SEC-001)", async () => {
    const email = uniqueEmail("stepup-wrong");
    const cookie = await signIn(ctx, email);
    await call("POST", "/api/v1/me/step-up/challenge", cookie, { method: "email_otp" });
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push(
        (
          await call("POST", "/api/v1/me/step-up/verify", cookie, {
            method: "email_otp",
            code: "000000",
          })
        ).statusCode,
      );
    }
    expect(statuses.slice(0, 5).every((status) => status === 403)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("removing a second factor needs step-up (FR-011)", () => {
  it("refuses to disable the authenticator app 10 minutes after sign-in", async () => {
    const { totpCode } = await import("./helpers.js");
    const { cookieHeader } = await import("./test-app.js");
    const email = uniqueEmail("disable-2fa");
    let cookie = await signIn(ctx, email);
    const enable = await call("POST", "/api/auth/two-factor/enable", cookie, {});
    const { totpURI } = enable.json() as { totpURI: string };
    const verify = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI),
    });
    const rotated = cookieHeader(verify.headers["set-cookie"]);
    if (rotated.includes("guidesk.session_token=")) cookie = rotated;

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
    const disable = await call("POST", "/api/auth/two-factor/disable", cookie, {});
    expect(disable.statusCode).toBe(403);
    expect(disable.body).toContain("STEP_UP_REQUIRED");
  });
});
