import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { and, eq, lt } from "drizzle-orm";
import { catchError, from, mergeMap, type Observable, of, throwError } from "rxjs";
import { idempotencyKey, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";
import { ApiProblem } from "./problem.js";

const IDEMPOTENT = "guidesk:idempotent";
/** Metadata key Nest uses for @HttpCode() (HTTP_CODE_METADATA in @nestjs/common). */
const HTTP_CODE_METADATA = "__httpCode__";
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

/** The route accepts an `Idempotency-Key` header (contracts/http-api.md). */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/**
 * Replays the stored response for a repeated `Idempotency-Key`, so retries never double-send.
 * Registered before RlsInterceptor, so a response is stored only after its transaction commits.
 * Keys are per user and route; a key still in flight answers 409, and a failed request frees it.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, context.getHandler())) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers["idempotency-key"];
    const key = Array.isArray(header) ? header[0] : header;
    if (key === undefined || !request.auth) return next.handle();
    if (!KEY_PATTERN.test(key)) {
      throw new ApiProblem(422, "validation_failed", "Invalid Idempotency-Key.", {
        fields: { "Idempotency-Key": ["Use 8 to 100 letters, digits, or . _ : -"] },
      });
    }
    const userId = request.auth.user.id;
    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method === "POST" ? 201 : 200);

    return from(this.claim(userId, key, route)).pipe(
      mergeMap((stored) => {
        if (stored) return of(stored.body);
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.store(userId, key, status, body)).pipe(mergeMap(() => of(body))),
          ),
          catchError((error: unknown) =>
            from(this.release(userId, key)).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  /** Claims the key, or returns the stored response of an earlier identical request. */
  private async claim(
    userId: string,
    key: string,
    route: string,
  ): Promise<{ body: unknown } | null> {
    const db = this.handle.db;
    await db
      .delete(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.userId, userId),
          eq(idempotencyKey.key, key),
          lt(idempotencyKey.createdAt, new Date(Date.now() - KEY_TTL_MS)),
        ),
      );
    const inserted = await db
      .insert(idempotencyKey)
      .values({ userId, key, route })
      .onConflictDoNothing()
      .returning({ key: idempotencyKey.key });
    if (inserted.length > 0) return null;
    const [existing] = await db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)))
      .limit(1);
    if (!existing || existing.route !== route) {
      throw new ApiProblem(422, "idempotency_conflict", "This key was used for another request.");
    }
    if (existing.status === null) {
      throw new ApiProblem(409, "idempotency_conflict", "The same request is still in progress.");
    }
    return { body: existing.body };
  }

  private async store(userId: string, key: string, status: number, body: unknown): Promise<void> {
    await this.handle.db
      .update(idempotencyKey)
      .set({ status, body: body ?? null })
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
  }

  private async release(userId: string, key: string): Promise<void> {
    await this.handle.db
      .delete(idempotencyKey)
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
  }
}
