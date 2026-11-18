import { describe, expect, it } from "vitest";
import {
  categoryForTags,
  destinationKey,
  effectiveExploreSettings,
  experienceRef,
  exploreVisible,
  groupByCategory,
  isPartnerUrl,
  matchPartnerDestination,
  normalizePlaceName,
  parseExperienceRef,
  partnerRedirectTarget,
  selectExperiences,
  type ExperienceCandidate,
  type ExperienceCategory,
} from "../../src/explore/index.js";

const candidate = (
  ref: string,
  category: ExperienceCategory,
  rating: number | null,
  reviewCount: number | null = 100,
): ExperienceCandidate => ({
  ref,
  partner: ref.startsWith("civitatis") ? "civitatis" : "viator",
  curated: ref.startsWith("civitatis"),
  category,
  rating,
  reviewCount,
});

const open = { experiencesEnabled: true, hiddenCategories: [], hiddenExperiences: [] };

describe("destination keys (research R5)", () => {
  it("normalizes country and city", () => {
    expect(destinationKey("CR", "Sámara")).toBe("cr:samara");
    expect(destinationKey("cr", "  La Fortuna de San Carlos ")).toBe("cr:la-fortuna-de-san-carlos");
    expect(destinationKey("MX", "Playa del Carmen!")).toBe("mx:playa-del-carmen");
    expect(normalizePlaceName("São Paulo — Centro")).toBe("sao-paulo-centro");
  });

  it("has no destination without a country or a city", () => {
    expect(destinationKey(null, "Sámara")).toBeNull();
    expect(destinationKey("CR", null)).toBeNull();
    expect(destinationKey("CR", "  ")).toBeNull();
    expect(destinationKey("Costa Rica", "Sámara")).toBeNull();
  });
});

describe("categories from partner tags (research R6)", () => {
  it("maps tags to the first matching category", () => {
    expect(categoryForTags(["Food Tours", "Tours"])).toBe("food_drink");
    expect(categoryForTags(["Catamaran Cruises"])).toBe("water");
    expect(categoryForTags(["Day Trips"])).toBe("day_trips");
    expect(categoryForTags(["Museum Tickets & Passes"])).toBe("culture");
    expect(categoryForTags(["Ziplining", "Adventure"])).toBe("outdoor");
    expect(categoryForTags(["City Tours"])).toBe("tours");
    expect(categoryForTags(["Spa"])).toBe("other");
    expect(categoryForTags([])).toBe("other");
  });
});

describe("refs and redirect targets (research R8)", () => {
  it("builds and parses refs, refusing anything else", () => {
    expect(experienceRef("viator", "12345P6")).toBe("viator-12345P6");
    expect(parseExperienceRef("viator-12345P6")).toEqual({
      partner: "viator",
      productId: "12345P6",
    });
    expect(parseExperienceRef("civitatis-samara-canopy")).toEqual({
      partner: "civitatis",
      productId: "samara-canopy",
    });
    for (const bad of [
      "other-1",
      "viator-",
      "viator-a/b",
      "viator-a?b",
      `viator-${"a".repeat(65)}`,
    ]) {
      expect(parseExperienceRef(bad), bad).toBeNull();
    }
  });

  it("allows only HTTPS partner hosts", () => {
    expect(isPartnerUrl("viator", "https://www.viator.com/tours/x?pid=P1")).toBe(true);
    expect(isPartnerUrl("viator", "http://www.viator.com/tours/x")).toBe(false);
    expect(isPartnerUrl("viator", "https://www.viator.com.evil.example/x")).toBe(false);
    expect(isPartnerUrl("viator", "https://evil.example/www.viator.com")).toBe(false);
    expect(isPartnerUrl("viator", "https://user@www.viator.com/x")).toBe(false);
    expect(isPartnerUrl("viator", "https://www.viator.com:8443/x")).toBe(false);
    expect(isPartnerUrl("civitatis", "https://www.viator.com/x")).toBe(false);
    expect(isPartnerUrl("viator", "javascript:alert(1)")).toBe(false);
  });

  it("adds the Civitatis affiliate number and refuses without an account", () => {
    expect(
      partnerRedirectTarget("civitatis", "https://www.civitatis.com/es/samara/canopy/", "10000"),
    ).toBe("https://www.civitatis.com/es/samara/canopy/?aid=10000");
    expect(
      partnerRedirectTarget("civitatis", "https://www.civitatis.com/es/samara/canopy/", null),
    ).toBeNull();
    expect(partnerRedirectTarget("viator", "https://www.viator.com/x?pid=P1", null)).toBe(
      "https://www.viator.com/x?pid=P1",
    );
    expect(partnerRedirectTarget("viator", "https://evil.example/x", null)).toBeNull();
  });
});

describe("host settings (research R10)", () => {
  const workspace = { experiencesEnabled: true, hiddenCategories: ["culture" as const] };

  it("uses the property's own settings, else the workspace default, else the defaults", () => {
    expect(effectiveExploreSettings(null, null)).toEqual({
      experiencesEnabled: true,
      hiddenCategories: [],
      hiddenExperiences: [],
    });
    expect(
      effectiveExploreSettings(workspace, {
        followsDefault: true,
        experiencesEnabled: false,
        hiddenCategories: ["water"],
        hiddenExperiences: ["viator-1"],
      }),
    ).toEqual({
      experiencesEnabled: true,
      hiddenCategories: ["culture"],
      hiddenExperiences: ["viator-1"],
    });
    expect(
      effectiveExploreSettings(workspace, {
        followsDefault: false,
        experiencesEnabled: false,
        hiddenCategories: ["water"],
        hiddenExperiences: [],
      }),
    ).toEqual({ experiencesEnabled: false, hiddenCategories: ["water"], hiddenExperiences: [] });
  });
});

describe("selection (FR-018, research R7)", () => {
  it("ranks by rating and reviews, at most 4 per category and 12 in total, in category order", () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => candidate(`viator-w${i}`, "water", 4.9 - i * 0.1)),
      ...Array.from({ length: 6 }, (_, i) => candidate(`viator-t${i}`, "tours", 4.8 - i * 0.1)),
      ...Array.from({ length: 6 }, (_, i) => candidate(`viator-o${i}`, "outdoor", 4.7 - i * 0.1)),
      candidate("viator-c0", "culture", 4.0),
    ];
    const picked = selectExperiences(many, open);
    expect(picked).toHaveLength(12);
    expect(picked.map((item) => item.ref)).toEqual([
      "viator-t0",
      "viator-t1",
      "viator-t2",
      "viator-t3",
      "viator-o0",
      "viator-o1",
      "viator-o2",
      "viator-o3",
      "viator-w0",
      "viator-w1",
      "viator-w2",
      "viator-w3",
    ]);
  });

  it("applies hidden categories and refs before the limit, and nothing when turned off", () => {
    const items = [
      candidate("viator-a", "water", 4.9),
      candidate("viator-b", "tours", 4.5),
      candidate("viator-c", "tours", 4.4),
    ];
    expect(
      selectExperiences(items, {
        ...open,
        hiddenCategories: ["water"],
        hiddenExperiences: ["viator-b"],
      }).map((item) => item.ref),
    ).toEqual(["viator-c"]);
    expect(selectExperiences(items, { ...open, experiencesEnabled: false })).toEqual([]);
  });

  it("puts curated entries first, then well-reviewed ones, and barely reviewed ones last, stably", () => {
    const items = [
      candidate("civitatis-x", "tours", null, null),
      candidate("viator-few", "tours", 5, 2),
      candidate("viator-good", "tours", 4.2, 500),
      candidate("viator-good", "tours", 4.2, 500),
    ];
    const once = selectExperiences(items, open).map((item) => item.ref);
    expect(once).toEqual(["civitatis-x", "viator-good", "viator-few"]);
    expect(selectExperiences([...items].reverse(), open).map((item) => item.ref)).toEqual(once);
  });

  it("groups in order and decides visibility", () => {
    const picked = selectExperiences(
      [candidate("viator-a", "water", 4.9), candidate("viator-b", "tours", 4.5)],
      open,
    );
    expect(groupByCategory(picked).map((group) => group.category)).toEqual(["tours", "water"]);
    expect(exploreVisible(0, 0)).toBe(false);
    expect(exploreVisible(1, 0)).toBe(true);
    expect(exploreVisible(0, 3)).toBe(true);
  });
});

describe("partner destinations (research R5)", () => {
  const destinations = [
    { id: "9", name: "Central America", type: "REGION", lookupId: "9" },
    { id: "900", name: "Costa Rica", type: "COUNTRY", lookupId: "9.900" },
    { id: "910", name: "Guanacaste", type: "REGION", lookupId: "9.900.910" },
    { id: "901", name: "Sámara", type: "CITY", lookupId: "9.900.910.901" },
    { id: "950", name: "Mexico", type: "COUNTRY", lookupId: "8.950" },
    { id: "951", name: "Samara", type: "CITY", lookupId: "8.950.951" },
  ];

  it("matches the city within the country, else the region", () => {
    expect(
      matchPartnerDestination(destinations, { country: "CR", city: "Samara", region: null }),
    ).toBe("901");
    expect(
      matchPartnerDestination(destinations, {
        country: "cr",
        city: "Nosara",
        region: "Guanacaste",
      }),
    ).toBe("910");
    expect(
      matchPartnerDestination(destinations, { country: "MX", city: "Sámara", region: null }),
    ).toBe("951");
    expect(
      matchPartnerDestination(destinations, { country: "CR", city: "Nowhere", region: null }),
    ).toBeNull();
    expect(
      matchPartnerDestination(destinations, { country: "PE", city: "Lima", region: null }),
    ).toBeNull();
    expect(
      matchPartnerDestination(destinations, { country: "??", city: "Lima", region: null }),
    ).toBeNull();
  });
});
