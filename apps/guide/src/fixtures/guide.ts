import type { GuestGuide } from "@guidesk/contracts";

/**
 * A fictional guide for Lighthouse CI and local design work (feature 004 research R19). Served
 * only when GUIDE_FIXTURES=true, which no deployed stage sets.
 */
export const FIXTURE_PUBLIC_ID = "demoguidedemoguidedemoguid";

const paragraph = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});

const COPY = {
  es: {
    arrival: "Desde la entrada principal, sigue el camino de piedra hasta la puerta azul.",
    lockbox: "La caja de llaves está a la derecha de la puerta. Ábrela con ",
    wifi: "Red: CasaDemo.",
    rules: "Hora de silencio desde las 10 pm. No se permiten fiestas ni mascotas.",
    appliances:
      "La cafetera está sobre la encimera. Llénala con agua filtrada y presiona el botón verde.",
    checkout: "Deja las llaves en la caja, apaga el aire acondicionado y saca la basura.",
    emergency: "Clínica más cercana: a 10 minutos en carro, en el centro del pueblo.",
  },
  en: {
    arrival: "From the main entrance, follow the stone path to the blue door.",
    lockbox: "The lockbox is to the right of the door. Open it with ",
    wifi: "Network: CasaDemo.",
    rules: "Quiet hours start at 10 pm. No parties or pets.",
    appliances:
      "The coffee maker is on the counter. Fill it with filtered water and press the green button.",
    checkout:
      "Leave the keys in the lockbox, turn off the air conditioning, and take out the trash.",
    emergency: "Nearest clinic: 10 minutes by car, in the town center.",
  },
};

export function fixtureGuide(publicId: string, language: "es" | "en"): GuestGuide | null {
  if (publicId !== FIXTURE_PUBLIC_ID) return null;
  const copy = COPY[language];
  const text = (id: string, value: string) => ({
    id,
    kind: "text" as const,
    language,
    translated: true,
    doc: paragraph(value),
  });
  return {
    publicId,
    language,
    languages: ["es", "en"],
    primaryLanguage: "es",
    propertyName: "Casa Demo",
    timeZone: "America/Costa_Rica",
    country: "CR",
    emergencyNumber: "911",
    facts: {
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
      address: "Calle Ficticia 1, Sámara",
    },
    publishedAt: "2026-11-17T20:00:00.000Z",
    sections: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "arrival",
        title: null,
        items: [
          text("00000000-0000-4000-8000-000000000101", copy.arrival),
          {
            id: "00000000-0000-4000-8000-000000000102",
            kind: "text",
            language,
            translated: true,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: copy.lockbox },
                    {
                      type: "lockedField",
                      attrs: { fieldId: "00000000-0000-4000-8000-0000000000f1" },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        kind: "wifi",
        title: null,
        items: [text("00000000-0000-4000-8000-000000000201", copy.wifi)],
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "house_rules",
        title: null,
        items: [text("00000000-0000-4000-8000-000000000301", copy.rules)],
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        kind: "appliances",
        title: null,
        items: [text("00000000-0000-4000-8000-000000000401", copy.appliances)],
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        kind: "emergency",
        title: null,
        items: [text("00000000-0000-4000-8000-000000000501", copy.emergency)],
      },
      {
        id: "00000000-0000-4000-8000-000000000006",
        kind: "checkout",
        title: null,
        items: [text("00000000-0000-4000-8000-000000000601", copy.checkout)],
      },
    ],
    lockedFields: [
      {
        id: "00000000-0000-4000-8000-0000000000f1",
        kind: "lockbox_code",
        label: language === "es" ? "Código de la caja" : "Lockbox code",
        set: true,
      },
    ],
    wifi: { fieldId: null, password: null },
  };
}
