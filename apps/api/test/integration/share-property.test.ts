import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PropertyDetail, ShareOverview } from "@guidesk/contracts";
import { asksOffPlatform } from "@guidesk/domain";
import { systemQuery } from "./helpers.js";
import { guest, guideApi, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The Share screen's property part (feature 004 US1, T020): the property link for every member,
 * settings and stays for owners and admins only, regenerating, QR codes, and the templates.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "shareprop");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const share = (
  member: TeamWorkspace["owner"],
  suffix = "",
  method: "GET" | "POST" = "GET",
  body?: object,
) => guideApi(ctx, member, team, published.propertyId, method, `/share${suffix}`, body);

async function roleDenials(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
    [team.workspaceId],
  );
  return rows[0]?.count ?? 0;
}

describe("Share screen, property link (feature 004 US1)", () => {
  it("gives every member the same stable property link and the templates", async () => {
    const owner = (await share(team.owner)).json() as ShareOverview;
    const agent = (await share(team.agent)).json() as ShareOverview;
    expect(owner.published).toBe(true);
    expect(owner.propertyLink?.url).toBe(published.propertyLink);
    expect(agent.propertyLink?.url).toBe(published.propertyLink);
    expect(owner.propertyLink?.url).toMatch(/^http:\/\/127\.0\.0\.1:3001\/g\/[a-z2-7]{26}$/);
    for (const language of ["es", "en"] as const) {
      const template = owner.templates?.[language] ?? "";
      expect(template).toContain(published.propertyLink);
      expect(asksOffPlatform(template)).toBe(false);
    }
  });

  it("shows settings and stays to owners and admins only (FR-044)", async () => {
    const owner = (await share(team.owner)).json() as ShareOverview;
    const admin = (await share(team.admin)).json() as ShareOverview;
    const agent = (await share(team.agent)).json() as ShareOverview;
    expect(owner.settings).toEqual({ requireConfirmationCode: false });
    expect(admin.stays).toEqual([]);
    expect(agent.settings).toBeUndefined();
    expect(agent.stays).toBeUndefined();
  });

  it("serves the QR code as SVG and PNG downloads", async () => {
    const svg = await share(team.agent, "/qr.svg");
    expect(svg.statusCode).toBe(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    expect(svg.headers["content-disposition"]).toBe(
      'attachment; filename="casa-colibri-guide-qr.svg"',
    );
    expect(svg.body).toContain("<svg");
    const png = await share(team.owner, "/qr.png");
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.rawPayload.subarray(1, 4).toString()).toBe("PNG");
  });

  it("lets owners and admins regenerate the link; the old one stops working (FR-019)", async () => {
    const before = await roleDenials();
    const refused = await share(team.agent, "/property-link/regenerate", "POST", { confirm: true });
    expect(refused.statusCode).toBe(403);
    expect(await roleDenials()).toBeGreaterThan(before);
    const regenerated = await share(team.admin, "/property-link/regenerate", "POST", {
      confirm: true,
    });
    expect(regenerated.statusCode, regenerated.body).toBe(200);
    const url = (regenerated.json() as { url: string }).url;
    expect(url).not.toBe(published.propertyLink);
    const oldGuide = await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}`);
    expect(oldGuide.statusCode).toBe(404);
    const newGuide = await guest(ctx, "GET", `/api/v1/guest/guides/${url.split("/g/")[1]}`);
    expect(newGuide.statusCode).toBe(200);
    const { rows } = await db.query<{ type: string }>(
      `SELECT type FROM security_event WHERE workspace_id = $1 AND type = 'guide.property_link_regenerated'`,
      [team.workspaceId],
    );
    expect(rows).toHaveLength(1);
  });

  it("has no link, template, or QR before the first publish", async () => {
    const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      name: "Casa Nueva",
    });
    const propertyId = (created.json() as PropertyDetail).id;
    const overview = (
      await guideApi(ctx, team.owner, team, propertyId, "GET", "/share")
    ).json() as ShareOverview;
    expect(overview).toMatchObject({ published: false, propertyLink: null, templates: null });
    const qr = await guideApi(ctx, team.owner, team, propertyId, "GET", "/share/qr.svg");
    expect(qr.statusCode).toBe(409);
    expect(qr.json()).toMatchObject({ code: "guide_not_published" });
  });
});
