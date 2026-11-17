import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  isStepUpFresh,
  requiresMfa,
  stepUpMethods,
  type PropertyCountProvider,
  type Role,
} from "@guidesk/domain";
import { membership, type DbHandle } from "@guidesk/db";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { PROPERTY_COUNT } from "../tenancy/property-count.js";
import { AssuranceService } from "./assurance.service.js";

function authOf(context: ExecutionContext) {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  if (!request.auth) throw new ApiProblem(401, "unauthenticated");
  return { request, auth: request.auth };
}

/** Requires re-authentication within the last 10 minutes (FR-011, T057). */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly assurance: AssuranceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { auth } = authOf(context);
    const { strongAuthAt } = await this.assurance.get(auth.session.id);
    if (isStepUpFresh(strongAuthAt)) {
      return true;
    }
    const factors = await this.assurance.factors(auth.user.id);
    throw new ApiProblem(403, "step_up_required", "Confirm it's you to continue.", {
      methods: stepUpMethods({ ...factors, needSecondFactor: false }),
    });
  }
}

/**
 * Step-up for a route whose `?dryRun=true` form only reads (FR-044): removing a property needs a
 * recent sign-in, but listing what the removal would affect does not.
 */
@Injectable()
export class StepUpUnlessDryRunGuard extends StepUpGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const query = request.query as { dryRun?: unknown } | undefined;
    if (query?.dryRun === "true") return true;
    return super.canActivate(context);
  }
}

/**
 * Re-authentication with the strongest factor the user has (ASVS 5.0 V7.5.1, T103). Once they
 * have a passkey or an authenticator app, an email code alone doesn't count, as for factor
 * changes: someone with a stolen session and the inbox can't change the sign-in email.
 */
@Injectable()
export class SecondFactorStepUpGuard implements CanActivate {
  constructor(private readonly assurance: AssuranceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { auth } = authOf(context);
    const { strongAuthAt, method } = await this.assurance.get(auth.session.id);
    const factors = await this.assurance.factors(auth.user.id);
    const needSecondFactor = factors.hasPasskey || factors.totpEnabled;
    const strongEnough = !needSecondFactor || method === "passkey" || method === "totp";
    if (isStepUpFresh(strongAuthAt) && strongEnough) {
      return true;
    }
    throw new ApiProblem(403, "step_up_required", "Confirm it's you to continue.", {
      methods: stepUpMethods({ ...factors, needSecondFactor }),
    });
  }
}

/**
 * Requires multi-factor sign-in for staff, and for owners and admins of workspaces above the
 * property threshold (FR-009, T057). Workspace routes the caller does not belong to return 404.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private readonly assurance: AssuranceService,
    private readonly securityLog: SecurityLogService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(PROPERTY_COUNT) private readonly properties: PropertyCountProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { request, auth } = authOf(context);
    const workspaceId = (request.params as Record<string, string | undefined>).workspaceId;
    let role: Role | null = null;
    let propertyCount = 0;
    if (workspaceId) {
      const [row] = /^[0-9a-f-]{36}$/i.test(workspaceId)
        ? await this.handle.db
            .select({ role: membership.role })
            .from(membership)
            .where(
              and(eq(membership.workspaceId, workspaceId), eq(membership.userId, auth.user.id)),
            )
            .limit(1)
        : [];
      if (!row) {
        await this.securityLog.record({
          type: "access.cross_workspace_denied",
          outcome: "denied",
          actorUserId: auth.user.id,
          targetType: "workspace",
          targetId: workspaceId,
        });
        throw new ApiProblem(404, "not_found");
      }
      role = row.role;
      propertyCount = await this.properties.countProperties(workspaceId);
    }
    if (!requiresMfa({ isStaff: auth.user.isStaff, role, propertyCount })) {
      return true;
    }
    const { mfaSatisfied } = await this.assurance.get(auth.session.id);
    if (mfaSatisfied) {
      return true;
    }
    const factors = await this.assurance.factors(auth.user.id);
    if (!factors.hasPasskey && !factors.totpEnabled) {
      throw new ApiProblem(
        403,
        "mfa_enrollment_required",
        "Add a passkey or an authenticator app to continue.",
      );
    }
    throw new ApiProblem(403, "step_up_required", "Use your second factor to continue.", {
      methods: stepUpMethods({ ...factors, needSecondFactor: true }),
    });
  }
}

/**
 * Route needs re-authentication within 10 minutes (contracts: SU). With `secondFactor`, users
 * who have a passkey or an authenticator app must use one (contracts: SU2).
 */
export const RequireStepUp = (options: { secondFactor?: boolean } = {}) =>
  applyDecorators(UseGuards(options.secondFactor ? SecondFactorStepUpGuard : StepUpGuard));

/** Route needs multi-factor sign-in where it applies (contracts: MFA). */
export const RequireMfa = () => applyDecorators(UseGuards(MfaGuard));
