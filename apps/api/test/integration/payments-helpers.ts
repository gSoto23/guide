import { expect } from "vitest";
import type { ExtraInput, GuestServiceRequest, MemberExtra, Payouts } from "@guidesk/contracts";
import type { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  exchange,
  guest,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import type { createTestApp } from "./test-app.js";

/**
 * Fixtures for feature 013: a workspace with a published guide, a stay and its guest session, and a
 * pre-approved 85 USD extra; payouts through the simulated provider's pages. Synthetic data only.
 */
type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Db = ReturnType<typeof systemQuery>;

export const pickup: ExtraInput = {
  sourceLanguage: "es",
  name: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
  description: {},
  price: 85,
  currency: "USD",
  leadTimeHours: 0,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  needsDate: false,
  needsTime: false,
  dateRange: "stay",
  maxPerStay: 10,
  preApproved: true,
  turnover: null,
  visible: true,
};

export interface PaymentsFixture {
  team: TeamWorkspace;
  published: PublishedGuide;
  cookie: string;
  stayId: string;
}

export async function paymentsFixture(ctx: Ctx, db: Db, prefix: string): Promise<PaymentsFixture> {
  const team = await seedTeam(ctx, db, prefix);
  const published = await publishedGuide(ctx, team);
  const stayId = await addStay(ctx, team, published.propertyId, 5, 4);
  const link = await copyStayLink(ctx, team, published.propertyId, stayId);
  const cookie = (await exchange(ctx, link.token)).cookie!;
  return { team, published, cookie, stayId };
}

export async function addExtra(
  ctx: Ctx,
  fixture: PaymentsFixture,
  input: Partial<ExtraInput> = {},
): Promise<string> {
  const response = await wsApi(
    ctx,
    fixture.team.owner,
    "POST",
    fixture.team.workspaceId,
    `/properties/${fixture.published.propertyId}/extras`,
    { ...pickup, ...input },
  );
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as MemberExtra).id;
}

/** The guest requests an extra; a pre-approved one is confirmed at once. */
export async function requestExtra(
  ctx: Ctx,
  fixture: PaymentsFixture,
  extraId: string,
): Promise<GuestServiceRequest> {
  const response = await guest(ctx, "POST", "/api/v1/guest/extras/requests?lang=es", {
    payload: { publicId: fixture.published.publicId, extraId, quantity: 1 },
    cookie: fixture.cookie,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as GuestServiceRequest;
}

/** Follows a simulated provider URL (a page on the portal's origin) with an action. */
export function simulated(ctx: Ctx, url: string, action?: string) {
  const parsed = new URL(url);
  return ctx.fastify.inject({
    method: "GET",
    url: `${parsed.pathname}${parsed.search}${action ? `&action=${action}` : ""}`,
  });
}

/** The owner sets up payouts and approves them on the simulated page. */
export async function activatePayouts(ctx: Ctx, fixture: PaymentsFixture): Promise<void> {
  const started = await wsApi(
    ctx,
    fixture.team.owner,
    "POST",
    fixture.team.workspaceId,
    "/payouts/onboarding?lang=es",
  );
  expect(started.statusCode, started.body).toBe(200);
  const approved = await simulated(
    ctx,
    (started.json() as { onboardingUrl: string }).onboardingUrl,
    "approve",
  );
  expect(approved.statusCode).toBe(303);
  const payouts = await wsApi(ctx, fixture.team.owner, "GET", fixture.team.workspaceId, "/payouts");
  expect((payouts.json() as Payouts).account?.status).toBe("active");
}

export function checkout(
  ctx: Ctx,
  fixture: PaymentsFixture,
  requestId: string,
  cookie = fixture.cookie,
) {
  return guest(ctx, "POST", `/api/v1/guest/extras/requests/${requestId}/checkout?lang=es`, {
    payload: { publicId: fixture.published.publicId },
    cookie,
  });
}

export async function guestRequests(ctx: Ctx, fixture: PaymentsFixture) {
  const response = await guest(
    ctx,
    "GET",
    `/api/v1/guest/extras/requests?publicId=${fixture.published.publicId}&lang=es`,
    { cookie: fixture.cookie },
  );
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { requests: GuestServiceRequest[] }).requests;
}
