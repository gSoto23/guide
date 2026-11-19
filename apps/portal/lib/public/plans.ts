import { PLAN_LIMITS, PLAN_PLATFORM_FEE_BPS, PLANS, type Plan } from "@guidesk/domain";
import type { PublicCatalog } from "./catalog";
import { fill } from "./text";

/**
 * The plans block on the home page (feature 014 FR-002, research R3): the numbers come from the
 * limits and fees the product enforces, so a plan change updates the page. Server-only.
 */
export interface PlanCard {
  id: Plan;
  name: string;
  audience: string;
  price: string;
  lines: string[];
  fee: string;
}

function count(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

function percent(locale: string, bps: number): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    bps / 10_000,
  );
}

export function planCards(locale: string, catalog: PublicCatalog): PlanCard[] {
  const text = catalog.home.plans;
  return PLANS.map((id) => {
    const limits = PLAN_LIMITS[id];
    const item = text.items.find((entry) => entry.id === id);
    const properties =
      limits.properties === null
        ? text.propertiesUnlimited
        : fill(limits.properties === 1 ? text.propertiesOne : text.propertiesOther, {
            count: count(locale, limits.properties),
          });
    const replies =
      limits.aiReplies.kind === "fixed"
        ? fill(text.repliesFixed, { count: count(locale, limits.aiReplies.perMonth) })
        : fill(text.repliesPooled, { count: count(locale, limits.aiReplies.perProperty) });
    const seats =
      limits.seats === null
        ? text.seatsUnlimited
        : fill(limits.seats === 1 ? text.seatsOne : text.seatsOther, {
            count: count(locale, limits.seats),
          });
    return {
      id,
      name: item?.name ?? id,
      audience: item?.audience ?? "",
      price: id === "free" ? text.free : text.tba,
      lines: [properties, replies, seats],
      fee: fill(text.fee, { percent: percent(locale, PLAN_PLATFORM_FEE_BPS[id]) }),
    };
  });
}
