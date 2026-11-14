import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { from, lastValueFrom, type Observable } from "rxjs";
import { withRlsContext, type DbHandle } from "@guidesk/db";
import { REQUEST_DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";

/**
 * Wraps each signed-in request in an RLS transaction (research R4, T020): the handler runs as
 * guidesk_app with app.user_id and, on workspace routes, app.workspace_id.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(
    @Inject(REQUEST_DB_HANDLE) private readonly handle: DbHandle,
    private readonly requestDb: RequestDb,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = request.auth;
    if (!auth) {
      return next.handle();
    }
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    return from(
      withRlsContext(
        this.handle.db,
        { userId: auth.user.id, workspaceId: params.workspaceId },
        (tx) =>
          this.requestDb.run(tx, () => lastValueFrom(next.handle(), { defaultValue: undefined })),
      ),
    );
  }
}
