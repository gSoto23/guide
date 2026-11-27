import type { RestrictedValueKind } from "../properties/restricted-values.js";
import type { DefaultSectionKind, FactKey } from "./template.js";

/**
 * Key topics of the default sections (feature 003 FR-029, research R10): what guests ask about
 * most, weighted from 1 to 5. The list starts from Guidesk's desk research of the questions guests
 * send most often (arrival and access, Wi-Fi, checkout, parking, air conditioning and hot water,
 * groceries and restaurants) and is revised with real guest questions once spec 005 runs.
 *
 * Every topic has one or more coverage rules; a topic is covered when any rule matches, when an
 * item tags it, or when the host marks it. The rules are deterministic, so the score needs no AI
 * call and keeps working at the daily AI limit (FR-031).
 */
export type TopicRule =
  /** Keyword families matched on the section's text, in any language, ignoring case and accents. */
  | { kind: "keywords"; words: readonly string[] }
  /** A set locked field of one of these kinds, without revealing it. */
  | { kind: "lockedField"; fieldKinds: readonly RestrictedValueKind[] }
  /** An image or video in the section. */
  | { kind: "media"; mediaKinds: readonly ("image" | "video")[] }
  /** At least `min` recommendations in the section. */
  | { kind: "recommendations"; min: number }
  /** A recommendation with the host's own tip (FR-03.10). */
  | { kind: "personalTip" }
  /** A core fact that is set. */
  | { kind: "fact"; factKey: FactKey }
  /** Any text item with text. */
  | { kind: "anyText" };

export interface GuideTopic {
  id: string;
  section: DefaultSectionKind;
  /** How often guests ask about it, from 1 to 5. */
  weight: 1 | 2 | 3 | 4 | 5;
  rules: readonly TopicRule[];
  /** A code topic: the interview opens the locked-field form instead of asking (FR-038). */
  lockedFieldKind?: RestrictedValueKind;
}

const keywords = (...words: string[]): TopicRule => ({ kind: "keywords", words });

export const GUIDE_TOPICS: readonly GuideTopic[] = [
  // Arrival and access
  {
    id: "arrival.check_in_time",
    section: "arrival",
    weight: 5,
    rules: [{ kind: "fact", factKey: "check_in_time" }],
  },
  {
    id: "arrival.access_steps",
    section: "arrival",
    weight: 5,
    rules: [
      keywords(
        "entrar",
        "entrada",
        "acceso",
        "llave",
        "llaves",
        "cerradura",
        "teclado",
        "porton",
        "recepcion",
        "check-in",
        "autoservicio",
        "enter",
        "entry",
        "access",
        "key",
        "keys",
        "lock",
        "keypad",
        "front desk",
        "self check-in",
        "get in",
      ),
    ],
  },
  {
    id: "arrival.access_code",
    section: "arrival",
    weight: 4,
    rules: [{ kind: "lockedField", fieldKinds: ["door_code", "gate_code", "lockbox_code"] }],
    lockedFieldKind: "lockbox_code",
  },
  {
    id: "arrival.access_photo",
    section: "arrival",
    weight: 3,
    rules: [{ kind: "media", mediaKinds: ["image", "video"] }],
  },
  {
    id: "arrival.directions",
    section: "arrival",
    weight: 3,
    rules: [
      keywords(
        "como llegar",
        "direcciones",
        "indicaciones",
        "waze",
        "google maps",
        "mapa",
        "gps",
        "desde el aeropuerto",
        "directions",
        "how to get",
        "map",
        "from the airport",
      ),
    ],
  },
  {
    id: "arrival.early_check_in",
    section: "arrival",
    weight: 2,
    rules: [
      keywords(
        "check-in temprano",
        "llegada temprana",
        "llegar antes",
        "maletas",
        "equipaje",
        "early check-in",
        "arrive early",
        "luggage",
        "bags",
      ),
    ],
  },
  // Wi-Fi
  {
    id: "wifi.network",
    section: "wifi",
    weight: 4,
    rules: [keywords("red", "wifi", "wi-fi", "ssid", "network")],
  },
  {
    id: "wifi.password",
    section: "wifi",
    weight: 5,
    rules: [{ kind: "lockedField", fieldKinds: ["wifi_password"] }],
    lockedFieldKind: "wifi_password",
  },
  {
    id: "wifi.troubleshooting",
    section: "wifi",
    weight: 2,
    rules: [
      keywords(
        "router",
        "modem",
        "reiniciar",
        "desconectar",
        "no funciona",
        "restart",
        "reboot",
        "not working",
        "unplug",
      ),
    ],
  },
  // House rules
  {
    id: "house_rules.quiet_hours",
    section: "house_rules",
    weight: 3,
    rules: [
      keywords("silencio", "ruido", "horas de descanso", "musica", "quiet", "noise", "music"),
    ],
  },
  {
    id: "house_rules.smoking",
    section: "house_rules",
    weight: 3,
    rules: [keywords("fumar", "cigarro", "smoking", "smoke", "cigarette", "vape")],
  },
  {
    id: "house_rules.pets",
    section: "house_rules",
    weight: 3,
    rules: [
      keywords(
        "mascotas",
        "mascota",
        "perros",
        "gatos",
        "animales",
        "pets",
        "pet",
        "dogs",
        "cats",
        "animals",
      ),
    ],
  },
  {
    id: "house_rules.parties",
    section: "house_rules",
    weight: 3,
    rules: [keywords("fiestas", "eventos", "visitas", "parties", "party", "events", "visitors")],
  },
  {
    id: "house_rules.max_guests",
    section: "house_rules",
    weight: 2,
    rules: [{ kind: "fact", factKey: "max_guests" }],
  },
  {
    id: "house_rules.trash",
    section: "house_rules",
    weight: 2,
    rules: [
      keywords("basura", "reciclaje", "reciclar", "trash", "garbage", "recycling", "rubbish"),
    ],
  },
  // Appliances and how-tos
  {
    id: "appliances.ac_heating",
    section: "appliances",
    weight: 5,
    rules: [
      keywords(
        "aire acondicionado",
        "a/c",
        "calefaccion",
        "control remoto",
        "termostato",
        "air conditioning",
        "air conditioner",
        "heating",
        "thermostat",
        "remote",
      ),
    ],
  },
  {
    id: "appliances.hot_water",
    section: "appliances",
    weight: 4,
    rules: [
      keywords("agua caliente", "calentador", "ducha", "hot water", "water heater", "shower"),
    ],
  },
  {
    id: "appliances.kitchen",
    section: "appliances",
    weight: 3,
    rules: [
      keywords(
        "cocina",
        "estufa",
        "horno",
        "microondas",
        "cafetera",
        "refrigeradora",
        "refri",
        "lavaplatos",
        "kitchen",
        "stove",
        "oven",
        "microwave",
        "coffee",
        "fridge",
        "dishwasher",
      ),
    ],
  },
  {
    id: "appliances.laundry",
    section: "appliances",
    weight: 3,
    rules: [
      keywords(
        "lavadora",
        "secadora",
        "lavanderia",
        "washer",
        "washing machine",
        "dryer",
        "laundry",
      ),
    ],
  },
  {
    id: "appliances.tv",
    section: "appliances",
    weight: 2,
    rules: [keywords("televisor", "television", "tv", "netflix", "streaming")],
  },
  {
    id: "appliances.how_to_media",
    section: "appliances",
    weight: 2,
    rules: [{ kind: "media", mediaKinds: ["image", "video"] }],
  },
  // Amenities
  { id: "amenities.list", section: "amenities", weight: 3, rules: [{ kind: "anyText" }] },
  {
    id: "amenities.pool_beach",
    section: "amenities",
    weight: 2,
    rules: [
      keywords(
        "piscina",
        "playa",
        "toallas de playa",
        "sombrilla",
        "pool",
        "beach",
        "beach towels",
        "umbrella",
      ),
    ],
  },
  // Parking and transport
  {
    id: "parking.where",
    section: "parking",
    weight: 4,
    rules: [
      keywords(
        "parqueo",
        "estacionamiento",
        "estacionar",
        "parquear",
        "garaje",
        "cochera",
        "parking",
        "park",
        "garage",
        "driveway",
      ),
    ],
  },
  {
    id: "parking.transport",
    section: "parking",
    weight: 3,
    rules: [
      keywords(
        "taxi",
        "uber",
        "bus",
        "autobus",
        "transporte",
        "shuttle",
        "traslado",
        "aeropuerto",
        "transport",
        "transfer",
        "airport",
      ),
    ],
  },
  // Local recommendations
  {
    id: "local.groceries",
    section: "local_recommendations",
    weight: 4,
    rules: [
      keywords(
        "supermercado",
        "super",
        "pulperia",
        "mercado",
        "minisuper",
        "supermarket",
        "grocery",
        "groceries",
        "market",
      ),
    ],
  },
  {
    id: "local.restaurants",
    section: "local_recommendations",
    weight: 4,
    rules: [
      keywords(
        "restaurante",
        "restaurantes",
        "soda",
        "comida",
        "cena",
        "desayuno",
        "restaurant",
        "restaurants",
        "food",
        "dinner",
        "breakfast",
        "cafe",
      ),
    ],
  },
  {
    id: "local.activities",
    section: "local_recommendations",
    weight: 3,
    rules: [
      keywords(
        "playa",
        "tour",
        "tours",
        "actividades",
        "surf",
        "senderismo",
        "parque nacional",
        "beach",
        "activities",
        "hike",
        "hiking",
        "national park",
      ),
    ],
  },
  {
    id: "local.recommendations",
    section: "local_recommendations",
    weight: 2,
    rules: [{ kind: "recommendations", min: 3 }],
  },
  {
    id: "local.personal_tip",
    section: "local_recommendations",
    weight: 3,
    rules: [{ kind: "personalTip" }],
  },
  // Emergency and contacts
  {
    id: "emergency.contacts",
    section: "emergency",
    weight: 5,
    rules: [
      keywords(
        "telefono",
        "whatsapp",
        "contacto",
        "llamar",
        "llamame",
        "anfitrion",
        "phone",
        "contact",
        "call",
        "host",
      ),
    ],
  },
  {
    id: "emergency.number",
    section: "emergency",
    weight: 4,
    rules: [keywords("911", "emergencia", "emergencias", "emergency", "emergencies")],
  },
  {
    id: "emergency.medical",
    section: "emergency",
    weight: 3,
    rules: [
      keywords(
        "hospital",
        "clinica",
        "farmacia",
        "ebais",
        "cruz roja",
        "clinic",
        "pharmacy",
        "red cross",
      ),
    ],
  },
  {
    id: "emergency.safety_equipment",
    section: "emergency",
    weight: 2,
    rules: [
      keywords(
        "extintor",
        "botiquin",
        "primeros auxilios",
        "salida de emergencia",
        "fire extinguisher",
        "first aid",
        "emergency exit",
      ),
    ],
  },
  // Checkout
  {
    id: "checkout.time",
    section: "checkout",
    weight: 5,
    rules: [{ kind: "fact", factKey: "checkout_time" }],
  },
  {
    id: "checkout.steps",
    section: "checkout",
    weight: 5,
    rules: [
      keywords(
        "llaves",
        "basura",
        "platos",
        "toallas",
        "luces",
        "cerrar",
        "dejar",
        "keys",
        "trash",
        "dishes",
        "towels",
        "lights",
        "lock",
        "leave",
      ),
    ],
  },
  {
    id: "checkout.late_checkout",
    section: "checkout",
    weight: 2,
    rules: [keywords("salida tardia", "late checkout", "salir mas tarde", "leave later")],
  },
];

/** Topics whose absence the publish check warns about (FR-050). */
export const ESSENTIAL_TOPICS = [
  "arrival.access_steps",
  "emergency.contacts",
  "checkout.steps",
] as const;

const TOPIC_IDS = new Set(GUIDE_TOPICS.map((topic) => topic.id));

export function isGuideTopicId(id: string): boolean {
  return TOPIC_IDS.has(id);
}

/**
 * A topic covered only by photos or videos (feature 020 FR-006): the interview offers an attach
 * button, and text drafted for it never marks it covered.
 */
export function isMediaOnlyTopic(topic: Pick<GuideTopic, "rules">): boolean {
  return topic.rules.length > 0 && topic.rules.every((rule) => rule.kind === "media");
}

/** The media kinds a media-only topic accepts. */
export function topicMediaKinds(topic: Pick<GuideTopic, "rules">): ("image" | "video")[] {
  const kinds = new Set<"image" | "video">();
  for (const rule of topic.rules) {
    if (rule.kind === "media")
      for (const kind of rule.mediaKinds) kinds.add(kind as "image" | "video");
  }
  return [...kinds];
}

export function guideTopic(id: string): GuideTopic | undefined {
  return GUIDE_TOPICS.find((topic) => topic.id === id);
}

/** Keeps only known topic IDs, without repeats (AI tags are validated against the list). */
export function validTopicIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => TOPIC_IDS.has(id)))];
}
