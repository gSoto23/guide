// Load test for the feature 003 guide endpoints (003 plan, Performance Budget; T122).
//
// Budget: p95 ≤ 300 ms for the guide read, an item save, an approval, a topic mark, and the
// publish check, excluding AI, sandbox, and translation work (those run in the worker). Requests
// go through the portal's origin, as browsers do: the Next.js rewrite locally, CloudFront in AWS.
//
// Sessions and data come from one of two places:
// - Locally (default): setup() signs in USERS new accounts with email codes read from Mailpit and
//   gives each a property, whose guide is created with it. Sign-in codes are limited to 20 per
//   hour per IP, so keep USERS small and clear the counters between runs.
// - Staging: pass SESSION_COOKIES, a comma-separated list of `name=value` session cookies from
//   test accounts that already have a property. Never use real user sessions.
//
// Run locally (k6 in Docker reaches the host through host.docker.internal):
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 -e ORIGIN=http://localhost:3000 \
//     -e MAILPIT_URL=http://host.docker.internal:8025 grafana/k6:1.8.2 run - < perf/k6/guides.js
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
    guides: {
      executor: "ramping-vus",
      exec: "edit",
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
    "http_req_duration{scenario:guides}": ["p(95)<300"],
    "http_req_failed{scenario:guides}": ["rate<0.01"],
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
  const email = `k6-guides-${Date.now()}-${index}@example.com`;
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

/** A fictional property; its guide is created with it. */
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
  return created.json("id");
}

const doc = (text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

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
    // One text item per account, so saves and approvals touch a real row.
    const guide = http.get(`${workspace}/properties/${propertyId}/guide`, { headers });
    if (guide.status !== 200) fail(`GET guide answered ${guide.status} during setup`);
    const sections = guide.json("sections");
    const section = sections.find((candidate) => candidate.kind === "appliances");
    const item = http.post(
      `${workspace}/properties/${propertyId}/guide/sections/${section.id}/items`,
      JSON.stringify({
        revision: section.revision,
        kind: "text",
        language: "es",
        doc: doc("El aire acondicionado se enciende con el control remoto."),
      }),
      { headers },
    );
    if (item.status !== 201) fail(`Adding an item answered ${item.status}`);
    return { cookie, workspaceId, propertyId, sectionId: section.id, itemId: item.json("item.id") };
  });
}

/** One host editing: the guide, an autosave, an approval, a topic mark, and the publish check. */
export function edit(users) {
  const user = users[(__VU - 1) % users.length];
  const params = (name) => ({
    headers: { ...HEADERS, Cookie: user.cookie },
    tags: { name },
    jar: null,
  });
  const guide = `${BASE_URL}/api/v1/workspaces/${user.workspaceId}/properties/${user.propertyId}/guide`;

  let revision = 0;
  group("read", () => {
    const response = http.get(guide, params("guide"));
    check(response, { "guide reads 200": (r) => r.status === 200 });
    const section =
      response.status === 200
        ? response.json("sections").find((candidate) => candidate.id === user.sectionId)
        : null;
    revision = section ? section.revision : 0;
  });

  group("write", () => {
    const saved = http.patch(
      `${guide}/items/${user.itemId}`,
      JSON.stringify({
        revision,
        language: "es",
        doc: doc(`El aire acondicionado se enciende con el control remoto (${__ITER}).`),
      }),
      params("item-save"),
    );
    // Another virtual user on the same account may have saved first: 409 is part of the flow.
    check(saved, { "save answers 200 or 409": (r) => r.status === 200 || r.status === 409 });
    const next = saved.status === 200 ? saved.json("section.revision") : null;
    if (next !== null) {
      const approved = http.post(
        `${guide}/items/${user.itemId}/approve`,
        JSON.stringify({ revision: next }),
        params("item-approve"),
      );
      check(approved, {
        "approve answers 200 or 409": (r) => r.status === 200 || r.status === 409,
      });
    }
    const marked = http.put(
      `${guide}/topics/wifi.troubleshooting`,
      JSON.stringify({ mark: __ITER % 2 === 0 ? "not_applicable" : null }),
      params("topic-mark"),
    );
    check(marked, { "mark answers 200": (r) => r.status === 200 });
  });

  group("publish check", () => {
    const response = http.get(`${guide}/publish-check`, params("publish-check"));
    check(response, { "publish check reads 200": (r) => r.status === 200 });
  });

  sleep(1);
}
