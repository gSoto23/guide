import { readFileSync } from "node:fs";

/** The only access token the fixture server accepts (shared brief, fixture credentials). */
export const HOSTEX_FIXTURE_TOKEN = "FIXTURE-HOSTEX-TOKEN";
/** A token on the Basic edition: every call answers `error_code` 420 with HTTP 200. */
export const HOSTEX_FIXTURE_BASIC_TOKEN = "FIXTURE-HOSTEX-BASIC";

/** The property that generated reservations belong to (Casa Colibrí Sámara). */
export const HOSTEX_FIXTURE_PAGING_PROPERTY_ID = 910001;

export interface HostexFixtureServerOptions {
  /** The clock that relative fixture dates (`@date(+3)`) resolve against. Default `Date.now`. */
  now?: () => number;
  /**
   * The first `times` authenticated requests answer `error_code` 429 with HTTP 200 and a
   * `Retry-After` of `retryAfterSeconds` (default 7; null leaves the header out).
   */
  rateLimit?: { times: number; retryAfterSeconds?: number | null };
  /** Generated properties (no channels) appended after the fixture ones, for paging. */
  extraProperties?: number;
  /** Generated accepted reservations for the paging property, for paging. */
  extraReservations?: number;
}

export interface HostexFixtureRequest {
  method: string;
  url: string;
}

export interface HostexFixtureServer {
  handle(request: Request): Promise<Response>;
  /** Every request received, in order (method and URL only; never the token). */
  readonly requests: HostexFixtureRequest[];
}

type Json = Record<string, unknown>;

const DAY_MS = 86_400_000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
/** Hostex's default reservation window when no checkout dates are given. */
const DEFAULT_WINDOW_DAYS = 180;

function loadFixture(name: string): unknown {
  const url = new URL(`../../../fixtures/hostex/${name}.synthetic.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

/**
 * A Hostex Open API v3 stand-in for development and contract tests (T082, T092), answering from
 * the synthetic fixtures in `fixtures/hostex/` like the API would: HTTP 200 with the
 * `{request_id, error_code, error_msg, data}` envelope, offset paging, the documented filters,
 * and `Retry-After` on 429. Reservation dates are relative to `now`, so tests never go stale.
 */
export function createHostexFixtureServer(
  options: HostexFixtureServerOptions = {},
): HostexFixtureServer {
  const now = options.now ?? Date.now;
  // Read on creation, not on import, so production never touches these files.
  const account = loadFixture("accounts-me") as Json;
  const errors = loadFixture("errors") as Record<string, Json>;
  const propertiesFixture = loadFixture("properties") as { data: { properties: Json[] } };
  const reservationsFixture = loadFixture("reservations") as { data: { reservations: Json[] } };
  const rules = loadFixture("price-and-rules") as Record<string, Json>;

  const properties = [
    ...propertiesFixture.data.properties,
    ...Array.from({ length: options.extraProperties ?? 0 }, (_, index) => generatedProperty(index)),
  ];
  const requests: HostexFixtureRequest[] = [];
  let rateLimitedLeft = options.rateLimit?.times ?? 0;
  let requestCount = 0;

  const reply = (body: Json, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  const ok = (data: Json) =>
    reply({
      request_id: `RT-synthetic-${String(++requestCount).padStart(6, "0")}`,
      error_code: 200,
      error_msg: "Done.",
      data,
    });
  const error = (name: string, headers?: Record<string, string>) => reply(errors[name]!, headers);

  function reservations(): Json[] {
    const clock = now();
    const fixture = reservationsFixture.data.reservations.map(
      (item) => resolveDates(item, clock) as Json,
    );
    const generated = Array.from({ length: options.extraReservations ?? 0 }, (_, index) =>
      generatedReservation(index, clock),
    );
    // Hostex sorts by `booked_at`, newest first, by default.
    return [...fixture, ...generated].sort((a, b) =>
      String(b.booked_at).localeCompare(String(a.booked_at)),
    );
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    requests.push({ method: request.method, url: request.url });

    const token = request.headers.get("hostex-access-token");
    if (token === HOSTEX_FIXTURE_BASIC_TOKEN) return error("basic_edition");
    if (token !== HOSTEX_FIXTURE_TOKEN) return error("invalid_token");
    if (rateLimitedLeft > 0) {
      rateLimitedLeft -= 1;
      const seconds = options.rateLimit?.retryAfterSeconds;
      return error("rate_limited", seconds === null ? {} : { "Retry-After": String(seconds ?? 7) });
    }
    // The fixture token is read-only, like the token the host creates for Guidesk.
    if (request.method !== "GET") return error("read_only");

    if (!url.pathname.startsWith("/v3/")) return error("not_found");
    const path = url.pathname.slice("/v3".length);
    const params = url.searchParams;

    if (path === "/accounts/me") return reply(account);

    if (path === "/properties") {
      const id = params.get("id");
      if (id !== null && !/^\d+$/.test(id)) return error("bad_request");
      const matching =
        id === null ? properties : properties.filter((item) => String(item.id) === id);
      const { offset, limit } = paging(params);
      return ok({ properties: matching.slice(offset, offset + limit), total: matching.length });
    }

    if (path === "/reservations") {
      const today = isoDate(now());
      const from = params.get("start_check_out_date");
      const to = params.get("end_check_out_date");
      const start = from ?? (to === null ? today : "0000-01-01");
      const end =
        to ?? (from === null ? isoDate(now() + DEFAULT_WINDOW_DAYS * DAY_MS) : "9999-12-31");
      const filters: Array<[string, (item: Json) => boolean]> = [
        ["property_id", (item) => String(item.property_id) === params.get("property_id")],
        ["status", (item) => item.status === params.get("status")],
        ["reservation_code", (item) => item.reservation_code === params.get("reservation_code")],
        ["channel_type", (item) => item.channel_type === params.get("channel_type")],
      ];
      const matching = reservations().filter(
        (item) =>
          String(item.check_out_date) >= start &&
          String(item.check_out_date) <= end &&
          filters.every(([name, test]) => !params.has(name) || test(item)),
      );
      const { offset, limit } = paging(params);
      return ok({ reservations: matching.slice(offset, offset + limit) });
    }

    if (path === "/listings/airbnb/price_and_rules") {
      const listingId = params.get("listing_id");
      if (!listingId) return error("bad_request");
      const answer = rules[listingId];
      return answer ? reply(answer) : error("not_found");
    }

    return error("not_found");
  }

  return { handle, requests };
}

function paging(params: URLSearchParams): { offset: number; limit: number } {
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit") ?? DEFAULT_LIMIT) || 1));
  return { offset, limit };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDateTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** Replaces `@date(±N)` and `@datetime(±N)` with dates N days from `clock`. */
function resolveDates(value: unknown, clock: number): unknown {
  if (typeof value === "string") {
    const match = /^@(date|datetime)\(([+-]\d+)\)$/.exec(value);
    if (!match) return value;
    const at = clock + Number(match[2]) * DAY_MS;
    return match[1] === "date" ? isoDate(at) : isoDateTime(at);
  }
  if (Array.isArray(value)) return value.map((item) => resolveDates(item, clock));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveDates(item, clock)]),
    );
  }
  return value;
}

function generatedProperty(index: number): Json {
  const n = index + 1;
  return {
    id: 920000 + n,
    title: `Propiedad generada ${n}`,
    address: `Calle Ficticia ${n}, Ciudad Ejemplo`,
    latitude: "10.0000",
    longitude: "-84.0000",
    channels: [],
    groups: [],
    tags: [],
  };
}

function generatedReservation(index: number, clock: number): Json {
  const n = index + 1;
  const checkout = clock + (1 + (index % 300)) * DAY_MS;
  const code = `0-SYNGEN${String(n).padStart(4, "0")}-generated`;
  return {
    reservation_code: code,
    stay_code: code,
    channel_id: `SYN-GEN-${n}`,
    property_id: HOSTEX_FIXTURE_PAGING_PROPERTY_ID,
    channel_type: "airbnb",
    listing_id: "880000101",
    check_in_date: isoDate(checkout - 2 * DAY_MS),
    check_out_date: isoDate(checkout),
    number_of_guests: 2,
    status: "accepted",
    guest_name: `Huésped Generado ${n}`,
    guest_phone: "+1 202-555-0199",
    guest_email: `generated-${n}@example.com`,
    booked_at: isoDateTime(clock - (100 + n) * DAY_MS),
    created_at: isoDateTime(clock - (100 + n) * DAY_MS),
    remarks: `Synthetic generated remark ${n}`,
    check_in_details: { lock_code: null },
    guests: [],
    custom_fields: null,
  };
}
