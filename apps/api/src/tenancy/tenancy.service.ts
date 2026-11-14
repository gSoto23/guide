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
    const locale = newUser.preferredLanguage === "en" ? "en" : "es";
    const created = await this.createWorkspace(
      newUser.id,
      defaultWorkspaceName(newUser.name, locale),
      "sign_up",
    );
    return created.id;
  }

  /**
   * A workspace owned by the user, who switches to it (FR-023, T082). The owner membership and
   * the event are written in the same transaction.
   */
  async createWorkspace(
    userId: string,
    name: string,
    source: "sign_up" | "user",
  ): Promise<{ id: string; name: string; createdAt: Date }> {
    const workspaceId = randomUUID();
    return this.handle.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workspace)
        .values({ id: workspaceId, name, createdBy: userId })
        .returning({ id: workspace.id, name: workspace.name, createdAt: workspace.createdAt });
      if (!created) throw new Error("workspace insert returned nothing");
      await tx.insert(membership).values({ workspaceId, userId, role: "owner" });
      await tx.update(user).set({ lastWorkspaceId: workspaceId }).where(eq(user.id, userId));
      await tx.insert(securityEvent).values({
        type: "workspace.created",
        outcome: "success",
        actorUserId: userId,
        workspaceId,
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { source },
      });
      return created;
    });
  }

  /** Records the workspace the user works in, so sign-in reopens it (FR-024, T083). */
  async setLastWorkspace(userId: string, workspaceId: string): Promise<void> {
    await this.handle.db
      .update(user)
      .set({ lastWorkspaceId: workspaceId })
      .where(eq(user.id, userId));
  }
}
