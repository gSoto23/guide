import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { meResponseSchema, onboardingResponseSchema } from "@guidesk/contracts";
import { signIn, uniqueEmail } from "./helpers.js";
import { createTestApp, PORTAL_URL } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  cookie = await signIn(ctx, uniqueEmail("contract"));
});

afterAll(async () => {
  await ctx.app.close();
});

function call(method: "GET" | "PATCH" | "PUT", url: string, payload?: unknown, withCookie = true) {
  return ctx.fastify.inject({
    method,
    url,
    headers: {
      origin: PORTAL_URL,
      ...(withCookie ? { cookie } : {}),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

describe("GET/PATCH /api/v1/me (T034)", () => {
  it("requires a session", async () => {
    expect((await call("GET", "/api/v1/me", undefined, false)).statusCode).toBe(401);
  });

  it("returns the profile and memberships in the contract shape", async () => {
    const response = await call("GET", "/api/v1/me");
    expect(response.statusCode).toBe(200);
    const me = meResponseSchema.parse(response.json());
    expect(me.memberships).toHaveLength(1);
    expect(me.memberships[0]?.role).toBe("owner");
    expect(me.lastWorkspaceId).toBe(me.memberships[0]?.workspaceId);
  });

  it("updates the preferred language", async () => {
    expect((await call("PATCH", "/api/v1/me", { preferredLanguage: "en" })).statusCode).toBe(200);
    const me = meResponseSchema.parse((await call("GET", "/api/v1/me")).json());
    expect(me.user.preferredLanguage).toBe("en");
  });

  it("rejects unsupported languages and unknown fields", async () => {
    const bad = await call("PATCH", "/api/v1/me", { preferredLanguage: "fr" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: "validation_failed" });
    expect((await call("PATCH", "/api/v1/me", { isStaff: true })).statusCode).toBe(422);
  });
});

describe("GET/PUT /api/v1/me/onboarding (T034)", () => {
  it("returns empty answers on the individual path before onboarding", async () => {
    const onboarding = onboardingResponseSchema.parse(
      (await call("GET", "/api/v1/me/onboarding")).json(),
    );
    expect(onboarding).toMatchObject({
      propertiesBucket: null,
      path: "individual",
      skipped: false,
    });
  });

  it("stores answers and derives the manager path (FR-006)", async () => {
    const response = await call("PUT", "/api/v1/me/onboarding", {
      propertiesBucket: "10_plus",
      pms: "hostaway",
      country: "CR",
    });
    expect(response.statusCode).toBe(200);
    expect(onboardingResponseSchema.parse(response.json())).toMatchObject({
      path: "manager",
      country: "CR",
    });
  });

  it("accepts skipping every question", async () => {
    const response = await call("PUT", "/api/v1/me/onboarding", { skipped: true });
    expect(response.statusCode).toBe(200);
    expect(onboardingResponseSchema.parse(response.json()).skipped).toBe(true);
  });

  it("rejects invalid answers", async () => {
    const response = await call("PUT", "/api/v1/me/onboarding", { pms: "hostaway", pmsOther: "x" });
    expect(response.statusCode).toBe(422);
  });
});
