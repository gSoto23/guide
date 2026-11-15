import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signIn, systemQuery, totpCode, uniqueEmail } from "./helpers.js";
import {
  addMember,
  api,
  invitationsUrl,
  invitationTokenFor,
  newOwner,
} from "./invitation-helpers.js";
import { createTestApp, updateCookies } from "./test-app.js";

/** Regression tests for the US3–US5 security review (T103; checklists/security.md §8). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = inject("databaseUrl");
  ctx = await createTestApp(databaseUrl);
  db = systemQuery(databaseUrl);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

/** Runs SQL as guidesk_app with a request context, on its own connection; always rolls back. */
async function asApp<T>(
  context: { userId: string; workspaceId: string },
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE guidesk_app");
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true),
              set_config('app.workspace_role', coalesce(app_membership_role($2::uuid, $1), ''), true)`,
      [context.userId, context.workspaceId],
    );
    return await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function userIdOf(email: string): Promise<string> {
  const row = await db.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
  return row.rows[0]?.id ?? "";
}

describe("security review of US3–US5 (T103)", () => {
  it("treats every letter case of an ID as the same invitation for resend limits", async () => {
    const owner = await newOwner(ctx, "case-owner");
    const email = uniqueEmail("case-invitee");
    const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "agent",
    });
    const id = (created.json() as { id: string }).id;
    const spellings = [id, id.toUpperCase(), id.replace(/[a-f]/, (c) => c.toUpperCase())];
    const workspaceUpper = owner.workspaceId.toUpperCase();
    for (const spelling of spellings) {
      const resent = await api(
        ctx,
        "POST",
        `/api/v1/workspaces/${workspaceUpper}/invitations/${spelling}/resend`,
        owner.cookie,
      );
      expect(resent.statusCode, resent.body).toBe(202);
    }
    const fourth = await api(
      ctx,
      "POST",
      `${invitationsUrl(owner.workspaceId)}/${id.toUpperCase()}/resend`,
      owner.cookie,
    );
    expect(fourth.statusCode).toBe(429);
  });

  it("limits invitation emails per address, so revoking and inviting again can't flood it", async () => {
    const owner = await newOwner(ctx, "flood-owner");
    const email = uniqueEmail("flood-target");
    for (let send = 1; send <= 5; send += 1) {
      const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
        email,
        role: "agent",
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = (created.json() as { id: string }).id;
      await api(ctx, "DELETE", `${invitationsUrl(owner.workspaceId)}/${id}`, owner.cookie);
    }
    const sixth = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "agent",
    });
    expect(sixth.statusCode).toBe(429);
  });

  it("keeps invitations to their state machine in the database", async () => {
    const owner = await newOwner(ctx, "fsm-owner");
    const email = uniqueEmail("fsm-invitee");
    const created = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "agent",
    });
    const id = (created.json() as { id: string }).id;
    await api(ctx, "DELETE", `${invitationsUrl(owner.workspaceId)}/${id}`, owner.cookie);
    const ownerId = await userIdOf(owner.email);
    const context = { userId: ownerId, workspaceId: owner.workspaceId };

    // A revoked invitation can't be reopened.
    const reopened = await asApp(context, (client) =>
      client.query(`UPDATE invitation SET status = 'pending' WHERE id = $1`, [id]),
    );
    expect(reopened.rowCount).toBe(0);

    // A "resend" must replace the token and count the send.
    const second = await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email: uniqueEmail("fsm-second"),
      role: "agent",
    });
    const openId = (second.json() as { id: string }).id;
    await expect(
      asApp(context, (client) =>
        client.query(`UPDATE invitation SET send_count = send_count + 1 WHERE id = $1`, [openId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("revokes a removed admin's invitations, and the database refuses them anyway", async () => {
    const owner = await newOwner(ctx, "rejoin-owner");
    const admin = await addMember(ctx, owner, "admin", "rejoin-admin");
    const backdoor = uniqueEmail("rejoin-second");
    const invited = await api(ctx, "POST", invitationsUrl(owner.workspaceId), admin.cookie, {
      email: backdoor,
      role: "admin",
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const token = invitationTokenFor(ctx, backdoor);

    const removed = await api(
      ctx,
      "DELETE",
      `/api/v1/workspaces/${owner.workspaceId}/members/${admin.membershipId}`,
      owner.cookie,
    );
    expect(removed.statusCode).toBe(204);
    const status = await db.query<{ status: string }>(
      `SELECT status FROM invitation WHERE email = $1`,
      [backdoor],
    );
    expect(status.rows[0]?.status).toBe("revoked");
    const cookie = await signIn(ctx, backdoor, { cookie: `guidesk.invite=${token}` });
    const accepted = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, cookie);
    expect(accepted.statusCode).toBe(410);

    // Backstop: an invitation whose inviter is no longer an admin can't be accepted, even if it
    // is still open (for example, demoted outside this API).
    const second = await addMember(ctx, owner, "admin", "rejoin-admin2");
    const other = uniqueEmail("rejoin-other");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), second.cookie, {
      email: other,
      role: "agent",
    });
    const otherToken = invitationTokenFor(ctx, other);
    await db.query(`UPDATE membership SET role = 'agent' WHERE id = $1`, [second.membershipId]);
    const otherCookie = await signIn(ctx, other, { cookie: `guidesk.invite=${otherToken}` });
    const refused = await api(ctx, "POST", `/api/v1/invitations/${otherToken}/accept`, otherCookie);
    expect(refused.statusCode).toBe(410);
  });

  it("logs role denials, including an admin trying an owner-only action (AC-SEC-003)", async () => {
    const owner = await newOwner(ctx, "deny-owner");
    const admin = await addMember(ctx, owner, "admin", "deny-admin");
    const transfer = await api(
      ctx,
      "POST",
      `/api/v1/workspaces/${owner.workspaceId}/ownership-transfer`,
      admin.cookie,
      { membershipId: admin.membershipId },
    );
    expect(transfer.statusCode).toBe(403);
    const logged = await db.query<{ metadata: { capability: string } }>(
      `SELECT metadata FROM security_event
       WHERE type = 'access.role_denied' AND workspace_id = $1 AND actor_user_id = $2`,
      [owner.workspaceId, await userIdOf(admin.email)],
    );
    expect(logged.rows.map((r) => r.metadata.capability)).toContain("workspace.ownership");
  });

  it("needs the second factor, not an email code, to change the email once TOTP is on", async () => {
    const email = uniqueEmail("su2");
    let cookie = await signIn(ctx, email);
    const enable = await api(ctx, "POST", "/api/auth/two-factor/enable", cookie, {});
    const { totpURI } = enable.json() as { totpURI: string };
    const verified = await api(ctx, "POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI),
    });
    expect(verified.statusCode, verified.body).toBe(200);

    // A fresh email-code sign-in is recent, but not strong enough for this.
    cookie = await signIn(ctx, email);
    const newEmail = uniqueEmail("su2-new");
    const refused = await api(ctx, "POST", "/api/v1/me/email-change", cookie, { newEmail });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "step_up_required", methods: ["totp"] });
    const deletion = await api(ctx, "DELETE", "/api/v1/me", cookie);
    expect(deletion.statusCode).toBe(403);

    const stepUp = await api(ctx, "POST", "/api/auth/two-factor/verify-totp", cookie, {
      code: totpCode(totpURI, Date.now() + 30_000),
    });
    expect(stepUp.statusCode, stepUp.body).toBe(200);
    cookie = updateCookies(cookie, stepUp.headers["set-cookie"]);
    const accepted = await api(ctx, "POST", "/api/v1/me/email-change", cookie, { newEmail });
    expect(accepted.statusCode, accepted.body).toBe(202);
  });

  it("answers 422 when an idempotency key is reused for another request", async () => {
    const owner = await newOwner(ctx, "idem-owner");
    const headers = { "idempotency-key": `key-${Date.now()}` };
    const first = await api(
      ctx,
      "POST",
      invitationsUrl(owner.workspaceId),
      owner.cookie,
      { email: uniqueEmail("idem-a"), role: "agent" },
      headers,
    );
    expect(first.statusCode).toBe(201);
    const other = await api(
      ctx,
      "POST",
      invitationsUrl(owner.workspaceId),
      owner.cookie,
      { email: uniqueEmail("idem-b"), role: "agent" },
      headers,
    );
    expect(other.statusCode).toBe(422);
    expect(other.json()).toMatchObject({ code: "idempotency_conflict" });
  });

  it("logs a foreign ID in the owning workspace's log, not the caller's (AC-SEC-004)", async () => {
    const victim = await newOwner(ctx, "probe-victim");
    const prober = await newOwner(ctx, "probe-owner");
    const created = await api(ctx, "POST", invitationsUrl(victim.workspaceId), victim.cookie, {
      email: uniqueEmail("probe-target"),
      role: "agent",
    });
    const foreignId = (created.json() as { id: string }).id;
    const missingId = "00000000-0000-4000-8000-000000000000";
    const foreign = await api(
      ctx,
      "DELETE",
      `${invitationsUrl(prober.workspaceId)}/${foreignId}`,
      prober.cookie,
    );
    const missing = await api(
      ctx,
      "DELETE",
      `${invitationsUrl(prober.workspaceId)}/${missingId}`,
      prober.cookie,
    );
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(foreign.json()).not.toHaveProperty("detail");
    const logged = await db.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM security_event
       WHERE type = 'access.cross_workspace_denied' AND target_id = $1`,
      [foreignId],
    );
    expect(logged.rows.map((r) => r.workspace_id)).toEqual([victim.workspaceId]);
  });

  it("pages the security log without skipping events in the same millisecond", async () => {
    const email = uniqueEmail("cursor");
    const cookie = await signIn(ctx, email);
    const userId = await userIdOf(email);
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO security_event (type, outcome, actor_user_id, occurred_at)
       SELECT 'session.revoked', 'success', $1, timestamptz '2026-11-01 10:00:00.123001+00' + (n || ' microseconds')::interval
       FROM generate_series(0, 2) AS n
       RETURNING id`,
      [userId],
    );
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${cursor}` : "";
      const page = (
        await api(ctx, "GET", `/api/v1/me/security-events?limit=1${query}`, cookie)
      ).json() as { events: { id: string }[]; nextCursor: string | null };
      for (const event of page.events) seen.add(event.id);
      cursor = page.nextCursor;
    } while (cursor);
    for (const row of inserted.rows) expect(seen.has(row.id)).toBe(true);
  });

  it("refuses a non-owner's request role while the workspace is pending deletion", async () => {
    const owner = await newOwner(ctx, "pending-owner");
    const admin = await addMember(ctx, owner, "admin", "pending-admin");
    const ws = (
      await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}`, owner.cookie)
    ).json() as {
      name: string;
    };
    const deleted = await api(
      ctx,
      "DELETE",
      `/api/v1/workspaces/${owner.workspaceId}`,
      owner.cookie,
      {
        confirmName: ws.name,
      },
    );
    expect(deleted.statusCode, deleted.body).toBe(202);
    const adminRole = await asApp(
      { userId: await userIdOf(admin.email), workspaceId: owner.workspaceId },
      async (client) =>
        (
          await client.query<{ role: string }>(
            `SELECT current_setting('app.workspace_role') AS role`,
          )
        ).rows[0]?.role,
    );
    const ownerRole = await asApp(
      { userId: await userIdOf(owner.email), workspaceId: owner.workspaceId },
      async (client) =>
        (
          await client.query<{ role: string }>(
            `SELECT current_setting('app.workspace_role') AS role`,
          )
        ).rows[0]?.role,
    );
    expect(adminRole).toBe("");
    expect(ownerRole).toBe("owner");
  });

  it("revokes open invitations in the user's own workspaces when account deletion is scheduled", async () => {
    const owner = await newOwner(ctx, "sched-owner");
    const email = uniqueEmail("sched-invitee");
    await api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, {
      email,
      role: "agent",
    });
    const scheduled = await api(ctx, "DELETE", "/api/v1/me", owner.cookie);
    expect(scheduled.statusCode, scheduled.body).toBe(202);
    const status = await db.query<{ status: string }>(
      `SELECT status FROM invitation WHERE email = $1`,
      [email],
    );
    expect(status.rows[0]?.status).toBe("revoked");
  });

  it("purges the rest of the personal data, with a pseudonym nothing links back (FR-028)", async () => {
    // U receives ownership once (new_owner in the log), hands it back, and leaves.
    const owner = await newOwner(ctx, "purge-other");
    const leaving = await addMember(ctx, owner, "admin", "purge-user");
    const userId = await userIdOf(leaving.email);
    const transfer = (to: string, cookie: string) =>
      api(ctx, "POST", `/api/v1/workspaces/${owner.workspaceId}/ownership-transfer`, cookie, {
        membershipId: to,
      });
    expect((await transfer(leaving.membershipId, owner.cookie)).statusCode).toBe(200);
    const members = (
      await api(ctx, "GET", `/api/v1/workspaces/${owner.workspaceId}/members`, leaving.cookie)
    ).json() as { members: { membershipId: string; email: string }[] };
    const ownerMembership =
      members.members.find((m) => m.email === owner.email)?.membershipId ?? "";
    expect((await transfer(ownerMembership, leaving.cookie)).statusCode).toBe(200);
    const left = await api(
      ctx,
      "POST",
      `/api/v1/workspaces/${owner.workspaceId}/leave`,
      leaving.cookie,
    );
    expect(left.statusCode, left.body).toBe(204);
    // An open invitation to U from another workspace keeps U's email.
    const inviter = await newOwner(ctx, "purge-inviter");
    await api(ctx, "POST", invitationsUrl(inviter.workspaceId), inviter.cookie, {
      email: leaving.email,
      role: "agent",
    });

    const scheduled = await api(ctx, "DELETE", "/api/v1/me", leaving.cookie);
    expect(scheduled.statusCode, scheduled.body).toBe(202);
    await db.query(
      `UPDATE account_deletion_request SET purge_after = now() - interval '1 minute' WHERE user_id = $1`,
      [userId],
    );
    const purged = await db.query<{ pseudonym: string }>(`SELECT purge_account($1) AS pseudonym`, [
      userId,
    ]);
    const pseudonym = purged.rows[0]?.pseudonym ?? "";
    expect(pseudonym).toMatch(/^deleted:[0-9a-f]{16}$/);
    const md5 = createHash("md5").update(userId).digest("hex").slice(0, 16);
    expect(pseudonym).not.toBe(`deleted:${md5}`);

    const counts = await db.query<{ name: string; n: string }>(
      `SELECT 'new_owner' AS name, count(*) AS n FROM security_event WHERE metadata->>'new_owner' = $1
       UNION ALL SELECT 'actor', count(*) FROM security_event WHERE actor_user_id = $1
       UNION ALL SELECT 'request', count(*) FROM account_deletion_request WHERE user_id = $1
       UNION ALL SELECT 'invitation', count(*) FROM invitation WHERE email = $2
       UNION ALL SELECT 'lockout', count(*) FROM auth_lockout WHERE key = 'user:' || $1`,
      [userId, leaving.email],
    );
    for (const row of counts.rows) expect([row.name, Number(row.n)]).toEqual([row.name, 0]);
    const kept = await db.query(`SELECT 1 FROM security_event WHERE metadata->>'new_owner' = $1`, [
      pseudonym,
    ]);
    expect(kept.rowCount).toBeGreaterThan(0);
  });
});
