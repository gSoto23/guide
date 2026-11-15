import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne } from "drizzle-orm";
import { invitation, membership, type DbHandle } from "@guidesk/db";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

/** Workspace-owned resources a route can name by ID. */
const TABLES = { invitation, membership } as const;
export type TenantResource = keyof typeof TABLES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A resource the request's RLS context could not see (AC-SEC-004, T084). The answer is always
 * `404 not_found`, whether the ID does not exist or belongs to another workspace, so nothing is
 * confirmed. When it does belong to another workspace, the attempt is logged in that workspace's
 * log, never the caller's: otherwise the caller could read their own log to learn that a guessed
 * ID exists (T103).
 */
@Injectable()
export class CrossTenantService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly securityLog: SecurityLogService,
  ) {}

  async notFound(
    actorUserId: string,
    routeWorkspaceId: string,
    resource: TenantResource,
    id: string,
  ): Promise<ApiProblem> {
    if (UUID.test(id)) {
      const table = TABLES[resource];
      const [elsewhere] = await this.handle.db
        .select({ workspaceId: table.workspaceId })
        .from(table)
        .where(and(eq(table.id, id), ne(table.workspaceId, routeWorkspaceId)))
        .limit(1);
      if (elsewhere) {
        await this.securityLog.record({
          type: "access.cross_workspace_denied",
          outcome: "denied",
          actorUserId,
          workspaceId: elsewhere.workspaceId,
          targetType: resource,
          targetId: id,
        });
      }
    }
    return new ApiProblem(404, "not_found");
  }
}
