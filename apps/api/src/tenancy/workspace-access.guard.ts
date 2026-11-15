import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { can, type Capability, type Role } from "@guidesk/domain";
import { membership, workspace, type DbHandle } from "@guidesk/db";
import { MfaGuard, StepUpGuard } from "../auth/step-up.guard.js";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

const CAPABILITY = "guidesk:capability";
const ALLOW_PENDING = "guidesk:allowPendingDeletion";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "fastify" {
  interface FastifyRequest {
    /** The caller's role in the route's workspace, set by WorkspaceAccessGuard. */
    workspaceRole?: Role;
  }
}

/**
 * Workspace routes (FR-016, FR-017): a non-member gets 404, never 403, and the attempt is logged
 * (AC-SEC-004); a member whose role lacks the capability gets 403.
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly securityLog: SecurityLogService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = request.auth;
    if (!auth) throw new ApiProblem(401, "unauthenticated");
    const params = request.params as Record<string, string | undefined>;
    // One spelling per ID, so rate-limit keys, locks, and logs never see case variants (T103).
    for (const [name, value] of Object.entries(params)) {
      if (value && UUID.test(value)) params[name] = value.toLowerCase();
    }
    const workspaceId = params.workspaceId ?? "";
    const [row] = UUID.test(workspaceId)
      ? await this.handle.db
          .select({ role: membership.role, status: workspace.status })
          .from(membership)
          .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
          .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, auth.user.id)))
          .limit(1)
      : [];
    // A workspace pending deletion exists only for its owner (FR-027).
    if (row && row.status === "pending_deletion" && row.role !== "owner") {
      throw new ApiProblem(404, "not_found");
    }
    if (!row) {
      await this.securityLog.record({
        type: "access.cross_workspace_denied",
        outcome: "denied",
        actorUserId: auth.user.id,
        targetType: "workspace",
        targetId: UUID.test(workspaceId) ? workspaceId : null,
      });
      throw new ApiProblem(404, "not_found");
    }
    request.workspaceRole = row.role;
    if (
      row.status === "pending_deletion" &&
      !this.reflector.get<boolean | undefined>(ALLOW_PENDING, context.getHandler())
    ) {
      throw new ApiProblem(
        409,
        "workspace_pending_deletion",
        "This workspace is scheduled for deletion. Restore it first.",
      );
    }
    const capability = this.reflector.get<Capability | undefined>(CAPABILITY, context.getHandler());
    if (capability && !can(row.role, capability)) {
      // Logged for every role, including attempts at owner-only actions (AC-SEC-003, T103).
      await this.securityLog.record({
        type: "access.role_denied",
        outcome: "denied",
        actorUserId: auth.user.id,
        workspaceId,
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { capability, role: row.role },
      });
      throw new ApiProblem(403, "forbidden", "Your role does not allow this action.");
    }
    return true;
  }
}

export interface WorkspaceActionOptions {
  capability?: Capability;
  /** Re-authentication within 10 minutes (contracts: SU). */
  stepUp?: boolean;
  /** A second factor where the MFA threshold applies (contracts: MFA). */
  mfa?: boolean;
  /** The route also works while the workspace is pending deletion (owner only: read, restore). */
  allowPendingDeletion?: boolean;
}

/**
 * A workspace-scoped action. Guards run in this order: membership and role, then step-up, then
 * MFA, so an agent sees 403 rather than a re-authentication prompt.
 */
export function WorkspaceAction(options: WorkspaceActionOptions = {}) {
  return applyDecorators(
    SetMetadata(CAPABILITY, options.capability),
    SetMetadata(ALLOW_PENDING, options.allowPendingDeletion ?? false),
    UseGuards(
      WorkspaceAccessGuard,
      ...(options.stepUp ? [StepUpGuard] : []),
      ...(options.mfa ? [MfaGuard] : []),
    ),
  );
}
