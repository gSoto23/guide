import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { defaultWorkspaceName } from "@guidesk/domain";
import { membership, securityEvent, user, workspace, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export interface NewUser {
  id: string;
  name: string | null;
  preferredLanguage: string | null;
}

/**
 * Workspace lifecycle in the system context (owner connection, research R4). Request handlers
 * never insert workspaces or memberships directly; RLS denies it.
 */
@Injectable()
export class TenancyService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** First sign-up: a workspace with the user as owner, set as their last workspace (FR-004, T039). */
  async createWorkspaceForNewUser(newUser: NewUser): Promise<string> {
    const workspaceId = randomUUID();
    const locale = newUser.preferredLanguage === "en" ? "en" : "es";
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: workspaceId,
        name: defaultWorkspaceName(newUser.name, locale),
        createdBy: newUser.id,
      });
      await tx.insert(membership).values({ workspaceId, userId: newUser.id, role: "owner" });
      await tx.update(user).set({ lastWorkspaceId: workspaceId }).where(eq(user.id, newUser.id));
      await tx.insert(securityEvent).values({
        type: "workspace.created",
        outcome: "success",
        actorUserId: newUser.id,
        workspaceId,
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { source: "sign_up" },
      });
    });
    return workspaceId;
  }
}
