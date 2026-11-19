import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, paymentOrder, serviceRequest, stay, type DbHandle } from "@guidesk/db";
import type { EmailMessage } from "@guidesk/integrations";
import { runPaymentNotify } from "../../src/jobs/payment-notify.js";
import { seed, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * Payment emails (feature 013 T012): a paid add-on goes to the escalation contacts with the extra's
 * name and the amount; a dispute goes to the owners only. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

async function paidOrder(s: Seeded): Promise<string> {
  const [booked] = await handle.db
    .insert(stay)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      source: "manual",
      checkInDate: "2031-01-10",
      checkoutDate: "2031-01-12",
      channel: "Directo",
    })
    .returning({ id: stay.id });
  const [request] = await handle.db
    .insert(serviceRequest)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      stayId: booked!.id,
      extraName: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
      sourceLanguage: "es",
      price: 85,
      currency: "USD",
      quantity: 1,
      status: "confirmed",
      expiresAt: new Date("2031-01-09T00:00:00Z"),
    })
    .returning({ id: serviceRequest.id });
  const [order] = await handle.db
    .insert(paymentOrder)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      stayId: booked!.id,
      serviceRequestId: request!.id,
      provider: "simulated",
      status: "paid",
      currency: "USD",
      amountMinor: 8500,
      platformFeeBps: 1000,
      platformFeeMinor: 850,
      providerFeeMinor: 328,
      hostShareMinor: 7322,
      expiresAt: new Date("2031-01-09T01:00:00Z"),
      paidAt: new Date(),
    })
    .returning({ id: paymentOrder.id });
  return order!.id;
}

function deps() {
  const emails: EmailMessage[] = [];
  return {
    emails,
    deps: {
      db: handle.db,
      queueEmail: async (message: EmailMessage) => {
        emails.push(message);
      },
      portalUrl: "http://localhost:3000",
    },
  };
}

describe("payment.notify (FR-010, FR-016)", () => {
  it("tells the contacts about a paid add-on, in their language", async () => {
    const s = await seed();
    const orderId = await paidOrder(s);
    const { deps: d, emails } = deps();
    expect(await runPaymentNotify(d, { orderId, kind: "paid" })).toBe(2);
    const toOwner = emails.find((email) => email.to === s.ownerEmail)!;
    expect(toOwner.template).toBe("payment.paid");
    expect(toOwner.subject).toContain("Recogida en el aeropuerto");
    expect(toOwner.text).toContain("85,00 USD");
    const toAgent = emails.find((email) => email.to === s.agentEmail)!;
    expect(toAgent.subject).toContain("Airport pickup");
    expect(toAgent.text).toContain("85.00 USD");
  });

  it("tells only the owners about a dispute", async () => {
    const s = await seed();
    const orderId = await paidOrder(s);
    const { deps: d, emails } = deps();
    await runPaymentNotify(d, { orderId, kind: "disputed" });
    expect(emails.map((email) => [email.to, email.template])).toEqual([
      [s.ownerEmail, "payment.disputed"],
    ]);
    expect(
      await runPaymentNotify(d, { orderId: "00000000-0000-4000-8000-000000000000", kind: "paid" }),
    ).toBe(0);
  });
});
