import type { EmailLocale } from "../locale.js";
import { renderNotice, type Rendered } from "../notice.js";

/**
 * Feature 011 (research R5): the month's AI replies reached 80% or 100% of the workspace's limit.
 * Counts only; sent once per threshold and month to each owner.
 */
export interface PlanAiUsageDetails {
  workspaceName: string;
  threshold: 80 | 100;
  used: number;
  limit: number;
  /** The renewal moment, already formatted for the owner (for example "1 Dec 2026, 00:00 UTC"). */
  resetsAt: string;
  planLink: string;
}

/** `plan.ai_usage` (FR-009). */
export function renderPlanAiUsage(
  locale: EmailLocale,
  details: PlanAiUsageDetails,
): Promise<Rendered> {
  const left = Math.max(0, details.limit - details.used);
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
          ? `Your workspace used its ${details.limit} AI replies for this month. Until ${details.resetsAt}, guests get a holding reply and their conversations wait for you; copilot drafts and assistant tests pause too. Your guides keep working.`
          : `Your workspace used ${details.used} of its ${details.limit} AI replies for this month (${left} left). They renew on ${details.resetsAt}.`,
        "To change your plan, write to Guidesk from Plan and limits.",
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
        ? `Tu workspace usó sus ${details.limit} respuestas de IA de este mes. Hasta el ${details.resetsAt}, los huéspedes reciben una respuesta de espera y sus conversaciones te esperan; los borradores del copiloto y las pruebas del asistente también se pausan. Tus guías siguen funcionando.`
        : `Tu workspace usó ${details.used} de sus ${details.limit} respuestas de IA de este mes (quedan ${left}). Se renuevan el ${details.resetsAt}.`,
      "Para cambiar de plan, escríbele a Guidesk desde Plan y límites.",
      `Plan y límites: ${details.planLink}`,
    ],
  });
}
