import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { RateLimitService } from "../../src/common/rate-limit.service.js";
import { createTestApp } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
});

describe("RateLimitService (T024)", () => {
  it("allows up to the limit within a window, then refuses with a retry delay", async () => {
    const limiter = ctx.app.get(RateLimitService);
    const key = `test:${Date.now()}`;
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await limiter.consume(key, 2, 3600));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[2]?.retryAfterSeconds).toBeGreaterThan(0);
    expect(results[2]?.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it("keeps separate counters per key", async () => {
    const limiter = ctx.app.get(RateLimitService);
    const first = await limiter.consume(`a:${Date.now()}`, 1, 60);
    const second = await limiter.consume(`b:${Date.now()}`, 1, 60);
    expect(first.allowed && second.allowed).toBe(true);
  });
});
