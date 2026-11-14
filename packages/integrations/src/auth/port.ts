/** Identity port (constitution, Principle IV; ADR-0008). Tenancy never depends on the provider. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  preferredLanguage: string | null;
  isStaff: boolean;
  twoFactorEnabled: boolean;
  lastWorkspaceId: string | null;
}

export interface AuthSessionInfo {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthSession {
  user: AuthUser;
  session: AuthSessionInfo;
}

export interface UpdatableUserFields {
  name?: string;
  preferredLanguage?: string;
}

export interface AuthProviderPort {
  /** Resolves the signed-in user from request headers (session cookie), or null. */
  getSession(headers: Headers): Promise<AuthSession | null>;
  /** Updates the signed-in user's own profile fields. */
  updateUser(headers: Headers, fields: UpdatableUserFields): Promise<void>;
}
