import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  agentTrace,
  assistantSuggestionDismissal,
  conversation,
  conversationPresence,
  copilotRun,
  createDb,
  membership,
  property,
  pushSubscription,
  user,
  withRlsContext,
  workspace,
  type DbHandle,
} from "../../src/index.js";

/**
 * RLS on the feature 006 tables (T005, SEC-14, AC-SEC-004, AC-SEC-005): copilot drafts, presence, and
 * dismissals stay in their workspace; push subscriptions stay with their user; members who handle
 * conversations take over and mark done; traces have exactly one subject. Fictional data.
 */
let handle: DbHandle;
const ana = `ana-${randomUUID()}`;
const aldo = `aldo-${randomUUID()}`;
const beto = `beto-${randomUUID()}`;
const wsA = randomUUID();
const wsB = randomUUID();
let propA = "";
let propB = "";
let convA = "";

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
  const [conv] = await handle.db
    .insert(conversation)
    .values({
      workspaceId: wsA,
      propertyId: propA,
      cookieHash: createHash("sha256").update(randomUUID()).digest("hex"),
      language: "es",
    })
    .returning({ id: conversation.id });
  convA = conv!.id;
  await handle.db.insert(pushSubscription).values([
    {
      userId: aldo,
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: "k",
      auth: "a",
      device: "chrome-android",
    },
    {
      userId: beto,
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: "k",
      auth: "a",
      device: "safari-ios",
    },
  ]);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 006 RLS (T005)", () => {
  it("lets an agent take over, mark done, and write presence, within the workspace", async () => {
    await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, async (tx) => {
      await tx
        .update(conversation)
        .set({ takenOverBy: aldo, takenOverAt: new Date() })
        .where(eq(conversation.id, convA));
      await tx
        .update(conversation)
        .set({ status: "done", needsHostReason: null, doneAt: new Date(), doneBy: aldo })
        .where(eq(conversation.id, convA));
      await tx
        .insert(conversationPresence)
        .values({
          conversationId: convA,
          userId: aldo,
          workspaceId: wsA,
          expiresAt: new Date(Date.now() + 30_000),
        });
    });
    const seen = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.select({ userId: conversationPresence.userId }).from(conversationPresence),
    );
    expect(seen).toEqual([{ userId: aldo }]);
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx
          .insert(conversationPresence)
          .values({ conversationId: convA, userId: ana, workspaceId: wsA, expiresAt: new Date() }),
      ),
      /row-level security/,
    );
    const crossed = await withRlsContext(handle.db, { userId: beto, workspaceId: wsB }, (tx) =>
      tx.select().from(conversationPresence),
    );
    expect(crossed).toEqual([]);
  });

  it("keeps done consistent", async () => {
    await expectDbError(
      handle.db
        .update(conversation)
        .set({ status: "done", doneAt: null })
        .where(eq(conversation.id, convA)),
      /conversation_done_consistent/,
    );
  });

  it("keeps copilot drafts and dismissals in their workspace, created by their member", async () => {
    await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, async (tx) => {
      await tx.insert(copilotRun).values({
        workspaceId: wsA,
        propertyId: propA,
        createdBy: aldo,
        message: "¿Puedo llevar a mi perro?",
        bookingStatus: "confirmed",
      });
      await tx.insert(assistantSuggestionDismissal).values({
        workspaceId: wsA,
        propertyId: propA,
        topic: "parking",
        dismissedUntil: new Date(Date.now() + 86_400_000),
        dismissedBy: aldo,
      });
    });
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.insert(copilotRun).values({
          workspaceId: wsA,
          propertyId: propB,
          createdBy: aldo,
          message: "Hola",
          bookingStatus: "inquiry",
        }),
      ),
      /does not match its property/,
    );
    const theirs = await withRlsContext(
      handle.db,
      { userId: beto, workspaceId: wsB },
      async (tx) => ({
        runs: await tx.select().from(copilotRun),
        dismissals: await tx.select().from(assistantSuggestionDismissal),
      }),
    );
    expect(theirs).toEqual({ runs: [], dismissals: [] });
  });

  it("shows each user only their own push devices, never the keys", async () => {
    const mine = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx.select({ device: pushSubscription.device }).from(pushSubscription),
    );
    expect(mine).toEqual([{ device: "chrome-android" }]);
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.execute(sql`SELECT endpoint FROM push_subscription`),
      ),
      /permission denied/,
    );
    const deleted = await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
      tx
        .delete(pushSubscription)
        .where(eq(pushSubscription.device, "safari-ios"))
        .returning({ id: pushSubscription.id }),
    );
    expect(deleted).toEqual([]);
  });

  it("requires exactly one subject per trace", async () => {
    const [run] = await handle.db
      .insert(copilotRun)
      .values({
        workspaceId: wsA,
        propertyId: propA,
        createdBy: ana,
        message: "Hola",
        bookingStatus: "inquiry",
      })
      .returning({ id: copilotRun.id });
    await handle.db
      .insert(agentTrace)
      .values({ workspaceId: wsA, copilotRunId: run!.id, decision: "drafted", autonomy: "draft" });
    await expectDbError(
      handle.db
        .insert(agentTrace)
        .values({
          workspaceId: wsA,
          copilotRunId: run!.id,
          conversationId: convA,
          decision: "drafted",
          autonomy: "draft",
        }),
      /agent_trace_subject/,
    );
  });
});
