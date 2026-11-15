import { z } from "zod";

/** Contracts for US5: members, ownership, deletion, account data, and security logs. */
export const changeRoleSchema = z.object({ role: z.enum(["admin", "agent"]) }).strict();
export type ChangeRoleBody = z.infer<typeof changeRoleSchema>;

export const transferOwnershipSchema = z.object({ membershipId: z.uuid() }).strict();
export type TransferOwnershipBody = z.infer<typeof transferOwnershipSchema>;

export const deleteWorkspaceSchema = z.object({ confirmName: z.string().max(200) }).strict();
export type DeleteWorkspaceBody = z.infer<typeof deleteWorkspaceSchema>;

export const workspaceDeletionResponseSchema = z.object({
  status: z.literal("pending_deletion"),
  purgeAfter: z.iso.datetime(),
});
export type WorkspaceDeletionResponse = z.infer<typeof workspaceDeletionResponseSchema>;

export const accountDeletionResponseSchema = z.object({ purgeAfter: z.iso.datetime() });
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

export const emailChangeSchema = z
  .object({
    newEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  })
  .strict();
export type EmailChangeBody = z.infer<typeof emailChangeSchema>;

export const emailChangeConfirmSchema = z
  .object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") })
  .strict();
export type EmailChangeConfirmBody = z.infer<typeof emailChangeConfirmSchema>;

export const securityEventSchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  type: z.string(),
  outcome: z.enum(["success", "failure", "denied"]),
  /** Who acted, when the reader may see it (workspace logs only). */
  actor: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  approxLocation: z.string().nullable(),
  userAgentFamily: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type SecurityEventView = z.infer<typeof securityEventSchema>;

export const securityEventPageSchema = z.object({
  events: z.array(securityEventSchema),
  nextCursor: z.string().nullable(),
});
export type SecurityEventPage = z.infer<typeof securityEventPageSchema>;

export const securityEventQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    type: z.string().max(60).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .strict();
export type SecurityEventQuery = z.infer<typeof securityEventQuerySchema>;
