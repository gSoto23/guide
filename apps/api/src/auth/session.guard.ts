import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { session as sessionTable, type DbHandle } from "@guidesk/db";
import type { AuthProviderPort } from "@guidesk/integrations";
import { DB_HANDLE } from "../database/database.module.js";
import { ApiProblem } from "../common/problem.js";
import { toWebHeaders } from "../common/request.js";
import { AUTH_PROVIDER } from "./auth.js";
import { ABSOLUTE_SESSION_MS } from "./auth-events.js";
import { IS_PUBLIC } from "./public.decorator.js";

export { ABSOLUTE_SESSION_MS };

/** Requires a valid session on every Nest route unless marked @Public() (T020). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProviderPort,
    private readonly reflector: Reflector,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = await this.authProvider.getSession(toWebHeaders(request.headers));
    if (!auth) {
      throw new ApiProblem(401, "unauthenticated", "Sign in to continue.");
    }
    // 30-day absolute lifetime, even with daily use (FR-015, T060).
    if (Date.now() - auth.session.createdAt.getTime() > ABSOLUTE_SESSION_MS) {
      await this.handle.db.delete(sessionTable).where(eq(sessionTable.id, auth.session.id));
      throw new ApiProblem(401, "unauthenticated", "Your session expired. Sign in again.");
    }
    request.auth = auth;
    return true;
  }
}
