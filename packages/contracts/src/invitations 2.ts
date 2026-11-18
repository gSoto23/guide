import { z } from "zod";

/** Contracts for invitations and members (contracts/http-api.md, US3, T069). */
export const invitableRoleSchema = z.enum(["admin", "agent"]);
export const invitationStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);

export const createInvitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    role: invitableRoleSchema,
  })
  .strict();
export type CreateInvitationBody = z.infer<typeof createInvitationSchema>;

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: invitableRoleSchema,
  /** Effective status: a pending invitation past its expiry reads as expired. */
  status: invitationStatusSchema,
  invitedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  expiresAt: z.iso.datetime(),
  sendCount: z.number().int().positive(),
  lastSentAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const invitationListSchema = z.object({
  invitations: z.array(invitationSchema),
  /** Members plus open invitations, against the workspace's seat limit (FR-021). */
  seats: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive() }),
});
export type InvitationList = z.infer<typeof invitationListSchema>;

/** Public lookup: only what the invitee needs to decide (AC-SEC-002). */
export const invitationPreviewSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string().nullable(),
  role: invitableRoleSchema,
  status: z.literal("pending"),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationResponseSchema = z.object({
  workspaceId: z.uuid(),
  role: z.enum(["owner", "admin", "agent"]),
  result: z.enum(["joined", "already_member"]),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

export const memberSchema = z.object({
  membershipId: z.uuid(),
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  role: z.enum(["owner", "admin", "agent"]),
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberListSchema = z.object({ members: z.array(memberSchema) });
export type MemberList = z.infer<typeof memberListSchema>;
