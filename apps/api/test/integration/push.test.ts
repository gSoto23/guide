import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createECDH } from "node:crypto";
import type { PushStatus } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { api } from "./invitation-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * A member's push devices (feature 006 US4, T025): availability, subscribing (an endpoint moves to
 * whoever signs in on that browser), devices listed without keys, deleting only your own, the test
 * push with its limit, and push off without VAPID keys. Fictional endpoints only.
 */
let off: Awaited<ReturnType<typeof createTestApp>>;
let on: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
/** A VAPID key pair: a P-256 public point and private scalar, base64url (RFC 8292). */
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const keys = {
  publicKey: ecdh.getPublicKey().toString("base64url"),
  privateKey: ecdh.getPrivateKey().toString("base64url"),
};

beforeAll(async () => {
  db = systemQuery(inject("databaseUrl"));
  off = await createTestApp(inject("databaseUrl"), {
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "",
  });
  team = await seedTeam(off, db, "push");
  on = await createTestApp(inject("databaseUrl"), {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "https://app.guidesk.test",
  });
});

afterAll(async () => {
  Object.assign(process.env, { VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" });
  await db.close();
  await off.app.close();
  await on.app.close();
});

const body = (endpoint: string, device = "chrome-android") => ({
  endpoint,
  keys: { p256dh: "BTestKeyOnlyForTests", auth: "authTestOnly" },
  device,
});

describe("push devices (feature 006 US4)", () => {
  it("reports push off without keys and refuses subscriptions and tests", async () => {
    const status = (
      await api(off, "GET", "/api/v1/me/push", team.agent.cookie)
    ).json() as PushStatus;
    expect(status).toEqual({ available: false, publicKey: null, devices: [] });
    const refused = await api(
      off,
      "POST",
      "/api/v1/me/push/subscriptions",
      team.agent.cookie,
      body("https://push.example.test/off"),
    );
    expect(refused.statusCode).toBe(503);
    expect((await api(off, "POST", "/api/v1/me/push/test", team.agent.cookie)).statusCode).toBe(
      503,
    );
  });

  it("subscribes devices, lists them without keys, and moves an endpoint to the new signer", async () => {
    const endpoint = `https://push.example.test/${Date.now()}`;
    const created = await api(
      on,
      "POST",
      "/api/v1/me/push/subscriptions",
      team.agent.cookie,
      body(endpoint),
    );
    expect(created.statusCode, created.body).toBe(201);
    const status = (
      await api(on, "GET", "/api/v1/me/push", team.agent.cookie)
    ).json() as PushStatus;
    expect(status.available).toBe(true);
    expect(status.publicKey).toBe(keys.publicKey);
    expect(status.devices).toEqual([expect.objectContaining({ device: "chrome-android" })]);
    expect(JSON.stringify(status)).not.toContain("authTestOnly");

    // The owner signs in on the same browser: the endpoint is theirs now.
    await api(
      on,
      "POST",
      "/api/v1/me/push/subscriptions",
      team.owner.cookie,
      body(endpoint, "chrome-android"),
    );
    expect(
      ((await api(on, "GET", "/api/v1/me/push", team.agent.cookie)).json() as PushStatus).devices,
    ).toEqual([]);
    const owners = (
      await api(on, "GET", "/api/v1/me/push", team.owner.cookie)
    ).json() as PushStatus;
    expect(owners.devices).toHaveLength(1);

    // Another user can't delete it; the owner can.
    const id = owners.devices[0]!.id;
    expect(
      (await api(on, "DELETE", `/api/v1/me/push/subscriptions/${id}`, team.agent.cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(on, "DELETE", `/api/v1/me/push/subscriptions/${id}`, team.owner.cookie))
        .statusCode,
    ).toBe(204);
    const events = await db.query<{ type: string }>(
      `SELECT type FROM security_event WHERE actor_user_id = $1 AND type LIKE 'push.%' ORDER BY occurred_at`,
      [team.owner.userId],
    );
    expect(events.rows.map((row) => row.type)).toEqual(["push.subscribed", "push.unsubscribed"]);
  });

  it("refuses endpoints that aren't https and odd device labels", async () => {
    for (const bad of [
      body("http://push.example.test/x"),
      body("https://push.example.test/y", "Chrome on Android"),
    ]) {
      expect(
        (await api(on, "POST", "/api/v1/me/push/subscriptions", team.agent.cookie, bad)).statusCode,
      ).toBe(422);
    }
  });

  it("queues a test push, at most five an hour", async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await api(on, "POST", "/api/v1/me/push/test", team.admin.cookie)).statusCode).toBe(
        202,
      );
    }
    expect((await api(on, "POST", "/api/v1/me/push/test", team.admin.cookie)).statusCode).toBe(429);
    const jobs = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'notification.push' AND data->>'userId' = $1 AND data->>'kind' = 'test'`,
      [team.admin.userId],
    );
    expect(jobs.rows).toHaveLength(5);
  });
});
