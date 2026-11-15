import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  acceptInvitationResponseSchema,
  invitationListSchema,
  invitationPreviewSchema,
  invitationSchema,
  memberListSchema,
} from "@guidesk/contracts";
import { signIn, uniqueEmail } from "../integration/helpers.js";
import {
  api,
  invitationsUrl,
  invitationTokenFor,
  newOwner,
} from "../integration/invitation-helpers.js";
import { createTestApp } from "../integration/test-app.js";

/** Responses match the shared Zod contracts (contracts/http-api.md, T069). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
});

afterAll(async () => {
  await ctx.app.close();
});

function expectProblem(
  response: { headers: Record<string, unknown>; json(): unknown },
  code: string,
) {
  expect(String(response.headers["content-type"])).toContain("application/problem+json");
  expect(response.json()).toMatchObject({
    code,
    status: expect.any(Number),
    title: expect.any(String),
  });
}

describe("invitation endpoints contract (T069)", () => {
  it("returns contract-shaped bodies on every success path", async () => {
    const owner = await newOwner(ctx, "contract-owner");
    const email = uniqueEmail("contract-invitee");

    const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "admin",
    });
    expect(created.statusCode).toBe(201);
    invitationSchema.parse(created.json());

    const list = await api(ctx, "GET", invitationsUrl(owner.workspaceId), owner.cookie);
    expect(list.statusCode).toBe(200);
    invitationListSchema.parse(list.json());

    const token = invitationTokenFor(ctx, email);
    const preview = await api(ctx, "GET", `/api/v1/invitations/${token}`);
    expect(preview.statusCode).toBe(200);
    invitationPreviewSchema.strict().parse(preview.json());

    const invitee = await signIn(ctx, email, { cookie: `guidesk.invite=${token}` });
    const accepted = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, invitee);
    expect(accepted.statusCode).toBe(200);
    acceptInvitationResponseSchema.parse(accepted.json());

    const members = await api(
      ctx,
      "GET",
      `/api/v1/workspaces/${owner.workspaceId}/members`,
      owner.cookie,
    );
    expect(members.statusCode).toBe(200);
    expect(memberListSchema.parse(members.json()).members.map((m) => m.role)).toEqual([
      "owner",
      "admin",
    ]);
  });

  it("returns problem+json with stable codes on failures", async () => {
    const owner = await newOwner(ctx, "contract-errors");
    const invalid = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: "not-an-email",
      role: "owner",
    });
    expect(invalid.statusCode).toBe(422);
    expectProblem(invalid, "validation_failed");

    const unknown = await api(ctx, "GET", `/api/v1/invitations/${"a".repeat(43)}`);
    expect(unknown.statusCode).toBe(410);
    expectProblem(unknown, "gone");

    const missing = await api(
      ctx,
      "DELETE",
      `${invitationsUrl(owner.workspaceId)}/00000000-0000-4000-8000-000000000000`,
      owner.cookie,
    );
    expect(missing.statusCode).toBe(404);
    expectProblem(missing, "not_found");

    const signedOut = await api(ctx, "POST", `/api/v1/invitations/${"a".repeat(43)}/accept`);
    expect(signedOut.statusCode).toBe(401);
    expectProblem(signedOut, "unauthenticated");
  });
});
