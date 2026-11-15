import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, totpCode, uniqueEmail } from "./helpers.js";
import {
  addMember,
  api,
  invitationsUrl,
  invitationTokenFor,
  newOwner,
} from "./invitation-helpers.js";
import { createTestApp, updateCookies } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let mfaCtx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  // Workspaces above the MFA threshold (3 properties).
  mfaCtx = await createTestApp(inject("databaseUrl"), {}, { propertyCount: 3 });
});

afterAll(async () => {
  await ctx.app.close();
  await mfaCtx.app.close();
});

describe("ownership transfer (T087, FR-026)", () => {
  it("moves ownership to an admin, after which the previous owner can leave", async () => {
    const owner = await newOwner(ctx, "own-owner");
    const agent = await addMember(ctx, owner, "agent", "own-agent");
    const admin = await addMember(ctx, owner, "admin", "own-admin");
    const transferUrl = `/api/v1/workspaces/${owner.workspaceId}/ownership-transfer`;

    const toAgent = await api(ctx, "POST", transferUrl, owner.cookie, {
      membershipId: agent.membershipId,
    });
    expect(toAgent.statusCode).toBe(409);
    expect(toAgent.json()).toMatchObject({ code: "target_not_admin" });
    const byAdmin = await api(ctx, "POST", transferUrl, admin.cookie, {
      membershipId: admin.membershipId,
    });
    expect(byAdmin.statusCode).toBe(403);

    const done = await api(ctx, "POST", transferUrl, owner.cookie, {
      membershipId: admin.membershipId,
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ role: "admin" });
    const asNewOwner = (
      await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}`, admin.cookie)
    ).json() as { role: string };
    expect(asNewOwner.role).toBe("owner");
    expect(
      (await api(ctx, "POST", `/api/v1/workspaces/${owner.workspaceId}/leave`, owner.cookie))
        .statusCode,
    ).toBe(204);
  });

  it("needs the new owner to have a second factor above the threshold (spec edge case)", async () => {
    // The owner enrolls an authenticator app and uses it: MFA applies to every owner action here.
    const ownerEmail = uniqueEmail("mfa-own-owner");
    let cookie = await signIn(mfaCtx, ownerEmail);
    const me = (await api(mfaCtx, "GET", "/api/v1/me", cookie)).json() as {
      lastWorkspaceId: string;
    };
    const enable = await api(mfaCtx, "POST", "/api/auth/two-factor/enable", cookie, {});
    const { totpURI } = enable.json() as { totpURI: string };
    const enrolled = await api(mfaCtx, "POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI),
    });
    cookie = updateCookies(cookie, enrolled.headers["set-cookie"]);
    const stepUp = await api(mfaCtx, "POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI, Date.now() + 30_000),
    });
    expect(stepUp.statusCode, stepUp.body).toBe(200);

    const adminEmail = uniqueEmail("mfa-own-admin");
    expect(
      (
        await api(mfaCtx, "POST", invitationsUrl(me.lastWorkspaceId), cookie, {
          email: adminEmail,
          role: "admin",
        })
      ).statusCode,
    ).toBe(201);
    const token = invitationTokenFor(mfaCtx, adminEmail);
    const adminCookie = await signIn(mfaCtx, adminEmail, { cookie: `guidesk.invite=${token}` });
    await api(mfaCtx, "POST", `/api/v1/invitations/${token}/accept`, adminCookie);
    const members = (
      await api(mfaCtx, "GET", `/api/v1/workspaces/${me.lastWorkspaceId}/members`, cookie)
    ).json() as { members: { membershipId: string; email: string }[] };
    const target = members.members.find((m) => m.email === adminEmail)?.membershipId;

    const blocked = await api(
      mfaCtx,
      "POST",
      `/api/v1/workspaces/${me.lastWorkspaceId}/ownership-transfer`,
      cookie,
      { membershipId: target },
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "target_mfa_required" });
  });
});
