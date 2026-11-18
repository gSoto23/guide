import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuestExplore,
  GuestGuide,
  PropertyExplore,
  WorkspaceExplore,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Explore (feature 009 T009, T014, T018): the guest list with tips first and at most 12 grouped
 * experiences, language fallback, expired rows ignored, curated entries only with the affiliate
 * number; the guarded redirect and its counting; Explore opens; and the host settings with versions,
 * roles, and the security log. Synthetic partner data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
const KEY = "cr:samara";
const CATALOG = fileURLToPath(new URL("../fixtures/explore-catalog.json", import.meta.url));

const categories = ["tours", "food_drink", "outdoor", "water", "culture", "day_trips", "other"];

async function seedExperiences() {
  await db.query(
    `INSERT INTO experience_destination (key, country, city) VALUES ($1, 'CR', 'Sámara')
     ON CONFLICT (key) DO NOTHING`,
    [KEY],
  );
  await db.query(`DELETE FROM experience WHERE destination_key = $1`, [KEY]);
  // 16 Spanish products over the categories, plus English versions of the first 4, plus one
  // product only in English and one expired.
  for (let index = 0; index < 16; index += 1) {
    const image = index === 0;
    await db.query(
      `INSERT INTO experience (partner, product_id, destination_key, language, category, title,
         description, duration_minutes, price_from, currency, rating, review_count, image_url,
         image_width, image_height, partner_url, fetched_at, expires_at)
       VALUES ('viator', $1, $2, 'es', $3, $4, 'Texto con <b>etiquetas</b> y <script>x</script>', 120,
         50, 'USD', $5, 100, $6, $7, $8, $9, now(), now() + interval '1 hour')`,
      [
        `T${index}`,
        KEY,
        categories[index % 7],
        `Experiencia ${index}`,
        4.9 - index * 0.05,
        image ? "https://media.example-cdn.test/t0.jpg" : null,
        image ? 480 : null,
        image ? 320 : null,
        `https://www.viator.com/tours/Test/d901-T${index}?pid=P00000000&mcid=1&medium=api`,
      ],
    );
  }
  await db.query(
    `INSERT INTO experience (partner, product_id, destination_key, language, category, title,
       partner_url, fetched_at, expires_at, rating, review_count)
     VALUES ('viator', 'ONLYEN', $1, 'en', 'tours', 'Only in English',
       'https://www.viator.com/tours/Test/d901-ONLYEN', now(), now() + interval '1 hour', 5, 900),
            ('viator', 'OLD', $1, 'es', 'tours', 'Caducada',
       'https://www.viator.com/tours/Test/d901-OLD', now() - interval '2 hours', now() - interval '1 hour', 5, 9999)`,
    [KEY],
  );
}

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), {
    CIVITATIS_AFFILIATE_ID: "10000",
    EXPLORE_CATALOG_FILE: CATALOG,
  });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "explore");
  published = await publishedGuide(ctx, team);
  await seedExperiences();
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const exploreOf = async (lang = "es") => {
  const response = await guest(
    ctx,
    "GET",
    `/api/v1/guest/guides/${published.publicId}/explore?lang=${lang}`,
  );
  expect(response.statusCode, response.body).toBe(200);
  return { response, body: response.json() as GuestExplore };
};

describe("Explore for guests (feature 009 US1)", () => {
  it("shows the host's tips first, then at most 12 experiences grouped by category", async () => {
    const { response, body } = await exploreOf();
    expect(response.headers["cache-control"]).toContain("s-maxage=60");
    expect(body.city).toBe("Sámara");
    expect(body.disclosure).toBe("guidesk");
    expect(body.tips).toEqual([
      expect.objectContaining({ name: "Soda La Palma", benefit: true, benefitKind: "commission" }),
    ]);
    const cards = body.categories.flatMap((group) => group.experiences);
    expect(cards.length).toBe(12);
    expect(body.categories.map((group) => group.category)).toEqual(
      categories.filter((category) => body.categories.some((group) => group.category === category)),
    );
    expect(cards.every((card) => !("partnerUrl" in card))).toBe(true);
    expect(cards.map((card) => card.ref)).not.toContain("viator-OLD");
    expect(cards.find((card) => card.ref === "viator-ONLYEN")).toMatchObject({ language: "en" });
    expect(cards.find((card) => card.ref === "viator-T0")).toMatchObject({
      title: "Experiencia 0",
      image: { url: "https://media.example-cdn.test/t0.jpg", width: 480, height: 320 },
      language: "es",
    });
    expect(cards.find((card) => card.ref === "civitatis-samara-test-kayak")).toMatchObject({
      partnerName: "Civitatis",
      title: "Kayak de prueba",
    });
  });

  it("marks the guide's Explore tab visible and counts Explore opens", async () => {
    const guide = await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}?lang=es`);
    expect((guide.json() as GuestGuide).explore).toEqual({ visible: true });
    const opened = await guest(ctx, "POST", "/api/v1/guest/opens", {
      payload: { publicId: published.publicId, kind: "explore" },
      headers: { "user-agent": "Mozilla/5.0 (Test)" },
    });
    expect(opened.statusCode).toBe(204);
    const { rows } = await db.query<{ opens: number }>(
      `SELECT opens FROM explore_open_daily WHERE property_id = $1`,
      [published.propertyId],
    );
    expect(rows[0]?.opens).toBe(1);
  });

  it("redirects to the partner page with tracking and counts a marked click once", async () => {
    const go = (ref: string, query = "lang=es&c=1", agent = "Mozilla/5.0 (Test)") =>
      guest(
        ctx,
        "GET",
        `/api/v1/guest/guides/${published.publicId}/experiences/${ref}/go?${query}`,
        {
          headers: { "user-agent": agent },
        },
      );
    const viator = await go("viator-T0");
    expect(viator.statusCode).toBe(302);
    expect(viator.headers.location).toBe(
      "https://www.viator.com/tours/Test/d901-T0?pid=P00000000&mcid=1&medium=api",
    );
    expect(viator.headers["cache-control"]).toBe("no-store");
    expect(viator.headers["referrer-policy"]).toBe("no-referrer");
    const civitatis = await go("civitatis-samara-test-kayak", "lang=en");
    expect(civitatis.headers.location).toBe(
      "https://www.civitatis.com/es/samara/kayak-de-prueba/?aid=10000",
    );
    await go("viator-T0", "lang=es", "Mozilla/5.0 (Test)");
    await go("viator-T0", "lang=es&c=1", "facebookexternalhit/1.1");
    const { rows } = await db.query<{ ref: string; clicks: number; partner: string }>(
      `SELECT ref, clicks, partner FROM experience_click_daily WHERE property_id = $1 ORDER BY ref`,
      [published.propertyId],
    );
    expect(rows).toEqual([{ ref: "viator-T0", clicks: 1, partner: "viator" }]);
  });
});

describe("safe links (feature 009 US3, AC-SEC-001)", () => {
  const go = (path: string) =>
    guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}/experiences/${path}`, {
      headers: { "user-agent": "Mozilla/5.0 (Test)" },
    });

  it("sends every other ref back to Explore and ignores any destination parameter", async () => {
    const back = `/g/${published.publicId}/es/explore`;
    for (const path of [
      "viator-OLD/go?lang=es",
      "viator-NOPE/go?lang=es",
      "other-T0/go?lang=es",
      "viator-T0%2F..%2Fx/go",
      "viator-T15/go?lang=es",
    ]) {
      const response = await go(path);
      expect(response.statusCode, path).toBe(302);
      expect(response.headers.location, path).toBe(back);
    }
    const extra = await go(
      "viator-T0/go?lang=es&url=https%3A%2F%2Fevil.example%2F&next=//evil.example",
    );
    expect(extra.headers.location).toMatch(/^https:\/\/www\.viator\.com\//);
    const unknown = await guest(
      ctx,
      "GET",
      "/api/v1/guest/guides/aaaaaaaaaaaaaaaaaaaaaaaaaa/experiences/viator-T0/go",
    );
    expect(unknown.statusCode).toBe(302);
    expect(unknown.headers.location).toBe("/");
  });

  it("never redirects to a stored URL that isn't on the partner's hosts", async () => {
    await db.query(
      `UPDATE experience SET partner_url = 'https://evil.example/x' WHERE destination_key = $1 AND product_id = 'T1'`,
      [KEY],
    );
    const response = await go("viator-T1/go?lang=es");
    expect(response.headers.location).toBe(`/g/${published.publicId}/es/explore`);
    await db.query(
      `UPDATE experience SET partner_url = 'https://www.viator.com/tours/Test/d901-T1' WHERE destination_key = $1 AND product_id = 'T1'`,
      [KEY],
    );
  });
});

describe("host settings (feature 009 US2)", () => {
  it("hides categories and experiences per property and by workspace default, without republishing", async () => {
    const before = (await exploreOf()).body.categories.flatMap((group) => group.experiences);
    expect(before.some((card) => card.category === "water")).toBe(true);
    const property = (
      await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/properties/${published.propertyId}/explore`,
      )
    ).json() as PropertyExplore;
    expect(property).toMatchObject({ version: 0, followsDefault: true, visible: true });
    expect(property.destination).toEqual({ city: "Sámara", available: true });
    expect(property.experiences.filter((item) => item.shown)).toHaveLength(12);
    const saved = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/explore`,
      {
        version: 0,
        followsDefault: false,
        own: { experiencesEnabled: true, hiddenCategories: ["water"] },
        hiddenExperiences: ["viator-T0"],
      },
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const after = (await exploreOf()).body.categories.flatMap((group) => group.experiences);
    expect(after.some((card) => card.category === "water")).toBe(false);
    expect(after.map((card) => card.ref)).not.toContain("viator-T0");
    const stale = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/explore`,
      {
        version: 0,
        followsDefault: true,
        own: { experiencesEnabled: true, hiddenCategories: [] },
        hiddenExperiences: [],
      },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "settings_changed" });

    // Back to the workspace default, which turns experiences off: only tips remain.
    const workspaceDefault = await wsApi(ctx, team.admin, "PUT", team.workspaceId, "/explore", {
      version: 0,
      experiencesEnabled: false,
      hiddenCategories: [],
    });
    expect((workspaceDefault.json() as WorkspaceExplore).version).toBe(1);
    await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/explore`,
      {
        version: 1,
        followsDefault: true,
        own: { experiencesEnabled: true, hiddenCategories: ["water"] },
        hiddenExperiences: [],
      },
    );
    const off = (await exploreOf()).body;
    expect(off.categories).toEqual([]);
    expect(off.tips).toHaveLength(1);
    const events = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE workspace_id = $1 AND type = 'explore.settings_changed' ORDER BY occurred_at`,
      [team.workspaceId],
    );
    expect(events.rows.map((row) => row.metadata.scope)).toEqual([
      "property",
      "workspace",
      "property",
    ]);
    await wsApi(ctx, team.owner, "PUT", team.workspaceId, "/explore", {
      version: 1,
      experiencesEnabled: true,
      hiddenCategories: [],
    });
  });

  it("lets agents read but not change settings, and validates bodies", async () => {
    const read = await wsApi(ctx, team.agent, "GET", team.workspaceId, "/explore");
    expect(read.statusCode).toBe(200);
    const refused = await wsApi(ctx, team.agent, "PUT", team.workspaceId, "/explore", {
      version: 2,
      experiencesEnabled: false,
      hiddenCategories: [],
    });
    expect(refused.statusCode).toBe(403);
    const bad = await wsApi(ctx, team.owner, "PUT", team.workspaceId, "/explore", {
      version: 2,
      experiencesEnabled: true,
      hiddenCategories: ["nightlife"],
    });
    expect(bad.statusCode).toBe(422);
    const badRef = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/explore`,
      {
        version: 2,
        followsDefault: true,
        own: { experiencesEnabled: true, hiddenCategories: [] },
        hiddenExperiences: ["https://evil.example"],
      },
    );
    expect(badRef.statusCode).toBe(422);
  });
});
