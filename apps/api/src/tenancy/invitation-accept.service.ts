import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { effectiveStatus } from "@guidesk/domain";
import { invitation, user, workspace, type DbHandle } from "@guidesk/db";
import { renderInvitationAccepted, toEmailLocale } from "@guidesk/emails";
import type { AuthUser } from "@guidesk/integrations";
import type { AcceptInvitationResponse, InvitationPreview } from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { InvitationEvents } from "./invitations.events.js";
import { hashInvitationToken, isWellFormedToken } from "./invitation-token.js";

function gone(): ApiProblem {
  return new ApiProblem(410, "gone", "This invitation is no longer valid.");
}

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** Public lookup and acceptance of invitation links (FR-019, FR-020, AC-SEC-002, T075). */
@Injectable()
export class InvitationAcceptService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly requestDb: RequestDb,
    private readonly events: InvitationEvents,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * What the invitee sees before signing in: the workspace name, the inviter's display name, and
   * the role. Nothing else about the workspace, and no other state than "open" (AC-SEC-002).
   */
  async preview(token: string): Promise<InvitationPreview> {
    if (!isWellFormedToken(token)) throw gone();
    const [row] = await this.handle.db
      .select({
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        role: invitation.role,
        workspaceName: workspace.name,
        workspaceStatus: workspace.status,
        inviterName: user.name,
      })
      .from(invitation)
      .innerJoin(workspace, eq(workspace.id, invitation.workspaceId))
      .leftJoin(user, eq(user.id, invitation.invitedBy))
      .where(eq(invitation.tokenHash, hashInvitationToken(token)))
      .limit(1);
    if (!row || effectiveStatus(row) !== "pending" || row.workspaceStatus !== "active") {
      throw gone();
    }
    return {
      workspaceName: row.workspaceName,
      inviterName: row.inviterName || null,
      role: row.role,
      status: "pending",
    };
  }

  /** Joins the workspace through accept_invitation(); never creates one (FR-020). */
  async accept(member: AuthUser, token: string): Promise<AcceptInvitationResponse> {
    if (!isWellFormedToken(token)) throw gone();
    const tokenHash = hashInvitationToken(token);
    let result;
    try {
      result = await this.requestDb.current().execute<{
        joined_workspace_id: string;
        granted_role: "owner" | "admin" | "agent";
        result: "joined" | "already_member";
        inviter_id: string | null;
      }>(sql`SELECT * FROM accept_invitation(${tokenHash}, ${member.id})`);
    } catch (error) {
      const code = pgCode(error);
      if (code === "GD410") throw gone();
      if (code === "GD403") {
        await this.recordDenied(member.id, tokenHash);
        throw new ApiProblem(
          403,
          "email_mismatch",
          "This invitation was sent to another email address. Sign in with that address to accept it.",
        );
      }
      throw error;
    }
    const row = result.rows[0];
    if (!row) throw gone();
    if (row.result === "joined" && row.inviter_id && row.granted_role !== "owner") {
      await this.notifyInviter(row.inviter_id, member, row.joined_workspace_id, row.granted_role);
    }
    return { workspaceId: row.joined_workspace_id, role: row.granted_role, result: row.result };
  }

  /** Logged against the invitation's workspace, so its owners see attempts (FR-030). */
  private async recordDenied(actorUserId: string, tokenHash: string): Promise<void> {
    const [row] = await this.handle.db
      .select({ id: invitation.id, workspaceId: invitation.workspaceId })
      .from(invitation)
      .where(eq(invitation.tokenHash, tokenHash))
      .limit(1);
    await this.events.record("invitation.accept_denied", {
      actorUserId,
      workspaceId: row?.workspaceId ?? null,
      invitationId: row?.id ?? null,
      reason: "email_mismatch",
    });
  }

  private async notifyInviter(
    inviterId: string,
    member: AuthUser,
    workspaceId: string,
    role: "admin" | "agent",
  ): Promise<void> {
    const [inviter] = await this.handle.db
      .select({ email: user.email, language: user.preferredLanguage })
      .from(user)
      .where(eq(user.id, inviterId))
      .limit(1);
    const [ws] = await this.handle.db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    if (!inviter || !ws) return;
    const rendered = await renderInvitationAccepted(toEmailLocale(inviter.language), {
      memberName: member.name || member.email,
      workspaceName: ws.name,
      role,
    });
    await this.outbox.enqueueEmail({
      to: inviter.email,
      ...rendered,
      template: "team.invitation_accepted",
    });
  }
}
