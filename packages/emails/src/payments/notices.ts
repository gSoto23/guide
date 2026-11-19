import type { EmailLocale } from "../locale.js";
import { renderNotice, type Rendered } from "../notice.js";

/**
 * Feature 013 (research R8): an add-on was paid (to the property's escalation contacts) or a
 * payment was disputed (to the owners). The extra's name and the amount only; never card or
 * guest details.
 */
export interface PaymentNoticeDetails {
  propertyName: string;
  extraName: string;
  /** Already formatted for the recipient, for example "85.00 USD". */
  amount: string;
  requestsLink: string;
}

export function renderPaymentPaid(
  locale: EmailLocale,
  details: PaymentNoticeDetails,
): Promise<Rendered> {
  if (locale === "en") {
    return renderNotice(locale, {
      subject: `Paid: ${details.extraName} at ${details.propertyName}`,
      heading: "A guest paid for an extra",
      paragraphs: [
        `The guest paid ${details.amount} for ${details.extraName} at ${details.propertyName}.`,
        "Your share, after Guidesk's fee and the card fee, goes to your payout account.",
        `Requests: ${details.requestsLink}`,
      ],
    });
  }
  return renderNotice(locale, {
    subject: `Pagado: ${details.extraName} en ${details.propertyName}`,
    heading: "Un huésped pagó un extra",
    paragraphs: [
      `El huésped pagó ${details.amount} por ${details.extraName} en ${details.propertyName}.`,
      "Tu parte, después de la comisión de Guidesk y la de la tarjeta, va a tu cuenta de pagos.",
      `Solicitudes: ${details.requestsLink}`,
    ],
  });
}

export function renderPaymentDisputed(
  locale: EmailLocale,
  details: PaymentNoticeDetails,
): Promise<Rendered> {
  if (locale === "en") {
    return renderNotice(locale, {
      subject: `Disputed payment: ${details.extraName} at ${details.propertyName}`,
      heading: "A guest disputed a payment",
      paragraphs: [
        `The guest's bank opened a dispute on the ${details.amount} payment for ${details.extraName} at ${details.propertyName}.`,
        "The payment provider handles disputes and will contact you about any evidence it needs.",
        `Requests: ${details.requestsLink}`,
      ],
    });
  }
  return renderNotice(locale, {
    subject: `Pago en disputa: ${details.extraName} en ${details.propertyName}`,
    heading: "Un huésped disputó un pago",
    paragraphs: [
      `El banco del huésped abrió una disputa por el pago de ${details.amount} de ${details.extraName} en ${details.propertyName}.`,
      "El proveedor de pagos atiende las disputas y te contactará si necesita pruebas.",
      `Solicitudes: ${details.requestsLink}`,
    ],
  });
}
