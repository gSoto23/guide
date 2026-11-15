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

const DAY = 24 * 60 * 60 * 1000;

async function probe(cookie: string) {
  return (await ctx.fastify.inject({ method: "GET", url: "/api/probe", headers: { cookie } }))
    .statusCode;
}

describe("sessions (T051, FR-013, FR-015)", () => {
  it("refuses a revoked session on its next request", async () => {
    const email = uniqueEmail("revoke");
    const phone = await signIn(ctx, email);
    const laptop = await signIn(ctx, email);
    const revoke = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/revoke-other-sessions",
      headers: { origin: PORTAL_URL, cookie: laptop, "content-type": "application/json" },
      payload: {},
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(await probe(phone)).toBe(401);
    expect(await probe(laptop)).toBe(200);
  });

  it("expires after 7 days without use", async () => {
    const cookie = await signIn(ctx, uniqueEmail("idle"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 8 * DAY));
    expect(await probe(cookie)).toBe(401);
  });

  it("expires 30 days after sign-in even with daily use (T060)", async () => {
    const cookie = await signIn(ctx, uniqueEmail("absolute"));
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let day = 1; day <= 29; day += 1) {
      vi.setSystemTime(new Date(start + day * DAY));
      expect(await probe(cookie)).toBe(200);
    }
    vi.setSystemTime(new Date(start + 31 * DAY));
    expect(await probe(cookie)).toBe(401);
  });
});
