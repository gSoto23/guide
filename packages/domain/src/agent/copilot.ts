import type { Escalation } from "./policy.js";
import type { ReplyLanguage } from "./replies.js";
import type { Tone } from "./settings.js";

/**
 * The copilot's fixed drafts and cautions (feature 006 research R5, FR-013). Written as the host, for
 * the booking platform's chat; reviewed texts, never written by the model. Pending legal review
 * (OQ-35).
 */
export const COPILOT_CAUTIONS = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "codes",
] as const;
export type CopilotCaution = (typeof COPILOT_CAUTIONS)[number];
export type BookingStatus = "inquiry" | "confirmed";

/** The caution banner for a classified message, or null for ordinary questions. */
export function cautionFor(escalation: Escalation): CopilotCaution | null {
  if (escalation === "none") return null;
  if (escalation === "sensitive_request") return "codes";
  return escalation;
}

export function copilotEmergencyDraft(
  language: ReplyLanguage,
  emergencyNumber: string | null,
  tone: Tone = "casual",
): string {
  if (language === "en") {
    const call = emergencyNumber ? `call ${emergencyNumber}` : "call your local emergency number";
    return `If anyone is in danger, please ${call} now. I'm on it and will message you right away.`;
  }
  const number = emergencyNumber ? `al ${emergencyNumber}` : "al número de emergencias local";
  return tone === "formal"
    ? `Si alguien está en peligro, llame ya ${number}. Ya estoy al tanto y le escribo enseguida.`
    : `Si alguien está en peligro, llama ya ${number}. Ya estoy al tanto y te escribo enseguida.`;
}

export function copilotCodeDraft(
  language: ReplyLanguage,
  bookingStatus: BookingStatus,
  sectionTitle: string | null,
  tone: Tone = "casual",
): string {
  const formal = tone === "formal" && language === "es";
  if (bookingStatus === "inquiry") {
    return language === "en"
      ? "Access details are shared once the booking is confirmed."
      : "Compartimos los detalles de acceso cuando la reserva está confirmada.";
  }
  if (language === "en") {
    return sectionTitle
      ? `You'll find the access instructions in the guide's “${sectionTitle}” section. For your security, the code is shown there during your stay.`
      : "You'll find the access instructions in the guide. For your security, the code is shown there during your stay.";
  }
  const where = sectionTitle ? `en la sección «${sectionTitle}» de la guía` : "en la guía";
  return formal
    ? `Encontrará las instrucciones de acceso ${where}. Por seguridad, el código se muestra ahí durante su estadía.`
    : `Encontrarás las instrucciones de acceso ${where}. Por seguridad, el código se muestra ahí durante tu estadía.`;
}
