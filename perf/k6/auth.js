// Load test for the auth and membership endpoints (spec 001 plan, Performance Budget; T102).
//
// Budget: p95 ≤ 300 ms for the API, excluding email delivery. Requests go through the portal's
// origin, as browsers do: the Next.js rewrite locally, CloudFront in AWS.
//
// Sessions come from one of two places:
// - Locally (default): setup() signs in USERS new accounts with email codes read from Mailpit.
//   Sign-in codes are limited to 20 per hour per IP, so keep USERS small and clear the counters
//   between runs (see the quickstart).
// - Staging: pass SESSION_COOKIES, a comma-separated list of `name=value` session cookies from
//   test accounts. Mailpit isn't used. Never use real user sessions.
//
// Run locally (k6 in Docker reaches the host through host.docker.internal):
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 -e ORIGIN=http://localhost:3000 \
//     -e MAILPIT_URL=http://host.docker.internal:8025 grafana/k6:1.8.2 run - < perf/k6/auth.js
import http from "k6/http";
import { check, fail, group, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MAILPIT_URL = (__ENV.MAILPIT_URL || "http://localhost:8025").replace(/\/$/, "");
const USERS = Number(__ENV.USERS || 5);
// Each VU loads about one page a second. /get-session allows 600 requests a minute per IP, so
// from one machine keep VUS at 8 or less, or the limit answers 429 by design; run several load
// generators for more.
const VUS = Number(__ENV.VUS || 8);
const DURATION = __ENV.DURATION || "1m";

// The API checks Origin against the portal URL (security review T103). Set ORIGIN when BASE_URL
// is another name for the same server, such as host.docker.internal.
const ORIGIN = (__ENV.ORIGIN || BASE_URL).replace(/\/$/, "");
const HEADERS = { Origin: ORIGIN, "Content-Type": "application/json" };

export const options = {
  scenarios: {
    members: {
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
    // The budget applies to the load phase, not to the sign-ins in setup().
    "http_req_duration{scenario:members}": ["p(95)<300"],
    "http_req_failed{scenario:members}": ["rate<0.01"],
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
  const email = `k6-${Date.now()}-${index}@example.com`;
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

export function setup() {
  const cookies = __ENV.SESSION_COOKIES
    ? __ENV.SESSION_COOKIES.split(",").map((cookie) => cookie.trim())
    : Array.from({ length: USERS }, (_, index) => signInWithEmailCode(index));
  return cookies.map((cookie) => {
    const me = http.get(`${BASE_URL}/api/v1/me`, { headers: { ...HEADERS, Cookie: cookie } });
    if (me.status !== 200) fail(`GET /api/v1/me answered ${me.status} during setup`);
    const workspaceId = me.json("lastWorkspaceId");
    if (!workspaceId) fail("The test account has no workspace");
    return { cookie, workspaceId };
  });
}

/** One host session: what the portal calls while someone moves around settings and the team. */
export function browse(users) {
  const user = users[(__VU - 1) % users.length];
  // The cookie goes in the header; the jar would add a second copy.
  const params = (name) => ({
    headers: { ...HEADERS, Cookie: user.cookie },
    tags: { name },
    jar: null,
  });
  const workspace = `${BASE_URL}/api/v1/workspaces/${user.workspaceId}`;

  group("session", () => {
    const session = http.get(`${BASE_URL}/api/auth/get-session`, params("get-session"));
    check(session, { "get-session 200": (r) => r.status === 200 && r.json("session") !== null });
    const me = http.get(`${BASE_URL}/api/v1/me`, params("me"));
    check(me, { "me 200": (r) => r.status === 200 });
  });

  group("membership", () => {
    const responses = http.batch([
      ["GET", workspace, null, params("workspace")],
      ["GET", `${workspace}/members`, null, params("members")],
      ["GET", `${workspace}/invitations`, null, params("invitations")],
      ["GET", `${workspace}/security-events?limit=20`, null, params("security-events")],
    ]);
    check(responses, { "membership reads 200": (list) => list.every((r) => r.status === 200) });
    const switched = http.put(
      `${BASE_URL}/api/v1/me/current-workspace`,
      JSON.stringify({ workspaceId: user.workspaceId }),
      params("current-workspace"),
    );
    check(switched, { "current-workspace 2xx": (r) => r.status >= 200 && r.status < 300 });
  });

  sleep(1);
}
