import { ViatorAdapter } from "./viator.adapter.js";
import type { ExperiencePartnerPort } from "./port.js";

/**
 * `EXPERIENCES_MODE=fixtures` (feature 009 research R12): a `fetch` that answers Viator's
 * `/destinations`, `/products/tags`, and `/products/search` with synthetic data, so the real adapter
 * runs end to end in development and tests without an affiliate account. Every product is fictional;
 * links point to an invented Viator path and the synthetic partner ID `P00000000`. Any other host is
 * refused: fixture mode never reaches the network. Refused in production (settings).
 */
const COUNTRY = { id: 900, name: "Costa Rica", lookupId: "9.900" };
const CITIES = [
  { id: 901, name: "Sámara" },
  { id: 902, name: "Tamarindo" },
  { id: 903, name: "La Fortuna" },
  { id: 904, name: "Nosara" },
  { id: 905, name: "Santa Teresa" },
  { id: 906, name: "San José" },
];
const REGION = { id: 910, name: "Guanacaste" };

const TAGS = [
  { tagId: 1, name: "Tours" },
  { tagId: 2, name: "Food & Drink" },
  { tagId: 3, name: "Boat Tours" },
  { tagId: 4, name: "Adventure" },
  { tagId: 5, name: "Cultural Tours" },
  { tagId: 6, name: "Day Trips" },
  { tagId: 7, name: "Spa" },
];

/** [tag, English title, Spanish title, minutes, price, rating, reviews] per synthetic product. */
const PRODUCTS: [number, string, string, number, number, number, number][] = [
  [4, "Canopy zipline adventure", "Aventura de canopy", 180, 79, 4.8, 1240],
  [3, "Catamaran sunset cruise", "Crucero en catamarán al atardecer", 210, 95, 4.9, 860],
  [
    2,
    "Cooking class with a local family",
    "Clase de cocina con una familia local",
    150,
    65,
    4.7,
    310,
  ],
  [4, "Waterfall hike and swim", "Caminata y baño en la catarata", 240, 55, 4.6, 540],
  [3, "Snorkeling at the island", "Esnórquel en la isla", 180, 70, 4.5, 420],
  [
    6,
    "Volcano and hot springs day trip",
    "Excursión de un día al volcán y aguas termales",
    600,
    149,
    4.8,
    980,
  ],
  [1, "Town and beach walking tour", "Recorrido a pie por el pueblo y la playa", 120, 30, 4.4, 95],
  [5, "Chorotega pottery workshop", "Taller de cerámica chorotega", 120, 40, 4.9, 60],
  [2, "Coffee farm tasting", "Degustación en una finca de café", 180, 45, 4.6, 210],
  [3, "Kayak through the mangroves", "Kayak por el manglar", 150, 50, 4.3, 150],
  [4, "Horseback ride on the beach", "Cabalgata por la playa", 120, 60, 4.2, 180],
  [7, "Beachfront massage", "Masaje frente al mar", 60, 80, 4.1, 40],
  [1, "Night wildlife tour", "Tour nocturno de vida silvestre", 120, 45, 4.7, 330],
  [
    6,
    "Turtle nesting beach day trip",
    "Excursión a la playa de anidación de tortugas",
    480,
    120,
    4.5,
    75,
  ],
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function products(destinationId: string, language: string, count: number) {
  const spanish = language.startsWith("es");
  return PRODUCTS.slice(0, count).map(([tag, en, es, minutes, price, rating, reviews], index) => {
    const productCode = `FX${destinationId}P${index + 1}`;
    return {
      productCode,
      title: spanish ? es : en,
      description: spanish
        ? `Experiencia ficticia para pruebas locales: ${es.toLowerCase()}.`
        : `A fictional experience for local testing: ${en.toLowerCase()}.`,
      images: [],
      reviews: { totalReviews: reviews, combinedAverageRating: rating },
      duration: { fixedDurationInMinutes: minutes },
      pricing: { summary: { fromPrice: price }, currency: "USD" },
      productUrl: `https://www.viator.com/tours/Fixture/d${destinationId}-${productCode}?pid=P00000000&mcid=00000&medium=api`,
      tags: [tag],
      translationInfo: { containsMachineTranslatedText: false },
    };
  });
}

export function createViatorFixtureFetch(): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "api.viator.com") {
      throw new TypeError(`fixture mode has no answer for ${url.hostname}`);
    }
    if (url.pathname.endsWith("/destinations")) {
      return json({
        destinations: [
          { destinationId: 9, name: "Central America", type: "REGION", lookupId: "9" },
          {
            destinationId: COUNTRY.id,
            name: COUNTRY.name,
            type: "COUNTRY",
            lookupId: COUNTRY.lookupId,
            parentDestinationId: 9,
          },
          {
            destinationId: REGION.id,
            name: REGION.name,
            type: "REGION",
            lookupId: `${COUNTRY.lookupId}.${REGION.id}`,
            parentDestinationId: COUNTRY.id,
          },
          ...CITIES.map((city) => ({
            destinationId: city.id,
            name: city.name,
            type: "CITY",
            lookupId: `${COUNTRY.lookupId}.${REGION.id}.${city.id}`,
            parentDestinationId: REGION.id,
          })),
        ],
      });
    }
    if (url.pathname.endsWith("/products/tags")) {
      return json({
        tags: TAGS.map((tag) => ({
          tagId: tag.tagId,
          parentTagIds: [],
          allNamesByLocale: { en: tag.name },
        })),
      });
    }
    if (url.pathname.endsWith("/products/search") && request.method === "POST") {
      const body = (await request.json()) as {
        filtering?: { destination?: string };
        pagination?: { count?: number };
      };
      const destinationId = body.filtering?.destination ?? "";
      if (!/^[0-9]{1,12}$/.test(destinationId)) return json({ message: "bad request" }, 400);
      return json({
        products: products(
          destinationId,
          request.headers.get("accept-language") ?? "en",
          Math.min(body.pagination?.count ?? 30, PRODUCTS.length),
        ),
        totalCount: PRODUCTS.length,
      });
    }
    return json({ message: "not found" }, 404);
  };
}

export interface ExperienceSettings {
  mode: "live" | "fixtures";
  viatorApiKey: string | null;
  viatorApiUrl: string;
  civitatisAffiliateId: string | null;
  catalogFile?: string | null;
}

/**
 * The Viator adapter for the deployment, or null when it has no affiliate key (FR-019, OQ-34). In
 * fixture mode the adapter talks to the fixture `fetch` above.
 */
export function createExperiencePartner(
  settings: ExperienceSettings,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): ExperiencePartnerPort | null {
  if (settings.mode === "fixtures") {
    return new ViatorAdapter({
      apiKey: "fixture",
      fetch: options.fetch ?? createViatorFixtureFetch(),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
  }
  if (!settings.viatorApiKey) return null;
  return new ViatorAdapter({
    apiKey: settings.viatorApiKey,
    baseUrl: settings.viatorApiUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}
