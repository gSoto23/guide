import { Controller, Get, Param } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { membership, user } from "@guidesk/db";
import type { MemberList } from "@guidesk/contracts";
import { RequestDb } from "../database/request-db.js";
import { WorkspaceAction } from "./workspace-access.guard.js";

const ROLE_ORDER = { owner: 0, admin: 1, agent: 2 } as const;

/**
 * GET /api/v1/workspaces/{workspaceId}/members (contracts/http-api.md). Read-only for US3's team
 * screen; role changes and removal arrive with US5 (T092).
 */
@Controller("v1/workspaces/:workspaceId/members")
export class MembersController {
  constructor(private readonly requestDb: RequestDb) {}

  @Get()
  @WorkspaceAction({ capability: "members.manage" })
  async list(@Param("workspaceId") workspaceId: string): Promise<MemberList> {
    const rows = await this.requestDb
      .current()
      .select({
        membershipId: membership.id,
        userId: membership.userId,
        role: membership.role,
        joinedAt: membership.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.workspaceId, workspaceId))
      .orderBy(asc(membership.createdAt));
    return {
      members: rows
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
        .map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() })),
    };
  }
}
