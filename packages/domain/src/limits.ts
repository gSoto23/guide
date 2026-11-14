/**
 * Seat limits (spec 001 FR-021). Feature 011 defines plan limits; during the free pilot Guidesk
 * sets them per workspace, falling back to this default.
 */
export const DEFAULT_PILOT_SEAT_LIMIT = 10;

export interface SeatLimitProvider {
  /** Maximum members plus pending invitations for the workspace. */
  seatLimit(workspaceId: string): Promise<number>;
}

/** Members and open invitations both take a seat, so accepting never exceeds the limit. */
export function hasFreeSeat(
  usage: { members: number; pendingInvitations: number },
  limit: number,
): boolean {
  return usage.members + usage.pendingInvitations < limit;
}
