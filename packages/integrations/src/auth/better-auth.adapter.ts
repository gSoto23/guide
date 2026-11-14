import type { AuthProviderPort, AuthSession, UpdatableUserFields } from "./port.js";

/** The subset of a Better Auth instance this adapter needs (keeps the library out of the type). */
export interface BetterAuthLike {
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: Record<string, unknown> & {
        id: string;
        email: string;
        name: string;
        emailVerified: boolean;
      };
      session: Record<string, unknown> & {
        id: string;
        userId: string;
        createdAt: Date;
        expiresAt: Date;
      };
    } | null>;
    updateUser(input: { headers: Headers; body: Record<string, unknown> }): Promise<unknown>;
  };
}

/** AuthProviderPort backed by Better Auth (T019). */
export class BetterAuthAdapter implements AuthProviderPort {
  constructor(private readonly auth: BetterAuthLike) {}

  async getSession(headers: Headers): Promise<AuthSession | null> {
    const result = await this.auth.api.getSession({ headers });
    if (!result) {
      return null;
    }
    const { user, session } = result;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        preferredLanguage:
          typeof user.preferredLanguage === "string" ? user.preferredLanguage : null,
        isStaff: user.isStaff === true,
        twoFactorEnabled: user.twoFactorEnabled === true,
        lastWorkspaceId: typeof user.lastWorkspaceId === "string" ? user.lastWorkspaceId : null,
      },
      session: {
        id: session.id,
        userId: session.userId,
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
      },
    };
  }

  async updateUser(headers: Headers, fields: UpdatableUserFields): Promise<void> {
    await this.auth.api.updateUser({ headers, body: { ...fields } });
  }
}
