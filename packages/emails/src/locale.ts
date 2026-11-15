export const EMAIL_LOCALES = ["es", "en"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** Falls back to Spanish when the user's language is unknown (packages/i18n default). */
export function toEmailLocale(value: string | null | undefined): EmailLocale {
  return value === "en" ? "en" : "es";
}

/** Picks Spanish or English from an Accept-Language header (q-values respected). */
export function localeFromAcceptLanguage(header: string | null | undefined): EmailLocale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { lang: tag.toLowerCase().slice(0, 2), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.lang === "es" || entry.lang === "en")
    .sort((a, b) => b.q - a.q);
  return (ranked[0]?.lang as EmailLocale | undefined) ?? null;
}
