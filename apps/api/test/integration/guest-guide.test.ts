import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestGuide, GuideView } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  guest,
  guideApi,
  LOCKBOX,
  publish,
  publishedGuide,
  WIFI_PASSWORD,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The public guide (feature 004 US1, T019): published content only, language choice, facts and
 * the Wi-Fi password resolved at view time, placeholders without values, benefit disclosures, the
 * cache policy, and one unavailable response for every case. All values are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let publicWifi: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestguide");
  published = await publishedGuide(ctx, team);
  publicWifi = await publishedGuide(ctx, team, { name: "Casa Abierta", publicWifi: true });
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const read = async (publicId: string, lang?: "es" | "en") => {
  const response = await guest(
    ctx,
    "GET",
    `/api/v1/guest/guides/${publicId}${lang ? `?lang=${lang}` : ""}`,
  );
  return { response, guide: response.json() as GuestGuide };
};

describe("public guide (feature 004 US1)", () => {
  it("serves the published version in the requested language with untranslated items marked", async () => {
    const { response, guide } = await read(published.publicId, "es");
    expect(response.statusCode, response.body).toBe(200);
    expect(guide.language).toBe("es");
    expect(guide.languages).toEqual(["es", "en"]);
    expect(guide.primaryLanguage).toBe("es");
    expect(guide.propertyName).toBe("Casa Colibrí");
    expect(guide.timeZone).toBe("America/Costa_Rica");
    expect(guide.emergencyNumber).toBe("911");
    expect(guide.facts).toMatchObject({
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
    });
    expect(guide.sections[0]?.kind).toBe("arrival");
    const rules = guide.sections.find((section) => section.kind === "house_rules")!;
    const english = rules.items.find((item) => item.kind === "text")!;
    expect(english).toMatchObject({ language: "en", translated: false });
    const english2 = (await read(published.publicId, "en")).guide;
    expect(english2.language).toBe("en");
    const arrival = english2.sections.find((section) => section.kind === "arrival")!;
    expect(arrival.items.find((item) => item.kind === "text")).toMatchObject({
      language: "es",
      translated: false,
    });
  });

  it("never carries a locked value; labels only, and the public Wi-Fi password when made public", async () => {
    const { response, guide } = await read(published.publicId);
    expect(response.body).not.toContain(LOCKBOX);
    expect(response.body).not.toContain(WIFI_PASSWORD);
    expect(guide.lockedFields.map((field) => field.id).sort()).toEqual(
      [published.lockboxId, published.wifiId].sort(),
    );
    expect(guide.lockedFields.every((field) => field.set)).toBe(true);
    expect(guide.wifi).toEqual({ fieldId: null, password: null });
    const open = await read(publicWifi.publicId);
    expect(open.guide.wifi).toEqual({ fieldId: publicWifi.wifiId, password: WIFI_PASSWORD });
    expect(open.guide.lockedFields.map((field) => field.id)).toEqual([publicWifi.lockboxId]);
    expect(open.response.body).not.toContain(LOCKBOX);
  });

  it("flags recommendations with a declared benefit (FR-008, PC-07)", async () => {
    const { guide } = await read(published.publicId);
    const tips = guide.sections.find((section) => section.kind === "local_recommendations")!;
    expect(tips.items[0]?.recommendation).toMatchObject({
      name: "Soda La Palma",
      benefit: true,
      benefitKind: "commission",
    });
  });

  it("shows draft edits only after publishing, and current facts without republishing (FR-003, FR-004)", async () => {
    const view = (
      await guideApi(ctx, team.owner, team, published.propertyId, "GET", "/guide")
    ).json() as GuideView;
    const rules = view.sections.find((section) => section.kind === "house_rules")!;
    const added = await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "POST",
      `/guide/sections/${rules.id}/items`,
      {
        revision: rules.revision,
        kind: "text",
        language: "es",
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Texto en borrador" }] }],
        },
      },
    );
    expect(added.statusCode, added.body).toBe(201);
    expect((await read(published.publicId)).response.body).not.toContain("Texto en borrador");
    await db.query(`UPDATE property SET check_in_time = '16:00' WHERE id = $1`, [
      published.propertyId,
    ]);
    expect((await read(published.publicId)).guide.facts.checkInTime).toBe("16:00");
    await publish(ctx, team, published.propertyId);
    expect((await read(published.publicId)).response.body).toContain("Texto en borrador");
  });

  it("is cacheable by the CDN, never indexed, and sends no referrer (R9, SEC-02)", async () => {
    const { response } = await read(published.publicId);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
    );
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("answers every unavailable case with the same body (FR-011, FR-054)", async () => {
    // A second workspace: the free plan allows two properties per workspace.
    const team2 = await seedTeam(ctx, db, "guestguide2");
    const other = await publishedGuide(ctx, team2, { name: "Casa Cerrada" });
    const unknown = await read("abcdefghijklmnopqrstuvwxyz");
    const malformed = await read("not-a-link");
    expect(unknown.response.statusCode).toBe(404);
    const body = unknown.response.body;
    expect(malformed.response.body).toBe(body);
    const unpublish = await guideApi(
      ctx,
      team2.owner,
      team2,
      other.propertyId,
      "POST",
      "/guide/unpublish",
    );
    expect(unpublish.statusCode, unpublish.body).toBeLessThan(300);
    const unpublished = await read(other.publicId);
    expect(unpublished.response.statusCode).toBe(404);
    expect(unpublished.response.body).toBe(body);
    expect(unpublished.response.body).not.toContain("Casa Cerrada");
    await publish(ctx, team2, other.propertyId);
    expect((await read(other.publicId)).response.statusCode).toBe(200);
    await db.query(
      `UPDATE property SET status = 'removed', removed_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`,
      [other.propertyId],
    );
    expect((await read(other.publicId)).response.body).toBe(body);
    // Restored within 30 days, the same link opens again (FR-056).
    await db.query(
      `UPDATE property SET status = 'active', removed_at = NULL, purge_after = NULL WHERE id = $1`,
      [other.propertyId],
    );
    expect((await read(other.publicId)).response.statusCode).toBe(200);
  });

  it("redirects media of the published version only", async () => {
    const missing = await guest(
      ctx,
      "GET",
      `/api/v1/guest/media/${published.publicId}/00000000-0000-4000-8000-000000000000/large`,
    );
    expect(missing.statusCode).toBe(404);
    const badVariant = await guest(
      ctx,
      "GET",
      `/api/v1/guest/media/${published.publicId}/00000000-0000-4000-8000-000000000000/huge`,
    );
    expect(badVariant.statusCode).toBe(404);
  });

  it("refuses guest writes from the portal origin (R2)", async () => {
    const response = await ctx.fastify.inject({
      method: "POST",
      url: "/api/v1/guest/opens",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      payload: { publicId: published.publicId, kind: "property" },
    });
    expect(response.statusCode).toBe(403);
  });
});
