import { createPaymentAdapter, type PaymentPort, type PaymentsMode } from "@guidesk/integrations";
import type { ApiConfig } from "../config/config.js";

export const PAYMENT_ADAPTER = Symbol("PAYMENT_ADAPTER");
export const PAYMENTS_MODE = Symbol("PAYMENTS_MODE");

/** `simulated` locally and `off` in production when unset (feature 013 research R1). */
export function paymentsMode(config: Pick<ApiConfig, "NODE_ENV" | "PAYMENTS_MODE">): PaymentsMode {
  return config.PAYMENTS_MODE ?? (config.NODE_ENV === "production" ? "off" : "simulated");
}

/**
 * The provider adapter, or null when payments are off. The simulated provider's pages live on the
 * portal's origin (the portal forwards /api/*), and its key derives from the auth secret.
 */
export function paymentAdapterFor(
  config: Pick<ApiConfig, "NODE_ENV" | "PAYMENTS_MODE" | "BETTER_AUTH_SECRET" | "PORTAL_URL">,
): PaymentPort | null {
  return createPaymentAdapter(paymentsMode(config), {
    secret: config.BETTER_AUTH_SECRET,
    pagesUrl: config.PORTAL_URL,
  });
}
