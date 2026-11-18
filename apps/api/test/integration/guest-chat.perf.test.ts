import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Guest chat timings (feature 005 T048, plan Performance Budget): sending a message and reading
 * the chat, p95 ≤ 300 ms at the origin, over 20 requests each, on a conversation with 40 messages.
 */
const RUNS = 20;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "chat-perf");
  published = await publishedGuide(ctx, team);
  const first = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
    payload: { publicId: published.publicId, text: "Hola", language: "es", clientId: randomUUID() },
  });
  const raw = first.headers["set-cookie"];
  cookie = (Array.isArray(raw) ? raw[0] : raw)!.split(";")[0]!;
  await db.query(
    `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, kind, body)
     SELECT c.workspace_id, c.id, 1 + n, CASE WHEN n % 2 = 0 THEN 'assistant' ELSE 'guest' END, 'text',
            'Mensaje de prueba número ' || n
       FROM conversation c, generate_series(1, 40) n
      WHERE c.property_id = $1`,
    [published.propertyId],
  );
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function timed(fn: () => Promise<{ statusCode: number }>, status: number): Promise<number> {
  const started = performance.now();
  const response = await fn();
  const elapsed = performance.now() - started;
  expect(response.statusCode).toBe(status);
  return elapsed;
}

describe("guest chat timings (feature 005 plan)", () => {
  it("reads the chat with p95 ≤ 300 ms", async () => {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      times.push(
        await timed(
          () => guest(ctx, "GET", `/api/v1/guest/chat?publicId=${published.publicId}`, { cookie }),
          200,
        ),
      );
    }
    expect(percentile(times, 95)).toBeLessThanOrEqual(300);
  });

  it("sends a message (stored and queued) with p95 ≤ 300 ms", async () => {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      // A fresh device each time, so the device limit never interferes.
      times.push(
        await timed(
          () =>
            guest(ctx, "POST", "/api/v1/guest/chat/messages", {
              payload: {
                publicId: published.publicId,
                text: `¿Pregunta ${i}?`,
                language: "es",
                clientId: randomUUID(),
              },
            }),
          202,
        ),
      );
    }
    expect(percentile(times, 95)).toBeLessThanOrEqual(300);
  });
});
