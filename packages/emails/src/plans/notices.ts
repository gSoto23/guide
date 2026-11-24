import type { EmailLocale } from "../locale.js";
import { renderNotice, type Rendered } from "../notice.js";

/**
 * Feature 011 (research R5): the month's AI replies reached 80% or 100% of the workspace's limit.
 * Counts only; sent once per threshold and month to each owner. Feature 019 adds top-ups: the AI
 * keeps answering from a top-up once the month is used up, and owners can ask for one.
 */
export interface PlanAiUsageDetails {
  workspaceName: string;
  threshold: 80 | 100;
  used: number;
  limit: number;
  /** The renewal moment, already formatted for the owner (for example "1 Dec 2026, 00:00 UTC"). */
  resetsAt: string;
  planLink: string;
  /** Feature 019: AI replies left in the workspace's top-ups (0 when none). */
  topUpLeft?: number;
}

/** `plan.ai_usage` (FR-009; feature 019 FR-013). */
export function renderPlanAiUsage(
  locale: EmailLocale,
  details: PlanAiUsageDetails,
): Promise<Rendered> {
  const left = Math.max(0, details.limit - details.used);
  const topUpLeft = details.topUpLeft ?? 0;
  if (locale === "en") {
    return renderNotice(locale, {
      subject:
        details.threshold === 100
          ? `${details.workspaceName}: this month's AI replies are used up`
          : `${details.workspaceName}: 80% of this month's AI replies used`,
      heading:
        details.threshold === 100 ? "AI replies used up for this month" : "AI replies at 80%",
      paragraphs: [
        details.threshold === 100
          ? topUpLeft > 0
            ? `Your workspace used its ${details.limit} AI replies for this month. The AI keeps answering with your top-up (${topUpLeft} replies left). The month's replies renew on ${details.resetsAt}.`
            : `Your workspace used its ${details.limit} AI replies for this month. Until ${details.resetsAt}, guests get a holding reply and their conversations wait for you; copilot drafts and assistant tests pause too. Your guides keep working.`
          : `Your workspace used ${details.used} of its ${details.limit} AI replies for this month (${left} left). They renew on ${details.resetsAt}.`,
        "When the month's replies are used up, a top-up keeps the AI answering. During the pilot, ask Guidesk for one from Plan and limits; it costs nothing.",
        `Plan and limits: ${details.planLink}`,
      ],
    });
  }
  return renderNotice(locale, {
    subject:
      details.threshold === 100
        ? `${details.workspaceName}: se acabaron las respuestas de IA de este mes`
        : `${details.workspaceName}: usaste el 80% de las respuestas de IA del mes`,
    heading:
      details.threshold === 100
        ? "Se acabaron las respuestas de IA del mes"
        : "Respuestas de IA al 80%",
    paragraphs: [
      details.threshold === 100
        ? topUpLeft > 0
          ? `Tu workspace usó sus ${details.limit} respuestas de IA de este mes. La IA sigue respondiendo con tu recarga (quedan ${topUpLeft} respuestas). Las del mes se renuevan el ${details.resetsAt}.`
          : `Tu workspace usó sus ${details.limit} respuestas de IA de este mes. Hasta el ${details.resetsAt}, los huéspedes reciben una respuesta de espera y sus conversaciones te esperan; los borradores del copiloto y las pruebas del asistente también se pausan. Tus guías siguen funcionando.`
        : `Tu workspace usó ${details.used} de sus ${details.limit} respuestas de IA de este mes (quedan ${left}). Se renuevan el ${details.resetsAt}.`,
      "Cuando se acaban las respuestas del mes, una recarga mantiene la IA respondiendo. Durante el piloto, pídesela a Guidesk desde Plan y límites; no tiene costo.",
      `Plan y límites: ${details.planLink}`,
    ],
  });
}

/** Feature 019 (FR-013): a top-up reached zero replies left. Counts only; once per top-up. */
export interface PlanTopUpUsedUpDetails {
  workspaceName: string;
  /** The size of the top-up that ran out. */
  granted: number;
  /** Replies left in the month's allowance and in other top-ups. */
  monthLeft: number;
  otherTopUpsLeft: number;
  resetsAt: string;
  planLink: string;
}

/** `plan.top_up_used_up` (feature 019 FR-013). */
export function renderPlanTopUpUsedUp(
  locale: EmailLocale,
  details: PlanTopUpUsedUpDetails,
): Promise<Rendered> {
  const paused = details.monthLeft === 0 && details.otherTopUpsLeft === 0;
  if (locale === "en") {
    return renderNotice(locale, {
      subject: `${details.workspaceName}: an AI reply top-up is used up`,
      heading: "A top-up is used up",
      paragraphs: [
        `Your top-up of ${details.granted} AI replies is used up.`,
        paused
          ? `This month's replies are used up too, so until ${details.resetsAt} guests get a holding reply and their conversations wait for you. Your guides keep working.`
          : details.otherTopUpsLeft > 0
            ? `The AI keeps answering with your other top-ups (${details.otherTopUpsLeft} replies left).`
            : `This month still has ${details.monthLeft} replies left.`,
        "During the pilot, ask Guidesk for another top-up from Plan and limits; it costs nothing.",
        `Plan and limits: ${details.planLink}`,
      ],
    });
  }
  return renderNotice(locale, {
    subject: `${details.workspaceName}: se acabó una recarga de respuestas de IA`,
    heading: "Se acabó una recarga",
    paragraphs: [
      `Se usaron las ${details.granted} respuestas de IA de tu recarga.`,
      paused
        ? `Las respuestas de este mes también se acabaron: hasta el ${details.resetsAt}, los huéspedes reciben una respuesta de espera y sus conversaciones te esperan. Tus guías siguen funcionando.`
        : details.otherTopUpsLeft > 0
          ? `La IA sigue respondiendo con tus otras recargas (quedan ${details.otherTopUpsLeft} respuestas).`
          : `A este mes todavía le quedan ${details.monthLeft} respuestas.`,
      "Durante el piloto, pídele otra recarga a Guidesk desde Plan y límites; no tiene costo.",
      `Plan y límites: ${details.planLink}`,
    ],
  });
}
