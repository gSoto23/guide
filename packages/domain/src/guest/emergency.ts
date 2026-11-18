/**
 * Local emergency numbers for the pilot countries (feature 004 FR-007, research R18). Reviewed with
 * pilot hosts; countries not listed show only the host's Emergency section.
 */
const EMERGENCY_NUMBERS: Readonly<Record<string, string>> = {
  CR: "911",
  US: "911",
  CA: "911",
  MX: "911",
  PA: "911",
  SV: "911",
  HN: "911",
  DO: "911",
  CO: "123",
  GT: "110",
  NI: "118",
};

export function emergencyNumberFor(country: string | null | undefined): string | null {
  if (!country) return null;
  return EMERGENCY_NUMBERS[country.toUpperCase()] ?? null;
}
