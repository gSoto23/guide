import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE_MAX,
  type GuestChat,
  type GuestChatMessage,
  type PostChatMessageBody,
  type PostChatMessageResponse,
} from "@guidesk/contracts";
import { chatMessage, conversation, guide, guideVersion, user, workspace } from "@guidesk/db";
import {
  emergencyNumberFor,
  hostDisplayName,
  JOB_QUEUES,
  lockState,
  suggestionKeys,
  type ChatReplyJob,
  type GuideSnapshot,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { GuestContext, readCookie, sha256Hex, type GuestTarget } from "../guest/guest-context.js";
import { GuestSessions } from "../guest/sessions.service.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { toGuestMessage, type StoredChatMessage } from "./chat-messages.js";

/** Messages per device per 10 minutes (feature 005 FR-028, research R8; 25 since feature 019 FR-004). */
export const CHAT_DEVICE_LIMIT = 25;
export const CHAT_DEVICE_WINDOW_SECONDS = 600;
/**
 * Messages per network address per 10 minutes: a backstop for devices that drop the chat cookie to
 * escape the device limit, loose enough for a shared hotel or café network.
 */
export const CHAT_IP_LIMIT = 60;
/** The chat cookie lasts 90 days; conversations themselves follow research R14. */
const CHAT_COOKIE_MAX_AGE = 90 * 24 * 3600;
/** A reply that has not arrived after this long is no longer shown as pending. */
const PENDING_FOR_MS = 60_000;
const PAGE = 100;

/**
 * The guest side of the chat (feature 005 research R7): one conversation per device and property,
 * kept with an HttpOnly cookie whose hash is all that is stored. Every query is scoped by the
 * workspace and property resolved from the property link (spec 004 research R12).
 */
@Injectable()
export class GuestChatService {
  constructor(
    private readonly context: GuestContext,
    private readonly sessions: GuestSessions,
    private readonly rateLimit: RateLimitService,
    private readonly jobs: JobQueueService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private get secure(): boolean {
    return this.config.GUIDE_URL.startsWith("https://");
  }

  get cookieName(): string {
    return this.secure ? "__Host-guidesk_chat" : "guidesk_chat";
  }

  private cookie(value: string): string {
    return [
      `${this.cookieName}=${value}`,
      "Path=/",
      `Max-Age=${CHAT_COOKIE_MAX_AGE}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(this.secure ? ["Secure"] : []),
    ].join("; ");
  }

  private cookieValue(header: string | undefined): string | undefined {
    const value = readCookie(header, this.cookieName);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }

  async chat(
    publicId: string,
    after: number | undefined,
    cookieHeader: string | undefined,
  ): Promise<GuestChat> {
    const target = await this.context.byPublicId(publicId);
    const intro = await this.intro(target);
    const value = this.cookieValue(cookieHeader);
    const conv = value ? await this.conversationOf(target, sha256Hex(value)) : null;
    if (!conv) return { intro, conversation: null, messages: [] };
    const rows = await this.messages(conv.id, after);
    return {
      intro,
      conversation: { status: conv.status, pending: await this.pending(conv.id) },
      // A member without a display name signs as the host (the workspace's name).
      messages: rows.map((row) =>
        toGuestMessage(
          row.author === "host" && !row.authorName
            ? { ...row, authorName: intro.hostName ?? intro.propertyName }
            : row,
        ),
      ),
    };
  }

  async post(
    body: PostChatMessageBody,
    cookieHeader: string | undefined,
    ipKey: string,
  ): Promise<{ body: PostChatMessageResponse; setCookie?: string }> {
    const target = await this.context.byPublicId(body.publicId);
    if ([...body.text].length > CHAT_MESSAGE_MAX) throw new ApiProblem(422, "message_too_long");
    const existing = this.cookieValue(cookieHeader);
    const value = existing ?? randomBytes(32).toString("base64url");
    const cookieHash = sha256Hex(value);
    const setCookie = existing ? undefined : this.cookie(value);

    // A retry of a message already stored returns it, before any limit is spent.
    const known = existing ? await this.byClientId(target, cookieHash, body.clientId) : null;
    if (known) {
      return {
        body: {
          message: toGuestMessage(known.message),
          pending: await this.pending(known.conversationId),
        },
        ...(setCookie ? { setCookie } : {}),
      };
    }

    for (const [key, limit] of [
      [`chat:device:${cookieHash}`, CHAT_DEVICE_LIMIT],
      [`chat:ip:${ipKey}`, CHAT_IP_LIMIT],
    ] as const) {
      const result = await this.rateLimit.consume(key, limit, CHAT_DEVICE_WINDOW_SECONDS);
      if (!result.allowed) {
        throw new ApiProblem(429, "chat_paused", undefined, {
          retryAfterSeconds: result.retryAfterSeconds,
          details: { retryAfterSeconds: result.retryAfterSeconds },
        });
      }
    }

    const device = await this.sessions.device(target, cookieHeader);
    const stayId =
      device && lockState(device.context, new Date()).state !== "ended" ? device.stayId : null;

    const stored = await this.context.db.transaction(async (tx) => {
      // The upsert locks the conversation row, so concurrent messages get consecutive numbers.
      const [conv] = await tx
        .insert(conversation)
        .values({
          workspaceId: target.workspaceId,
          propertyId: target.propertyId,
          cookieHash,
          language: body.language,
          stayId,
        })
        .onConflictDoUpdate({
          target: [conversation.propertyId, conversation.cookieHash],
          set: {
            language: body.language,
            lastMessageAt: sql`now()`,
            stayId: sql`coalesce(excluded.stay_id, ${conversation.stayId})`,
            // Feature 006 (research R2): a new guest message reopens a done conversation.
            status: sql`CASE WHEN ${conversation.status} = 'done' THEN 'open' ELSE ${conversation.status} END`,
            doneAt: sql`CASE WHEN ${conversation.status} = 'done' THEN NULL ELSE ${conversation.doneAt} END`,
            doneBy: sql`CASE WHEN ${conversation.status} = 'done' THEN NULL ELSE ${conversation.doneBy} END`,
          },
        })
        .returning({ id: conversation.id });
      const [next] = await tx
        .select({ seq: sql<number>`coalesce(max(${chatMessage.seq}), 0)::int + 1` })
        .from(chatMessage)
        .where(eq(chatMessage.conversationId, conv!.id));
      const [message] = await tx
        .insert(chatMessage)
        .values({
          workspaceId: target.workspaceId,
          conversationId: conv!.id,
          seq: next!.seq,
          author: "guest",
          kind: "text",
          body: body.text,
          clientId: body.clientId,
        })
        .onConflictDoNothing()
        .returning();
      return { conversationId: conv!.id, message };
    });
    if (!stored.message) {
      // Two retries raced; the other one stored the message.
      const raced = await this.byClientId(target, cookieHash, body.clientId);
      if (!raced) throw new ApiProblem(409, "conflict");
      return {
        body: { message: toGuestMessage(raced.message), pending: true },
        ...(setCookie ? { setCookie } : {}),
      };
    }

    const job: ChatReplyJob = {
      workspaceId: target.workspaceId,
      conversationId: stored.conversationId,
      messageId: stored.message.id,
    };
    await this.jobs.send(JOB_QUEUES.chatReply, job, {
      singletonKey: stored.conversationId,
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 60,
    });
    const message: GuestChatMessage = toGuestMessage({ ...stored.message, authorName: null });
    const pending = await this.pending(stored.conversationId);
    return { body: { message, pending }, ...(setCookie ? { setCookie } : {}) };
  }

  private async intro(target: GuestTarget): Promise<GuestChat["intro"]> {
    const [row] = await this.context.db
      .select({ hostName: workspace.name, snapshot: guideVersion.snapshot })
      .from(guide)
      .innerJoin(guideVersion, eq(guideVersion.id, guide.publishedVersionId))
      .innerJoin(workspace, eq(workspace.id, guide.workspaceId))
      .where(and(eq(guide.id, target.guideId), eq(guide.workspaceId, target.workspaceId)))
      .limit(1);
    return {
      propertyName: target.propertyName,
      hostName: row ? hostDisplayName(row.hostName) : null,
      emergencyNumber: emergencyNumberFor(target.country),
      suggestions: row ? suggestionKeys(row.snapshot as GuideSnapshot) : [],
    };
  }

  private async conversationOf(target: GuestTarget, cookieHash: string) {
    const [row] = await this.context.db
      .select({ id: conversation.id, status: conversation.status })
      .from(conversation)
      .where(
        and(
          eq(conversation.workspaceId, target.workspaceId),
          eq(conversation.propertyId, target.propertyId),
          eq(conversation.cookieHash, cookieHash),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async byClientId(target: GuestTarget, cookieHash: string, clientId: string) {
    const conv = await this.conversationOf(target, cookieHash);
    if (!conv) return null;
    const [row] = await this.context.db
      .select()
      .from(chatMessage)
      .where(and(eq(chatMessage.conversationId, conv.id), eq(chatMessage.clientId, clientId)))
      .limit(1);
    return row ? { conversationId: conv.id, message: { ...row, authorName: null } } : null;
  }

  /** Messages after the cursor, oldest first; without a cursor, the latest page. */
  private async messages(
    conversationId: string,
    after: number | undefined,
  ): Promise<StoredChatMessage[]> {
    const rows = await this.context.db
      .select({
        id: chatMessage.id,
        seq: chatMessage.seq,
        author: chatMessage.author,
        kind: chatMessage.kind,
        body: chatMessage.body,
        payload: chatMessage.payload,
        authorName: user.name,
        createdAt: chatMessage.createdAt,
      })
      .from(chatMessage)
      .leftJoin(user, eq(user.id, chatMessage.authorUserId))
      .where(
        and(
          eq(chatMessage.conversationId, conversationId),
          ...(after !== undefined ? [gt(chatMessage.seq, after)] : []),
        ),
      )
      .orderBy(after !== undefined ? asc(chatMessage.seq) : desc(chatMessage.seq))
      .limit(PAGE);
    return after !== undefined ? rows : rows.reverse();
  }

  /**
   * A reply is pending while the latest message is the guest's and recent (research R2), unless a
   * member took the conversation over: the assistant won't reply there (feature 006 research R4).
   */
  private async pending(conversationId: string): Promise<boolean> {
    const [conv] = await this.context.db
      .select({ takenOverAt: conversation.takenOverAt })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .limit(1);
    if (conv?.takenOverAt) return false;
    const [last] = await this.context.db
      .select({ author: chatMessage.author, createdAt: chatMessage.createdAt })
      .from(chatMessage)
      .where(eq(chatMessage.conversationId, conversationId))
      .orderBy(desc(chatMessage.seq))
      .limit(1);
    return last?.author === "guest" && Date.now() - last.createdAt.getTime() < PENDING_FOR_MS;
  }
}
