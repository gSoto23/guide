import pg from "pg";

/**
 * Creates a database owner shaped like the RDS master user: it can log in and create roles, but
 * it is not a superuser and has no BYPASSRLS. Returns its connection URL.
 *
 * Tests run migrations and queries as this role (security review T103), so forced row-level
 * security, grants, and role membership behave as they will in production. A superuser would
 * bypass all of them and hide mistakes.
 */
export async function createOwnerRole(
  superuserUrl: string,
  role = "guidesk_owner",
): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error("Role names must be lowercase identifiers");
  }
  const url = new URL(superuserUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  const password = `${role}_test_only`;
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE ROLE ${role} LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
    );
    await client.query(`ALTER DATABASE ${client.escapeIdentifier(database)} OWNER TO ${role}`);
  } finally {
    await client.end();
  }
  url.username = role;
  url.password = password;
  return url.toString();
}
