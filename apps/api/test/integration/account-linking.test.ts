import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { signIn, systemQuery, uniqueEmail } from "./helpers.js";
import { cookieHeader, createTestApp, PORTAL_URL } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), {
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
  });
  db = systemQuery(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
  await db.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** An ID token as Google's token endpoint returns it (the code flow does not re-verify it). */
function fakeIdToken(email: string, emailVerified = true): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: "RS256", typ: "JWT" }),
    base64url({
      iss: "https://accounts.google.com",
      aud: "test-client.apps.googleusercontent.com",
      sub: `google-${email}`,
      email,
      email_verified: emailVerified,
      name: "Ana Google",
      iat: now,
      exp: now + 3600,
    }),
    "signature",
  ].join(".");
}

/** Mocks Google's token endpoint, starts the OAuth flow, and returns the callback response. */
async function googleSignIn(email: string, emailVerified = true) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "google-access-token",
          id_token: fakeIdToken(email, emailVerified),
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email profile",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realFetch(input, init);
  });
  const start = await ctx.fastify.inject({
    method: "POST",
    url: "/api/auth/sign-in/social",
    headers: { origin: PORTAL_URL, "content-type": "application/json" },
    payload: { provider: "google", callbackURL: "/es" },
  });
  const state = new URL((start.json() as { url: string }).url).searchParams.get("state") ?? "";
  return ctx.fastify.inject({
    method: "GET",
    url: `/api/auth/callback/google?state=${encodeURIComponent(state)}&code=test-code`,
    headers: { cookie: cookieHeader(start.headers["set-cookie"]) },
  });
}

describe("Google sign-in links to the existing account (T032, FR-003)", () => {
  it("never links or creates an account for an email Google has not verified (T103)", async () => {
    const existing = uniqueEmail("unverified-existing");
    await signIn(ctx, existing);
    const linked = await googleSignIn(existing, false);
    expect(String(linked.headers["set-cookie"] ?? "")).not.toContain("guidesk.session_token=");
    const accounts = await db.query(
      `SELECT 1 FROM account a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1 AND a.provider_id = 'google'`,
      [existing],
    );
    expect(accounts.rowCount).toBe(0);

    const stranger = uniqueEmail("unverified-new");
    const created = await googleSignIn(stranger, false);
    expect(String(created.headers["set-cookie"] ?? "")).not.toContain("guidesk.session_token=");
    const users = await db.query(`SELECT 1 FROM "user" WHERE email = $1`, [stranger]);
    expect(users.rowCount).toBe(0);
  });

  it("reaches the same user for the same verified email, without a second workspace", async () => {
    const email = uniqueEmail("linked");
    await signIn(ctx, email);

    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "google-access-token",
            id_token: fakeIdToken(email),
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    });

    const start = await ctx.fastify.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: { origin: PORTAL_URL, "content-type": "application/json" },
      payload: { provider: "google", callbackURL: "/es" },
    });
    expect(start.statusCode, start.body).toBe(200);
    const authorizationUrl = new URL((start.json() as { url: string }).url);
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await ctx.fastify.inject({
      method: "GET",
      url: `/api/auth/callback/google?state=${encodeURIComponent(state ?? "")}&code=test-code`,
      headers: { cookie: cookieHeader(start.headers["set-cookie"]) },
    });
    expect(callback.statusCode, callback.body).toBeLessThan(400);
    expect(String(callback.headers["set-cookie"])).toContain("guidesk.session_token=");

    const users = await db.query(`SELECT id FROM "user" WHERE email = $1`, [email]);
    expect(users.rowCount).toBe(1);
    const providers = await db.query<{ provider_id: string }>(
      `SELECT provider_id FROM account WHERE user_id = $1 ORDER BY provider_id`,
      [users.rows[0]?.id],
    );
    expect(providers.rows.map((r) => r.provider_id)).toContain("google");
    const workspaces = await db.query(`SELECT 1 FROM membership WHERE user_id = $1`, [
      users.rows[0]?.id,
    ]);
    expect(workspaces.rowCount).toBe(1);
  });
});
