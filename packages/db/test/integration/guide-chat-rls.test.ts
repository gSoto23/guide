import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { sql } from "drizzle-orm";
import {
  agentDraft,
  agentTrace,
  chatMessage,
  conversation,
  createDb,
  membership,
  property,
  user,
  withRlsContext,
  workspace,
  type DbHandle,
} from "../../src/index.js";

/**
 * RLS on the feature 005 tables (T008, SEC-14, AC-SEC-006): every member reads conversations;
 * members who handle conversations write host messages and draft actions; nobody in the request
 * context reads trace model, tokens, or cost; nothing crosses workspaces. Fictional data.
 */
let handle: DbHandle;
const ana = `ana-${randomUUID()}`;
const aldo = `aldo-${randomUUID()}`;
const beto = `beto-${randomUUID()}`;
const wsA = randomUUID();
const wsB = randomUUID();
const ids: Record<string, { conversation: string; draft: string; trace: string }> = {};

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(error, "expected the query to fail").toBeDefined();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

async function seed(workspaceId: string, createdBy: string) {
  const db = handle.db;
  const [prop] = await db
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
  const [conv] = await db
    .insert(conversation)
    .values({
      workspaceId,
      propertyId: prop!.id,
      cookieHash: createHash("sha256").update(randomUUID()).digest("hex"),
      language: "es",
      status: "needs_host",
      needsHostReason: "draft_ready",
    })
    .returning({ id: conversation.id });
  await db.insert(chatMessage).values({
    workspaceId,
    conversationId: conv!.id,
    seq: 1,
    author: "guest",
    body: "¿A qué hora es la salida?",
  });
  const [trace] = await db
    .insert(agentTrace)
    .values({
      workspaceId,
      conversationId: conv!.id,
      decision: "drafted",
      reason: "draft_ready",
      autonomy: "draft",
      model: "fake",
      inputTokens: 100,
      costUsdMicros: 400,
    })
    .returning({ id: agentTrace.id });
  const [draft] = await db
    .insert(agentDraft)
    .values({ workspaceId, conversationId: conv!.id, traceId: trace!.id, body: "A las 11:00." })
    .returning({ id: agentDraft.id });
  return { conversation: conv!.id, draft: draft!.id, trace: trace!.id };
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
  ids.A = await seed(wsA, ana);
  ids.B = await seed(wsB, beto);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 005 RLS (T008)", () => {
  it("shows members their workspace's conversations, messages, and drafts only", async () => {
    const rows = await withRlsContext(
      handle.db,
      { userId: aldo, workspaceId: wsA },
      async (tx) => ({
        conversations: (await tx.select({ id: conversation.id }).from(conversation)).map(
          (r) => r.id,
        ),
        drafts: (await tx.select({ id: agentDraft.id }).from(agentDraft)).map((r) => r.id),
        messages: (await tx.select({ id: chatMessage.id }).from(chatMessage)).length,
      }),
    );
    expect(rows.conversations).toEqual([ids.A!.conversation]);
    expect(rows.drafts).toEqual([ids.A!.draft]);
    expect(rows.messages).toBe(1);
    const crossed = await withRlsContext(handle.db, { userId: ana, workspaceId: wsB }, (tx) =>
      tx.select({ id: conversation.id }).from(conversation),
    );
    expect(crossed).toEqual([]);
  });

  it("never lets the request role read trace cost or the cookie hash (FR-031)", async () => {
    for (const statement of [
      "SELECT model FROM agent_trace",
      "SELECT cost_usd_micros FROM agent_trace",
      "SELECT input_tokens FROM agent_trace",
      "SELECT cookie_hash FROM conversation",
    ]) {
      await expectDbError(
        withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
          tx.execute(sql.raw(statement)),
        ),
        /permission denied/,
      );
    }
    const visible = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.execute(sql`SELECT decision, reason FROM agent_trace`),
    );
    expect(visible.rows).toEqual([{ decision: "drafted", reason: "draft_ready" }]);
  });

  it("lets agents write host messages and draft actions, never guest or assistant messages", async () => {
    await withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, async (tx) => {
      await tx.insert(chatMessage).values({
        workspaceId: wsA,
        conversationId: ids.A!.conversation,
        seq: 2,
        author: "host",
        body: "A las 11:00, gracias.",
        authorUserId: aldo,
      });
      await tx.execute(
        sql`UPDATE agent_draft SET status = 'sent', acted_by = ${aldo}, acted_at = now() WHERE id = ${ids.A!.draft}`,
      );
    });
    await expectDbError(
      withRlsContext(handle.db, { userId: aldo, workspaceId: wsA }, (tx) =>
        tx.insert(chatMessage).values({
          workspaceId: wsA,
          conversationId: ids.A!.conversation,
          seq: 3,
          author: "assistant",
          body: "Falso",
        }),
      ),
      /row-level security/,
    );
    const foreign = await withRlsContext(handle.db, { userId: ana, workspaceId: wsA }, (tx) =>
      tx.execute(
        sql`UPDATE agent_draft SET status = 'discarded' WHERE id = ${ids.B!.draft} RETURNING id`,
      ),
    );
    expect(foreign.rows).toEqual([]);
  });
});
