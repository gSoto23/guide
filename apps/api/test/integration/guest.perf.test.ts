import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuideView } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  exchange,
  guest,
  guideApi,
  publish,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Guest timings on a 50-item guide (feature 004 SC-009, plan Performance Budget): the public guide
 * data p95 ≤ 300 ms at the origin (a CDN miss) and a reveal p95 ≤ 500 ms, over 20 requests each.
 */
const ITEMS = 50;
const RUNS = 20;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let cookie: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guest-perf");
  published = await publishedGuide(ctx, team, { name: "Casa Grande" });
  const view = (
    await guideApi(ctx, team.owner, team, published.propertyId, "GET", "/guide")
  ).json() as GuideView;
  const sections = view.sections.filter((section) => section.kind !== "custom");
  for (let index = 0; index < ITEMS; index += 1) {
    const section = sections[index % sections.length]!;
    const text = `Instrucción ${index}: abre la ventana del cuarto ${index} para ventilar por la mañana.`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO guide_item (workspace_id, section_id, kind, position, source, source_language, reviewed_at)
       VALUES ($1, $2, 'text', $3, 'host', 'es', now()) RETURNING id`,
      [team.workspaceId, section.id, 100 + index],
    );
    for (const language of ["es", "en"]) {
      await db.query(
        `INSERT INTO guide_item_text (item_id, language, workspace_id, doc, text_length, origin, state)
         VALUES ($1, $2, $3, $4, $5, $6, 'current')`,
        [
          rows[0]!.id,
          language,
          team.workspaceId,
          JSON.stringify(doc(text)),
          text.length,
          language === "es" ? "source" : "machine",
        ],
      );
    }
  }
  await publish(ctx, team, published.propertyId);
  const stayId = await addStay(ctx, team, published.propertyId, 0);
  const { token } = await copyStayLink(ctx, team, published.propertyId, stayId);
  cookie = (await exchange(ctx, token)).cookie!;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function time(request: () => Promise<{ statusCode: number }>): Promise<number[]> {
  const timings: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    const response = await request();
    timings.push(performance.now() - started);
    expect(response.statusCode).toBe(200);
  }
  return timings;
}

describe("guest timings (SC-009)", () => {
  it(`serves the public guide data with p95 ≤ 300 ms on ${ITEMS} items`, async () => {
    const timings = await time(() =>
      guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}?lang=en`),
    );
    expect(percentile(timings, 95)).toBeLessThanOrEqual(300);
  });

  it("shows a value with p95 ≤ 500 ms", async () => {
    const timings = await time(() =>
      guest(ctx, "POST", "/api/v1/guest/reveals", {
        payload: { publicId: published.publicId, fieldId: published.lockboxId },
        cookie,
      }),
    );
    expect(percentile(timings, 95)).toBeLessThanOrEqual(500);
  });
});
