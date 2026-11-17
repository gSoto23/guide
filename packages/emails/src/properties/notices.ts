import type { EmailLocale } from "../locale.js";
import { formatDate, renderNotice, type Rendered } from "../notice.js";

/**
 * Property onboarding emails (feature 002 contracts/emails.md). None of them ever carries a
 * calendar link, a PMS credential, an imported code, or a guest name; links point only to the
 * portal. Counts and reasons come from the import run, never from provider responses.
 */

/** `properties.feed_failing`: a calendar feed has failed for 24 hours (FR-024). */
export function renderFeedFailing(
  locale: EmailLocale,
  details: { propertyName: string; channelName: string; lastSuccessAt: Date | null; link: string },
): Promise<Rendered> {
  const last = details.lastSuccessAt ? formatDate(locale, details.lastSuccessAt) : null;
  return locale === "en"
    ? renderNotice(locale, {
        subject: `The ${details.channelName} calendar of ${details.propertyName} isn't updating`,
        heading: `We can't read the ${details.channelName} calendar of ${details.propertyName}`,
        paragraphs: [
          last
            ? `The last successful read was on ${last}. Stays shown for this property may be out of date.`
            : "We haven't been able to read it yet. Stays shown for this property may be out of date.",
          "Check that the calendar export link is still active in your channel, or paste a new one.",
          `Open the property's calendars: ${details.link}`,
        ],
      })
    : renderNotice(locale, {
        subject: `El calendario de ${details.channelName} de ${details.propertyName} no se actualiza`,
        heading: `No podemos leer el calendario de ${details.channelName} de ${details.propertyName}`,
        paragraphs: [
          last
            ? `La última lectura correcta fue el ${last}. Las estancias de esta propiedad podrían estar desactualizadas.`
            : "Todavía no hemos podido leerlo. Las estancias de esta propiedad podrían estar desactualizadas.",
          "Revisa que el enlace de exportación del calendario siga activo en tu canal, o pega uno nuevo.",
          `Abre los calendarios de la propiedad: ${details.link}`,
        ],
      });
}

const REASONS: Record<EmailLocale, Record<string, string>> = {
  es: {
    plan_limit: "Se alcanzó el límite de propiedades",
    reconnect_pms: "Hay que volver a conectar el PMS",
    provider_error: "El PMS respondió con un error",
    invalid_time_zone: "La zona horaria no es válida",
    missing_facts: "Faltan datos obligatorios",
    feed_rejected: "No pudimos leer el enlace del calendario",
    invalid_row: "La fila tiene errores",
  },
  en: {
    plan_limit: "The property limit was reached",
    reconnect_pms: "The PMS needs to be reconnected",
    provider_error: "The PMS answered with an error",
    invalid_time_zone: "The time zone isn't valid",
    missing_facts: "Required details are missing",
    feed_rejected: "We couldn't read the calendar link",
    invalid_row: "The row has errors",
  },
};

export interface ImportFinishedDetails {
  /** "Beds24", "Hostex", or "CSV". */
  source: string;
  created: number;
  needsDetails: number;
  failed: number;
  skipped: number;
  /** Reason codes of the first failures (at most five are shown). */
  reasonCodes: string[];
  link: string;
}

/** `properties.import_finished`: a PMS or CSV import run finished (FR-029). */
export function renderImportFinished(
  locale: EmailLocale,
  details: ImportFinishedDetails,
): Promise<Rendered> {
  const reasons = [...new Set(details.reasonCodes)]
    .slice(0, 5)
    .map((code) => REASONS[locale][code] ?? REASONS[locale].provider_error!);
  return locale === "en"
    ? renderNotice(locale, {
        subject: `Your ${details.source} import finished`,
        heading: `Your ${details.source} import finished`,
        paragraphs: [
          `Created: ${details.created}. Need details: ${details.needsDetails}. Failed: ${details.failed}. Skipped: ${details.skipped}.`,
          ...(reasons.length > 0 ? [`Main reasons: ${reasons.join("; ")}.`] : []),
          "Imported properties wait for you to confirm their details before they're ready.",
          `See the results: ${details.link}`,
        ],
      })
    : renderNotice(locale, {
        subject: `Terminó tu importación desde ${details.source}`,
        heading: `Terminó tu importación desde ${details.source}`,
        paragraphs: [
          `Creadas: ${details.created}. Con datos pendientes: ${details.needsDetails}. Con error: ${details.failed}. Omitidas: ${details.skipped}.`,
          ...(reasons.length > 0 ? [`Motivos principales: ${reasons.join("; ")}.`] : []),
          "Las propiedades importadas esperan a que confirmes sus datos antes de quedar listas.",
          `Mira los resultados: ${details.link}`,
        ],
      });
}

/** `properties.pms_reconnect`: PMS refreshes have failed for 24 hours (FR-035). */
export function renderPmsReconnect(
  locale: EmailLocale,
  details: { providerName: string; accountLabel: string; lastRefreshAt: Date | null; link: string },
): Promise<Rendered> {
  const last = details.lastRefreshAt ? formatDate(locale, details.lastRefreshAt) : null;
  return locale === "en"
    ? renderNotice(locale, {
        subject: `Reconnect ${details.providerName} to keep your stays up to date`,
        heading: `We can't refresh your stays from ${details.providerName}`,
        paragraphs: [
          `Account: ${details.accountLabel}.${last ? ` Last successful refresh: ${last}.` : ""}`,
          "Stays shown from this account may be out of date. If you revoked or changed the access, connect it again.",
          `Open your integrations: ${details.link}`,
        ],
      })
    : renderNotice(locale, {
        subject: `Vuelve a conectar ${details.providerName} para mantener tus estancias al día`,
        heading: `No podemos actualizar tus estancias desde ${details.providerName}`,
        paragraphs: [
          `Cuenta: ${details.accountLabel}.${last ? ` Última actualización correcta: ${last}.` : ""}`,
          "Las estancias de esta cuenta podrían estar desactualizadas. Si revocaste o cambiaste el acceso, vuelve a conectarla.",
          `Abre tus integraciones: ${details.link}`,
        ],
      });
}
