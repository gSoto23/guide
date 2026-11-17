import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  CreatedExtraction,
  Extraction,
  ListingContentList,
  PropertyDetail,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  captureLogs,
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * US2 on the API side (T051): redaction before storage, URL-only input, the daily limit, submit,
 * retry, and creating the property from accepted items. The worker side (recognition, the model
 * call, timeouts) is covered in apps/worker/test/integration/extraction-job.test.ts.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

const LISTING = [
  "Casa Colibrí frente al mar",
  "Casa de dos habitaciones a pasos de la playa.",
  "Door code 4821",
  "Wi-Fi password: Colibri2026",
].join("\n");

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "extract");
  await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [team.workspaceId]);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

async function create(body: object, member = team.owner, workspaceId = team.workspaceId) {
  return wsApi(ctx, member, "POST", workspaceId, "/extractions", body);
}

describe("redaction before anything is stored (FR-012, AC-SEC-003)", () => {
  it("reports what was removed and never stores or logs the values", async () => {
    const logs = captureLogs();
    const response = await create({ text: LISTING });
    logs.stop();
    expect(response.statusCode, response.body).toBe(201);
    const created = response.json() as CreatedExtraction;
    expect(created).toMatchObject({ status: "awaiting_uploads", urlOnly: false, uploads: [] });
    expect(created.redactions).toEqual({ door_code: 1, wifi_password: 1 });
    const { rows } = await db.query<{ input_text: string }>(
      `SELECT input_text FROM extraction_request WHERE id = $1`,
      [created.extractionId],
    );
    expect(rows[0]!.input_text).toContain("[door code removed]");
    expect(rows[0]!.input_text).not.toMatch(/4821|Colibri2026/);
    expect(response.body).not.toMatch(/4821|Colibri2026/);
    logs.expectNoSecrets(["4821", "Colibri2026"]);
  });
});

describe("a URL alone (FR-011, PC-12)", () => {
  it("asks for text or screenshots, without any request, AI call, or use of the limit", async () => {
    const fresh = await seedTeam(ctx, db, "extract-url");
    const response = await create(
      { text: "  https://www.airbnb.com/rooms/123 " },
      fresh.owner,
      fresh.workspaceId,
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ urlOnly: true, status: "failed", uploads: [] });
    const limits = (
      await wsApi(ctx, fresh.owner, "GET", fresh.workspaceId, "/properties/limits")
    ).json();
    expect(limits).toMatchObject({ extractionsUsedToday: 0 });
    const { rows } = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'extraction.run' AND data->>'workspaceId' = $1`,
      [fresh.workspaceId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("screenshots and the daily limit (FR-009, FR-017, AC-SEC-010)", () => {
  it("refuses screenshots while EXTRACTION_SCREENSHOTS is off", async () => {
    const response = await create({ screenshots: [{ contentType: "image/png", size: 2048 }] });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ fields: { screenshots: ["Not available"] } });
  });

  it("refuses the 11th extraction of the day with the limit and the reset time", async () => {
    const small = await seedTeam(ctx, db, "extract-limit");
    await db.query(`UPDATE workspace SET property_limit = 2 WHERE id = $1`, [small.workspaceId]);
    for (let i = 0; i < 10; i += 1) {
      const ok = await create(
        { text: `Casa número ${i}\nUna casa tranquila.` },
        small.owner,
        small.workspaceId,
      );
      expect(ok.statusCode).toBe(201);
    }
    const refused = await create({ text: "Casa once\nOtra casa." }, small.owner, small.workspaceId);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({
      code: "extraction_limit_reached",
      limit: 10,
      resetsAt: expect.any(String),
    });
    expect(refused.headers["retry-after"]).toBeDefined();
  });
});

describe("submit and retry (FR-016)", () => {
  it("queues the job once", async () => {
    const created = (
      await create({ text: "Casa del árbol\nCabaña en el bosque." })
    ).json() as CreatedExtraction;
    const path = `/extractions/${created.extractionId}`;
    expect(
      (await wsApi(ctx, team.owner, "POST", team.workspaceId, `${path}/submit`)).statusCode,
    ).toBe(202);
    expect(
      ((await wsApi(ctx, team.owner, "GET", team.workspaceId, path)).json() as Extraction).status,
    ).toBe("queued");
    expect(
      (await wsApi(ctx, team.owner, "POST", team.workspaceId, `${path}/submit`)).statusCode,
    ).toBe(409);
  });

  it("retries a timed-out request from its stored text, and refuses any other state", async () => {
    const created = (await create({ text: LISTING })).json() as CreatedExtraction;
    await db.query(
      `UPDATE extraction_request SET status = 'failed', error_code = 'timeout' WHERE id = $1`,
      [created.extractionId],
    );
    const retried = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      `/extractions/${created.extractionId}/retry`,
    );
    expect(retried.statusCode, retried.body).toBe(202);
    const { extractionId } = retried.json() as { extractionId: string };
    const { rows } = await db.query<{ retry_of_id: string; input_text: string; status: string }>(
      `SELECT retry_of_id, input_text, status FROM extraction_request WHERE id = $1`,
      [extractionId],
    );
    expect(rows[0]).toMatchObject({ retry_of_id: created.extractionId, status: "queued" });
    expect(rows[0]!.input_text).toContain("[door code removed]");

    const again = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      `/extractions/${extractionId}/retry`,
    );
    expect(again.statusCode).toBe(409);
  });
});

describe("creating the property from the extraction (T060, FR-018)", () => {
  it("stores the accepted items as listing content, edited ones as edited, and deletes the input text", async () => {
    const created = (await create({ text: LISTING })).json() as CreatedExtraction;
    await db.query(`UPDATE extraction_request SET status = 'succeeded' WHERE id = $1`, [
      created.extractionId,
    ]);
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      source: "listing_text",
      extractionRequestId: created.extractionId,
      contentItems: [
        { kind: "title", body: "Casa Colibrí frente al mar", language: "es" },
        { kind: "amenities", items: ["Wi-Fi", "Cocina"], language: "es" },
        { kind: "house_rules", body: "No fumar.", language: "es", edited: true },
      ],
    });
    expect(response.statusCode, response.body).toBe(201);
    const property = response.json() as PropertyDetail;
    expect(property).toMatchObject({ source: "listing_text", setupStatus: "ready" });
    const content = (
      await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/properties/${property.id}/listing-content`,
      )
    ).json() as ListingContentList;
    expect(content.items.map((item) => [item.kind, item.source, item.reviewState])).toEqual([
      ["title", "listing_text", "unreviewed"],
      ["house_rules", "listing_text", "edited"],
      ["amenities", "listing_text", "unreviewed"],
    ]);
    const { rows } = await db.query<{
      property_id: string;
      input_text: string | null;
      input_deleted_at: Date | null;
    }>(`SELECT property_id, input_text, input_deleted_at FROM extraction_request WHERE id = $1`, [
      created.extractionId,
    ]);
    expect(rows[0]).toMatchObject({ property_id: property.id, input_text: null });
    expect(rows[0]!.input_deleted_at).not.toBeNull();
  });

  it("refuses an accepted item that looks like a code, and an extraction that is not finished", async () => {
    const created = (
      await create({ text: "Casa Luna\nCasa con jardín." })
    ).json() as CreatedExtraction;
    const body = {
      ...READY_FACTS,
      source: "listing_text",
      extractionRequestId: created.extractionId,
    };
    const unfinished = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", body);
    expect(unfinished.statusCode).toBe(409);
    await db.query(`UPDATE extraction_request SET status = 'succeeded' WHERE id = $1`, [
      created.extractionId,
    ]);
    const withCode = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...body,
      contentItems: [{ kind: "description", body: "Gate code 1234 at the entrance." }],
    });
    expect(withCode.statusCode).toBe(422);
    expect(withCode.json()).toMatchObject({ fields: { "contentItems.0": ["restricted_value"] } });
  });
});

describe("roles and isolation (AC-SEC-001, AC-SEC-009)", () => {
  it("refuses agents, and answers 404 for another workspace's extraction", async () => {
    expect((await create({ text: "Casa\nTexto." }, team.agent)).statusCode).toBe(403);
    const other = await seedTeam(ctx, db, "extract-other");
    const foreign = (
      await create({ text: "Casa ajena\nTexto." }, other.owner, other.workspaceId)
    ).json() as CreatedExtraction;
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/extractions/${foreign.extractionId}`,
    );
    expect(response.statusCode).toBe(404);
  });
});
