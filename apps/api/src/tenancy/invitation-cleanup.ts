import { and, eq } from "drizzle-orm";
import { invitation, type Transaction } from "@guidesk/db";

/**
 * Revokes the open invitations a member sent, when they are removed, leave, or become an agent
 * (AC-SEC-006, T103). Otherwise a removed admin could rejoin through an invitation they sent to
 * another of their addresses. The database also refuses acceptance when the inviter is no longer
 * an owner or admin (migration 0015). Runs in the request transaction, under RLS.
 */
export async function revokeInvitationsSentBy(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await tx
    .update(invitation)
    .set({ status: "revoked" })
    .where(
      and(
        eq(invitation.workspaceId, workspaceId),
        eq(invitation.invitedBy, userId),
        eq(invitation.status, "pending"),
      ),
    );
}
