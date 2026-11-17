import { describe, expect, it } from "vitest";
import { Beds24Adapter } from "../../src/pms/beds24/adapter.js";
import {
  BEDS24_FIXTURE_CREDENTIALS,
  createBeds24FixtureServer,
} from "../../src/pms/beds24/fixture-server.js";
import { HostexAdapter } from "../../src/pms/hostex/adapter.js";
import {
  createHostexFixtureServer,
  HOSTEX_FIXTURE_TOKEN,
} from "../../src/pms/hostex/fixture-server.js";

/**
 * Connecting a PMS (checking the credential) and listing its listings take 15 s or less at p95
 * (002 plan, Performance Budget; T124). Each provider request is counted on the fixture servers
 * and given the per-request latency below, on a simulated clock, together with any wait the
 * adapters' throttles ask for. The latency is an assumption until the fixtures are replaced with
 * recordings from test accounts (T129).
 *
 * The fixture accounts are small. A Hostex account takes one more request per Airbnb-linked
 * listing (its price and rules), so a large Hostex account can take longer than this.
 */
const BUDGET_MS = 15_000;
/** p95 latency of one provider request (assumed; T129 replaces it with recorded values). */
const REQUEST_LATENCY_MS = 2_000;

describe("PMS credential check and listing (Performance Budget)", () => {
  it("Beds24: within 15 s at the assumed latency", async () => {
    let clock = Date.now();
    let waited = 0;
    const server = createBeds24FixtureServer({ now: () => clock });
    const adapter = new Beds24Adapter({
      fetch: (input, init) => server.handle(new Request(input, init)),
      sleep: async (ms) => {
        waited += ms;
        clock += ms;
      },
      now: () => clock,
    });

    const connected = await adapter.validateCredential(BEDS24_FIXTURE_CREDENTIALS.inviteCode);
    const checking = server.requests.length * REQUEST_LATENCY_MS + waited;
    const before = server.requests.length;
    const listings = await adapter.listListings(connected.credential);
    const listing = (server.requests.length - before) * REQUEST_LATENCY_MS;

    expect(listings.length).toBeGreaterThan(0);
    expect(
      checking + listing,
      `${server.requests.length} requests, ${waited} ms waited`,
    ).toBeLessThanOrEqual(BUDGET_MS);
  });

  it("Hostex: within 15 s at the assumed latency", async () => {
    let waited = 0;
    const server = createHostexFixtureServer({ now: () => Date.now() });
    const adapter = new HostexAdapter({
      fetch: (input, init) => server.handle(new Request(input, init)),
      sleep: async (ms) => {
        waited += ms;
      },
    });

    const connected = await adapter.validateCredential(HOSTEX_FIXTURE_TOKEN);
    const checking = server.requests.length * REQUEST_LATENCY_MS + waited;
    const before = server.requests.length;
    const listings = await adapter.listListings(connected.credential);
    const listing = (server.requests.length - before) * REQUEST_LATENCY_MS;

    expect(listings.length).toBeGreaterThan(0);
    expect(
      checking + listing,
      `${server.requests.length} requests, ${waited} ms waited`,
    ).toBeLessThanOrEqual(BUDGET_MS);
  });
});
