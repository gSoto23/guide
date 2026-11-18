import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  guide,
  guideLink,
  guideOpenDaily,
  guideSession,
  membership,
  property,
  stay,
  stayLink,
  user,
  withRlsContext,
  workspace,
  workspaceDataKey,
  type DbHandle,
  type Transaction,
} from "../../src/index.js";

/**
 * RLS on the four feature 004 tables (T008, SEC-14, AC-SEC-008): members read property links and
 * open counts; owners and admins read stay links and sessions, never their ciphertexts; agents
 * see no stay links; nothing crosses workspaces; stay links and sessions must match their parents.
 * Setup runs in the system context (owner connection). All data is fictional.
 */
let handle: DbHandle;

const ana = `ana-${randomUUID()}`; // owner of A
const alba = `alba-${randomUUID()}`; // admin of A
const aldo = `aldo-${randomUUID()}`; // agent of A
const beto = `beto-${randomUUID()}`; // owner of B
const wsA = randomUUID();
const wsB = randomUUID();

interface Fixture {
  propertyId: string;
  otherPropertyId: string;
  stayId: string;
  linkId: string;
  stayLinkId: string;
  sessionId: string;
  dataKeyId: string;
}
const fixtures: Record<string, Fixture> = {};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const publicId = () =>
  Array.from(randomBytes(26), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte % 32]).join("");

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(error, "expected the query to fail").toBeDefined();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

async function seed(workspaceId: string, createdBy: string): Promise<Fixture> {
  const db = handle.db;
  const [dataKey] = await db
    .insert(workspaceDataKey)
    .values({ workspaceId, wrappedKey: randomBytes(48), kmsKeyId: "local" })
    .returning({ id: workspaceDataKey.id });
  const props = await db
    .insert(property)
    .values(
      ["Casa Uno", "Casa Dos"].map((name) => ({
        workspaceId,
        name,
        guideLanguages: ["es", "en"] as ("es" | "en")[],
        setupStatus: "ready" as const,
        source: "manual" as const,
        createdBy,
      })),
    )
    .returning({ id: property.id });
  const propertyId = props[0]!.id;
  await db.insert(guide).values({ workspaceId, propertyId });
  const [link] = await db
    .insert(guideLink)
    .values({ workspaceId, propertyId, publicId: publicId(), createdBy })
    .returning({ id: guideLink.id });
  const [s] = await db
    .insert(stay)
    .values({
      workspaceId,
      propertyId,
      source: "manual",
      checkInDate: "2027-01-10",
      checkoutDate: "2027-01-12",
      channel: "Directo",
    })
    .returning({ id: stay.id });
  const stayLinkId = randomUUID();
  await db.insert(stayLink).values({
    id: stayLinkId,
    workspaceId,
    propertyId,
    stayId: s!.id,
    tokenHash: hash(randomUUID()),
    tokenCiphertext: randomBytes(64),
    dataKeyId: dataKey!.id,
    confirmationCiphertext: randomBytes(40),
    createdBy,
  });
  const [session] = await db
    .insert(guideSession)
    .values({ workspaceId, propertyId, stayLinkId, cookieHash: hash(randomUUID()) })
    .returning({ id: guideSession.id });
  await db
    .insert(guideOpenDaily)
    .values({ workspaceId, propertyId, day: "2027-01-10", linkKind: "property", opens: 3 });
  return {
    propertyId,
    otherPropertyId: props[1]!.id,
    stayId: s!.id,
    linkId: link!.id,
    stayLinkId,
    sessionId: session!.id,
    dataKeyId: dataKey!.id,
  };
}

async function visible(tx: Transaction): Promise<Record<string, string[]>> {
  const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((row) => row.id);
  return {
    guide_link: await ids(tx.select({ id: guideLink.id }).from(guideLink)),
    stay_link: await ids(tx.select({ id: stayLink.id }).from(stayLink)),
    guide_session: await ids(tx.select({ id: guideSession.id }).from(guideSession)),
    guide_open_daily: await ids(tx.select({ id: guideOpenDaily.propertyId }).from(guideOpenDaily)),
  };
}

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  const db = handle.db;
  await db
    .insert(user)
    .values([ana, alba, aldo, beto].map((id) => ({ id, name: id, email: `${id}@example.com` })));
  await db.insert(workspace).values([
    { id: wsA, name: "Espacio A", createdBy: ana },
    { id: wsB, name: "Espacio B", createdBy: beto },
  ]);
  await db.insert(membership).values([
    { workspaceId: wsA, userId: ana, role: "owner" },
    { workspaceId: wsA, userId: alba, role: "admin" },
    { workspaceId: wsA, userId: aldo, role: "agent" },
    { workspaceId: wsB, userId: beto, role: "owner" },
  ]);
  fixtures.A = await seed(wsA, ana);
  fixtures.B = await seed(wsB, beto);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 004 RLS (T008, SEC-14)", () => {
  it("shows owners and admins their own links, sessions, and counts, and nothing of B", async () => {
    for (const userId of [ana, alba]) {
      const rows = await withRlsContext(handle.db, { userId, workspaceId: wsA }, visible);
      expect(rows.guide_link).toEqual([fixtures.A!.linkId]);
      expect(rows.stay_link).toEqual([fixtures.A!.stayLinkId]);
      expect(rows.guide_session).toEqual([fixtures.A!.sessionId]);
      expect(rows.guide_open_daily).toEqual([fixtures.A!.propertyId]);
    }
    const crossed = await withRlsContext(handle.db, { userId: ana, workspaceId: wsB }, visible);
    expect(Object.values(crossed).flat()).toEqual([]);
  });

  it("shows agents the property link and counts but no stay links or sessions (AC-SEC-008)", async () => {
    const rows = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, visible);
    expect(rows.guide_link).toEqual([fixtures.A!.linkId]);
    expect(rows.guide_open_daily).toEqual([fixtures.A!.propertyId]);
    expect(rows.stay_link).toEqual([]);
    expect(rows.guide_session).toEqual([]);
  });

  it("never lets the request role read token or code ciphertexts or cookie hashes (SEC-06)", async () => {
    for (const column of ["token_ciphertext", "confirmation_ciphertext", "token_hash"]) {
      await expectDbError(
        withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
          tx.execute(sql.raw(`SELECT ${column} FROM stay_link`)),
        ),
        /permission denied/,
      );
    }
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.execute(sql`SELECT cookie_hash FROM guide_session`),
      ),
      /permission denied/,
    );
  });

  it("lets owners revoke a stay link but never insert one or write sessions and counts", async () => {
    await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.execute(
        sql`UPDATE stay_link SET last_copied_at = now(), last_copied_by = ${ana} WHERE id = ${fixtures.A!.stayLinkId}`,
      ),
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.insert(stayLink).values({
          id: randomUUID(),
          workspaceId: wsA,
          propertyId: fixtures.A!.propertyId,
          stayId: fixtures.A!.stayId,
          tokenHash: hash("x"),
          tokenCiphertext: randomBytes(10),
          dataKeyId: fixtures.A!.dataKeyId,
        }),
      ),
      /permission denied/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.execute(sql`UPDATE guide_open_daily SET opens = 0`),
      ),
      /permission denied/,
    );
    const agentUpdate = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.execute(
        sql`UPDATE stay_link SET last_copied_at = now() WHERE id = ${fixtures.A!.stayLinkId} RETURNING id`,
      ),
    );
    expect(agentUpdate.rows).toEqual([]);
  });

  it("refuses a stay link or session whose workspace or property differs from its parent", async () => {
    await expectDbError(
      handle.db.insert(stayLink).values({
        id: randomUUID(),
        workspaceId: wsA,
        propertyId: fixtures.A!.otherPropertyId,
        stayId: fixtures.A!.stayId,
        tokenHash: hash(randomUUID()),
        tokenCiphertext: randomBytes(10),
        dataKeyId: fixtures.A!.dataKeyId,
      }),
      /does not match its stay/,
    );
    await expectDbError(
      handle.db.insert(guideSession).values({
        workspaceId: wsB,
        propertyId: fixtures.B!.propertyId,
        stayLinkId: fixtures.A!.stayLinkId,
        cookieHash: hash(randomUUID()),
      }),
      /does not match its stay link/,
    );
  });

  it("allows one active property link and one active stay link per stay", async () => {
    await expectDbError(
      handle.db.insert(guideLink).values({
        workspaceId: wsA,
        propertyId: fixtures.A!.propertyId,
        publicId: publicId(),
      }),
      /guide_link_active_uq/,
    );
    await expectDbError(
      handle.db.insert(stayLink).values({
        id: randomUUID(),
        workspaceId: wsA,
        propertyId: fixtures.A!.propertyId,
        stayId: fixtures.A!.stayId,
        tokenHash: hash(randomUUID()),
        tokenCiphertext: randomBytes(10),
        dataKeyId: fixtures.A!.dataKeyId,
      }),
      /stay_link_active_uq/,
    );
  });
});
