/**
 * Synthetic content for the demo workspace (feature 014 US3, research R13). Written by hand: no AI
 * runs when the demo is created. Every name, code, and place below is fictional or generic; guests
 * have first names only and no contact details. The content follows the platform rules: extras are
 * optional, nothing asks for a deposit, and nothing moves a booking or its payment off the platform.
 */
export type DemoLanguage = "es" | "en";

/** A text block: a paragraph, or a bulleted list. `{door}` and `{wifi}` mark the locked fields. */
export type DemoBlock = string | { list: string[] };

export interface DemoItem {
  topics?: string[];
  texts: Record<DemoLanguage, DemoBlock[]>;
}

export type DemoSectionKind =
  | "arrival"
  | "wifi"
  | "house_rules"
  | "appliances"
  | "amenities"
  | "parking"
  | "local_recommendations"
  | "emergency"
  | "checkout";

export interface DemoExtra {
  name: Record<DemoLanguage, string>;
  description: Record<DemoLanguage, string>;
  price: number;
  /** Per day for rentals; per stay otherwise. */
  needsDate: boolean;
  maxPerStay: number;
}

export interface DemoProperty {
  key: "brisa" | "loft";
  name: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  timeZone: string;
  checkInTime: string;
  checkoutTime: string;
  maxGuests: number;
  /** Fictional; stored only as vault ciphertext. */
  doorCode: string;
  wifiNetwork: string;
  /**
   * Shown to every guest by design (the schema allows a public Wi-Fi value). A neutral placeholder,
   * not a password-like literal, so secret scanners stay quiet (lesson from spec 004).
   */
  wifiShown: string;
  sections: Partial<Record<DemoSectionKind, DemoItem[]>>;
  extras: DemoExtra[];
  /** Busier properties get more guest questions a day. */
  questionsPerDay: number;
}

export const DEMO_GUEST_NAMES = [
  "Emily",
  "Lucas",
  "Sofía",
  "Daniel",
  "Mariana",
  "Noah",
  "Valeria",
  "Liam",
  "Camila",
  "Ethan",
  "Isabella",
  "Mateo",
] as const;

const PICKUP: Record<DemoLanguage, string> = {
  es: "Traslado al aeropuerto",
  en: "Airport pickup",
};
const CLEANING: Record<DemoLanguage, string> = { es: "Limpieza extra", en: "Extra cleaning" };

export const DEMO_PROPERTIES: readonly DemoProperty[] = [
  {
    key: "brisa",
    name: "Casa Brisa",
    addressLine1: "150 m norte del supermercado, portón de madera número 12",
    city: "Santa Teresa",
    region: "Puntarenas",
    postalCode: "60111",
    timeZone: "America/Costa_Rica",
    checkInTime: "15:00",
    checkoutTime: "11:00",
    maxGuests: 6,
    doorCode: "4821",
    wifiNetwork: "CasaBrisa-5G",
    wifiShown: "DEMO-1111",
    questionsPerDay: 4,
    sections: {
      arrival: [
        {
          topics: ["arrival", "access"],
          texts: {
            es: [
              "La casa está en la calle principal de Santa Teresa, 150 m al norte del supermercado: un portón de madera con el número 12.",
              "El código de la puerta es {door}. Escríbelo en el teclado junto al portón y empuja.",
              "Si llegas de noche, la luz de la entrada se enciende sola al acercarte.",
            ],
            en: [
              "The house is on Santa Teresa's main road, 150 m north of the supermarket: a wooden gate with the number 12.",
              "The door code is {door}. Enter it on the keypad next to the gate and push.",
              "If you arrive at night, the entrance light turns on by itself as you get close.",
            ],
          },
        },
      ],
      wifi: [
        {
          topics: ["wifi"],
          texts: {
            es: [
              "Red: CasaBrisa-5G",
              "Contraseña: {wifi}",
              "El router está en la sala, junto al televisor. Si la señal se cae, desconéctalo 30 segundos.",
            ],
            en: [
              "Network: CasaBrisa-5G",
              "Password: {wifi}",
              "The router is in the living room, next to the TV. If the signal drops, unplug it for 30 seconds.",
            ],
          },
        },
      ],
      house_rules: [
        {
          topics: ["parties", "quiet_hours", "smoking", "pets"],
          texts: {
            es: [
              {
                list: [
                  "No se permiten fiestas ni eventos.",
                  "Horas de silencio de 22:00 a 7:00.",
                  "No se fuma dentro de la casa.",
                  "Mascotas bajo consulta con el anfitrión.",
                ],
              },
            ],
            en: [
              {
                list: [
                  "No parties or events.",
                  "Quiet hours from 10 p.m. to 7 a.m.",
                  "No smoking inside the house.",
                  "Pets only after checking with the host.",
                ],
              },
            ],
          },
        },
      ],
      appliances: [
        {
          topics: ["air_conditioning", "coffee"],
          texts: {
            es: [
              "Cada cuarto tiene aire acondicionado. El control está en la mesa de noche: usa el modo «Cool» a 24 °C.",
              "La cafetera usa café molido; los filtros están en la gaveta de arriba del fregadero.",
            ],
            en: [
              "Each bedroom has air conditioning. The remote is on the nightstand: use Cool mode at 24 °C.",
              "The coffee maker takes ground coffee; filters are in the drawer above the sink.",
            ],
          },
        },
      ],
      amenities: [
        {
          topics: ["pool", "towels", "bbq"],
          texts: {
            es: [
              {
                list: [
                  "Piscina pequeña, sin salvavidas.",
                  "Toallas de playa en el armario del pasillo.",
                  "Parrilla de gas en la terraza.",
                  "Dos tablas de surf para principiantes en la bodega.",
                ],
              },
            ],
            en: [
              {
                list: [
                  "Small pool, no lifeguard.",
                  "Beach towels in the hallway closet.",
                  "Gas grill on the terrace.",
                  "Two beginner surfboards in the storage room.",
                ],
              },
            ],
          },
        },
      ],
      parking: [
        {
          topics: ["parking"],
          texts: {
            es: ["Hay espacio para dos carros dentro del portón."],
            en: ["There is room for two cars inside the gate."],
          },
        },
      ],
      local_recommendations: [
        {
          topics: ["beach", "food"],
          texts: {
            es: [
              "La playa está a 3 minutos caminando por el sendero frente a la casa.",
              "Para comer cerca: la soda de la esquina sirve casado típico al mediodía, y la panadería del pueblo abre a las 6:00.",
            ],
            en: [
              "The beach is a 3-minute walk down the path in front of the house.",
              "To eat nearby: the corner soda serves a traditional casado at lunch, and the village bakery opens at 6 a.m.",
            ],
          },
        },
      ],
      emergency: [
        {
          topics: ["emergency_number", "medical"],
          texts: {
            es: [
              "En una emergencia llama al 911.",
              "El centro de salud más cercano está en Cóbano, a unos 15 minutos en carro.",
            ],
            en: [
              "In an emergency, call 911.",
              "The nearest health center is in Cóbano, about 15 minutes by car.",
            ],
          },
        },
      ],
      checkout: [
        {
          topics: ["checkout_steps"],
          texts: {
            es: [
              {
                list: [
                  "Salida hasta las 11:00.",
                  "Deja los platos en el fregadero; no hace falta lavarlos.",
                  "Saca la basura al basurero de la entrada.",
                  "Cierra el portón al salir.",
                ],
              },
            ],
            en: [
              {
                list: [
                  "Checkout by 11 a.m.",
                  "Leave the dishes in the sink; no need to wash them.",
                  "Take the trash to the bin at the entrance.",
                  "Close the gate when you leave.",
                ],
              },
            ],
          },
        },
      ],
    },
    extras: [
      {
        name: PICKUP,
        description: {
          es: "Te recogemos en el aeropuerto y te traemos a la casa. Coordina la hora con tu anfitrión.",
          en: "We pick you up at the airport and bring you to the house. Arrange the time with your host.",
        },
        price: 85,
        needsDate: true,
        maxPerStay: 2,
      },
      {
        name: CLEANING,
        description: {
          es: "Una limpieza completa durante tu estadía, con cambio de sábanas y toallas.",
          en: "A full cleaning during your stay, with fresh sheets and towels.",
        },
        price: 35,
        needsDate: true,
        maxPerStay: 3,
      },
      {
        name: { es: "Alquiler de tabla de surf", en: "Surfboard rental" },
        description: {
          es: "Tabla de 8 pies con correa, por día. Ideal para principiantes.",
          en: "An 8-foot board with a leash, per day. Good for beginners.",
        },
        price: 15,
        needsDate: true,
        maxPerStay: 7,
      },
    ],
  },
  {
    key: "loft",
    name: "Loft Escazú",
    addressLine1: "Condominio Las Colinas, torre B, apartamento 7",
    city: "Escazú",
    region: "San José",
    postalCode: "10201",
    timeZone: "America/Costa_Rica",
    checkInTime: "14:00",
    checkoutTime: "11:00",
    maxGuests: 3,
    doorCode: "7395",
    wifiNetwork: "LoftEscazu",
    wifiShown: "DEMO-2222",
    questionsPerDay: 2,
    sections: {
      arrival: [
        {
          topics: ["arrival", "access"],
          texts: {
            es: [
              "Muestra tu nombre en la caseta del condominio; el guarda tiene la lista de llegadas.",
              "Sube a la torre B, piso 2. El código de la puerta del apartamento 7 es {door}.",
            ],
            en: [
              "Give your name at the condominium gatehouse; the guard has the arrivals list.",
              "Go up to tower B, floor 2. The code for apartment 7's door is {door}.",
            ],
          },
        },
      ],
      wifi: [
        {
          topics: ["wifi"],
          texts: {
            es: ["Red: LoftEscazu", "Contraseña: {wifi}"],
            en: ["Network: LoftEscazu", "Password: {wifi}"],
          },
        },
      ],
      house_rules: [
        {
          topics: ["quiet_hours", "smoking", "visitors"],
          texts: {
            es: [
              {
                list: [
                  "Horas de silencio del condominio: de 22:00 a 7:00.",
                  "No se fuma en el apartamento ni en los balcones.",
                  "Las visitas se registran en la caseta.",
                ],
              },
            ],
            en: [
              {
                list: [
                  "Condominium quiet hours: 10 p.m. to 7 a.m.",
                  "No smoking in the apartment or on the balcony.",
                  "Visitors sign in at the gatehouse.",
                ],
              },
            ],
          },
        },
      ],
      appliances: [
        {
          topics: ["washer"],
          texts: {
            es: ["La lavadora está en el cuarto de pilas; el detergente está en el estante."],
            en: ["The washer is in the laundry room; detergent is on the shelf."],
          },
        },
      ],
      amenities: [
        {
          topics: ["gym", "pool"],
          texts: {
            es: [
              { list: ["Gimnasio del condominio de 6:00 a 21:00.", "Piscina en el primer piso."] },
            ],
            en: [{ list: ["Condominium gym from 6 a.m. to 9 p.m.", "Pool on the ground floor."] }],
          },
        },
      ],
      parking: [
        {
          topics: ["parking"],
          texts: {
            es: ["Tu espacio es el número 14 del sótano."],
            en: ["Your spot is number 14 in the basement."],
          },
        },
      ],
      local_recommendations: [
        {
          topics: ["food", "shopping"],
          texts: {
            es: [
              "Hay un centro comercial con supermercado a 5 minutos en carro, y varias cafeterías en la calle principal.",
            ],
            en: [
              "There is a mall with a supermarket 5 minutes away by car, and several cafés on the main street.",
            ],
          },
        },
      ],
      emergency: [
        {
          topics: ["emergency_number"],
          texts: {
            es: ["En una emergencia llama al 911. La caseta del condominio atiende las 24 horas."],
            en: ["In an emergency, call 911. The condominium gatehouse is staffed 24 hours."],
          },
        },
      ],
      checkout: [
        {
          topics: ["checkout_steps"],
          texts: {
            es: [{ list: ["Salida hasta las 11:00.", "Deja la tarjeta del parqueo en la mesa."] }],
            en: [{ list: ["Checkout by 11 a.m.", "Leave the parking card on the table."] }],
          },
        },
      ],
    },
    extras: [
      {
        name: PICKUP,
        description: {
          es: "Te recogemos en el aeropuerto internacional y te traemos al condominio.",
          en: "We pick you up at the international airport and bring you to the condominium.",
        },
        price: 40,
        needsDate: true,
        maxPerStay: 2,
      },
      {
        name: CLEANING,
        description: {
          es: "Una limpieza completa durante tu estadía, con cambio de sábanas.",
          en: "A full cleaning during your stay, with fresh sheets.",
        },
        price: 35,
        needsDate: true,
        maxPerStay: 3,
      },
    ],
  },
];

/**
 * Guest questions by scenario, in both languages, with what the assistant did (the analytics
 * outcome). Topics and reasons use the product's values (spec 007, spec 010).
 */
export interface DemoQuestion {
  topic: string;
  decision: "answered" | "pointer" | "drafted" | "held";
  reason: string | null;
  weight: number;
  question: Record<DemoLanguage, string>;
  /** The assistant's reply, or its holding message when the question went to the host. */
  reply: Record<DemoLanguage, string>;
}

const HOLDING: Record<DemoLanguage, string> = {
  es: "Le pasé tu mensaje a tu anfitrión, que te responderá pronto.",
  en: "I passed your message to your host, who will reply soon.",
};

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  {
    topic: "wifi",
    decision: "answered",
    reason: null,
    weight: 6,
    question: { es: "¿Cuál es la clave del wifi?", en: "What's the Wi-Fi password?" },
    reply: {
      es: "La red y la contraseña están en la sección Wi-Fi de la guía.",
      en: "The network and password are in the guide's Wi-Fi section.",
    },
  },
  {
    topic: "arrival",
    decision: "answered",
    reason: null,
    weight: 5,
    question: { es: "¿A qué hora podemos llegar?", en: "What time can we arrive?" },
    reply: {
      es: "Puedes llegar desde la hora de entrada que indica la guía.",
      en: "You can arrive from the check-in time shown in the guide.",
    },
  },
  {
    topic: "appliances",
    decision: "answered",
    reason: null,
    weight: 3,
    question: { es: "¿Cómo enciendo el aire acondicionado?", en: "How do I turn on the AC?" },
    reply: {
      es: "El control está en la mesa de noche: usa el modo «Cool» a 24 °C.",
      en: "The remote is on the nightstand: use Cool mode at 24 °C.",
    },
  },
  {
    topic: "amenities",
    decision: "answered",
    reason: null,
    weight: 3,
    question: { es: "¿Hay toallas de playa?", en: "Are there beach towels?" },
    reply: {
      es: "Sí, están en el armario del pasillo.",
      en: "Yes, they're in the hallway closet.",
    },
  },
  {
    topic: "parking",
    decision: "answered",
    reason: null,
    weight: 2,
    question: { es: "¿Dónde podemos parquear?", en: "Where can we park?" },
    reply: {
      es: "El parqueo está explicado en la sección Parqueo de la guía.",
      en: "Parking is explained in the guide's Parking section.",
    },
  },
  {
    topic: "local_recommendations",
    decision: "pointer",
    reason: null,
    weight: 3,
    question: { es: "¿Qué tours recomiendan?", en: "Which tours do you recommend?" },
    reply: {
      es: "En Explorar de la guía tienes recomendaciones y tours cerca de la casa.",
      en: "Explore in the guide has recommendations and tours near the house.",
    },
  },
  {
    topic: "checkout",
    decision: "answered",
    reason: null,
    weight: 2,
    question: {
      es: "¿Qué hacemos con la basura al salir?",
      en: "What do we do with the trash at checkout?",
    },
    reply: {
      es: "Sácala al basurero de la entrada; los pasos de salida están en la guía.",
      en: "Take it to the bin at the entrance; the checkout steps are in the guide.",
    },
  },
  {
    topic: "house_rules",
    decision: "drafted",
    reason: "draft_ready",
    weight: 2,
    question: { es: "¿Podemos traer a nuestro perro?", en: "Can we bring our dog?" },
    reply: HOLDING,
  },
  {
    topic: "checkout",
    decision: "held",
    reason: "reservation_change",
    weight: 2,
    question: { es: "¿Podemos salir a las 2 de la tarde?", en: "Can we check out at 2 p.m.?" },
    reply: HOLDING,
  },
  {
    topic: "appliances",
    decision: "held",
    reason: "malfunction",
    weight: 1,
    question: {
      es: "La ducha del baño principal no tiene agua caliente.",
      en: "The main bathroom shower has no hot water.",
    },
    reply: HOLDING,
  },
  {
    topic: "other",
    decision: "held",
    reason: "complaint",
    weight: 1,
    question: {
      es: "Hay mucho ruido de una construcción cerca.",
      en: "There's a lot of noise from construction nearby.",
    },
    reply: HOLDING,
  },
  {
    topic: "other",
    decision: "held",
    reason: "money",
    weight: 1,
    question: {
      es: "¿Me pueden hacer una factura de la estadía?",
      en: "Can you send me an invoice for the stay?",
    },
    reply: HOLDING,
  },
  {
    topic: "emergency",
    decision: "held",
    reason: "emergency",
    weight: 0.3,
    question: {
      es: "Hay una fuga de agua en la cocina, ¿qué hago?",
      en: "There's a water leak in the kitchen, what do I do?",
    },
    reply: {
      es: "Si hay peligro, llama al 911. Ya avisé a tu anfitrión.",
      en: "If there is danger, call 911. I've already told your host.",
    },
  },
  {
    topic: "other",
    decision: "held",
    reason: "not_confident",
    weight: 1.5,
    question: {
      es: "¿Tienen un adaptador de enchufe para Europa?",
      en: "Do you have a plug adapter for Europe?",
    },
    reply: HOLDING,
  },
];

/** The open escalation waiting in the inbox (FR-024). */
export const DEMO_OPEN_ESCALATION = {
  topic: "appliances",
  reason: "malfunction",
  question: {
    es: "El aire acondicionado del cuarto principal no enfría.",
    en: "The air conditioning in the main bedroom isn't cooling.",
  },
  reply: HOLDING,
  draft: {
    es: "Lamento la molestia. Voy a mandar al técnico hoy mismo; mientras tanto, el cuarto de visitas tiene el aire funcionando.",
    en: "Sorry for the trouble. I'll send the technician today; meanwhile, the guest room's AC is working.",
  },
} as const;

/** Partner refs for Explore click counts (the format the schema checks). */
export const DEMO_EXPERIENCE_REFS = [
  { partner: "viator", ref: "viator-demo-surf-lesson" },
  { partner: "viator", ref: "viator-demo-waterfall-tour" },
  { partner: "civitatis", ref: "civitatis-demo-sunset-cruise" },
] as const;
