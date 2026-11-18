/**
 * Plain-text messages the host pastes into the OTA thread (feature 004 FR-038 to FR-040, research
 * R14). They carry the essentials so the guide stays optional (PC-01, PC-02), never ask guests to
 * book or pay outside the platform (PC-06), and never contain guest data.
 */
export type MessageLanguage = "es" | "en";

export interface TemplateInput {
  propertyName: string;
  propertyLink: string;
}

const TEMPLATE: Record<MessageLanguage, (input: TemplateInput) => string> = {
  es: ({ propertyName, propertyLink }) =>
    [
      `¡Hola! Gracias por reservar ${propertyName}.`,
      `Aquí está la guía de la casa, con la llegada, el wifi, las normas y recomendaciones: ${propertyLink}`,
      "Se abre en el navegador, sin descargar nada ni crear una cuenta.",
      "Te enviaremos por este chat los datos de acceso antes de tu llegada.",
      "Si tienes cualquier pregunta, escríbenos aquí.",
    ].join("\n\n"),
  en: ({ propertyName, propertyLink }) =>
    [
      `Hi! Thanks for booking ${propertyName}.`,
      `Here is the house guide, with arrival, Wi-Fi, house rules, and tips: ${propertyLink}`,
      "It opens in your browser, with nothing to download and no account to create.",
      "We'll send your access details in this chat before you arrive.",
      "If you have any questions, message us here.",
    ].join("\n\n"),
};

/** For OTA scheduled messages sent after the booking is confirmed (PC-05): property link only. */
export function scheduledMessageTemplate(language: MessageLanguage, input: TemplateInput): string {
  return TEMPLATE[language](input);
}

export interface StayMessageInput {
  propertyName: string;
  stayLink: string;
  checkInDate: string;
  checkoutDate: string;
  checkInTime: string | null;
  checkoutTime: string | null;
  address: string | null;
  /** The published Arrival section as plain text, locked fields already resolved or labeled. */
  arrival: string | null;
  /** The published Wi-Fi section as plain text, locked fields already resolved or labeled. */
  wifi: string | null;
  confirmationCode: string | null;
}

function formatDate(date: string, language: MessageLanguage): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

/** How a locked field reads in a message without values (FR-040). */
export function lockedFieldPlaceholder(label: string, language: MessageLanguage): string {
  return language === "es"
    ? `${label} (lo ves en tu enlace de estadía)`
    : `${label} (shown in your stay link)`;
}

/** The ready-to-paste message for one stay (FR-039). */
export function stayMessage(language: MessageLanguage, input: StayMessageInput): string {
  const es = language === "es";
  const checkIn = `${formatDate(input.checkInDate, language)}${input.checkInTime ? `, ${input.checkInTime}` : ""}`;
  const checkout = `${formatDate(input.checkoutDate, language)}${input.checkoutTime ? `, ${input.checkoutTime}` : ""}`;
  const parts: string[] = [
    es
      ? `¡Hola! Todo listo para tu estadía en ${input.propertyName}.`
      : `Hi! Everything is ready for your stay at ${input.propertyName}.`,
    es ? `Llegada: ${checkIn}\nSalida: ${checkout}` : `Check-in: ${checkIn}\nCheckout: ${checkout}`,
  ];
  if (input.address) parts.push(es ? `Dirección: ${input.address}` : `Address: ${input.address}`);
  if (input.arrival) parts.push(`${es ? "Cómo llegar y entrar" : "Getting in"}:\n${input.arrival}`);
  if (input.wifi) parts.push(`Wi-Fi:\n${input.wifi}`);
  parts.push(
    es
      ? `Tu guía de la casa, con los códigos de acceso durante tu estadía: ${input.stayLink}`
      : `Your house guide, with the access codes during your stay: ${input.stayLink}`,
  );
  if (input.confirmationCode) {
    parts.push(
      es
        ? `Código de confirmación para ver los códigos: ${input.confirmationCode}`
        : `Confirmation code to show the access codes: ${input.confirmationCode}`,
    );
  }
  parts.push(
    es
      ? "Usar la guía es opcional: todo lo esencial está en este mensaje. Escríbenos aquí si necesitas algo."
      : "Using the guide is optional: everything essential is in this message. Message us here if you need anything.",
  );
  return parts.join("\n\n");
}
