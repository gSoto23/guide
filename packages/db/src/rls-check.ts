import pg from "pg";

/**
 * Lists tables that break the RLS rules (T015, SEC-14, security review T103):
 *
 * - every tenant table (one with a `workspace_id` column) must have row-level security enabled
 *   and forced;
 * - every table or partition that guidesk_app (the role request handlers run as) can reach, with
 *   any table or column privilege, must also have forced row-level security. A partition does
 *   not inherit its parent's policies when it is queried directly, so partitions count too.
 */
export async function findTablesWithoutForcedRls(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
        AND (
          (
            NOT c.relispartition
            AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped
            )
          )
          OR has_table_privilege('guidesk_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
          OR has_any_column_privilege('guidesk_app', c.oid, 'SELECT, INSERT, UPDATE')
        )
      ORDER BY c.relname
    `);
    return result.rows.map((row) => row.table_name);
  } finally {
    await client.end();
  }
}
