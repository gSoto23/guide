import { z } from "zod";

const publicIdSchema = z.string().regex(/^[a-z2-7]{26}$/);

/**
 * Feature 013 (contracts/http-api.md): guest checkout, the guest's and members' payment states,
 * payouts, and refunds. Amounts are integer minor units.
 */
export type PaymentsMode = "off" | "simulated" | "tilopay";
export type GuestPaymentState =
  "payable" | "open" | "paid" | "partially_refunded" | "refunded" | "disputed";

/** On each guest request; null when online payment isn't possible for it. */
export interface GuestPayment {
  state: GuestPaymentState;
  amountMinor: number;
  currency: string;
  refundedMinor: number;
  /** The order's reference after payment, for the guest's records. */
  reference: string | null;
}

export const guestCheckoutSchema = z.object({ publicId: publicIdSchema }).strict();
export type GuestCheckoutBody = z.infer<typeof guestCheckoutSchema>;

export interface GuestCheckout {
  orderId: string;
  checkoutUrl: string;
  expiresAt: string;
}

export type PaymentOrderStatus =
  | "open"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "disputed"
  | "failed"
  | "expired"
  | "cancelled";

/** On each request in the Requests screen. */
export interface RequestPayment {
  orderId: string;
  state: PaymentOrderStatus;
  amountMinor: number;
  currency: string;
  refundedMinor: number;
  platformFeeMinor: number;
  providerFeeMinor: number | null;
  hostShareMinor: number | null;
  /** Paid after the request stopped being payable: the host should refund it. */
  refundDue: boolean;
}

export interface PayoutTotals {
  currency: string;
  orders: number;
  paidMinor: number;
  refundedMinor: number;
  platformFeeMinor: number;
  providerFeeMinor: number;
  hostShareMinor: number;
}

export interface Payouts {
  mode: PaymentsMode;
  account: { provider: string; status: "pending" | "active" | "rejected" } | null;
  /** The platform fee new orders get, in percent (for example 10 or 7.5). */
  feePercent: number;
  feeSource: "plan" | "custom";
  /** Whether the caller may start or change onboarding (the owner). */
  canManage: boolean;
  /** This UTC month's paid orders, by currency. */
  month: PayoutTotals[];
}

export interface PayoutOnboarding {
  onboardingUrl: string;
}

export const refundSchema = z.object({ amountMinor: z.int().positive().max(100_000_000) }).strict();
export type RefundBody = z.infer<typeof refundSchema>;

export interface PaymentRefundResult {
  refund: { id: string; amountMinor: number; status: "succeeded" | "pending" | "failed" };
  order: RequestPayment;
}
