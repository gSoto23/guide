import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { systemQuery } from "./helpers.js";
import { addMember, api, newOwner } from "./invitation-helpers.js";
import type { createTestApp } from "./test-app.js";

/**
 * Test helpers for feature 002 (T029): a workspace with every role, rows in each state, and a log
 * capture that fails a test when a secret shows up in API or worker output (AC-SEC-003,
 * AC-SEC-008). All data is synthetic.
 */
type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Db = ReturnType<typeof systemQuery>;

export interface Member {
  email: string;
  cookie: string;
  userId: string;
}

export interface TeamWorkspace {
  workspaceId: string;
  owner: Member;
  admin: Member;
  agent: Member;
}

async function userIdOf(db: Db, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    email,
  ]);
  const id = rows[0]?.id;
  expect(id, `no user for ${email}`).toBeTruthy();
  return id ?? "";
}

/** A workspace with an owner, an admin, and an agent, each signed in. */
export async function seedTeam(ctx: Ctx, db: Db, prefix = "team"): Promise<TeamWorkspace> {
  const owner = await newOwner(ctx, `${prefix}-owner`);
  const admin = await addMember(ctx, owner, "admin", `${prefix}-admin`);
  const agent = await addMember(ctx, owner, "agent", `${prefix}-agent`);
  return {
    workspaceId: owner.workspaceId,
    owner: { email: owner.email, cookie: owner.cookie, userId: await userIdOf(db, owner.email) },
    admin: { email: admin.email, cookie: admin.cookie, userId: await userIdOf(db, admin.email) },
    agent: { email: agent.email, cookie: agent.cookie, userId: await userIdOf(db, agent.email) },
  };
}

/** Workspace-scoped API path, for example `wsPath(ws, "/properties")`. */
export function wsPath(workspaceId: string, path: string): string {
  return `/api/v1/workspaces/${workspaceId}${path}`;
}

/** Calls a workspace route as a member. */
export function wsApi(
  ctx: Ctx,
  member: Member,
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT",
  workspaceId: string,
  path: string,
  payload?: object,
  headers: Record<string, string> = {},
) {
  return api(ctx, method, wsPath(workspaceId, path), member.cookie, payload, headers);
}

/** Core facts that make a property `ready` (FR-001). Fictional address. */
export const READY_FACTS = {
  name: "Casa Colibrí",
  addressLine1: "Calle Ficticia 123",
  city: "Sámara",
  country: "CR",
  timeZone: "America/Costa_Rica",
  checkInTime: "15:00",
  checkoutTime: "11:00",
  maxGuests: 4,
  guideLanguages: ["es", "en"],
} as const;

export interface PropertyRow {
  setupStatus?: "needs_details" | "to_confirm" | "ready";
  source?: "manual" | "listing_text" | "csv" | "pms" | "duplicate";
  sourceProvider?: "beds24" | "hostex";
  status?: "active" | "removed";
  name?: string;
  externalId?: string;
  pmsConnectionId?: string;
}

/** Inserts a property in the system context, with the facts its setup status needs. */
export async function insertProperty(
  db: Db,
  workspaceId: string,
  row: PropertyRow = {},
): Promise<string> {
  const setupStatus = row.setupStatus ?? "ready";
  const complete = setupStatus !== "needs_details";
  const removed = row.status === "removed";
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property (
       workspace_id, name, address_line1, city, country, time_zone, check_in_time, checkout_time,
       max_guests, guide_languages, setup_status, missing_facts, source, source_provider,
       external_id, pms_connection_id, status, removed_at, purge_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{es,en}', $10, $11, $12, $13, $14, $15, $16,
       CASE WHEN $17 THEN now() END, CASE WHEN $17 THEN now() + interval '30 days' END)
     RETURNING id`,
    [
      workspaceId,
      row.name ?? `${READY_FACTS.name} ${randomUUID().slice(0, 6)}`,
      READY_FACTS.addressLine1,
      READY_FACTS.city,
      READY_FACTS.country,
      complete ? READY_FACTS.timeZone : null,
      READY_FACTS.checkInTime,
      READY_FACTS.checkoutTime,
      READY_FACTS.maxGuests,
      setupStatus,
      complete ? [] : ["timeZone"],
      row.source ?? (row.sourceProvider ? "pms" : "manual"),
      row.sourceProvider ?? null,
      row.externalId ?? null,
      row.pmsConnectionId ?? null,
      removed ? "removed" : "active",
      removed,
    ],
  );
  return rows[0]!.id;
}

/** A workspace data key with random wrapped bytes; enough for rows that need a key ID. */
export async function insertDataKey(db: Db, workspaceId: string): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM workspace_data_key WHERE workspace_id = $1 AND status = 'active'`,
    [workspaceId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO workspace_data_key (workspace_id, wrapped_key, kms_key_id) VALUES ($1, $2, 'local') RETURNING id`,
    [workspaceId, randomBytes(60)],
  );
  return rows[0]!.id;
}

/** A calendar feed row with placeholder ciphertext (not decryptable; for listing and RLS tests). */
export async function insertFeed(
  db: Db,
  workspaceId: string,
  propertyId: string,
  feed: {
    channel?: "airbnb" | "booking" | "vrbo" | "other";
    channelLabel?: string;
    status?: "active" | "failing";
  } = {},
): Promise<string> {
  const dataKeyId = await insertDataKey(db, workspaceId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO calendar_feed (workspace_id, property_id, channel, channel_label, url_ciphertext,
       url_fingerprint, display_hint, data_key_id, status, failing_since)
     VALUES ($1, $2, $3, $4, $5, $6, 'airbnb.com/…/a1b2.ics', $7, $8, CASE WHEN $8 = 'failing' THEN now() END)
     RETURNING id`,
    [
      workspaceId,
      propertyId,
      feed.channel ?? "airbnb",
      feed.channelLabel ?? null,
      randomBytes(64),
      randomBytes(16).toString("hex"),
      dataKeyId,
      feed.status ?? "active",
    ],
  );
  return rows[0]!.id;
}

export interface StayRow {
  source?: "ical" | "pms" | "manual";
  calendarFeedId?: string;
  pmsConnectionId?: string;
  externalUid?: string;
  checkInDate: string;
  checkoutDate: string;
  channel?: string;
  mayBeBlock?: boolean;
  guestName?: string;
  guestCount?: number;
  status?: "active" | "cancelled" | "hidden";
}

export async function insertStay(
  db: Db,
  workspaceId: string,
  propertyId: string,
  stay: StayRow,
): Promise<string> {
  const source = stay.source ?? "manual";
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stay (workspace_id, property_id, source, calendar_feed_id, pms_connection_id,
       external_uid, check_in_date, checkout_date, channel, may_be_block, guest_name, guest_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      workspaceId,
      propertyId,
      source,
      stay.calendarFeedId ?? null,
      stay.pmsConnectionId ?? null,
      stay.externalUid ?? (source === "manual" ? null : `uid-${randomUUID()}`),
      stay.checkInDate,
      stay.checkoutDate,
      stay.channel ?? (source === "manual" ? "Direct" : "Airbnb"),
      stay.mayBeBlock ?? false,
      source === "ical" ? null : (stay.guestName ?? null),
      source === "ical" ? null : (stay.guestCount ?? null),
      stay.status ?? "active",
    ],
  );
  return rows[0]!.id;
}

/** A PMS connection with placeholder ciphertext (not decryptable; for listing and RLS tests). */
export async function insertPmsConnection(
  db: Db,
  workspaceId: string,
  provider: "beds24" | "hostex" = "beds24",
): Promise<string> {
  const dataKeyId = await insertDataKey(db, workspaceId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pms_connection (workspace_id, provider, external_account_id, account_label,
       credential_ciphertext, data_key_id)
     VALUES ($1, $2, $3, 'Cuenta de prueba', $4, $5) RETURNING id`,
    [workspaceId, provider, `acct-${randomUUID()}`, randomBytes(64), dataKeyId],
  );
  return rows[0]!.id;
}

/**
 * Captures everything the process writes (Nest's logger, console, and worker jobs running in
 * this process) until `stop()`. `expectNoSecrets` fails the test if any secret appears.
 */
/* eslint-disable no-console -- the capture wraps console methods to inspect what they print */
export function captureLogs() {
  const chunks: string[] = [];
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const record =
    (original: typeof process.stdout.write) =>
    (chunk: unknown, ...rest: unknown[]): boolean => {
      chunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"),
      );
      return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
  process.stdout.write = record(stdoutWrite) as typeof process.stdout.write;
  process.stderr.write = record(stderrWrite) as typeof process.stderr.write;
  const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = consoleMethods.map((name) => console[name]);
  for (const name of consoleMethods) {
    const original = console[name];
    console[name] = (...args: unknown[]) => {
      chunks.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
      original(...args);
    };
  }
  return {
    text: () => chunks.join("\n"),
    stop: () => {
      process.stdout.write = stdoutWrite as typeof process.stdout.write;
      process.stderr.write = stderrWrite as typeof process.stderr.write;
      consoleMethods.forEach((name, index) => {
        console[name] = originals[index]!;
      });
    },
    expectNoSecrets: (secrets: string[]) => {
      const text = chunks.join("\n");
      for (const secret of secrets) {
        expect(text.includes(secret), `a secret appeared in the logs`).toBe(false);
      }
    },
  };
}
/* eslint-enable no-console */
