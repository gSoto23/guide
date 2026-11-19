import type { Role } from "./index.js";

/** Capabilities from the permission matrix in spec 001 FR-016 (research R3). */
export const CAPABILITIES = [
  "workspace.settings",
  "workspace.billing",
  "members.manage",
  "workspace.ownership",
  "properties.manage",
  "integrations.manage",
  "conversations.handle",
  "restricted.reveal",
  "payments.refund",
  "security_log.view",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const OWNER_ADMIN: readonly Role[] = ["owner", "admin"];

/**
 * The single policy map (research R3). RLS enforces the same rules again in the database.
 * Agents never reveal restricted values (decided 2026-11-14).
 */
const MATRIX: Record<Capability, readonly Role[]> = {
  "workspace.settings": OWNER_ADMIN,
  "workspace.billing": ["owner"],
  "members.manage": OWNER_ADMIN,
  "workspace.ownership": ["owner"],
  "properties.manage": OWNER_ADMIN,
  "integrations.manage": OWNER_ADMIN,
  "conversations.handle": ["owner", "admin", "agent"],
  "restricted.reveal": OWNER_ADMIN,
  // Feature 013: refunds move money, so agents can't (FR-014).
  "payments.refund": OWNER_ADMIN,
  "security_log.view": OWNER_ADMIN,
};

/** True when the role grants the capability. A missing role (not a member) grants nothing. */
export function can(role: Role | null | undefined, capability: Capability): boolean {
  return role ? MATRIX[capability].includes(role) : false;
}

/** Roles an invitation may grant: ownership only moves through a transfer (FR-016, FR-026). */
export const INVITABLE_ROLES = ["admin", "agent"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * Whether an actor may change or remove a member (AC-SEC-003): owners and admins manage admins
 * and agents, never the owner's row; no one manages themselves through these actions.
 */
export function canManageMember(
  actor: { role: Role | null; userId: string },
  target: { role: Role; userId: string },
): boolean {
  if (!can(actor.role, "members.manage")) return false;
  if (target.role === "owner") return false;
  return actor.userId !== target.userId;
}
