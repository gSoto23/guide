import { describe, expect, it } from "vitest";
import { HostexAdapter } from "../../src/pms/hostex/adapter.js";
import {
  createHostexFixtureServer,
  HOSTEX_FIXTURE_BASIC_TOKEN,
  HOSTEX_FIXTURE_TOKEN,
  type HostexFixtureServer,
  type HostexFixtureServerOptions,
} from "../../src/pms/hostex/fixture-server.js";
import {
  airbnbCheckInTime,
  airbnbCheckoutTime,
  channelName,
  mapReservationStatus,
} from "../../src/pms/hostex/mapping.js";
import { reservationSchema } from "../../src/pms/hostex/schemas.js";
import { PmsCredentialError, PmsProviderError, type PmsReservation } from "../../src/pms/port.js";

/**
 * HostexAdapter against the Hostex fixture server (T084, research R7). The fixtures are synthetic,
 * built from the documented v3 response shapes (`fixtures/hostex/*.synthetic.json`); the adapter
 * is the real one, so URLs, headers, envelopes, paging, and parsing are all exercised. Dates in
 * the fixtures are relative to the injected clock.
 */
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const DAY_MS = 86_400_000;
const day = (offset: number) => new Date(NOW + offset * DAY_MS).toISOString().slice(0, 10);
const BASE = "https://api.hostex.io/v3";
const WINDOW = { checkoutFrom: day(0), checkoutTo: day(365) };

type Json = Record<string, unknown>;

function setup(options: HostexFixtureServerOptions = {}) {
  const server = createHostexFixtureServer({ now: () => NOW, ...options });
  const sleeps: number[] = [];
  const adapter = new HostexAdapter({
    fetch: (input, init) => server.handle(new Request(input, init)),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const urls = () => server.requests.map((request) => new URL(request.url));
  return { server, adapter, sleeps, urls };
}

/** An adapter over a fetch that always answers `body` with `status`. */
function stubbed(body: string, status = 200) {
  const calls: string[] = [];
  const adapter = new HostexAdapter({
    fetch: async (input) => {
      calls.push(String(input));
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    },
    sleep: async () => undefined,
  });
  return { adapter, calls };
}

/** What the fixture server sends over the wire, before the adapter reads it. */
async function raw(server: HostexFixtureServer, path: string, token = HOSTEX_FIXTURE_TOKEN) {
  const response = await server.handle(
    new Request(`${BASE}${path}`, { headers: { "Hostex-Access-Token": token } }),
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function rawReservations(propertyId: string): Promise<Json[]> {
  const { server } = setup();
  const query = new URLSearchParams({
    property_id: propertyId,
    start_check_out_date: WINDOW.checkoutFrom,
    end_check_out_date: WINDOW.checkoutTo,
    limit: "100",
  });
  const { body } = await raw(server, `/reservations?${query.toString()}`);
  return (body.data as { reservations: Json[] }).reservations;
}

/** Every contact value, note, custom field, and lock code in raw reservations. */
function sensitiveValues(reservations: Json[]): string[] {
  const values: unknown[] = [];
  for (const item of reservations) {
    values.push(item.guest_email, item.guest_phone, item.remarks, item.channel_remarks);
    const details = item.check_in_details as Json | null;
    values.push(details?.lock_code, details?.check_in_guide_url);
    for (const guest of (item.guests as Json[] | null) ?? []) {
      values.push(guest.email, guest.phone, guest.id_number);
    }
    values.push(...Object.values((item.custom_fields as Json | null) ?? {}));
  }
  return values.filter((value): value is string => typeof value === "string" && value !== "");
}

const byUid = (stays: PmsReservation[]) => new Map(stays.map((stay) => [stay.externalUid, stay]));

describe("HostexAdapter (T084)", () => {
  describe("credential", () => {
    it("validates the token with GET /accounts/me and stores the token itself", async () => {
      const { adapter, urls } = setup();
      await expect(adapter.validateCredential(HOSTEX_FIXTURE_TOKEN)).resolves.toEqual({
        credential: HOSTEX_FIXTURE_TOKEN,
        externalAccountId: "70001",
        accountLabel: "Hostex 70001",
      });
      expect(urls().map((url) => url.href)).toEqual([`${BASE}/accounts/me`]);
    });

    it("trims a pasted token before checking and storing it", async () => {
      const { adapter } = setup();
      const connected = await adapter.validateCredential(`  ${HOSTEX_FIXTURE_TOKEN}\n`);
      expect(connected.credential).toBe(HOSTEX_FIXTURE_TOKEN);
    });

    it("refuses an invalid token, which Hostex reports as error_code 401 with HTTP 200", async () => {
      const { adapter, server } = setup();
      const answer = await raw(server, "/accounts/me", "not-a-hostex-token");
      expect(answer.status).toBe(200);
      expect(answer.body.error_code).toBe(401);

      const error = await adapter.validateCredential("not-a-hostex-token").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PmsCredentialError);
      expect((error as Error).message).not.toContain(String(answer.body.error_msg));
    });

    it("refuses a Basic-edition or expired token, error_code 420 with HTTP 200", async () => {
      const { adapter, server } = setup();
      const answer = await raw(server, "/accounts/me", HOSTEX_FIXTURE_BASIC_TOKEN);
      expect(answer.status).toBe(200);
      expect(answer.body.error_code).toBe(420);

      await expect(adapter.validateCredential(HOSTEX_FIXTURE_BASIC_TOKEN)).rejects.toBeInstanceOf(
        PmsCredentialError,
      );
      await expect(adapter.listListings(HOSTEX_FIXTURE_BASIC_TOKEN)).rejects.toBeInstanceOf(
        PmsCredentialError,
      );
    });

    it("refuses an empty or malformed token without a request", async () => {
      const { adapter, server } = setup();
      for (const input of ["", "   ", "two\nlines", "tóken"]) {
        await expect(adapter.validateCredential(input)).rejects.toBeInstanceOf(PmsCredentialError);
      }
      expect(server.requests).toEqual([]);
    });

    it("fails reads with a credential error once Hostex stops accepting a stored token", async () => {
      const { adapter } = setup();
      await expect(adapter.listListings("deleted-token")).rejects.toBeInstanceOf(
        PmsCredentialError,
      );
      await expect(
        adapter.listReservations("deleted-token", { listingExternalIds: ["910001"], ...WINDOW }),
      ).rejects.toBeInstanceOf(PmsCredentialError);
    });
  });

  describe("errors and rate limits", () => {
    it("waits for Retry-After after a 429 (HTTP 200) and retries", async () => {
      const { adapter, sleeps, server } = setup({ rateLimit: { times: 1, retryAfterSeconds: 7 } });
      await expect(adapter.validateCredential(HOSTEX_FIXTURE_TOKEN)).resolves.toMatchObject({
        externalAccountId: "70001",
      });
      expect(sleeps).toEqual([7000]);
      expect(server.requests).toHaveLength(2);
    });

    it("gives up as rate_limited after two retries, waiting 60 s when Retry-After is missing", async () => {
      const { adapter, sleeps, server } = setup({
        rateLimit: { times: 3, retryAfterSeconds: null },
      });
      const error = await adapter.validateCredential(HOSTEX_FIXTURE_TOKEN).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PmsProviderError);
      expect((error as PmsProviderError).code).toBe("rate_limited");
      expect(sleeps).toEqual([60_000, 60_000]);
      expect(server.requests).toHaveLength(3);
    });

    it("does not sleep through an hourly or daily quota", async () => {
      const { adapter, sleeps } = setup({ rateLimit: { times: 1, retryAfterSeconds: 3600 } });
      await expect(adapter.validateCredential(HOSTEX_FIXTURE_TOKEN)).rejects.toMatchObject({
        code: "rate_limited",
      });
      expect(sleeps).toEqual([]);
    });

    it("reports other error codes, HTTP errors, and unreadable bodies as provider errors without the body", async () => {
      const secret = "SECRET-DETAIL door 4821";
      const cases = [
        stubbed(JSON.stringify({ request_id: "RT", error_code: 500, error_msg: secret })),
        stubbed(JSON.stringify({ request_id: "RT", error_code: 502, error_msg: secret })),
        stubbed(JSON.stringify({ error_code: 200, data: { account_id: "" } })),
        stubbed(`<html>${secret}</html>`),
        stubbed(JSON.stringify({ error_code: 200, data: { account_id: "1" } }), 503),
      ];
      for (const { adapter } of cases) {
        const error = await adapter
          .validateCredential(HOSTEX_FIXTURE_TOKEN)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PmsProviderError);
        expect((error as PmsProviderError).code).toBe("provider_error");
        expect((error as Error).message).not.toContain("SECRET");
      }
    });

    it("passes the abort signal to fetch and reports a cancelled call as a timeout", async () => {
      const controller = new AbortController();
      controller.abort();
      let received: AbortSignal | null | undefined;
      const adapter = new HostexAdapter({
        fetch: async (_input, init) => {
          received = init?.signal;
          throw new DOMException("aborted", "AbortError");
        },
      });
      await expect(
        adapter.listListings(HOSTEX_FIXTURE_TOKEN, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "PmsProviderError", code: "timeout" });
      expect(received).toBe(controller.signal);
    });
  });

  describe("properties", () => {
    it("maps one listing per property, with the facts Hostex lacks left empty", async () => {
      const { adapter } = setup();
      const listings = await adapter.listListings(HOSTEX_FIXTURE_TOKEN);
      expect(listings.map((listing) => [listing.externalId, listing.name])).toEqual([
        ["910001", "Casa Colibrí Sámara"],
        ["910002", "Loft Escazú"],
        ["910003", "Villa Nosara"],
        ["910004", "Cabina Monteverde"],
      ]);
      expect(listings.find((listing) => listing.externalId === "910002")).toEqual({
        externalId: "910002",
        name: "Loft Escazú",
        facts: {
          addressLine1: "Avenida Ejemplo 12, San Rafael de Escazú, San José, Costa Rica",
          city: null,
          region: null,
          postalCode: null,
          country: null,
          checkInTime: null,
          checkoutTime: null,
          maxGuests: null,
        },
        texts: [],
        amenities: [],
      });
      const monteverde = listings.find((listing) => listing.externalId === "910004");
      expect(monteverde?.facts.addressLine1).toBeNull();
    });

    it("takes check-in and checkout from price_and_rules for Airbnb-linked listings and ignores its max_guests", async () => {
      const { adapter, server, urls } = setup();
      const rules = await raw(server, "/listings/airbnb/price_and_rules?listing_id=880000101");
      expect(rules.body.data).toMatchObject({
        check_in_start_time: 15,
        check_out_before: 11,
        max_guests: 2,
      });
      server.requests.length = 0;

      const listings = await adapter.listListings(HOSTEX_FIXTURE_TOKEN);
      const colibri = listings.find((listing) => listing.externalId === "910001");
      expect(colibri?.facts).toMatchObject({
        addressLine1:
          "Calle Ficticia 1, 200 m norte de la plaza, Sámara, Nicoya, Guanacaste, Costa Rica",
        checkInTime: "15:00",
        checkoutTime: "11:00",
        maxGuests: null,
      });
      // Only Airbnb-linked properties are asked; Loft Escazú (Booking.com and Vrbo) is not.
      const asked = urls()
        .filter((url) => url.pathname === "/v3/listings/airbnb/price_and_rules")
        .map((url) => url.searchParams.get("listing_id"))
        .sort();
      expect(asked).toEqual(["880000101", "880000103", "880000104"]);
    });

    it("leaves a FLEXIBLE check-in empty, and both times empty when price_and_rules fails", async () => {
      const { adapter } = setup();
      const listings = await adapter.listListings(HOSTEX_FIXTURE_TOKEN);
      const nosara = listings.find((listing) => listing.externalId === "910003");
      expect(nosara?.facts).toMatchObject({ checkInTime: null, checkoutTime: "10:00" });
      // Its price_and_rules answers error_code 502 (an Airbnb failure); the listing still maps.
      const monteverde = listings.find((listing) => listing.externalId === "910004");
      expect(monteverde?.facts).toMatchObject({ checkInTime: null, checkoutTime: null });
    });

    it.each([
      [8, "08:00"],
      [15, "15:00"],
      ["15", "15:00"],
      [23, "23:00"],
      [24, null],
      [25, null],
      [26, null],
      [7, null],
      ["FLEXIBLE", null],
      [null, null],
    ] as const)("maps Airbnb check-in start %s to %s", (value, expected) => {
      expect(airbnbCheckInTime(value)).toBe(expected);
    });

    it.each([
      [0, "00:00"],
      [11, "11:00"],
      [23, "23:00"],
      [24, null],
      [10.5, null],
      [undefined, null],
    ] as const)("maps Airbnb checkout %s to %s", (value, expected) => {
      expect(airbnbCheckoutTime(value)).toBe(expected);
    });

    it("reads one listing by property ID, and returns null for an unknown or non-Hostex ID", async () => {
      const { adapter, server, urls } = setup();
      const all = await adapter.listListings(HOSTEX_FIXTURE_TOKEN);
      server.requests.length = 0;

      const colibri = await adapter.getListing(HOSTEX_FIXTURE_TOKEN, "910001");
      expect(colibri).toEqual(all.find((listing) => listing.externalId === "910001"));
      expect(urls().map((url) => url.pathname + url.search)).toEqual([
        "/v3/properties?id=910001",
        "/v3/listings/airbnb/price_and_rules?listing_id=880000101",
      ]);

      await expect(adapter.getListing(HOSTEX_FIXTURE_TOKEN, "999999")).resolves.toBeNull();
      server.requests.length = 0;
      await expect(adapter.getListing(HOSTEX_FIXTURE_TOKEN, "12:34")).resolves.toBeNull();
      expect(server.requests).toEqual([]);
    });
  });

  describe("reservations", () => {
    it("maps accepted to active; cancelled, denied, and timeout to cancelled; skips wait_accept and wait_pay", async () => {
      const rawStatuses = (await rawReservations("910001")).map((item) => item.status);
      expect(new Set(rawStatuses)).toEqual(
        new Set(["accepted", "cancelled", "denied", "timeout", "wait_accept", "wait_pay"]),
      );

      const { adapter } = setup();
      const stays = byUid(
        await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
          listingExternalIds: ["910001"],
          ...WINDOW,
        }),
      );
      expect(stays.get("0-SYN0001-colibri")?.status).toBe("active");
      expect(stays.get("0-SYN0002-colibri")?.status).toBe("cancelled");
      expect(stays.get("0-SYN0003-colibri")?.status).toBe("cancelled");
      expect(stays.get("0-SYN0004-colibri")?.status).toBe("cancelled");
      expect(stays.has("0-SYN0005-colibri")).toBe(false);
      expect(stays.has("0-SYN0006-colibri")).toBe(false);

      expect(mapReservationStatus("accepted")).toBe("active");
      for (const status of ["cancelled", "denied", "timeout"]) {
        expect(mapReservationStatus(status)).toBe("cancelled");
      }
      for (const status of ["wait_accept", "wait_pay", "something_new"]) {
        expect(mapReservationStatus(status)).toBeNull();
      }
    });

    it("maps codes, dates, guest count, guest name, and channel", async () => {
      const { adapter } = setup();
      const stays = byUid(
        await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
          listingExternalIds: ["910001", "910002"],
          ...WINDOW,
        }),
      );
      expect(stays.get("0-SYN0001-colibri")).toEqual({
        externalUid: "0-SYN0001-colibri",
        listingExternalId: "910001",
        status: "active",
        checkInDate: day(3),
        checkoutDate: day(7),
        guestCount: 2,
        guestName: "Ana Prueba",
        bookingReference: "0-SYN0001-colibri",
        channel: "Airbnb",
      });
      // A manual reservation with no guest count or name, on a host-defined custom channel.
      expect(stays.get("5-SYN0008-escazu")).toMatchObject({
        guestCount: null,
        guestName: null,
        channel: "Instagram",
      });
      expect(stays.get("0-SYN0002-colibri")?.channel).toBe("Booking.com");
      expect(stays.get("0-SYN0011-escazu")?.channel).toBe("Vrbo");
      expect(stays.get("0-SYN0012-escazu")?.channel).toBe("Direct");
    });

    it("keeps each stay of a multi-stay reservation, with the shared reservation code as reference", async () => {
      const { adapter } = setup();
      const stays = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001", "910002"],
        ...WINDOW,
      });
      const family = stays.filter((stay) => stay.bookingReference === "0-SYN0009-familia");
      expect(family.map((stay) => [stay.externalUid, stay.listingExternalId])).toEqual([
        ["0-SYN0009_1-familia", "910001"],
        ["0-SYN0009_2-familia", "910002"],
      ]);
    });

    it("sends the checkout window to Hostex per property and ignores modifiedSince", async () => {
      const { adapter, urls } = setup();
      const full = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001", "not-hostex"],
        ...WINDOW,
      });
      const [request] = urls();
      expect(urls()).toHaveLength(1);
      expect(request?.pathname).toBe("/v3/reservations");
      expect(Object.fromEntries(request!.searchParams)).toEqual({
        property_id: "910001",
        start_check_out_date: day(0),
        end_check_out_date: day(365),
        offset: "0",
        limit: "100",
      });
      // The stay that checked out before the window is not returned.
      expect(full.some((stay) => stay.externalUid === "0-SYN0007-colibri")).toBe(false);

      const changed = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001"],
        ...WINDOW,
        modifiedSince: new Date(NOW - DAY_MS),
      });
      expect(changed).toEqual(full);
      expect(Object.fromEntries(urls()[1]!.searchParams)).toEqual(
        Object.fromEntries(request!.searchParams),
      );
    });

    it.each([
      ["airbnb", null, "Airbnb"],
      ["booking.com", null, "Booking.com"],
      ["booking", null, "Booking.com"],
      ["vrbo", null, "Vrbo"],
      ["homeaway", null, "Vrbo"],
      ["expedia", null, "Expedia"],
      ["agoda", null, "Agoda"],
      ["hostex_direct", null, "Direct"],
      ["booking_site", null, "Direct"],
      ["direct", null, "Direct"],
      ["", null, "Direct"],
      ["hostex_direct", "Instagram", "Instagram"],
      ["trip.com", null, "Trip.com"],
      ["tujia_intl", null, "Tujia intl"],
    ] as const)("names channel %j (custom %j) %j", (type, custom, expected) => {
      expect(channelName(type, custom)).toBe(expected);
    });

    it("drops check_in_details, phone, email, guests[], remarks, and custom fields at the boundary", async () => {
      const rawItems = [...(await rawReservations("910001")), ...(await rawReservations("910002"))];
      const sensitive = sensitiveValues(rawItems);
      // The fixtures really carry them: the lock code, emails, phones, notes, and custom fields.
      expect(sensitive).toContain("4821");
      expect(sensitive.some((value) => value.endsWith("@example.com"))).toBe(true);
      expect(sensitive.some((value) => value.includes("555-01"))).toBe(true);
      expect(sensitive.some((value) => value.startsWith("Synthetic host remark"))).toBe(true);
      expect(sensitive.some((value) => value.startsWith("Synthetic gate note"))).toBe(true);

      const { adapter } = setup();
      const stays = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001", "910002"],
        ...WINDOW,
      });
      const parsed = rawItems.map((item) => reservationSchema.parse(item));
      for (const output of [JSON.stringify(stays), JSON.stringify(parsed)]) {
        expect(output).not.toContain("4821");
        expect(output).not.toContain("@example.com");
        expect(output).not.toContain("555-01");
        for (const value of sensitive) expect(output).not.toContain(value);
      }
      // The parsed objects hold only the allowlisted keys.
      for (const item of parsed) {
        expect(Object.keys(item).sort()).toEqual(
          [
            "channel_type",
            "check_in_date",
            "check_out_date",
            "custom_channel",
            "guest_name",
            "number_of_guests",
            "property_id",
            "reservation_code",
            "status",
            "stay_code",
          ].sort(),
        );
      }
    });
  });

  describe("pagination", () => {
    it("reads properties 100 at a time until the total", async () => {
      const { adapter, urls } = setup({ extraProperties: 230 });
      const listings = await adapter.listListings(HOSTEX_FIXTURE_TOKEN);
      expect(listings).toHaveLength(234);
      expect(new Set(listings.map((listing) => listing.externalId)).size).toBe(234);
      const pages = urls().filter((url) => url.pathname === "/v3/properties");
      expect(
        pages.map((url) => [url.searchParams.get("offset"), url.searchParams.get("limit")]),
      ).toEqual([
        ["0", "100"],
        ["100", "100"],
        ["200", "100"],
      ]);
    });

    it("reads reservations until a page holds fewer than 100", async () => {
      const fixtureCount = (await rawReservations("910001")).length;
      const { adapter, urls } = setup({ extraReservations: 230 });
      const stays = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001"],
        ...WINDOW,
      });
      // Two of the fixture stays are skipped (wait_accept and wait_pay).
      expect(stays).toHaveLength(fixtureCount + 230 - 2);
      expect(urls().map((url) => url.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
    });

    it("asks once more after a full last page and stops on the empty one", async () => {
      const fixtureCount = (await rawReservations("910001")).length;
      const { adapter, urls } = setup({ extraReservations: 200 - fixtureCount });
      const stays = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001"],
        ...WINDOW,
      });
      expect(stays).toHaveLength(200 - 2);
      expect(urls().map((url) => url.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
    });

    it("stops with a provider error when the API ignores the offset", async () => {
      const item = {
        reservation_code: "0-SYN-LOOP",
        stay_code: "0-SYN-LOOP",
        property_id: 910001,
        channel_type: "airbnb",
        check_in_date: day(1),
        check_out_date: day(3),
        number_of_guests: 2,
        status: "accepted",
      };
      const page = {
        error_code: 200,
        data: { reservations: Array.from({ length: 100 }, () => item) },
      };
      const { adapter, calls } = stubbed(JSON.stringify(page));
      await expect(
        adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
          listingExternalIds: ["910001"],
          ...WINDOW,
        }),
      ).rejects.toMatchObject({ name: "PmsProviderError", code: "provider_error" });
      expect(calls).toHaveLength(200);
    });
  });

  describe("unreadable items", () => {
    it("skips a reservation it cannot read instead of failing the refresh", async () => {
      const good = {
        reservation_code: "0-SYN-GOOD",
        property_id: 910001,
        channel_type: "airbnb",
        check_in_date: day(1),
        check_out_date: day(3),
        status: "accepted",
        custom_channel: [],
      };
      const page = {
        error_code: 200,
        data: {
          reservations: [
            good,
            { ...good, reservation_code: "0-SYN-BAD-DATE", check_out_date: "2026-13-45" },
            { ...good, reservation_code: undefined },
            "not an object",
          ],
        },
      };
      const { adapter } = stubbed(JSON.stringify(page));
      const stays = await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001"],
        ...WINDOW,
      });
      // No stay code: the reservation code is the ID. `custom_channel: []` reads as no custom channel.
      expect(stays).toEqual([
        {
          externalUid: "0-SYN-GOOD",
          listingExternalId: "910001",
          status: "active",
          checkInDate: day(1),
          checkoutDate: day(3),
          guestCount: null,
          guestName: null,
          bookingReference: "0-SYN-GOOD",
          channel: "Airbnb",
        },
      ]);
    });
  });

  describe("read-only", () => {
    it("only sends GET requests, to read endpoints", async () => {
      const { adapter, server } = setup({ extraReservations: 120 });
      await adapter.validateCredential(HOSTEX_FIXTURE_TOKEN);
      await adapter.listListings(HOSTEX_FIXTURE_TOKEN);
      await adapter.getListing(HOSTEX_FIXTURE_TOKEN, "910003");
      await adapter.listReservations(HOSTEX_FIXTURE_TOKEN, {
        listingExternalIds: ["910001", "910002", "910003"],
        ...WINDOW,
        modifiedSince: new Date(NOW - DAY_MS),
      });
      await adapter.revoke(HOSTEX_FIXTURE_TOKEN);

      expect(server.requests.length).toBeGreaterThan(5);
      expect(new Set(server.requests.map((request) => request.method))).toEqual(new Set(["GET"]));
      const paths = new Set(server.requests.map((request) => new URL(request.url).pathname));
      expect(paths).toEqual(
        new Set([
          "/v3/accounts/me",
          "/v3/properties",
          "/v3/listings/airbnb/price_and_rules",
          "/v3/reservations",
        ]),
      );
    });
  });

  describe("revoke", () => {
    it("reports providerRevoked false without any request", async () => {
      const { adapter, server } = setup();
      await expect(adapter.revoke(HOSTEX_FIXTURE_TOKEN)).resolves.toEqual({
        providerRevoked: false,
      });
      expect(server.requests).toEqual([]);

      const offline = new HostexAdapter({
        fetch: async () => {
          throw new Error("revoke must not make a request");
        },
      });
      await expect(offline.revoke(HOSTEX_FIXTURE_TOKEN)).resolves.toEqual({
        providerRevoked: false,
      });
    });
  });
});
