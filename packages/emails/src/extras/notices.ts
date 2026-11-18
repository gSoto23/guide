import type { EmailLocale } from "../locale.js";
import { renderNotice, type Rendered } from "../notice.js";

/**
 * Feature 008 (research R5): a new add-on request for the property's contacts. Host content only
 * (the property and the extra's name, the requested date and time); never the guest's note (SEC-20).
 * Pending legal review (OQ-35).
 */
export interface ServiceRequestDetails {
  propertyName: string;
  extraName: string;
  requestedDate: string | null;
  requestedTime: string | null;
  quantity: number;
  confirmed: boolean;
  stay: { checkInDate: string; checkoutDate: string };
  requestsLink: string;
}

export function renderServiceRequestNew(
  locale: EmailLocale,
  details: ServiceRequestDetails,
): Promise<Rendered> {
  const when = details.requestedDate
    ? `${details.requestedDate}${details.requestedTime ? ` ${details.requestedTime}` : ""}`
    : null;
  if (locale === "en") {
    return renderNotice(locale, {
      subject: `New request at ${details.propertyName}: ${details.extraName}`,
      heading: details.confirmed
        ? "A pre-approved extra was requested"
        : "A guest requested an extra",
      paragraphs: [
        `${details.extraName}${details.quantity > 1 ? ` × ${details.quantity}` : ""}${when ? `, ${when}` : ""}.`,
        `Stay: ${details.stay.checkInDate} → ${details.stay.checkoutDate}.`,
        details.confirmed
          ? "It was confirmed automatically by your rules. Arrange payment with the guest."
          : "Confirm or decline it from Requests; the guest sees your answer in the guide.",
        `Requests: ${details.requestsLink}`,
      ],
    });
  }
  return renderNotice(locale, {
    subject: `Nueva solicitud en ${details.propertyName}: ${details.extraName}`,
    heading: details.confirmed ? "Pidieron un extra preaprobado" : "Un huésped pidió un extra",
    paragraphs: [
      `${details.extraName}${details.quantity > 1 ? ` × ${details.quantity}` : ""}${when ? `, ${when}` : ""}.`,
      `Estadía: ${details.stay.checkInDate} → ${details.stay.checkoutDate}.`,
      details.confirmed
        ? "Se confirmó automáticamente según tus reglas. Acuerda el pago con el huésped."
        : "Confírmala o recházala desde Solicitudes; el huésped verá tu respuesta en la guía.",
      `Solicitudes: ${details.requestsLink}`,
    ],
  });
}
