import { createTranslator } from "use-intl/core";
import en from "@guidesk/i18n/messages/guest.en.json" with { type: "json" };
import es from "@guidesk/i18n/messages/guest.es.json" with { type: "json" };

/** Guest texts (feature 004 research R10): their own catalogs, so portal pages never carry them. */
export type GuestLocale = "es" | "en";
export const GUEST_LOCALES: readonly GuestLocale[] = ["es", "en"];

const catalogs = { es, en } as const;

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function translator(locale: GuestLocale): Translate {
  const t = createTranslator({ locale, messages: catalogs[locale] });
  return (key, values) => (t as unknown as (k: string, v?: object) => string)(key, values);
}

export function isGuestLocale(value: string | undefined): value is GuestLocale {
  return value === "es" || value === "en";
}

/** The first supported language in an Accept-Language header, or null. */
export function preferredLocale(header: string | null | undefined): GuestLocale | null {
  const ranked = (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1, index };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const entry of ranked) {
    const base = entry.tag.split("-")[0];
    if (isGuestLocale(base)) return base;
  }
  return null;
}
