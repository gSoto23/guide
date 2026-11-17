// Load test for the feature 002 property endpoints (002 plan, Performance Budget; T124).
//
// Budget: p95 ≤ 300 ms for the property list and detail, stays, listing content, and import
// status, excluding sandbox, PMS, and AI calls. Requests go through the portal's origin, as
// browsers do: the Next.js rewrite locally, CloudFront in AWS.
//
// Sessions and data come from one of two places:
// - Locally (default): setup() signs in USERS new accounts with email codes read from Mailpit,
//   and gives each a property with a stay added by hand and its listing content. Sign-in codes
//   are limited to 20 per hour per IP, so keep USERS small and clear the counters between runs.
// - Staging: pass SESSION_COOKIES, a comma-separated list of `name=value` session cookies from
//   test accounts that already have a property. Never use real user sessions.
//
// Run locally (k6 in Docker reaches the host through host.docker.internal):
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 -e ORIGIN=http://localhost:3000 \
//     -e MAILPIT_URL=http://host.docker.internal:8025 grafana/k6:1.8.2 run - < perf/k6/properties.js
import http from "k6/http";
import { check, fail, group, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MAILPIT_URL = (__ENV.MAILPIT_URL || "http://localhost:8025").replace(/\/$/, "");
const USERS = Number(__ENV.USERS || 4);
const VUS = Number(__ENV.VUS || 8);
const DURATION = __ENV.DURATION || "1m";
const ORIGIN = (__ENV.ORIGIN || BASE_URL).replace(/\/$/, "");
const HEADERS = { Origin: ORIGIN, "Content-Type": "application/json" };

export const options = {
  scenarios: {
    properties: {
      executor: "ramping-vus",
      exec: "browse",
      startVUs: 0,
      stages: [
        { duration: "20s", target: VUS },
        { duration: DURATION, target: VUS },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    // The budget applies to the load phase, not to the sign-ins and seeding in setup().
    "http_req_duration{scenario:properties}": ["p(95)<300"],
    "http_req_failed{scenario:properties}": ["rate<0.01"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function waitForCode(email) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const search = http.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`,
      { tags: { name: "mailpit" } },
    );
    const summary = search.status === 200 ? search.json("messages.0") : null;
    if (summary) {
      const message = http.get(`${MAILPIT_URL}/api/v1/message/${summary.ID}`, {
        tags: { name: "mailpit" },
      });
      const code = /\b(\d{6})\b/.exec(message.json("Text"));
      if (code) return code[1];
    }
    sleep(0.5);
  }
  return fail(`No sign-in code for ${email} in Mailpit`);
}

function sessionCookie(response) {
  const cookies = response.cookies || {};
  for (const name of Object.keys(cookies)) {
    if (name.endsWith("session_token")) return `${name}=${cookies[name][0].value}`;
  }
  return fail("The sign-in response set no session cookie");
}

function signInWithEmailCode(index) {
  const email = `k6-properties-${Date.now()}-${index}@example.com`;
  const sent = http.post(
    `${BASE_URL}/api/auth/email-otp/send-verification-otp`,
    JSON.stringify({ email, type: "sign-in" }),
    { headers: HEADERS, tags: { name: "send-code" } },
  );
  if (sent.status !== 200) fail(`Sending a code answered ${sent.status}: ${sent.body}`);
  const signedIn = http.post(
    `${BASE_URL}/api/auth/sign-in/email-otp`,
    JSON.stringify({ email, otp: waitForCode(email) }),
    { headers: HEADERS, tags: { name: "sign-in" } },
  );
  if (signedIn.status !== 200) fail(`Sign-in answered ${signedIn.status}: ${signedIn.body}`);
  return sessionCookie(signedIn);
}

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** A fictional property with a stay and listing content, so every read returns real rows. */
function seedProperty(workspace, headers) {
  const created = http.post(
    `${workspace}/properties`,
    JSON.stringify({
      name: "Casa de carga",
      addressLine1: "Calle Ficticia 123",
      city: "Sámara",
      country: "CR",
      timeZone: "America/Costa_Rica",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
      guideLanguages: ["es", "en"],
      source: "manual",
    }),
    { headers },
  );
  if (created.status !== 201) fail(`Creating a property answered ${created.status}`);
  const propertyId = created.json("id");
  http.post(
    `${workspace}/properties/${propertyId}/stays`,
    JSON.stringify({ checkInDate: day(5), checkoutDate: day(8), guestCount: 2 }),
    { headers },
  );
  http.put(
    `${workspace}/properties/${propertyId}/listing-content/description`,
    JSON.stringify({ body: "Casa frente al mar, a dos cuadras de la playa." }),
    { headers },
  );
  return propertyId;
}

export function setup() {
  const cookies = __ENV.SESSION_COOKIES
    ? __ENV.SESSION_COOKIES.split(",").map((cookie) => cookie.trim())
    : Array.from({ length: USERS }, (_, index) => signInWithEmailCode(index));
  return cookies.map((cookie) => {
    const headers = { ...HEADERS, Cookie: cookie };
    const me = http.get(`${BASE_URL}/api/v1/me`, { headers });
    if (me.status !== 200) fail(`GET /api/v1/me answered ${me.status} during setup`);
    const workspaceId = me.json("lastWorkspaceId");
    if (!workspaceId) fail("The test account has no workspace");
    const workspace = `${BASE_URL}/api/v1/workspaces/${workspaceId}`;
    const list = http.get(`${workspace}/properties`, { headers });
    const existing = list.status === 200 ? list.json("items.0.id") : null;
    const propertyId = existing || seedProperty(workspace, headers);
    return { cookie, workspaceId, propertyId };
  });
}

/** One host on the property screens: the list, a property with its stays and content, imports. */
export function browse(users) {
  const user = users[(__VU - 1) % users.length];
  const params = (name) => ({
    headers: { ...HEADERS, Cookie: user.cookie },
    tags: { name },
    jar: null,
  });
  const workspace = `${BASE_URL}/api/v1/workspaces/${user.workspaceId}`;
  const property = `${workspace}/properties/${user.propertyId}`;

  group("list", () => {
    const responses = http.batch([
      ["GET", `${workspace}/properties`, null, params("properties")],
      ["GET", `${workspace}/properties/limits`, null, params("limits")],
      ["GET", `${workspace}/imports?status=running`, null, params("imports-running")],
    ]);
    check(responses, { "list reads 200": (list) => list.every((r) => r.status === 200) });
  });

  group("detail", () => {
    const responses = http.batch([
      ["GET", property, null, params("property")],
      ["GET", `${property}/stays`, null, params("stays")],
      ["GET", `${property}/listing-content`, null, params("listing-content")],
      ["GET", `${property}/calendar-feeds`, null, params("calendar-feeds")],
    ]);
    check(responses, { "detail reads 200": (list) => list.every((r) => r.status === 200) });
  });

  sleep(1);
}
