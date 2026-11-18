import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ASSISTANT_TOPICS, type PropertyAssistant } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Assistant settings timings (feature 007 T048, plan Performance Budget): reading and saving a
 * property's settings, p95 ≤ 300 ms at the origin over 20 requests each, with instructions and
 * chosen contacts in place.
 */
const RUNS = 20;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let url: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "assistant-perf");
  published = await publishedGuide(ctx, team);
  url = `/properties/${published.propertyId}/assistant`;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

describe("assistant settings timings (feature 007 plan)", () => {
  it("reads and saves a property's settings with p95 ≤ 300 ms", async () => {
    const reads: number[] = [];
    const writes: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      let started = performance.now();
      const current = await wsApi(ctx, team.owner, "GET", team.workspaceId, url);
      reads.push(performance.now() - started);
      expect(current.statusCode).toBe(200);
      const settings = current.json() as PropertyAssistant;
      const member = settings.members[0]!;
      started = performance.now();
      const saved = await wsApi(ctx, team.owner, "PUT", team.workspaceId, url, {
        version: settings.version,
        follows: { autonomy: false, tone: false, quietHours: false, contacts: false },
        own: {
          autonomy: Object.fromEntries(
            ASSISTANT_TOPICS.map((topic) => [topic, index % 2 ? "auto" : "full_auto"]),
          ),
          tone: index % 2 ? "formal" : "casual",
          quietHours: { enabled: true, start: "22:00", end: "07:00" },
          contacts: { mode: "selected", memberIds: [member.id] },
        },
        instructions: `Sugiere caminar a la playa (versión ${index}).`,
      });
      writes.push(performance.now() - started);
      expect(saved.statusCode, saved.body).toBe(200);
    }
    expect(percentile(reads, 95)).toBeLessThanOrEqual(300);
    expect(percentile(writes, 95)).toBeLessThanOrEqual(300);
  });
});
