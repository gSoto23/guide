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

export interface VerificationLockedDetails {
  propertyName: string;
  checkInDate: string;
  checkoutDate: string;
  lockedMinutes: number;
  lockouts: number;
  shareLink: string;
}

/**
 * `guides.verification_locked` (feature 004 FR-035, contracts/emails.md): a stay locked after 5
 * wrong confirmation codes. Never the code, the stay link, or guest data.
 */
export function renderVerificationLocked(
  locale: EmailLocale,
  details: VerificationLockedDetails,
): Promise<Rendered> {
  const dates = `${details.checkInDate} → ${details.checkoutDate}`;
  return locale === "en"
    ? renderNotice(locale, {
        subject: `Too many wrong confirmation codes at ${details.propertyName}`,
        heading: "Confirmation code attempts paused",
        paragraphs: [
          `Someone entered 5 wrong confirmation codes for the stay ${dates} at ${details.propertyName}. Attempts are paused for ${details.lockedMinutes} minutes.`,
          details.lockouts > 1
            ? `This is pause number ${details.lockouts} for this stay in the last 24 hours.`
            : "This is the first pause for this stay.",
          "If your guest didn't cause this, create a new stay link on the Share screen and send it in the booking's chat. The old link stops working at once.",
          `Share screen: ${details.shareLink}`,
        ],
      })
    : renderNotice(locale, {
        subject: `Demasiados códigos de confirmación incorrectos en ${details.propertyName}`,
        heading: "Intentos de código de confirmación en pausa",
        paragraphs: [
          `Alguien escribió 5 códigos de confirmación incorrectos para la estadía ${dates} en ${details.propertyName}. Los intentos quedan en pausa ${details.lockedMinutes} minutos.`,
          details.lockouts > 1
            ? `Es la pausa número ${details.lockouts} de esta estadía en las últimas 24 horas.`
            : "Es la primera pausa de esta estadía.",
          "Si no fue tu huésped, crea un enlace de estadía nuevo en la pantalla Compartir y envíalo en el chat de la reserva. El enlace anterior deja de funcionar de inmediato.",
          `Pantalla Compartir: ${details.shareLink}`,
        ],
      });
}
