import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuideView, PropertyDetail, PublishCheck } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Publishing a 50-item guide: p95 ≤ 1 second from request to response over 20 publishes (003
 * plan, Performance Budget; T073). Each run changes one item so every publish writes a version.
 * All data is fictional.
 */
const RUNS = 20;
const ITEMS = 50;
const BUDGET_MS = 1_000;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;
let firstItemId: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "publish-perf");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Grande",
  });
  propertyId = (created.json() as PropertyDetail).id;
  const view = (
    await wsApi(ctx, team.owner, "GET", team.workspaceId, `/properties/${propertyId}/guide`)
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
    const itemId = rows[0]!.id;
    firstItemId ??= itemId;
    for (const language of ["es", "en"]) {
      await db.query(
        `INSERT INTO guide_item_text (item_id, language, workspace_id, doc, text_length, origin, state)
         VALUES ($1, $2, $3, $4, $5, $6, 'current')`,
        [
          itemId,
          language,
          team.workspaceId,
          JSON.stringify(doc(text)),
          text.length,
          language === "es" ? "source" : "machine",
        ],
      );
    }
  }
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

describe("publishing a guide (Performance Budget)", () => {
  it(`keeps p95 within 1 s over ${RUNS} publishes of ${ITEMS} items`, async () => {
    const timings: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      await db.query(`UPDATE guide_item_text SET doc = $2 WHERE item_id = $1 AND language = 'es'`, [
        firstItemId,
        JSON.stringify(doc(`Versión ${run}: la llave está en la recepción.`)),
      ]);
      const check = (
        await wsApi(
          ctx,
          team.owner,
          "GET",
          team.workspaceId,
          `/properties/${propertyId}/guide/publish-check`,
        )
      ).json() as PublishCheck;
      const started = performance.now();
      const response = await wsApi(
        ctx,
        team.owner,
        "POST",
        team.workspaceId,
        `/properties/${propertyId}/guide/publish`,
        { expectedRevisionHash: check.revisionHash },
      );
      timings.push(performance.now() - started);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toEqual({ versionNumber: run + 1 });
    }
    const p95 = percentile(timings, 95);
    console.info(`guide publish p95: ${p95.toFixed(0)} ms (${ITEMS} items)`);
    expect(p95).toBeLessThanOrEqual(BUDGET_MS);
  });
});
