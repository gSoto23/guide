import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { OnboardingReportService } from "../../src/account/onboarding-report.js";
import { signIn, uniqueEmail } from "./helpers.js";
import { createTestApp, PORTAL_URL } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
});

describe("onboarding report (T046, FR-006)", () => {
  it("counts answers in aggregate without personal data", async () => {
    const service = ctx.app.get(OnboardingReportService);
    const before = await service.aggregate();
    const cookie = await signIn(ctx, uniqueEmail("report"));
    await ctx.fastify.inject({
      method: "PUT",
      url: "/api/v1/me/onboarding",
      headers: { origin: PORTAL_URL, cookie, "content-type": "application/json" },
      payload: { propertiesBucket: "3_10", pms: "beds24" },
    });
    const after = await service.aggregate();
    expect(after.total).toBe(before.total + 1);
    expect(after.byPms.beds24).toBe((before.byPms.beds24 ?? 0) + 1);
    expect(after.byPath.manager).toBe((before.byPath.manager ?? 0) + 1);
    expect(JSON.stringify(after)).not.toMatch(/@/);
  });
});
