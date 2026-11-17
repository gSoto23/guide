import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { Beds24Adapter } from "../../src/pms/beds24/adapter.js";
import {
  BEDS24_FIXTURE_CREDENTIALS,
  createBeds24FixtureServer,
  type Beds24FixtureOptions,
} from "../../src/pms/beds24/fixture-server.js";
import { beds24BookingSchema, beds24PropertySchema } from "../../src/pms/beds24/schemas.js";
import {
  PmsCredentialError,
  PmsProviderError,
  type PmsListing,
  type PmsReservation,
} from "../../src/pms/port.js";

/**
 * The Beds24 adapter against the fixture server (T083, research R7). The fixtures are synthetic,
 * built from the API V2 OpenAPI shapes (the files say so in their names); the adapter, its
 * schemas, and its HTTP client are the real ones. The clock is fake: the injected sleep records
 * each wait and moves the clock, which the fixture server's credit windows follow.
 */
const { inviteCode, refreshToken, revokedRefreshToken } = BEDS24_FIXTURE_CREDENTIALS;
const DAY_MS = 86_400_000;

/** Values only templates, unit notes, directions, custom fields, or contact fields hold. */
const FORBIDDEN = /SECRET|@example\.com|555-01|Calle Ficticia|Anfitriona|Contacto/;

interface Setup {
  /** Answers instead of the fixture server when it returns a response. */
  intercept?: (request: Request) => Response | Promise<Response> | undefined;
}

function setup(options: Beds24FixtureOptions = {}, { intercept }: Setup = {}) {
  let clock = Date.now();
  const events: string[] = [];
  const sleeps: number[] = [];
  const server = createBeds24FixtureServer({ now: () => clock, ...options });
  const adapter = new Beds24Adapter({
    fetch: async (input, init) => {
      init?.signal?.throwIfAborted();
      const request = new Request(input, init);
      events.push(`${request.method} ${new URL(request.url).pathname.replace("/api/v2", "")}`);
      return (await intercept?.(request)) ?? server.handle(request);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      events.push(`sleep ${ms}`);
      clock += ms;
    },
    now: () => clock,
  });
  const today = isoDate(clock);
  const paths = (method = "GET") =>
    server.requests
      .filter((request) => request.method === method)
      .map((request) => new URL(request.url).pathname.replace("/api/v2", ""));
  const count = (path: string) => paths().filter((candidate) => candidate === path).length;
  const advance = (ms: number) => {
    clock += ms;
  };
  return { server, adapter, events, sleeps, today, paths, count, advance };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

function byId<T extends { externalId: string }>(items: T[], id: string): T {
  const item = items.find((candidate) => candidate.externalId === id);
  if (!item) throw new Error(`no ${id}`);
  return item;
}

function byUid(items: PmsReservation[], uid: string): PmsReservation {
  const item = items.find((candidate) => candidate.externalUid === uid);
  if (!item) throw new Error(`no booking ${uid}`);
  return item;
}

function rawFixture(name: string): { response: { data: unknown[] } } {
  const url = new URL(`../../fixtures/beds24/${name}.synthetic.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as { response: { data: unknown[] } };
}

describe("Beds24Adapter: credential (T083)", () => {
  it("exchanges the invite code once for a refresh token and reads the account ID", async () => {
    const { adapter, server, paths } = setup();
    const connected = await adapter.validateCredential(` ${inviteCode} `);

    expect(connected).toEqual({
      credential: refreshToken,
      externalAccountId: "40123",
      accountLabel: "Beds24 40123",
    });
    expect(paths()).toEqual(["/authentication/setup", "/authentication/details"]);
    expect(JSON.stringify(connected)).not.toContain(inviteCode);
    // Only the exchange carries the code; nobody sends the partner-only `organization` header.
    const [exchange, details] = server.requests;
    expect(exchange!.headerNames).toContain("code");
    expect(details!.headerNames).not.toContain("code");
    expect(details!.headerNames).toContain("token");
    expect(server.requests.every((request) => !request.headerNames.includes("organization"))).toBe(
      true,
    );
  });

  it("does not try the invite code again once Beds24 has used it", async () => {
    const { adapter, count } = setup({ singleUseInvite: true });
    await adapter.validateCredential(inviteCode);
    await expect(adapter.validateCredential(inviteCode)).rejects.toBeInstanceOf(PmsCredentialError);
    expect(count("/authentication/setup")).toBe(2);
  });

  it("refuses an invalid invite code with PmsCredentialError", async () => {
    const { adapter, paths } = setup();
    const error = await adapter.validateCredential("WRONG-CODE").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PmsCredentialError);
    expect((error as PmsCredentialError).provider).toBe("beds24");
    // A value that cannot be a code is refused without a request.
    await expect(adapter.validateCredential("código ñ")).rejects.toBeInstanceOf(PmsCredentialError);
    expect(paths()).toEqual(["/authentication/setup"]);
  });

  it("uses the access token from the exchange for the first import", async () => {
    const { adapter, count } = setup();
    await adapter.validateCredential(inviteCode);
    await adapter.listListings(refreshToken);
    expect(count("/authentication/token")).toBe(0);
  });

  it("caches access tokens in memory only: a second call makes no new token request", async () => {
    const { adapter, count, today } = setup();
    await adapter.listListings(refreshToken);
    await adapter.listListings(refreshToken);
    await adapter.listReservations(refreshToken, {
      listingExternalIds: ["210001:410001"],
      checkoutFrom: today,
      checkoutTo: addDays(today, 30),
    });
    expect(count("/authentication/token")).toBe(1);
    // The cache is keyed by a SHA-256 of the refresh token, never by the token itself.
    expect(inspect(adapter, { depth: 10 })).not.toContain(refreshToken);

    // Nothing is persisted: another instance (another process) asks for its own token.
    const other = setup();
    await other.adapter.listListings(refreshToken);
    expect(other.count("/authentication/token")).toBe(1);
  });

  it("gets a new access token 5 minutes before the cached one expires", async () => {
    const { adapter, count, advance } = setup();
    await adapter.listListings(refreshToken);
    advance(86_400_000 - 6 * 60_000);
    await adapter.listListings(refreshToken);
    expect(count("/authentication/token")).toBe(1);
    advance(2 * 60_000);
    await adapter.listListings(refreshToken);
    expect(count("/authentication/token")).toBe(2);
  });

  it("retries once with a fresh access token when Beds24 refuses a cached one", async () => {
    const { adapter, paths } = setup({ rejectAccessTokenOnce: true });
    await adapter.validateCredential(inviteCode);
    const listings = await adapter.listListings(refreshToken);
    expect(listings).toHaveLength(4);
    expect(paths()).toEqual([
      "/authentication/setup",
      "/authentication/details",
      "/properties",
      "/authentication/token",
      "/properties",
    ]);
  });

  it("does not retry when a token it has just fetched is refused", async () => {
    const { adapter, paths } = setup({ rejectAccessTokenOnce: true });
    await expect(adapter.listListings(refreshToken)).rejects.toBeInstanceOf(PmsCredentialError);
    expect(paths()).toEqual(["/authentication/token", "/properties"]);
  });

  it("refuses a revoked or unknown refresh token with PmsCredentialError", async () => {
    const { adapter, count } = setup();
    await expect(adapter.listListings(revokedRefreshToken)).rejects.toBeInstanceOf(
      PmsCredentialError,
    );
    await expect(
      adapter.listReservations("not-a-fixture-token", {
        listingExternalIds: ["210001:410001"],
        checkoutFrom: "2026-01-01",
        checkoutTo: "2026-12-31",
      }),
    ).rejects.toBeInstanceOf(PmsCredentialError);
    expect(count("/properties") + count("/bookings")).toBe(0);
  });
});

describe("Beds24Adapter: provider errors", () => {
  it("turns failures and unreadable answers into PmsProviderError without the body", async () => {
    const answers: (() => Response)[] = [
      () => new Response("<html>upstream SECRET</html>", { status: 502 }),
      () => new Response("not json", { status: 200 }),
      () => Response.json({ success: true, data: [{ name: "a property without an id" }] }),
      () => Response.json({ success: false, type: "error", code: 500, error: "SECRET" }),
    ];
    for (const answer of answers) {
      const { adapter } = setup(
        {},
        { intercept: (request) => (request.url.includes("/properties") ? answer() : undefined) },
      );
      const error = await adapter.listListings(refreshToken).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PmsProviderError);
      expect((error as PmsProviderError).code).toBe("provider_error");
      expect((error as Error).message).not.toContain("SECRET");
    }
  });

  it("reports a network failure as provider_error and an aborted call as timeout", async () => {
    const { adapter } = setup(
      {},
      {
        intercept: () => {
          throw new TypeError("fetch failed");
        },
      },
    );
    await expect(adapter.listListings(refreshToken)).rejects.toMatchObject({
      name: "PmsProviderError",
      code: "provider_error",
    });
    const aborted = setup();
    await expect(
      aborted.adapter.listListings(refreshToken, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "PmsProviderError", code: "timeout" });
  });
});

describe("Beds24Adapter: listings (T083)", () => {
  it("maps one listing per room type to {propertyId}:{roomTypeId}, with its name", async () => {
    const { adapter, server } = setup();
    const listings = await adapter.listListings(refreshToken);

    expect(listings.map(({ externalId, name }) => ({ externalId, name }))).toEqual([
      { externalId: "210001:410001", name: "Casa Colibrí" },
      { externalId: "210002:410002", name: "Hotel Las Olas · Suite Vista al Mar" },
      { externalId: "210002:410003", name: "Hotel Las Olas · Habitación Jardín" },
      { externalId: "210003:410004", name: "Cabina Prueba" },
    ]);
    const properties = new URL(server.requests.at(-1)!.url);
    expect(properties.pathname).toBe("/api/v2/properties");
    expect(properties.searchParams.get("includeTexts")).toBe("all");
    expect(properties.searchParams.get("includeAllRooms")).toBe("true");
    expect(properties.searchParams.get("page")).toBe("1");
  });

  it("takes facts from the property, checkInStart, checkOutEnd, and maxPeople", async () => {
    const { adapter } = setup();
    const listings = await adapter.listListings(refreshToken);

    expect(byId(listings, "210001:410001").facts).toEqual({
      addressLine1: "200 m norte de Playa Sámara",
      city: "Sámara",
      region: "Guanacaste",
      postalCode: "50205",
      country: "CR",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 6,
    });
    // A lower-case country code is upper-cased; a numeric string capacity is read.
    expect(byId(listings, "210002:410002").facts).toMatchObject({ country: "CR", maxGuests: 2 });
    expect(byId(listings, "210002:410003").facts.maxGuests).toBe(3);
    // Not an ISO code, not a valid HH:MM, or an implausible capacity: null, never a guess.
    expect(byId(listings, "210003:410004").facts).toEqual({
      addressLine1: null,
      city: "Nosara",
      region: null,
      postalCode: null,
      country: null,
      checkInTime: null,
      checkoutTime: "10:30",
      maxGuests: null,
    });
  });

  it("maps texts per language, with the room description after the property's", async () => {
    const { adapter } = setup();
    const listings = await adapter.listListings(refreshToken);

    const casa = byId(listings, "210001:410001");
    expect(casa.texts).toEqual([
      {
        kind: "title",
        language: "en",
        body: "Casa Colibrí, steps from Sámara beach",
        sourceField: "beds24:texts.headline",
      },
      {
        kind: "description",
        language: "en",
        body:
          "A bright two-storey house with a private pool and a tropical garden, a five-minute walk from Playa Sámara." +
          "\n\nThree bedrooms, two bathrooms, and a covered terrace with hammocks.",
        sourceField: "beds24:texts.propertyDescription",
      },
      {
        kind: "house_rules",
        language: "en",
        body: "Quiet hours from 22:00 to 07:00. No parties. Door code 4821 opens the side gate; please keep it closed.",
        sourceField: "beds24:texts.houseRules",
      },
      {
        kind: "title",
        language: "es",
        body: "Casa Colibrí, a pasos de la playa de Sámara",
        sourceField: "beds24:texts.headline",
      },
      {
        kind: "description",
        language: "es",
        body:
          "Una casa luminosa de dos pisos con piscina privada y jardín tropical, a cinco minutos caminando de Playa Sámara." +
          "\n\nTres habitaciones, dos baños y una terraza techada con hamacas.",
        sourceField: "beds24:texts.propertyDescription",
      },
      {
        kind: "house_rules",
        language: "es",
        body: "Horas de silencio de 22:00 a 07:00. No se permiten fiestas. El código de la puerta lateral se envía antes de la llegada.",
        sourceField: "beds24:texts.houseRules",
      },
    ]);

    // A room description in a language the property has no texts in stands alone.
    const jardin = byId(listings, "210002:410003");
    expect(jardin.texts.map(({ kind, language }) => `${kind}:${language}`)).toEqual([
      "title:en",
      "description:en",
      "house_rules:en",
      "description:es",
    ]);
    expect(jardin.texts.at(-1)).toEqual({
      kind: "description",
      language: "es",
      body: "Habitación en planta baja con salida al jardín.",
      sourceField: "beds24:roomTypes.texts.roomDescription",
    });
    expect(byId(listings, "210003:410004").texts).toEqual([]);
  });

  it("maps featureCodes to amenities, drops unknown codes, and deduplicates", async () => {
    const { adapter } = setup();
    const listings = await adapter.listListings(refreshToken);

    // Property and room type codes together; WIDGET_X and BED_KING are not in the table.
    expect(byId(listings, "210001:410001").amenities).toEqual([
      "wifi",
      "air_conditioning",
      "kitchen",
      "washer",
      "dryer",
      "free_parking",
      "pool",
      "hot_tub",
      "smoke_alarm",
      "carbon_monoxide_alarm",
    ]);
    // WIFI and INTERNET (and a lower-case "wifi") are one amenity.
    expect(byId(listings, "210002:410002").amenities).toEqual([
      "wifi",
      "free_parking",
      "pool",
      "tv",
      "balcony",
      "elevator",
      "gym",
      "ocean_view",
    ]);
    expect(byId(listings, "210002:410003").amenities).toEqual([
      "wifi",
      "free_parking",
      "pool",
      "microwave",
      "garden",
      "elevator",
      "gym",
    ]);
    expect(byId(listings, "210003:410004").amenities).toEqual([]);
  });

  it("never reads templates, unit notes, info items, custom fields, directions, or contacts", async () => {
    const { adapter } = setup();
    const listings = await adapter.listListings(refreshToken);
    const output = JSON.stringify(listings);
    for (const value of [
      "TEMPLATE-SECRET",
      "ROOM-TEMPLATE-SECRET",
      "UNIT-NOTE-SECRET",
      "DIRECTIONS-SECRET",
      "CUSTOM-QUESTION-SECRET",
      "AUXILIARY-SECRET",
      "PERMIT-SECRET",
      "anfitriona.colibri@example.com",
      "+1 555-0140",
    ]) {
      expect(output).not.toContain(value);
    }
    expect(output).not.toMatch(FORBIDDEN);

    // The raw parsed objects hold none of it either: the schema is the allowlist.
    const parsed = rawFixture("properties").response.data.map((item) =>
      beds24PropertySchema.parse(item),
    );
    expect(JSON.stringify(parsed)).not.toMatch(FORBIDDEN);
    expect(Object.keys(parsed[0]!).sort()).toEqual(
      [
        "address",
        "checkInStart",
        "checkOutEnd",
        "city",
        "country",
        "featureCodes",
        "id",
        "name",
        "postcode",
        "roomTypes",
        "state",
        "texts",
      ].sort(),
    );
  });

  it("pages through properties", async () => {
    const { adapter, server } = setup({ propertiesPageSize: 1 });
    const listings = await adapter.listListings(refreshToken);
    expect(listings).toHaveLength(4);
    const pages = server.requests
      .filter((request) => request.url.includes("/properties"))
      .map((request) => new URL(request.url).searchParams.get("page"));
    expect(pages).toEqual(["1", "2", "3"]);
  });

  it("getListing picks the room type, and returns null when it is not there", async () => {
    const { adapter, server, count } = setup();
    const listing = (await adapter.getListing(refreshToken, "210002:410003")) as PmsListing;
    expect(listing.name).toBe("Hotel Las Olas · Habitación Jardín");
    expect(listing.facts.checkInTime).toBe("14:00");
    const request = new URL(server.requests.at(-1)!.url);
    expect(request.searchParams.getAll("id")).toEqual(["210002"]);
    expect(request.searchParams.get("includeTexts")).toBe("all");
    expect(request.searchParams.get("includeAllRooms")).toBe("true");

    expect(await adapter.getListing(refreshToken, "210002:999999")).toBeNull();
    expect(await adapter.getListing(refreshToken, "999999:1")).toBeNull();
    const before = count("/properties");
    expect(await adapter.getListing(refreshToken, "not-an-id")).toBeNull();
    expect(count("/properties")).toBe(before);
  });
});

describe("Beds24Adapter: bookings (T083)", () => {
  const LISTINGS = ["210001:410001", "210002:410002"];

  it("maps confirmed and new to active, cancelled to cancelled, and skips the rest", async () => {
    const { adapter, today } = setup();
    const reservations = await adapter.listReservations(refreshToken, {
      listingExternalIds: LISTINGS,
      checkoutFrom: today,
      checkoutTo: addDays(today, 60),
    });
    const statuses = Object.fromEntries(reservations.map((r) => [r.externalUid, r.status]));
    expect(statuses).toEqual({
      "9100001": "active", // confirmed
      "9100002": "active", // new
      "9100004": "cancelled",
      "9100008": "active",
      "9100009": "active",
      "9100010": "active", // new
      "9100011": "active",
    });
    // request (9100003), black (9100005), and inquiry (9100006) are skipped; 9100007 is a room
    // type that was not requested; 9100012 checked out before the window.
  });

  it("asks for every status of the requested properties within the checkout window", async () => {
    const { adapter, server, today } = setup();
    await adapter.listReservations(refreshToken, {
      listingExternalIds: [...LISTINGS, "210002:410003"],
      checkoutFrom: today,
      checkoutTo: addDays(today, 60),
    });
    const bookings = server.requests.filter((request) => request.url.includes("/bookings"));
    expect(bookings).toHaveLength(1);
    const params = new URL(bookings[0]!.url).searchParams;
    expect(params.getAll("propertyId")).toEqual(["210001", "210002"]);
    expect(params.getAll("status").sort()).toEqual(
      ["black", "cancelled", "confirmed", "inquiry", "new", "request"].sort(),
    );
    expect(params.get("departureFrom")).toBe(today);
    expect(params.get("departureTo")).toBe(addDays(today, 60));
    expect(params.has("modifiedFrom")).toBe(false);
  });

  it("computes guest count, guest name, reference, channel, and dates", async () => {
    const { adapter, today } = setup();
    const reservations = await adapter.listReservations(refreshToken, {
      listingExternalIds: LISTINGS,
      checkoutFrom: today,
      checkoutTo: addDays(today, 60),
    });
    expect(byUid(reservations, "9100001")).toEqual({
      externalUid: "9100001",
      listingExternalId: "210001:410001",
      status: "active",
      checkInDate: addDays(today, 3),
      checkoutDate: addDays(today, 7),
      guestCount: 3, // numAdult 2 + numChild 1
      guestName: "Ana Prueba",
      bookingReference: "9100001",
      channel: "Airbnb",
    });
    expect(byUid(reservations, "9100002")).toMatchObject({
      listingExternalId: "210002:410002",
      guestCount: 2, // numChild missing
      channel: "Booking.com",
    });
    expect(byUid(reservations, "9100004")).toMatchObject({ status: "cancelled", channel: "Vrbo" });
    expect(byUid(reservations, "9100008")).toMatchObject({
      guestCount: null, // both counts missing
      guestName: null, // blank names
      channel: "Direct", // empty channel
    });
    expect(byUid(reservations, "9100009")).toMatchObject({ guestCount: 2, channel: "Expedia" });
    expect(byUid(reservations, "9100010")).toMatchObject({
      guestCount: 3, // "3" as a string
      channel: "Hostelworld", // apiSource for a channel Guidesk does not name
    });
    expect(byUid(reservations, "9100011")).toMatchObject({ guestCount: 4, channel: "Beds24" });
  });

  it("has no contact data in any output, and the parsed bookings have none either", async () => {
    const { adapter, today } = setup();
    const reservations = await adapter.listReservations(refreshToken, {
      listingExternalIds: [...LISTINGS, "210002:410003"],
      checkoutFrom: addDays(today, -30),
      checkoutTo: addDays(today, 60),
    });
    expect(reservations.length).toBeGreaterThan(0);
    const output = JSON.stringify(reservations);
    for (const value of [
      "ana.prueba@example.com",
      "+1 555-0101",
      "+1 555-0102",
      "Calle Ficticia 123",
      "NOTE-SECRET",
      "COMMENT-SECRET",
      "MESSAGE-SECRET",
      "CUSTOM-FIELD-SECRET",
      "INFO-ITEM-SECRET",
      "4821",
      "HMSYNTH0001",
    ]) {
      expect(output).not.toContain(value);
    }
    expect(output).not.toMatch(FORBIDDEN);
    // The port's reservation has exactly these fields; none is for contact data.
    for (const reservation of reservations) {
      expect(Object.keys(reservation).sort()).toEqual([
        "bookingReference",
        "channel",
        "checkInDate",
        "checkoutDate",
        "externalUid",
        "guestCount",
        "guestName",
        "listingExternalId",
        "status",
      ]);
    }

    const parsed = rawFixture("bookings").response.data.map((item) =>
      beds24BookingSchema.parse(item),
    );
    expect(JSON.stringify(parsed)).not.toMatch(FORBIDDEN);
    expect(JSON.stringify(parsed)).not.toContain("4821");
  });

  it("refreshes with modifiedFrom in UTC and sees cancellations", async () => {
    const { adapter, server, today } = setup();
    const modifiedSince = new Date(`${addDays(today, -1)}T00:00:00Z`);
    const reservations = await adapter.listReservations(refreshToken, {
      listingExternalIds: LISTINGS,
      checkoutFrom: today,
      checkoutTo: addDays(today, 60),
      modifiedSince,
    });
    const params = new URL(server.requests.at(-1)!.url).searchParams;
    expect(params.get("modifiedFrom")).toBe(`${addDays(today, -1)}T00:00:00`);
    expect(params.getAll("status")).toContain("cancelled");
    expect(reservations.map(({ externalUid, status }) => ({ externalUid, status }))).toEqual([
      { externalUid: "9100004", status: "cancelled" },
    ]);
  });

  it("pages through bookings 100 at a time", async () => {
    const { adapter, server, today } = setup({ manyBookings: true });
    const reservations = await adapter.listReservations(refreshToken, {
      listingExternalIds: ["210001:410001"],
      checkoutFrom: today,
      checkoutTo: addDays(today, 365),
    });
    // 250 generated stays plus the four active or cancelled fixture bookings in the window.
    expect(reservations).toHaveLength(254);
    const pages = server.requests
      .filter((request) => request.url.includes("/bookings"))
      .map((request) => new URL(request.url).searchParams.get("page"));
    expect(pages).toEqual(["1", "2", "3"]);
    expect(JSON.stringify(reservations)).not.toMatch(FORBIDDEN);
  });

  it("makes no request when no listing is asked for", async () => {
    const { adapter, server } = setup();
    expect(
      await adapter.listReservations(refreshToken, {
        listingExternalIds: ["not-an-id"],
        checkoutFrom: "2026-01-01",
        checkoutTo: "2026-12-31",
      }),
    ).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });
});

describe("Beds24Adapter: rate limits (T083)", () => {
  for (const wikiCreditHeaders of [false, true]) {
    const spelling = wikiCreditHeaders ? "x-five-min-limit-*" : "X-FiveMinCreditLimit-*";
    it(`never goes below 30 remaining credits and waits for the reset (${spelling})`, async () => {
      const { adapter, server, events, sleeps, today } = setup({
        creditFloor: true,
        wikiCreditHeaders,
      });
      // The token answer reports 31 credits left, the properties answer 30.
      await adapter.listListings(refreshToken);
      expect(sleeps).toEqual([]);
      // The next request would spend the 30th credit, so the adapter waits the 120 s first.
      await adapter.listReservations(refreshToken, {
        listingExternalIds: ["210001:410001"],
        checkoutFrom: today,
        checkoutTo: addDays(today, 30),
      });
      expect(events).toEqual([
        "GET /authentication/token",
        "GET /properties",
        "sleep 120000",
        "GET /bookings",
      ]);
      expect(server.lowestRemaining).toBeGreaterThanOrEqual(30);
    });
  }

  it("waits for the reset after a 429 and tries again", async () => {
    const { adapter, sleeps, count } = setup({ rateLimited: 1 });
    const listings = await adapter.listListings(refreshToken);
    expect(listings).toHaveLength(4);
    expect(sleeps).toEqual([45_000]);
    expect(count("/properties")).toBe(2);
  });

  it("gives up with rate_limited after two retries", async () => {
    const { adapter, sleeps, count } = setup({ rateLimited: 3 });
    await expect(adapter.listListings(refreshToken)).rejects.toMatchObject({
      name: "PmsProviderError",
      code: "rate_limited",
    });
    expect(sleeps).toEqual([45_000, 45_000]);
    expect(count("/properties")).toBe(3);
  });
});

describe("Beds24Adapter: revoke (T083)", () => {
  it("calls DELETE /authentication/token and drops the cached access token", async () => {
    const { adapter, server, paths } = setup({ revokeOnDelete: true });
    await adapter.validateCredential(inviteCode);
    expect(await adapter.revoke(refreshToken)).toEqual({ providerRevoked: true });
    expect(paths("DELETE")).toEqual(["/authentication/token"]);
    const deletion = server.requests.at(-1)!;
    expect(deletion.headerNames).toContain("refreshtoken");

    // The cached token is gone, so the next call asks Beds24, which refuses the revoked token.
    await expect(adapter.listListings(refreshToken)).rejects.toBeInstanceOf(PmsCredentialError);
    expect(paths().at(-1)).toBe("/authentication/token");
  });

  it("keeps the fixture refresh token usable after a DELETE unless asked otherwise", async () => {
    const { adapter } = setup();
    expect(await adapter.revoke(refreshToken)).toEqual({ providerRevoked: true });
    await expect(adapter.listListings(refreshToken)).resolves.toHaveLength(4);
  });

  it("reports providerRevoked: false instead of throwing when the provider fails", async () => {
    const refused = setup();
    expect(await refused.adapter.revoke(revokedRefreshToken)).toEqual({ providerRevoked: false });

    const down = setup(
      {},
      {
        intercept: () => {
          throw new TypeError("fetch failed");
        },
      },
    );
    expect(await down.adapter.revoke(refreshToken)).toEqual({ providerRevoked: false });
  });
});

describe("Beds24Adapter: read-only (T083, AC-SEC-013)", () => {
  it("makes every import and refresh request a GET; only revoke deletes", async () => {
    const { adapter, server, today } = setup({ manyBookings: true, propertiesPageSize: 2 });
    await adapter.validateCredential(inviteCode);
    await adapter.listListings(refreshToken);
    await adapter.getListing(refreshToken, "210001:410001");
    const query = {
      listingExternalIds: ["210001:410001", "210002:410002"],
      checkoutFrom: today,
      checkoutTo: addDays(today, 365),
    };
    await adapter.listReservations(refreshToken, query);
    await adapter.listReservations(refreshToken, {
      ...query,
      modifiedSince: new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS),
    });
    expect(server.requests.length).toBeGreaterThan(5);
    expect(server.requests.every((request) => request.method === "GET")).toBe(true);

    await adapter.revoke(refreshToken);
    const writes = server.requests.filter((request) => request.method !== "GET");
    expect(writes.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "DELETE /api/v2/authentication/token",
    ]);
  });
});
