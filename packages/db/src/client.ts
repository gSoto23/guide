import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";
import { securityEvent } from "./security-event.js";

export const fullSchema = { ...schema, securityEvent };
export type Database = NodePgDatabase<typeof fullSchema>;

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
}

export interface CreateDbOptions {
  /** Pool size per process (ECS task). */
  max?: number;
  /** How long to wait for a free connection before failing (default 5 s). */
  connectionTimeoutMillis?: number;
  /** Server-side limit per statement (default 15 s). */
  statementTimeoutMillis?: number;
  /** Server-side limit for an idle open transaction (default 30 s). */
  idleInTransactionTimeoutMillis?: number;
}

/**
 * Creates a pooled PostgreSQL connection and the typed Drizzle instance (T012). Timeouts make a
 * stuck request fail instead of holding a connection forever (security review T103).
 */
export function createDb(connectionString: string, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    statement_timeout: options.statementTimeoutMillis ?? 15_000,
    idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMillis ?? 30_000,
  });
  return { pool, db: drizzle(pool, { schema: fullSchema }) };
}

/**
 * Builds the connection URL from separate variables (AWS: the password comes from Secrets
 * Manager through ECS `valueFrom`, security review T103). Returns undefined when they are absent.
 */
export function databaseUrlFromParts(env: NodeJS.ProcessEnv): string | undefined {
  const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD } = env;
  if (!DATABASE_HOST || !DATABASE_NAME || !DATABASE_USER || !DATABASE_PASSWORD) return undefined;
  const url = new URL(`postgres://${DATABASE_HOST}`);
  url.port = DATABASE_PORT ?? "5432";
  url.pathname = `/${DATABASE_NAME}`;
  url.username = DATABASE_USER;
  url.password = DATABASE_PASSWORD;
  if (env.DATABASE_SSLMODE) url.searchParams.set("sslmode", env.DATABASE_SSLMODE);
  return url.toString();
}
