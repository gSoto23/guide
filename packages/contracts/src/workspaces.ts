import { z } from "zod";

/** Contracts for /api/v1/workspaces and /api/v1/me/current-workspace (US4, T082, T083). */
export const workspaceNameSchema = z.string().trim().min(1).max(80);

export const createWorkspaceSchema = z.object({ name: workspaceNameSchema }).strict();
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({ name: workspaceNameSchema }).strict();
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceSchema>;

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(["active", "pending_deletion"]),
  /** The caller's role in this workspace. */
  role: z.enum(["owner", "admin", "agent"]),
  createdAt: z.iso.datetime(),
  /** When a workspace pending deletion is permanently deleted (FR-027); null otherwise. */
  purgeAfter: z.iso.datetime().nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const currentWorkspaceSchema = z.object({ workspaceId: z.uuid() }).strict();
export type CurrentWorkspaceBody = z.infer<typeof currentWorkspaceSchema>;
