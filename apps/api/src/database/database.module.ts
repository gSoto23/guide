import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type DbHandle } from "@guidesk/db";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { RequestDb } from "./request-db.js";

/** System context: auth hooks, guards, and services that act for Guidesk itself. */
export const DB_HANDLE = Symbol("DB_HANDLE");

/**
 * Request context: the pool behind RlsInterceptor's per-request transactions (research R4).
 *
 * It is a separate pool on purpose (security review T103). A request holds its RLS transaction
 * while services may also use the system pool; with one shared pool, a burst of concurrent
 * requests could take every connection and then wait forever for a second one.
 */
export const REQUEST_DB_HANDLE = Symbol("REQUEST_DB_HANDLE");

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): DbHandle =>
        createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_SIZE }),
    },
    {
      provide: REQUEST_DB_HANDLE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): DbHandle =>
        createDb(config.DATABASE_APP_URL ?? config.DATABASE_URL, {
          max: config.DATABASE_POOL_SIZE,
        }),
    },
    RequestDb,
  ],
  exports: [DB_HANDLE, REQUEST_DB_HANDLE, RequestDb],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(REQUEST_DB_HANDLE) private readonly requestHandle: DbHandle,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.handle.pool.end(), this.requestHandle.pool.end()]);
  }
}
