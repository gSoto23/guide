import type { GuideSnapshot } from "../guides/snapshot.js";

/**
 * Suggested questions for the chat intro (feature 005 FR-003): message keys for the guest app, from
 * the guide's own sections, in order, at most four.
 */
const SUGGESTION_BY_KIND: Record<string, string> = {
  arrival: "arrival",
  wifi: "wifi",
  checkout: "checkout",
  house_rules: "house_rules",
  parking: "parking",
  appliances: "appliances",
  local_recommendations: "local_recommendations",
  amenities: "amenities",
};

export function suggestionKeys(snapshot: GuideSnapshot, limit = 4): string[] {
  const keys: string[] = [];
  for (const section of snapshot.sections) {
    const key = SUGGESTION_BY_KIND[section.kind];
    if (key && section.items.length > 0 && !keys.includes(key)) keys.push(key);
    if (keys.length === limit) break;
  }
  return keys;
}
