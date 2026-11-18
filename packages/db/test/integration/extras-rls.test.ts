import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  extra,
  membership,
  property,
  serviceRequest,
  stay,
  user,
  withRlsContext,
  workspace,
  type DbHandle,
} from "../../src/index.js";

/**
 * RLS on the feature 008 tables (T004, SEC-14, AC-SEC-004): owners and admins write the catalog,
 * agents only read it; members who handle conversations answer requests; requests are created only in
 * the system context and must match their stay; nothing crosses workspaces. Fictional data.
 */
let handle: DbHandle;
const ana = `ana-${randomUUID()}`;
const aldo = `aldo-${randomUUID()}`;
const beto = `beto-${randomUUID()}`;
const wsA = randomUUID();
const wsB = randomUUID();
let propA = "";
let propB = "";
let stayA = "";
let stayB = "";

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

async function newStay(workspaceId: string, propertyId: string): Promise<string> {
  const [row] = await handle.db
    .insert(stay)
    .values({
      workspaceId,
      propertyId,
      source: "manual",
      checkInDate: "2026-12-11",
      checkoutDate: "2026-12-15",
      channel: "Directo",
    })
    .returning({ id: stay.id });
  return row!.id;
}

const anExtra = (workspaceId: string, propertyId: string) => ({
  workspaceId,
  propertyId,
  sourceLanguage: "es" as const,
  name: { es: "Recogida en el aeropuerto" },
  price: 85,
  currency: "USD",
});

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
  stayA = await newStay(wsA, propA);
  stayB = await newStay(wsB, propB);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 008 RLS (T004)", () => {
  it("lets owners write the catalog, agents only read it, and keeps it in the workspace", async () => {
    const [created] = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.insert(extra).values(anExtra(wsA, propA)).returning({ id: extra.id }),
    );
    expect(created).toBeDefined();
    const seen = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.select({ id: extra.id }).from(extra),
    );
    expect(seen).toEqual([{ id: created!.id }]);
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.insert(extra).values(anExtra(wsA, propA)),
      ),
      /row-level security/,
    );
    const changed = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx
        .update(extra)
        .set({ price: 1 })
        .where(eq(extra.id, created!.id))
        .returning({ id: extra.id }),
    );
    expect(changed).toEqual([]);
    const crossed = await withRlsContext(handle.db, { userId: beto, workspaceId: wsB }, (tx) =>
      tx.select().from(extra),
    );
    expect(crossed).toEqual([]);
    await expectDbError(
      handle.db.insert(extra).values(anExtra(wsA, propB)),
      /does not match its property/,
    );
  });

  it("refuses invalid extras", async () => {
    for (const [patch, rule] of [
      [{ currency: "BTC" }, /extra_currency_valid/],
      [{ price: -1 }, /extra_price/],
      [{ name: { en: "No Spanish" } }, /extra_name_valid/],
      [{ maxPerStay: 11 }, /extra_max_per_stay/],
      [{ weekdays: [0] }, /extra_weekdays_valid/],
      [{ turnover: "early_check_in", needsDate: true }, /extra_turnover_valid/],
    ] as const) {
      await expectDbError(
        handle.db.insert(extra).values({ ...anExtra(wsA, propA), ...(patch as object) }),
        rule,
      );
    }
  });

  it("creates requests only in the system context, tied to their stay, and lets agents answer them", async () => {
    const request = {
      workspaceId: wsA,
      propertyId: propA,
      stayId: stayA,
      extraName: { es: "Recogida" },
      sourceLanguage: "es" as const,
      price: 85,
      currency: "USD",
      expiresAt: new Date("2026-12-10T00:00:00Z"),
    };
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.insert(serviceRequest).values(request),
      ),
      /permission denied|row-level security/,
    );
    await expectDbError(
      handle.db.insert(serviceRequest).values({ ...request, stayId: stayB }),
      /does not match its stay/,
    );
    const [row] = await handle.db
      .insert(serviceRequest)
      .values({ ...request, note: "Somos 4" })
      .returning({ id: serviceRequest.id });
    const answered = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx
        .update(serviceRequest)
        .set({ status: "confirmed", answeredBy: aldo, answeredAt: new Date() })
        .where(eq(serviceRequest.id, row!.id))
        .returning({ status: serviceRequest.status }),
    );
    expect(answered).toEqual([{ status: "confirmed" }]);
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.update(serviceRequest).set({ price: 1 }).where(eq(serviceRequest.id, row!.id)),
      ),
      /permission denied/,
    );
    const crossed = await withRlsContext(handle.db, { userId: beto, workspaceId: wsB }, (tx) =>
      tx.select().from(serviceRequest),
    );
    expect(crossed).toEqual([]);
  });
});
