import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  addressCheckSchema,
  propertyDetailSchema,
  propertyLimitsSchema,
  propertyListSchema,
  startOptionsSchema,
  timeZoneListSchema,
  timeZoneSuggestionSchema,
} from "@guidesk/contracts";
import { systemQuery } from "../integration/helpers.js";
import {
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "../integration/property-helpers.js";
import { createTestApp } from "../integration/test-app.js";

/** Property and time zone responses match the shared Zod contracts (T035). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "contract-props");
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("property endpoints contract (T035)", () => {
  it("returns contract-shaped bodies for create, get, patch, list, limits, and start options", async () => {
    const created = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      "/properties",
      READY_FACTS,
    );
    expect(created.statusCode, created.body).toBe(201);
    const property = propertyDetailSchema.strict().parse(created.json());

    const fetched = await wsApi(
      ctx,
      team.agent,
      "GET",
      team.workspaceId,
      `/properties/${property.id}`,
    );
    expect(fetched.statusCode).toBe(200);
    propertyDetailSchema.strict().parse(fetched.json());

    const patched = await wsApi(
      ctx,
      team.admin,
      "PATCH",
      team.workspaceId,
      `/properties/${property.id}`,
      {
        checkoutTime: "10:30",
      },
    );
    expect(patched.statusCode, patched.body).toBe(200);
    propertyDetailSchema.strict().parse(patched.json());

    const list = await wsApi(ctx, team.agent, "GET", team.workspaceId, "/properties?query=Colibr");
    expect(list.statusCode).toBe(200);
    propertyListSchema.parse(list.json());

    const limits = await wsApi(ctx, team.agent, "GET", team.workspaceId, "/properties/limits");
    expect(limits.statusCode).toBe(200);
    propertyLimitsSchema.strict().parse(limits.json());

    const options = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      "/properties/start-options",
    );
    expect(options.statusCode).toBe(200);
    startOptionsSchema.strict().parse(options.json());

    const check = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/properties/address-check?line1=${encodeURIComponent(READY_FACTS.addressLine1)}&city=Samara&country=CR`,
    );
    expect(check.statusCode).toBe(200);
    expect(addressCheckSchema.parse(check.json()).matches.map((m) => m.propertyId)).toContain(
      property.id,
    );
  });

  it("returns contract-shaped time zone lists and suggestions", async () => {
    const zones = await wsApi(ctx, team.owner, "GET", team.workspaceId, "/time-zones?country=MX");
    expect(zones.statusCode).toBe(200);
    expect(timeZoneListSchema.parse(zones.json()).zones.length).toBeGreaterThan(1);

    const suggested = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/time-zones/suggest?country=MX&city=${encodeURIComponent("Cancún")}`,
    );
    expect(suggested.statusCode).toBe(200);
    expect(timeZoneSuggestionSchema.parse(suggested.json()).suggested).toBe("America/Cancun");
  });
});
