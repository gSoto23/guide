import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  agentDraft,
  assistantTest,
  copilotRun,
  calendarFeed,
  conversation,
  extractionRequest,
  guideDocument,
  guideItem,
  guideSection,
  guideVersion,
  importRun,
  invitation,
  membership,
  interviewSession,
  mediaObject,
  pmsConnection,
  property,
  restrictedValue,
  sharedBlock,
  stay,
  type DbHandle,
  extra,
  serviceRequest,
  type Transaction,
} from "@guidesk/db";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

/** Workspace-owned resources a route can name by ID. */
const TABLES = {
  invitation,
  membership,
  // Feature 002 (AC-SEC-009).
  property,
  calendar_feed: calendarFeed,
  stay,
  pms_connection: pmsConnection,
  import_run: importRun,
  extraction_request: extractionRequest,
  // Feature 003 (AC-SEC-011).
  guide_section: guideSection,
  guide_item: guideItem,
  guide_version: guideVersion,
  media_object: mediaObject,
  shared_block: sharedBlock,
  locked_field: restrictedValue,
  guide_document: guideDocument,
  interview_session: interviewSession,
  // Feature 005 (AC-SEC-006).
  conversation,
  agent_draft: agentDraft,
  // Feature 007 (AC-SEC-003).
  assistant_test: assistantTest,
  // Feature 006 (AC-SEC-004).
  copilot_run: copilotRun,
  // Feature 008 (AC-SEC-004).
  extra,
  service_request: serviceRequest,
} as const;
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

  /**
   * `notFound` for services that hold only the request's transaction: the caller is the
   * transaction's RLS user (`app.user_id`), set by withRlsContext for every request.
   */
  async notFoundInRequest(
    tx: Transaction,
    routeWorkspaceId: string,
    resource: TenantResource,
    id: string,
  ): Promise<ApiProblem> {
    const result = await tx.execute<{ user_id: string | null }>(
      sql`SELECT nullif(current_setting('app.user_id', true), '') AS user_id`,
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) return new ApiProblem(404, "not_found");
    return this.notFound(userId, routeWorkspaceId, resource, id);
  }
}
