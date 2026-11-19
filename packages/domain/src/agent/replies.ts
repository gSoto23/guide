import type { NeedsHostReason } from "./policy.js";
import type { Tone } from "./settings.js";

/**
 * The assistant's fixed texts (feature 005 FR-019, research R5): holding replies per reason, the
 * pointer to a locked field's section, the greeting, and the emergency card's first line. Reviewed
 * texts in the guide's shown language (Spanish or English), never written by the model. Every
 * holding reply reminds the guest that the booking platform's messages also reach the host (PC-01,
 * PC-02). Pending legal review (OQ-35).
 *
 * Feature 007 (research R5, FR-007, FR-009): every text has a formal variant ("usted" in Spanish, no
 * exclamation marks or emoji in either language), and holding replies during quiet hours say when the
 * host usually answers. Casual texts are spec 005's, unchanged.
 */
export type ReplyLanguage = "es" | "en";

const FORMAL_PLATFORM_ES =
  "También puede escribirle por los mensajes de la plataforma de su reserva.";

const FORMAL_HOLDING_ES: Record<NeedsHostReason, string> = {
  emergency:
    "Si hay peligro, llame ya al número de emergencias. Ya avisamos a su anfitrión, que le responderá aquí.",
  malfunction: "Gracias por avisar. Ya avisamos a su anfitrión, que le responderá aquí pronto.",
  complaint:
    "Lamentamos la molestia. Ya avisamos a su anfitrión, que le responderá aquí personalmente.",
  money: "Esto lo responde su anfitrión personalmente. Ya le avisamos y le responderá aquí.",
  reservation_change:
    "Los cambios de reserva los gestiona su anfitrión. Ya le avisamos y le responderá aquí.",
  legal: "Esto lo responde su anfitrión personalmente. Ya le avisamos y le responderá aquí.",
  not_confident:
    "No encuentro esto en la guía. Le pasé su pregunta a su anfitrión, que le responderá aquí.",
  draft_ready: "Gracias por su mensaje. Su anfitrión lo revisará y le responderá aquí pronto.",
  check_failed: "Gracias por su mensaje. Su anfitrión lo revisará y le responderá aquí pronto.",
  limit: "Gracias por su mensaje. Su anfitrión le responderá aquí pronto.",
  monthly_limit: "Gracias por su mensaje. Su anfitrión le responderá aquí pronto.",
  unavailable:
    "El asistente no está disponible en este momento. Su anfitrión ya tiene su mensaje y le responderá aquí.",
  taken_over: "Su anfitrión le responderá aquí personalmente.",
};

const PLATFORM: Record<ReplyLanguage, string> = {
  es: "También puedes escribirle por los mensajes de la plataforma de tu reserva.",
  en: "You can also reach your host through your booking platform's messages.",
};

const HOLDING: Record<ReplyLanguage, Record<NeedsHostReason, string>> = {
  es: {
    emergency:
      "Si hay peligro, llama ya al número de emergencias. Ya avisamos a tu anfitrión, que te responderá aquí.",
    malfunction: "Gracias por avisar. Ya avisamos a tu anfitrión, que te responderá aquí pronto.",
    complaint:
      "Lamentamos la molestia. Ya avisamos a tu anfitrión, que te responderá aquí personalmente.",
    money: "Esto lo responde tu anfitrión personalmente. Ya le avisamos y te responderá aquí.",
    reservation_change:
      "Los cambios de reserva los gestiona tu anfitrión. Ya le avisamos y te responderá aquí.",
    legal: "Esto lo responde tu anfitrión personalmente. Ya le avisamos y te responderá aquí.",
    not_confident:
      "No encuentro esto en la guía. Le pasé tu pregunta a tu anfitrión, que te responderá aquí.",
    draft_ready: "Gracias por tu mensaje. Tu anfitrión lo revisará y te responderá aquí pronto.",
    check_failed: "Gracias por tu mensaje. Tu anfitrión lo revisará y te responderá aquí pronto.",
    limit: "Gracias por tu mensaje. Tu anfitrión te responderá aquí pronto.",
    monthly_limit: "Gracias por tu mensaje. Tu anfitrión te responderá aquí pronto.",
    unavailable:
      "El asistente no está disponible en este momento. Tu anfitrión ya tiene tu mensaje y te responderá aquí.",
    taken_over: "Tu anfitrión te responderá aquí personalmente.",
  },
  en: {
    emergency:
      "If anyone is in danger, call the emergency number now. We've told your host, who will reply here.",
    malfunction: "Thanks for letting us know. We've told your host, who will reply here soon.",
    complaint:
      "We're sorry about this. We've told your host, who will reply to you here personally.",
    money: "Your host answers this personally. We've told them, and they will reply here.",
    reservation_change:
      "Your host handles reservation changes. We've told them, and they will reply here.",
    legal: "Your host answers this personally. We've told them, and they will reply here.",
    not_confident:
      "I can't find this in the guide. I've passed your question to your host, who will reply here.",
    draft_ready: "Thanks for your message. Your host will review it and reply here soon.",
    check_failed: "Thanks for your message. Your host will review it and reply here soon.",
    limit: "Thanks for your message. Your host will reply here soon.",
    monthly_limit: "Thanks for your message. Your host will reply here soon.",
    unavailable:
      "The assistant isn't available right now. Your host has your message and will reply here.",
    taken_over: "Your host will reply to you here personally.",
  },
};

export interface ReplyOptions {
  tone?: Tone;
  /** During quiet hours, the window's end as `HH:MM` local time (feature 007 FR-009). */
  quietUntil?: string | null;
}

/** "07:00" in Spanish, "7:00 AM" in English. */
function clockText(language: ReplyLanguage, clock: string): string {
  if (language === "es") return clock;
  const hours = Number(clock.slice(0, 2));
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${clock.slice(3, 5)} ${suffix}`;
}

/** The quiet hours line of a holding reply (feature 007 FR-009). */
export function quietHoursLine(
  language: ReplyLanguage,
  clock: string,
  tone: Tone = "casual",
): string {
  const time = clockText(language, clock);
  if (language === "en") return `Your host usually replies after ${time}.`;
  return tone === "formal"
    ? `Su anfitrión suele responder después de las ${time}.`
    : `Tu anfitrión suele responder después de las ${time}.`;
}

export function holdingReply(
  language: ReplyLanguage,
  reason: NeedsHostReason,
  options: ReplyOptions = {},
): string {
  const formal = options.tone === "formal" && language === "es";
  const parts = [formal ? FORMAL_HOLDING_ES[reason] : HOLDING[language][reason]];
  if (options.quietUntil && reason !== "emergency") {
    parts.push(quietHoursLine(language, options.quietUntil, options.tone));
  }
  parts.push(formal ? FORMAL_PLATFORM_ES : PLATFORM[language]);
  return parts.join(" ");
}

/** FR-010: codes and non-public Wi-Fi passwords are shown only in their section. */
export function pointerReply(language: ReplyLanguage, sectionTitle: string | null): string {
  if (language === "en") {
    return sectionTitle
      ? `For your security, that is shown only in the guide's “${sectionTitle}” section, to verified guests during their stay.`
      : "For your security, that is shown only in the guide, to verified guests during their stay.";
  }
  return sectionTitle
    ? `Por seguridad, ese dato se muestra solo en la sección «${sectionTitle}» de la guía, a huéspedes verificados durante su estadía.`
    : "Por seguridad, ese dato se muestra solo en la guía, a huéspedes verificados durante su estadía.";
}

export function greetingReply(
  language: ReplyLanguage,
  propertyName: string,
  tone: Tone = "casual",
): string {
  if (tone === "formal") {
    return language === "en"
      ? `Hello. I am the virtual assistant for ${propertyName}. Please ask me anything about your stay; my answers come from your host's guide.`
      : `Hola. Soy el asistente virtual de ${propertyName}. Pregúnteme lo que necesite sobre su estadía; respondo con la guía de su anfitrión.`;
  }
  return language === "en"
    ? `Hi! I'm the virtual assistant for ${propertyName}. Ask me anything about your stay; my answers come from your host's guide.`
    : `¡Hola! Soy el asistente virtual de ${propertyName}. Pregúntame lo que necesites sobre tu estadía; respondo con la guía de tu anfitrión.`;
}

/** The emergency card's first line (FR-018); the card also carries the guide's emergency text. */
export function emergencyReply(
  language: ReplyLanguage,
  emergencyNumber: string | null,
  tone: Tone = "casual",
): string {
  if (language === "en") {
    return emergencyNumber
      ? `Emergency: call ${emergencyNumber} now.`
      : "Emergency: call your local emergency number now.";
  }
  const call = tone === "formal" ? "llame" : "llama";
  return emergencyNumber
    ? `Emergencia: ${call} ya al ${emergencyNumber}.`
    : `Emergencia: ${call} ya al número de emergencias local.`;
}
