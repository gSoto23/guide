import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  Checkout,
  CheckoutInput,
  OnboardingInput,
  PaymentEvent,
  PaymentPort,
  RefundInput,
  RefundResult,
} from "./port.js";

/**
 * A stateless stand-in for the provider (feature 013 research R1), for development and tests only:
 * hosted pages are reached through signed tokens, and the pages emit signed events that go through
 * the same verification as a real provider's. Never used in production (AC-SEC-007).
 */
export const SIGNATURE_HEADER = "x-guidesk-signature";

export interface CheckoutToken {
  kind: "checkout";
  orderId: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  expiresAt: string;
}

export interface OnboardingToken {
  kind: "onboarding";
  workspaceId: string;
  providerAccountId: string;
  returnUrl: string;
}

/** An illustrative card fee until the real one is known (OQ-37): 3.5% plus 0.30 USD or 150 CRC. */
export function simulatedFee(amountMinor: number, currency: string): number {
  const fixed = currency === "CRC" ? 15_000 : 30;
  return Math.round(amountMinor * 0.035) + fixed;
}

export class SimulatedPaymentAdapter implements PaymentPort {
  readonly provider = "simulated" as const;

  /**
   * @param key signing key (derived from a deployment secret, never a literal)
   * @param pagesUrl the public origin that serves `/api/v1/simulated-provider/*`
   */
  constructor(
    private readonly key: Buffer,
    private readonly pagesUrl: string,
  ) {}

  private sign(text: string): string {
    return createHmac("sha256", this.key).update(text).digest("base64url");
  }

  private matches(text: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(text));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** `<payload>.<signature>`, both base64url. */
  token(payload: CheckoutToken | OnboardingToken): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  readToken(token: string): CheckoutToken | OnboardingToken | null {
    const [body, signature] = token.split(".");
    if (!body || !signature || !this.matches(body, signature)) return null;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as
        CheckoutToken | OnboardingToken;
    } catch {
      return null;
    }
  }

  async createCheckout(input: CheckoutInput): Promise<Checkout> {
    const providerReference = `sim_${randomUUID()}`;
    const token = this.token({
      kind: "checkout",
      orderId: input.orderId,
      providerReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description,
      returnUrl: input.returnUrl,
      expiresAt: input.expiresAt.toISOString(),
    });
    return {
      providerReference,
      checkoutUrl: `${this.pagesUrl}/api/v1/simulated-provider/checkout?token=${token}`,
    };
  }

  async createOnboarding(input: OnboardingInput): Promise<{ onboardingUrl: string }> {
    const token = this.token({
      kind: "onboarding",
      workspaceId: input.workspaceId,
      providerAccountId: `sim_merchant_${randomUUID()}`,
      returnUrl: input.returnUrl,
    });
    return {
      onboardingUrl: `${this.pagesUrl}/api/v1/simulated-provider/onboarding?token=${token}`,
    };
  }

  /** Refunds succeed at once in the simulation. */
  async refund(_input: RefundInput): Promise<RefundResult> {
    return { providerRefundId: `sim_refund_${randomUUID()}`, status: "succeeded" };
  }

  /** The body and header a simulated page sends for an event. */
  signEvent(event: PaymentEvent): { body: PaymentEvent; headers: Record<string, string> } {
    return { body: event, headers: { [SIGNATURE_HEADER]: this.sign(JSON.stringify(event)) } };
  }

  verifyEvent(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): PaymentEvent | null {
    const signature = headers[SIGNATURE_HEADER];
    if (typeof signature !== "string" || !payload || typeof payload !== "object") return null;
    if (!this.matches(JSON.stringify(payload), signature)) return null;
    const event = payload as PaymentEvent;
    return typeof event.type === "string" && typeof event.eventId === "string" ? event : null;
  }
}
