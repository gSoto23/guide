import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShareOverview } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, guideApi, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Guide opens (feature 004 US6, T060): counts per property, day, and link kind, automated user
 * agents ignored, a per-address cap, and no identifiers stored.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestopens");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const open = (kind: "property" | "stay", userAgent = PHONE, ip?: string) =>
  guest(ctx, "POST", "/api/v1/guest/opens", {
    payload: { publicId: published.publicId, kind },
    headers: { "user-agent": userAgent, ...(ip ? { "x-forwarded-for": ip } : {}) },
  });

describe("guide opens (feature 004 US6)", () => {
  it("counts opens per property, day, and kind, with counts only (FR-049, FR-050)", async () => {
    for (const kind of ["property", "property", "stay"] as const) {
      expect((await open(kind)).statusCode).toBe(204);
    }
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM guide_open_daily WHERE property_id = $1 ORDER BY link_kind`,
      [published.propertyId],
    );
    expect(rows.map((row) => [row.link_kind, row.opens])).toEqual([
      ["property", 2],
      ["stay", 1],
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["day", "link_kind", "opens", "property_id", "workspace_id"].sort(),
    );
  });

  it("ignores link previews, crawlers, and monitoring", async () => {
    for (const agent of [
      "WhatsApp/2.23.20",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "curl/8.4.0",
    ]) {
      expect((await open("property", agent)).statusCode).toBe(204);
    }
    const { rows } = await db.query<{ opens: number }>(
      `SELECT opens FROM guide_open_daily WHERE property_id = $1 AND link_kind = 'property'`,
      [published.propertyId],
    );
    expect(rows[0]?.opens).toBe(2);
  });

  it("ignores more than 60 opens per address per hour", async () => {
    for (let attempt = 0; attempt < 62; attempt++) await open("stay", PHONE, "10.200.1.1");
    const { rows } = await db.query<{ opens: number }>(
      `SELECT opens FROM guide_open_daily WHERE property_id = $1 AND link_kind = 'stay'`,
      [published.propertyId],
    );
    expect(rows[0]?.opens).toBe(61);
  });

  it("shows the last 30 days on the Share screen (FR-051)", async () => {
    const overview = (
      await guideApi(ctx, team.agent, team, published.propertyId, "GET", "/share")
    ).json() as ShareOverview;
    expect(overview.opensLast30Days).toBe(63);
  });
});
