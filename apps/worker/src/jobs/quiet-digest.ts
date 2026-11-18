import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  chatHeldNotice,
  chatMessage,
  conversation,
  membership,
  property,
  user,
  type Database,
} from "@guidesk/db";
import { JOB_QUEUES, type NotificationPushJob } from "@guidesk/domain";
import { renderChatQuietSummary, toEmailLocale, type ChatNeedsHostReason } from "@guidesk/emails";
import type { EmailMessage } from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The quiet hours summary (feature 007 research R7, FR-008): every minute, takes the held "needs
 * the host" notices whose window has ended, keeps those whose conversation still needs the host and
 * whose recipient is still a member, and sends one `chat.quiet_summary` per recipient and property.
 * Runs in the system context; reports counts only.
 */
export const QUIET_DIGEST_CRON = "* * * * *";
const BATCH = 500;

export interface QuietDigestDeps {
  db: Database;
  queueEmail: (message: EmailMessage) => Promise<void>;
  /** Feature 006: the summary also goes by push (research R7). */
  queuePush?: (job: NotificationPushJob) => Promise<void>;
  portalUrl: string;
  span?: JobSpanDeps;
}

export interface QuietDigestReport {
  notices: number;
  emails: number;
}

export async function runQuietDigest(
  deps: QuietDigestDeps,
  now: Date = new Date(),
): Promise<QuietDigestReport> {
  const { db } = deps;
  // Claim the due notices by deleting them, so two runs never send the same summary.
  const due = await db
    .delete(chatHeldNotice)
    .where(
      inArray(
        chatHeldNotice.id,
        db
          .select({ id: chatHeldNotice.id })
          .from(chatHeldNotice)
          .where(lte(chatHeldNotice.releaseAt, now))
          .limit(BATCH),
      ),
    )
    .returning();
  if (due.length === 0) return { notices: 0, emails: 0 };

  const waiting = await db
    .select({
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      reason: conversation.needsHostReason,
    })
    .from(conversation)
    .where(
      and(
        inArray(
          conversation.id,
          due.map((notice) => notice.conversationId),
        ),
        eq(conversation.status, "needs_host"),
      ),
    );
  const stillWaiting = new Map(waiting.map((row) => [row.id, row]));

  const groups = new Map<string, typeof due>();
  for (const notice of due) {
    if (!stillWaiting.has(notice.conversationId)) continue;
    const key = `${notice.userId}:${notice.propertyId}`;
    groups.set(key, [...(groups.get(key) ?? []), notice]);
  }

  let emails = 0;
  for (const notices of groups.values()) {
    const first = notices[0]!;
    const [recipient] = await db
      .select({ email: user.email, preferredLanguage: user.preferredLanguage })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        and(
          eq(membership.workspaceId, first.workspaceId),
          eq(membership.userId, first.userId),
          inArray(membership.role, ["owner", "admin", "agent"]),
        ),
      )
      .limit(1);
    if (!recipient) continue;
    const [prop] = await db
      .select({ name: property.name })
      .from(property)
      .where(and(eq(property.id, first.propertyId), eq(property.workspaceId, first.workspaceId)))
      .limit(1);
    if (!prop) continue;
    const locale = toEmailLocale(recipient.preferredLanguage);
    const conversations = [];
    for (const notice of notices) {
      const [latest] = await db
        .select({ body: chatMessage.body })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.conversationId, notice.conversationId),
            eq(chatMessage.author, "guest"),
          ),
        )
        .orderBy(desc(chatMessage.seq))
        .limit(1);
      const reason = stillWaiting.get(notice.conversationId)?.reason ?? notice.reason;
      conversations.push({
        reason: reason as ChatNeedsHostReason,
        guestMessage: latest?.body ?? "",
        link: `${deps.portalUrl}/${locale}/properties/${notice.propertyId}/conversations/${notice.conversationId}`,
      });
    }
    const rendered = await renderChatQuietSummary(locale, {
      propertyName: prop.name,
      conversations,
    });
    await deps.queueEmail({ to: recipient.email, ...rendered, template: "chat.quiet_summary" });
    await deps.queuePush?.({
      userId: first.userId,
      kind: "quiet_summary",
      workspaceId: first.workspaceId,
      propertyId: first.propertyId,
      count: conversations.length,
    });
    emails += 1;
  }
  // Answered conversations got no summary (their notices went with the claim). The 30-minute rule
  // of feature 005 counts from the summary, so a new guest message doesn't email again at once.
  const summarized = [
    ...new Set([...groups.values()].flat().map((notice) => notice.conversationId)),
  ];
  if (summarized.length > 0) {
    await db
      .update(conversation)
      .set({ lastNotifiedAt: sql`now()` })
      .where(inArray(conversation.id, summarized));
  }
  return { notices: due.length, emails };
}

/** The pg-boss handler: one span per run (constitution VIII), with counts only. */
export function createQuietDigestHandler(deps: QuietDigestDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.chatQuietDigest },
      async (span) => {
        const report = await runQuietDigest(deps);
        span.set({ "job.notices": report.notices, "job.emails": report.emails });
      },
      deps.span,
    );
  };
}
