/**
 * Fails when a generated zone is missing from this runtime's `Intl.supportedValuesOf("timeZone")`
 * (research R11, T038). Runs in CI as `pnpm --filter @guidesk/domain tz:check`.
 */
import { CITY_ZONES, COUNTRY_ZONES } from "../src/properties/time-zone-data.ts";

const supported = new Set(Intl.supportedValuesOf("timeZone"));
// ICU lists some canonical zones under older names (Asia/Calcutta for Asia/Kolkata), so a zone
// Intl can format counts as supported.
function known(zone: string): boolean {
  if (supported.has(zone)) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const zones = new Set<string>([
  ...Object.values(COUNTRY_ZONES).flat(),
  ...Object.values(CITY_ZONES).flatMap((table) => Object.keys(table)),
]);
const missing = [...zones].filter((zone) => !known(zone)).sort();
if (missing.length > 0) {
  console.error(`Time zones missing from this runtime: ${missing.join(", ")}`);
  process.exit(1);
}
console.warn(`All ${zones.size} generated time zones are supported by this runtime.`);
