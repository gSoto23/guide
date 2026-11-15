import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne } from "drizzle-orm";
import { membership, user, type DbHandle } from "@guidesk/db";
import { toEmailLocale, type EmailLocale, type Rendered } from "@guidesk/emails";
import { DB_HANDLE } from "../database/database.module.js";
import { OutboxService } from "../notifications/outbox.service.js";

type Render = (locale: EmailLocale) => Promise<Rendered>;

/** Team and workspace notices, queued for the worker in each recipient's language (US5). */
@Injectable()
export class MemberNotices {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly outbox: OutboxService,
  ) {}

  async toUser(userId: string, template: string, render: Render): Promise<void> {
    const [recipient] = await this.handle.db
      .select({ email: user.email, language: user.preferredLanguage })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!recipient) return;
    const rendered = await render(toEmailLocale(recipient.language));
    await this.outbox.enqueueEmail({ to: recipient.email, ...rendered, template });
  }

  /** Every member of the workspace, optionally except one user. */
  async toMembers(
    workspaceId: string,
    template: string,
    render: Render,
    exceptUserId?: string,
  ): Promise<void> {
    const recipients = await this.handle.db
      .select({ email: user.email, language: user.preferredLanguage })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        exceptUserId
          ? and(eq(membership.workspaceId, workspaceId), ne(membership.userId, exceptUserId))
          : eq(membership.workspaceId, workspaceId),
      );
    for (const recipient of recipients) {
      const rendered = await render(toEmailLocale(recipient.language));
      await this.outbox.enqueueEmail({ to: recipient.email, ...rendered, template });
    }
  }
}
