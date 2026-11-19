import type { Plan } from "../plans/index.js";

/**
 * Money rules for add-on payments (feature 013 research R2, R3). Amounts are integer minor units
 * (cents); the platform fee, the provider fee, and the host's share always add up to the price.
 */

/** Platform fee by plan, in basis points (business model §3): Free 10%, Pro 7%, Business 5%. */
export const PLAN_PLATFORM_FEE_BPS: Record<Plan, number> = { free: 1000, pro: 700, business: 500 };
/** A custom fee may go from 0 to 30%. */
export const MAX_PLATFORM_FEE_BPS = 3000;

export function platformFeeBps(plan: Plan, customBps: number | null | undefined): number {
  return customBps ?? PLAN_PLATFORM_FEE_BPS[plan];
}

/** Currencies the provider accepts for checkout (ADR-0007: US dollars and colones). */
export const PAYABLE_CURRENCIES = ["USD", "CRC"] as const;
export type PayableCurrency = (typeof PAYABLE_CURRENCIES)[number];

export function isPayableCurrency(value: string): value is PayableCurrency {
  return (PAYABLE_CURRENCIES as readonly string[]).includes(value);
}

/** A request's total in minor units: price (two decimals) × quantity. */
export function toMinor(price: number | string, quantity: number): number {
  return Math.round(Number(price) * 100) * quantity;
}

export interface Split {
  platformFeeMinor: number;
  providerFeeMinor: number;
  hostShareMinor: number;
}

/** The platform fee for an amount: rounded to the nearest minor unit. */
export function platformFeeOf(amountMinor: number, feeBps: number): number {
  return Math.round((amountMinor * feeBps) / 10_000);
}

/**
 * The parts of a paid amount (FR-011): the host's share takes the remainder, never below zero,
 * so the three parts add up to the amount.
 */
export function splitAmounts(amountMinor: number, feeBps: number, providerFeeMinor: number): Split {
  const platformFeeMinor = Math.min(amountMinor, platformFeeOf(amountMinor, feeBps));
  const provider = Math.min(amountMinor - platformFeeMinor, Math.max(0, providerFeeMinor));
  return {
    platformFeeMinor,
    providerFeeMinor: provider,
    hostShareMinor: amountMinor - platformFeeMinor - provider,
  };
}

export const ORDER_STATUSES = [
  "open",
  "paid",
  "partially_refunded",
  "refunded",
  "disputed",
  "failed",
  "expired",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Open checkouts expire after 60 minutes (FR-008). */
export const CHECKOUT_TTL_MS = 60 * 60 * 1000;

/** The status an order shows now: an open order past its expiry reads as expired. */
export function currentStatus(status: OrderStatus, expiresAt: Date, now: Date): OrderStatus {
  return status === "open" && expiresAt.getTime() <= now.getTime() ? "expired" : status;
}

/** Orders that hold money the host can refund. */
export function isRefundable(status: OrderStatus): boolean {
  return status === "paid" || status === "partially_refunded";
}

/** What is left to refund. */
export function refundableMinor(order: { amountMinor: number; refundedMinor: number }): number {
  return Math.max(0, order.amountMinor - order.refundedMinor);
}

/** The status after refunds total `refundedMinor`. */
export function statusAfterRefund(amountMinor: number, refundedMinor: number): OrderStatus {
  return refundedMinor >= amountMinor ? "refunded" : "partially_refunded";
}

/** Whether a request's add-on can be paid online (FR-004), before payouts and mode checks. */
export function isPayableRequest(request: {
  status: string;
  price: number | string;
  currency: string;
  turnover: string | null;
}): boolean {
  return (
    request.status === "confirmed" &&
    Number(request.price) > 0 &&
    isPayableCurrency(request.currency) &&
    request.turnover === null
  );
}
