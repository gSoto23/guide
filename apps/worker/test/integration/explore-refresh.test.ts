import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  experience,
  experienceDestination,
  experienceRefresh,
  exploreSettings,
  property,
  type DbHandle,
} from "@guidesk/db";
import {
  createExperiencePartner,
  ExperiencePartnerError,
  parseCuratedCatalog,
  type ExperiencePartnerPort,
  type ExperienceSearch,
  type PartnerExperience,
} from "@guidesk/integrations";
import { runExploreRefresh } from "../../src/jobs/explore-refresh.js";
import { seed, useChatDb } from "./chat-helpers.js";

/**
 * The Explore refresh (feature 009 T008, T022, T030; research R2, R4, R5): active destinations, the
 * Viator mapping, both languages kept at most an hour, dropped products, failures that keep rows
 * until they expire, the skip after three failures, curated pins, and cleanup. Synthetic partner data.
 */
let handle: DbHandle;
const fixtures = () =>
  createExperiencePartner({
    mode: "fixtures",
    viatorApiKey: null,
    viatorApiUrl: "https://api.viator.com/partner",
    civitatisAffiliateId: null,
  })!;
const empty = parseCuratedCatalog({ destinations: {} });

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

async function propertyIn(city: string | null, region: string | null = null) {
  const s = await seed();
  await handle.db.update(property).set({ city, region }).where(eq(property.id, s.propertyId));
  return s;
}

async function rows(key: string) {
  return handle.db
    .select()
    .from(experience)
    .where(eq(experience.destinationKey, key))
    .orderBy(experience.language, experience.productId);
}

/** Delegates to the fixtures, with a search the test can change between runs. */
class ScriptedPartner implements ExperiencePartnerPort {
  readonly partner = "viator" as const;
  private readonly inner = fixtures();
  search: (input: ExperienceSearch) => Promise<PartnerExperience[]> = (input) =>
    this.inner.search(input);
  destinations = () => this.inner.destinations();
  tags = () => this.inner.tags();
}

describe("explore.refresh (feature 009 US1, US4)", () => {
  it("stores Spanish and English results for an active destination, mapped by city, for an hour", async () => {
    await propertyIn("Tamarindo");
    const now = new Date("2026-11-18T12:00:00Z");
    const report = await runExploreRefresh({
      db: handle.db,
      partner: fixtures(),
      curated: empty,
      now: () => now,
    });
    expect(report.failed).toBe(0);
    const stored = await rows("cr:tamarindo");
    expect(stored.filter((row) => row.language === "es")).toHaveLength(14);
    expect(stored.filter((row) => row.language === "en")).toHaveLength(14);
    const first = stored.find((row) => row.productId === "FX902P2" && row.language === "es")!;
    expect(first).toMatchObject({
      category: "water",
      title: "Crucero en catamarán al atardecer",
      priceFrom: 95,
      currency: "USD",
      rating: 4.9,
      reviewCount: 860,
      durationMinutes: 210,
    });
    expect(first.expiresAt.getTime() - now.getTime()).toBe(60 * 60_000);
    expect(first.partnerUrl).toMatch(/^https:\/\/www\.viator\.com\//);
    const categories = new Map(stored.map((row) => [row.productId, row.category]));
    expect(categories.get("FX902P1")).toBe("outdoor");
    expect(categories.get("FX902P3")).toBe("food_drink");
    expect(categories.get("FX902P6")).toBe("day_trips");
    expect(categories.get("FX902P8")).toBe("culture");
    expect(categories.get("FX902P12")).toBe("other");
    const [destination] = await handle.db
      .select()
      .from(experienceDestination)
      .where(eq(experienceDestination.key, "cr:tamarindo"));
    expect(destination).toMatchObject({
      country: "CR",
      city: "Tamarindo",
      viatorDestinationId: "902",
    });
    const [refresh] = await handle.db
      .select()
      .from(experienceRefresh)
      .where(eq(experienceRefresh.destinationKey, "cr:tamarindo"));
    expect(refresh).toMatchObject({ failures: 0, lastError: null });
  });

  it("falls back to the region, stores nothing without coverage, and honors curated pins", async () => {
    await propertyIn("Playa Pelada", "Guanacaste");
    await propertyIn("Pueblo Inventado");
    await propertyIn("Otro Lugar Inventado");
    const curated = parseCuratedCatalog({
      destinations: { "cr:otro-lugar-inventado": { viatorDestinationId: "903" } },
    });
    await runExploreRefresh({ db: handle.db, partner: fixtures(), curated });
    const keys = await handle.db.select().from(experienceDestination);
    const byKey = new Map(keys.map((row) => [row.key, row.viatorDestinationId]));
    expect(byKey.get("cr:playa-pelada")).toBe("910");
    expect(byKey.get("cr:pueblo-inventado")).toBeNull();
    expect(byKey.get("cr:otro-lugar-inventado")).toBe("903");
    expect(await rows("cr:pueblo-inventado")).toEqual([]);
    expect((await rows("cr:otro-lugar-inventado")).length).toBeGreaterThan(0);
  });

  it("ignores properties without a city or with experiences off, and does nothing without a partner", async () => {
    await propertyIn(null);
    const off = await propertyIn("Nosara");
    await handle.db
      .insert(exploreSettings)
      .values({ workspaceId: off.workspaceId, experiencesEnabled: false });
    const report = await runExploreRefresh({ db: handle.db, partner: fixtures(), curated: empty });
    const keys = (await handle.db.select().from(experienceDestination)).map((row) => row.key);
    expect(keys).not.toContain("cr:nosara");
    expect(report.destinations).toBeGreaterThan(0);
    const none = await runExploreRefresh({ db: handle.db, partner: null, curated: empty });
    expect(none.searched).toBe(0);
  });

  it("drops products the partner no longer lists and updates the rest", async () => {
    await propertyIn("Santa Teresa");
    const partner = new ScriptedPartner();
    await runExploreRefresh({ db: handle.db, partner, curated: empty });
    expect((await rows("cr:santa-teresa")).filter((row) => row.language === "en")).toHaveLength(14);
    const original = partner.search;
    partner.search = async (input) => {
      const found = await original(input);
      if (input.destinationId !== "905") return found;
      return found.slice(0, 2).map((item) => ({ ...item, priceFrom: 1 }));
    };
    await runExploreRefresh({ db: handle.db, partner, curated: empty });
    const after = (await rows("cr:santa-teresa")).filter((row) => row.language === "en");
    expect(after.map((row) => row.productId)).toEqual(["FX905P1", "FX905P2"]);
    expect(after.every((row) => row.priceFrom === 1)).toBe(true);
  });

  it("keeps rows until they expire when the partner fails, records the code, and skips after three failures", async () => {
    await propertyIn("La Fortuna");
    await runExploreRefresh({ db: handle.db, partner: fixtures(), curated: empty });
    const before = await rows("cr:la-fortuna");
    expect(before.length).toBeGreaterThan(0);
    const failing = new ScriptedPartner();
    failing.search = () => Promise.reject(new ExperiencePartnerError("http_5xx"));
    const report = await runExploreRefresh({ db: handle.db, partner: failing, curated: empty });
    expect(report.failed).toBe(3);
    // Destinations visited after the third failure are skipped; uncovered ones need no search.
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect(report.failed + report.skipped).toBeLessThanOrEqual(report.destinations);
    const after = await rows("cr:la-fortuna");
    expect(after.map((row) => row.expiresAt.getTime())).toEqual(
      before.map((row) => row.expiresAt.getTime()),
    );
    const failed = await handle.db
      .select()
      .from(experienceRefresh)
      .where(
        and(eq(experienceRefresh.partner, "viator"), eq(experienceRefresh.lastError, "http_5xx")),
      );
    expect(failed).toHaveLength(3);
    expect(failed.every((row) => row.failures >= 1)).toBe(true);
  });

  it("deletes rows a day after they expire", async () => {
    await propertyIn("San José");
    const old = new Date("2026-11-10T00:00:00Z");
    await runExploreRefresh({ db: handle.db, partner: fixtures(), curated: empty, now: () => old });
    expect((await rows("cr:san-jose")).length).toBeGreaterThan(0);
    const report = await runExploreRefresh({ db: handle.db, partner: null, curated: empty });
    expect(report.cleaned).toBeGreaterThan(0);
    expect(await rows("cr:san-jose")).toEqual([]);
  });
});
