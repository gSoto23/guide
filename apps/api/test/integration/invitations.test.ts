import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { signIn, systemQuery, uniqueEmail } from "./helpers.js";
import { api, invitationsUrl, invitationTokenFor, newOwner } from "./invitation-helpers.js";
import { createTestApp } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

afterEach(() => {
  vi.useRealTimers();
});

async function membershipsOf(email: string) {
  const { rows } = await db.query<{ workspace_id: string; role: string }>(
    `SELECT m.workspace_id, m.role FROM membership m JOIN "user" u ON u.id = m.user_id WHERE u.email = $1`,
    [email],
  );
  return rows;
}

describe("invitations (T067, FR-018 to FR-020)", () => {
  it("lets an invitee sign up from the link and join with the chosen role, without a workspace of their own", async () => {
    const owner = await newOwner(ctx, "inv-owner");
    const inviteeEmail = uniqueEmail("inv-agent");
    const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: inviteeEmail.toUpperCase(),
      role: "agent",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ email: inviteeEmail, role: "agent", status: "pending" });
    const token = invitationTokenFor(ctx, inviteeEmail);

    const preview = await api(ctx, "GET", `/api/v1/invitations/${token}`);
    expect(preview.statusCode).toBe(200);
    expect(Object.keys(preview.json() as object).sort()).toEqual([
      "inviterName",
      "role",
      "status",
      "workspaceName",
    ]);
    expect(String(preview.headers["set-cookie"])).toContain("guidesk.invite=");

    // Signing up from the link (the cookie the lookup set) creates no workspace (FR-020).
    const invitee = await signIn(ctx, inviteeEmail, { cookie: `guidesk.invite=${token}` });
    expect(await membershipsOf(inviteeEmail)).toEqual([]);

    const accepted = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, invitee);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({
      workspaceId: owner.workspaceId,
      role: "agent",
      result: "joined",
    });
    expect(await membershipsOf(inviteeEmail)).toEqual([
      { workspace_id: owner.workspaceId, role: "agent" },
    ]);

    // Single use (FR-019).
    expect(
      (await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, invitee)).statusCode,
    ).toBe(410);
    expect((await api(ctx, "GET", `/api/v1/invitations/${token}`)).statusCode).toBe(410);

    const events = await db.query(
      `SELECT 1 FROM security_event WHERE workspace_id = $1 AND type = 'invitation.accepted'`,
      [owner.workspaceId],
    );
    expect(events.rowCount).toBe(1);
    const notice = await db.query(
      `SELECT 1 FROM pgboss.job WHERE data->>'to' = $1 AND data->>'template' = 'team.invitation_accepted'`,
      [owner.email],
    );
    expect(notice.rowCount).toBe(1);
  });

  it("refuses another email and shows nothing beyond the workspace (AC-SEC-002)", async () => {
    const owner = await newOwner(ctx, "inv-mismatch");
    const invited = uniqueEmail("inv-right");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: invited,
      role: "admin",
    });
    const token = invitationTokenFor(ctx, invited);
    const wrongEmail = uniqueEmail("inv-wrong");
    const wrong = await signIn(ctx, wrongEmail);

    const refused = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, wrong);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "email_mismatch" });
    expect(await membershipsOf(wrongEmail)).toHaveLength(1); // only their own workspace
    const denied = await db.query(
      `SELECT 1 FROM security_event WHERE workspace_id = $1 AND type = 'invitation.accept_denied'`,
      [owner.workspaceId],
    );
    expect(denied.rowCount).toBe(1);

    // The invitation stays open for its real owner.
    const right = await signIn(ctx, invited, { cookie: `guidesk.invite=${token}` });
    expect((await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, right)).statusCode).toBe(
      200,
    );
  });

  it("stops working when revoked or expired", async () => {
    const owner = await newOwner(ctx, "inv-revoke");
    const revokedEmail = uniqueEmail("inv-revoked");
    const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: revokedEmail,
      role: "agent",
    });
    const { id } = created.json() as { id: string };
    const token = invitationTokenFor(ctx, revokedEmail);
    const revoke = await api(
      ctx,
      "DELETE",
      `${invitationsUrl(owner.workspaceId)}/${id}`,
      owner.cookie,
    );
    expect(revoke.statusCode).toBe(204);
    expect((await api(ctx, "GET", `/api/v1/invitations/${token}`)).statusCode).toBe(410);
    expect(
      (await api(ctx, "DELETE", `${invitationsUrl(owner.workspaceId)}/${id}`, owner.cookie))
        .statusCode,
    ).toBe(410);

    const expiredEmail = uniqueEmail("inv-expired");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: expiredEmail,
      role: "agent",
    });
    const expiredToken = invitationTokenFor(ctx, expiredEmail);
    await db.query(
      `UPDATE invitation SET expires_at = now() - interval '1 minute' WHERE email = $1`,
      [expiredEmail],
    );
    expect((await api(ctx, "GET", `/api/v1/invitations/${expiredToken}`)).statusCode).toBe(410);
    const late = await signIn(ctx, expiredEmail);
    expect(
      (await api(ctx, "POST", `/api/v1/invitations/${expiredToken}/accept`, late)).statusCode,
    ).toBe(410);
    // An expired invitation no longer blocks a new one for the same address.
    expect(
      (
        await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
          email: expiredEmail,
          role: "agent",
        })
      ).statusCode,
    ).toBe(201);
  });

  it("resends with a new link and the same expiry", async () => {
    const owner = await newOwner(ctx, "inv-resend");
    const email = uniqueEmail("inv-resent");
    const created = (
      await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
        email,
        role: "agent",
      })
    ).json() as { id: string; expiresAt: string };
    const first = invitationTokenFor(ctx, email);
    const resend = await api(
      ctx,
      "POST",
      `${invitationsUrl(owner.workspaceId)}/${created.id}/resend`,
      owner.cookie,
    );
    expect(resend.statusCode).toBe(202);
    const second = invitationTokenFor(ctx, email);
    expect(second).not.toBe(first);
    expect((await api(ctx, "GET", `/api/v1/invitations/${first}`)).statusCode).toBe(410);
    expect((await api(ctx, "GET", `/api/v1/invitations/${second}`)).statusCode).toBe(200);
    const list = (
      await api(ctx, "GET", invitationsUrl(owner.workspaceId), owner.cookie)
    ).json() as {
      invitations: { id: string; expiresAt: string; sendCount: number }[];
    };
    expect(list.invitations.find((i) => i.id === created.id)).toMatchObject({
      expiresAt: created.expiresAt,
      sendCount: 2,
    });
  });

  it("limits resends to 3 per invitation per day (AC-SEC-008)", async () => {
    const owner = await newOwner(ctx, "inv-resend-limit");
    const created = (
      await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
        email: uniqueEmail("inv-resend-limit"),
        role: "agent",
      })
    ).json() as { id: string };
    const resend = () =>
      api(ctx, "POST", `${invitationsUrl(owner.workspaceId)}/${created.id}/resend`, owner.cookie);
    for (let i = 0; i < 3; i += 1) expect((await resend()).statusCode).toBe(202);
    expect((await resend()).statusCode).toBe(429);
  });

  it("refuses duplicates: an existing member or an open invitation (409)", async () => {
    const owner = await newOwner(ctx, "inv-dup");
    const self = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: owner.email,
      role: "admin",
    });
    expect(self.json()).toMatchObject({ code: "already_member" });
    const email = uniqueEmail("inv-twice");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "agent",
    });
    const twice = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "admin",
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ code: "already_invited" });
  });

  it("replays a retried request with the same Idempotency-Key instead of sending twice", async () => {
    const owner = await newOwner(ctx, "inv-idem");
    const email = uniqueEmail("inv-once");
    const headers = { "idempotency-key": `invite-${Date.now()}` };
    const first = await api(
      ctx,
      "POST",
      invitationsUrl(owner.workspaceId),
      owner.cookie,
      { email, role: "agent" },
      headers,
    );
    const retry = await api(
      ctx,
      "POST",
      invitationsUrl(owner.workspaceId),
      owner.cookie,
      { email, role: "agent" },
      headers,
    );
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(ctx.email.sent.filter((m) => m.to === email)).toHaveLength(1);
  });
});

describe("who may invite (V12, FR-016, FR-011)", () => {
  it("refuses agents (403) and non-members (404, logged)", async () => {
    const owner = await newOwner(ctx, "inv-roles");
    const agentEmail = uniqueEmail("inv-role-agent");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: agentEmail,
      role: "agent",
    });
    const token = invitationTokenFor(ctx, agentEmail);
    const agent = await signIn(ctx, agentEmail, { cookie: `guidesk.invite=${token}` });
    await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, agent);

    const byAgent = await api(ctx, "POST", invitationsUrl(owner.workspaceId), agent, {
      email: uniqueEmail("x"),
      role: "agent",
    });
    expect(byAgent.statusCode).toBe(403);
    expect(byAgent.json()).toMatchObject({ code: "forbidden" });
    expect(
      (await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}/members`, agent)).statusCode,
    ).toBe(403);

    const stranger = await newOwner(ctx, "inv-stranger");
    const byStranger = await api(ctx, "POST", invitationsUrl(owner.workspaceId), stranger.cookie, {
      email: uniqueEmail("y"),
      role: "agent",
    });
    expect(byStranger.statusCode).toBe(404);
    const logged = await db.query(
      `SELECT 1 FROM security_event e JOIN "user" u ON u.id = e.actor_user_id
       WHERE u.email = $1 AND e.type = 'access.cross_workspace_denied' AND e.target_id = $2`,
      [stranger.email, owner.workspaceId],
    );
    expect(logged.rowCount).toBe(1);
  });

  it("needs a recent re-authentication to invite", async () => {
    const owner = await newOwner(ctx, "inv-stepup");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
    const stale = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: uniqueEmail("z"),
      role: "agent",
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ code: "step_up_required" });
  });

  it("lists the team for owners, with roles", async () => {
    const owner = await newOwner(ctx, "inv-members");
    const members = await api(
      ctx,
      "GET",
      `/api/v1/workspaces/${owner.workspaceId}/members`,
      owner.cookie,
    );
    expect(members.statusCode).toBe(200);
    expect(members.json()).toMatchObject({ members: [{ email: owner.email, role: "owner" }] });
  });
});
