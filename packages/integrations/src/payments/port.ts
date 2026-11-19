/**
 * The payment provider (feature 013 research R1; ADR-0007). Checkout and onboarding happen on the
 * provider's hosted pages; Guidesk never sees card data. Amounts are integer minor units.
 */
export type PaymentProvider = "simulated" | "tilopay";

export interface CheckoutInput {
  /** Guidesk's order ID, sent back in the provider's events. */
  orderId: string;
  amountMinor: number;
  currency: string;
  /** Plain text for the provider's page, for example the add-on's name. */
  description: string;
  /** The host's provider account that receives the split (FR-013). */
  merchantAccountId: string;
  platformFeeMinor: number;
  returnUrl: string;
  expiresAt: Date;
}

export interface Checkout {
  providerReference: string;
  checkoutUrl: string;
}

export interface OnboardingInput {
  workspaceId: string;
  returnUrl: string;
}

export interface RefundInput {
  orderId: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: "succeeded" | "pending";
}

/** A verified event from the provider. */
export type PaymentEvent =
  | {
      type: "payment.succeeded";
      eventId: string;
      orderId: string;
      providerReference: string;
      amountMinor: number;
      currency: string;
      providerFeeMinor: number;
    }
  | { type: "payment.failed"; eventId: string; orderId: string; providerReference: string }
  | { type: "payment.disputed"; eventId: string; orderId: string; providerReference: string }
  | {
      type: "refund.succeeded";
      eventId: string;
      orderId: string;
      providerRefundId: string;
      amountMinor: number;
    }
  | {
      type: "merchant.activated" | "merchant.rejected";
      eventId: string;
      workspaceId: string;
      providerAccountId: string;
    };

export interface PaymentPort {
  readonly provider: PaymentProvider;
  createCheckout(input: CheckoutInput): Promise<Checkout>;
  createOnboarding(input: OnboardingInput): Promise<{ onboardingUrl: string }>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** Verifies an event's signature and shape; null when it can't be trusted (AC-SEC-001). */
  verifyEvent(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): PaymentEvent | null;
}
