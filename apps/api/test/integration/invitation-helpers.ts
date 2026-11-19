import pg from "pg";
import { expect } from "vitest";
import { signIn, uniqueEmail } from "./helpers.js";
import { type createTestApp, PORTAL_URL } from "./test-app.js";

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

export function api(
  ctx: Ctx,
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT",
  url: string,
  cookie?: string,
  payload?: object,
  headers: Record<string, string> = {},
) {
  return ctx.fastify.inject({
    method,
    url,
    headers: {
      origin: PORTAL_URL,
      ...(cookie ? { cookie } : {}),
      ...(payload ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(payload ? { payload } : {}),
  });
}

/** Signs up a new owner and returns their cookie and workspace, with room for a team. */
export async function newOwner(ctx: Ctx, prefix: string) {
  const email = uniqueEmail(prefix);
  const cookie = await signIn(ctx, email);
  const me = (await api(ctx, "GET", "/api/v1/me", cookie)).json() as { lastWorkspaceId: string };
  await roomForTeam(me.lastWorkspaceId);
  return { email, cookie, workspaceId: me.lastWorkspaceId };
}

/** The token from the latest invitation email sent to the address. */
export function invitationTokenFor(ctx: Ctx, email: string): string {
  const message = [...ctx.email.sent]
    .reverse()
    .find((m) => m.to === email && m.template === "team.invitation");
  const token = message?.text.match(/\/invite\/([A-Za-z0-9_-]{43})/)?.[1];
  expect(token, `no invitation email for ${email}`).toBeTruthy();
  return token ?? "";
}

export function invitationsUrl(workspaceId: string): string {
  return `/api/v1/workspaces/${workspaceId}/invitations`;
}

/**
 * Gives a Free workspace room for a team, like the pilot default of 10 seats before feature 011:
 * a custom seat limit only, so the plan's other limits stay as they are. Tests of seat limits set
 * their own values afterwards.
 */
export async function roomForTeam(workspaceId: string): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE workspace SET seat_limit = 10 WHERE id = $1 AND seat_limit IS NULL AND plan = 'free'`,
      [workspaceId],
    );
  } finally {
    await client.end();
  }
}

/** Invites a new person with the role and has them accept; returns their session and membership. */
export async function addMember(
  ctx: Ctx,
  owner: { cookie: string; workspaceId: string },
  role: "admin" | "agent",
  prefix = "member",
) {
  const email = uniqueEmail(prefix);
  const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
    email,
    role,
  });
  expect(created.statusCode, created.body).toBe(201);
  const token = invitationTokenFor(ctx, email);
  const cookie = await signIn(ctx, email, { cookie: `guidesk.invite=${token}` });
  const accepted = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, cookie);
  expect(accepted.statusCode, accepted.body).toBe(200);
  const members = (
    await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}/members`, owner.cookie)
  ).json() as { members: { membershipId: string; email: string }[] };
  const membershipId = members.members.find((m) => m.email === email)?.membershipId ?? "";
  return { email, cookie, membershipId };
}
