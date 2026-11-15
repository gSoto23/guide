import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { securityEvent, user } from "@guidesk/db";
import {
  securityEventQuerySchema,
  type SecurityEventPage,
  type SecurityEventQuery,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { RequestDb } from "../database/request-db.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";

// The cursor keeps the database's microseconds: with a JavaScript Date (milliseconds), events in
// the same millisecond as a page's last row would be skipped (T103).
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(`${occurredAt}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at = "", id = ""] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!CURSOR_AT.test(at) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiProblem(422, "validation_failed", "Invalid cursor.");
  }
  return { at, id };
}

/**
 * Security log views (FR-030, T098). RLS limits what each reader sees: a user reads their own
 * account-level events; owners and admins read their workspace's events.
 */
@Controller("v1")
export class SecurityLogController {
  constructor(private readonly requestDb: RequestDb) {}

  @Get("me/security-events")
  mine(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(securityEventQuerySchema)) query: SecurityEventQuery,
  ): Promise<SecurityEventPage> {
    if (!request.auth) throw new ApiProblem(401, "unauthenticated");
    return this.page(
      [isNull(securityEvent.workspaceId), eq(securityEvent.actorUserId, request.auth.user.id)],
      query,
      false,
    );
  }

  @Get("workspaces/:workspaceId/security-events")
  @WorkspaceAction({ capability: "security_log.view" })
  workspace(
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(securityEventQuerySchema)) query: SecurityEventQuery,
  ): Promise<SecurityEventPage> {
    return this.page([eq(securityEvent.workspaceId, workspaceId)], query, true);
  }

  private async page(
    scope: SQL[],
    query: SecurityEventQuery,
    withActor: boolean,
  ): Promise<SecurityEventPage> {
    const cursor = decodeCursor(query.cursor);
    const filters: (SQL | undefined)[] = [
      ...scope,
      query.type ? eq(securityEvent.type, query.type) : undefined,
      query.from ? gte(securityEvent.occurredAt, new Date(query.from)) : undefined,
      query.to ? lte(securityEvent.occurredAt, new Date(query.to)) : undefined,
      cursor
        ? sql`(${securityEvent.occurredAt}, ${securityEvent.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    ];
    const rows = await this.requestDb
      .current()
      .select({
        id: securityEvent.id,
        occurredAt: securityEvent.occurredAt,
        type: securityEvent.type,
        outcome: securityEvent.outcome,
        actorId: securityEvent.actorUserId,
        actorName: user.name,
        actorEmail: user.email,
        approxLocation: securityEvent.approxLocation,
        userAgentFamily: securityEvent.userAgentFamily,
        metadata: securityEvent.metadata,
        cursorAt: sql<string>`to_char(${securityEvent.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(securityEvent)
      .leftJoin(user, eq(user.id, securityEvent.actorUserId))
      .where(and(...filters))
      .orderBy(desc(securityEvent.occurredAt), desc(securityEvent.id))
      .limit(query.limit + 1);
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      events: visible.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        type: row.type,
        outcome: row.outcome as "success" | "failure" | "denied",
        // Former members and purged accounts show no identity (RLS hides their user row).
        actor:
          withActor && row.actorId && row.actorEmail
            ? { id: row.actorId, name: row.actorName ?? "", email: row.actorEmail }
            : null,
        approxLocation: row.approxLocation,
        userAgentFamily: row.userAgentFamily,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.cursorAt, last.id) : null,
    };
  }
}
