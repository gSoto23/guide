import { describe, expect, it } from "vitest";
import { createFeedReader } from "../src/feed-reader/reader.js";
import {
  isPublicAddress,
  safeFetch,
  type HopRequest,
  type HopResponse,
  type Resolver,
  type Send,
} from "../src/feed-reader/safe-fetch.js";

/**
 * SSRF and parsing rules of the feed reader (T068, FR-022, FR-026, AC-SEC-002), with a fake DNS
 * resolver and a fake transport. All hosts and calendars are fictional.
 */
const PUBLIC = "93.184.216.34";

function resolver(table: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  const resolve = async (hostname: string) => {
    calls.push(hostname);
    const addresses = table[hostname];
    if (!addresses) throw new Error("ENOTFOUND");
    return addresses.map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }));
  };
  return Object.assign(resolve, { calls });
}

function body(text: string): HopResponse["body"] {
  const bytes = Buffer.from(text);
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
    destroy: () => undefined,
  };
}

/** Answers each hop from a script keyed by URL; records what was sent where. */
function transport(script: Record<string, Partial<HopResponse> & { text?: string }>): Send & {
  hops: HopRequest[];
} {
  const hops: HopRequest[] = [];
  const send = async (hop: HopRequest): Promise<HopResponse> => {
    hops.push(hop);
    const answer = script[hop.url.toString()];
    if (!answer) throw new Error("no route");
    return {
      status: answer.status ?? 200,
      headers: answer.headers ?? {},
      body: answer.body ?? body(answer.text ?? ""),
    };
  };
  return Object.assign(send, { hops });
}

const ICAL = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Fictional//Calendar//EN",
  "BEGIN:VEVENT",
  "UID:res-1@example.test",
  "DTSTART;VALUE=DATE:20270120",
  "DTEND;VALUE=DATE:20270122",
  "SUMMARY:Reserved",
  "DESCRIPTION:Reservation URL: https://example.test/r/HMABCDEFGH\\nPhone: +506 8888 0000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:block-1@example.test",
  "DTSTART;VALUE=DATE:20270201",
  "DTEND;VALUE=DATE:20270203",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:open-1@example.test",
  "DTSTART;VALUE=DATE:20270301",
  "DTEND;VALUE=DATE:20270304",
  "SUMMARY:CLOSED - Not available",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:past-1@example.test",
  "DTSTART;VALUE=DATE:20260101",
  "DTEND;VALUE=DATE:20260103",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const now = () => new Date("2027-01-10T12:00:00Z");

describe("address checks (FR-026, AC-SEC-002)", () => {
  it("refuses http:// links", async () => {
    const read = createFeedReader({ resolve: resolver({}), send: transport({}), now });
    expect(await read({ url: "http://calendar.example.test/feed.ics" })).toEqual({
      error: "not_https",
    });
  });

  it.each([
    "169.254.169.254",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.5.4",
    "192.168.1.10",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
  ])("refuses the address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("accepts public unicast addresses", () => {
    expect(isPublicAddress(PUBLIC)).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("refuses a link to an IP literal in a private range, without sending anything", async () => {
    const send = transport({});
    const read = createFeedReader({ resolve: resolver({}), send, now });
    expect(await read({ url: "https://169.254.169.254/latest" })).toEqual({
      error: "blocked_address",
    });
    expect(await read({ url: "https://[::1]/feed.ics" })).toEqual({ error: "blocked_address" });
    expect(send.hops).toEqual([]);
  });

  it("refuses a public name that resolves to a private address", async () => {
    const send = transport({});
    const read = createFeedReader({
      resolve: resolver({ "internal.example.test": [PUBLIC, "10.0.0.5"] }),
      send,
      now,
    });
    expect(await read({ url: "https://internal.example.test/feed.ics" })).toEqual({
      error: "blocked_address",
    });
    expect(send.hops).toEqual([]);
  });

  it("checks every redirect again, and refuses one to 127.0.0.1", async () => {
    const send = transport({
      "https://calendar.example.test/feed.ics": {
        status: 302,
        headers: { location: "https://127.0.0.1/admin" },
      },
    });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    expect(await read({ url: "https://calendar.example.test/feed.ics" })).toEqual({
      error: "blocked_address",
    });
    expect(send.hops).toHaveLength(1);
  });

  it("refuses a redirect to a name that resolves to a private address, and to http://", async () => {
    const send = transport({
      "https://calendar.example.test/a": {
        status: 301,
        headers: { location: "https://rebind.example.test/b" },
      },
      "https://calendar.example.test/c": {
        status: 301,
        headers: { location: "http://calendar.example.test/d" },
      },
    });
    const read = createFeedReader({
      resolve: resolver({
        "calendar.example.test": [PUBLIC],
        "rebind.example.test": ["192.168.0.10"],
      }),
      send,
      now,
    });
    expect(await read({ url: "https://calendar.example.test/a" })).toEqual({
      error: "blocked_address",
    });
    expect(await read({ url: "https://calendar.example.test/c" })).toEqual({ error: "not_https" });
  });

  it("follows at most 3 redirects", async () => {
    const hop = (n: number) => `https://calendar.example.test/${n}`;
    const send = transport({
      [hop(0)]: { status: 302, headers: { location: hop(1) } },
      [hop(1)]: { status: 302, headers: { location: hop(2) } },
      [hop(2)]: { status: 302, headers: { location: hop(3) } },
      [hop(3)]: { status: 302, headers: { location: hop(4) } },
      [hop(4)]: { text: ICAL },
    });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    expect(await read({ url: hop(0) })).toEqual({ error: "too_many_redirects" });
    expect(send.hops).toHaveLength(4);

    const three = transport({
      [hop(1)]: { status: 302, headers: { location: hop(2) } },
      [hop(2)]: { status: 302, headers: { location: hop(3) } },
      [hop(3)]: { status: 302, headers: { location: hop(4) } },
      [hop(4)]: { text: ICAL },
    });
    const ok = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send: three,
      now,
    });
    expect(await ok({ url: hop(1) })).toMatchObject({ entries: expect.any(Array) });
  });

  it("connects to the address it checked, resolving each host once per hop (DNS rebinding)", async () => {
    const resolve = resolver({ "calendar.example.test": [PUBLIC] });
    const send = transport({ "https://calendar.example.test/feed.ics": { text: ICAL } });
    const read = createFeedReader({ resolve, send, now });
    await read({ url: "https://calendar.example.test/feed.ics" });
    expect(resolve.calls).toEqual(["calendar.example.test"]);
    expect(send.hops.map((hop) => [hop.url.hostname, hop.address])).toEqual([
      ["calendar.example.test", PUBLIC],
    ]);
  });

  it("lets only the configured test host resolve privately (development and test)", async () => {
    const send = transport({ "https://localhost:4443/feed.ics": { text: ICAL } });
    const read = createFeedReader({
      resolve: resolver({ localhost: ["127.0.0.1"] }),
      send,
      testAllowHost: "localhost",
      now,
    });
    expect(await read({ url: "https://localhost:4443/feed.ics" })).toMatchObject({
      entries: expect.any(Array),
    });
  });
});

describe("limits (FR-026)", () => {
  it("stops reading at 2 MB", async () => {
    const big = Buffer.alloc(1024 * 1024, 65);
    const send = transport({
      "https://calendar.example.test/big.ics": {
        body: {
          async *[Symbol.asyncIterator]() {
            yield big;
            yield big;
            yield big;
          },
          destroy: () => undefined,
        },
      },
      "https://calendar.example.test/declared.ics": {
        headers: { "content-length": String(3 * 1024 * 1024) },
      },
    });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    expect(await read({ url: "https://calendar.example.test/big.ics" })).toEqual({
      error: "too_large",
    });
    expect(await read({ url: "https://calendar.example.test/declared.ics" })).toEqual({
      error: "too_large",
    });
  });

  it("gives up after the time limit", async () => {
    const slow: Send = (hop) =>
      new Promise((_resolve, reject) => {
        hop.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const result = await safeFetch("https://calendar.example.test/slow.ics", {
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send: slow,
      timeoutMs: 50,
    });
    expect(result).toEqual({ error: "timeout" });
  });

  it("reports DNS failures and HTTP errors by code", async () => {
    const send = transport({ "https://calendar.example.test/missing.ics": { status: 404 } });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    expect(await read({ url: "https://unknown.example.test/feed.ics" })).toEqual({
      error: "dns_failed",
    });
    expect(await read({ url: "https://calendar.example.test/missing.ics" })).toEqual({
      error: "http_404",
    });
  });
});

describe("parsing (FR-022, R8)", () => {
  it("returns only {uid, start, end, kind}, drops blocks' text and past entries", async () => {
    const send = transport({
      "https://calendar.example.test/feed.ics": {
        text: ICAL,
        headers: { etag: '"v1"', "last-modified": "Sun, 10 Jan 2027 10:00:00 GMT" },
      },
    });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    const result = await read({ url: "https://calendar.example.test/feed.ics" });
    expect(result).toEqual({
      entries: [
        { uid: "res-1@example.test", start: "2027-01-20", end: "2027-01-22", kind: "reservation" },
        { uid: "block-1@example.test", start: "2027-02-01", end: "2027-02-03", kind: "block" },
        { uid: "open-1@example.test", start: "2027-03-01", end: "2027-03-04", kind: "unlabeled" },
      ],
      etag: '"v1"',
      lastModified: "Sun, 10 Jan 2027 10:00:00 GMT",
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/HMABCDEFGH|8888|Reservation URL|Not available|CLOSED/);
  });

  it("sends the conditional headers and reports a 304 as not modified", async () => {
    const send = transport({
      "https://calendar.example.test/feed.ics": { status: 304, headers: { etag: '"v1"' } },
    });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    const result = await read({
      url: "https://calendar.example.test/feed.ics",
      etag: '"v1"',
      lastModified: "Sun, 10 Jan 2027 10:00:00 GMT",
    });
    expect(result).toEqual({ notModified: true, etag: '"v1"', lastModified: null });
    expect(send.hops[0]?.headers).toMatchObject({
      "if-none-match": '"v1"',
      "if-modified-since": "Sun, 10 Jan 2027 10:00:00 GMT",
    });
  });

  it("answers not_ical for a body that is not a calendar", async () => {
    const send = transport({
      "https://calendar.example.test/page.html": { text: "<html>Not a calendar</html>" },
    });
    const read = createFeedReader({
      resolve: resolver({ "calendar.example.test": [PUBLIC] }),
      send,
      now,
    });
    expect(await read({ url: "https://calendar.example.test/page.html" })).toEqual({
      error: "not_ical",
    });
  });
});
