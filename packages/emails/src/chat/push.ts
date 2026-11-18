import type { EmailLocale } from "../locale.js";
import type { ChatNeedsHostReason } from "./notices.js";

/**
 * Push texts (feature 006 contracts/notifications.md): a title and a short body, never guest text,
 * codes, or contact data (SEC-20). Pending legal review (OQ-35).
 */
const REASONS: Record<EmailLocale, Record<ChatNeedsHostReason, string>> = {
  en: {
    emergency: "Possible emergency",
    malfunction: "Something isn't working",
    complaint: "A guest has a complaint",
    money: "Refund or payment question",
    reservation_change: "Reservation change request",
    legal: "Legal or safety matter",
    not_confident: "A question the guide doesn't answer",
    draft_ready: "Draft ready to review",
    check_failed: "A draft needs your review",
    limit: "Assistant limit reached: please reply",
    unavailable: "Assistant unavailable: please reply",
    taken_over: "The guest wrote again in your conversation",
  },
  es: {
    emergency: "Posible emergencia",
    malfunction: "Algo no funciona",
    complaint: "Un huésped tiene una queja",
    money: "Pregunta sobre reembolso o pago",
    reservation_change: "Pedido de cambio de reserva",
    legal: "Tema legal o de seguridad",
    not_confident: "Una pregunta que la guía no responde",
    draft_ready: "Borrador listo para revisar",
    check_failed: "Un borrador necesita tu revisión",
    limit: "Límite del asistente alcanzado: responde tú",
    unavailable: "Asistente no disponible: responde tú",
    taken_over: "El huésped volvió a escribir en tu conversación",
  },
};

export type PushText =
  | { kind: "needs_host"; propertyName: string; reason: ChatNeedsHostReason }
  | { kind: "quiet_summary"; propertyName: string; count: number }
  | { kind: "test" };

export function renderPush(locale: EmailLocale, text: PushText): { title: string; body: string } {
  if (text.kind === "test") {
    return locale === "en"
      ? { title: "Guidesk", body: "Alerts are on for this device." }
      : { title: "Guidesk", body: "Las alertas están activadas en este dispositivo." };
  }
  if (text.kind === "quiet_summary") {
    const many = text.count !== 1;
    return {
      title: text.propertyName,
      body:
        locale === "en"
          ? `${text.count} ${many ? "guests are" : "guest is"} waiting for you`
          : `${text.count} ${many ? "huéspedes esperan" : "huésped espera"} tu respuesta`,
    };
  }
  return { title: text.propertyName, body: REASONS[locale][text.reason] };
}
