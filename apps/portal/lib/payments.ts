/** Feature 013 client helpers, kept out of `@guidesk/contracts/values` (150 KB budget). */

/** An amount in minor units in the member's locale, for example "85,00 US$". */
export function formatMoney(locale: string, amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/** Minor units from what the member typed ("20", "20.5", "20,50"); null when it isn't an amount. */
export function parseAmount(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized) * 100);
  return minor > 0 ? minor : null;
}
