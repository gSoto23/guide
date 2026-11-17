import { sql } from "drizzle-orm";
import type { Database } from "@guidesk/db";
import { toEmailLocale, type EmailLocale } from "@guidesk/emails";
import type { EmailMessage } from "@guidesk/integrations";

/** Owners and admins of a workspace, with the language their emails use (contracts/emails.md). */
export async function managersOf(
  db: Database,
  workspaceId: string,
): Promise<{ email: string; locale: EmailLocale }[]> {
  const result = await db.execute<{ email: string; preferred_language: string | null }>(sql`
    SELECT u.email, u.preferred_language
    FROM membership m JOIN "user" u ON u.id = m.user_id
    WHERE m.workspace_id = ${workspaceId} AND m.role IN ('owner', 'admin')
  `);
  return result.rows.map((row) => ({
    email: row.email,
    locale: toEmailLocale(row.preferred_language),
  }));
}

/**
 * Sends one email to every owner and admin, each in their language. The rendered message never
 * carries a calendar link, a credential, a code, or a guest name (the templates' contract).
 */
export async function notifyManagers(
  db: Database,
  queueEmail: (message: EmailMessage) => Promise<void>,
  workspaceId: string,
  template: string,
  render: (locale: EmailLocale) => Promise<{ subject: string; html: string; text: string }>,
): Promise<number> {
  const managers = await managersOf(db, workspaceId);
  for (const manager of managers) {
    const rendered = await render(manager.locale);
    await queueEmail({ to: manager.email, ...rendered, template });
  }
  return managers.length;
}
