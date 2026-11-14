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
