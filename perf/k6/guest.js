// Load test for the guest guide (feature 004 plan, Performance Budget; T071).
//
// Budget (SC-009): 200 guide opens per second with the guide data answered in under 300 ms at the
// 95th percentile at the origin, and a reveal under 500 ms. Requests go through the guide origin,
// as browsers do: the guest app's local proxy, or CloudFront in AWS. In AWS most opens are CDN
// hits; this script measures the origin by default (cache-busting `lang` order is not used).
//
// The API limits guest requests to 120 per minute per address (FR-053), so a single load
// generator hits 429s within seconds: run it from several addresses, or against a test stage
// whose limit was raised for the run.
//
// Inputs (all fictional test data, never real guests):
// - PUBLIC_ID: a published guide's property link ID (26 characters).
// - STAY_COOKIES: optional comma-separated `guidesk_guest=…` cookies of stay sessions inside their
//   window, for the reveal scenario, with FIELD_ID the locked field to show.
//
// Run locally (k6 in Docker reaches the host through host.docker.internal):
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3001 -e PUBLIC_ID=… \
//     grafana/k6:1.8.2 run - < perf/k6/guest.js
import http from "k6/http";
import { check } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const PUBLIC_ID = __ENV.PUBLIC_ID || "";
const FIELD_ID = __ENV.FIELD_ID || "";
const COOKIES = (__ENV.STAY_COOKIES || "").split(",").filter(Boolean);
const RATE = Number(__ENV.RATE || 200);
const DURATION = __ENV.DURATION || "1m";

export const options = {
  scenarios: {
    opens: {
      executor: "constant-arrival-rate",
      exec: "open",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
    ...(COOKIES.length && FIELD_ID
      ? {
          reveals: {
            executor: "constant-arrival-rate",
            exec: "reveal",
            rate: 5,
            timeUnit: "1s",
            duration: DURATION,
            preAllocatedVUs: 5,
            maxVUs: 20,
          },
        }
      : {}),
  },
  thresholds: {
    "http_req_duration{name:guide}": ["p(95)<300"],
    "http_req_duration{name:session}": ["p(95)<300"],
    "http_req_duration{name:reveal}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  if (!PUBLIC_ID) throw new Error("Set PUBLIC_ID to a published guide's property link ID");
}

export function open() {
  const lang = Math.random() < 0.5 ? "es" : "en";
  const guide = http.get(`${BASE_URL}/api/v1/guest/guides/${PUBLIC_ID}?lang=${lang}`, {
    tags: { name: "guide" },
  });
  check(guide, { "guide 200": (response) => response.status === 200 });
  const session = http.get(`${BASE_URL}/api/v1/guest/session?publicId=${PUBLIC_ID}`, {
    tags: { name: "session" },
  });
  check(session, { "session 200": (response) => response.status === 200 });
}

export function reveal() {
  const cookie = COOKIES[Math.floor(Math.random() * COOKIES.length)];
  const response = http.post(
    `${BASE_URL}/api/v1/guest/reveals`,
    JSON.stringify({ publicId: PUBLIC_ID, fieldId: FIELD_ID }),
    {
      headers: { "Content-Type": "application/json", Origin: BASE_URL, Cookie: cookie },
      tags: { name: "reveal" },
    },
  );
  check(response, { "reveal 200 or 429": (r) => r.status === 200 || r.status === 429 });
}
