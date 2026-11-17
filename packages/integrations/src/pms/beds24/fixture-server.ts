import { readFileSync } from "node:fs";

/**
 * The only credential values the Beds24 fixture server accepts. They are synthetic and work only
 * here; anything else gets Beds24's invalid-token answer.
 */
export const BEDS24_FIXTURE_CREDENTIALS = {
  inviteCode: "FIXTURE-BEDS24-INVITE",
  refreshToken: "fixture-beds24-refresh",
  accessToken: "fixture-beds24-access",
  /** Always refused, like a refresh token the host deleted in Beds24. */
  revokedRefreshToken: "fixture-beds24-revoked",
} as const;

/** The account ID `/authentication/details` reports. */
export const BEDS24_FIXTURE_OWNER_ID = 40123;

const ACCESS_TOKEN_TTL_SECONDS = 86_400;
const CREDIT_LIMIT = 100;
const WINDOW_SECONDS = 300;
const BOOKINGS_PAGE_SIZE = 100;
const GENERATED_BOOKINGS = 250;
/** The reset a forced 429 announces. */
const RATE_LIMIT_RESETS_IN_SECONDS = 45;
const DAY_MS = 86_400_000;

export interface Beds24FixtureOptions {
  /** The clock: stay dates follow its day, and credit windows reset by it. */
  now?: () => number;
  /** Start with a window of 32 credits that resets in 120 s, so answers report 31, then 30. */
  creditFloor?: boolean;
  /** Spell the credit headers like the wiki (`x-five-min-limit-*`) instead of the OpenAPI spec. */
  wikiCreditHeaders?: boolean;
  /** Answer the next N `/properties` or `/bookings` requests with 429. */
  rateLimited?: number;
  /** Refuse the access token on the next `/properties` or `/bookings` request. */
  rejectAccessTokenOnce?: boolean;
  /** Add 250 confirmed Casa Colibrí bookings, generated in code, to page through. */
  manyBookings?: boolean;
  /** Properties per page (100 by default). */
  propertiesPageSize?: number;
  /** Accept the invite code once, like Beds24 does; by default it works every time. */
  singleUseInvite?: boolean;
  /** Make `DELETE /authentication/token` refuse the refresh token afterwards; by default it stays valid. */
  revokeOnDelete?: boolean;
}

export interface Beds24FixtureRequest {
  method: string;
  url: string;
  /** Header names only, so the record holds no token values. */
  headerNames: string[];
}

export interface Beds24FixtureServer {
  handle(request: Request): Promise<Response>;
  /** Every request received, in order. */
  readonly requests: Beds24FixtureRequest[];
  /** The fewest credits left after any charged request (forced 429s are not charged). */
  readonly lowestRemaining: number;
}

interface FixtureRoomType {
  texts?: unknown;
  [key: string]: unknown;
}

interface FixtureProperty {
  id: number;
  texts?: unknown;
  roomTypes?: FixtureRoomType[];
  [key: string]: unknown;
}

interface FixtureBooking {
  id: number;
  propertyId: number;
  roomId: number;
  status: string;
  arrival: string;
  departure: string;
  modifiedTime: string;
  bookingTime?: string | null;
  cancelTime?: string | null;
  [key: string]: unknown;
}

/**
 * A stand-in for Beds24 API V2 (T082, T092), for development and contract tests: it answers
 * absolute URLs under any host's `/api/v2` from the synthetic fixtures in `fixtures/beds24/`,
 * checks the auth headers, sends credit headers from a simple 5-minute credit model, pages
 * bookings 100 at a time, and records every request so tests can check the adapter only reads.
 *
 * The invite code works any number of times and a DELETE leaves the refresh token valid, because
 * one instance serves a whole dev server or test app; `singleUseInvite` and `revokeOnDelete`
 * turn on Beds24's real behaviour.
 */
export function createBeds24FixtureServer(options: Beds24FixtureOptions = {}): Beds24FixtureServer {
  const now = options.now ?? Date.now;
  const today = isoDate(now());
  const properties = loadProperties();
  const bookings = loadBookings(today);
  if (options.manyBookings) bookings.push(...generateBookings(today));
  const propertiesPageSize = Math.max(1, options.propertiesPageSize ?? 100);

  const requests: Beds24FixtureRequest[] = [];
  const revoked = new Set<string>([BEDS24_FIXTURE_CREDENTIALS.revokedRefreshToken]);
  let inviteUsed = false;
  let rateLimited = options.rateLimited ?? 0;
  let rejectAccessToken = options.rejectAccessTokenOnce ?? false;
  let credits = options.creditFloor ? 32 : CREDIT_LIMIT;
  let windowEndsAt = now() + (options.creditFloor ? 120 : WINDOW_SECONDS) * 1000;
  let lowestRemaining = credits;

  const creditHeaders = (
    remaining: number,
    resetsIn: number,
    cost: number,
  ): Record<string, string> =>
    options.wikiCreditHeaders
      ? {
          "x-five-min-limit": String(CREDIT_LIMIT),
          "x-five-min-limit-remaining": String(remaining),
          "x-five-min-limit-resets-in": String(resetsIn),
          "x-request-cost": String(cost),
        }
      : {
          "X-FiveMinCreditLimit": String(CREDIT_LIMIT),
          "X-FiveMinCreditLimit-Remaining": String(remaining),
          "X-FiveMinCreditLimit-ResetsIn": String(resetsIn),
          "X-RequestCost": String(cost),
        };

  /** Charges one credit in the current window; an empty window answers 429. */
  const charge = () => {
    const at = now();
    if (at >= windowEndsAt) {
      credits = CREDIT_LIMIT;
      windowEndsAt = at + WINDOW_SECONDS * 1000;
    }
    const exhausted = credits <= 0;
    if (!exhausted) credits -= 1;
    lowestRemaining = Math.min(lowestRemaining, credits);
    const resetsIn = Math.max(0, Math.ceil((windowEndsAt - at) / 1000));
    return { exhausted, headers: creditHeaders(credits, resetsIn, exhausted ? 0 : 1) };
  };

  const authorize = (request: Request, headers: Record<string, string>): Response | null => {
    const token = request.headers.get("token");
    if (!token) return failure(403, "Token missing", headers);
    if (rejectAccessToken) {
      rejectAccessToken = false;
      return failure(401, "Token not valid", headers);
    }
    if (token !== BEDS24_FIXTURE_CREDENTIALS.accessToken) {
      return failure(401, "Token not valid", headers);
    }
    return null;
  };

  const refreshTokenStatus = (value: string | null): "valid" | "revoked" | "unknown" => {
    if (value && revoked.has(value)) return "revoked";
    return value === BEDS24_FIXTURE_CREDENTIALS.refreshToken ? "valid" : "unknown";
  };

  const route = (request: Request, path: string, url: URL): Response => {
    const isData = path === "/properties" || path === "/bookings";
    if (isData && rateLimited > 0) {
      rateLimited -= 1;
      return failure(
        429,
        "Credit limit exceeded",
        creditHeaders(0, RATE_LIMIT_RESETS_IN_SECONDS, 0),
      );
    }
    const { exhausted, headers } = charge();
    if (exhausted) return failure(429, "Credit limit exceeded", headers);
    const method = request.method.toUpperCase();

    if (path === "/authentication/setup" && method === "GET") {
      const code = request.headers.get("code");
      if (
        code !== BEDS24_FIXTURE_CREDENTIALS.inviteCode ||
        (options.singleUseInvite && inviteUsed)
      ) {
        return failure(400, "Invalid code", headers);
      }
      inviteUsed = true;
      revoked.delete(BEDS24_FIXTURE_CREDENTIALS.refreshToken);
      return json(
        200,
        {
          token: BEDS24_FIXTURE_CREDENTIALS.accessToken,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: BEDS24_FIXTURE_CREDENTIALS.refreshToken,
        },
        headers,
      );
    }

    if (path === "/authentication/token" && (method === "GET" || method === "DELETE")) {
      const status = refreshTokenStatus(request.headers.get("refreshToken"));
      if (status === "revoked") return failure(401, "Token not valid", headers);
      if (status === "unknown") return failure(400, "Invalid refresh token", headers);
      if (method === "DELETE") {
        if (options.revokeOnDelete) revoked.add(BEDS24_FIXTURE_CREDENTIALS.refreshToken);
        return new Response(null, { status: 200, headers });
      }
      return json(
        200,
        {
          token: BEDS24_FIXTURE_CREDENTIALS.accessToken,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
        headers,
      );
    }

    if (path === "/authentication/details" && method === "GET") {
      if (request.headers.get("token") !== BEDS24_FIXTURE_CREDENTIALS.accessToken) {
        return json(200, { validToken: false, diagnostics: { requestIp: "192.0.2.10" } }, headers);
      }
      return json(
        200,
        {
          validToken: true,
          token: {
            ownerId: BEDS24_FIXTURE_OWNER_ID,
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            created: new Date(now()).toISOString(),
            scopes: ["read:properties", "read:bookings", "read:bookings-personal"],
            deviceName: "Guidesk",
            linkedProperties: false,
            onlyPropertyId: null,
            whiteListOnly: false,
            whiteList: [],
          },
          diagnostics: { requestIp: "192.0.2.10" },
        },
        headers,
      );
    }

    if (path === "/properties" && method === "GET") {
      const refused = authorize(request, headers);
      if (refused) return refused;
      return json(200, propertiesPage(properties, url, propertiesPageSize), headers);
    }

    if (path === "/bookings" && method === "GET") {
      const refused = authorize(request, headers);
      if (refused) return refused;
      return json(200, bookingsPage(bookings, url), headers);
    }

    if (isData) return failure(405, "Method not allowed in the fixture server", headers);
    return failure(404, "Not found", headers);
  };

  return {
    requests,
    get lowestRemaining() {
      return lowestRemaining;
    },
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      requests.push({
        method: request.method.toUpperCase(),
        url: request.url,
        headerNames: [...request.headers.keys()],
      });
      const path = /\/api\/v2(\/[^?]*)$/.exec(url.pathname)?.[1];
      if (!path) return failure(404, "Not found", {});
      return route(request, path.replace(/\/+$/, ""), url);
    },
  };
}

function propertiesPage(properties: FixtureProperty[], url: URL, pageSize: number) {
  const ids = all(url, "id").map(Number);
  const includeTexts = all(url, "includeTexts");
  const propertyTexts = includeTexts.includes("all") || includeTexts.includes("property");
  const roomTypeTexts = includeTexts.includes("all") || includeTexts.includes("roomType");
  const matching = properties
    .filter((property) => ids.length === 0 || ids.includes(property.id))
    .map((property) => ({
      ...property,
      texts: propertyTexts ? property.texts : undefined,
      roomTypes: property.roomTypes?.map((roomType) => ({
        ...roomType,
        texts: roomTypeTexts ? roomType.texts : undefined,
      })),
    }));
  return envelope("property", matching, url, pageSize);
}

function bookingsPage(bookings: FixtureBooking[], url: URL) {
  const propertyIds = all(url, "propertyId").map(Number);
  const roomIds = all(url, "roomId").map(Number);
  const requested = all(url, "status");
  // Beds24 leaves cancelled bookings out unless they are asked for.
  const statuses =
    requested.length > 0 ? requested : ["confirmed", "new", "request", "black", "inquiry"];
  const param = (name: string) => url.searchParams.get(name) ?? undefined;
  const departureFrom = param("departureFrom");
  const departureTo = param("departureTo");
  const arrivalFrom = param("arrivalFrom");
  const arrivalTo = param("arrivalTo");
  const modifiedFrom = param("modifiedFrom");
  const matching = bookings
    .filter(
      (booking) =>
        (propertyIds.length === 0 || propertyIds.includes(booking.propertyId)) &&
        (roomIds.length === 0 || roomIds.includes(booking.roomId)) &&
        statuses.includes(booking.status) &&
        (departureFrom === undefined || booking.departure >= departureFrom) &&
        (departureTo === undefined || booking.departure <= departureTo) &&
        (arrivalFrom === undefined || booking.arrival >= arrivalFrom) &&
        (arrivalTo === undefined || booking.arrival <= arrivalTo) &&
        (modifiedFrom === undefined || booking.modifiedTime.slice(0, 19) >= modifiedFrom),
    )
    .sort((a, b) => a.id - b.id);
  return envelope("booking", matching, url, BOOKINGS_PAGE_SIZE);
}

function envelope<T>(type: string, items: T[], url: URL, pageSize: number) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const data = items.slice((page - 1) * pageSize, page * pageSize);
  const nextPageExists = page * pageSize < items.length;
  const next = new URL(url);
  next.searchParams.set("page", String(page + 1));
  return {
    success: true,
    type,
    count: data.length,
    pages: { nextPageExists, nextPageLink: nextPageExists ? next.toString() : null },
    data,
  };
}

/** A repeated query parameter, also in the `name[]` spelling. */
function all(url: URL, name: string): string[] {
  return [...url.searchParams.getAll(name), ...url.searchParams.getAll(`${name}[]`)];
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}

/** Beds24's error body. */
function failure(status: number, error: string, headers: Record<string, string>): Response {
  return json(status, { success: false, type: "error", code: status, error }, headers);
}

function readFixture<T>(name: string): T {
  const file = new URL(`../../../fixtures/beds24/${name}.synthetic.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function loadProperties(): FixtureProperty[] {
  return readFixture<{ response: { data: FixtureProperty[] } }>("properties").response.data;
}

/** The fixture bookings, every date moved by the days between the file's reference day and today. */
function loadBookings(today: string): FixtureBooking[] {
  const file = readFixture<{ referenceDate: string; response: { data: FixtureBooking[] } }>(
    "bookings",
  );
  const shift = Math.round((Date.parse(today) - Date.parse(file.referenceDate)) / DAY_MS);
  return file.response.data.map((booking) => ({
    ...booking,
    arrival: addDays(booking.arrival, shift),
    departure: addDays(booking.departure, shift),
    bookingTime: shiftDateTime(booking.bookingTime, shift),
    modifiedTime: shiftDateTime(booking.modifiedTime, shift) ?? booking.modifiedTime,
    cancelTime: shiftDateTime(booking.cancelTime, shift),
  }));
}

/** Confirmed Casa Colibrí stays, one a day from today, with synthetic contact data. */
function generateBookings(today: string): FixtureBooking[] {
  return Array.from({ length: GENERATED_BOOKINGS }, (_, index) => {
    const phone = `+1 555-01${String(index % 100).padStart(2, "0")}`;
    return {
      id: 9_200_001 + index,
      propertyId: 210001,
      roomId: 410001,
      unitId: 1,
      status: "confirmed",
      subStatus: "none",
      arrival: addDays(today, index),
      departure: addDays(today, index + 1),
      numAdult: 2,
      numChild: 0,
      firstName: "Huésped",
      lastName: `Generado ${index + 1}`,
      email: `huesped.${index + 1}@example.com`,
      phone,
      mobile: phone,
      address: "Calle Ficticia 123",
      comments: "COMMENT-SECRET: generated booking",
      notes: "NOTE-SECRET: generated booking",
      channel: "airbnb",
      apiSource: "Airbnb.com",
      referer: "Airbnb",
      bookingTime: `${addDays(today, -30)}T10:00:00Z`,
      modifiedTime: `${addDays(today, -20)}T10:00:00Z`,
      cancelTime: null,
    };
  });
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

function shiftDateTime(value: string | null | undefined, days: number): string | null | undefined {
  if (!value) return value;
  return new Date(Date.parse(value) + days * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
}
