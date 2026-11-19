import type { EmailLocale } from "../locale.js";
import { renderNotice, type Rendered } from "../notice.js";

/**
 * In-guide chat emails (feature 005 contracts/emails.md). None carries a locked value, a stay token,
 * or guest contact data; links point only to the portal.
 */
export type ChatNeedsHostReason =
  | "emergency"
  | "malfunction"
  | "complaint"
  | "money"
  | "reservation_change"
  | "legal"
  | "not_confident"
  | "draft_ready"
  | "check_failed"
  | "limit"
  | "monthly_limit"
  | "unavailable"
  | "taken_over";

const REASONS: Record<EmailLocale, Record<ChatNeedsHostReason, string>> = {
  en: {
    emergency: "The guest may have an emergency.",
    malfunction: "The guest reports damage or something that doesn't work.",
    complaint: "The guest has a complaint.",
    money: "The guest asks about a refund, a payment, or compensation.",
    reservation_change: "The guest asks to change the reservation.",
    legal: "The message touches a legal or safety matter.",
    not_confident: "The assistant couldn't answer from the guide.",
    draft_ready: "The assistant prepared a reply for you to review.",
    check_failed: "The assistant's reply needs your review before it is sent.",
    limit: "The daily assistant budget is used up, so you need to reply.",
    monthly_limit: "This month's AI replies are used up, so you need to reply.",
    unavailable: "The assistant was unavailable, so you need to reply.",
    taken_over: "The guest wrote again in a conversation you took over.",
  },
  es: {
    emergency: "El huésped podría tener una emergencia.",
    malfunction: "El huésped reporta un daño o algo que no funciona.",
    complaint: "El huésped tiene una queja.",
    money: "El huésped pregunta por un reembolso, un pago o una compensación.",
    reservation_change: "El huésped pide cambiar la reserva.",
    legal: "El mensaje trata un tema legal o de seguridad.",
    not_confident: "El asistente no pudo responder con la guía.",
    draft_ready: "El asistente preparó una respuesta para que la revises.",
    check_failed: "La respuesta del asistente necesita tu revisión antes de enviarse.",
    limit: "Se agotó el presupuesto diario del asistente, así que debes responder tú.",
    monthly_limit: "Se acabaron las respuestas de IA de este mes, así que debes responder tú.",
    unavailable: "El asistente no estaba disponible, así que debes responder tú.",
    taken_over: "El huésped volvió a escribir en una conversación que tomaste.",
  },
};

export interface ChatNeedsHostDetails {
  propertyName: string;
  reason: ChatNeedsHostReason;
  /** Stay dates when the conversation has a stay. */
  stay: { checkInDate: string; checkoutDate: string } | null;
  /** The guest's latest message; only the first 300 characters are used. */
  guestMessage: string;
  conversationLink: string;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/** `chat.needs_host` (FR-023): at most one per conversation per 30 minutes. */
export function renderChatNeedsHost(
  locale: EmailLocale,
  details: ChatNeedsHostDetails,
): Promise<Rendered> {
  const message = excerpt(details.guestMessage);
  const urgent = details.reason === "emergency";
  if (locale === "en") {
    const stay = details.stay
      ? `Stay: ${details.stay.checkInDate} → ${details.stay.checkoutDate}.`
      : "No stay linked to this conversation.";
    return renderNotice(locale, {
      subject: `${urgent ? "Urgent: " : ""}A guest at ${details.propertyName} needs you`,
      heading: urgent ? "A guest may have an emergency" : "A guest needs your reply",
      paragraphs: [
        REASONS.en[details.reason],
        stay,
        `Latest message: “${message}”`,
        "Reply from the conversation page; the guest sees it in the guide's chat.",
        `Conversation: ${details.conversationLink}`,
      ],
    });
  }
  const stay = details.stay
    ? `Estadía: ${details.stay.checkInDate} → ${details.stay.checkoutDate}.`
    : "Esta conversación no tiene estadía.";
  return renderNotice(locale, {
    subject: `${urgent ? "Urgente: " : ""}Un huésped de ${details.propertyName} te necesita`,
    heading: urgent ? "Un huésped podría tener una emergencia" : "Un huésped espera tu respuesta",
    paragraphs: [
      REASONS.es[details.reason],
      stay,
      `Último mensaje: «${message}»`,
      "Responde desde la página de la conversación; el huésped lo verá en el chat de la guía.",
      `Conversación: ${details.conversationLink}`,
    ],
  });
}

export interface ChatLimitReachedDetails {
  /** Null when the workspace's total budget is reached. */
  propertyName: string | null;
  limit: number;
  conversationsLink: string;
}

/** `chat.limit_reached` (FR-028): once per property per day, to owners. */
export function renderChatLimitReached(
  locale: EmailLocale,
  details: ChatLimitReachedDetails,
): Promise<Rendered> {
  if (locale === "en") {
    const where = details.propertyName ?? "all your properties";
    return renderNotice(locale, {
      subject: `The assistant reached its daily limit for ${where}`,
      heading: "Daily assistant limit reached",
      paragraphs: [
        `The assistant used its daily budget of ${details.limit} replies for ${where}.`,
        "Until tomorrow (UTC), guests get a holding reply and you answer them from the conversation page.",
        `Conversations: ${details.conversationsLink}`,
      ],
    });
  }
  const where = details.propertyName ?? "todas tus propiedades";
  return renderNotice(locale, {
    subject: `El asistente llegó a su límite diario en ${where}`,
    heading: "Límite diario del asistente alcanzado",
    paragraphs: [
      `El asistente usó su presupuesto diario de ${details.limit} respuestas en ${where}.`,
      "Hasta mañana (UTC), los huéspedes reciben una respuesta de espera y tú les respondes desde la página de la conversación.",
      `Conversaciones: ${details.conversationsLink}`,
    ],
  });
}

export interface ChatQuietSummaryDetails {
  propertyName: string;
  /** The conversations still waiting when quiet hours ended. */
  conversations: { reason: ChatNeedsHostReason; guestMessage: string; link: string }[];
}

function shortExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

/** `chat.quiet_summary` (feature 007 FR-008): one per recipient and property when quiet hours end. */
export function renderChatQuietSummary(
  locale: EmailLocale,
  details: ChatQuietSummaryDetails,
): Promise<Rendered> {
  const count = details.conversations.length;
  if (locale === "en") {
    return renderNotice(locale, {
      subject: `${count} ${count === 1 ? "guest is" : "guests are"} waiting at ${details.propertyName}`,
      heading: "While your quiet hours were on",
      paragraphs: [
        `${count === 1 ? "This conversation needs" : "These conversations need"} your reply:`,
        ...details.conversations.map(
          (item) => `${REASONS.en[item.reason]} “${shortExcerpt(item.guestMessage)}” ${item.link}`,
        ),
      ],
    });
  }
  return renderNotice(locale, {
    subject: `${count} ${count === 1 ? "huésped espera" : "huéspedes esperan"} en ${details.propertyName}`,
    heading: "Durante tus horas de silencio",
    paragraphs: [
      `${count === 1 ? "Esta conversación necesita" : "Estas conversaciones necesitan"} tu respuesta:`,
      ...details.conversations.map(
        (item) => `${REASONS.es[item.reason]} «${shortExcerpt(item.guestMessage)}» ${item.link}`,
      ),
    ],
  });
}
