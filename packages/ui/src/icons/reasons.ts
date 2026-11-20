import {
  calendar,
  cloudOff,
  coin,
  emergency,
  frown,
  gauge,
  pencil,
  person,
  question,
  scale,
  shield,
  wrench,
  type IconData,
} from "./data.js";

/**
 * The icon of each reason a conversation needs the host (feature 015 FR-014). Kept apart from the
 * full registry so the inbox bundle carries only these icons (research R3).
 */
export const REASON_ICON_DATA: Record<string, IconData> = {
  emergency,
  malfunction: wrench,
  complaint: frown,
  money: coin,
  reservation_change: calendar,
  legal: scale,
  not_confident: question,
  draft_ready: pencil,
  check_failed: shield,
  limit: gauge,
  monthly_limit: gauge,
  unavailable: cloudOff,
  taken_over: person,
};

/** The icon for a needs-host reason, with the question icon for anything unknown. */
export function reasonIconData(reason: string): IconData {
  return REASON_ICON_DATA[reason] ?? question;
}
