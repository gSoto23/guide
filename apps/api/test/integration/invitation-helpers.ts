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

/** Signs up a new owner and returns their cookie and workspace. */
export async function newOwner(ctx: Ctx, prefix: string) {
  const email = uniqueEmail(prefix);
  const cookie = await signIn(ctx, email);
  const me = (await api(ctx, "GET", "/api/v1/me", cookie)).json() as { lastWorkspaceId: string };
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
