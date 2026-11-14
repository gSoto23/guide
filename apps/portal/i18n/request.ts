import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import es from "@guidesk/i18n/messages/es.json";
import en from "@guidesk/i18n/messages/en.json";
import { routing } from "./routing";

const catalogs = { es, en } as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: catalogs[locale] };
});
