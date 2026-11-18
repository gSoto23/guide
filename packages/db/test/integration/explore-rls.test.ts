import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  experience,
  experienceClickDaily,
  experienceDestination,
  experiencePartnerReference,
  exploreSettings,
  membership,
  property,
  user,
  withRlsContext,
  workspace,
  type DbHandle,
} from "../../src/index.js";

/**
 * RLS on the feature 009 tables (T004, SEC-14, AC-SEC-004): partner content is read-only for members;
 * Explore settings are read by members, written by owners and admins, and stay in their workspace;
 * counts are read-only in a request. Fictional data.
 */
let handle: DbHandle;
const ana = `ana-${randomUUID()}`;
const aldo = `aldo-${randomUUID()}`;
const beto = `beto-${randomUUID()}`;
const wsA = randomUUID();
const wsB = randomUUID();
const key = `cr:test-${randomUUID().slice(0, 8)}`;
let propA = "";
let propB = "";

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(error, "expected the query to fail").toBeDefined();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

async function newProperty(workspaceId: string, createdBy: string): Promise<string> {
  const [row] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa",
      guideLanguages: ["es"],
      setupStatus: "ready",
      source: "manual",
      createdBy,
    })
    .returning({ id: property.id });
  return row!.id;
}

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  await handle.db
    .insert(user)
    .values([ana, aldo, beto].map((id) => ({ id, name: id, email: `${id}@example.com` })));
  await handle.db.insert(workspace).values([
    { id: wsA, name: "A", createdBy: ana },
    { id: wsB, name: "B", createdBy: beto },
  ]);
  await handle.db.insert(membership).values([
    { workspaceId: wsA, userId: ana, role: "owner" },
    { workspaceId: wsA, userId: aldo, role: "agent" },
    { workspaceId: wsB, userId: beto, role: "owner" },
  ]);
  propA = await newProperty(wsA, ana);
  propB = await newProperty(wsB, beto);
  await handle.db.insert(experienceDestination).values({ key, country: "CR", city: "Sámara" });
  const now = new Date();
  await handle.db.insert(experience).values({
    partner: "viator",
    productId: "TEST1",
    destinationKey: key,
    language: "es",
    category: "water",
    title: "Tour en catamarán",
    partnerUrl: "https://www.viator.com/tours/TEST1",
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 009 RLS (T004)", () => {
  it("lets members read partner content but never write it", async () => {
    const rows = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx
        .select({ title: experience.title })
        .from(experience)
        .where(eq(experience.destinationKey, key)),
    );
    expect(rows).toEqual([{ title: "Tour en catamarán" }]);
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.update(experience).set({ title: "Cambiado" }).where(eq(experience.destinationKey, key)),
      ),
      /permission denied/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.select().from(experiencePartnerReference),
      ),
      /permission denied/,
    );
  });

  it("lets owners write Explore settings, agents only read, and keeps them in the workspace", async () => {
    await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.insert(exploreSettings).values([
        { workspaceId: wsA, hiddenCategories: ["water"], updatedBy: ana },
        {
          workspaceId: wsA,
          propertyId: propA,
          followsDefault: false,
          hiddenExperiences: ["viator-TEST1"],
          updatedBy: ana,
        },
      ]),
    );
    const seen = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.select({ propertyId: exploreSettings.propertyId }).from(exploreSettings),
    );
    expect(seen).toHaveLength(2);
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.insert(exploreSettings).values({ workspaceId: wsA, propertyId: propA, updatedBy: aldo }),
      ),
      /row-level security/,
    );
    const updated = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx
        .update(exploreSettings)
        .set({ experiencesEnabled: false })
        .where(eq(exploreSettings.workspaceId, wsA))
        .returning({ id: exploreSettings.id }),
    );
    expect(updated).toEqual([]);
    const crossed = await withRlsContext(handle.db, { userId: beto, workspaceId: wsB }, (tx) =>
      tx.select().from(exploreSettings),
    );
    expect(crossed).toEqual([]);
    // A settings row can't point at another workspace's property.
    await expectDbError(
      handle.db.insert(exploreSettings).values({ workspaceId: wsA, propertyId: propB }),
      /does not match its property/,
    );
  });

  it("refuses invalid settings and keeps counts read-only in a request", async () => {
    await expectDbError(
      handle.db
        .insert(exploreSettings)
        .values({ workspaceId: wsB, hiddenCategories: ["nightlife"] }),
      /explore_settings_categories_valid/,
    );
    await expectDbError(
      handle.db
        .insert(exploreSettings)
        .values({ workspaceId: wsB, hiddenExperiences: ["viator-X"] }),
      /explore_settings_workspace_row/,
    );
    await handle.db.insert(experienceClickDaily).values({
      workspaceId: wsA,
      propertyId: propA,
      day: "2026-11-18",
      partner: "viator",
      ref: "viator-TEST1",
      clicks: 1,
    });
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.insert(experienceClickDaily).values({
          workspaceId: wsA,
          propertyId: propA,
          day: "2026-11-19",
          partner: "viator",
          ref: "viator-TEST1",
          clicks: 1,
        }),
      ),
      /permission denied|row-level security/,
    );
    await expectDbError(
      handle.db.insert(experienceClickDaily).values({
        workspaceId: wsA,
        propertyId: propA,
        day: "2026-11-19",
        partner: "viator",
        ref: "viator-../x",
        clicks: 1,
      }),
      /experience_click_daily_ref/,
    );
    const counts = await withRlsContext(handle.db, { userId: beto, workspaceId: wsB }, (tx) =>
      tx.select().from(experienceClickDaily),
    );
    expect(counts).toEqual([]);
  });
});
