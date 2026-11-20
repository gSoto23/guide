import * as icons from "./data.js";
import type { IconData } from "./data.js";

/** Every icon by name, for server-side code that picks an icon from data (research R3). */
export const ICONS = {
  door: icons.door,
  wifi: icons.wifi,
  rules: icons.rules,
  appliance: icons.appliance,
  amenity: icons.amenity,
  car: icons.car,
  pin: icons.pin,
  emergency: icons.emergency,
  checkout: icons.checkout,
  gift: icons.gift,
  compass: icons.compass,
  bookmark: icons.bookmark,
  inbox: icons.inbox,
  bag: icons.bag,
  house: icons.house,
  chart: icons.chart,
  layers: icons.layers,
  people: icons.people,
  sliders: icons.sliders,
  more: icons.more,
  wrench: icons.wrench,
  frown: icons.frown,
  coin: icons.coin,
  calendar: icons.calendar,
  scale: icons.scale,
  question: icons.question,
  pencil: icons.pencil,
  shield: icons.shield,
  gauge: icons.gauge,
  cloudOff: icons.cloudOff,
  person: icons.person,
  plus: icons.plus,
  message: icons.message,
  copy: icons.copy,
  key: icons.key,
  chat: icons.chat,
  phone: icons.phone,
  globe: icons.globe,
  chevron: icons.chevron,
  external: icons.external,
  check: icons.check,
  clock: icons.clock,
  lock: icons.lock,
  link: icons.link,
  qr: icons.qr,
} as const satisfies Record<string, IconData>;

export type IconName = keyof typeof ICONS;

/** The icon of each guide section kind, plus the Extras and Explore entries (spec FR-014). */
export const SECTION_ICONS = {
  arrival: "door",
  wifi: "wifi",
  house_rules: "rules",
  appliances: "appliance",
  amenities: "amenity",
  parking: "car",
  local_recommendations: "pin",
  emergency: "emergency",
  checkout: "checkout",
  custom: "bookmark",
  extras: "gift",
  explore: "compass",
} as const satisfies Record<string, IconName>;

/** The icon of each reason a conversation needs the host (spec FR-014). */
export const REASON_ICONS = {
  emergency: "emergency",
  malfunction: "wrench",
  complaint: "frown",
  money: "coin",
  reservation_change: "calendar",
  legal: "scale",
  not_confident: "question",
  draft_ready: "pencil",
  check_failed: "shield",
  limit: "gauge",
  monthly_limit: "gauge",
  unavailable: "cloudOff",
  taken_over: "person",
} as const satisfies Record<string, IconName>;

/** The icon for a section kind, with the custom icon for anything unknown. */
export function sectionIcon(kind: string): IconData {
  const name = (SECTION_ICONS as Record<string, IconName>)[kind] ?? "bookmark";
  return ICONS[name];
}

/** The icon for a needs-host reason, with the question icon for anything unknown. */
export function reasonIcon(reason: string): IconData {
  const name = (REASON_ICONS as Record<string, IconName>)[reason] ?? "question";
  return ICONS[name];
}
