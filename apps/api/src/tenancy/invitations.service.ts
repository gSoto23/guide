import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gt, lte, or, sql } from "drizzle-orm";
import {
  effectiveStatus,
  hasFreeSeat,
  INVITATION_TTL_MS,
  invitationExpiry,
  INVITES_PER_WORKSPACE_PER_HOUR,
  resendDecision,
  RESENDS_PER_INVITATION_PER_DAY,
  type SeatLimitProvider,
} from "@guidesk/domain";
import { invitation, membership, user, workspace, type Transaction } from "@guidesk/db";
import { renderInvitation, toEmailLocale } from "@guidesk/emails";
import type { AuthUser, EmailAdapter } from "@guidesk/integrations";
import type { CreateInvitationBody, Invitation, InvitationList } from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { RequestDb } from "../database/request-db.js";
import { EMAIL_ADAPTER } from "../email/email.module.js";
import { InvitationEvents } from "./invitations.events.js";
import { newInvitationToken } from "./invitation-token.js";
import { SEAT_LIMIT } from "./seat-limit.js";

type InvitationRow = typeof invitation.$inferSelect;
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

function toDto(row: InvitationRow, inviterName: string | null, now: Date): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: effectiveStatus(row, now),
    invitedBy: row.invitedBy ? { id: row.invitedBy, name: inviterName ?? "" } : null,
    expiresAt: row.expiresAt.toISOString(),
    sendCount: row.sendCount,
    lastSentAt: row.lastSentAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Invitations for owners and admins (FR-018, FR-021, T074). Everything runs in the request's RLS
 * transaction as guidesk_app, so the database enforces the role rules again.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly rateLimit: RateLimitService,
    private readonly events: InvitationEvents,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(SEAT_LIMIT) private readonly seats: SeatLimitProvider,
  ) {}

  async list(workspaceId: string): Promise<InvitationList> {
    const tx = this.requestDb.current();
    const now = new Date();
    const rows = await tx
      .select({ row: invitation, inviterName: user.name })
      .from(invitation)
      .leftJoin(user, eq(user.id, invitation.invitedBy))
      .where(
        and(
          eq(invitation.workspaceId, workspaceId),
          or(
            eq(invitation.status, "pending"),
            gt(invitation.createdAt, new Date(now.getTime() - RECENT_MS)),
          ),
        ),
      )
      .orderBy(desc(invitation.createdAt))
      .limit(100);
    return {
      invitations: rows.map(({ row, inviterName }) => toDto(row, inviterName, now)),
      seats: {
        used: await this.seatsUsed(tx, workspaceId, now),
        limit: await this.seats.seatLimit(workspaceId),
      },
    };
  }

  async create(inviter: AuthUser, workspaceId: string, body: CreateInvitationBody) {
    const tx = this.requestDb.current();
    const now = new Date();
    // One invitation at a time per workspace, so concurrent requests can't exceed the seat limit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`);
    const sends = await this.rateLimit.consume(
      `invite:workspace:${workspaceId}`,
      INVITES_PER_WORKSPACE_PER_HOUR,
      3600,
    );
    if (!sends.allowed) {
      throw new ApiProblem(429, "rate_limited", "Too many invitations. Try again later.");
    }
    // Expired invitations no longer hold the address or a seat.
    await tx
      .update(invitation)
      .set({ status: "expired" })
      .where(
        and(
          eq(invitation.workspaceId, workspaceId),
          eq(invitation.status, "pending"),
          lte(invitation.expiresAt, now),
        ),
      );
    const [member] = await tx
      .select({ id: membership.id })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        and(eq(membership.workspaceId, workspaceId), sql`lower(${user.email}) = ${body.email}`),
      )
      .limit(1);
    if (member) {
      throw new ApiProblem(409, "already_member", "This person is already a member.");
    }
    const [open] = await tx
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.workspaceId, workspaceId),
          eq(invitation.email, body.email),
          eq(invitation.status, "pending"),
        ),
      )
      .limit(1);
    if (open) {
      throw new ApiProblem(409, "already_invited", "This email already has an open invitation.");
    }
    const limit = await this.seats.seatLimit(workspaceId);
    const used = await this.seatsUsed(tx, workspaceId, now);
    if (!hasFreeSeat({ members: used, pendingInvitations: 0 }, limit)) {
      throw new ApiProblem(
        409,
        "seat_limit_reached",
        `This workspace has ${limit} seats and all are taken. Remove a member or revoke an invitation first.`,
      );
    }

    const { token, tokenHash } = newInvitationToken();
    const [row] = await tx
      .insert(invitation)
      .values({
        workspaceId,
        email: body.email,
        role: body.role,
        tokenHash,
        invitedBy: inviter.id,
        expiresAt: invitationExpiry(now),
        lastSentAt: now,
      })
      .returning();
    if (!row) throw new Error("invitation insert returned nothing");
    // Sent inline, like sign-in codes: the link's token never sits in the email queue. If sending
    // fails, the transaction rolls back and nothing is left half-done.
    await this.send(tx, workspaceId, row, token, inviter, now);
    await this.events.record("invitation.sent", {
      actorUserId: inviter.id,
      workspaceId,
      invitationId: row.id,
      role: row.role,
    });
    return toDto(row, inviter.name, now);
  }

  async resend(inviter: AuthUser, workspaceId: string, invitationId: string): Promise<void> {
    const tx = this.requestDb.current();
    const now = new Date();
    const row = await this.find(tx, workspaceId, invitationId);
    const resends = await this.rateLimit.consume(
      `invite-resend:${invitationId}`,
      RESENDS_PER_INVITATION_PER_DAY,
      DAY_SECONDS,
    );
    const decision = resendDecision(row, resends.allowed ? 0 : RESENDS_PER_INVITATION_PER_DAY, now);
    if (decision === "gone")
      throw new ApiProblem(410, "gone", "This invitation is no longer open.");
    if (decision === "rate_limited") {
      throw new ApiProblem(429, "rate_limited", "This invitation was resent too often today.");
    }
    // A new link replaces the old one; the expiry stays the same (data model §5).
    const { token, tokenHash } = newInvitationToken();
    const [updated] = await tx
      .update(invitation)
      .set({ tokenHash, sendCount: sql`${invitation.sendCount} + 1`, lastSentAt: now })
      .where(eq(invitation.id, row.id))
      .returning();
    if (!updated) throw new Error("invitation update returned nothing");
    await this.send(tx, workspaceId, updated, token, inviter, now);
    await this.events.record("invitation.resent", {
      actorUserId: inviter.id,
      workspaceId,
      invitationId: row.id,
    });
  }

  async revoke(actor: AuthUser, workspaceId: string, invitationId: string): Promise<void> {
    const tx = this.requestDb.current();
    const row = await this.find(tx, workspaceId, invitationId);
    if (effectiveStatus(row) !== "pending") {
      throw new ApiProblem(410, "gone", "This invitation is no longer open.");
    }
    await tx.update(invitation).set({ status: "revoked" }).where(eq(invitation.id, row.id));
    await this.events.record("invitation.revoked", {
      actorUserId: actor.id,
      workspaceId,
      invitationId: row.id,
    });
  }

  private async find(tx: Transaction, workspaceId: string, invitationId: string) {
    const [row] = /^[0-9a-f-]{36}$/i.test(invitationId)
      ? await tx
          .select()
          .from(invitation)
          .where(and(eq(invitation.id, invitationId), eq(invitation.workspaceId, workspaceId)))
          .limit(1)
      : [];
    if (!row) throw new ApiProblem(404, "not_found");
    return row;
  }

  /** Members plus open invitations (FR-021). */
  private async seatsUsed(tx: Transaction, workspaceId: string, now: Date): Promise<number> {
    const [members] = await tx
      .select({ n: count() })
      .from(membership)
      .where(eq(membership.workspaceId, workspaceId));
    const [pending] = await tx
      .select({ n: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.workspaceId, workspaceId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, now),
        ),
      );
    return Number(members?.n ?? 0) + Number(pending?.n ?? 0);
  }

  private async send(
    tx: Transaction,
    workspaceId: string,
    row: InvitationRow,
    token: string,
    inviter: AuthUser,
    now: Date,
  ): Promise<void> {
    const [ws] = await tx
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    const locale = toEmailLocale(inviter.preferredLanguage);
    const daysLeft = Math.max(
      1,
      Math.ceil((row.expiresAt.getTime() - now.getTime()) / (INVITATION_TTL_MS / 7)),
    );
    const rendered = await renderInvitation(locale, {
      workspaceName: ws?.name ?? "Guidesk",
      // The invitee may see who invites them; the public link preview shows the name only.
      inviterName: inviter.name || inviter.email,
      role: row.role,
      acceptUrl: `${this.config.PORTAL_URL}/${locale}/invite/${token}`,
      expiresInDays: daysLeft,
    });
    await this.email.send({ to: row.email, ...rendered, template: "team.invitation" });
  }
}
