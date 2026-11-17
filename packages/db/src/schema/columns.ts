/** Column helpers shared by the feature 002 tables. */
import { sql, type SQL } from "drizzle-orm";
import { customType, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Raw bytes. Restricted columns (`*_ciphertext`) hold `version || iv || ciphertext || tag`
 * produced by @guidesk/vault (research R5); nothing else is ever written to them.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** `column IN (...)` for an enum stored as text, for CHECK constraints. */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = sql.join(
    values.map((value) => sql.raw(`'${value.replace(/'/g, "''")}'`)),
    sql.raw(", "),
  );
  return sql`${column} IN (${list})`;
}
