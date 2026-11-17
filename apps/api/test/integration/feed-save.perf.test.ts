import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startIcalServer, type IcalServer } from "@guidesk/testing/ical-server";
import { systemQuery } from "./helpers.js";
import { insertProperty, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Saving a calendar link, which reads it through the feed reader first: p95 ≤ 12 s from request
 * to response, with the 10-second read limit (002 plan, Performance Budget; T124). A feed that
 * answers after 12 seconds is cut at the limit. All data is fictional.
 */
const SAVES = 20;
const BUDGET_MS = 12_000;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let ical: IcalServer;
/** A private folder with a unique name for this run's test certificates (CodeQL js/insecure-temporary-file). */
const certificateDir = mkdtempSync(join(tmpdir(), "guidesk-ical-certs-"));
let team: TeamWorkspace;

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ical = await startIcalServer(certificateDir);
  ctx = await createTestApp(inject("databaseUrl"), {
    SANDBOX_TEST_ALLOW_HOST: ical.host,
    SANDBOX_TEST_CA_FILE: ical.caFile,
  });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "feed-perf");
  await db.query(`UPDATE workspace SET property_limit = 50 WHERE id = $1`, [team.workspaceId]);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
  await ical.close();
  rmSync(certificateDir, { recursive: true, force: true });
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function save(url: string) {
  const propertyId = await insertProperty(db, team.workspaceId);
  const started = performance.now();
  const response = await wsApi(
    ctx,
    team.owner,
    "POST",
    team.workspaceId,
    `/properties/${propertyId}/calendar-feeds`,
    { url, channel: "airbnb" },
  );
  return { response, ms: performance.now() - started };
}

describe("saving a calendar link (Performance Budget)", () => {
  it(`keeps p95 within 12 s over ${SAVES} saves`, async () => {
    const timings: number[] = [];
    for (let index = 0; index < SAVES; index += 1) {
      const name = `perf-${index}`;
      ical.setFeed(
        name,
        Array.from({ length: 40 }, (_, n) => ({
          uid: `${name}-${n}@fixture.test`,
          start: day(n * 3),
          end: day(n * 3 + 2),
          summary: "Reserved",
        })),
      );
      const { response, ms } = await save(ical.url(name));
      expect(response.statusCode, response.body).toBe(201);
      timings.push(ms);
    }
    expect(percentile(timings, 95)).toBeLessThanOrEqual(BUDGET_MS);
  });

  it("cuts a feed that answers after 12 seconds at the read limit, within the budget", async () => {
    const { response, ms } = await save(`${ical.origin}/slow.ics`);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "feed_rejected", reason: "timeout" });
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  }, 30_000);
});
