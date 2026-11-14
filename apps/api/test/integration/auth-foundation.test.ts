import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { cookieHeader, createTestApp, PORTAL_URL } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
});

describe("auth foundation (T016–T020)", () => {
  it("serves the public health check", async () => {
    const response = await ctx.fastify.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rejects protected routes without a session, as problem+json", async () => {
    const response = await ctx.fastify.inject({ method: "GET", url: "/api/probe" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("signs in with an email one-time code and runs requests as guidesk_app", async () => {
    const email = "ana@example.com";
    const send = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin: PORTAL_URL, "content-type": "application/json" },
      payload: { email, type: "sign-in" },
    });
    expect(send.statusCode, send.body).toBe(200);
    const code = ctx.email.lastCodeFor(email);

    const signIn = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/sign-in/email-otp",
      headers: { origin: PORTAL_URL, "content-type": "application/json" },
      payload: { email, otp: code },
    });
    expect(signIn.statusCode).toBe(200);
    const setCookie = signIn.headers["set-cookie"];
    expect(String(setCookie)).toContain("guidesk.session_token=");
    expect(String(setCookie)).toMatch(/HttpOnly/i);
    expect(String(setCookie)).toMatch(/SameSite=Lax/i);

    const probe = await ctx.fastify.inject({
      method: "GET",
      url: "/api/probe",
      headers: { cookie: cookieHeader(setCookie) },
    });
    expect(probe.statusCode).toBe(200);
    const body = probe.json() as { userId: string; db: { role: string; user_id: string } };
    expect(body.db.role).toBe("guidesk_app");
    expect(body.db.user_id).toBe(body.userId);
  });

  it("rejects a wrong one-time code", async () => {
    const email = "emily@example.com";
    await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin: PORTAL_URL, "content-type": "application/json" },
      payload: { email, type: "sign-in" },
    });
    const correct = ctx.email.lastCodeFor(email);
    const wrong = correct === "000000" ? "111111" : "000000";
    const response = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/sign-in/email-otp",
      headers: { origin: PORTAL_URL, "content-type": "application/json" },
      payload: { email, otp: wrong },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(String(response.headers["set-cookie"] ?? "")).not.toContain("guidesk.session_token=");
  });
});
