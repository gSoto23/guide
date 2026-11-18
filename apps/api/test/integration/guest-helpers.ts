import { expect } from "vitest";
import type {
  GuideView,
  LockedFieldView,
  PropertyDetail,
  PublishCheck,
  ShareOverview,
} from "@guidesk/contracts";
import { READY_FACTS, wsApi, type Member, type TeamWorkspace } from "./property-helpers.js";
import { GUIDE_URL, type createTestApp } from "./test-app.js";

/**
 * Test helpers for feature 004: a published guide with a lockbox code, a Wi-Fi password, a text
 * that references the code, an English-only item, and a recommendation with a declared benefit;
 * and guest requests from the guide origin. Every value is fictional.
 */
type Ctx = Awaited<ReturnType<typeof createTestApp>>;

export const LOCKBOX = "846251";
export const WIFI_PASSWORD = "PalmeraAzul77";

export interface PublishedGuide {
  propertyId: string;
  lockboxId: string;
  wifiId: string;
  publicId: string;
  propertyLink: string;
}

const paragraph = (...content: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});

export function guideApi(
  ctx: Ctx,
  member: Member,
  team: TeamWorkspace,
  propertyId: string,
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT",
  suffix: string,
  payload?: object,
) {
  return wsApi(
    ctx,
    member,
    method,
    team.workspaceId,
    `/properties/${propertyId}${suffix}`,
    payload,
  );
}

async function section(ctx: Ctx, team: TeamWorkspace, propertyId: string, kind: string) {
  const view = (
    await guideApi(ctx, team.owner, team, propertyId, "GET", "/guide")
  ).json() as GuideView;
  return view.sections.find((candidate) => candidate.kind === kind)!;
}

async function addItem(
  ctx: Ctx,
  team: TeamWorkspace,
  propertyId: string,
  kind: string,
  body: object,
): Promise<void> {
  const target = await section(ctx, team, propertyId, kind);
  const added = await guideApi(
    ctx,
    team.owner,
    team,
    propertyId,
    "POST",
    `/guide/sections/${target.id}/items`,
    { revision: target.revision, ...body },
  );
  expect(added.statusCode, added.body).toBe(201);
}

export async function publish(ctx: Ctx, team: TeamWorkspace, propertyId: string): Promise<void> {
  const check = (
    await guideApi(ctx, team.owner, team, propertyId, "GET", "/guide/publish-check")
  ).json() as PublishCheck;
  const published = await guideApi(ctx, team.owner, team, propertyId, "POST", "/guide/publish", {
    expectedRevisionHash: check.revisionHash,
  });
  expect(published.statusCode, published.body).toBe(201);
}

/** Creates and publishes a guide; `publicWifi` makes the Wi-Fi password public (spec 003). */
export async function publishedGuide(
  ctx: Ctx,
  team: TeamWorkspace,
  options: { name?: string; publicWifi?: boolean } = {},
): Promise<PublishedGuide> {
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: options.name ?? "Casa Colibrí",
  });
  expect(created.statusCode, created.body).toBe(201);
  const propertyId = (created.json() as PropertyDetail).id;
  const field = async (kind: string, label: string, value: string) => {
    const response = await guideApi(
      ctx,
      team.owner,
      team,
      propertyId,
      "POST",
      "/guide/locked-fields",
      {
        kind,
        label,
        value,
      },
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as LockedFieldView).id;
  };
  const lockboxId = await field("lockbox_code", "Caja de llaves", LOCKBOX);
  const wifiId = await field("wifi_password", "Contraseña del wifi", WIFI_PASSWORD);
  if (options.publicWifi) {
    const visible = await guideApi(
      ctx,
      team.owner,
      team,
      propertyId,
      "PUT",
      `/guide/locked-fields/${wifiId}/visibility`,
      { public: true },
    );
    expect(visible.statusCode, visible.body).toBe(200);
  }
  await addItem(ctx, team, propertyId, "arrival", {
    kind: "text",
    language: "es",
    doc: paragraph(
      { type: "text", text: "Abre la caja de llaves con " },
      { type: "lockedField", attrs: { fieldId: lockboxId } },
      { type: "text", text: "." },
    ),
  });
  await addItem(ctx, team, propertyId, "wifi", {
    kind: "text",
    language: "es",
    doc: paragraph(
      { type: "text", text: "Red: CasaColibri. Clave: " },
      { type: "lockedField", attrs: { fieldId: wifiId } },
    ),
  });
  await addItem(ctx, team, propertyId, "house_rules", {
    kind: "text",
    language: "en",
    doc: paragraph({ type: "text", text: "Quiet hours start at 10 pm." }),
  });
  await addItem(ctx, team, propertyId, "local_recommendations", {
    kind: "recommendation",
    language: "es",
    recommendation: {
      name: "Soda La Palma",
      category: "restaurant",
      url: "https://example.com/soda",
      benefit: "commission",
    },
  });
  await publish(ctx, team, propertyId);
  const share = (
    await guideApi(ctx, team.owner, team, propertyId, "GET", "/share")
  ).json() as ShareOverview;
  const propertyLink = share.propertyLink?.url ?? "";
  const publicId = propertyLink.split("/g/")[1] ?? "";
  expect(publicId).toMatch(/^[a-z2-7]{26}$/);
  return { propertyId, lockboxId, wifiId, publicId, propertyLink };
}

/** A request from a guest's browser on the guide origin. */
export function guest(
  ctx: Ctx,
  method: "GET" | "POST",
  url: string,
  options: { cookie?: string; payload?: object; headers?: Record<string, string> } = {},
) {
  return ctx.fastify.inject({
    method,
    url,
    headers: {
      origin: GUIDE_URL,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.payload ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    ...(options.payload ? { payload: options.payload } : {}),
  });
}
