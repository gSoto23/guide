import type { OnboardingPath, PmsOption } from "../onboarding.js";

/**
 * "Add property" starting options (FR-008). The onboarding answers from spec 001 decide which one
 * is recommended and shown first.
 */
export const START_OPTIONS = ["listing", "pms", "csv", "duplicate", "blank"] as const;
export type StartOption = (typeof START_OPTIONS)[number];

/** PMS providers this feature can import from (research R7). */
export const SUPPORTED_PMS = ["beds24", "hostex"] as const;
export type SupportedPms = (typeof SUPPORTED_PMS)[number];

export interface StartOptionsInput {
  /** The host's path from the onboarding answers (`derivePath`). */
  path: OnboardingPath;
  /** The PMS the host named during onboarding, if any. */
  pms: PmsOption | null;
  /** Providers whose feature flag is on (OQ-26). A provider whose flag is off is never offered. */
  enabledProviders: readonly SupportedPms[];
  /** Copying needs an existing property. */
  hasProperties: boolean;
  /** Paths that exist in this build. */
  available: readonly StartOption[];
}

export interface OrderedStartOption {
  option: StartOption;
  recommended: boolean;
}

function isSupported(pms: PmsOption | null): pms is SupportedPms {
  return pms === "beds24" || pms === "hostex";
}

/**
 * Orders the options with the recommended one first: the PMS import when the host named a
 * supported PMS that is enabled; CSV for managers otherwise; listing text for individual hosts.
 * Blank is always last.
 */
export function orderStartOptions(input: StartOptionsInput): OrderedStartOption[] {
  const pmsOffered = input.enabledProviders.length > 0;
  const namedPms = isSupported(input.pms) && input.enabledProviders.includes(input.pms);
  let order: StartOption[];
  if (namedPms) order = ["pms", "listing", "csv", "duplicate", "blank"];
  else if (input.path === "manager") order = ["csv", "listing", "pms", "duplicate", "blank"];
  else order = ["listing", "pms", "csv", "duplicate", "blank"];

  return order
    .filter((option) => input.available.includes(option))
    .filter((option) => option !== "pms" || pmsOffered)
    .filter((option) => option !== "duplicate" || input.hasProperties)
    .map((option, index) => ({ option, recommended: index === 0 }));
}
