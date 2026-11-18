import type { EmailLocale } from "../locale.js";
import { formatDate, renderNotice, type Rendered } from "../notice.js";

/**
 * Guide builder emails (feature 003 contracts/emails.md). None of them ever carries a locked-field
 * value, a code, or guide content; links point only to the portal.
 */
export interface RevealLimitDetails {
  memberName: string;
  memberEmail: string;
  reveals: number;
  /** Property names only. */
  propertyNames: string[];
  at: Date;
  securityLogLink: string;
  sessionsLink: string;
}

/** `guides.reveal_limit`: a member reached 20 locked-field reveals in one hour (FR-018). */
export function renderRevealLimit(
  locale: EmailLocale,
  details: RevealLimitDetails,
): Promise<Rendered> {
  const when = formatDate(locale, details.at);
  const properties = details.propertyNames.slice(0, 10).join(", ");
  return locale === "en"
    ? renderNotice(locale, {
        subject: `${details.memberName} revealed many locked fields`,
        heading: "Unusual reveals of locked fields",
        paragraphs: [
          `${details.memberName} (${details.memberEmail}) revealed ${details.reveals} locked fields within an hour, on ${when}.`,
          ...(properties ? [`Properties: ${properties}.`] : []),
          "Further reveals by this member are blocked until the hour ends. If you don't recognize this activity, sign the member out and change the affected codes.",
          `Security log: ${details.securityLogLink}`,
          `Member sessions: ${details.sessionsLink}`,
        ],
      })
    : renderNotice(locale, {
        subject: `${details.memberName} reveló muchos campos protegidos`,
        heading: "Revelados inusuales de campos protegidos",
        paragraphs: [
          `${details.memberName} (${details.memberEmail}) reveló ${details.reveals} campos protegidos en una hora, el ${when}.`,
          ...(properties ? [`Propiedades: ${properties}.`] : []),
          "Los revelados de este miembro quedan bloqueados hasta que termine la hora. Si no reconoces esta actividad, cierra las sesiones del miembro y cambia los códigos afectados.",
          `Registro de seguridad: ${details.securityLogLink}`,
          `Sesiones del miembro: ${details.sessionsLink}`,
        ],
      });
}
