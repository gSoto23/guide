import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/node";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  MINIMAL_DATA_COLLECTION,
  scrubBreadcrumb,
  scrubEvent,
  stripQuery,
} from "@guidesk/observability";
import { startIcalServer, type IcalServer } from "@guidesk/testing/ical-server";
import { systemQuery } from "./helpers.js";
import {
  captureLogs,
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The feature 002 security sweep on the API (T122, quickstart 12, SC-003, AC-SEC-008): every
 * flow runs with known secrets, a feed link, a PMS token, codes, and a guest name, and none
 * appears in logs, responses, emails, readable columns, or Sentry events. Guest names are shown
 * to members on the stays list by design (FR-030), and only there.
 *
 * The worker's side (its jobs, spans, and emails) is swept in
 * apps/worker/test/integration/security-review-002.test.ts. The same `404` across workspaces is
 * checked on every new route in cross-tenant.test.ts (T123, AC-SEC-009). All data is fictional.
 */
const FEED_TOKEN = "s3cr3t-feed-7f3a9c1b2d";
const SECOND_FEED_TOKEN = "s3cr3t-feed-other-55e1";
const BLOCKED_TOKEN = "s3cr3t-feed-blocked-91aa";
const BEDS24_INVITE = "FIXTURE-BEDS24-INVITE";
const BEDS24_REFRESH = "fixture-beds24-refresh";
const BEDS24_ACCESS = "fixture-beds24-access";
const DOOR_CODE = "4821";
const WIFI_PASSWORD = "sunshine99";
const LOCKBOX_CODE = "7392";
const GUEST_NAME = "Rosaura Prueba Secreta";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let ical: IcalServer;
/** A private folder with a unique name for this run's test certificates (CodeQL js/insecure-temporary-file). */
const certificateDir = mkdtempSync(join(tmpdir(), "guidesk-ical-certs-"));
let team: TeamWorkspace;
let logs: ReturnType<typeof captureLogs>;
/** Every response body, with the route it answered. */
const responses: { route: string; body: string }[] = [];
let feedUrl: string;

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function call(
  member: TeamWorkspace["owner"],
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  payload?: object,
) {
  const response = await wsApi(ctx, member, method, team.workspaceId, path, payload);
  responses.push({ route: `${method} ${path}`, body: response.body });
  return response;
}

beforeAll(async () => {
  ical = await startIcalServer(certificateDir);
  ctx = await createTestApp(inject("databaseUrl"), {
    SANDBOX_TEST_ALLOW_HOST: ical.host,
    SANDBOX_TEST_CA_FILE: ical.caFile,
    PMS_BEDS24: "true",
    PMS_HOSTEX: "true",
  });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "sweep");
  await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [team.workspaceId]);
  for (const name of [FEED_TOKEN, SECOND_FEED_TOKEN]) {
    ical.setFeed(name, [
      { uid: `${name}-1@fixture.test`, start: day(3), end: day(6), summary: "Reserved" },
    ]);
  }
  feedUrl = ical.url(FEED_TOKEN);

  logs = captureLogs();
  try {
    // A property, its calendar link (saved, changed, and refused), and "Refresh now".
    const created = await call(team.owner, "POST", "/properties", {
      ...READY_FACTS,
      source: "manual",
    });
    const propertyId = (created.json() as { id: string }).id;
    const feed = await call(team.owner, "POST", `/properties/${propertyId}/calendar-feeds`, {
      url: feedUrl,
      channel: "airbnb",
    });
    const feedId = (feed.json() as { id: string }).id;
    await call(team.agent, "GET", `/properties/${propertyId}/calendar-feeds`);
    await call(team.owner, "GET", `/properties/${propertyId}/calendar-feeds`);
    await call(team.owner, "PATCH", `/calendar-feeds/${feedId}`, {
      url: ical.url(SECOND_FEED_TOKEN),
    });
    await call(team.owner, "POST", `/properties/${propertyId}/calendar-feeds`, {
      url: `https://169.254.169.254/calendar/${BLOCKED_TOKEN}.ics`,
      channel: "booking",
    });
    await call(team.owner, "POST", `/properties/${propertyId}/calendar-feeds/refresh`);

    // A stay with a guest name, and the property seen from every side.
    await call(team.owner, "POST", `/properties/${propertyId}/stays`, {
      checkInDate: day(10),
      checkoutDate: day(12),
      guestCount: 2,
      guestName: GUEST_NAME,
    });
    await call(team.agent, "GET", `/properties/${propertyId}/stays`);
    await call(team.agent, "GET", `/properties/${propertyId}`);
    await call(team.owner, "GET", `/properties/${propertyId}`);
    await call(team.owner, "GET", "/properties");
    await call(team.owner, "DELETE", `/properties/${propertyId}?dryRun=true`);
    await call(team.owner, "GET", `/properties/${propertyId}/duplicate-draft`);

    // Codes typed in pasted text and in listing content.
    await call(team.owner, "POST", "/extractions", {
      text: `Casa frente al mar. Door code ${DOOR_CODE}. WiFi password: ${WIFI_PASSWORD}. Lockbox ${LOCKBOX_CODE}.`,
    });
    await call(team.owner, "PUT", `/properties/${propertyId}/listing-content/house_rules`, {
      body: `No fumar. Door code ${DOOR_CODE}.`,
    });

    // A PMS token: connected, listed, and an invalid one refused.
    await call(team.owner, "POST", "/pms-connections", {
      provider: "beds24",
      credential: BEDS24_INVITE,
    });
    await call(team.owner, "GET", "/pms-connections");
    await call(team.owner, "POST", "/pms-connections", {
      provider: "hostex",
      credential: `${BEDS24_REFRESH}-not-hostex`,
    });
  } finally {
    logs.stop();
  }
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
  await ical.close();
  rmSync(certificateDir, { recursive: true, force: true });
});

/** Each secret with the forms it could leak in. */
const SECRETS = [
  FEED_TOKEN,
  SECOND_FEED_TOKEN,
  BLOCKED_TOKEN,
  BEDS24_INVITE,
  BEDS24_REFRESH,
  BEDS24_ACCESS,
  WIFI_PASSWORD,
  `code ${DOOR_CODE}`,
  `Lockbox ${LOCKBOX_CODE}`,
];

describe("feature 002 security sweep: the API (T122, SC-003)", () => {
  it("ran every flow", () => {
    expect(responses.length).toBeGreaterThan(15);
    expect(responses.find((r) => r.route.startsWith("POST /pms-connections"))?.body).toMatch(
      /"provider":"beds24"/,
    );
  });

  it("keeps every secret out of the logs (AC-SEC-008)", () => {
    logs.expectNoSecrets([...SECRETS, GUEST_NAME, feedUrl]);
  });

  it("keeps every secret out of the responses, and guest names to the stays list", () => {
    for (const { route, body } of responses) {
      for (const secret of [...SECRETS, feedUrl]) {
        expect(body.includes(secret), `${secret} in ${route}`).toBe(false);
      }
      if (!/\/stays$/.test(route)) {
        expect(body.includes(GUEST_NAME), `the guest name in ${route}`).toBe(false);
      }
    }
  });

  it("keeps every secret out of the emails", () => {
    for (const message of ctx.email.sent) {
      const text = `${message.subject}\n${message.text}\n${message.html}`;
      for (const secret of [...SECRETS, GUEST_NAME, feedUrl]) {
        expect(text.includes(secret), `${secret} in ${message.template}`).toBe(false);
      }
    }
  });

  it("stores links, tokens, and codes only encrypted or redacted", async () => {
    const { rows: feeds } = await db.query<{ url_ciphertext: Buffer; display_hint: string }>(
      `SELECT url_ciphertext, display_hint FROM calendar_feed WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(feeds).toHaveLength(1);
    for (const feed of feeds) {
      expect(feed.url_ciphertext.toString("latin1")).not.toMatch(/s3cr3t-feed/);
      expect(feed.display_hint).not.toMatch(/s3cr3t-feed/);
    }
    const { rows: connections } = await db.query<{ credential_ciphertext: Buffer }>(
      `SELECT credential_ciphertext FROM pms_connection WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]!.credential_ciphertext.toString("latin1")).not.toMatch(/fixture-beds24/);
    const { rows: extractions } = await db.query<{ input_text: string }>(
      `SELECT input_text FROM extraction_request WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(extractions).toHaveLength(1);
    for (const secret of [DOOR_CODE, WIFI_PASSWORD, LOCKBOX_CODE]) {
      expect(extractions[0]!.input_text).not.toContain(secret);
    }
    const { rows: content } = await db.query(
      `SELECT 1 FROM listing_content WHERE workspace_id = $1 AND body LIKE $2`,
      [team.workspaceId, `%${DOOR_CODE}%`],
    );
    expect(content).toEqual([]);
  });

  it("keeps every secret out of Sentry events, through the app's own Sentry settings", async () => {
    const envelopes: string[] = [];
    Sentry.init({
      dsn: "https://public@o0.ingest.example.invalid/1",
      dataCollection: MINIMAL_DATA_COLLECTION,
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      integrations: [],
      defaultIntegrations: false,
      transport: (options) =>
        Sentry.createTransport(options, async (request) => {
          envelopes.push(
            typeof request.body === "string"
              ? request.body
              : Buffer.from(request.body).toString("utf8"),
          );
          return { statusCode: 200 };
        }),
    });
    // An error during a feed save, as Sentry would see it in the API: the request with its
    // body, headers, and query, a breadcrumb of an earlier request, and a guest's name on the
    // user. The API never fetches the link itself: in AWS the feed reader does, and its own
    // Sentry keeps no breadcrumbs (apps/sandbox/src/observability.ts).
    Sentry.addBreadcrumb({
      category: "http",
      data: {
        url: `https://app.example.test/api/v1/workspaces/w/properties?link=${encodeURIComponent(feedUrl)}`,
        method: "GET",
      },
    });
    Sentry.withScope((scope) => {
      scope.setUser({ email: "rosaura@example.com", username: GUEST_NAME });
      scope.setExtra("credential", BEDS24_REFRESH);
      scope.addEventProcessor((event) => ({
        ...event,
        request: {
          url: `https://app.example.test/api/v1/workspaces/w/properties/p/calendar-feeds?link=${encodeURIComponent(feedUrl)}`,
          method: "POST",
          data: JSON.stringify({ url: feedUrl, credential: BEDS24_INVITE }),
          headers: { cookie: "session=abc", authorization: `Bearer ${BEDS24_ACCESS}` },
          cookies: { session: "abc" },
          query_string: `wifi=${WIFI_PASSWORD}`,
        },
      }));
      Sentry.captureException(new Error("The feed could not be saved"));
    });
    await Sentry.flush(2000);
    await Sentry.close();
    expect(envelopes.length).toBeGreaterThan(0);
    const sent = envelopes.join("\n");
    expect(sent).toContain("The feed could not be saved");
    for (const secret of [...SECRETS, GUEST_NAME, feedUrl, "rosaura@example.com"]) {
      expect(sent.includes(secret), `${secret} in a Sentry event`).toBe(false);
    }
    expect(stripQuery(`${feedUrl}?token=x`)).toBe(feedUrl);
  });
});
