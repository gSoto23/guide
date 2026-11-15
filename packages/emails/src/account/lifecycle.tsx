import type { EmailLocale } from "../locale.js";
import { formatDate, renderNotice, type Rendered } from "../notice.js";

/** `account.email_change_code` (FR-029): sent to the new address, inline. */
export function renderEmailChangeCode(locale: EmailLocale, code: string): Promise<Rendered> {
  return locale === "en"
    ? renderNotice(locale, {
        subject: "Confirm your new Guidesk email",
        heading: `Your code: ${code}`,
        paragraphs: [
          "Enter this code in Guidesk to use this address for your account. It expires in 10 minutes.",
          "If you didn't ask for this, ignore this email; nothing changes.",
        ],
      })
    : renderNotice(locale, {
        subject: "Confirma tu nuevo email de Guidesk",
        heading: `Tu código: ${code}`,
        paragraphs: [
          "Ingresa este código en Guidesk para usar esta dirección en tu cuenta. Vence en 10 minutos.",
          "Si no lo pediste, ignora este mensaje; nada cambia.",
        ],
      });
}

/** `account.email_changed` (FR-029): sent to the old address. */
export function renderEmailChanged(locale: EmailLocale, newEmailMasked: string): Promise<Rendered> {
  return locale === "en"
    ? renderNotice(locale, {
        subject: "Your Guidesk email changed",
        heading: "Your account email changed",
        paragraphs: [
          `Your Guidesk account now uses ${newEmailMasked}. Other devices were signed out.`,
          "If this wasn't you, contact Guidesk support right away.",
        ],
        security: true,
      })
    : renderNotice(locale, {
        subject: "Cambió el email de tu cuenta de Guidesk",
        heading: "Cambió el email de tu cuenta",
        paragraphs: [
          `Tu cuenta de Guidesk ahora usa ${newEmailMasked}. Cerramos la sesión en tus otros dispositivos.`,
          "Si no fuiste tú, escribe de inmediato al soporte de Guidesk.",
        ],
        security: true,
      });
}

/** `account.deletion_scheduled` (FR-028). */
export function renderAccountDeletionScheduled(
  locale: EmailLocale,
  purgeAfter: Date,
): Promise<Rendered> {
  const when = formatDate(locale, purgeAfter);
  return locale === "en"
    ? renderNotice(locale, {
        subject: "Your Guidesk account will be deleted",
        heading: `Your account will be deleted on ${when}`,
        paragraphs: [
          "We signed you out everywhere. To keep your account, just sign in again before that date.",
        ],
        security: true,
      })
    : renderNotice(locale, {
        subject: "Tu cuenta de Guidesk se eliminará",
        heading: `Tu cuenta se eliminará el ${when}`,
        paragraphs: [
          "Cerramos tu sesión en todos los dispositivos. Para conservar tu cuenta, solo vuelve a iniciar sesión antes de esa fecha.",
        ],
        security: true,
      });
}

/** `account.deleted`: sent by the worker to the last address after the purge. */
export function renderAccountDeleted(locale: EmailLocale): Promise<Rendered> {
  return locale === "en"
    ? renderNotice(locale, {
        subject: "Your Guidesk account was deleted",
        heading: "Your account was deleted",
        paragraphs: ["Your personal data was deleted as you asked. Thank you for using Guidesk."],
      })
    : renderNotice(locale, {
        subject: "Tu cuenta de Guidesk fue eliminada",
        heading: "Tu cuenta fue eliminada",
        paragraphs: ["Borramos tus datos personales como pediste. Gracias por usar Guidesk."],
      });
}

/** Shows enough of an address to recognize it, without spelling it out: a•••@example.com. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}
