/**
 * Seat limits (spec 001 FR-021): the workspace's plan sets them, or a custom limit Guidesk set
 * (feature 011 FR-002, FR-003).
 */
export interface SeatLimitProvider {
  /** Maximum members plus pending invitations for the workspace; null is unlimited. */
  seatLimit(workspaceId: string): Promise<number | null>;
}

/** Members and open invitations both take a seat, so accepting never exceeds the limit. */
export function hasFreeSeat(
  usage: { members: number; pendingInvitations: number },
  limit: number | null,
): boolean {
  return limit === null || usage.members + usage.pendingInvitations < limit;
}
