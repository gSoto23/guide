import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { jsonHeaders, requestCode, signIn, uniqueEmail } from "./helpers.js";
import { createTestApp } from "./test-app.js";

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

async function verify(email: string, otp: string) {
  return ctx.fastify.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    headers: jsonHeaders,
    payload: { email, otp },
  });
}

describe("email one-time codes (T033, FR-002, AC-SEC-007)", () => {
  it("answers the same way for existing and unknown emails", async () => {
    const existing = uniqueEmail("existing");
    await signIn(ctx, existing);
    const forExisting = await requestCode(ctx, existing);
    const forUnknown = await requestCode(ctx, uniqueEmail("unknown"));
    expect(forExisting.statusCode).toBe(forUnknown.statusCode);
    expect(forExisting.body).toBe(forUnknown.body);
  });

  it("works only once", async () => {
    const email = uniqueEmail("once");
    await requestCode(ctx, email);
    const code = ctx.email.lastCodeFor(email);
    expect((await verify(email, code)).statusCode).toBe(200);
    expect((await verify(email, code)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("expires after 10 minutes", async () => {
    const email = uniqueEmail("expired");
    await requestCode(ctx, email);
    const code = ctx.email.lastCodeFor(email);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
    expect((await verify(email, code)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("sends the code in the requester's language", async () => {
    const email = uniqueEmail("english");
    await requestCode(ctx, email, { "accept-language": "en-US,en;q=0.9" });
    const message = ctx.email.sent.findLast((m) => m.to === email);
    expect(message?.template).toBe("auth.signin_code");
    expect(message?.subject).toMatch(/code/i);
    expect(message?.text).not.toMatch(/Tu código/);
  });
});
