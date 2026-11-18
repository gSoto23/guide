import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PropertyDetail } from "@guidesk/contracts";
import { createGuideForProperty, createDb, type DbHandle } from "@guidesk/db";
import { systemQuery } from "./helpers.js";
import {
  insertProperty,
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Every property gets its guide (feature 003 FR-001, FR-006, research R16, T017): the nine default
 * sections and the four fact items, in the creating transaction, from every creation path.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let handle: DbHandle;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  handle = createDb(inject("databaseUrl"), { max: 2 });
  team = await seedTeam(ctx, db, "guide-creation");
  await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [team.workspaceId]);
});

afterAll(async () => {
  await handle.pool.end();
  await db.close();
  await ctx.app.close();
});

async function guideOf(propertyId: string) {
  const sections = await db.query<{ kind: string; position: number }>(
    `SELECT s.kind, s.position FROM guide_section s JOIN guide g ON g.id = s.guide_id
     WHERE g.property_id = $1 ORDER BY s.position`,
    [propertyId],
  );
  const facts = await db.query<{
    section: string;
    fact_key: string;
    reviewed: boolean;
    source_language: string;
  }>(
    `SELECT s.kind AS section, i.fact_key, i.reviewed_at IS NOT NULL AS reviewed, i.source_language
     FROM guide_item i JOIN guide_section s ON s.id = i.section_id JOIN guide g ON g.id = s.guide_id
     WHERE g.property_id = $1 ORDER BY s.position, i.position`,
    [propertyId],
  );
  const guide = await db.query<{ status: string; draft_state: string }>(
    `SELECT status, draft_state FROM guide WHERE property_id = $1`,
    [propertyId],
  );
  return { sections: sections.rows, facts: facts.rows, guide: guide.rows[0] };
}

const NINE = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
];

describe("guide creation", () => {
  it("creates the guide, its nine sections, and the live facts with a blank property", async () => {
    const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      name: "Casa Guía",
      guideLanguages: ["en", "es"],
    });
    expect(created.statusCode, created.body).toBe(201);
    const property = created.json() as PropertyDetail;
    const guide = await guideOf(property.id);
    expect(guide.guide).toEqual({ status: "draft", draft_state: "pending" });
    expect(guide.sections.map((section) => section.kind)).toEqual(NINE);
    expect(guide.facts).toEqual([
      { section: "arrival", fact_key: "check_in_time", reviewed: true, source_language: "en" },
      { section: "arrival", fact_key: "address", reviewed: true, source_language: "en" },
      { section: "house_rules", fact_key: "max_guests", reviewed: true, source_language: "en" },
      { section: "checkout", fact_key: "checkout_time", reviewed: true, source_language: "en" },
    ]);
  });

  it("queues the AI part of the draft for the new guide", async () => {
    const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      name: "Casa Cola",
    });
    const property = created.json() as PropertyDetail;
    const { rows } = await db.query<{ data: { guideId: string; workspaceId: string } }>(
      `SELECT data FROM pgboss.job WHERE name = 'guide.draft' AND data->>'workspaceId' = $1`,
      [team.workspaceId],
    );
    const [guide] = (
      await db.query<{ id: string }>(`SELECT id FROM guide WHERE property_id = $1`, [property.id])
    ).rows;
    expect(rows.map((row) => row.data.guideId)).toContain(guide!.id);
  });

  it("keeps an existing guide when called again", async () => {
    const propertyId = await insertProperty(db, team.workspaceId, { name: "Casa Repetida" });
    const first = await createGuideForProperty(handle.db, {
      workspaceId: team.workspaceId,
      propertyId,
      guideLanguages: ["es"],
    });
    const second = await createGuideForProperty(handle.db, {
      workspaceId: team.workspaceId,
      propertyId,
      guideLanguages: ["es"],
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ guideId: first.guideId, created: false });
    expect((await guideOf(propertyId)).sections).toHaveLength(9);
  });
});
