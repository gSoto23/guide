import es from "@guidesk/i18n/public/es.json";
import en from "@guidesk/i18n/public/en.json";

/**
 * The public pages' texts (feature 014 research R2). Imported only by the public pages' server
 * components, so portal screens never carry them; the catalog test keeps both languages aligned.
 * They live outside `messages/`, which next-intl precompiles into ICU structures.
 */
export type PublicCatalog = typeof es;

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  items?: string[];
  footer?: string[];
}

const catalogs: Record<"es" | "en", PublicCatalog> = { es, en };

export function publicCatalog(locale: string): PublicCatalog {
  return locale === "en" ? catalogs.en : catalogs.es;
}
