import { expect, type Page } from "@playwright/test";
import type { PublishedGuide } from "./guest";

/** Feature 008 fixtures: extras through the member API and a stay link for the guest. Fictional data. */
export interface ExtraFixture {
  name: { es?: string; en?: string };
  price: number;
  leadTimeHours?: number;
  needsDate?: boolean;
  needsTime?: boolean;
  preApproved?: boolean;
  turnover?: "early_check_in" | "late_checkout" | null;
}

export async function addExtra(
  page: Page,
  guide: PublishedGuide,
  extra: ExtraFixture,
): Promise<{ id: string }> {
  const response = await page.request.post(`${guide.base}/extras`, {
    data: {
      sourceLanguage: "es",
      name: extra.name,
      description: {},
      price: extra.price,
      currency: "USD",
      leadTimeHours: extra.leadTimeHours ?? 0,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      needsDate: extra.needsDate ?? false,
      needsTime: extra.needsTime ?? false,
      dateRange: "stay",
      maxPerStay: 2,
      preApproved: extra.preApproved ?? false,
      turnover: extra.turnover ?? null,
      visible: true,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

export async function stayLinkFor(
  page: Page,
  guide: PublishedGuide,
  stayId: string,
): Promise<string> {
  const copied = await page.request.post(`${guide.base}/share/stays/${stayId}/link`, { data: {} });
  return ((await copied.json()) as { url: string }).url;
}

/** A date `offset` days from today in Costa Rica (UTC−6), as YYYY-MM-DD. */
export function costaRicaDay(offset: number): string {
  const date = new Date(Date.now() - 6 * 3_600_000);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
