import {
  appliance,
  amenity,
  bookmark,
  car,
  checkout,
  compass,
  door,
  emergency,
  gift,
  pin,
  rules,
  wifi,
  type IconData,
} from "./data.js";

/**
 * The icon of each guide section kind, plus Extras and Explore (feature 015 FR-014). Kept apart
 * from the full registry so client bundles carry only these icons (research R3).
 */
export const SECTION_ICON_DATA: Record<string, IconData> = {
  arrival: door,
  wifi,
  house_rules: rules,
  appliances: appliance,
  amenities: amenity,
  parking: car,
  local_recommendations: pin,
  emergency,
  checkout,
  custom: bookmark,
  extras: gift,
  explore: compass,
};

/** The icon for a section kind, with the custom-section icon for anything unknown. */
export function sectionIconData(kind: string): IconData {
  return SECTION_ICON_DATA[kind] ?? bookmark;
}
