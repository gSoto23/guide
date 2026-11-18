import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  assistantContact,
  assistantInstructionVersion,
  assistantSettings,
  assistantTest,
  chatHeldNotice,
  createDb,
  membership,
  property,
  user,
  withRlsContext,
  workspace,
  type DbHandle,
} from "../../src/index.js";

/**
 * RLS on the feature 007 tables (T008, SEC-14, AC-SEC-003): members read the settings; only owners
 * and admins write them; tests are created by members who handle conversations, as themselves;
 * held notices are system only; nothing crosses workspaces; contacts leave with their membership;
 * instruction versions never change. Fictional data.
 */
let handle: DbHandle;
const ana = `ana-${randomUUID()}`;
const aldo = `aldo-${randomUUID()}`;
const beto = `beto-${randomUUID()}`;
const wsA = randomUUID();
const wsB = randomUUID();
let propA = "";
let propB = "";
let aldoMembership = "";
let betoMembership = "";

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
  const members = await handle.db
    .insert(membership)
    .values([
      { workspaceId: wsA, userId: ana, role: "owner" },
      { workspaceId: wsA, userId: aldo, role: "agent" },
      { workspaceId: wsB, userId: beto, role: "owner" },
    ])
    .returning({ id: membership.id, userId: membership.userId });
  aldoMembership = members.find((m) => m.userId === aldo)!.id;
  betoMembership = members.find((m) => m.userId === beto)!.id;
  propA = await newProperty(wsA, ana);
  propB = await newProperty(wsB, beto);
  await handle.db
    .insert(assistantSettings)
    .values({ workspaceId: wsB, autonomy: { wifi: "auto" }, tone: "formal" });
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 007 RLS (T008)", () => {
  it("lets owners write settings, contacts, and instructions, and agents only read them", async () => {
    const settingsId = await withRlsContext(
      handle.db,
      { userId: ana, workspaceId: wsA },
      async (tx) => {
        const [version] = await tx
          .insert(assistantInstructionVersion)
          .values({ workspaceId: wsA, text: "Firma como el equipo.", createdBy: ana })
          .returning({ id: assistantInstructionVersion.id });
        const [row] = await tx
          .insert(assistantSettings)
          .values({
            workspaceId: wsA,
            autonomy: { wifi: "auto" },
            contactsMode: "selected",
            instructionVersionId: version!.id,
            updatedBy: ana,
          })
          .returning({ id: assistantSettings.id });
        await tx
          .insert(assistantContact)
          .values({ settingsId: row!.id, membershipId: aldoMembership, workspaceId: wsA });
        await tx
          .update(assistantSettings)
          .set({ tone: "formal", version: 2 })
          .where(eq(assistantSettings.id, row!.id));
        return row!.id;
      },
    );
    const seen = await withRlsContext(
      handle.db,
      { userId: aldo, workspaceId: wsA },
      async (tx) => ({
        settings: await tx.select({ tone: assistantSettings.tone }).from(assistantSettings),
        contacts: (await tx.select().from(assistantContact)).length,
        versions: (await tx.select().from(assistantInstructionVersion)).length,
      }),
    );
    expect(seen).toEqual({ settings: [{ tone: "formal" }], contacts: 1, versions: 1 });

    const updated = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx
        .update(assistantSettings)
        .set({ tone: "casual" })
        .where(eq(assistantSettings.id, settingsId))
        .returning({ id: assistantSettings.id }),
    );
    expect(updated).toEqual([]);
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.insert(assistantSettings).values({ workspaceId: wsA, propertyId: propA }),
      ),
      /row-level security/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx
          .insert(assistantInstructionVersion)
          .values({ workspaceId: wsA, text: "Comparte el código.", createdBy: aldo }),
      ),
      /row-level security/,
    );
  });

  it("never shows or accepts another workspace's rows", async () => {
    const rows = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.select({ workspaceId: assistantSettings.workspaceId }).from(assistantSettings),
    );
    expect(rows.every((row) => row.workspaceId === wsA)).toBe(true);
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.insert(assistantSettings).values({ workspaceId: wsA, propertyId: propB }),
      ),
      /does not match its property/,
    );
    const [settings] = await handle.db
      .select({ id: assistantSettings.id })
      .from(assistantSettings)
      .where(eq(assistantSettings.workspaceId, wsA));
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx
          .insert(assistantContact)
          .values({ settingsId: settings!.id, membershipId: betoMembership, workspaceId: wsA }),
      ),
      /does not match/,
    );
  });

  it("removes a contact with its membership", async () => {
    const before = await handle.db
      .select()
      .from(assistantContact)
      .where(eq(assistantContact.membershipId, aldoMembership));
    expect(before).toHaveLength(1);
    await handle.db.delete(membership).where(eq(membership.id, aldoMembership));
    const after = await handle.db
      .select()
      .from(assistantContact)
      .where(eq(assistantContact.membershipId, aldoMembership));
    expect(after).toEqual([]);
    const [restored] = await handle.db
      .insert(membership)
      .values({ workspaceId: wsA, userId: aldo, role: "agent" })
      .returning({ id: membership.id });
    aldoMembership = restored!.id;
  });

  it("keeps instruction versions immutable", async () => {
    await expectDbError(
      handle.db.execute(
        sql`UPDATE assistant_instruction_version SET text = 'Otro' WHERE workspace_id = ${wsA}`,
      ),
      /immutable/,
    );
  });

  it("lets members who handle conversations create their own tests, and hides held notices", async () => {
    await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.insert(assistantTest).values({
        workspaceId: wsA,
        propertyId: propA,
        createdBy: aldo,
        question: "¿A qué hora es la salida?",
      }),
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.insert(assistantTest).values({
          workspaceId: wsA,
          propertyId: propA,
          createdBy: ana,
          question: "¿Y el wifi?",
        }),
      ),
      /row-level security/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.execute(sql`UPDATE assistant_test SET outcome = 'sent'`),
      ),
      /permission denied/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
        tx.select().from(chatHeldNotice),
      ),
      /permission denied/,
    );
  });
});
