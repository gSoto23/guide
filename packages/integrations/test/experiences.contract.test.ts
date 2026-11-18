import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CuratedCatalogError,
  loadCuratedCatalog,
  parseCuratedCatalog,
} from "../src/experiences/curated.js";
import { createExperiencePartner, createViatorFixtureFetch } from "../src/experiences/fixtures.js";
import { ExperiencePartnerError } from "../src/experiences/port.js";
import { parseViatorProduct, ViatorAdapter } from "../src/experiences/viator.adapter.js";
import { loadIntegrationSettings } from "../src/settings.js";

/**
 * Viator basic access and the curated list (feature 009 T006, T007, research R1 to R3): the request
 * shape and headers, strict parsing of untrusted partner responses, error codes without bodies, the
 * fixture mode, and the curated file's validation. The partner is a fake `fetch`; data is synthetic.
 */
function partner(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const product = {
  productCode: "123456P7",
  title: "  Catamaran <b>sunset</b> cruise  ",
  description: "Sail along the coast.\nDrinks included.",
  images: [
    {
      isCover: true,
      variants: [
        { url: "https://media.example-cdn.test/img/75.jpg", width: 75, height: 75 },
        { url: "https://media.example-cdn.test/img/480.jpg", width: 480, height: 320 },
        { url: "https://media.example-cdn.test/img/720.jpg", width: 720, height: 480 },
      ],
    },
  ],
  reviews: { totalReviews: 312, combinedAverageRating: 4.8721 },
  duration: { fixedDurationInMinutes: 180 },
  pricing: { summary: { fromPrice: 79 }, currency: "USD" },
  productUrl:
    "https://www.viator.com/tours/Samara/Catamaran/d901-123456P7?pid=P00000000&mcid=1&medium=api",
  tags: [3, "x", 4],
  translationInfo: { containsMachineTranslatedText: true },
};

describe("Viator adapter (T006, research R1, R2)", () => {
  it("searches a destination with the key header, version, language, and a bounded count", async () => {
    const { requests, fetchImpl } = partner(200, { products: [product], totalCount: 1 });
    const adapter = new ViatorAdapter({ apiKey: "TEST-KEY-0000", fetch: fetchImpl });
    const found = await adapter.search({
      destinationId: "901",
      language: "es",
      currency: "USD",
      count: 80,
    });
    const [request] = requests;
    expect(request!.url).toBe("https://api.viator.com/partner/products/search");
    expect(request!.init.method).toBe("POST");
    const headers = request!.init.headers as Record<string, string>;
    expect(headers["exp-api-key"]).toBe("TEST-KEY-0000");
    expect(headers.accept).toBe("application/json;version=2.0");
    expect(headers["accept-language"]).toBe("es");
    expect(JSON.parse(String(request!.init.body))).toEqual({
      filtering: { destination: "901" },
      sorting: { sort: "DEFAULT" },
      pagination: { start: 1, count: 50 },
      currency: "USD",
    });
    expect(found).toEqual([
      {
        productId: "123456P7",
        title: "Catamaran <b>sunset</b> cruise",
        description: "Sail along the coast.\nDrinks included.",
        durationMinutes: 180,
        priceFrom: 79,
        currency: "USD",
        rating: 4.87,
        reviewCount: 312,
        image: { url: "https://media.example-cdn.test/img/480.jpg", width: 480, height: 320 },
        partnerUrl: product.productUrl,
        tagIds: [3, 4],
        machineTranslated: true,
      },
    ]);
  });

  it("drops products with unsafe links, bad codes, or no title, and images that aren't HTTPS", () => {
    expect(parseViatorProduct({ ...product, productUrl: "https://evil.example/x" })).toBeNull();
    expect(parseViatorProduct({ ...product, productUrl: "http://www.viator.com/x" })).toBeNull();
    expect(parseViatorProduct({ ...product, productCode: "../x" })).toBeNull();
    expect(parseViatorProduct({ ...product, title: " " })).toBeNull();
    expect(parseViatorProduct("not an object")).toBeNull();
    const noImage = parseViatorProduct({
      ...product,
      images: [
        { isCover: true, variants: [{ url: "http://x.test/a.jpg", width: 480, height: 320 }] },
      ],
    });
    expect(noImage!.image).toBeNull();
    const odd = parseViatorProduct({
      ...product,
      reviews: { combinedAverageRating: 9, totalReviews: -1 },
      pricing: { summary: { fromPrice: -5 }, currency: "usd" },
      duration: { fixedDurationInMinutes: 0 },
    });
    expect(odd).toMatchObject({
      rating: null,
      reviewCount: null,
      priceFrom: null,
      currency: null,
      durationMinutes: null,
    });
  });

  it("maps failures to codes and never exposes the body", async () => {
    for (const [status, code] of [
      [429, "http_429"],
      [503, "http_5xx"],
      [401, "http_4xx"],
    ] as const) {
      const { fetchImpl } = partner(status, { message: "secret detail TEST-0000" });
      const error = await new ViatorAdapter({ apiKey: "k", fetch: fetchImpl })
        .search({ destinationId: "1", language: "en", currency: "USD", count: 5 })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExperiencePartnerError);
      expect((error as ExperiencePartnerError).code).toBe(code);
      expect(String(error)).not.toContain("secret detail");
    }
    const invalid = partner(200, "<html>not json</html>");
    await expect(
      new ViatorAdapter({ apiKey: "k", fetch: invalid.fetchImpl }).search({
        destinationId: "1",
        language: "en",
        currency: "USD",
        count: 5,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    const hanging = (async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    await expect(
      new ViatorAdapter({ apiKey: "k", fetch: hanging, timeoutMs: 50 }).destinations(),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("reads destinations and tags, skipping malformed entries", async () => {
    const destinations = partner(200, {
      destinations: [
        {
          destinationId: 901,
          name: "Sámara",
          type: "CITY",
          lookupId: "9.900.910.901",
          parentDestinationId: 910,
        },
        { destinationId: "x", name: "Bad" },
        { destinationId: 5, name: "No lookup" },
      ],
    });
    expect(
      await new ViatorAdapter({ apiKey: "k", fetch: destinations.fetchImpl }).destinations(),
    ).toEqual([
      { id: "901", name: "Sámara", type: "CITY", parentId: "910", lookupId: "9.900.910.901" },
    ]);
    const tags = partner(200, {
      tags: [
        {
          tagId: 3,
          parentTagIds: [1],
          allNamesByLocale: { en: "Boat Tours", es: "Paseos en barco" },
        },
        { tagId: "x", allNamesByLocale: { en: "Bad" } },
      ],
    });
    expect(await new ViatorAdapter({ apiKey: "k", fetch: tags.fetchImpl }).tags()).toEqual([
      { id: 3, parentIds: [1], name: "Boat Tours" },
    ]);
  });
});

describe("fixture mode and settings (research R12)", () => {
  it("answers Viator from synthetic data and refuses every other host", async () => {
    const adapter = createExperiencePartner({
      mode: "fixtures",
      viatorApiKey: null,
      viatorApiUrl: "https://api.viator.com/partner",
      civitatisAffiliateId: null,
    })!;
    const cities = (await adapter.destinations()).filter((item) => item.type === "CITY");
    expect(cities.map((item) => item.name)).toContain("Sámara");
    const found = await adapter.search({
      destinationId: "901",
      language: "es",
      currency: "USD",
      count: 30,
    });
    expect(found.length).toBeGreaterThan(10);
    expect(found.every((item) => item.partnerUrl.includes("pid=P00000000"))).toBe(true);
    await expect(createViatorFixtureFetch()("https://example.com/")).rejects.toThrow(/no answer/);
  });

  it("turns Viator off without a key, and reads the settings", () => {
    expect(
      createExperiencePartner({
        mode: "live",
        viatorApiKey: null,
        viatorApiUrl: "https://api.viator.com/partner",
        civitatisAffiliateId: null,
      }),
    ).toBeNull();
    const base = {
      FEED_URL_PEPPER: "x".repeat(32),
      LOCAL_KMS_KEY: Buffer.alloc(32, 7).toString("base64"),
    };
    expect(
      loadIntegrationSettings({ ...base, VIATOR_API_KEY: "unset" }, { production: false })
        .experiences,
    ).toEqual({
      mode: "fixtures",
      viatorApiKey: null,
      viatorApiUrl: "https://api.viator.com/partner",
      civitatisAffiliateId: null,
      catalogFile: null,
    });
    expect(() =>
      loadIntegrationSettings({ ...base, CIVITATIS_AFFILIATE_ID: "abc" }, { production: false }),
    ).toThrow(/CIVITATIS_AFFILIATE_ID/);
    expect(() =>
      loadIntegrationSettings(
        { ...base, VIATOR_API_URL: "http://api.viator.test" },
        { production: false },
      ),
    ).toThrow(/VIATOR_API_URL/);
  });
});

describe("curated list (T007, research R3)", () => {
  const entry = {
    id: "samara-sample-kayak",
    url: "https://www.civitatis.com/es/samara/kayak-ejemplo/",
    category: "water",
    title: { es: "Kayak de ejemplo", en: "Sample kayak" },
    description: { es: "Entrada ficticia.", en: "A fictional entry." },
    durationMinutes: 120,
    priceFrom: 45,
    currency: "USD",
  };
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("parses valid entries and the repository file", async () => {
    const catalog = parseCuratedCatalog({
      destinations: { "cr:samara": { viatorDestinationId: "901", civitatis: [entry] } },
    });
    expect(catalog.get("cr:samara")).toEqual({ viatorDestinationId: "901", civitatis: [entry] });
    expect(loadCuratedCatalog().size).toBeGreaterThanOrEqual(0);
    const dir = await mkdtemp(join(tmpdir(), "guidesk-curated-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "c.json"),
      JSON.stringify({ destinations: { "cr:samara": { civitatis: [entry] } } }),
    );
    expect(loadCuratedCatalog(join(dir, "c.json")).get("cr:samara")!.civitatis).toHaveLength(1);
  });

  it("refuses unsafe or malformed entries", () => {
    const bad = (patch: Record<string, unknown>) => () =>
      parseCuratedCatalog({
        destinations: { "cr:samara": { civitatis: [{ ...entry, ...patch }] } },
      });
    expect(bad({ url: "https://evil.example/x" })).toThrow(CuratedCatalogError);
    expect(bad({ url: "https://www.civitatis.com/x?aid=1" })).toThrow(/query string/);
    expect(bad({ url: "http://www.civitatis.com/x" })).toThrow(CuratedCatalogError);
    expect(bad({ category: "nightlife" })).toThrow(/category/);
    expect(bad({ id: "Bad Id" })).toThrow(/id/);
    expect(bad({ title: { es: "", en: "x" } })).toThrow(/title/);
    expect(bad({ priceFrom: 10, currency: null })).toThrow(/together/);
    expect(() => parseCuratedCatalog({ destinations: { "Costa Rica": {} } })).toThrow(
      /destination key/,
    );
    expect(() =>
      parseCuratedCatalog({
        destinations: { "cr:a": { civitatis: [entry] }, "cr:b": { civitatis: [entry] } },
      }),
    ).toThrow(/duplicate/);
  });
});
