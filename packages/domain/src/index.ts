/** Workspace roles (spec 001, FR-016). */
export const ROLES = ["owner", "admin", "agent"] as const;
export type Role = (typeof ROLES)[number];

export * from "./security-events.js";
export * from "./onboarding.js";
export * from "./tenancy.js";
export * from "./security-policy.js";
export * from "./property-count.js";
export * from "./permissions.js";
export * from "./invitation.js";
export * from "./limits.js";
export * from "./properties/limits.js";
export * from "./properties/core-facts.js";
export * from "./properties/start-options.js";
export * from "./properties/time-zones.js";
export * from "./properties/feeds.js";
export * from "./properties/stays.js";
export * from "./jobs.js";
export * from "./properties/restricted-values.js";
export * from "./properties/extraction.js";
