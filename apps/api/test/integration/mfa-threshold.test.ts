import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, totpCode, uniqueEmail } from "./helpers.js";
import { createTestApp, PORTAL_URL, updateCookies } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), {}, { propertyCount: 3 });
});

afterAll(async () => {
  await ctx.app.close();
});

function call(method: "GET" | "POST", url: string, cookie: string, payload?: object) {
  return ctx.fastify.inject({
    method,
    url,
    headers: { origin: PORTAL_URL, cookie, "content-type": "application/json" },
    payload: payload ?? {},
  });
}

async function workspaceOf(cookie: string): Promise<string> {
  const me = (
    await ctx.fastify.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } })
  ).json() as {
    lastWorkspaceId: string;
  };
  return me.lastWorkspaceId;
}

describe("MFA above the property threshold (T050, FR-009, AC-SEC-005)", () => {
  it("requires enrolling a second factor, then accepts the action once TOTP is verified", async () => {
    const email = uniqueEmail("mfa-owner");
    let cookie = await signIn(ctx, email);
    const workspaceId = await workspaceOf(cookie);

    const blocked = await call("POST", `/api/probe/workspaces/${workspaceId}/mfa`, cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "mfa_enrollment_required" });

    const enable = await call("POST", "/api/auth/two-factor/enable", cookie, {});
    expect(enable.statusCode, enable.body).toBe(200);
    const { totpURI } = enable.json() as { totpURI: string };
    const verify = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI),
    });
    expect(verify.statusCode, verify.body).toBe(200);
    cookie = updateCookies(cookie, verify.headers["set-cookie"]);

    // Enrolling proves nothing about who is signed in: it is not a second-factor check (T103).
    const stillBlocked = await call("POST", `/api/probe/workspaces/${workspaceId}/mfa`, cookie);
    expect(stillBlocked.statusCode).toBe(403);
    expect(stillBlocked.json()).toMatchObject({ code: "step_up_required", methods: ["totp"] });

    // The same code can't be used twice (ASVS 5.0 V6.5); the next one works.
    const replay = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI),
    });
    expect(replay.statusCode).toBe(401);
    const stepUp = await call("POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI, Date.now() + 30_000),
    });
    expect(stepUp.statusCode, stepUp.body).toBe(200);

    const allowed = await call("POST", `/api/probe/workspaces/${workspaceId}/mfa`, cookie);
    expect(allowed.statusCode, allowed.body).toBe(200);

    // A later email-code sign-in is not multi-factor until TOTP is verified again.
    let secondCookie = await signIn(ctx, email);
    const again = await call("POST", `/api/probe/workspaces/${workspaceId}/mfa`, secondCookie);
    expect(again.statusCode).toBe(403);
    expect(again.json()).toMatchObject({ code: "step_up_required", methods: ["totp"] });
    const verifyAgain = await call("POST", "/api/auth/two-factor/verify-totp", secondCookie, {
      code: totpCode(totpURI, Date.now() - 30_000),
    });
    expect(verifyAgain.statusCode, verifyAgain.body).toBe(200);
    secondCookie = updateCookies(secondCookie, verifyAgain.headers["set-cookie"]);
    expect(
      (await call("POST", `/api/probe/workspaces/${workspaceId}/mfa`, secondCookie)).statusCode,
    ).toBe(200);
  });

  it("does not require MFA in a workspace the caller does not belong to: it returns 404", async () => {
    const cookie = await signIn(ctx, uniqueEmail("mfa-stranger"));
    const other = await signIn(ctx, uniqueEmail("mfa-other"));
    const foreignWorkspace = await workspaceOf(other);
    const response = await call("POST", `/api/probe/workspaces/${foreignWorkspace}/mfa`, cookie);
    expect(response.statusCode).toBe(404);
  });
});
