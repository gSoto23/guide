import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  currentWorkspaceRole,
  membership,
  onboardingProfile,
  user,
  withRlsContext,
  workspace,
  type DbHandle,
} from "../../src/index.js";

let handle: DbHandle;
const ana = `ana-${randomUUID()}`;
const marco = `marco-${randomUUID()}`;
const wsAna = randomUUID();
const wsMarco = randomUUID();

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(error, "expected the query to fail").toBeDefined();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  const db = handle.db;
  // System context (owner connection), as the sign-up hook does.
  await db.insert(user).values([
    { id: ana, name: "Ana", email: `${ana}@example.com` },
    { id: marco, name: "Marco", email: `${marco}@example.com` },
  ]);
  await db.insert(workspace).values([
    { id: wsAna, name: "Espacio de Ana", createdBy: ana },
    { id: wsMarco, name: "Marco's workspace", createdBy: marco },
  ]);
  await db.insert(membership).values([
    { workspaceId: wsAna, userId: ana, role: "owner" },
    { workspaceId: wsMarco, userId: marco, role: "owner" },
  ]);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("tenancy RLS (T036, SEC-14)", () => {
  it("shows a user only the workspaces they belong to", async () => {
    const names = await withRlsContext(handle.db, { userId: ana }, async (tx) =>
      (await tx.select({ name: workspace.name }).from(workspace)).map((w) => w.name),
    );
    expect(names).toEqual(["Espacio de Ana"]);
  });

  it("derives the caller's role from their membership, and none for other workspaces", async () => {
    const own = await withRlsContext(
      handle.db,
      { userId: ana, workspaceId: wsAna },
      currentWorkspaceRole,
    );
    const other = await withRlsContext(
      handle.db,
      { userId: ana, workspaceId: wsMarco },
      currentWorkspaceRole,
    );
    expect(own).toBe("owner");
    expect(other).toBeNull();
  });

  it("hides another workspace's memberships even when its ID is guessed (AC-SEC-004)", async () => {
    const rows = await withRlsContext(
      handle.db,
      { userId: ana, workspaceId: wsMarco },
      async (tx) => tx.select().from(membership).where(eq(membership.workspaceId, wsMarco)),
    );
    expect(rows).toEqual([]);
  });

  it("does not let request handlers create workspaces or memberships directly", async () => {
    await expectDbError(
      withRlsContext(handle.db, { userId: ana }, (tx) =>
        tx.insert(workspace).values({ name: "Sneaky", createdBy: ana }),
      ),
      /permission denied/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsMarco }, (tx) =>
        tx.insert(membership).values({ workspaceId: wsMarco, userId: ana, role: "admin" }),
      ),
      /permission denied/,
    );
  });

  it("lets owners rename their workspace but never change its status from a request (T103)", async () => {
    await withRlsContext(handle.db, { userId: ana, workspaceId: wsAna }, (tx) =>
      tx.update(workspace).set({ name: "Casa de Ana" }).where(eq(workspace.id, wsAna)),
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsAna }, (tx) =>
        tx.update(workspace).set({ status: "pending_deletion" }).where(eq(workspace.id, wsAna)),
      ),
      /permission denied/,
    );
    const renamedElsewhere = await withRlsContext(
      handle.db,
      { userId: ana, workspaceId: wsMarco },
      (tx) =>
        tx
          .update(workspace)
          .set({ name: "Hijacked" })
          .where(eq(workspace.id, wsMarco))
          .returning({ id: workspace.id }),
    );
    expect(renamedElsewhere).toEqual([]);
  });

  it("shows a request only its own user row, never other users' emails (T103)", async () => {
    const rows = await withRlsContext(handle.db, { userId: ana }, (tx) =>
      tx.select({ id: user.id, email: user.email }).from(user),
    );
    expect(rows).toEqual([{ id: ana, email: `${ana}@example.com` }]);
    await expectDbError(
      withRlsContext(handle.db, { userId: ana }, (tx) =>
        tx.execute(sql`SELECT email_verified FROM "user"`),
      ),
      /permission denied/,
    );
  });

  it("never leaves a workspace without an owner", async () => {
    await expectDbError(
      handle.db.delete(membership).where(eq(membership.workspaceId, wsAna)),
      /must keep exactly one owner/,
    );
  });

  it("allows only one owner per workspace", async () => {
    const extra = `extra-${randomUUID()}`;
    await handle.db
      .insert(user)
      .values({ id: extra, name: "Extra", email: `${extra}@example.com` });
    await expectDbError(
      handle.db.insert(membership).values({ workspaceId: wsAna, userId: extra, role: "owner" }),
      /membership_one_owner_uq/,
    );
  });
});

describe("onboarding_profile RLS (T037)", () => {
  it("lets each user read and write only their own answers", async () => {
    await withRlsContext(handle.db, { userId: ana }, (tx) =>
      tx
        .insert(onboardingProfile)
        .values({ userId: ana, propertiesBucket: "1_2", path: "individual" }),
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana }, (tx) =>
        tx.insert(onboardingProfile).values({ userId: marco, path: "individual" }),
      ),
      /row-level security/,
    );
    const visibleToMarco = await withRlsContext(handle.db, { userId: marco }, (tx) =>
      tx.select().from(onboardingProfile),
    );
    expect(visibleToMarco).toEqual([]);
  });

  it("enforces the documented answer formats in the database", async () => {
    await expectDbError(
      handle.db.execute(
        sql`INSERT INTO onboarding_profile (user_id, pms, pms_other) VALUES (${marco}, 'hostaway', 'x')`,
      ),
      /onboarding_pms_other_valid/,
    );
  });
});
