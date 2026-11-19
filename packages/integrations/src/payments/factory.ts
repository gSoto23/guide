import { createHmac } from "node:crypto";
import type { PaymentPort } from "./port.js";
import { SimulatedPaymentAdapter } from "./simulated.adapter.js";

export type PaymentsMode = "off" | "simulated" | "tilopay";

/**
 * The payment adapter for a mode (feature 013 research R1). `off` has none; `tilopay` waits for the
 * legal entity and the sandbox (OQ-01, OQ-37). The simulated key is derived from a deployment secret.
 */
export function createPaymentAdapter(
  mode: PaymentsMode,
  options: { secret: string; pagesUrl: string },
): PaymentPort | null {
  if (mode === "off") return null;
  if (mode === "tilopay") throw new Error("The Tilopay adapter is not built yet (OQ-37)");
  const key = createHmac("sha256", options.secret).update("guidesk/simulated-payments").digest();
  return new SimulatedPaymentAdapter(key, options.pagesUrl.replace(/\/$/, ""));
}
