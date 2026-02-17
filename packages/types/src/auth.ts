// ---------------------------------------------------------------------------
// Auth & User types
// ---------------------------------------------------------------------------

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export type AuthProvider = 'github' | 'google';

export interface User {
  id: string;
  email: string;
  passwordHash?: string;
  name: string;
  avatarUrl: string | null;
  isSuper: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAccount {
  userId: string;
  accountId: string;
  role: UserRole;
}

export interface OAuthProvider {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  isSuper: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
